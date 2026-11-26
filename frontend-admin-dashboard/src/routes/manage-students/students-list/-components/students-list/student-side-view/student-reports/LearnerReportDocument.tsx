import { useRef, useState, type ReactNode } from 'react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { DownloadSimple, FileText, Quotes } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { exportReportPdf, safeFileName } from '@/components/common/report-visuals/export-pdf';
import { REPORT_COLORS, tint } from '@/components/common/report-visuals/palette';
import type { StudentReportSnapshot } from '@/services/student-report-snapshot';
import { buildLearnerReport, type LearnerReportModel } from './learner-report-model';
import {
    AttendanceBlock,
    LearnerHero,
    LearnerTiles,
    MistakesBlock,
    ProgressBlock,
    SubjectsBlock,
    ThinkingBlock,
    TopicsBlock,
    TrendBlock,
} from './LearnerReportBlocks';
import { ReportBand, ReportPage, ReportSectionPicker, type ReportSectionMeta } from './report-pages';

export const LEARNER_REPORT_SECTIONS = [
    'OVERVIEW',
    'SUBJECTS',
    'TREND',
    'TOPICS',
    'ATTENDANCE',
    'PROGRESS',
    'MISTAKES',
    'THINKING',
] as const;
export type LearnerReportSection = (typeof LEARNER_REPORT_SECTIONS)[number];

export const LEARNER_REPORT_SECTION_META: Record<LearnerReportSection, ReportSectionMeta> = {
    OVERVIEW: { label: 'Result and summary', description: 'Headline result, tiles and the summary.' },
    SUBJECTS: { label: 'Marks by subject', description: 'Score in each subject against the class.' },
    TREND: { label: 'Score trend', description: 'Each assessment in order, with the class average.' },
    TOPICS: { label: 'Strengths and weaknesses', description: 'Topics mastered and topics to work on.' },
    ATTENDANCE: { label: 'Live class attendance', description: 'Classes attended and the weekly trend.' },
    PROGRESS: { label: 'Course progress', description: 'Completion and time in each subject.' },
    MISTAKES: { label: 'What to practise', description: 'Mistakes from assessments and how to fix them.' },
    THINKING: { label: 'Thinking skills', description: 'Bloom levels and answer confidence.' },
};

/** Sections that share a printed page; a page with none of its sections picked is left out. */
const PAGES: LearnerReportSection[][] = [
    ['OVERVIEW', 'SUBJECTS', 'TREND'],
    ['TOPICS', 'ATTENDANCE', 'PROGRESS'],
    ['MISTAKES', 'THINKING'],
];

const SummaryNote = ({ m, brand }: { m: LearnerReportModel; brand: string }) =>
    m.summary ? (
        <div className="flex gap-3 rounded-xl px-4 py-3" style={{ background: tint(brand, 0.94) }}>
            <Quotes className="size-6 shrink-0" weight="fill" style={{ color: brand }} />
            <div className="flex flex-col gap-0.5">
                <span className="text-2xs font-semibold uppercase tracking-wider text-neutral-500">
                    Summary
                </span>
                <p className="text-sm leading-relaxed text-neutral-700">{m.summary}</p>
            </div>
        </div>
    ) : null;

/**
 * The printable learner report: an institute band on every page, then the picked sections laid
 * out on A4 pages. Rendered from the snapshot already on screen, so it needs no AI and no extra
 * request; "Download PDF" captures the pages client-side.
 */
export const LearnerReportDocument = ({
    snapshot,
    brand,
    fallbackName,
    batchName,
    range,
    sections = [...LEARNER_REPORT_SECTIONS],
}: {
    snapshot: StudentReportSnapshot;
    brand: string;
    fallbackName?: string | null;
    batchName?: string;
    range: { start: string; end: string };
    sections?: LearnerReportSection[];
}) => {
    const m = buildLearnerReport(snapshot, fallbackName);
    const periodLabel = `${format(new Date(range.start), 'd MMM yyyy')} – ${format(new Date(range.end), 'd MMM yyyy')}`;
    const footer = `${m.studentName} · ${periodLabel}`;
    const props = { m, brand, animate: false };
    const on = (s: LearnerReportSection) => sections.includes(s);
    const band = (
        <ReportBand
            brand={brand}
            instituteName={snapshot.institute?.name ?? ''}
            logoUrl={snapshot.institute?.logo_url}
            subtitle={`Progress report · ${periodLabel}`}
            learnerName={m.studentName}
            learnerLine={[
                snapshot.student?.enrollment_no && `Enrollment no. ${snapshot.student.enrollment_no}`,
                batchName || snapshot.student?.batch,
            ]
                .filter(Boolean)
                .join(' · ')}
        />
    );

    const blocks: Record<LearnerReportSection, ReactNode> = {
        OVERVIEW: (
            <div className="flex flex-col gap-4">
                <LearnerHero {...props} />
                <LearnerTiles {...props} />
                <SummaryNote m={m} brand={brand} />
            </div>
        ),
        SUBJECTS: <SubjectsBlock {...props} />,
        TREND: <TrendBlock {...props} />,
        TOPICS: <TopicsBlock {...props} />,
        ATTENDANCE: <AttendanceBlock {...props} />,
        PROGRESS: <ProgressBlock {...props} />,
        MISTAKES: <MistakesBlock {...props} max={3} />,
        THINKING: <ThinkingBlock {...props} />,
    };
    const pages = PAGES.map((page) => page.filter(on)).filter((page) => page.length > 0);

    return (
        <div className="flex flex-col gap-6 bg-neutral-100 p-6">
            {pages.map((page, i) => (
                <ReportPage key={page.join()} footer={footer}>
                    {band}
                    <div className="flex flex-col gap-4 px-10 pt-6">
                        {page.includes('ATTENDANCE') && page.includes('PROGRESS') ? (
                            <>
                                {page
                                    .filter((s) => s !== 'ATTENDANCE' && s !== 'PROGRESS')
                                    .map((s) => (
                                        <div key={s}>{blocks[s]}</div>
                                    ))}
                                <div className="grid grid-cols-2 gap-3">
                                    {blocks.ATTENDANCE}
                                    {blocks.PROGRESS}
                                </div>
                            </>
                        ) : (
                            page.map((s) => <div key={s}>{blocks[s]}</div>)
                        )}
                        {i === 0 && !m.hasAnything && (
                            <p className="py-10 text-center text-sm" style={{ color: REPORT_COLORS.muted }}>
                                No assessments, attendance or progress were recorded in these dates.
                            </p>
                        )}
                    </div>
                </ReportPage>
            ))}
        </div>
    );
};

/** "Generate report": pick the sections, preview the printable report and download it. */
export const LearnerReportDialog = ({
    snapshot,
    brand,
    fallbackName,
    batchName,
    range,
    disabled,
}: {
    snapshot: StudentReportSnapshot | undefined;
    brand: string;
    fallbackName?: string | null;
    batchName?: string;
    range: { start: string; end: string } | null;
    disabled?: boolean;
}) => {
    const [open, setOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [sections, setSections] = useState<LearnerReportSection[]>([...LEARNER_REPORT_SECTIONS]);
    const ref = useRef<HTMLDivElement>(null);
    const name = snapshot?.student?.name || fallbackName || 'learner';

    const download = async () => {
        if (!ref.current || !range) return;
        setSaving(true);
        try {
            await exportReportPdf(ref.current, `${safeFileName(name)}-report-${range.start}`);
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
            heading={`Report: ${name}`}
            dialogWidth="w-full max-w-[1140px]"
            trigger={
                <MyButton scale="small" disabled={disabled || !snapshot || !range}>
                    <FileText className="size-3.5" />
                    Generate report
                </MyButton>
            }
            footerLeft={
                <span className="text-xs text-neutral-500">Share this with parents as a PDF.</span>
            }
            footer={
                <MyButton onClick={download} disabled={saving || sections.length === 0}>
                    <DownloadSimple className="size-4" />
                    {saving ? 'Preparing PDF…' : 'Download PDF'}
                </MyButton>
            }
        >
            {snapshot && range && (
                <div className="flex flex-col gap-4 lg:flex-row">
                    <div className="lg:w-64 lg:shrink-0">
                        <ReportSectionPicker
                            order={LEARNER_REPORT_SECTIONS}
                            meta={LEARNER_REPORT_SECTION_META}
                            selected={sections}
                            onChange={setSections}
                        />
                    </div>
                    <div ref={ref} className="max-h-[70vh] flex-1 overflow-auto rounded-md">
                        {sections.length > 0 ? (
                            <LearnerReportDocument
                                snapshot={snapshot}
                                brand={brand}
                                fallbackName={fallbackName}
                                batchName={batchName}
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
