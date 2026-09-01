export const normalizeCodeServerBaseUrl = (baseUrl: string | undefined): string | null => {
  const trimmedBaseUrl = baseUrl?.trim();
  if (!trimmedBaseUrl) return '';

  try {
    const url = new URL(trimmedBaseUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.username || url.password) return null;
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
    return url.toString();
  } catch {
    return null;
  }
};

export const buildCodeServerProjectUrl = (
  baseUrl: string | undefined,
  directory: string | undefined,
): string | null => {
  const trimmedBaseUrl = normalizeCodeServerBaseUrl(baseUrl);
  const trimmedDirectory = directory?.trim();
  if (!trimmedBaseUrl || !trimmedDirectory) return null;

  try {
    const url = new URL(trimmedBaseUrl);
    url.searchParams.set('folder', trimmedDirectory);
    return url.toString();
  } catch {
    return null;
  }
};
