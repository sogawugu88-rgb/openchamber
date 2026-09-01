import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(directory, 'TerminalView.tsx'), 'utf8');

describe('TerminalView file upload', () => {
    test('uses the runtime file API and current terminal directory', () => {
        expect(source).toContain('files: fileAPI');
        expect(source).toContain('fileAPI.uploadFile');
        expect(source).toContain('type="file"');
        expect(source).toContain('multiple');
        expect(source).toContain('file-add');
        expect(source).toContain('initialDirectory={effectiveDirectory}');
        expect(source).toContain('notifyFileContentInvalidated');
    });

    test('keeps overwrite disabled for terminal uploads', () => {
        expect(source).toContain('overwrite: false');
    });

    test('opens a server directory picker before the local file picker', () => {
        expect(source).toContain('ServerDirectoryPickerDialog');
        expect(source).toContain('fileAPI.listDirectory');
        expect(source).toContain("scope: 'server'");
        expect(source).toContain('joinTerminalUploadPath');
        expect(source).toContain('directory: uploadDirectory');
    });
});
