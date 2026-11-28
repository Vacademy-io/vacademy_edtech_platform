import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DownloadSimple, CircleNotch, CaretDown } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { PrintablePaperPages } from '@/components/common/export-offline/preview/PrintablePaperPages';
import { useExportPagesToPdf } from '@/components/common/export-offline/hooks/useExportPagesToPdf';
import { getBase64FromUrl } from '@/components/common/export-offline/utils/utils';
import useInstituteLogoStore from '@/components/common/layout-container/sidebar/institutelogo-global-zustand';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { mapGeneratedQuestionsForExport } from '../-utils/map-generated-question';
import type { GeneratedQuestion } from '../-services/utils';

interface RecordingAssessmentExportButtonsProps {
    questions: GeneratedQuestion[];
    title: string;
}

const slugify = (s: string): string =>
    s
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60) || 'assessment';

const formatToday = (): string =>
    new Date().toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
    });

/**
 * Builds two PDF variants (Student + Answer Key) of an AI-generated
 * recording assessment, styled as a professional printable exam paper:
 *
 *   - letterhead + variant badge on every page
 *   - serif centred title with info pills (Q count, marks, date)
 *   - optional student-details fill-in strip on page 1 (Student PDF only;
 *     user opts in via a small dialog at export time so casual practice
 *     quizzes can ship without the formal header)
 *   - faint diagonal institute-logo watermark behind every page (branding
 *     + soft anti-photocopy cue)
 *   - thin-rule footer with "Page X of Y" + institute attribution
 *
 * Visual choices follow the "Editorial Grid / Magazine" + "Legal
 * Professional" patterns surfaced by the ui-ux-pro-max design search:
 * serif heading for institutional authority, sans body for readability,
 * generous whitespace for print-quality vertical rhythm.
 */
export function RecordingAssessmentExportButtons({
    questions,
    title,
}: RecordingAssessmentExportButtonsProps) {
    const { t } = useTranslation('studyLibraryLiveSessionRecordingAssessmentExportButtons');
    const instituteLogo = useInstituteLogoStore((s) => s.instituteLogo);
    const instituteName = useInstituteDetailsStore(
        (s) => s.instituteDetails?.institute_name ?? ''
    );

    // html2canvas can't reliably capture remote <img src> due to CORS even
    // with useCORS:true, so we eagerly resolve the institute-logo URL to a
    // base64 data URL the same way the existing question-paper letterhead
    // upload does — embedded images are always captured.
    const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);
    useEffect(() => {
        let cancelled = false;
        if (!instituteLogo) {
            setLogoDataUrl(null);
            return;
        }
        getBase64FromUrl(instituteLogo)
            .then((b64) => {
                if (!cancelled) setLogoDataUrl((b64 as string) ?? null);
            })
            .catch(() => {
                if (!cancelled) setLogoDataUrl(null);
            });
        return () => {
            cancelled = true;
        };
    }, [instituteLogo]);

    const mappedQuestions = useMemo(
        () => mapGeneratedQuestionsForExport(questions ?? []),
        [questions]
    );

    const totalMarks = mappedQuestions.reduce((sum, q) => {
        try {
            const m = JSON.parse(q.marking_json)?.data?.totalMark ?? 0;
            return sum + (typeof m === 'number' ? m : 0);
        } catch {
            return sum;
        }
    }, 0);

    const studentPagesRef = useRef<HTMLDivElement>(null);
    const answerPagesRef = useRef<HTMLDivElement>(null);

    const safeTitle = title?.trim() || t('defaultTitle');
    const filenameBase = slugify(safeTitle);
    const todayFormatted = formatToday();

    const studentExport = useExportPagesToPdf({
        pagesContainerRef: studentPagesRef,
        filename: `${filenameBase}-student.pdf`,
    });
    const answerExport = useExportPagesToPdf({
        pagesContainerRef: answerPagesRef,
        filename: `${filenameBase}-answer-key.pdf`,
    });

    const [lastError, setLastError] = useState<string | null>(null);

    // "Ask before export" sub-dialogs. Each dropdown item opens its own
    // dialog with toggles for the user to decide which optional sections
    // to include in the PDF before capture runs. Shared layout/footer
    // toggles are reused across both dialogs so the user's last choice
    // sticks between exports.
    const [studentDialogOpen, setStudentDialogOpen] = useState(false);
    const [answerDialogOpen, setAnswerDialogOpen] = useState(false);
    const [includeStudentDetails, setIncludeStudentDetails] = useState(true);
    const [showTitle, setShowTitle] = useState(true);
    const [showHeaderInfoStrip, setShowHeaderInfoStrip] = useState(true);
    const [showFooterDate, setShowFooterDate] = useState(true);
    const [showFooterConfidential, setShowFooterConfidential] = useState(true);

    const run = async (kind: 'student' | 'answers') => {
        setLastError(null);
        const job = kind === 'student' ? studentExport : answerExport;
        try {
            await job.exportToPdf();
        } catch (err) {
            const msg = (err as Error)?.message ?? t('errors.couldNotGeneratePdf');
            if (msg !== 'PDF generation cancelled') {
                setLastError(msg);
                toast.error(msg);
            }
        }
    };

    const renderHeader = (variant: 'student' | 'answers') => (
        <header className="mb-5">
            {/* Letterhead strip: logo + institute on the left, variant badge
                on the right, capped by a strong black rule. Same on every
                page so the document reads like a continuous exam paper. */}
            <div className="flex items-end justify-between border-b-2 border-neutral-900 pb-2">
                <div className="flex items-center gap-3">
                    {logoDataUrl ? (
                        <img
                            src={logoDataUrl}
                            alt={t('header.instituteLogoAlt')}
                            className="max-h-12 max-w-32 object-contain"
                        />
                    ) : null}
                    <div className="font-serif text-base font-semibold tracking-wide text-neutral-900">
                        {instituteName || t('header.instituteFallback')}
                    </div>
                </div>
                <div className="text-xs font-medium uppercase tracking-widest text-neutral-600">
                    {variant === 'answers' ? t('header.answerKey') : t('header.questionPaper')}
                </div>
            </div>

            {/* Centred title block + (optional) info pills */}
            <div className="mt-4 text-center">
                {showTitle && (
                    <div className="font-serif text-2xl font-bold leading-tight tracking-tight text-neutral-900">
                        {safeTitle}
                    </div>
                )}
                {showHeaderInfoStrip && (
                    <div className="mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-neutral-600">
                        <span>{t('header.questionsCount', { count: mappedQuestions.length })}</span>
                        {totalMarks > 0 && (
                            <>
                                <span aria-hidden className="text-neutral-300">
                                    ·
                                </span>
                                <span>{t('header.marksCount', { count: totalMarks })}</span>
                            </>
                        )}
                        <span aria-hidden className="text-neutral-300">
                            ·
                        </span>
                        <span className="uppercase tracking-wider">
                            {todayFormatted}
                        </span>
                    </div>
                )}
            </div>
        </header>
    );

    const renderStudentDetails = () => (
        <section
            aria-label={t('studentDetails.ariaLabel')}
            className="mb-6 grid grid-cols-2 gap-x-10 gap-y-3 border-y border-neutral-200 py-4 text-sm"
        >
            {(
                [
                    t('studentDetails.fields.name'),
                    t('studentDetails.fields.rollNo'),
                    t('studentDetails.fields.classBatch'),
                    t('studentDetails.fields.date'),
                ] as const
            ).map((label) => (
                <div key={label} className="flex items-baseline gap-2">
                    <span className="font-medium text-neutral-700">{label}:</span>
                    <span className="grow border-b border-neutral-400" />
                </div>
            ))}
        </section>
    );

    // Reused verbatim by both the student and answer-key export dialogs so the
    // header-info-strip preview stays identical between them.
    const headerInfoDescription =
        t('header.questionsCount', { count: mappedQuestions.length }) +
        (totalMarks > 0 ? ` · ${t('header.marksCount', { count: totalMarks })}` : '') +
        ` · ${todayFormatted}`;

    const footerLabel = (() => {
        const parts: string[] = [];
        if (instituteName) parts.push(instituteName);
        if (showFooterDate) parts.push(todayFormatted);
        if (showFooterConfidential) parts.push(t('footer.confidential'));
        return parts.join(' · ');
    })();

    const disabled =
        studentExport.exporting ||
        answerExport.exporting ||
        mappedQuestions.length === 0;

    const isBusy = studentExport.exporting || answerExport.exporting;
    const activeProgress = studentExport.exporting
        ? studentExport.progress
        : answerExport.exporting
          ? answerExport.progress
          : 0;

    return (
        <>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        disabled={disabled}
                    >
                        {isBusy ? (
                            <CircleNotch className="size-3.5 animate-spin" />
                        ) : (
                            <DownloadSimple className="size-3.5" />
                        )}
                        {t('actions.exportPdf')}
                        {isBusy && activeProgress > 0
                            ? ` ${activeProgress}%`
                            : ''}
                        <CaretDown className="size-3" />
                    </MyButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuLabel>{t('dropdown.chooseVersion')}</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                        onSelect={(e) => {
                            e.preventDefault();
                            setStudentDialogOpen(true);
                        }}
                        disabled={isBusy}
                    >
                        <DownloadSimple className="mr-2 size-3.5" />
                        {t('dropdown.studentVersion')}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                        onSelect={(e) => {
                            e.preventDefault();
                            setAnswerDialogOpen(true);
                        }}
                        disabled={isBusy}
                    >
                        <DownloadSimple className="mr-2 size-3.5" />
                        {t('dropdown.answerKey')}
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>

            <ExportOptionsDialog
                heading={t('dialog.exportStudentPdf')}
                open={studentDialogOpen}
                onOpenChange={setStudentDialogOpen}
                onConfirm={() => {
                    setStudentDialogOpen(false);
                    void run('student');
                }}
                rows={[
                    {
                        id: 'include-student-details',
                        label: t('dialog.rows.includeStudentDetails.label'),
                        description: t('dialog.rows.includeStudentDetails.description'),
                        checked: includeStudentDetails,
                        onChange: setIncludeStudentDetails,
                    },
                    {
                        id: 'show-title',
                        label: t('dialog.rows.showTitle.label'),
                        description: t('dialog.rows.showTitle.description', { title: safeTitle }),
                        checked: showTitle,
                        onChange: setShowTitle,
                    },
                    {
                        id: 'show-header-info',
                        label: t('dialog.rows.showHeaderInfo.label'),
                        description: headerInfoDescription,
                        checked: showHeaderInfoStrip,
                        onChange: setShowHeaderInfoStrip,
                    },
                    {
                        id: 'show-footer-date',
                        label: t('dialog.rows.showFooterDate.label'),
                        description: t('dialog.rows.showFooterDate.description'),
                        checked: showFooterDate,
                        onChange: setShowFooterDate,
                    },
                    {
                        id: 'show-footer-confidential',
                        label: t('dialog.rows.showFooterConfidential.label'),
                        description: t('dialog.rows.showFooterConfidential.descriptionLong'),
                        checked: showFooterConfidential,
                        onChange: setShowFooterConfidential,
                    },
                ]}
            />

            <ExportOptionsDialog
                heading={t('dialog.exportAnswerKeyPdf')}
                open={answerDialogOpen}
                onOpenChange={setAnswerDialogOpen}
                onConfirm={() => {
                    setAnswerDialogOpen(false);
                    void run('answers');
                }}
                rows={[
                    {
                        id: 'ak-show-title',
                        label: t('dialog.rows.showTitle.label'),
                        description: t('dialog.rows.showTitle.description', { title: safeTitle }),
                        checked: showTitle,
                        onChange: setShowTitle,
                    },
                    {
                        id: 'ak-show-header-info',
                        label: t('dialog.rows.showHeaderInfo.label'),
                        description: headerInfoDescription,
                        checked: showHeaderInfoStrip,
                        onChange: setShowHeaderInfoStrip,
                    },
                    {
                        id: 'ak-show-footer-date',
                        label: t('dialog.rows.showFooterDate.label'),
                        description: t('dialog.rows.showFooterDate.description'),
                        checked: showFooterDate,
                        onChange: setShowFooterDate,
                    },
                    {
                        id: 'ak-show-footer-confidential',
                        label: t('dialog.rows.showFooterConfidential.label'),
                        description: t('dialog.rows.showFooterConfidential.descriptionShort'),
                        checked: showFooterConfidential,
                        onChange: setShowFooterConfidential,
                    },
                ]}
            />

            {lastError && (
                <div className="mt-2 text-xs text-danger-600">{lastError}</div>
            )}

            {/*
                Off-screen render area for html2canvas to capture. The width
                must be exactly 210mm (A4) so the captured layout matches the
                eventual PDF page, which Tailwind tokens cannot express — same
                pattern as ExportHandlerQuestionPaper. left:-9999px hides the
                container without removing it from layout (display:none would
                make measurements zero and break PrintablePaperPages' page
                packing).
            */}
            <div
                aria-hidden
                className="pointer-events-none absolute top-0 opacity-0"
                style={{ width: '210mm', left: '-9999px' }}
            >
                <div ref={studentPagesRef}>
                    <PrintablePaperPages
                        questions={mappedQuestions}
                        header={renderHeader('student')}
                        firstPagePrefix={
                            includeStudentDetails
                                ? renderStudentDetails()
                                : undefined
                        }
                        footerLabel={footerLabel}
                        watermarkSrc={logoDataUrl}
                        showAnswers={false}
                        columns={1}
                        fontSize="medium"
                        showCheckboxes
                        showMarks={false}
                        showPageNumbers
                    />
                </div>
                <div ref={answerPagesRef}>
                    <PrintablePaperPages
                        questions={mappedQuestions}
                        header={renderHeader('answers')}
                        footerLabel={footerLabel}
                        watermarkSrc={logoDataUrl}
                        showAnswers
                        columns={1}
                        fontSize="medium"
                        showCheckboxes
                        showMarks={false}
                        showPageNumbers
                    />
                </div>
            </div>
        </>
    );
}

interface ExportOptionRow {
    id: string;
    label: string;
    description: string;
    checked: boolean;
    onChange: (next: boolean) => void;
}

interface ExportOptionsDialogProps {
    heading: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onConfirm: () => void;
    rows: ExportOptionRow[];
}

/**
 * Pre-export options sheet. One row per optional section the user can
 * toggle (student-details fill-in, header info strip, footer date, footer
 * "Confidential" label). The off-screen PrintablePaperPages reads from
 * the same state, so flipping a switch updates the captured layout before
 * the user clicks Export PDF.
 */
function ExportOptionsDialog({
    heading,
    open,
    onOpenChange,
    onConfirm,
    rows,
}: ExportOptionsDialogProps) {
    const { t } = useTranslation('studyLibraryLiveSessionRecordingAssessmentExportButtons');
    return (
        <MyDialog
            heading={heading}
            open={open}
            onOpenChange={onOpenChange}
            footer={
                <>
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        onClick={() => onOpenChange(false)}
                    >
                        {t('dialog.cancel')}
                    </MyButton>
                    <MyButton type="button" onClick={onConfirm}>
                        <DownloadSimple className="size-3.5" />
                        {t('actions.exportPdf')}
                    </MyButton>
                </>
            }
        >
            <div className="flex flex-col gap-3 text-sm text-neutral-700">
                <p className="text-xs text-neutral-500">{t('dialog.tickSectionsHint')}</p>
                {rows.map((row) => (
                    <div
                        key={row.id}
                        className="flex items-start justify-between gap-4 rounded-md border border-neutral-200 bg-neutral-50 p-3"
                    >
                        <div className="flex-1">
                            <Label
                                htmlFor={row.id}
                                className="text-sm font-medium text-neutral-800"
                            >
                                {row.label}
                            </Label>
                            <p className="mt-1 text-xs text-neutral-500">
                                {row.description}
                            </p>
                        </div>
                        <Switch
                            id={row.id}
                            checked={row.checked}
                            onCheckedChange={(v) => row.onChange(!!v)}
                        />
                    </div>
                ))}
            </div>
        </MyDialog>
    );
}
