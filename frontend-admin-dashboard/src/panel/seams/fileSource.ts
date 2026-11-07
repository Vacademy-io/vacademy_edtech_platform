/**
 * Where a lesson's media file URL comes from.
 *
 * Defaults to useSignedUrl (a fresh signed URL on every mount). The offline
 * layer can install a provider that serves PDFs and scenes from its cache, and
 * wrap defaultLessonFileProvider for everything else, without editing the
 * player. A provider is a hook: each component keeps the one it first rendered
 * with, so installing a new provider can never change a mounted component's
 * hook order. Install it at boot.
 */
import { useState } from 'react';
import { useSignedUrl } from '../content/lessonApi';

export type LessonFileKind = 'pdf' | 'scene' | 'file-video';

/** The part of a react-query result the player reads. */
export interface LessonFileResult {
    data: string | undefined;
    isLoading: boolean;
    isError: boolean;
    error: unknown;
    /** Changes whenever a fresh URL arrives: the player uses it as a key. */
    dataUpdatedAt: number;
    refetch: () => unknown;
}

export type LessonFileProvider = (fileId: string | null, kind: LessonFileKind) => LessonFileResult;

export const defaultLessonFileProvider: LessonFileProvider = function useDefaultLessonFile(fileId) {
    return useSignedUrl(fileId);
};

let provider: LessonFileProvider = defaultLessonFileProvider;

/** Pass null to restore the default. */
export function setLessonFileProvider(next: LessonFileProvider | null): void {
    provider = next ?? defaultLessonFileProvider;
}

export function useLessonFileUrl(fileId: string | null, kind: LessonFileKind): LessonFileResult {
    const [pinned] = useState(() => provider);
    return pinned(fileId, kind);
}
