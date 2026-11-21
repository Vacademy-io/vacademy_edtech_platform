/**
 * Orchestration for "Submit evaluation": flatten the annotations → upload the
 * evaluated sheet → save the marks → release the result.
 *
 * This deliberately lives OUTSIDE the editor component. `pdf-editor.tsx` opens
 * with `@ts-nocheck` + `/* eslint-disable *\/`, so neither the typechecker nor
 * the linter looks at it — and this is the one path where a faculty's finished
 * marking either reaches the server or is lost for good. It is kept here typed,
 * dependency-injected and unit-tested instead.
 *
 * The guarantees, in order of importance:
 *
 *  1. **Marking is never lost in silence.** Every failure comes back as
 *     `failed` with a reason to show, and the in-memory work is written to a
 *     draft first whenever there is somewhere to write it.
 *  2. **The caller's busy flags always unwind.** `onStage("settled")` fires
 *     exactly once on every path, so the editor can never be left stuck behind
 *     a loading overlay with both Submit and Save draft disabled — a state whose
 *     only escape is a reload, which discards every annotation on the sheet.
 *  3. **A submit that reached the backend is never reported as lost.** Once
 *     `submitMarks` resolves, the copy IS graded: nothing afterwards can
 *     downgrade the outcome, and no rescue draft is written over it.
 */

import i18next from 'i18next';

export type EvaluationSubmitStage =
    /** Flattening the annotations into a PDF. */
    | 'building'
    /** Uploading that PDF and saving the marks. */
    | 'uploading'
    /** Finished — success or failure. Always fires, exactly once. */
    | 'settled';

export type EvaluationSubmitOutcome =
    | { status: 'submitted' }
    | {
          status: 'failed';
          /** Sentence-terminated, safe to splice into a toast description. */
          reason: string;
          /** True when the marking was preserved as a draft. */
          workRescued: boolean;
      };

export interface EvaluationSubmitDeps {
    /** Flatten the evaluator's annotations onto the answer sheet. */
    buildAnnotatedPdf: () => Promise<Blob>;
    /** Upload it. Resolves to the new file id — or nothing, which is a failure. */
    uploadEvaluatedPdf: (pdf: Blob) => Promise<string | undefined | null>;
    /** Persist the marks. Once this resolves, the evaluation is saved. */
    submitMarks: (evaluatedFileId: string) => Promise<unknown>;
    /** Make the result visible to the learner. Best-effort; never fails a submit. */
    releaseResult: () => Promise<unknown>;
    /** Preserve the marking when the submit fails. Omit when there's nowhere to save. */
    rescueDraft?: () => Promise<unknown>;
    /** Drives the caller's spinners. */
    onStage: (stage: EvaluationSubmitStage) => void;
}

export const UPLOAD_FAILED_MESSAGE = i18next.t(
    'evaluationSubmitEvaluation:uploadFailedMessage'
);
export const UNKNOWN_FAILURE_MESSAGE = i18next.t(
    'evaluationSubmitEvaluation:unknownFailureMessage'
);

/** Readable reason for a toast, whatever was actually thrown. */
const describeFailure = (error: unknown): string => {
    const raw = error instanceof Error && error.message ? error.message.trim() : '';
    const message = raw || UNKNOWN_FAILURE_MESSAGE;
    return /[.!?]$/.test(message) ? message : `${message}.`;
};

/** Never let the rescue itself throw — a failed rescue must not mask the real failure. */
const rescueWork = async (rescueDraft?: () => Promise<unknown>): Promise<boolean> => {
    if (!rescueDraft) return false;
    try {
        await rescueDraft();
        return true;
    } catch (error) {
        console.error('Failed to preserve the evaluation as a draft:', error);
        return false;
    }
};

const attemptSubmit = async (deps: EvaluationSubmitDeps): Promise<EvaluationSubmitOutcome> => {
    try {
        deps.onStage('building');
        const annotatedPdf = await deps.buildAnnotatedPdf();

        deps.onStage('uploading');
        const evaluatedFileId = await deps.uploadEvaluatedPdf(annotatedPdf);
        // The annotated PDF IS the learner-facing artifact, so there is nothing to
        // submit without its id. This used to be a bare `if (evaluatedFileId)` with
        // no else: the submit was skipped in silence and the evaluator walked away
        // believing the copy had been graded.
        if (!evaluatedFileId) throw new Error(UPLOAD_FAILED_MESSAGE);

        await deps.submitMarks(evaluatedFileId);
    } catch (error) {
        console.error('Failed to submit evaluation:', error);
        return {
            status: 'failed',
            reason: describeFailure(error),
            workRescued: await rescueWork(deps.rescueDraft),
        };
    }

    // Everything below happens AFTER the marks are saved. It sits outside the try
    // above on purpose: that is what makes guarantee 3 structural rather than a
    // flag someone can forget to check — no later step can report this copy as
    // ungraded, and no rescue draft can be written over it.
    try {
        await deps.releaseResult();
    } catch (releaseError) {
        console.error("Evaluation saved, but the result couldn't be released:", releaseError);
    }

    return { status: 'submitted' };
};

export const runEvaluationSubmit = async (
    deps: EvaluationSubmitDeps
): Promise<EvaluationSubmitOutcome> => {
    try {
        return await attemptSubmit(deps);
    } finally {
        deps.onStage('settled');
    }
};
