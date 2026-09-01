import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(directory, 'DirectoryExplorerDialog.tsx'), 'utf8');

describe('DirectoryExplorerDialog new-folder flow', () => {
  test('shows a direct child folder creation action', () => {
    expect(source).toContain('directoryTree.actions.createNewDirectory');
    expect(source).toContain('newFolderName');
    expect(source).toContain('handleCreateFolder');
    expect(source).toContain('opencodeClient.createDirectory(newFolderPath, { asProject: true })');
  });

  test('validates the new folder as a child of the current directory', () => {
    expect(source).toContain('getNewDirectoryPath');
    expect(source).toContain("name.includes('/') || name.includes('\\\\')");
    expect(source).toContain("name === '.' || name === '..'");
  });
});
