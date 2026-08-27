// Reproduction for openchamber issue #3176
// -----------------------------------------
// "Failed to create session" — `new Request` with streaming body missing
// `duplex: "half"` in webview (Chromium).
//
// Runs the REAL bundled SDK fetch layer (@opencode-ai/sdk@1.18.23, the exact
// version pinned by the repo and the VS Code extension) in Node >= 18, whose
// undici fetch enforces the same duplex rule as the Chromium webview runtime.
//
// A local echo server stands in for `opencode serve`. If a request arrives,
// the bug is absent; if the SDK's `new Request(url, requestInit)` throws
// before the network, the request never leaves the client — matching the
// report ("server-side logs show nothing at all").
//
// Run with: node scripts/repro-3176-duplex.mjs

import { createOpencodeClient } from "@opencode-ai/sdk/v2";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";

const SDK_PKG = JSON.parse(readFileSync(new URL("../node_modules/@opencode-ai/sdk/package.json", import.meta.url), "utf8"));
console.log(`@opencode-ai/sdk version: ${SDK_PKG.version}\n`);

// ---------------------------------------------------------------------------
// Static evidence: every `new Request(...)` construction site in the bundled
// SDK fetch layer, none of which pass `duplex`.
// ---------------------------------------------------------------------------
const sites = [
  ["dist/v2/gen/client/client.gen.js", "request init spread", "new Request(url, requestInit)"],
  ["dist/v2/gen/client/client.gen.js", "SSE onRequest wrapper", "new Request(url, init)"],
  ["dist/v2/gen/core/serverSentEvents.gen.js", "SSE client", "new Request(url, requestInit)"],
  ["dist/v2/client.js", "URL-rewrite clone", "new Request(url, request)"],
  ["dist/client.js", "v1 URL-rewrite clone", "new Request(url, request)"],
  ["dist/gen/client/client.gen.js", "v1 request init spread", "new Request(url, requestInit)"],
];
console.log("new Request() sites in bundled SDK fetch layer (none set duplex):");
for (const [file, label, expr] of sites) {
  const path = new URL(`../node_modules/@opencode-ai/sdk/${file}`, import.meta.url);
  const text = readFileSync(path, "utf8");
  if (!text.includes(expr)) {
    console.log(`  [missing] ${file} (${label})`);
    continue;
  }
  const line = text.split("\n").findIndex((l) => l.includes(expr)) + 1;
  const hasDuplex = text.includes("duplex");
  console.log(`  ${file}:${line}  ${expr}   (file mentions duplex: ${hasDuplex})`);
}

// ---------------------------------------------------------------------------
// Echo server standing in for `opencode serve`.
// ---------------------------------------------------------------------------
const encoder = new TextEncoder();
let requestsSeen = 0;
const server = createServer(async (req, res) => {
  requestsSeen += 1;
  let body = "";
  for await (const chunk of req) body += chunk;
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ ok: true, method: req.method, path: req.url, body }));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
const baseUrl = `http://127.0.0.1:${port}`;
console.log(`\necho server on ${baseUrl}\n`);

const makeStream = () =>
  new ReadableStream({
    start(c) {
      c.enqueue(encoder.encode('{"title":"from-stream"}'));
      c.close();
    },
  });

const streamBodyOptions = { url: "/session", method: "POST", body: makeStream(), bodySerializer: undefined };

// ---------------------------------------------------------------------------
// A) Unpatched SDK: stream body -> `new Request` throws (duplex missing).
//    This is client.gen.js:48, the site every SDK call funnels through.
// ---------------------------------------------------------------------------
const client = createOpencodeClient({ baseUrl });
const rawClient = client.client; // the underlying createClient() result
const before = requestsSeen;
let failure;
try {
  const result = await rawClient.request(streamBodyOptions);
  failure = result?.error ?? new Error("no error returned");
} catch (error) {
  failure = error;
}
console.log("A) unpatched SDK, stream body:");
console.log(`   raw error: ${failure instanceof Error ? failure.message : String(failure)}`);
console.log(`   requests seen by server: ${requestsSeen - before} (report: "server logs show nothing")`);

// OpenChamber's unwrapSdkData(response, 'session.create') turns this into the
// reported message shape:
console.log(`   wrapped as: session.create failed: ${failure instanceof Error ? failure.message : String(failure)}\n`);

// ---------------------------------------------------------------------------
// B) Same request built with the issue's suggested `duplex: "half"` fix.
// ---------------------------------------------------------------------------
const clientPatched = createOpencodeClient({ baseUrl });
const rawClientPatched = clientPatched.client;
let patchedResult;
try {
  const url = rawClientPatched.buildUrl({ ...streamBodyOptions, baseUrl });
  const requestInit = {
    redirect: "follow",
    method: "POST",
    body: makeStream(),
    duplex: "half",
    headers: new Headers({ "content-type": "application/json" }),
  };
  const req = new Request(url, requestInit);
  const response = await fetch(req);
  patchedResult = { ok: response.ok, status: response.status, json: await response.json() };
} catch (error) {
  patchedResult = { threw: error.message };
}
console.log("B) patched SDK (duplex: 'half'), stream body:");
console.log(`   result: ${JSON.stringify(patchedResult)}`);
console.log(`   requests seen by server: ${requestsSeen - before}\n`);

server.close();