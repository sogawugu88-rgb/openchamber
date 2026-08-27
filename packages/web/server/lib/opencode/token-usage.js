const EMPTY_BUCKET = Object.freeze({
  input: 0,
  output: 0,
  reasoning: 0,
  cacheRead: 0,
  cacheWrite: 0,
  total: 0,
});

const createBucket = () => ({ ...EMPTY_BUCKET });

const tokenValue = (value) => (
  Number.isFinite(value) && value >= 0 ? value : 0
);

const addSample = (target, sample) => {
  target.input += sample.input;
  target.output += sample.output;
  target.reasoning += sample.reasoning;
  target.cacheRead += sample.cacheRead;
  target.cacheWrite += sample.cacheWrite;
  target.total += sample.total;
};

const normalizeMessage = (record, sessionID) => {
  if (record?.constructor !== Object || record.info?.constructor !== Object) return null;
  const info = record.info;
  const id = info.id?.trim?.();
  if (info.role !== 'assistant' || !id || info.tokens?.constructor !== Object) return null;

  const completed = info.time?.completed ?? info.time?.created;
  const timestamp = Number.isFinite(completed) ? completed : Date.parse(String(completed));
  if (!Number.isFinite(timestamp)) return null;

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

const assertArray = (value, label) => {
  if (!Array.isArray(value)) throw new Error(`Malformed OpenCode ${label} response`);
  return value;
};

export const createTokenUsageService = ({ openCodeFetch, getServerTimezone }) => {
  const getReport = async ({ month }) => {
    if (!month?.match?.(/^\d{4}-\d{2}$/)) {
      throw new Error('Invalid token usage month');
    }

    const timezone = getServerTimezone();
    const sessions = assertArray(await openCodeFetch('/session'), 'session list');
    const samples = [];
    const seen = new Set();

    for (const session of sessions) {
      const sessionID = session?.id?.trim?.();
      if (session?.constructor !== Object || !sessionID) {
        throw new Error('Malformed OpenCode session record');
      }
      const messages = assertArray(
        await openCodeFetch(`/session/${encodeURIComponent(sessionID)}/message`),
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
    const days = {};

    for (const sample of samples) {
      addSample(total, sample.sample);
      const date = localDate(sample.timestamp, timezone);
      if (date.slice(0, 7) === currentMonth) addSample(currentMonthTotal, sample.sample);
      if (date.slice(0, 7) !== month) continue;
      days[date] ??= createBucket();
      addSample(days[date], sample.sample);
    }

    return {
      timezone,
      month,
      today: { date: todayDate, ...days[todayDate] ?? createBucket() },
      currentMonth: currentMonthTotal,
      total,
      days,
      fetchedAt: Date.now(),
    };
  };

  return { getReport };
};
