import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

interface TestCaseResult {
    id?: string;
    label?: string;
    passed?: boolean;
    visible?: boolean;
}

interface Props {
    /** Raw coding response JSON string (question_wise_marks.response_json). */
    studentResponse: unknown;
    /** Raw coding question config JSON string (auto_evaluation_json / correct_options). */
    correctOptions: unknown;
}

function safeParse(value: unknown): Record<string, unknown> | null {
    if (!value) return null;
    if (typeof value === 'object') return value as Record<string, unknown>;
    if (typeof value === 'string') {
        try {
            return JSON.parse(value);
        } catch {
            return null;
        }
    }
    return null;
}

/**
 * Renders a student's coding-question submission for the admin drill-down:
 * verdict, test-cases-passed breakdown (hidden vs sample — grading is on the
 * hidden set), a pass-rate bar, per-test results, runtime metrics and source.
 */
export function CodingAnswerReview({ studentResponse, correctOptions }: Props) {
    const { t } = useTranslation('manageStudentsCodingAnswerReview');

    const r = useMemo(() => {
        const root = safeParse(studentResponse);
        return (root?.responseData as Record<string, unknown> | undefined) ?? {};
    }, [studentResponse]);

    const tests = (r.testCaseResults as TestCaseResult[] | undefined) ?? [];

    const hiddenTests = tests.filter((tc) => tc.visible === false);
    const sampleTests = tests.filter((tc) => tc.visible !== false);
    const gradedTests = hiddenTests.length > 0 ? hiddenTests : sampleTests;
    const gradedPassed = gradedTests.filter((tc) => tc.passed).length;
    const gradedTotal = gradedTests.length;
    const gradedLabel =
        hiddenTests.length > 0
            ? t('testCases.gradedSuffixHidden')
            : t('testCases.gradedSuffixSample');
    const samplePassed = sampleTests.filter((tc) => tc.passed).length;
    const pct = gradedTotal > 0 ? Math.round((gradedPassed / gradedTotal) * 100) : 0;

    const verdict = (r.verdict as string) || '—';
    // Known verdict enum (see submissions-api.ts `Verdict`); fall back to the
    // raw value for anything unrecognized rather than swallowing it.
    const verdictLabels: Record<string, string> = {
        ACCEPTED: t('verdict.accepted'),
        PARTIAL: t('verdict.partial'),
        REJECTED: t('verdict.rejected'),
        ERROR: t('verdict.error'),
        TIMED_OUT: t('verdict.timedOut'),
    };
    const verdictLabel = verdict === '—' ? verdict : (verdictLabels[verdict] ?? verdict);
    const score = typeof r.score === 'number' ? (r.score as number) : null;
    const language = r.language as string | undefined;
    const pasteAttempts = (r.pasteAttemptCount as number | undefined) ?? 0;
    const sourceCode = r.sourceCode as string | undefined;

    const verdictColor =
        verdict === 'ACCEPTED'
            ? 'text-success-600'
            : verdict === 'PARTIAL'
              ? 'text-warning-600'
              : 'text-danger-600';
    const barColor =
        pct >= 100 ? 'bg-success-500' : pct > 0 ? 'bg-warning-500' : 'bg-danger-500';

    // Measured-vs-allowed runtime metrics.
    const measuredTimeMs = typeof r.totalTimeMs === 'number' ? (r.totalTimeMs as number) : null;
    const measuredMemoryKb = typeof r.peakMemoryKb === 'number' ? (r.peakMemoryKb as number) : null;
    const limits = safeParse(correctOptions)?.data as { perRunLimits?: Record<string, number> } | undefined;
    const allowedTimeMs =
        typeof limits?.perRunLimits?.cpuSeconds === 'number'
            ? limits.perRunLimits.cpuSeconds * 1000
            : null;
    const allowedMemoryKb =
        typeof limits?.perRunLimits?.memoryKb === 'number' ? limits.perRunLimits.memoryKb : null;
    const showRuntime =
        measuredTimeMs !== null ||
        measuredMemoryKb !== null ||
        allowedTimeMs !== null ||
        allowedMemoryKb !== null;

    // Older attempts may predate per-test-case capture: their response_json has no
    // testCaseResults (and sometimes no verdict/score at all). Degrade gracefully
    // rather than rendering an empty block or a lone dash.
    const hasVerdict = typeof r.verdict === 'string' && (r.verdict as string).length > 0;
    const hasAnyData =
        hasVerdict || tests.length > 0 || score !== null || Boolean(sourceCode) || showRuntime;
    if (!hasAnyData) {
        return (
            <p className="text-caption text-neutral-400">
                {t('empty.noData')}
            </p>
        );
    }

    return (
        <div className="flex w-full flex-col gap-3 text-body">
            <div className="flex flex-wrap items-center gap-2">
                <span className={`font-semibold ${verdictColor}`}>{verdictLabel}</span>
                {score !== null && (
                    <span className="text-neutral-500">
                        · {t('score.points', { score: score.toFixed(2) })}
                    </span>
                )}
                {language && (
                    <span className="rounded-sm bg-neutral-100 px-1.5 py-0.5 text-caption">
                        {language}
                    </span>
                )}
                {pasteAttempts > 0 && (
                    <span className="rounded-sm bg-warning-100 px-1.5 py-0.5 text-caption text-warning-700">
                        {t('pasteAttempts', { count: pasteAttempts })}
                    </span>
                )}
            </div>

            {gradedTotal > 0 && (
                <div className="flex flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2 text-caption">
                        <span className="font-semibold">{t('testCases.passedLabel')}</span>
                        <span>
                            {gradedPassed}/{gradedTotal}
                        </span>
                        <span className="text-neutral-400">({gradedLabel})</span>
                        <span className="text-neutral-400">{pct}%</span>
                        {hiddenTests.length > 0 && sampleTests.length > 0 && (
                            <span className="text-neutral-400">
                                ·{' '}
                                {t('testCases.sampleBreakdown', {
                                    passed: samplePassed,
                                    total: sampleTests.length,
                                })}
                            </span>
                        )}
                    </div>
                    <div className="h-1.5 w-40 overflow-hidden rounded-full bg-neutral-100">
                        {/* Dynamic pass-rate width — cannot be a static token. */}
                        <div className={`h-full ${barColor}`} style={{ width: `${pct}%` }} />
                    </div>
                </div>
            )}

            {showRuntime && (
                <div className="flex flex-wrap gap-4 text-caption text-neutral-500">
                    <span>
                        <span className="font-semibold">{t('runtime.timeLabel')}</span>{' '}
                        {measuredTimeMs !== null
                            ? t('runtime.timeValue', { value: measuredTimeMs })
                            : '—'}
                        {allowedTimeMs !== null &&
                            ` ${t('runtime.timeAllowed', { value: allowedTimeMs })}`}
                    </span>
                    <span>
                        <span className="font-semibold">{t('runtime.memoryLabel')}</span>{' '}
                        {measuredMemoryKb !== null
                            ? t('runtime.memoryValue', { value: measuredMemoryKb })
                            : '—'}
                        {allowedMemoryKb !== null &&
                            ` ${t('runtime.memoryAllowed', { value: allowedMemoryKb })}`}
                    </span>
                </div>
            )}

            {tests.length > 0 && (
                <div className="flex flex-col gap-1">
                    {tests.map((testCase, i) => (
                        <div key={testCase.id || i} className="flex items-center gap-2 text-caption">
                            <span
                                className={testCase.passed ? 'text-success-600' : 'text-danger-600'}
                            >
                                {testCase.passed ? '✓' : '✗'}
                            </span>
                            <span>
                                {testCase.label || t('testCases.fallbackLabel', { number: i + 1 })}
                            </span>
                            {testCase.visible === false && (
                                <span className="text-neutral-400">{t('testCases.hiddenTag')}</span>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {sourceCode && (
                <details>
                    <summary className="cursor-pointer text-caption text-primary-500">
                        {t('sourceCode.toggleLabel')}
                    </summary>
                    <pre className="mt-1 max-h-64 overflow-auto rounded-md bg-neutral-50 p-2 text-caption">
                        {sourceCode}
                    </pre>
                </details>
            )}
        </div>
    );
}
