import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const mainLayoutSource = readFileSync(join(directory, '..', 'MainLayout.tsx'), 'utf8');
const contextPanelSource = readFileSync(join(directory, '..', 'ContextPanel.tsx'), 'utf8');
const mobileAppSource = readFileSync(join(directory, '..', '..', '..', 'apps', 'MobileApp.tsx'), 'utf8');
const drawerSource = readFileSync(join(directory, '..', '..', '..', 'apps', 'MobileWorkspaceDrawer.tsx'), 'utf8');

describe('desktop terminal dock layout', () => {
    test('renders TerminalDock below the chat area', () => {
        expect(mainLayoutSource).toContain("from '@/components/terminal/TerminalDock'");
        expect(mainLayoutSource).toContain('data-chat-area');
        expect(mainLayoutSource).toContain('<TerminalDock');
        expect(mainLayoutSource).toContain('isDesktopTerminalDockOpen');
    });

    test('does not render a duplicate terminal in ContextPanel', () => {
        expect(contextPanelSource).toContain('terminalDocked');
        expect(contextPanelSource).toContain('isTerminalDocked');
        expect(contextPanelSource).toContain('if (isTerminalDocked) return null;');

        const finalContextHook = contextPanelSource.indexOf('const hasOpenEditorFile = React.useMemo');
        const terminalReturn = contextPanelSource.indexOf('if (isTerminalDocked) return null;');
        expect(finalContextHook).toBeGreaterThan(-1);
        expect(terminalReturn).toBeGreaterThan(finalContextHook);
    });

    test('uses the bottom dock only for landscape-tablet terminal workspaces', () => {
        expect(mobileAppSource).toContain('isTabletTerminalDockOpen');
        expect(mobileAppSource).toContain('<TerminalDock');
        expect(mobileAppSource).toContain('terminalDockOpen');
        expect(drawerSource).toContain('terminalDocked');
        expect(drawerSource).toContain('!terminalDocked');
    });
});
