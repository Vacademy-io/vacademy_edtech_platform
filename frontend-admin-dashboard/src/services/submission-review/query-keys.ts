export const submissionKeys = {
    outline: (attemptId: string) => ['SUBMISSION_REVIEW', attemptId] as const,
    card: (attemptId: string, sid: string, qid: string) => ['SUBMISSION_REVIEW_CARD', attemptId, sid, qid] as const,
    history: (attemptId: string, sid?: string, qid?: string) => ['SUBMISSION_REVIEW_HISTORY', attemptId, sid ?? null, qid ?? null] as const,
    paper: (assessmentId: string, sectionIdsCsv: string) => ['SUBMISSION_PAPER', assessmentId, sectionIdsCsv] as const,
    marking: (attemptId: string) => ['SUBMISSION_MARKING', attemptId] as const,
    summary: (assessmentId: string) => ['SUBMISSION_MARKING_SUMMARY', assessmentId] as const,
    releaseCheck: (assessmentId: string, idsKey: string) => ['SUBMISSION_RELEASE_CHECK', assessmentId, idsKey] as const,
};
/** After any write on one attempt. Resolves once the active queries have refetched. */
export const invalidateAttempt = (
    qc: import('@tanstack/react-query').QueryClient,
    attemptId: string,
    assessmentId?: string
): Promise<void> =>
    Promise.all([
        qc.invalidateQueries({ queryKey: ['SUBMISSION_REVIEW', attemptId] }),
        qc.invalidateQueries({ queryKey: ['SUBMISSION_REVIEW_CARD', attemptId] }),
        qc.invalidateQueries({ queryKey: ['SUBMISSION_REVIEW_HISTORY', attemptId] }),
        qc.invalidateQueries({ queryKey: ['SUBMISSION_MARKING', attemptId] }),
        assessmentId
            ? qc.invalidateQueries({ queryKey: ['SUBMISSION_MARKING_SUMMARY', assessmentId] })
            : undefined,
    ]).then(() => undefined);
