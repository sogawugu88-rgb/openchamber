const EMPTY_BUCKET = Object.freeze({
  input: 0,
  output: 0,
  reasoning: 0,
  cacheRead: 0,
  cacheWrite: 0,
  total: 0,
});
const MAX_PAGINATION_PAGES = 1000;
const GLOBAL_SESSION_LIST_PATH = '/experimental/session?archived=true';

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

const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;

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
    providerID: info.providerID?.constructor === String ? info.providerID.trim() : '',
    modelID: info.modelID?.constructor === String ? info.modelID.trim() : '',
  };
};

const localDate = (timestamp, timezone) => new Intl.DateTimeFormat('en-CA', {
  timeZone: timezone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date(timestamp));

const currentLocalDate = (timezone) => localDate(Date.now(), timezone);

const isValidTimezone = (timezone) => {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format();
    return true;
  } catch {
    return false;
  }
};

const fetchAllPages = async (openCodeFetch, path, label) => {
  const records = [];
  let cursor;
  const cursors = new Set();
  let pageCount = 0;

  do {
    pageCount += 1;
    if (pageCount > MAX_PAGINATION_PAGES) throw new Error(`OpenCode ${label} pagination limit exceeded`);
    const query = cursor ? `${path.includes('?') ? '&' : '?'}cursor=${encodeURIComponent(cursor)}` : '';
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
  const getReport = async ({ month, timezone }) => {
    if (!month?.match?.(/^\d{4}-\d{2}$/)) {
      throw new Error('Invalid token usage month');
    }

    const reportTimezone = timezone || getServerTimezone();
    if (!isValidTimezone(reportTimezone)) {
      throw new Error('Invalid token usage timezone');
    }
    const sessions = await fetchAllPages(openCodeFetch, GLOBAL_SESSION_LIST_PATH, 'session list');
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

    const todayDate = currentLocalDate(reportTimezone);
    const currentMonth = todayDate.slice(0, 7);
    const total = createBucket();
    const currentMonthTotal = createBucket();
    const todayTotal = createBucket();
    const days = {};
    const modelBucketsByDay = {};

    for (const sample of samples) {
      addSample(total, sample.sample);
      const date = localDate(sample.timestamp, reportTimezone);
      if (date.slice(0, 7) === currentMonth) addSample(currentMonthTotal, sample.sample);
      if (date === todayDate) addSample(todayTotal, sample.sample);
      if (date.slice(0, 7) !== month) continue;
      days[date] ??= createBucket();
      addSample(days[date], sample.sample);
      if (!sample.providerID || !sample.modelID) continue;
      modelBucketsByDay[date] ??= new Map();
      const modelKey = `${sample.providerID}\u0000${sample.modelID}`;
      const modelBucket = modelBucketsByDay[date].get(modelKey) ?? {
        providerID: sample.providerID,
        modelID: sample.modelID,
        ...createBucket(),
      };
      addSample(modelBucket, sample.sample);
      modelBucketsByDay[date].set(modelKey, modelBucket);
    }

    const modelsByDay = Object.fromEntries(Object.entries(modelBucketsByDay).map(([date, modelBuckets]) => [
      date,
      [...modelBuckets.values()].sort((left, right) => (
        right.total - left.total
        || compareText(left.providerID, right.providerID)
        || compareText(left.modelID, right.modelID)
      )),
    ]));

    return {
      timezone: reportTimezone,
      month,
      today: { date: todayDate, ...todayTotal },
      currentMonth: currentMonthTotal,
      total,
      days,
      modelsByDay,
      fetchedAt: Date.now(),
    };
  };

  return { getReport };
};
