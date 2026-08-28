const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

const currentServerMonth = (timezone) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(Date.now());
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  return `${year}-${month}`;
};

export const registerTokenUsageRoutes = (app, dependencies) => {
  const { tokenUsageService, getServerTimezone } = dependencies;

  app.get('/api/openchamber/token-usage', async (req, res) => {
    const queryMonth = req.query.month;
    const requestedMonth = Array.isArray(queryMonth)
      ? queryMonth[0]
      : queryMonth
        || currentServerMonth(getServerTimezone());

    if (!MONTH_PATTERN.test(requestedMonth)) {
      return res.status(400).json({ error: 'month must use YYYY-MM format' });
    }

    try {
      const report = await tokenUsageService.getReport({ month: requestedMonth });
      return res.json(report);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to retrieve token usage';
      return res.status(502).json({ error: message });
    }
  });
};
