import { describe, expect, test } from 'bun:test';

import {
    filterServerDirectoryEntries,
    getServerDirectoryParent,
    normalizeServerDirectoryPath,
} from './serverDirectoryPicker';

describe('server directory picker helpers', () => {
    test('normalizes absolute server paths and preserves root', () => {
        expect(normalizeServerDirectoryPath('/srv/app/')).toBe('/srv/app');
        expect(normalizeServerDirectoryPath('/')).toBe('/');
        expect(normalizeServerDirectoryPath('relative/path')).toBeNull();
        expect(normalizeServerDirectoryPath('')).toBeNull();
    });

    test('returns the parent directory until root', () => {
        expect(getServerDirectoryParent('/srv/app')).toBe('/srv');
        expect(getServerDirectoryParent('/srv')).toBe('/');
        expect(getServerDirectoryParent('/')).toBeNull();
    });

    test('keeps directories and drops files from the picker list', () => {
        expect(filterServerDirectoryEntries([
            { name: 'app', path: '/srv/app', isDirectory: true },
            { name: 'readme.md', path: '/srv/readme.md', isDirectory: false },
        ])).toEqual([{ name: 'app', path: '/srv/app', isDirectory: true }]);
    });
});
