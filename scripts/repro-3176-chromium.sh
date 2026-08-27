#!/usr/bin/env bash
# Reproduction for openchamber issue #3176 — Chromium (VS Code webview engine).
#
# Runs the duplex probe in headless Chromium and prints the results. The
# webview in the VS Code extension runs on this exact engine, which enforces
# the fetch-spec requirement that `new Request(...)` with a ReadableStream body
# must pass `duplex: "half"`.

set -u
DIR="$(cd "$(dirname "$0")" && pwd)"
CHROME="${CHROME:-chromium}"

"$CHROME" --headless=new --disable-gpu --no-sandbox \
  --dump-dom "file://$DIR/repro-3176-duplex.html" 2>/dev/null \
  | node -e "
    let html = '';
    process.stdin.on('data', (c) => (html += c));
    process.stdin.on('end', () => {
      const m = html.match(/<pre id=\"results\">([\s\S]*?)<\/pre>/);
      if (!m) { console.error('results block not found'); process.exit(1); }
      console.log(m[1].replace(/ -&gt; /g, ' -> ').trim());
    });
  "