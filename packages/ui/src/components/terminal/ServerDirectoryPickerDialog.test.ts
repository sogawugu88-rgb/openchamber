import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(directory, 'ServerDirectoryPickerDialog.tsx'), 'utf8');

describe('ServerDirectoryPickerDialog', () => {
    test('loads directories through the server filesystem scope', () => {
        expect(source).toContain('listDirectory(normalized, { scope: \'server\' })');
        expect(source).toContain('data-server-directory-entry={entry.path}');
        expect(source).toContain('onClick={() => void loadDirectory(entry.path)}');
    });

    test('supports parent navigation and directory confirmation', () => {
        expect(source).toContain('getServerDirectoryParent(currentPath)');
        expect(source).toContain('data-server-directory={currentPath}');
        expect(source).toContain('onSelectDirectory(currentPath)');
    });

    test('ignores stale directory requests after runtime or path changes', () => {
        expect(source).toContain('requestId !== requestIdRef.current');
        expect(source).toContain('runtimeKey !== getRuntimeKey()');
    });
});
