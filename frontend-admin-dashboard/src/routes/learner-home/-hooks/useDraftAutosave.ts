/**
 * Autosave for the draft (spec 8.3): PUT /draft 1.5 s after the last edit,
 * one request at a time, carrying the revision the editor holds.
 *  - 409 STALE_DRAFT: someone else saved; the conflict banner offers Reload
 *    (take theirs) or Overwrite (re-send ours on their revision).
 *  - 422: the server's field errors are shown inline; no retry until the next edit.
 */
import { useCallback, useEffect, useRef } from 'react';
import { learnerHomeApi, toLearnerHomeError } from '../-services/learner-home-service';
import { buildSavePayload } from '../-utils/payload';
import { hasUnsavedEdits, useLearnerHomeDraft } from './useLearnerHomeDraft';

export const AUTOSAVE_DELAY_MS = 1500;

export function useDraftAutosave(instituteId: string | null, enabled: boolean) {
    const editSeq = useLearnerHomeDraft((s) => s.editSeq);
    const savedSeq = useLearnerHomeDraft((s) => s.savedSeq);
    const status = useLearnerHomeDraft((s) => s.status);
    const inFlight = useRef<Promise<void> | null>(null);
    // The edit a save last failed on: wait for a new edit before trying again.
    const failedSeq = useRef<number | null>(null);
    // The revision the last successful save got, read by a flush that waits
    // for a save already on its way (the store may be cleared by then).
    const lastRevision = useRef<number | null>(null);

    /** Saves now if anything is unsaved. True when the draft ends up saved. */
    const saveNow = useCallback(async (): Promise<boolean> => {
        if (!instituteId) return false;
        while (inFlight.current) await inFlight.current;
        const state = useLearnerHomeDraft.getState();
        if (state.status === 'conflict') return false;
        if (!hasUnsavedEdits(state)) return true;
        const seq = state.editSeq;
        const body = buildSavePayload(state.revision, state.settings, state.blocks);
        state.markSaving();
        const run = (async () => {
            try {
                const res = await learnerHomeApi.saveDraft(instituteId, body);
                lastRevision.current = res.revision;
                failedSeq.current = null;
                useLearnerHomeDraft.getState().markSaved(res.revision, seq);
            } catch (error) {
                const err = toLearnerHomeError(error);
                failedSeq.current = seq;
                if (err.code === 'NO_DRAFT') {
                    // Discarded or published elsewhere: show what the server has now.
                    useLearnerHomeDraft
                        .getState()
                        .markConflict({ updatedBy: err.updatedBy, updatedAt: err.updatedAt });
                } else if (err.code === 'STALE_DRAFT') {
                    useLearnerHomeDraft
                        .getState()
                        .markConflict({ updatedBy: err.updatedBy, updatedAt: err.updatedAt });
                } else {
                    useLearnerHomeDraft
                        .getState()
                        .markError(err.message, err.status === 422 ? err.issues : undefined);
                }
            }
        })();
        inFlight.current = run;
        try {
            await run;
        } finally {
            inFlight.current = null;
        }
        return !hasUnsavedEdits(useLearnerHomeDraft.getState());
    }, [instituteId]);

    useEffect(() => {
        if (!enabled || editSeq <= savedSeq || status === 'conflict' || status === 'saving') return;
        if (failedSeq.current === editSeq) return;
        const id = window.setTimeout(() => void saveNow(), AUTOSAVE_DELAY_MS);
        return () => window.clearTimeout(id);
    }, [enabled, editSeq, savedSeq, status, saveNow]);

    // Leaving with unsaved edits: let the browser ask.
    useEffect(() => {
        if (!enabled) return;
        const onBeforeUnload = (e: BeforeUnloadEvent) => {
            if (!hasUnsavedEdits(useLearnerHomeDraft.getState())) return;
            e.preventDefault();
            e.returnValue = '';
        };
        window.addEventListener('beforeunload', onBeforeUnload);
        return () => window.removeEventListener('beforeunload', onBeforeUnload);
    }, [enabled]);

    /** Conflict → take the newer draft from the server, dropping our edits. */
    const reloadFromServer = useCallback(async () => {
        if (!instituteId) return;
        const res = await learnerHomeApi.getDraft(instituteId);
        if (res.draft) useLearnerHomeDraft.getState().load(res.draft);
        else useLearnerHomeDraft.getState().clear();
        failedSeq.current = null;
    }, [instituteId]);

    /** Conflict → keep our edits, saved on top of the newer revision. */
    const overwrite = useCallback(async () => {
        if (!instituteId) return false;
        const res = await learnerHomeApi.getDraft(instituteId);
        if (!res.draft) return false;
        useLearnerHomeDraft.setState({
            revision: res.draft.revision,
            status: 'dirty',
            conflict: null,
            savedSeq: -1,
        });
        failedSeq.current = null;
        return saveNow();
    }, [instituteId, saveNow]);

    /**
     * Leaving the editor: send what the 1.5 s timer has not sent yet, from a
     * snapshot taken NOW, before the page clears the draft from memory. The
     * request is not awaited by the caller; a route change does not cancel it.
     */
    const flushPending = useCallback((): Promise<void> => {
        const state = useLearnerHomeDraft.getState();
        if (!instituteId || !state.layoutId || state.status === 'conflict')
            return Promise.resolve();
        if (!hasUnsavedEdits(state)) return inFlight.current ?? Promise.resolve();
        const { settings, blocks } = state;
        const startRevision = state.revision;
        const pending = inFlight.current;
        return (async () => {
            let revision = startRevision;
            if (pending) {
                await pending.catch(() => undefined);
                revision = lastRevision.current ?? startRevision;
            }
            try {
                await learnerHomeApi.saveDraft(
                    instituteId,
                    buildSavePayload(revision, settings, blocks)
                );
            } catch {
                // Best effort: a conflict or error shows when the draft is opened again.
            }
        })();
    }, [instituteId]);

    return { saveNow, reloadFromServer, overwrite, flushPending };
}
