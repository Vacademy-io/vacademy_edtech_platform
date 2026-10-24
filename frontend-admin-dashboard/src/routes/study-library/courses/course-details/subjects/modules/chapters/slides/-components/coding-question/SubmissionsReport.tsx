import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, X, AlertCircle, ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import i18n from '@/i18n';
import {
    listSubmissionsForSlide,
    getSubmissionDetail,
    type AdminSubmissionDetail,
    type AdminSubmissionSummary,
    type Verdict,
} from './submissions-api';

interface Props {
    slideId: string;
}

const verdictStyles: Record<Verdict, string> = {
    ACCEPTED: 'bg-green-100 text-green-700 border-green-200',
    PARTIAL: 'bg-amber-100 text-amber-700 border-amber-200',
    REJECTED: 'bg-red-100 text-red-700 border-red-200',
    ERROR: 'bg-red-100 text-red-700 border-red-200',
    TIMED_OUT: 'bg-red-100 text-red-700 border-red-200',
};

function fmtDate(v: string | number): string {
    const n = typeof v === 'number' ? v : Date.parse(v);
    if (!Number.isFinite(n)) return String(v);
    return new Date(n).toLocaleString(i18n.language);
}

function VerdictIcon({ verdict }: { verdict: Verdict }) {
    if (verdict === 'ACCEPTED') return <Check className="size-3" />;
    if (verdict === 'PARTIAL') return <AlertCircle className="size-3" />;
    return <X className="size-3" />;
}

export function SubmissionsReport({ slideId }: Props) {
    const { t } = useTranslation('studyLibrarySubmissionsReport');
    const [rows, setRows] = useState<AdminSubmissionSummary[]>([]);
    const [page, setPage] = useState(0);
    const [totalPages, setTotalPages] = useState(0);
    const [totalElements, setTotalElements] = useState(0);
    const [loading, setLoading] = useState(false);
    const [learnerFilter, setLearnerFilter] = useState('');
    const [openId, setOpenId] = useState<string | null>(null);
    const [details, setDetails] = useState<Record<string, AdminSubmissionDetail>>({});
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await listSubmissionsForSlide(slideId, {
                page,
                size: 20,
                learnerId: learnerFilter.trim() || undefined,
            });
            setRows(res.content ?? []);
            setTotalPages(res.totalPages ?? 0);
            setTotalElements(res.totalElements ?? 0);
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
            setRows([]);
        } finally {
            setLoading(false);
        }
    }, [slideId, page, learnerFilter]);

    useEffect(() => {
        load();
    }, [load]);

    const toggleOpen = (id: string) => {
        if (openId === id) {
            setOpenId(null);
            return;
        }
        setOpenId(id);
        if (!details[id]) {
            getSubmissionDetail(id).then((d) => setDetails((prev) => ({ ...prev, [id]: d })));
        }
    };

    // Per-learner aggregation: count + best score, computed from the current page.
    const stats = useMemo(() => {
        const map = new Map<string, { count: number; best: number; max: number }>();
        for (const r of rows) {
            const cur = map.get(r.learnerId) ?? { count: 0, best: 0, max: r.maxPoints };
            cur.count++;
            if (r.score > cur.best) cur.best = r.score;
            cur.max = r.maxPoints;
            map.set(r.learnerId, cur);
        }
        return map;
    }, [rows]);

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-[220px] flex-1">
                    <label className="block text-xs font-semibold text-muted-foreground">
                        {t('filterByLearnerId')}
                    </label>
                    <Input
                        value={learnerFilter}
                        onChange={(e) => {
                            setLearnerFilter(e.target.value);
                            setPage(0);
                        }}
                        placeholder={t('filterPlaceholder')}
                        className="h-8 text-xs"
                    />
                </div>
                <Button variant="outline" size="sm" onClick={() => load()} disabled={loading}>
                    <RefreshCw className={`mr-1 size-3 ${loading ? 'animate-spin' : ''}`} />
                    {t('refresh')}
                </Button>
                <div className="ml-auto text-xs text-muted-foreground">
                    {t('submissionCount', { count: totalElements })}{' '}
                    {t('acrossLearnerCount', { count: stats.size })} {t('thisPageSuffix')}
                </div>
            </div>

            {error && (
                <div className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700">
                    {error}
                </div>
            )}

            {!loading && rows.length === 0 && !error && (
                <div className="rounded border border-dashed p-6 text-center text-sm text-muted-foreground">
                    {t('noSubmissions')}
                </div>
            )}

            <div className="space-y-1">
                {rows.map((s) => {
                    const open = openId === s.id;
                    const detail = details[s.id];
                    const visible = open && detail ? detail : null;
                    return (
                        <div key={s.id} className="rounded border bg-white">
                            <button
                                type="button"
                                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-gray-50"
                                onClick={() => toggleOpen(s.id)}
                            >
                                {open ? (
                                    <ChevronDown className="size-3" />
                                ) : (
                                    <ChevronRight className="size-3" />
                                )}
                                <span
                                    className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 font-medium ${verdictStyles[s.verdict]}`}
                                >
                                    <VerdictIcon verdict={s.verdict} />
                                    {s.verdict}
                                </span>
                                <span className="font-mono text-[11px] text-gray-700">
                                    {s.learnerId.substring(0, 8)}…
                                </span>
                                <span className="font-medium">
                                    {s.score.toFixed(1)} / {s.maxPoints}
                                </span>
                                <span className="text-gray-500">
                                    {s.passedCount}/{s.totalCount} tests
                                </span>
                                <Badge variant="outline" className="text-[10px]">
                                    {s.language}
                                </Badge>
                                <span className="text-gray-500">{s.totalTimeMs} ms</span>
                                <span className="ml-auto text-gray-500">
                                    {fmtDate(s.submittedAt)}
                                </span>
                            </button>

                            {open && (
                                <div className="border-t p-3 text-xs">
                                    {!detail && (
                                        <div className="text-gray-500">{t('loadingEllipsis')}</div>
                                    )}
                                    {visible && (
                                        <>
                                            <div className="mb-2 grid grid-cols-2 gap-2 text-gray-600 md:grid-cols-4">
                                                <div>
                                                    <span className="font-semibold">
                                                        {t('learnerIdLabel')}
                                                    </span>{' '}
                                                    <span className="font-mono">
                                                        {visible.learnerId}
                                                    </span>
                                                </div>
                                                <div>
                                                    <span className="font-semibold">
                                                        {t('totalTimeLabel')}
                                                    </span>{' '}
                                                    {visible.totalTimeMs} ms
                                                </div>
                                                <div>
                                                    <span className="font-semibold">
                                                        {t('peakMemoryLabel')}
                                                    </span>{' '}
                                                    {visible.peakMemoryKb} KB
                                                </div>
                                                <div>
                                                    <span className="font-semibold">
                                                        {t('submittedLabel')}
                                                    </span>{' '}
                                                    {fmtDate(visible.submittedAt)}
                                                </div>
                                            </div>

                                            <div className="mb-2 space-y-1">
                                                {visible.results.map((r, i) => (
                                                    <div
                                                        key={r.id || i}
                                                        className={`rounded border px-2 py-1 ${
                                                            r.passed
                                                                ? 'border-green-200 bg-green-50'
                                                                : 'border-red-200 bg-red-50'
                                                        }`}
                                                    >
                                                        <div className="flex items-center gap-2">
                                                            {r.passed ? (
                                                                <Check className="size-3 text-green-600" />
                                                            ) : (
                                                                <X className="size-3 text-red-600" />
                                                            )}
                                                            <span className="font-medium">
                                                                {r.label ||
                                                                    t('testLabel', {
                                                                        index: i + 1,
                                                                    })}
                                                            </span>
                                                            <span className="text-gray-500">
                                                                {r.visible
                                                                    ? t('sampleTag')
                                                                    : t('hiddenTag')}
                                                            </span>
                                                            {r.timeMs != null && (
                                                                <span className="ml-auto text-gray-500">
                                                                    {r.timeMs} ms
                                                                </span>
                                                            )}
                                                        </div>
                                                        {(r.acceptedCount ?? 1) > 1 && (
                                                            <div className="mt-0.5 text-xs text-gray-500">
                                                                {t('acceptsOutputs', {
                                                                    count: r.acceptedCount,
                                                                })}{' '}
                                                                {r.matchedIndex != null &&
                                                                r.matchedIndex >= 0
                                                                    ? t('learnerMatched', {
                                                                          index:
                                                                              r.matchedIndex + 1,
                                                                      })
                                                                    : t('matchedNone')}
                                                            </div>
                                                        )}
                                                        {!r.passed && (
                                                            <div className="mt-1 grid grid-cols-2 gap-2">
                                                                <div>
                                                                    <div className="text-[10px] font-semibold uppercase text-gray-500">
                                                                        {t('theirOutputLabel')}
                                                                    </div>
                                                                    <pre className="overflow-auto rounded bg-white p-1 font-mono">
                                                                        {r.stdout ||
                                                                            t('emptyPlaceholder')}
                                                                    </pre>
                                                                </div>
                                                                <div>
                                                                    <div className="text-[10px] font-semibold uppercase text-gray-500">
                                                                        {t('expectedLabel')}
                                                                    </div>
                                                                    <pre className="overflow-auto rounded bg-white p-1 font-mono">
                                                                        {r.expected ||
                                                                            t('emptyPlaceholder')}
                                                                    </pre>
                                                                </div>
                                                            </div>
                                                        )}
                                                        {r.stderr && (
                                                            <pre className="mt-1 overflow-auto rounded bg-white p-1 font-mono text-red-700">
                                                                {r.stderr}
                                                            </pre>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>

                                            <details>
                                                <summary className="cursor-pointer text-gray-600">
                                                    {t('viewSubmittedCode', {
                                                        count: visible.sourceCode.length,
                                                    })}
                                                </summary>
                                                <pre className="mt-2 max-h-72 overflow-auto rounded bg-gray-900 p-3 text-[11px] text-green-300">
                                                    <code>{visible.sourceCode}</code>
                                                </pre>
                                            </details>
                                        </>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {totalPages > 1 && (
                <div className="flex items-center justify-end gap-2 text-xs">
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={page === 0 || loading}
                        onClick={() => setPage((p) => Math.max(0, p - 1))}
                    >
                        {t('prev')}
                    </Button>
                    <span className="text-muted-foreground">
                        {t('pageOf', { page: page + 1, totalPages })}
                    </span>
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={page >= totalPages - 1 || loading}
                        onClick={() => setPage((p) => p + 1)}
                    >
                        {t('next')}
                    </Button>
                </div>
            )}
        </div>
    );
}
