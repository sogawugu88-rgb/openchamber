import type { TokenUsageAPI, TokenUsageReport } from '@openchamber/ui/lib/api/types';
import { runtimeFetch } from '@openchamber/ui/lib/runtime-fetch';

const parseTokenUsageReport = (body: string): TokenUsageReport => JSON.parse(body);

export const createWebTokenUsageAPI = (): TokenUsageAPI => ({
  async getReport(month: string): Promise<TokenUsageReport> {
    const response = await runtimeFetch('/api/openchamber/token-usage', { query: { month } });
    const body = await response.text();
    if (!response.ok) {
      let message = `Token usage API returned ${response.status} ${response.statusText}`;
      try {
        const payload = JSON.parse(body);
        if (payload?.error) message = String(payload.error);
      } catch {
        // Preserve the HTTP failure when the error body is not JSON.
      }
      throw new Error(message);
    }
    return parseTokenUsageReport(body);
  },
});
