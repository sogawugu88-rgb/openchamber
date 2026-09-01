import type {
  DirectoryListResult,
  FileSearchQuery,
  FileSearchResult,
  FilesAPI,
} from '@openchamber/ui/lib/api/types';
import {
  FilesystemError,
  parseFilesystemErrorReason,
  type FilesystemErrorReason,
} from '@openchamber/ui/lib/api/files-errors';
import { runtimeFetch } from '@openchamber/ui/lib/runtime-fetch';

const normalizePath = (path: string): string => path.replace(/\\/g, '/');

interface WebFilesAPIOptions {
  urls?: unknown;
  getDirectory?: () => string | undefined;
}

type WebDirectoryEntry = {
  name?: string;
  path?: string;
  isDirectory?: boolean;
  isFile?: boolean;
  isSymbolicLink?: boolean;
};

type WebDirectoryListResponse = {
  directory?: string;
  path?: string;
  entries?: WebDirectoryEntry[];
};

type WebFileUploadResponse = {
  success?: boolean;
  path?: string;
  error?: string;
  reason?: FilesystemErrorReason;
};

type WebScopedPathBody = {
  path: string;
  scope?: 'server';
};

type WebScopedWriteBody = WebScopedPathBody & {
  content: string;
};

type WebScopedRenameBody = {
  oldPath: string;
  newPath: string;
  scope?: 'server';
};

type WebFileDownloadQuery = {
  path: string;
  download: boolean;
  scope?: 'server';
  allowOutsideWorkspace?: 'true';
  outsideFileGrant?: string;
};

const toDirectoryListResult = (fallbackDirectory: string, payload: WebDirectoryListResponse): DirectoryListResult => {
  if (!payload || !Array.isArray(payload.entries)) {
    throw new FilesystemError('Directory listing returned an invalid response', {
      reason: 'invalid-response',
    });
  }
  const directory = normalizePath(payload?.directory || payload?.path || fallbackDirectory);

  return {
    directory,
    entries: payload.entries
      .filter((entry): entry is Required<Pick<WebDirectoryEntry, 'name' | 'path'>> & { isDirectory?: boolean } =>
        Boolean(entry && typeof entry.name === 'string' && typeof entry.path === 'string')
      )
      .map((entry) => ({
        name: entry.name,
        path: normalizePath(entry.path),
        isDirectory: Boolean(entry.isDirectory),
      })),
  };
};

const directoryHeaders = (getDirectory?: () => string | undefined, override?: string): Record<string, string> | undefined => {
  const directory = override || getDirectory?.();
  return directory ? { 'x-opencode-directory': directory } : undefined;
};

export const createWebFilesAPI = ({ getDirectory }: WebFilesAPIOptions): FilesAPI => ({
  async listDirectory(path: string, options): Promise<DirectoryListResult> {
    const target = normalizePath(path);
    const params = new URLSearchParams();
    if (target) {
      params.set('path', target);
    }
    if (options?.respectGitignore) {
      params.set('respectGitignore', 'true');
    }
    if (options?.scope === 'server') {
      params.set('scope', 'server');
    }

    const response = await runtimeFetch('/api/fs/list', {
      query: params,
      headers: directoryHeaders(getDirectory),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText })) as {
        error?: string;
        reason?: unknown;
      };
      throw new FilesystemError(
        error.error || 'Failed to list directory',
        {
          reason: parseFilesystemErrorReason(error.reason),
          status: response.status,
        },
      );
    }

    const result = (await response.json()) as WebDirectoryListResponse;
    return toDirectoryListResult(target, result);
  },

  async search(payload: FileSearchQuery): Promise<FileSearchResult[]> {
    const params = new URLSearchParams();

    const directory = normalizePath(payload.directory);
    if (directory) {
      params.set('directory', directory);
    }

    params.set('query', payload.query);
    params.set('dirs', 'false');
    params.set('type', 'file');

    if (typeof payload.maxResults === 'number' && Number.isFinite(payload.maxResults)) {
      params.set('limit', String(payload.maxResults));
    }

    const response = await runtimeFetch('/api/find/file', {
      query: params,
      headers: directoryHeaders(getDirectory),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error((error as { error?: string }).error || 'Failed to search files');
    }

    const result = (await response.json()) as string[];
    const files = Array.isArray(result) ? result : [];

    return files.map((relativePath) => ({
      path: normalizePath(`${directory}/${relativePath}`),
      preview: [normalizePath(relativePath)],
    }));
  },

  async createDirectory(path: string, options): Promise<{ success: boolean; path: string }> {
    const target = normalizePath(path);
    const body: WebScopedPathBody = { path: target };
    if (options?.scope === 'server') {
      body.scope = 'server';
    }
    const response = await runtimeFetch('/api/fs/mkdir', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...directoryHeaders(getDirectory, options?.directory) },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error((error as { error?: string }).error || 'Failed to create directory');
    }

    const result = await response.json();
    return {
      success: Boolean(result?.success),
      path: typeof result?.path === 'string' ? normalizePath(result.path) : target,
    };
  },

  async statFile(path: string, options): Promise<{ path: string; isFile: boolean; size: number; mtimeMs?: number }> {
    const target = normalizePath(path);
    const params = new URLSearchParams({ path: target });
    if (options?.scope === 'server') {
      params.set('scope', 'server');
    }
    if (options?.allowOutsideWorkspace) {
      params.set('allowOutsideWorkspace', 'true');
    }
    if (options?.outsideFileGrant) {
      params.set('outsideFileGrant', options.outsideFileGrant);
    }
    const response = await runtimeFetch('/api/fs/stat', {
      query: params,
      headers: directoryHeaders(getDirectory, options?.directory),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error((error as { error?: string }).error || 'Failed to stat file');
    }

    const result = await response.json().catch(() => ({}));
    return {
      path: typeof (result as { path?: string }).path === 'string' ? normalizePath((result as { path: string }).path) : target,
      isFile: Boolean((result as { isFile?: boolean }).isFile),
      size: typeof (result as { size?: number }).size === 'number' ? (result as { size: number }).size : 0,
      mtimeMs: typeof (result as { mtimeMs?: number }).mtimeMs === 'number' ? (result as { mtimeMs: number }).mtimeMs : undefined,
    };
  },

  async readFile(path: string, options): Promise<{ content: string; path: string }> {
    const target = normalizePath(path);
    const params = new URLSearchParams({ path: target });
    if (options?.scope === 'server') {
      params.set('scope', 'server');
    }
    if (options?.allowOutsideWorkspace) {
      params.set('allowOutsideWorkspace', 'true');
    }
    if (options?.outsideFileGrant) {
      params.set('outsideFileGrant', options.outsideFileGrant);
    }
    if (options?.optional) {
      params.set('optional', 'true');
    }
    const response = await runtimeFetch('/api/fs/read', {
      query: params,
      cache: options?.optional ? 'no-store' : 'default',
      headers: directoryHeaders(getDirectory, options?.directory),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error((error as { error?: string }).error || 'Failed to read file');
    }

    const content = await response.text();
    return { content, path: target };
  },

  async writeFile(path: string, content: string, options): Promise<{ success: boolean; path: string }> {
    const target = normalizePath(path);
    const body: WebScopedWriteBody = { path: target, content };
    if (options?.scope === 'server') {
      body.scope = 'server';
    }
    const response = await runtimeFetch('/api/fs/write', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...directoryHeaders(getDirectory, options?.directory) },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error((error as { error?: string }).error || 'Failed to write file');
    }

    const result = await response.json().catch(() => ({}));
    return {
      success: Boolean((result as { success?: boolean }).success),
      path: typeof (result as { path?: string }).path === 'string' ? normalizePath((result as { path: string }).path) : target,
    };
  },

  async uploadFile(path: string, file: Blob, options): Promise<{ success: boolean; path: string }> {
    const target = normalizePath(path);
    const response = await runtimeFetch('/api/fs/upload', {
      method: 'POST',
      query: {
        path: target,
        overwrite: options?.overwrite ? 'true' : undefined,
        scope: options?.scope === 'server' ? 'server' : undefined,
      },
      headers: {
        'Content-Type': 'application/octet-stream',
        ...directoryHeaders(getDirectory, options?.directory),
      },
      body: file,
    });

    if (!response.ok) {
      const error: WebFileUploadResponse = await response.json().catch(() => ({ error: response.statusText }));
      throw new FilesystemError(error.error || 'Failed to upload file', {
        reason: parseFilesystemErrorReason(error.reason),
        status: response.status,
      });
    }

    const result: WebFileUploadResponse = await response.json().catch(() => ({}));
    return {
      success: Boolean(result.success),
      path: result.path ? normalizePath(result.path) : target,
    };
  },

  async delete(path: string, options): Promise<{ success: boolean }> {
    const target = normalizePath(path);
    const body: WebScopedPathBody = { path: target };
    if (options?.scope === 'server') {
      body.scope = 'server';
    }
    const response = await runtimeFetch('/api/fs/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...directoryHeaders(getDirectory, options?.directory) },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error((error as { error?: string }).error || 'Failed to delete file');
    }

    const result = await response.json().catch(() => ({}));
    return { success: Boolean((result as { success?: boolean }).success) };
  },

  async rename(oldPath: string, newPath: string, options): Promise<{ success: boolean; path: string }> {
    const body: WebScopedRenameBody = { oldPath, newPath };
    if (options?.scope === 'server') {
      body.scope = 'server';
    }
    const response = await runtimeFetch('/api/fs/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...directoryHeaders(getDirectory, options?.directory) },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error((error as { error?: string }).error || 'Failed to rename file');
    }

    const result = await response.json().catch(() => ({}));
    return {
      success: Boolean((result as { success?: boolean }).success),
      path: typeof (result as { path?: string }).path === 'string' ? normalizePath((result as { path: string }).path) : newPath,
    };
  },

  async revealPath(targetPath: string, options): Promise<{ success: boolean }> {
    const body: WebScopedPathBody = { path: normalizePath(targetPath) };
    if (options?.scope === 'server') {
      body.scope = 'server';
    }
    const response = await runtimeFetch('/api/fs/reveal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...directoryHeaders(getDirectory, options?.directory) },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error((error as { error?: string }).error || 'Failed to reveal path');
    }

    const result = await response.json().catch(() => ({}));
    return { success: Boolean((result as { success?: boolean }).success) };
  },

  async downloadFile(path: string, options): Promise<void> {
    const target = normalizePath(path);
    const query: WebFileDownloadQuery = { path: target, download: true };
    if (options?.scope === 'server') {
      query.scope = 'server';
    }
    if (options?.allowOutsideWorkspace) {
      query.allowOutsideWorkspace = 'true';
    }
    if (options?.outsideFileGrant) {
      query.outsideFileGrant = options.outsideFileGrant;
    }
    const response = await runtimeFetch('/api/fs/raw', {
      query,
      headers: directoryHeaders(getDirectory, options?.directory),
    });
    if (!response.ok) {
      throw new Error(`Download failed (${response.status})`);
    }

    const blob = await response.blob();
    const filename = target.split('/').pop() || 'file';
    const capacitor = (window as typeof window & {
      Capacitor?: { isNativePlatform?: () => boolean };
    }).Capacitor;
    const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
    if (capacitor?.isNativePlatform?.() === true && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file] });
      return;
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 100);
  },
});
