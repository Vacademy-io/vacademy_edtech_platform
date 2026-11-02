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
    ProgressBlock,
    SubjectsBlock,
    ThinkingBlock,
    TopicsBlock,
    TrendBlock,
} from './LearnerReportBlocks';

/** A4 at 96 dpi; the PDF export captures each page at this width. */
const PAGE_W = 794;
const PAGE_H = 1123;

const initials = (s: string) =>
    s
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((w) => w[0]?.toUpperCase())
        .join('') || 'R';

const Band = ({
    snapshot,
    m,
    brand,
    batchName,
    periodLabel,
}: {
    snapshot: StudentReportSnapshot;
    m: LearnerReportModel;
    brand: string;
    batchName?: string;
    periodLabel: string;
}) => {
    const inst = snapshot.institute?.name ?? '';
    const [logoOk, setLogoOk] = useState(true);
    const logo = snapshot.institute?.logo_url;
    return (
        <div
            className="flex items-center gap-4 px-10 py-6 text-white"
            style={{ background: `linear-gradient(110deg, ${brand} 0%, ${tint(brand, 0.25)} 100%)` }}
        >
            {logo && logoOk ? (
                <div className="flex h-12 items-center rounded-lg bg-white px-2">
                    <img
                        src={logo}
                        alt=""
                        crossOrigin="anonymous"
                        className="h-9 w-auto max-w-[140px] object-contain"
                        onError={() => setLogoOk(false)}
                    />
                </div>
            ) : (
                <div
                    className="flex size-12 items-center justify-center rounded-lg bg-white text-lg font-bold"
                    style={{ color: brand }}
                >
                    {initials(inst)}
                </div>
            )}
            <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-base font-semibold">{inst}</span>
                <span className="text-xs opacity-90">Progress report · {periodLabel}</span>
            </div>
            <div className="flex flex-col items-end text-right">
                <span className="text-lg font-bold">{m.studentName}</span>
                <span className="text-xs opacity-90">
                    {[snapshot.student?.enrollment_no && `Enrollment no. ${snapshot.student.enrollment_no}`, batchName || snapshot.student?.batch]
                        .filter(Boolean)
                        .join(' · ')}
                </span>
            </div>
        </div>
    );
};

const Page = ({ children, footer }: { children: ReactNode; footer: string }) => (
    <div
        data-report-page
        className="relative mx-auto flex flex-col bg-white shadow-sm ring-1 ring-neutral-200"
        style={{ width: PAGE_W, minHeight: PAGE_H }}
    >
        {children}
        <div className="mt-auto flex justify-between px-10 pb-6 pt-4 text-2xs text-neutral-400">
            <span>{footer}</span>
            <span>Generated {format(new Date(), 'd MMM yyyy')}</span>
        </div>
    </div>
);

/**
 * The printable learner report: an institute band, the hero result, then the same charts as the
 * Reports tab laid out on A4 pages. Rendered from the snapshot already on screen, so it needs
 * no AI and no extra request; "Download PDF" captures the pages client-side.
 */
export const LearnerReportDocument = ({
    snapshot,
    brand,
    fallbackName,
    batchName,
    range,
}: {
    snapshot: StudentReportSnapshot;
    brand: string;
    fallbackName?: string | null;
    batchName?: string;
    range: { start: string; end: string };
}) => {
    const m = buildLearnerReport(snapshot, fallbackName);
    const periodLabel = `${format(new Date(range.start), 'd MMM yyyy')} – ${format(new Date(range.end), 'd MMM yyyy')}`;
    const footer = `${m.studentName} · ${periodLabel}`;
    const props = { m, brand, animate: false };
    const page2 =
        m.strengths.length + m.weaknesses.length > 0 ||
        !!m.attendance ||
        (m.progress?.subjects.length ?? 0) > 0 ||
        m.blooms.length > 0 ||
        !!m.confidence;

    return (
        <div className="flex flex-col gap-6 bg-neutral-100 p-6">
            <Page footer={footer}>
                <Band snapshot={snapshot} m={m} brand={brand} batchName={batchName} periodLabel={periodLabel} />
                <div className="flex flex-col gap-4 px-10 pt-6">
                    <LearnerHero {...props} />
                    <LearnerTiles {...props} />
                    {m.summary && (
                        <div
                            className="flex gap-3 rounded-xl px-4 py-3"
                            style={{ background: tint(brand, 0.94) }}
                        >
                            <Quotes className="size-6 shrink-0" weight="fill" style={{ color: brand }} />
                            <div className="flex flex-col gap-0.5">
                                <span className="text-2xs font-semibold uppercase tracking-wider text-neutral-500">
                                    Summary
                                </span>
                                <p className="text-sm leading-relaxed text-neutral-700">{m.summary}</p>
                            </div>
                        </div>
                    )}
                    <SubjectsBlock {...props} />
                    <TrendBlock {...props} />
                    {!m.hasAnything && (
                        <p className="py-10 text-center text-sm" style={{ color: REPORT_COLORS.muted }}>
                            No assessments, attendance or progress were recorded in these dates.
                        </p>
                    )}
                </div>
            </Page>
            {page2 && (
                <Page footer={footer}>
                    <Band snapshot={snapshot} m={m} brand={brand} batchName={batchName} periodLabel={periodLabel} />
                    <div className="flex flex-col gap-4 px-10 pt-6">
                        <TopicsBlock {...props} />
                        <div className="grid grid-cols-2 gap-3">
                            <AttendanceBlock {...props} />
                            <ProgressBlock {...props} />
                        </div>
                        <ThinkingBlock {...props} />
                    </div>
                </Page>
            )}
        </div>
    );
};

/** "Generate report": opens the printable report for the learner, filters already applied. */
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
            dialogWidth="max-w-[900px]"
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
                <MyButton onClick={download} disabled={saving}>
                    <DownloadSimple className="size-4" />
                    {saving ? 'Preparing PDF…' : 'Download PDF'}
                </MyButton>
            }
        >
            {snapshot && range && (
                <div ref={ref} className="overflow-x-auto">
                    <LearnerReportDocument
                        snapshot={snapshot}
                        brand={brand}
                        fallbackName={fallbackName}
                        batchName={batchName}
                        range={range}
                    />
                </div>
            )}
        </MyDialog>
    );
};
