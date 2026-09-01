import React from 'react';

import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { TerminalView } from '@/components/views/TerminalView';
import {
    clampTerminalDockHeight,
} from './terminalDockState';

export type TerminalDockProps = {
    height: number;
    expanded?: boolean;
    onHeightChange: (height: number) => void;
    onClose: () => void;
    onToggleExpanded?: () => void;
};

export function TerminalDock({
    height,
    expanded = false,
    onHeightChange,
    onClose,
    onToggleExpanded,
}: TerminalDockProps) {
    const { t } = useI18n();
    const dockRef = React.useRef<HTMLDivElement | null>(null);
    const pointerIdRef = React.useRef<number | null>(null);
    const startYRef = React.useRef(0);
    const startHeightRef = React.useRef(height);
    const liveHeightRef = React.useRef(height);
    const maxHeightRef = React.useRef<number | null>(null);

    const finishResize = React.useCallback(() => {
        if (pointerIdRef.current === null) return;
        const nextHeight = clampTerminalDockHeight(liveHeightRef.current, maxHeightRef.current);
        liveHeightRef.current = nextHeight;
        pointerIdRef.current = null;
        maxHeightRef.current = null;
        document.documentElement.style.cursor = '';
        onHeightChange(nextHeight);
    }, [onHeightChange]);

    React.useEffect(() => {
        const move = (event: PointerEvent) => {
            if (pointerIdRef.current !== event.pointerId) return;
            const nextHeight = clampTerminalDockHeight(
                startHeightRef.current + startYRef.current - event.clientY,
                maxHeightRef.current,
            );
            liveHeightRef.current = nextHeight;
            dockRef.current?.style.setProperty('height', `${nextHeight}px`);
        };
        const end = (event: PointerEvent) => {
            if (pointerIdRef.current !== event.pointerId) return;
            finishResize();
        };
        const blur = () => finishResize();

        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', end);
        window.addEventListener('pointercancel', end);
        window.addEventListener('blur', blur);
        return () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', end);
            window.removeEventListener('pointercancel', end);
            window.removeEventListener('blur', blur);
            pointerIdRef.current = null;
            maxHeightRef.current = null;
            document.documentElement.style.cursor = '';
        };
    }, [finishResize]);

    const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
        if (expanded) return;
        pointerIdRef.current = event.pointerId;
        startYRef.current = event.clientY;
        startHeightRef.current = height;
        liveHeightRef.current = height;
        maxHeightRef.current = dockRef.current?.parentElement?.clientHeight ?? null;
        document.documentElement.style.cursor = 'row-resize';
        event.preventDefault();
    };

    return (
        <div
            ref={dockRef}
            data-terminal-dock="true"
            className={cn(
                'relative flex min-h-0 w-full flex-shrink-0 flex-col border-t border-border bg-background',
                expanded && 'absolute inset-0 z-30 h-full',
            )}
            style={expanded ? undefined : { height: `${height}px` }}
        >
            {!expanded ? (
                <div
                    role="separator"
                    aria-orientation="horizontal"
                    aria-label={t('contextPanel.actions.resizePanelAria')}
                    className="absolute -top-1 left-0 right-0 z-30 h-2 cursor-row-resize touch-none"
                    onPointerDown={startResize}
                />
            ) : null}
            <TerminalView
                visible
                onClose={onClose}
                onToggleExpanded={onToggleExpanded}
                isExpanded={expanded}
            />
        </div>
    );
}
