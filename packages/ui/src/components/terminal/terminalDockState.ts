import type { ContextPanelMode } from '@/stores/useUIStore';

export const TERMINAL_DOCK_DEFAULT_HEIGHT = 280;
export const TERMINAL_DOCK_MIN_HEIGHT = 160;
export const TERMINAL_DOCK_MAX_HEIGHT = 720;
const TERMINAL_DOCK_MIN_CHAT_HEIGHT = 120;

export const clampTerminalDockHeight = (height: number, availableHeight: number | null = null): number => {
    const safeHeight = Number.isFinite(height) ? Math.round(height) : TERMINAL_DOCK_DEFAULT_HEIGHT;
    const availableMax = availableHeight === null
        ? TERMINAL_DOCK_MAX_HEIGHT
        : Math.max(TERMINAL_DOCK_MIN_HEIGHT, Math.floor(availableHeight - TERMINAL_DOCK_MIN_CHAT_HEIGHT));
    const maxHeight = Math.min(TERMINAL_DOCK_MAX_HEIGHT, availableMax);
    return Math.min(maxHeight, Math.max(TERMINAL_DOCK_MIN_HEIGHT, safeHeight));
};

export const isDesktopTerminalDockOpen = (isOpen: boolean, activeMode: ContextPanelMode | null): boolean =>
    isOpen && activeMode === 'terminal';

export const isTabletTerminalDockOpen = (
    workspaceAsPanel: boolean,
    workspaceOpen: boolean,
    workspaceTab: string,
): boolean => workspaceAsPanel && workspaceOpen && workspaceTab === 'terminal';
