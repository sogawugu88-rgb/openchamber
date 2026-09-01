export type TerminalUploadOutcome = 'uploaded' | 'conflict' | 'failed';

type TerminalUploadSummary = {
    uploaded: number;
    conflicts: number;
    failed: number;
};

export const getTerminalUploadName = (file: Pick<File, 'name'>): string | null => {
    const name = file.name;
    if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) {
        return null;
    }
    return name;
};

export const joinTerminalUploadPath = (directory: string, name: string): string => (
    directory === '/' ? `/${name}` : `${directory.replace(/\/+$/, '')}/${name}`
);

export const summarizeTerminalUploads = (
    outcomes: readonly TerminalUploadOutcome[],
): TerminalUploadSummary => ({
    uploaded: outcomes.filter((outcome) => outcome === 'uploaded').length,
    conflicts: outcomes.filter((outcome) => outcome === 'conflict').length,
    failed: outcomes.filter((outcome) => outcome === 'failed').length,
});
