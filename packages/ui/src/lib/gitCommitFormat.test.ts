import { describe, expect, test } from 'bun:test';
import { parseCommitStructured, formatFullCommitMessage } from './gitApi';

describe('parseCommitStructured', () => {
  test('parses subject, body, footer, and highlights', () => {
    const input = {
      subject: 'feat(auth): add user login',
      body: 'Implement JWT authentication and password hashing.\nHandle token renewal.',
      footer: 'Fixes #123\nBREAKING CHANGE: login endpoint moved',
      highlights: ['JWT support', 'Token renewal'],
    };
    const parsed = parseCommitStructured(input);
    expect(parsed.subject).toBe('feat(auth): add user login');
    expect(parsed.body).toBe('Implement JWT authentication and password hashing.\nHandle token renewal.');
    expect(parsed.footer).toBe('Fixes #123\nBREAKING CHANGE: login endpoint moved');
    expect(parsed.highlights).toEqual(['JWT support', 'Token renewal']);
  });

  test('parses legacy single-line output without body or footer', () => {
    const input = {
      subject: 'fix: resolve race condition',
      highlights: ['Fixed deadlock in worker pool'],
    };
    const parsed = parseCommitStructured(input);
    expect(parsed.subject).toBe('fix: resolve race condition');
    expect(parsed.body).toBe(undefined);
    expect(parsed.footer).toBe(undefined);
    expect(parsed.highlights).toEqual(['Fixed deadlock in worker pool']);
  });

  test('treats empty/whitespace body and footer as undefined', () => {
    const input = {
      subject: 'chore: update deps',
      body: '   ',
      footer: '',
      highlights: [],
    };
    const parsed = parseCommitStructured(input);
    expect(parsed.subject).toBe('chore: update deps');
    expect(parsed.body).toBe(undefined);
    expect(parsed.footer).toBe(undefined);
  });

  test('throws when subject is missing or empty', () => {
    expect(() => parseCommitStructured({ body: 'something' })).toThrow();
    expect(() => parseCommitStructured({ subject: '   ' })).toThrow();
  });
});

describe('formatFullCommitMessage', () => {
  test('formats subject only when body and footer are absent', () => {
    expect(formatFullCommitMessage({ subject: 'docs: update readme' })).toBe('docs: update readme');
  });

  test('formats subject and body with double newline', () => {
    expect(
      formatFullCommitMessage({
        subject: 'feat: add dark mode',
        body: 'Provide toggle in user settings.',
      })
    ).toBe('feat: add dark mode\n\nProvide toggle in user settings.');
  });

  test('formats subject, body, and footer with blank lines separating them', () => {
    expect(
      formatFullCommitMessage({
        subject: 'fix(api): handle timeout',
        body: 'Add retry with exponential backoff.',
        footer: 'Refs: #456',
      })
    ).toBe('fix(api): handle timeout\n\nAdd retry with exponential backoff.\n\nRefs: #456');
  });

  test('formats subject and footer when body is absent', () => {
    expect(
      formatFullCommitMessage({
        subject: 'chore: drop node 16',
        footer: 'BREAKING CHANGE: node 18+ required',
      })
    ).toBe('chore: drop node 16\n\nBREAKING CHANGE: node 18+ required');
  });
});
