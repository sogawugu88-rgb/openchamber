import { describe, expect, test } from 'bun:test';

import {
    getTerminalUploadName,
    joinTerminalUploadPath,
    summarizeTerminalUploads,
    type TerminalUploadOutcome,
} from './terminalUpload';

describe('terminal upload helpers', () => {
    test('accepts safe file basenames and rejects path-like names', () => {
        expect(getTerminalUploadName({ name: 'notes.txt' })).toBe('notes.txt');
        expect(getTerminalUploadName({ name: 'photo.png' })).toBe('photo.png');
        expect(getTerminalUploadName({ name: '' })).toBeNull();
        expect(getTerminalUploadName({ name: '.' })).toBeNull();
        expect(getTerminalUploadName({ name: '..' })).toBeNull();
        expect(getTerminalUploadName({ name: '../notes.txt' })).toBeNull();
        expect(getTerminalUploadName({ name: 'folder\\notes.txt' })).toBeNull();
    });

    test('summarizes each upload outcome without collapsing failures', () => {
        const outcomes: TerminalUploadOutcome[] = ['uploaded', 'conflict', 'failed', 'uploaded'];
        expect(summarizeTerminalUploads(outcomes)).toEqual({ uploaded: 2, conflicts: 1, failed: 1 });
    });

    test('joins a server directory and a safe upload basename', () => {
        expect(joinTerminalUploadPath('/srv/app', 'file.bin')).toBe('/srv/app/file.bin');
        expect(joinTerminalUploadPath('/', 'file.bin')).toBe('/file.bin');
        expect(joinTerminalUploadPath('/srv/app/', 'file.bin')).toBe('/srv/app/file.bin');
    });
});
