import { useEffect, useMemo, useRef, useState } from 'react';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
    ArrowLeft,
    Camera,
    CaretDown,
    CaretUp,
    Coins,
    Sparkle,
    UploadSimple,
    WarningCircle,
} from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { useToolCostPreview } from '@/components/common/ai-credits/useToolCostPreview';
import { loadAssessmentSettingsStrict } from '@/services/assessment-settings';
import { normalizeCommentPlacement } from '@/types/assessment-settings';
import { isUserAdmin } from '@/utils/userDetails';
import {
    CopyCheckSettingsFields,
    toCopyCheckConfig,
    useCopyCheckSettings,
} from '@/components/common/ai-copy-check/CopyCheckSettingsFields';
import { CopyCheckCriteriaPanel } from '@/components/common/ai-copy-check/CopyCheckCriteriaPanel';
import { getInstituteId } from '@/constants/helper';
import { TokenKey } from '@/constants/auth/tokens';
import { getTokenDecodedData, getTokenFromCookie } from '@/lib/auth/sessionUtility';
import { useFileUpload } from '@/hooks/use-file-upload';
import { countPdfPages } from '@/services/pdf-page-count';
import { cn } from '@/lib/utils';
import {
    getAssessmentDetails,
    getQuestionDataForSection,
} from '@/routes/assessment/create-assessment/$assessmentId/$examtype/-services/assessment-services';
import {
    getCopyCheckConfig,
    listCopyIntakeBatches,
    startCopyIntake,
    type CopyIntakeUploadedFile,
} from '@/routes/assessment/assessment-list/assessment-details/$assessmentId/$examType/$assesssmentType/$assessmentTab/-services/copy-intake-services';
import { CopyIntakeBatchPanel } from '@/routes/assessment/assessment-list/assessment-details/$assessmentId/$examType/$assesssmentType/$assessmentTab/-components/copy-intake/CopyIntakeBatchPanel';
import { EnableAiChecking } from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-components/enable-ai-checking';
import { getAiGradability } from '@/services/paper-digitise';
import {
    decideStudentMapping,
    useInstituteStudentMapping,
} from '@/components/common/ai-copy-check/StudentMappingPicker';
import { MapStudentsChoiceDialog } from '@/routes/assessment/assessment-list/assessment-details/$assessmentId/$examType/$assesssmentType/$assessmentTab/-components/copy-intake/MapStudentsChoiceDialog';
import { CameraScanner } from './-components/CameraScanner';
import { CopyTray, draftPageCount, type DraftCopy } from './-components/CopyTray';
import { PaperQuestionsCard } from './-components/PaperQuestionsCard';
import { useEvalezySettings } from './-hooks/useEvalezySettings';
import type { PaperSection } from './-lib/paper-questions';
import { scanPagesToPdfFile, toScanPage, type ScanPage } from './-lib/scan-pdf';

export const Route = createFileRoute('/evalezy/$assessmentId')({
    // ?intake=<batchId> (from the "copies checked" email) opens that batch's results.
    validateSearch: (search: Record<string, unknown>): { intake?: string } => ({
        intake: typeof search.intake === 'string' && search.intake ? search.intake : undefined,
    }),
    component: EvalezyAssessmentPage,
});

/** Same limits as the portal's bulk upload. */
const MAX_COPIES = 200;
const MAX_PDF_MB = 60;
/** Copies built + uploaded at once: two keeps memory low on phones. */
const PARALLEL_UPLOADS = 2;

let copySeq = 0;
const newCopyId = () => `c${Date.now().toString(36)}${(copySeq++).toString(36)}`;

const releasePages = (copy: DraftCopy) => {
    if (copy.kind === 'scan') copy.pages.forEach((p) => URL.revokeObjectURL(p.url));
};

/**
 * Step 2 of Evalezy: get the copies in (camera scan, or PDFs / photos from the
 * device), send them, and pick up the checked copies. Sending = each copy
 * becomes one PDF, is uploaded, and the batch starts the same bulk AI check
 * the portal's "Upload & check copies" runs: the student's name is read off
 * the copy, matched, checked; results and the zip are in the panel below.
 */
function EvalezyAssessmentPage() {
    const { assessmentId } = Route.useParams();
    const { intake } = Route.useSearch();
    const { t } = useTranslation('evalezy');
    const queryClient = useQueryClient();
    const navigate = useNavigate();
    const instituteId = getInstituteId() ?? '';
    const { settings } = useEvalezySettings();
    const fileInputRef = useRef<HTMLInputElement>(null);

    const details = useQuery(getAssessmentDetails({ assessmentId, instituteId, type: 'EXAM' }));
    const saved = details.data?.[0]?.saved_data;
    const paperSections = useMemo(
        () => (details.data?.[1]?.saved_data?.sections ?? []) as PaperSection[],
        [details.data]
    );
    const sectionIds = paperSections
        .map((s) => s?.id)
        .filter(Boolean)
        .join(',');
    const {
        data: sectionQuestions,
        isLoading: loadingQuestions,
        isError: questionsFailed,
        refetch: refetchQuestions,
    } = useQuery({
        ...getQuestionDataForSection({ assessmentId, sectionIds }),
        enabled: Boolean(assessmentId && sectionIds),
    });
    const questionsPerCopy: number = Object.values(
        (sectionQuestions ?? {}) as Record<string, unknown[] | undefined>
    ).reduce((sum, questions) => sum + (questions?.length ?? 0), 0);
    // Linked batches (step 3), for the student picker of copies the reader could not place.
    const packageSessionIds: string[] = useMemo(
        () =>
            (
                (details.data?.[2]?.saved_data?.pre_batch_registrations ?? []) as Array<{
                    batchId?: string;
                }>
            )
                .map((b) => b.batchId ?? '')
                .filter(Boolean),
        [details.data]
    );
    const examType = saved?.assessment_mode || 'EXAM';
    // A test made in the app starts on the "Upload your answer sheet." placeholder until its
    // paper has been read and reviewed; until then the AI has nothing to check copies against.
    const { data: gradability } = useQuery({
        queryKey: ['AI_GRADABILITY', assessmentId],
        queryFn: () => getAiGradability(assessmentId),
        enabled: Boolean(assessmentId),
        staleTime: 60 * 1000,
    });
    const placeholderOnly = Boolean(gradability?.placeholder_only);
    // Copies can only be matched when the test has students: linked batches or registrations.
    const hasStudents =
        packageSessionIds.length > 0 ||
        Number(details.data?.[2]?.saved_data?.pre_user_registrations ?? 0) > 0;
    const paperTotalMarks: number = (
        (details.data?.[1]?.saved_data?.sections ?? []) as Array<{ total_marks?: number }>
    ).reduce((sum, section) => sum + (Number(section?.total_marks) || 0), 0);

    const { data: batches = [] } = useQuery({
        queryKey: ['COPY_INTAKE_BATCHES', assessmentId, instituteId],
        queryFn: () => listCopyIntakeBatches(assessmentId, instituteId),
        enabled: !!instituteId,
    });
    const [resultsOpen, setResultsOpen] = useState(true);
    const [focusBatchId, setFocusBatchId] = useState<string | null>(intake ?? null);

    const [copies, setCopies] = useState<DraftCopy[]>([]);
    const [progress, setProgress] = useState<Record<string, 'working' | 'done' | 'failed'>>({});
    const [scannerOpen, setScannerOpen] = useState(false);
    const [readingPhotos, setReadingPhotos] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    // How copies are marked comes from Evaluation settings, read fresh; only the subject and the
    // class belong to this assessment. A failed read sends no placement: the last one stays.
    const { data: checkSettings } = useQuery({
        queryKey: ['EVALEZY_CHECK_SETTINGS', instituteId],
        queryFn: loadAssessmentSettingsStrict,
        enabled: !!instituteId,
        retry: false,
    });
    const [copyCheckSettings, setCopyCheckSettings] = useCopyCheckSettings(true, () =>
        getCopyCheckConfig(assessmentId, instituteId)
    );
    const { uploadFile } = useFileUpload();
    const [, setIsUploading] = useState(false);
    const userId = getTokenDecodedData(getTokenFromCookie(TokenKey.accessToken))?.user ?? '';

    // Object URLs of page thumbnails die with the page.
    const copiesRef = useRef(copies);
    copiesRef.current = copies;
    useEffect(() => () => copiesRef.current.forEach(releasePages), []);

    const room = MAX_COPIES - copies.length;
    const addCopies = (incoming: DraftCopy[]) => {
        if (incoming.length > room) {
            toast.error(t('errors.tooMany', { max: MAX_COPIES }));
            incoming.slice(room).forEach(releasePages);
        }
        setCopies((prev) => [...prev, ...incoming.slice(0, Math.max(0, room))]);
    };

    const addScans = (scanned: ScanPage[][]) => {
        setScannerOpen(false);
        if (scanned.length === 0) return;
        addCopies(scanned.map((pages) => ({ id: newCopyId(), kind: 'scan', pages })));
        toast.success(t('toasts.scanned', { count: scanned.length }));
    };

    /** PDFs: one copy each. Photos picked together: one copy (split it from the tray). */
    const addFiles = async (picked: File[]) => {
        const pdfs: DraftCopy[] = [];
        const photos: File[] = [];
        for (const file of picked) {
            if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') {
                if (file.size > MAX_PDF_MB * 1024 * 1024) {
                    toast.error(t('errors.tooLarge', { name: file.name, mb: MAX_PDF_MB }));
                    continue;
                }
                pdfs.push({ id: newCopyId(), kind: 'pdf', file, pages: null });
            } else if (file.type.startsWith('image/')) {
                photos.push(file);
            } else {
                toast.error(t('errors.notSupported', { name: file.name }));
            }
        }
        if (pdfs.length) {
            addCopies(pdfs);
            // Page counts are for the card only; a failed count shows as 1 page.
            pdfs.forEach(async (copy) => {
                if (copy.kind !== 'pdf') return;
                let pages = 1;
                const url = URL.createObjectURL(copy.file);
                try {
                    pages = await countPdfPages(url);
                } catch {
                    pages = 1;
                } finally {
                    URL.revokeObjectURL(url);
                }
                setCopies((prev) =>
                    prev.map((c) => (c.id === copy.id && c.kind === 'pdf' ? { ...c, pages } : c))
                );
            });
        }
        if (photos.length) {
            setReadingPhotos(true);
            const pages: ScanPage[] = [];
            for (const photo of photos) {
                try {
                    pages.push(await toScanPage(photo, settings.scanQuality));
                } catch {
                    toast.error(t('errors.photoUnreadable', { name: photo.name }));
                }
            }
            setReadingPhotos(false);
            if (pages.length) addCopies([{ id: newCopyId(), kind: 'scan', pages }]);
        }
    };

    const removeCopy = (id: string) =>
        setCopies((prev) => {
            const gone = prev.find((c) => c.id === id);
            if (gone) releasePages(gone);
            return prev.filter((c) => c.id !== id);
        });

    const removePage = (copyId: string, pageId: string) =>
        setCopies((prev) =>
            prev.flatMap((c) => {
                if (c.id !== copyId || c.kind !== 'scan') return [c];
                const page = c.pages.find((p) => p.id === pageId);
                if (page) URL.revokeObjectURL(page.url);
                const pages = c.pages.filter((p) => p.id !== pageId);
                return pages.length ? [{ ...c, pages }] : [];
            })
        );

    const split = (copyId: string) =>
        setCopies((prev) =>
            prev.flatMap((c) =>
                c.id === copyId && c.kind === 'scan'
                    ? c.pages.map<DraftCopy>((page) => ({
                          id: newCopyId(),
                          kind: 'scan',
                          pages: [page],
                      }))
                    : [c]
            )
        );

    const pageTotal = copies.reduce((sum, c) => sum + draftPageCount(c), 0);
    // Each copy's pages, charged once per copy, so a flat base on the rate card applies to each.
    const cost = useToolCostPreview(
        'copy_check_evaluation',
        { num_pages: copies.length > 0 ? pageTotal / copies.length : 0 },
        copies.length > 0 && questionsPerCopy > 0,
        copies.length
    );

    // Asked on send: map the copies to students, or only check them and take the zip.
    const [choiceOpen, setChoiceOpen] = useState(false);
    // Settings → Assessment: ask each time, always match to students, or only check.
    const studentMapping = useInstituteStudentMapping(true);
    const { t: tIntake } = useTranslation('assessmentCopyIntake');
    const send = useMutation({
        mutationFn: async (mapStudents: boolean) => {
            const queue = copies.map((copy, index) => ({ copy, index }));
            const uploaded: (CopyIntakeUploadedFile & { order: number; copyId: string })[] = [];
            const worker = async () => {
                for (let next = queue.shift(); next; next = queue.shift()) {
                    const { copy, index } = next;
                    setProgress((p) => ({ ...p, [copy.id]: 'working' }));
                    try {
                        const file =
                            copy.kind === 'pdf'
                                ? copy.file
                                : await scanPagesToPdfFile(
                                      copy.pages,
                                      t('tray.fileName', { number: index + 1 })
                                  );
                        const fileId = await uploadFile({
                            file,
                            setIsUploading,
                            userId,
                            source: instituteId,
                            sourceId: 'ASSESSMENT_OFFLINE_ENTRY',
                        });
                        if (!fileId) throw new Error('upload failed');
                        uploaded.push({
                            file_id: fileId,
                            file_name: file.name,
                            page_count: draftPageCount(copy),
                            order: index,
                            copyId: copy.id,
                        });
                        setProgress((p) => ({ ...p, [copy.id]: 'done' }));
                    } catch {
                        setProgress((p) => ({ ...p, [copy.id]: 'failed' }));
                    }
                }
            };
            await Promise.all(Array.from({ length: PARALLEL_UPLOADS }, worker));
            if (uploaded.length === 0) throw new Error(t('errors.nothingUploaded'));
            // Keep the copies in the order they were scanned.
            uploaded.sort((a, b) => a.order - b.order);
            const batch = await startCopyIntake(
                assessmentId,
                instituteId,
                uploaded.map(({ file_id, file_name, page_count }) => ({
                    file_id,
                    file_name,
                    page_count,
                })),
                undefined,
                settings.notifyEmail,
                checkSettings
                    ? normalizeCommentPlacement(checkSettings.aiCopyCheck?.commentPlacement)
                    : null,
                // Blank clears the assessment's own, so every check reads the institute's at dispatch.
                { ...toCopyCheckConfig(copyCheckSettings), instructions: null, language_feedback: undefined },
                mapStudents
            );
            return { batch, sent: new Set(uploaded.map((u) => u.copyId)) };
        },
        onSuccess: ({ batch, sent }) => {
            toast.success(t('toasts.started', { count: batch.total_items }));
            // Sent copies leave the tray; a copy that failed to upload stays for another try.
            setCopies((prev) =>
                prev.filter((c) => {
                    if (!sent.has(c.id)) return true;
                    releasePages(c);
                    return false;
                })
            );
            setProgress({});
            setFocusBatchId(batch.id);
            setResultsOpen(true);
            void queryClient.invalidateQueries({ queryKey: ['COPY_INTAKE_BATCHES'] });
            window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
        },
        onError: (e) => {
            setProgress({});
            toast.error(e instanceof Error ? e.message : t('errors.startFailed'));
        },
    });

    // Leaving mid-upload would drop the copies not sent yet.
    useEffect(() => {
        if (!send.isPending) return;
        const warn = (e: BeforeUnloadEvent) => e.preventDefault();
        window.addEventListener('beforeunload', warn);
        return () => window.removeEventListener('beforeunload', warn);
    }, [send.isPending]);

    if (details.isLoading) return <DashboardLoader />;
    if (details.isError || !saved) {
        return (
            <div className="flex flex-col items-center gap-3 rounded-lg border border-danger-200 bg-danger-50 p-6 text-center">
                <p className="text-body text-danger-700">{t('assessment.loadError')}</p>
                <div className="flex gap-2">
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="medium"
                        onClick={() => void details.refetch()}
                    >
                        {t('common.retry')}
                    </MyButton>
                    <MyButton
                        type="button"
                        buttonType="text"
                        scale="medium"
                        onClick={() => void navigate({ to: '/evalezy' })}
                    >
                        {t('assessment.back')}
                    </MyButton>
                </div>
            </div>
        );
    }

    const noPaper = !loadingQuestions && !!sectionIds && questionsPerCopy === 0;
    const sending = send.isPending;
    const canSend =
        copies.length > 0 &&
        !sending &&
        !readingPhotos &&
        !noPaper &&
        !placeholderOnly &&
        questionsPerCopy > 0 &&
        cost.sufficient !== false;

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
                <Link
                    to="/evalezy"
                    className="flex w-fit items-center gap-1 text-caption font-medium text-neutral-500 hover:text-primary-500"
                >
                    <ArrowLeft size={14} />
                    {t('assessment.back')}
                </Link>
                <h1 className="text-h3 font-semibold text-neutral-800">{saved.name}</h1>
            </div>

            {noPaper && (
                <p className="flex items-start gap-2 rounded-lg border border-warning-200 bg-warning-50 p-3 text-body text-warning-700">
                    <WarningCircle size={18} className="mt-px shrink-0" />
                    {t('assessment.noPaper')}
                </p>
            )}

            {/* The paper read + review that turns the placeholder into real questions.
                Renders nothing once the test has them. */}
            <EnableAiChecking
                assessmentId={assessmentId}
                assessmentName={saved.name ?? undefined}
                instructionsHtml={saved?.instructions?.content ?? undefined}
                totalMarks={paperTotalMarks > 0 ? paperTotalMarks : null}
                framed
                onEnabled={() => void queryClient.invalidateQueries()}
            />

            {/* What is on the paper: questions, marks, and the criteria to edit. */}
            {!placeholderOnly && Boolean(sectionIds) && (
                <PaperQuestionsCard
                    assessmentId={assessmentId}
                    sections={paperSections}
                    questionsBySection={sectionQuestions}
                    loading={loadingQuestions}
                    failed={questionsFailed}
                    onRetry={() => void refetchQuestions()}
                    paperTotalMarks={paperTotalMarks}
                    subject={copyCheckSettings.subject}
                    disabled={sending}
                />
            )}

            {placeholderOnly ? (
                <p className="flex items-start gap-2 rounded-lg border border-neutral-200 bg-white p-3 text-body text-neutral-600">
                    <WarningCircle size={18} className="mt-px shrink-0 text-warning-600" />
                    {t('assessment.waitForPaper')}
                </p>
            ) : (
                /* Get copies in */
                <section className="flex flex-col gap-3 rounded-lg border border-neutral-200 bg-white p-4">
                    <h2 className="text-subtitle font-semibold text-neutral-800">
                        {t('assessment.addTitle')}
                    </h2>
                    {settings.allowCamera || settings.allowUpload ? (
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            {settings.allowCamera && (
                                <button
                                    type="button"
                                    disabled={sending}
                                    onClick={() => setScannerOpen(true)}
                                    className="flex flex-col items-center gap-2 rounded-lg border-2 border-primary-200 bg-primary-50 px-4 py-6 text-center transition-colors hover:border-primary-400 disabled:opacity-50"
                                >
                                    <Camera size={32} className="text-primary-500" />
                                    <span className="text-subtitle font-semibold text-neutral-800">
                                        {t('assessment.scan')}
                                    </span>
                                    <span className="text-caption text-neutral-500">
                                        {t('assessment.scanHint')}
                                    </span>
                                </button>
                            )}
                            {settings.allowUpload && (
                                <button
                                    type="button"
                                    disabled={sending || readingPhotos}
                                    onClick={() => fileInputRef.current?.click()}
                                    onDragOver={(e) => e.preventDefault()}
                                    onDrop={(e) => {
                                        e.preventDefault();
                                        void addFiles(Array.from(e.dataTransfer.files));
                                    }}
                                    className="flex flex-col items-center gap-2 rounded-lg border-2 border-dashed border-neutral-300 bg-neutral-50 px-4 py-6 text-center transition-colors hover:border-primary-400 hover:bg-primary-50 disabled:opacity-50"
                                >
                                    <UploadSimple size={32} className="text-primary-500" />
                                    <span className="text-subtitle font-semibold text-neutral-800">
                                        {readingPhotos
                                            ? t('assessment.reading')
                                            : t('assessment.upload')}
                                    </span>
                                    <span className="text-caption text-neutral-500">
                                        {t('assessment.uploadHint')}
                                    </span>
                                    <input
                                        ref={fileInputRef}
                                        type="file"
                                        multiple
                                        accept="application/pdf,image/*"
                                        className="hidden"
                                        onChange={(e) => {
                                            if (e.target.files)
                                                void addFiles(Array.from(e.target.files));
                                            e.target.value = '';
                                        }}
                                    />
                                </button>
                            )}
                        </div>
                    ) : (
                        <p className="text-body text-neutral-500">{t('assessment.noInput')}</p>
                    )}
                </section>
            )}

            {copies.length > 0 && (
                <section className="flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                        <h2 className="text-subtitle font-semibold text-neutral-800">
                            {t('tray.title', {
                                count: copies.length,
                                pages: t('tray.pages', { count: pageTotal }),
                            })}
                        </h2>
                    </div>
                    <CopyTray
                        copies={copies}
                        disabled={sending}
                        progress={progress}
                        onRemoveCopy={removeCopy}
                        onRemovePage={removePage}
                        onSplit={split}
                    />

                    <button
                        type="button"
                        onClick={() => setSettingsOpen((o) => !o)}
                        className="flex items-center justify-between rounded-lg border border-neutral-200 bg-white px-4 py-3 text-body font-medium text-neutral-700"
                    >
                        {t('assessment.checkSettings')}
                        {settingsOpen ? <CaretUp size={16} /> : <CaretDown size={16} />}
                    </button>
                    {settingsOpen && (
                        <div className="flex flex-col gap-4 rounded-lg border border-neutral-200 bg-white p-4">
                            <CopyCheckSettingsFields
                                value={copyCheckSettings}
                                onChange={setCopyCheckSettings}
                                disabled={sending}
                                withInstituteFields={false}
                            />
                            {isUserAdmin() && (
                                <Link
                                    to="/evalezy/settings"
                                    className="text-body font-medium text-primary-500"
                                >
                                    {t('settings.fromAssessment')}
                                </Link>
                            )}
                            <CopyCheckCriteriaPanel
                                assessmentId={assessmentId}
                                subject={copyCheckSettings.subject}
                                disabled={sending}
                            />
                        </div>
                    )}

                    <div className="pb-safe-3 sticky bottom-0 -mx-4 flex flex-col gap-2 border-t border-neutral-200 bg-white px-4 py-3 sm:static sm:mx-0 sm:rounded-lg sm:border">
                        <div
                            className={cn(
                                'flex flex-wrap items-center justify-between gap-2 text-caption',
                                cost.sufficient === false ? 'text-danger-600' : 'text-neutral-600'
                            )}
                        >
                            <span className="flex items-center gap-1">
                                <Coins size={14} className="text-primary-500" />
                                {cost.credits == null
                                    ? t('assessment.costPending')
                                    : t('assessment.cost', {
                                          count: copies.length,
                                          pages: t('tray.pages', { count: pageTotal }),
                                          credits: cost.credits,
                                      })}
                            </span>
                            {cost.currentBalance != null && (
                                <span>
                                    {t('assessment.balance', { count: cost.currentBalance })}
                                </span>
                            )}
                        </div>
                        {cost.sufficient === false && (
                            <p className="text-caption text-danger-600">
                                {t('assessment.insufficient')}
                            </p>
                        )}
                        <MyButton
                            type="button"
                            buttonType="primary"
                            scale="large"
                            className="w-full"
                            disabled={!canSend}
                            onClick={() => {
                                // No students on the test: nothing to match, so just check.
                                if (!hasStudents) {
                                    send.mutate(false);
                                    return;
                                }
                                const decided = decideStudentMapping(studentMapping, hasStudents);
                                if (decided.ask) setChoiceOpen(true);
                                else send.mutate(decided.mapStudents);
                            }}
                        >
                            <Sparkle size={18} weight="fill" />
                            {sending
                                ? t('assessment.sending', {
                                      done: Object.values(progress).filter((s) => s !== 'working')
                                          .length,
                                      total: copies.length,
                                  })
                                : t('assessment.send', { count: copies.length })}
                        </MyButton>
                        {!hasStudents ? (
                            <p className="text-caption text-neutral-500">
                                {t('assessment.checkOnlyNote')}
                            </p>
                        ) : (
                            studentMapping !== 'ASK' && (
                                <p className="text-caption text-neutral-500">
                                    {studentMapping === 'CHECK_ONLY'
                                        ? tIntake('mapping.decidedCheckOnly')
                                        : tIntake('mapping.decidedMap')}
                                </p>
                            )
                        )}
                    </div>
                </section>
            )}

            {/* Results: progress, copies to place, and the checked-copies zip */}
            {/* A batch just started shows straight away, before the list refetch lands. */}
            {(batches.length > 0 || focusBatchId) &&
                (resultsOpen ? (
                    <CopyIntakeBatchPanel
                        key={focusBatchId ?? 'latest'}
                        assessmentId={assessmentId}
                        instituteId={instituteId}
                        examType={examType}
                        packageSessionIds={packageSessionIds}
                        initialBatchId={focusBatchId}
                        onClose={() => setResultsOpen(false)}
                    />
                ) : (
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="medium"
                        onClick={() => setResultsOpen(true)}
                    >
                        {t('assessment.showResults', { count: batches.length })}
                    </MyButton>
                ))}

            <MapStudentsChoiceDialog
                open={choiceOpen}
                onOpenChange={setChoiceOpen}
                copies={copies.length}
                canMap={hasStudents}
                onConfirm={(mapStudents) => {
                    setChoiceOpen(false);
                    send.mutate(mapStudents);
                }}
            />

            {scannerOpen && <CameraScanner scanQuality={settings.scanQuality} onDone={addScans} />}
        </div>
    );
}
