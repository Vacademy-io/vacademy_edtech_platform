import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

const saveDraft = vi.fn();
vi.mock('../-services/learner-home-service', async () => {
    const errors = await vi.importActual<typeof import('../-services/learner-home-errors')>(
        '../-services/learner-home-errors'
    );
    return {
        learnerHomeApi: { saveDraft: (...a: unknown[]) => saveDraft(...a), getDraft: vi.fn() },
        toLearnerHomeError: errors.toLearnerHomeError,
    };
});

import { createBuiltinBlock } from '../-utils/block-factory';
import { useDraftAutosave } from './useDraftAutosave';
import { useLearnerHomeDraft } from './useLearnerHomeDraft';

function loadDraft() {
    useLearnerHomeDraft.getState().load({
        id: 'd1',
        status: 'DRAFT',
        version: 0,
        base_version: null,
        revision: 3,
        template_key: 'BLANK',
        settings: { phone_spacing: 'COMPACT', show_header: true, carousel_autoplay_default: true },
        blocks: [createBuiltinBlock('HERO')],
    });
}

afterEach(() => {
    saveDraft.mockReset();
    useLearnerHomeDraft.getState().clear();
});

describe('flushPending (leaving the editor)', () => {
    it('sends an edit made within the autosave delay, from a snapshot taken before the store is cleared', async () => {
        loadDraft();
        const { result } = renderHook(() => useDraftAutosave('inst-1', true));
        useLearnerHomeDraft.getState().setSettings({ show_header: false });
        saveDraft.mockResolvedValue({ revision: 4 });

        const done = result.current.flushPending();
        useLearnerHomeDraft.getState().clear();
        await done;

        expect(saveDraft).toHaveBeenCalledTimes(1);
        const [instituteId, body] = saveDraft.mock.calls[0]!;
        expect(instituteId).toBe('inst-1');
        expect(body.revision).toBe(3);
        expect(body.settings.show_header).toBe(false);
        expect(body.blocks).toHaveLength(1);
    });

    it('waits for a save already on its way and uses the revision it got', async () => {
        loadDraft();
        const { result } = renderHook(() => useDraftAutosave('inst-1', true));
        let finishFirst: (v: { revision: number }) => void = () => undefined;
        saveDraft.mockImplementationOnce(() => new Promise((r) => (finishFirst = r)));
        saveDraft.mockResolvedValueOnce({ revision: 5 });

        useLearnerHomeDraft.getState().setSettings({ show_header: false });
        const first = result.current.saveNow();
        useLearnerHomeDraft.getState().setSettings({ phone_spacing: 'COMFORTABLE' });
        const flushed = result.current.flushPending();
        useLearnerHomeDraft.getState().clear();
        finishFirst({ revision: 4 });
        await first;
        await flushed;

        expect(saveDraft).toHaveBeenCalledTimes(2);
        expect(saveDraft.mock.calls[1]![1].revision).toBe(4);
        expect(saveDraft.mock.calls[1]![1].settings.phone_spacing).toBe('COMFORTABLE');
    });

    it('sends nothing when everything is saved or the draft is in conflict', async () => {
        loadDraft();
        const { result } = renderHook(() => useDraftAutosave('inst-1', true));
        await result.current.flushPending();
        useLearnerHomeDraft.getState().setSettings({ show_header: false });
        useLearnerHomeDraft.getState().markConflict({ updatedBy: null, updatedAt: null });
        await result.current.flushPending();
        expect(saveDraft).not.toHaveBeenCalled();
    });
});
