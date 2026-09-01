import React from 'react';

import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { DirectoryListResult } from '@/lib/api/types';
import { getRuntimeKey } from '@/lib/runtime-switch';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { Icon } from '@/components/icon/Icon';
import {
    filterServerDirectoryEntries,
    getServerDirectoryParent,
    normalizeServerDirectoryPath,
} from './serverDirectoryPicker';

export type ServerDirectoryPickerDialogProps = {
    open: boolean;
    initialDirectory: string;
    listDirectory: (path: string, options?: { scope?: 'server' }) => Promise<DirectoryListResult>;
    onOpenChange: (open: boolean) => void;
    onSelectDirectory: (directory: string) => void;
};

export function ServerDirectoryPickerDialog({
    open,
    initialDirectory,
    listDirectory,
    onOpenChange,
    onSelectDirectory,
}: ServerDirectoryPickerDialogProps) {
    const { t } = useI18n();
    const [currentPath, setCurrentPath] = React.useState('/');
    const [pathInput, setPathInput] = React.useState('/');
    const [entries, setEntries] = React.useState<DirectoryListResult['entries']>([]);
    const [isLoading, setIsLoading] = React.useState(false);
    const [loadError, setLoadError] = React.useState(false);
    const requestIdRef = React.useRef(0);

    const loadDirectory = React.useCallback(async (value: string) => {
        const normalized = normalizeServerDirectoryPath(value);
        if (!normalized) {
            setLoadError(true);
            return;
        }

        const requestId = requestIdRef.current + 1;
        requestIdRef.current = requestId;
        const runtimeKey = getRuntimeKey();
        setCurrentPath(normalized);
        setPathInput(normalized);
        setIsLoading(true);
        setLoadError(false);

        try {
            const result = await listDirectory(normalized, { scope: 'server' });
            if (requestId !== requestIdRef.current || runtimeKey !== getRuntimeKey()) return;
            setEntries(filterServerDirectoryEntries(result.entries));
        } catch {
            if (requestId !== requestIdRef.current || runtimeKey !== getRuntimeKey()) return;
            setLoadError(true);
        } finally {
            if (requestId === requestIdRef.current && runtimeKey === getRuntimeKey()) {
                setIsLoading(false);
            }
        }
    }, [listDirectory]);

    React.useEffect(() => {
        if (!open) return;
        const initial = normalizeServerDirectoryPath(initialDirectory) ?? '/';
        setEntries([]);
        setLoadError(false);
        void loadDirectory(initial);
    }, [initialDirectory, loadDirectory, open]);

    const handlePathSubmit = (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        void loadDirectory(pathInput);
    };

    const parentDirectory = getServerDirectoryParent(currentPath);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-xl gap-3" showCloseButton>
                <DialogHeader>
                    <DialogTitle>{t('terminalView.upload.chooseDirectory')}</DialogTitle>
                    <DialogDescription>{t('terminalView.upload.chooseDirectoryDescription')}</DialogDescription>
                </DialogHeader>

                <form onSubmit={handlePathSubmit} className="flex items-center gap-2">
                    <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="shrink-0"
                        onClick={() => {
                            if (parentDirectory) void loadDirectory(parentDirectory);
                        }}
                        disabled={!parentDirectory || isLoading}
                        title={t('terminalView.upload.parentDirectory')}
                        aria-label={t('terminalView.upload.parentDirectory')}
                    >
                        <Icon name="arrow-up" className="size-4" />
                    </Button>
                    <Input
                        value={pathInput}
                        onChange={(event) => setPathInput(event.target.value)}
                        aria-label={t('terminalView.upload.currentDirectory')}
                        placeholder="/"
                    />
                </form>

                <div className="min-h-40 max-h-64 overflow-y-auto rounded-lg border border-border bg-[var(--surface-muted)] p-1">
                    {isLoading ? (
                        <div className="flex h-40 items-center justify-center typography-ui-label text-muted-foreground">
                            {t('terminalView.upload.directoryLoading')}
                        </div>
                    ) : loadError ? (
                        <div className="flex h-40 flex-col items-center justify-center gap-2 px-4 text-center typography-ui-label text-muted-foreground">
                            <span>{t('terminalView.upload.directoryLoadFailed')}</span>
                            <Button type="button" variant="outline" size="sm" onClick={() => void loadDirectory(currentPath)}>
                                {t('terminalView.upload.directoryRetry')}
                            </Button>
                        </div>
                    ) : entries.length === 0 ? (
                        <div className="flex h-40 items-center justify-center typography-ui-label text-muted-foreground">
                            {t('terminalView.upload.directoryEmpty')}
                        </div>
                    ) : (
                        <div className="flex flex-col gap-0.5">
                            {entries.map((entry) => (
                                <button
                                    key={entry.path}
                                    type="button"
                                    data-server-directory-entry={entry.path}
                                    className={cn(
                                        'flex min-w-0 items-center gap-2 rounded-md px-2 py-2 text-left typography-ui-label text-foreground transition-colors',
                                        'hover:bg-interactive-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-interactive-focus-ring',
                                    )}
                                    onClick={() => void loadDirectory(entry.path)}
                                >
                                    <Icon name="folder" className="size-4 shrink-0 text-muted-foreground" />
                                    <span className="truncate">{entry.name}</span>
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                        {t('directoryTree.actions.cancel')}
                    </Button>
                    <Button
                        type="button"
                        data-server-directory={currentPath}
                        onClick={() => {
                            onSelectDirectory(currentPath);
                            onOpenChange(false);
                        }}
                        disabled={isLoading || Boolean(loadError)}
                    >
                        {t('terminalView.upload.selectDirectory')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
