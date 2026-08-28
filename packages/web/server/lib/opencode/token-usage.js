const EMPTY_BUCKET = Object.freeze({
  input: 0,
  output: 0,
  reasoning: 0,
  cacheRead: 0,
  cacheWrite: 0,
  total: 0,
});
const MAX_PAGINATION_PAGES = 1000;

const createBucket = () => ({ ...EMPTY_BUCKET });

const tokenValue = (value) => (
  Number.isFinite(value) && value >= 0 ? value : 0
);

const parseTimestamp = (value) => {
  if (value === undefined || value === null) return null;
  const timestamp = Number.isFinite(value) ? value : Date.parse(String(value));
  return Number.isFinite(timestamp) ? timestamp : null;
};

const addSample = (target, sample) => {
  target.input += sample.input;
  target.output += sample.output;
  target.reasoning += sample.reasoning;
  target.cacheRead += sample.cacheRead;
  target.cacheWrite += sample.cacheWrite;
  target.total += sample.total;
};

const normalizeMessage = (record, sessionID) => {
  if (record?.constructor !== Object || record.info?.constructor !== Object) {
    throw new Error('Malformed OpenCode message record');
  }
  const info = record.info;
  if (info.role !== 'assistant' && info.role !== 'user') {
    throw new Error('Malformed OpenCode message record');
  }
  if (info.role !== 'assistant') return null;
  const id = info.id?.trim?.();
  if (!id) throw new Error('Malformed OpenCode assistant message record');
  if (!info.tokens) return null;
  if (info.tokens.constructor !== Object) throw new Error('Malformed OpenCode usage record');

  const timestamp = [info.time?.completed, info.time?.created]
    .map(parseTimestamp)
    .find((value) => value !== null);
  if (timestamp === undefined) throw new Error('Malformed OpenCode assistant timestamp');

  const tokens = info.tokens;
  const sample = {
    input: tokenValue(tokens.input),
    output: tokenValue(tokens.output),
    reasoning: tokenValue(tokens.reasoning),
    cacheRead: tokenValue(tokens.cache?.read),
    cacheWrite: tokenValue(tokens.cache?.write),
  };
  sample.total = sample.input + sample.output + sample.reasoning + sample.cacheRead + sample.cacheWrite;

  return {
    key: `${sessionID}:${id}:${info.step ?? ''}`,
    timestamp,
    sample,
  };
};

const localDate = (timestamp, timezone) => new Intl.DateTimeFormat('en-CA', {
  timeZone: timezone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date(timestamp));

const currentLocalDate = (timezone) => localDate(Date.now(), timezone);

const fetchAllPages = async (openCodeFetch, path, label) => {
  const records = [];
  let cursor;
  const cursors = new Set();
  let pageCount = 0;

  do {
    pageCount += 1;
    if (pageCount > MAX_PAGINATION_PAGES) throw new Error(`OpenCode ${label} pagination limit exceeded`);
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
    const response = await openCodeFetch(`${path}${query}`);
    const isPage = response?.constructor === Object && 'data' in response && 'nextCursor' in response;
    const data = Array.isArray(response) ? response : isPage ? response.data : null;
    if (!Array.isArray(data)) throw new Error(`Malformed OpenCode ${label} response`);
    records.push(...data);

    const nextCursor = isPage ? response.nextCursor : null;
    if (nextCursor !== null && nextCursor?.constructor !== String) {
      throw new Error(`Malformed OpenCode ${label} cursor`);
    }
    if (!nextCursor) break;
    if (cursors.has(nextCursor)) throw new Error(`Malformed OpenCode ${label} cursor`);
    cursors.add(nextCursor);
    cursor = nextCursor;
  } while (cursor);

  return records;
};

export const createTokenUsageService = ({ openCodeFetch, getServerTimezone }) => {
  const getReport = async ({ month }) => {
    if (!month?.match?.(/^\d{4}-\d{2}$/)) {
      throw new Error('Invalid token usage month');
    }

    const timezone = getServerTimezone();
    const sessions = await fetchAllPages(openCodeFetch, '/session', 'session list');
    const samples = [];
    const seen = new Set();

    for (const session of sessions) {
      const sessionID = session?.id?.trim?.();
      if (session?.constructor !== Object || !sessionID) {
        throw new Error('Malformed OpenCode session record');
      }
      const messages = await fetchAllPages(
        openCodeFetch,
        `/session/${encodeURIComponent(sessionID)}/message`,
        'message list',
      );
      for (const record of messages) {
        const normalized = normalizeMessage(record, sessionID);
        if (!normalized || seen.has(normalized.key)) continue;
        seen.add(normalized.key);
        samples.push(normalized);
      }
    }

    const todayDate = currentLocalDate(timezone);
    const currentMonth = todayDate.slice(0, 7);
    const total = createBucket();
    const currentMonthTotal = createBucket();
    const todayTotal = createBucket();
    const days = {};

    for (const sample of samples) {
      addSample(total, sample.sample);
      const date = localDate(sample.timestamp, timezone);
      if (date.slice(0, 7) === currentMonth) addSample(currentMonthTotal, sample.sample);
      if (date === todayDate) addSample(todayTotal, sample.sample);
      if (date.slice(0, 7) !== month) continue;
      days[date] ??= createBucket();
      addSample(days[date], sample.sample);
    }

    return {
      timezone,
      month,
      today: { date: todayDate, ...todayTotal },
      currentMonth: currentMonthTotal,
      total,
      days,
      fetchedAt: Date.now(),
    };
  };

  return { getReport };
};
