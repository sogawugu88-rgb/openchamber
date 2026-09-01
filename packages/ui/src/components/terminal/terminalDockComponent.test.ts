import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const dockSource = readFileSync(join(directory, 'TerminalDock.tsx'), 'utf8');
const terminalSource = readFileSync(join(directory, '..', 'views', 'TerminalView.tsx'), 'utf8');

test('keeps resize work local and mounts TerminalView through the dock', () => {
    expect(dockSource).toContain('data-terminal-dock');
    expect(dockSource).toContain('clampTerminalDockHeight');
    expect(dockSource).toContain('onHeightChange(nextHeight)');
    expect(dockSource).toContain('onClose={onClose}');
});

test('keeps dock-only controls optional for existing terminal hosts', () => {
    expect(terminalSource).toContain('onToggleExpanded?: () => void');
    expect(terminalSource).toContain('onClose?: () => void');
    expect(terminalSource).toContain('onToggleExpanded ?');
    expect(terminalSource).toContain('onClose ?');
});
