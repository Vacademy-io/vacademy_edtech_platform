import { useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { toast } from 'sonner';
import { DownloadSimple, FileText } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { ReportBlock, StatTile } from '@/components/common/report-visuals/blocks';
import { DonutChart, HorizontalBars, PeriodChart } from '@/components/common/report-visuals/charts';
import { exportReportPdf, safeFileName } from '@/components/common/report-visuals/export-pdf';
import { REPORT_COLORS, minutesLabel, pct, scoreColor } from '@/components/common/report-visuals/palette';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { resolveInstituteLogoUrl } from '@/routes/study-library/reports/-components/live/-utils/instituteLogo';
import type {
    LearnerLiveClass,
    LearnerLiveSessionsResponse,
} from '@/services/learner-live-sessions';
import {
    ReportBand,
    ReportPage,
    ReportSectionPicker,
    type ReportSectionMeta,
} from '../student-reports/report-pages';

const round1 = (v: number) => Math.round(v * 10) / 10;

/** The tab summary worked out again for a subset of the classes, the same way the server does. */
export const summarizeClasses = (
    base: LearnerLiveSessionsResponse,
    classes: LearnerLiveClass[]
): LearnerLiveSessionsResponse => {
    const count = (s: LearnerLiveClass['attendance_status']) =>
        classes.filter((c) => c.attendance_status === s).length;
    const scores = classes.flatMap((c) => (c.concentration_score != null ? [c.concentration_score] : []));
    const minutes = classes.flatMap((c) => (c.duration_minutes != null ? [c.duration_minutes] : []));
    const present = count('PRESENT');
    return {
        ...base,
        total_classes: classes.length,
        present_count: present,
        absent_count: count('ABSENT'),
        unmarked_count: count('UNMARKED'),
        attendance_percentage: classes.length === 0 ? 0 : round1((present * 100) / classes.length),
        avg_concentration_score:
            scores.length === 0 ? null : round1(scores.reduce((s, v) => s + v, 0) / scores.length),
        scored_classes: scores.length,
        avg_duration_minutes:
            minutes.length === 0 ? null : round1(minutes.reduce((s, v) => s + v, 0) / minutes.length),
        classes,
    };
};

export const LIVE_REPORT_SECTIONS = [
    'SUMMARY',
    'ATTENDANCE',
    'SUBJECTS',
    'CONCENTRATION',
    'TIME',
    'CLASSES',
] as const;
export type LiveReportSection = (typeof LIVE_REPORT_SECTIONS)[number];

const SECTION_META: Record<LiveReportSection, ReportSectionMeta> = {
    SUMMARY: { label: 'Summary', description: 'Classes, attendance, concentration and time in class.' },
    ATTENDANCE: { label: 'Attendance split', description: 'Present, absent and not marked.' },
    SUBJECTS: { label: 'By subject', description: 'Attendance in each subject.' },
    CONCENTRATION: { label: 'Concentration by class', description: 'Score out of 100 for every class.' },
    TIME: { label: 'Time in class', description: 'Minutes in every class.' },
    CLASSES: { label: 'Class list', description: 'Every class with its status, time and score.' },
};

const PAGES: LiveReportSection[][] = [
    ['SUMMARY', 'ATTENDANCE', 'SUBJECTS'],
    ['CONCENTRATION', 'TIME'],
];
const CLASS_ROWS_PER_PAGE = 22;

const STATUS_TEXT: Record<LearnerLiveClass['attendance_status'], { label: string; color: string }> = {
    PRESENT: { label: 'Present', color: REPORT_COLORS.good },
    ABSENT: { label: 'Absent', color: REPORT_COLORS.bad },
    UNMARKED: { label: 'Not marked', color: REPORT_COLORS.muted },
};

const day = (iso: string) => {
    const d = parseISO(iso);
    return Number.isNaN(d.getTime()) ? iso : format(d, 'd MMM yyyy');
};

/** Printable live sessions report for one learner: the picked sections on A4 pages. */
const LiveSessionsReportDocument = ({
    summary,
    brand,
    learnerName,
    instituteName,
    logoUrl,
    range,
    sections,
}: {
    summary: LearnerLiveSessionsResponse;
    brand: string;
    learnerName: string;
    instituteName: string;
    logoUrl?: string | null;
    range: { start: string; end: string };
    sections: LiveReportSection[];
}) => {
    const periodLabel = range.start === range.end ? day(range.start) : `${day(range.start)} – ${day(range.end)}`;
    const footer = `${learnerName} · ${periodLabel}`;
    const oldestFirst = [...summary.classes].reverse();
    const band = (
        <ReportBand
            brand={brand}
            instituteName={instituteName}
            logoUrl={logoUrl}
            subtitle={`Live class report · ${periodLabel}`}
            learnerName={learnerName}
        />
    );

    const subjects = (() => {
        const by = new Map<string, { total: number; present: number }>();
        for (const c of summary.classes) {
            const key = c.subject?.trim() || 'No subject';
            const b = by.get(key) ?? { total: 0, present: 0 };
            b.total += 1;
            if (c.attendance_status === 'PRESENT') b.present += 1;
            by.set(key, b);
        }
        return [...by.entries()].sort((a, b) => b[1].total - a[1].total);
    })();

    const point = (c: LearnerLiveClass, value: number | null, display?: string) => ({
        key: `${c.schedule_id}:${c.session_id}`,
        label: format(parseISO(c.meeting_date), 'd MMM'),
        title: `${c.title || 'Live class'} · ${day(c.meeting_date)}`,
        value,
        display,
    });

    const blocks: Record<Exclude<LiveReportSection, 'CLASSES'>, ReactNode> = {
        SUMMARY: (
            <div className="grid grid-cols-4 gap-3">
                <StatTile value={summary.total_classes} label="Classes" />
                <StatTile
                    value={pct(summary.attendance_percentage)}
                    label={`Attended, ${summary.present_count} of ${summary.total_classes}`}
                    color={scoreColor(summary.attendance_percentage)}
                />
                <StatTile
                    value={summary.avg_concentration_score != null ? `${Math.round(summary.avg_concentration_score)}/100` : '—'}
                    label="Average concentration"
                    color={brand}
                />
                <StatTile value={minutesLabel(summary.avg_duration_minutes)} label="Average time in class" />
            </div>
        ),
        ATTENDANCE: (
            <ReportBlock brand={brand} tag="Attendance" title={`${pct(summary.attendance_percentage)} of classes attended`}>
                <DonutChart
                    animate={false}
                    centerValue={pct(summary.attendance_percentage)}
                    centerLabel="attended"
                    data={[
                        { label: 'Present', value: summary.present_count, color: REPORT_COLORS.good },
                        { label: 'Absent', value: summary.absent_count, color: REPORT_COLORS.bad },
                        { label: 'Not marked', value: summary.unmarked_count, color: REPORT_COLORS.neutral },
                    ]}
                />
            </ReportBlock>
        ),
        SUBJECTS: (
            <ReportBlock brand={brand} tag="By subject" title="Attendance in each subject">
                <HorizontalBars
                    color={brand}
                    rows={subjects.map(([subject, b]) => {
                        const value = b.total ? round1((b.present * 100) / b.total) : null;
                        return {
                            key: subject,
                            label: subject,
                            value,
                            display: pct(value),
                            sub: `${b.present} of ${b.total} attended`,
                            color: scoreColor(value),
                        };
                    })}
                />
            </ReportBlock>
        ),
        CONCENTRATION: (
            <ReportBlock
                brand={brand}
                tag="Concentration"
                title={
                    summary.avg_concentration_score != null
                        ? `${Math.round(summary.avg_concentration_score)}/100 on average`
                        : 'No classes to score yet'
                }
            >
                <PeriodChart
                    kind="line"
                    animate={false}
                    height={200}
                    brand={brand}
                    valueLabel="Concentration"
                    max={100}
                    data={oldestFirst.map((c) => point(c, c.concentration_score))}
                />
            </ReportBlock>
        ),
        TIME: (
            <ReportBlock
                brand={brand}
                tag="Time in class"
                title={
                    summary.avg_duration_minutes != null
                        ? `${minutesLabel(summary.avg_duration_minutes)} a class on average`
                        : 'No time recorded yet'
                }
            >
                <PeriodChart
                    animate={false}
                    height={200}
                    brand={brand}
                    valueLabel="Minutes"
                    data={oldestFirst.map((c) =>
                        point(c, c.duration_minutes, c.duration_minutes != null ? minutesLabel(c.duration_minutes) : '—')
                    )}
                />
            </ReportBlock>
        ),
    };

    const pages = PAGES.map((page) => page.filter((s) => sections.includes(s))).filter((p) => p.length > 0);
    const classPages: LearnerLiveClass[][] = [];
    if (sections.includes('CLASSES')) {
        for (let i = 0; i < summary.classes.length; i += CLASS_ROWS_PER_PAGE) {
            classPages.push(summary.classes.slice(i, i + CLASS_ROWS_PER_PAGE));
        }
    }

    return (
        <div className="flex flex-col gap-6 bg-neutral-100 p-6">
            {pages.map((page) => (
                <ReportPage key={page.join()} footer={footer}>
                    {band}
                    <div className="flex flex-col gap-4 px-10 pt-6">
                        {page.map((s) => (
                            <div key={s}>{blocks[s as Exclude<LiveReportSection, 'CLASSES'>]}</div>
                        ))}
                    </div>
                </ReportPage>
            ))}
            {classPages.map((rows, i) => (
                <ReportPage key={`classes-${i}`} footer={footer}>
                    {band}
                    <div className="flex flex-col gap-3 px-10 pt-6">
                        <ReportBlock
                            brand={brand}
                            tag="Classes"
                            title={
                                classPages.length > 1
                                    ? `${summary.total_classes} classes, page ${i + 1} of ${classPages.length}`
                                    : `${summary.total_classes} class${summary.total_classes === 1 ? '' : 'es'}`
                            }
                        >
                            <table className="w-full text-left text-xs">
                                <thead>
                                    <tr className="border-b border-neutral-200 text-neutral-500">
                                        <th className="py-1.5 pr-2 font-medium">Date</th>
                                        <th className="py-1.5 pr-2 font-medium">Class</th>
                                        <th className="py-1.5 pr-2 font-medium">Status</th>
                                        <th className="py-1.5 pr-2 text-right font-medium">Time</th>
                                        <th className="py-1.5 text-right font-medium">Concentration</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {rows.map((c) => (
                                        <tr key={`${c.schedule_id}:${c.session_id}`} className="border-b border-neutral-100">
                                            <td className="whitespace-nowrap py-1.5 pr-2 text-neutral-600">
                                                {day(c.meeting_date)}
                                            </td>
                                            <td className="py-1.5 pr-2 text-neutral-800">
                                                {c.title || 'Live class'}
                                                {c.subject ? <span className="text-neutral-500"> · {c.subject}</span> : null}
                                            </td>
                                            <td
                                                className="whitespace-nowrap py-1.5 pr-2 font-semibold"
                                                style={{ color: STATUS_TEXT[c.attendance_status]?.color }}
                                            >
                                                {STATUS_TEXT[c.attendance_status]?.label ?? 'Not marked'}
                                            </td>
                                            <td className="whitespace-nowrap py-1.5 pr-2 text-right text-neutral-700">
                                                {c.duration_minutes != null ? minutesLabel(c.duration_minutes) : '—'}
                                            </td>
                                            <td className="whitespace-nowrap py-1.5 text-right text-neutral-700">
                                                {c.concentration_score != null ? `${c.concentration_score}/100` : '—'}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </ReportBlock>
                    </div>
                </ReportPage>
            ))}
        </div>
    );
};

/** "Generate report" on the Live Sessions tab: pick sections, preview and download a PDF. */
export const LiveSessionsReportDialog = ({
    summary,
    brand,
    learnerName,
    range,
    disabled,
}: {
    summary: LearnerLiveSessionsResponse | undefined;
    brand: string;
    learnerName?: string | null;
    range: { start: string; end: string } | null;
    disabled?: boolean;
}) => {
    const [open, setOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [sections, setSections] = useState<LiveReportSection[]>([...LIVE_REPORT_SECTIONS]);
    const ref = useRef<HTMLDivElement>(null);
    const { instituteDetails } = useInstituteDetailsStore();
    const logo = useQuery({
        queryKey: ['INSTITUTE_LOGO_URL', instituteDetails?.institute_logo_file_id],
        queryFn: () => resolveInstituteLogoUrl(instituteDetails?.institute_logo_file_id),
        enabled: open,
        staleTime: 30 * 60_000,
    });
    const name = learnerName || 'Learner';

    const download = async () => {
        if (!ref.current || !range) return;
        setSaving(true);
        try {
            await exportReportPdf(ref.current, `${safeFileName(name)}-live-classes-${range.start}`);
        } catch (e) {
            console.error(e);
            toast.error('Could not create the PDF');
        } finally {
            setSaving(false);
        }
    };

    return (
        <MyDialog
            open={open}
            onOpenChange={setOpen}
            heading={`Live class report: ${name}`}
            dialogWidth="w-full max-w-[1140px]"
            trigger={
                <MyButton
                    scale="small"
                    disabled={disabled || !summary || !range || summary.total_classes === 0}
                >
                    <FileText className="size-3.5" />
                    Generate report
                </MyButton>
            }
            footer={
                <MyButton onClick={download} disabled={saving || sections.length === 0}>
                    <DownloadSimple className="size-4" />
                    {saving ? 'Preparing PDF…' : 'Download PDF'}
                </MyButton>
            }
        >
            {summary && range && (
                <div className="flex flex-col gap-4 lg:flex-row">
                    <div className="lg:w-64 lg:shrink-0">
                        <ReportSectionPicker
                            order={LIVE_REPORT_SECTIONS}
                            meta={SECTION_META}
                            selected={sections}
                            onChange={setSections}
                        />
                    </div>
                    <div ref={ref} className="max-h-[70vh] flex-1 overflow-auto rounded-md">
                        {sections.length > 0 ? (
                            <LiveSessionsReportDocument
                                summary={summary}
                                brand={brand}
                                learnerName={name}
                                instituteName={instituteDetails?.institute_name ?? ''}
                                logoUrl={logo.data}
                                range={range}
                                sections={sections}
                            />
                        ) : (
                            <p className="py-16 text-center text-sm text-neutral-500">
                                Pick at least one section.
                            </p>
                        )}
                    </div>
                </div>
            )}
        </MyDialog>
    );
};
