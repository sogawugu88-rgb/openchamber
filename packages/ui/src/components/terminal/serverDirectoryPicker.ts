import type { DirectoryListResult } from '@/lib/api/types';

export const normalizeServerDirectoryPath = (value: string): string | null => {
    const normalized = value.trim().replace(/\\/g, '/');
    if (!normalized || !normalized.startsWith('/')) return null;
    if (normalized === '/') return '/';
    return normalized.replace(/\/+$/, '') || '/';
};

export const getServerDirectoryParent = (value: string): string | null => {
    const normalized = normalizeServerDirectoryPath(value);
    if (!normalized || normalized === '/') return null;
    const parent = normalized.slice(0, normalized.lastIndexOf('/'));
    return parent || '/';
};

export const filterServerDirectoryEntries = (
    entries: DirectoryListResult['entries'],
): DirectoryListResult['entries'] => entries
    .filter((entry) => entry.isDirectory)
    .sort((left, right) => left.name.localeCompare(right.name));
