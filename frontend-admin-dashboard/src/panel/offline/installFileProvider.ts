/**
 * Serves PDFs and scenes through the player's file seam. Loaded with the Lessons chunk,
 * before any player can mount. Videos stay on the default provider.
 */
import { useEffect, useState } from 'react';
import i18next from 'i18next';
import {
    defaultLessonFileProvider,
    setLessonFileProvider,
    type LessonFileProvider,
} from '../seams/fileSource';
import { isBackendReachable } from '../device/publicApi';
import { dropSavedFile, forgetCopyAttempt, openSavedFile, saveFileCopy } from './fileCache';
import { isNetworkClassFailure } from './networkFirst';
import { noteOpenSavedFile } from './savedCopy';

interface LocalState {
    fileId: string;
    /** checking: looking in the cache. saved: `url` is an object URL. network: signed URL. */
    phase: 'checking' | 'saved' | 'network';
    url?: string;
    at: number;
}

const useCachedLessonFile: LessonFileProvider = function useCachedLessonFile(fileId, kind) {
    const cacheable = kind !== 'file-video' && !!fileId;
    const [local, setLocal] = useState<LocalState | null>(null);
    const [attempt, setAttempt] = useState(0);
    const mine = local && local.fileId === fileId ? local : null;
    const useNetwork = !cacheable || mine?.phase === 'network';
    const network = defaultLessonFileProvider(useNetwork ? fileId : null, kind);
    const signedUrl = useNetwork ? network.data : undefined;

    useEffect(() => {
        if (!cacheable || !fileId) return undefined;
        let cancelled = false;
        let objectUrl: string | null = null;
        let closeNote: (() => void) | null = null;
        setLocal({ fileId, phase: 'checking', at: Date.now() });
        void openSavedFile(fileId).then((url) => {
            if (cancelled) {
                if (url) URL.revokeObjectURL(url);
                return;
            }
            objectUrl = url;
            if (url) closeNote = noteOpenSavedFile();
            setLocal({
                fileId,
                phase: url ? 'saved' : 'network',
                url: url ?? undefined,
                at: Date.now(),
            });
        });
        return () => {
            cancelled = true;
            if (objectUrl) URL.revokeObjectURL(objectUrl);
            closeNote?.();
        };
    }, [cacheable, fileId, attempt]);

    useEffect(() => {
        if (cacheable && fileId && signedUrl) saveFileCopy(fileId, signedUrl);
    }, [cacheable, fileId, signedUrl]);

    if (!cacheable) return network;
    if (mine?.phase === 'saved' && mine.url) {
        return {
            data: mine.url,
            isLoading: false,
            isError: false,
            error: null,
            dataUpdatedAt: mine.at,
            refetch: () => {
                // The player could not read the copy. It goes, and the network takes over.
                if (fileId) {
                    forgetCopyAttempt(fileId);
                    void dropSavedFile(fileId).then(() => setAttempt((value) => value + 1));
                }
            },
        };
    }
    if (mine?.phase === 'network') {
        if (network.isError && (!isBackendReachable() || isNetworkClassFailure(network.error))) {
            return { ...network, error: new Error(i18next.t('offline:notSaved')) };
        }
        return network;
    }
    return {
        data: undefined,
        isLoading: !!fileId,
        isError: false,
        error: null,
        dataUpdatedAt: 0,
        refetch: () => undefined,
    };
};

setLessonFileProvider(useCachedLessonFile);
