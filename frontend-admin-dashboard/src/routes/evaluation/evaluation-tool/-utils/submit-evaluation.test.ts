/**
 * The invariant under test is blunt: a checked copy must never vanish.
 *
 * Every case below is a way the old `handleSubmit` could lose a faculty's
 * finished marking — the submit skipped in silence, the editor wedged behind a
 * loading overlay so the work could only be discarded by reloading, or a saved
 * evaluation reported back as a failure.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    runEvaluationSubmit,
    UPLOAD_FAILED_MESSAGE,
    UNKNOWN_FAILURE_MESSAGE,
    type EvaluationSubmitDeps,
    type EvaluationSubmitStage,
} from './submit-evaluation';

const PDF = new Blob(['%PDF-1.7'], { type: 'application/pdf' });
const FILE_ID = 'evaluated-file-id';

interface Harness {
    deps: EvaluationSubmitDeps;
    stages: EvaluationSubmitStage[];
    buildAnnotatedPdf: ReturnType<typeof vi.fn>;
    uploadEvaluatedPdf: ReturnType<typeof vi.fn>;
    submitMarks: ReturnType<typeof vi.fn>;
    releaseResult: ReturnType<typeof vi.fn>;
    rescueDraft: ReturnType<typeof vi.fn>;
}

/** All-succeeding deps; each test breaks exactly one of them. */
const harness = (overrides: Partial<EvaluationSubmitDeps> = {}): Harness => {
    const stages: EvaluationSubmitStage[] = [];
    const buildAnnotatedPdf = vi.fn().mockResolvedValue(PDF);
    const uploadEvaluatedPdf = vi.fn().mockResolvedValue(FILE_ID);
    const submitMarks = vi.fn().mockResolvedValue({ ok: true });
    const releaseResult = vi.fn().mockResolvedValue({ ok: true });
    const rescueDraft = vi.fn().mockResolvedValue(undefined);

    const deps: EvaluationSubmitDeps = {
        buildAnnotatedPdf,
        uploadEvaluatedPdf,
        submitMarks,
        releaseResult,
        rescueDraft,
        onStage: (stage) => stages.push(stage),
        ...overrides,
    };

    return {
        deps,
        stages,
        buildAnnotatedPdf,
        uploadEvaluatedPdf,
        submitMarks,
        releaseResult,
        rescueDraft,
    };
};

beforeEach(() => {
    // The module logs every failure on purpose; keep the run output readable.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('runEvaluationSubmit — the happy path', () => {
    it('uploads the annotated sheet, saves the marks against it, and releases the result', async () => {
        const h = harness();

        const outcome = await runEvaluationSubmit(h.deps);

        expect(outcome).toEqual({ status: 'submitted' });
        expect(h.buildAnnotatedPdf).toHaveBeenCalledOnce();
        expect(h.uploadEvaluatedPdf).toHaveBeenCalledWith(PDF);
        // The marks must be attached to the ANNOTATED file, not anything else.
        expect(h.submitMarks).toHaveBeenCalledWith(FILE_ID);
        expect(h.releaseResult).toHaveBeenCalledOnce();
        // Nothing failed, so there is nothing to rescue.
        expect(h.rescueDraft).not.toHaveBeenCalled();
        expect(h.stages).toEqual(['building', 'uploading', 'settled']);
    });
});

describe('runEvaluationSubmit — the editor is never left wedged', () => {
    // The regression that loses the most work: `isLoading` stayed true when the
    // PDF build threw, disabling Submit AND Save draft behind a full-page
    // overlay. The only way out was a reload, which discards every annotation.
    //
    // The overrides are FACTORIES, not pre-built objects: a table of `vi.fn()`s
    // is constructed once at collection time and then blanked by
    // `restoreAllMocks()` after the first test, which quietly turned these cases
    // into all-succeeding runs that asserted nothing.
    it.each([
        [
            'the PDF build fails',
            () => ({ buildAnnotatedPdf: vi.fn().mockRejectedValue(new Error('canvas is gone')) }),
            'canvas is gone.',
        ],
        [
            'the upload fails',
            () => ({ uploadEvaluatedPdf: vi.fn().mockRejectedValue(new Error('network down')) }),
            'network down.',
        ],
        [
            'the upload returns no id',
            () => ({ uploadEvaluatedPdf: vi.fn().mockResolvedValue(undefined) }),
            UPLOAD_FAILED_MESSAGE,
        ],
        [
            'saving the marks fails',
            () => ({ submitMarks: vi.fn().mockRejectedValue(new Error('500')) }),
            '500.',
        ],
    ])('settles the busy flags when %s', async (_label, makeOverrides, expectedReason) => {
        const h = harness(makeOverrides());

        const outcome = await runEvaluationSubmit(h.deps);

        // Assert the reason too, so a case can never pass by failing somewhere else.
        expect(outcome).toMatchObject({ status: 'failed', reason: expectedReason });
        expect(h.stages.at(-1)).toBe('settled');
        expect(h.stages.filter((stage) => stage === 'settled')).toHaveLength(1);
    });

    it('settles exactly once on success too', async () => {
        const h = harness();

        await runEvaluationSubmit(h.deps);

        expect(h.stages.filter((stage) => stage === 'settled')).toHaveLength(1);
    });

    it("still settles when the caller's own stage handler throws", async () => {
        const stages: EvaluationSubmitStage[] = [];
        const h = harness({
            onStage: (stage) => {
                stages.push(stage);
                if (stage === 'uploading') throw new Error('a bad setState');
            },
        });

        const outcome = await runEvaluationSubmit(h.deps);

        expect(outcome.status).toBe('failed');
        expect(stages).toContain('settled');
    });
});

describe('runEvaluationSubmit — a failed upload is never silent', () => {
    it('reports a failure instead of skipping the submit when no file id comes back', async () => {
        const h = harness({ uploadEvaluatedPdf: vi.fn().mockResolvedValue(undefined) });

        const outcome = await runEvaluationSubmit(h.deps);

        expect(outcome).toEqual({
            status: 'failed',
            reason: UPLOAD_FAILED_MESSAGE,
            workRescued: true,
        });
        // The old code fell through the `if (evaluatedFileId)` with no else here.
        expect(h.submitMarks).not.toHaveBeenCalled();
        expect(h.releaseResult).not.toHaveBeenCalled();
    });

    it('treats an empty-string file id as a failure too', async () => {
        const h = harness({ uploadEvaluatedPdf: vi.fn().mockResolvedValue('') });

        const outcome = await runEvaluationSubmit(h.deps);

        expect(outcome.status).toBe('failed');
        expect(h.submitMarks).not.toHaveBeenCalled();
    });
});

describe('runEvaluationSubmit — the marking survives a failure', () => {
    it('writes the work to a draft before giving up', async () => {
        const h = harness({ submitMarks: vi.fn().mockRejectedValue(new Error('gateway timeout')) });

        const outcome = await runEvaluationSubmit(h.deps);

        expect(h.rescueDraft).toHaveBeenCalledOnce();
        expect(outcome).toEqual({
            status: 'failed',
            reason: 'gateway timeout.',
            workRescued: true,
        });
    });

    it('reports workRescued: false when the rescue itself fails, without throwing', async () => {
        const h = harness({
            submitMarks: vi.fn().mockRejectedValue(new Error('gateway timeout')),
            rescueDraft: vi.fn().mockRejectedValue(new Error('draft endpoint down')),
        });

        const outcome = await runEvaluationSubmit(h.deps);

        // The caller must be told the truth so it can say "still on screen" rather
        // than promising a draft that does not exist.
        expect(outcome).toEqual({
            status: 'failed',
            reason: 'gateway timeout.',
            workRescued: false,
        });
    });

    it('handles having nowhere to save (the standalone free tool)', async () => {
        const h = harness({
            submitMarks: vi.fn().mockRejectedValue(new Error('gateway timeout')),
            rescueDraft: undefined,
        });

        const outcome = await runEvaluationSubmit(h.deps);

        expect(outcome).toEqual({
            status: 'failed',
            reason: 'gateway timeout.',
            workRescued: false,
        });
        expect(h.stages.at(-1)).toBe('settled');
    });
});

describe('runEvaluationSubmit — a saved evaluation is never called lost', () => {
    it('stays submitted when releasing the result fails', async () => {
        const h = harness({
            releaseResult: vi.fn().mockRejectedValue(new Error('release failed')),
        });

        const outcome = await runEvaluationSubmit(h.deps);

        // The marks ARE on the server; a release problem must not read as data loss.
        expect(outcome).toEqual({ status: 'submitted' });
        expect(h.stages.at(-1)).toBe('settled');
    });

    it('never writes a rescue draft over a copy the backend has already graded', async () => {
        const h = harness({
            releaseResult: vi.fn().mockRejectedValue(new Error('release failed')),
        });

        await runEvaluationSubmit(h.deps);

        expect(h.rescueDraft).not.toHaveBeenCalled();
    });
});

describe('runEvaluationSubmit — the failure reason is presentable', () => {
    it('terminates the sentence so it can be spliced into a toast', async () => {
        const h = harness({
            buildAnnotatedPdf: vi
                .fn()
                .mockRejectedValue(new Error('Request failed with status code 502')),
        });

        const outcome = await runEvaluationSubmit(h.deps);

        expect(outcome).toMatchObject({ reason: 'Request failed with status code 502.' });
    });

    it('keeps punctuation that is already there', async () => {
        const h = harness({ uploadEvaluatedPdf: vi.fn().mockResolvedValue(null) });

        const outcome = await runEvaluationSubmit(h.deps);

        expect(outcome).toMatchObject({ reason: UPLOAD_FAILED_MESSAGE });
    });

    it.each([
        ['a thrown non-Error', 'just a string'],
        ['an Error with no message', new Error('')],
    ])('falls back to a usable message for %s', async (_label, thrown) => {
        const h = harness({ buildAnnotatedPdf: vi.fn().mockRejectedValue(thrown) });

        const outcome = await runEvaluationSubmit(h.deps);

        expect(outcome).toMatchObject({ status: 'failed', reason: UNKNOWN_FAILURE_MESSAGE });
    });
});
