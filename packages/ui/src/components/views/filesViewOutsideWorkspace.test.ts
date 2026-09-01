import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(directory, 'FilesView.tsx'), 'utf8');

describe('FilesView outside-workspace file access', () => {
  test('passes server scope for external reads and mutations', () => {
    expect(source).toContain("scope: selectedFileIsOutsideWorkspace && isBrowserClient ? 'server' as const : undefined");
    expect(source).not.toContain('!selectedFileIsOutsideWorkspace && !isSelectedBinary');
    expect(source).toContain('files.writeFile(selectedFile.path, contentToWrite, selectedFileOperationOptions)');
    expect(source).toContain('files.writeFile(path, xml, selectedFileOperationOptions)');
    expect(source).toContain('fn(selectedFile.path, selectedFileReadOptions)');
    expect(source).toContain("selectedFileReadOptions.scope === 'server'");
  });
});
