import { describe, expect, test } from 'bun:test';

import { buildCodeServerProjectUrl } from './codeServerUrl';

describe('buildCodeServerProjectUrl', () => {
  test('adds the encoded authoritative project directory as folder', () => {
    expect(buildCodeServerProjectUrl('https://code.example.com/', '/workspace/my project')).toBe(
      'https://code.example.com/?folder=%2Fworkspace%2Fmy+project',
    );
  });

  test('preserves the base path and existing query parameters', () => {
    expect(buildCodeServerProjectUrl('https://code.example.com/code?auth=1', '/workspace/repo')).toBe(
      'https://code.example.com/code?auth=1&folder=%2Fworkspace%2Frepo',
    );
  });

  test('rejects unsupported bases and missing directories', () => {
    expect(buildCodeServerProjectUrl('javascript:alert(1)', '/workspace/repo')).toBeNull();
    expect(buildCodeServerProjectUrl('https://user:password@code.example.com', '/workspace/repo')).toBeNull();
    expect(buildCodeServerProjectUrl('https://code.example.com', '')).toBeNull();
    expect(buildCodeServerProjectUrl(undefined, '/workspace/repo')).toBeNull();
  });

  test('replaces an existing folder parameter', () => {
    expect(buildCodeServerProjectUrl('https://code.example.com/?folder=/old', '/new')).toBe(
      'https://code.example.com/?folder=%2Fnew',
    );
  });
});
