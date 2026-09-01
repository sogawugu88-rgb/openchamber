import { describe, expect, test } from 'bun:test';

import {
    TERMINAL_DOCK_DEFAULT_HEIGHT,
    TERMINAL_DOCK_MAX_HEIGHT,
    TERMINAL_DOCK_MIN_HEIGHT,
    clampTerminalDockHeight,
    isDesktopTerminalDockOpen,
    isTabletTerminalDockOpen,
} from './terminalDockState';

describe('terminal dock contracts', () => {
    test('clamps invalid and out-of-range heights', () => {
        expect(TERMINAL_DOCK_DEFAULT_HEIGHT).toBe(280);
        expect(clampTerminalDockHeight(Number.NaN)).toBe(TERMINAL_DOCK_DEFAULT_HEIGHT);
        expect(clampTerminalDockHeight(80)).toBe(TERMINAL_DOCK_MIN_HEIGHT);
        expect(clampTerminalDockHeight(900)).toBe(TERMINAL_DOCK_MAX_HEIGHT);
        expect(clampTerminalDockHeight(500, 540)).toBe(420);
    });

    test('opens only for the active desktop terminal surface', () => {
        expect(isDesktopTerminalDockOpen(true, 'terminal')).toBe(true);
        expect(isDesktopTerminalDockOpen(false, 'terminal')).toBe(false);
        expect(isDesktopTerminalDockOpen(true, 'git')).toBe(false);
    });

    test('opens only for an open landscape-tablet terminal workspace', () => {
        expect(isTabletTerminalDockOpen(true, true, 'terminal')).toBe(true);
        expect(isTabletTerminalDockOpen(false, true, 'terminal')).toBe(false);
        expect(isTabletTerminalDockOpen(true, false, 'terminal')).toBe(false);
        expect(isTabletTerminalDockOpen(true, true, 'files')).toBe(false);
    });
});
