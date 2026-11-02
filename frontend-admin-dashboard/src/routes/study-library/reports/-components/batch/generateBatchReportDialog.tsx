import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ChalkboardTeacher, Eye, FilePdf, UsersThree } from '@phosphor-icons/react';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import {
    BATCH_REPORT_SECTIONS,
    BATCH_REPORT_SECTION_META,
    downloadBatchReportPdf,
    fetchBatchReportPreview,
    getBatchReportTemplateQuery,
    sendBatchReport,
    type BatchReportAudience,
    type BatchReportSection,
    type BatchSummaryRequest,
} from '@/services/batch-summary-report';

/**
 * Generate a batch report from the institute's template (Settings → Batch reports). The
 * sections start from the template and can be adjusted for this one report; the preview is
 * the exact HTML the PDF and the emails are made from.
 */
export function GenerateBatchReportDialog({
    request,
    disabled,
}: {
    request: BatchSummaryRequest | null;
    disabled?: boolean;
}) {
    const [open, setOpen] = useState(false);
    const [sections, setSections] = useState<BatchReportSection[]>([]);
    const [html, setHtml] = useState<string | null>(null);
    const [busy, setBusy] = useState<'preview' | 'pdf' | BatchReportAudience | null>(null);
    const [confirm, setConfirm] = useState<BatchReportAudience | null>(null);
    const template = useQuery({ ...getBatchReportTemplateQuery(), enabled: open });

    useEffect(() => {
        if (open && template.data) setSections(template.data.sections);
    }, [open, template.data]);

    useEffect(() => {
        if (!open) {
            setHtml(null);
            setConfirm(null);
        }
    }, [open]);

    const body = (): BatchSummaryRequest | null => (request ? { ...request, sections } : null);

    const toggle = (key: BatchReportSection) => {
        setHtml(null);
        setSections((prev) =>
            prev.includes(key)
                ? prev.filter((k) => k !== key)
                : BATCH_REPORT_SECTIONS.filter((k) => k === key || prev.includes(k))
        );
    };

    const preview = async () => {
        const b = body();
        if (!b) return;
        setBusy('preview');
        try {
            setHtml(await fetchBatchReportPreview(b));
        } catch {
            toast.error('Could not build the preview');
        } finally {
            setBusy(null);
        }
    };

    const pdf = async () => {
        const b = body();
        if (!b) return;
        setBusy('pdf');
        try {
            const blob = await downloadBatchReportPdf(b);
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `batch-report-${b.start_date}-to-${b.end_date}.pdf`;
            a.click();
            URL.revokeObjectURL(url);
        } catch {
            toast.error('Could not create the PDF');
        } finally {
            setBusy(null);
        }
    };

    const send = async (audience: BatchReportAudience) => {
        const b = body();
        if (!b) return;
        setBusy(audience);
        try {
            const result = await sendBatchReport({ ...b, audience });
            const who = audience === 'TEACHERS' ? 'teacher' : 'parent';
            if (result.sent > 0) {
                toast.success(`Sent to ${result.sent} ${who}${result.sent === 1 ? '' : 's'}`, {
                    description: result.notes?.join(' ') || undefined,
                });
            } else {
                toast.warning('Nothing was sent', {
                    description: result.notes?.join(' ') || undefined,
                });
            }
            setConfirm(null);
        } catch {
            toast.error('Sending failed. Only admins can send reports.');
        } finally {
            setBusy(null);
        }
    };

    const noSections = sections.length === 0;

    return (
        <MyDialog
            open={open}
            onOpenChange={setOpen}
            trigger={<MyButton disabled={disabled || !request}>Generate report</MyButton>}
            heading="Generate batch report"
            dialogWidth="w-full max-w-[960px]"
            content={
                template.isLoading ? (
                    <DashboardLoader />
                ) : (
                    <div className="flex flex-col gap-4 lg:flex-row">
                        <div className="flex flex-col gap-3 lg:w-72 lg:shrink-0">
                            <div>
                                <p className="text-sm font-semibold text-neutral-700">Sections</p>
                                <p className="text-xs text-neutral-500">
                                    Defaults come from Settings → Batch reports.
                                </p>
                            </div>
                            {BATCH_REPORT_SECTIONS.map((key) => {
                                const meta = BATCH_REPORT_SECTION_META[key];
                                return (
                                    <label
                                        key={key}
                                        className="flex cursor-pointer items-start gap-2"
                                    >
                                        <Checkbox
                                            checked={sections.includes(key)}
                                            onCheckedChange={() => toggle(key)}
                                            className="mt-0.5"
                                        />
                                        <span className="flex flex-col">
                                            <span className="text-sm text-neutral-700">
                                                {meta.label}
                                            </span>
                                            <span className="text-xs text-neutral-500">
                                                {meta.description}
                                            </span>
                                        </span>
                                    </label>
                                );
                            })}
                            <p className="rounded-md bg-neutral-50 p-2 text-xs text-neutral-500">
                                Parents get only their own child&apos;s result plus the sections
                                that name no other learner.
                            </p>
                        </div>
                        <div className="flex min-h-[420px] flex-1 flex-col overflow-hidden rounded-md border border-neutral-200">
                            {busy === 'preview' ? (
                                <DashboardLoader />
                            ) : html ? (
                                <iframe
                                    title="Batch report preview"
                                    srcDoc={html}
                                    sandbox=""
                                    className="h-[520px] w-full bg-white"
                                />
                            ) : (
                                <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-neutral-500">
                                    <Eye className="size-6" />
                                    Preview the report to see exactly what will be downloaded or
                                    sent.
                                </div>
                            )}
                        </div>
                    </div>
                )
            }
            footer={
                confirm ? (
                    <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <p className="text-sm text-neutral-600">
                            {confirm === 'TEACHERS'
                                ? 'Email this report to every teacher assigned to this batch?'
                                : 'Email each parent their own child’s report? Learners without a parent email are skipped.'}
                        </p>
                        <div className="flex gap-2">
                            <MyButton
                                buttonType="secondary"
                                onClick={() => setConfirm(null)}
                                disabled={!!busy}
                            >
                                Cancel
                            </MyButton>
                            <MyButton onClick={() => send(confirm)} disabled={!!busy}>
                                {busy === confirm ? 'Sending…' : 'Send now'}
                            </MyButton>
                        </div>
                    </div>
                ) : (
                    <div className="flex w-full flex-wrap justify-end gap-2">
                        <MyButton
                            buttonType="secondary"
                            onClick={preview}
                            disabled={noSections || !!busy}
                        >
                            <Eye className="size-4" />
                            Preview
                        </MyButton>
                        <MyButton
                            buttonType="secondary"
                            onClick={pdf}
                            disabled={noSections || !!busy}
                        >
                            <FilePdf className="size-4" />
                            {busy === 'pdf' ? 'Preparing…' : 'Download PDF'}
                        </MyButton>
                        <MyButton
                            buttonType="secondary"
                            onClick={() => setConfirm('TEACHERS')}
                            disabled={noSections || !!busy}
                        >
                            <ChalkboardTeacher className="size-4" />
                            Send to teachers
                        </MyButton>
                        <MyButton
                            onClick={() => setConfirm('PARENTS')}
                            disabled={noSections || !!busy}
                        >
                            <UsersThree className="size-4" />
                            Send to parents
                        </MyButton>
                    </div>
                )
            }
        />
    );
}
