import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ChartBar, CircleNotch, DownloadSimple, WarningCircle } from '@phosphor-icons/react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { MyButton } from '@/components/design-system/button';
import {
    downloadTutorInsightsCsv,
    getTutorInsights,
    type TutorInsights,
    type TutorInsightsSheet,
} from '@/services/tutor';
import {
    getTerminology,
    getTerminologyPlural,
} from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

const ALL = '__all__';

const fmtScore = (v: number | null) =>
    v === null || v === undefined ? '—' : `${Math.round(v * 100)}%`;

// Activeness is 0-100 (camera opt-in); "—" when the learner never turned it on.
const fmtActiveness = (v: number | null | undefined, sessions?: number) =>
    v === null || v === undefined ? '—' : `${Math.round(v)}${sessions ? ` (${sessions})` : ''}`;

const activenessTone = (v: number | null | undefined) =>
    v === null || v === undefined
        ? 'text-neutral-400'
        : v >= 70
          ? 'text-success-700'
          : v >= 40
            ? 'text-warning-700'
            : 'text-danger-600';

const SHEETS: Array<{ key: TutorInsightsSheet; label: string }> = [
    { key: 'learners', label: 'Learners CSV' },
    { key: 'concepts', label: 'Concepts CSV' },
    { key: 'courses', label: 'Courses CSV' },
];

/**
 * What the AI teacher learned (design WP9): usage totals, the concepts
 * learners get wrong most (with the misconceptions the teacher recorded), a
 * per-learner table with the teacher's note, and — across the institute —
 * a per-course table. Read-only, with CSV export.
 *
 * With `packageId` it is one course's card (Tutor Mode tab); without, the
 * institute-wide card (Settings → Course settings) with a course filter.
 */
export const TutorInsightsCard: React.FC<{ packageId?: string }> = ({ packageId }) => {
    const { i18n } = useTranslation();
    const instituteWide = !packageId;
    const courseTerm = getTerminology(ContentTerms.Course, SystemTerms.Course);
    const coursesTerm = getTerminologyPlural(ContentTerms.Course, SystemTerms.Course);
    const [course, setCourse] = useState<string>(ALL);
    const [batch, setBatch] = useState<string>(ALL);
    const [days, setDays] = useState<number>(90);
    const [data, setData] = useState<TutorInsights | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [exporting, setExporting] = useState<TutorInsightsSheet | null>(null);

    const scope = useMemo(
        () => ({
            packageId: packageId ?? (course === ALL ? undefined : course),
            packageSessionId: batch === ALL ? undefined : batch,
            days,
        }),
        [packageId, course, batch, days]
    );

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);
        getTutorInsights(scope)
            .then((d) => {
                if (!cancelled) setData(d);
            })
            .catch((e: unknown) => {
                if (!cancelled)
                    setError(e instanceof Error ? e.message : 'Could not load insights');
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [scope]);

    const fmtWhen = (iso: string | null) => {
        if (!iso) return '—';
        const d = new Date(iso);
        return Number.isNaN(d.getTime())
            ? iso
            : d.toLocaleDateString(i18n.language, { day: 'numeric', month: 'short' });
    };

    const exportSheet = async (sheet: TutorInsightsSheet) => {
        setExporting(sheet);
        try {
            await downloadTutorInsightsCsv(sheet, scope);
        } catch (e: unknown) {
            toast.error(e instanceof Error ? e.message : 'Export failed');
        } finally {
            setExporting(null);
        }
    };

    const weakConcepts = useMemo(
        () =>
            (data?.concepts ?? []).filter(
                (c) => c.weak_learners > 0 || (c.avg_score !== null && c.avg_score < 0.5)
            ),
        [data]
    );
    const totals = data?.totals;
    // The course list is stable across filters: keep the first full list.
    const [courses, setCourses] = useState<TutorInsights['courses']>([]);
    useEffect(() => {
        if (instituteWide && course === ALL && batch === ALL && data) setCourses(data.courses);
    }, [instituteWide, course, batch, data]);

    return (
        <Card>
            <CardHeader className="pb-2">
                <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                    <ChartBar className="size-5 text-primary-500" />
                    {instituteWide
                        ? `What the AI teacher learned across ${coursesTerm.toLocaleLowerCase()}`
                        : 'What the AI teacher learned'}
                    {loading && <CircleNotch className="size-4 animate-spin text-neutral-400" />}
                    <span className="ms-auto flex flex-wrap items-center gap-2 text-sm font-normal">
                        {instituteWide && (
                            <Select
                                value={course}
                                onValueChange={(v) => {
                                    setCourse(v);
                                    setBatch(ALL);
                                }}
                            >
                                <SelectTrigger className="h-8 w-56">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value={ALL}>
                                        All {coursesTerm.toLocaleLowerCase()}
                                    </SelectItem>
                                    {courses.map((c) => (
                                        <SelectItem key={c.package_id} value={c.package_id}>
                                            {c.name} ({c.sessions})
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        )}
                        <Select value={batch} onValueChange={setBatch}>
                            <SelectTrigger className="h-8 w-56">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={ALL}>All batches</SelectItem>
                                {(data?.batches ?? []).map((b) => (
                                    <SelectItem
                                        key={b.package_session_id}
                                        value={b.package_session_id}
                                    >
                                        {instituteWide && course === ALL ? `${b.course} · ` : ''}
                                        {b.name} ({b.sessions})
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <Select
                            value={String(days)}
                            onValueChange={(v) => {
                                setDays(Number(v));
                                setBatch(ALL);
                            }}
                        >
                            <SelectTrigger className="h-8 w-32">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="7">Last 7 days</SelectItem>
                                <SelectItem value="30">Last 30 days</SelectItem>
                                <SelectItem value="90">Last 90 days</SelectItem>
                                <SelectItem value="365">Last year</SelectItem>
                            </SelectContent>
                        </Select>
                    </span>
                </CardTitle>
                <p className="text-sm text-neutral-500">
                    Every lesson records each answer, the concepts a learner struggled with, the
                    misconceptions the teacher heard, and the teacher&apos;s own note about the
                    learner. Use this to see where a {courseTerm.toLocaleLowerCase()} needs a better
                    explanation and which learners need a human.
                </p>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                    {SHEETS.filter((s) => instituteWide || s.key !== 'courses').map((s) => (
                        <MyButton
                            key={s.key}
                            type="button"
                            buttonType="secondary"
                            scale="small"
                            layoutVariant="default"
                            disabled={loading || exporting !== null}
                            onClick={() => void exportSheet(s.key)}
                        >
                            {exporting === s.key ? (
                                <CircleNotch className="size-4 animate-spin" />
                            ) : (
                                <DownloadSimple className="size-4" />
                            )}
                            {s.key === 'courses' ? `${coursesTerm} CSV` : s.label}
                        </MyButton>
                    ))}
                </div>
            </CardHeader>
            <CardContent className="space-y-5">
                {error && (
                    <p className="flex items-center gap-2 text-sm text-danger-600">
                        <WarningCircle className="size-4" /> {error}
                    </p>
                )}
                {totals && (
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                        {[
                            [coursesTerm, totals.courses],
                            ['Lessons', totals.sessions],
                            ['Learners', totals.learners],
                            ['Minutes', totals.minutes],
                            ['Voice lessons', totals.voice_sessions],
                            ['Left mid-way', totals.abandoned],
                            ['Avg activeness', fmtActiveness(totals.activeness)],
                        ]
                            .filter(([label]) => instituteWide || label !== coursesTerm)
                            .filter(
                                ([label]) =>
                                    label !== 'Avg activeness' ||
                                    (totals.activeness_sessions ?? 0) > 0
                            )
                            .map(([label, value]) => (
                                <div
                                    key={String(label)}
                                    className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2"
                                >
                                    <p className="text-xs uppercase tracking-wide text-neutral-500">
                                        {label}
                                    </p>
                                    <p className="text-xl font-semibold text-neutral-900">
                                        {value}
                                    </p>
                                </div>
                            ))}
                    </div>
                )}

                {instituteWide && (
                    <div>
                        <h4 className="mb-2 text-sm font-semibold text-neutral-800">
                            {coursesTerm}
                        </h4>
                        {!loading && (data?.courses.length ?? 0) === 0 && (
                            <p className="text-sm text-neutral-500">
                                No tutor lessons in this period.
                            </p>
                        )}
                        {(data?.courses.length ?? 0) > 0 && (
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="border-b border-neutral-200 text-xs uppercase tracking-wide text-neutral-500">
                                            <th className="py-2 pe-3 text-start">{courseTerm}</th>
                                            <th className="py-2 pe-3 text-end">Lessons</th>
                                            <th className="py-2 pe-3 text-end">Learners</th>
                                            <th className="py-2 pe-3 text-end">Minutes</th>
                                            <th className="py-2 pe-3 text-end">Answers</th>
                                            <th className="py-2 pe-3 text-end">Avg score</th>
                                            <th
                                                className="py-2 pe-3 text-end"
                                                title="Average activeness (0-100) in lessons where the learner turned the camera on; lessons counted in brackets"
                                            >
                                                Activeness
                                            </th>
                                            <th className="py-2 pe-3 text-end">Weak</th>
                                            <th className="py-2 pe-3 text-end">Last lesson</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {data?.courses.map((c) => (
                                            <tr
                                                key={c.package_id}
                                                className="border-b border-neutral-100"
                                            >
                                                <td className="py-2 pe-3 font-medium text-neutral-800">
                                                    <button
                                                        type="button"
                                                        className="text-start hover:text-primary-500"
                                                        onClick={() => {
                                                            setCourse(c.package_id);
                                                            setBatch(ALL);
                                                        }}
                                                    >
                                                        {c.name}
                                                    </button>
                                                </td>
                                                <td className="py-2 pe-3 text-end">{c.sessions}</td>
                                                <td className="py-2 pe-3 text-end">{c.learners}</td>
                                                <td className="py-2 pe-3 text-end">{c.minutes}</td>
                                                <td className="py-2 pe-3 text-end">{c.attempts}</td>
                                                <td className="py-2 pe-3 text-end">
                                                    {fmtScore(c.avg_score)}
                                                </td>
                                                <td
                                                    className={`py-2 pe-3 text-end ${activenessTone(c.activeness)}`}
                                                >
                                                    {fmtActiveness(
                                                        c.activeness,
                                                        c.activeness_sessions
                                                    )}
                                                </td>
                                                <td className="py-2 pe-3 text-end">
                                                    {c.weak_attempts > 0 ? (
                                                        <span className="text-warning-700">
                                                            {c.weak_attempts}
                                                        </span>
                                                    ) : (
                                                        <span className="text-neutral-400">0</span>
                                                    )}
                                                </td>
                                                <td className="py-2 pe-3 text-end text-neutral-600">
                                                    {fmtWhen(c.last_active)}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                )}

                <div>
                    <h4 className="mb-2 text-sm font-semibold text-neutral-800">
                        Concepts learners struggle with
                    </h4>
                    {!loading && weakConcepts.length === 0 && (
                        <p className="text-sm text-neutral-500">No weak spots recorded yet.</p>
                    )}
                    {weakConcepts.length > 0 && (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-neutral-200 text-xs uppercase tracking-wide text-neutral-500">
                                        <th className="py-2 pe-3 text-start">Concept</th>
                                        <th className="py-2 pe-3 text-start">
                                            {instituteWide
                                                ? `${courseTerm} · slide · board`
                                                : 'Slide · board'}
                                        </th>
                                        <th className="py-2 pe-3 text-end">Learners weak</th>
                                        <th className="py-2 pe-3 text-end">Cleared on revisit</th>
                                        <th className="py-2 pe-3 text-end">Avg score</th>
                                        <th className="py-2 pe-3 text-start">What they said</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {weakConcepts.map((c) => (
                                        <tr
                                            key={c.concept_id}
                                            className="border-b border-neutral-100 align-top"
                                        >
                                            <td className="py-2 pe-3 font-medium text-neutral-800">
                                                {c.concept}
                                            </td>
                                            <td className="py-2 pe-3 text-neutral-600">
                                                {instituteWide && (
                                                    <span className="text-neutral-800">
                                                        {c.course} ·{' '}
                                                    </span>
                                                )}
                                                {c.slide}
                                                <span className="text-neutral-400">
                                                    {' '}
                                                    · {c.topic}
                                                </span>
                                            </td>
                                            <td className="py-2 pe-3 text-end">
                                                <Badge
                                                    variant="outline"
                                                    className="border-warning-200 bg-warning-50 text-warning-700"
                                                >
                                                    {c.weak_learners} / {c.learners}
                                                </Badge>
                                            </td>
                                            <td className="py-2 pe-3 text-end text-neutral-700">
                                                {c.cleared_learners > 0 ? (
                                                    <span className="text-success-700">
                                                        {c.cleared_learners}
                                                    </span>
                                                ) : (
                                                    <span className="text-neutral-400">0</span>
                                                )}
                                            </td>
                                            <td className="py-2 pe-3 text-end text-neutral-700">
                                                {fmtScore(c.avg_score)}
                                            </td>
                                            <td className="py-2 pe-3 text-neutral-600">
                                                {c.misconceptions.length
                                                    ? c.misconceptions.join(' · ')
                                                    : '—'}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>

                <div>
                    <h4 className="mb-2 text-sm font-semibold text-neutral-800">Learners</h4>
                    {!loading && (data?.learners.length ?? 0) === 0 && (
                        <p className="text-sm text-neutral-500">No lessons in this period.</p>
                    )}
                    {(data?.learners.length ?? 0) > 0 && (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-neutral-200 text-xs uppercase tracking-wide text-neutral-500">
                                        <th className="py-2 pe-3 text-start">Learner</th>
                                        {instituteWide && (
                                            <th className="py-2 pe-3 text-end">{coursesTerm}</th>
                                        )}
                                        <th className="py-2 pe-3 text-end">Lessons</th>
                                        <th className="py-2 pe-3 text-end">Minutes</th>
                                        <th className="py-2 pe-3 text-end">Answers</th>
                                        <th className="py-2 pe-3 text-end">Avg score</th>
                                        <th
                                            className="py-2 pe-3 text-end"
                                            title="Average activeness (0-100) in lessons where the learner turned the camera on; lessons counted in brackets"
                                        >
                                            Activeness
                                        </th>
                                        <th className="py-2 pe-3 text-end">Weak</th>
                                        <th className="py-2 pe-3 text-end">Last lesson</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {data?.learners.map((l) => (
                                        <tr
                                            key={l.user_id}
                                            className="border-b border-neutral-100 align-top"
                                        >
                                            <td className="max-w-md py-2 pe-3">
                                                <p className="font-medium text-neutral-800">
                                                    {l.name || l.user_id.slice(0, 8)}
                                                </p>
                                                {l.note && (
                                                    <p
                                                        className="line-clamp-2 text-xs text-neutral-500"
                                                        title={l.note}
                                                    >
                                                        {l.note}
                                                    </p>
                                                )}
                                            </td>
                                            {instituteWide && (
                                                <td className="py-2 pe-3 text-end">{l.courses}</td>
                                            )}
                                            <td className="py-2 pe-3 text-end">{l.sessions}</td>
                                            <td className="py-2 pe-3 text-end">{l.minutes}</td>
                                            <td className="py-2 pe-3 text-end">{l.attempts}</td>
                                            <td className="py-2 pe-3 text-end">
                                                {fmtScore(l.avg_score)}
                                            </td>
                                            <td
                                                className={`py-2 pe-3 text-end ${activenessTone(l.activeness)}`}
                                            >
                                                {fmtActiveness(l.activeness, l.activeness_sessions)}
                                            </td>
                                            <td className="py-2 pe-3 text-end">
                                                {l.weak_attempts > 0 ? (
                                                    <span className="text-warning-700">
                                                        {l.weak_attempts}
                                                    </span>
                                                ) : (
                                                    <span className="text-neutral-400">0</span>
                                                )}
                                            </td>
                                            <td className="py-2 pe-3 text-end text-neutral-600">
                                                {fmtWhen(l.last_active)}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </CardContent>
        </Card>
    );
};
