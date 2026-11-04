import { useEffect, useRef, useState } from 'react';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
    ArrowLeft,
    Camera,
    CircleNotch,
    Coins,
    FilePdf,
    Sparkle,
    Trash,
    UploadSimple,
    WarningCircle,
} from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { getInstituteId } from '@/constants/helper';
import { TokenKey } from '@/constants/auth/tokens';
import { getTokenDecodedData, getTokenFromCookie } from '@/lib/auth/sessionUtility';
import { useFileUpload } from '@/hooks/use-file-upload';
import { getPublicUrl } from '@/services/upload_file';
import { countPdfPages } from '@/services/pdf-page-count';
import {
    estimatePaperDigitise,
    isInsufficientCreditsError,
    paperDigitiseErrorMessage,
    rememberPendingPaperRead,
    startPaperDigitise,
    type PaperDigitiseEstimate,
} from '@/services/paper-digitise';
import { cn } from '@/lib/utils';
import { CameraScanner } from './-components/CameraScanner';
import { PaperPagesTray } from './-components/PaperPagesTray';
import { createCopyCheckAssessment } from './-lib/create-assessment';
import { scanPagesToPdfFile, toScanPage, type ScanPage } from './-lib/scan-pdf';
import { useEvalezySettings } from './-hooks/useEvalezySettings';

export const Route = createFileRoute('/evalezy/new')({
    component: EvalezyNewAssessmentPage,
});

const MAX_PAPER_MB = 25;
/** The paper read refuses longer papers. */
const MAX_PAPER_PAGES = 30;

interface Paper {
    file: File;
    pages: number | null;
    state: 'uploading' | 'ready' | 'error';
    url?: string;
    estimate?: PaperDigitiseEstimate;
    error?: string;
}

/**
 * New assessment in the Evalezy app: name, total marks and the question paper
 * (a PDF, or photos of it, picked or taken here, that become one PDF once their
 * order has been checked). Create makes a published,
 * hand-checked test with the paper attached and starts the paper read; the
 * assessment page then shows the read and its review ("Enable AI checking"),
 * after which copies can be checked.
 */
function EvalezyNewAssessmentPage() {
    const { t } = useTranslation('evalezy');
    const navigate = useNavigate();
    const instituteId = getInstituteId() ?? '';
    const userId = getTokenDecodedData(getTokenFromCookie(TokenKey.accessToken))?.user ?? '';
    const { settings } = useEvalezySettings();
    const { uploadFile } = useFileUpload();
    const [, setIsUploading] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    const [name, setName] = useState('');
    const [marks, setMarks] = useState('');
    const [paper, setPaper] = useState<Paper | null>(null);
    const [preparing, setPreparing] = useState(false);
    // Photos of the paper, in page order, until the teacher confirms them.
    const [pages, setPages] = useState<ScanPage[]>([]);
    const [scannerOpen, setScannerOpen] = useState(false);
    const pagesRef = useRef(pages);
    pagesRef.current = pages;
    useEffect(() => () => pagesRef.current.forEach((p) => URL.revokeObjectURL(p.url)), []);
    // Only the newest pick may write its upload result back.
    const pickSeq = useRef(0);

    const totalMarks = Number(marks);
    const marksValid = Number.isFinite(totalMarks) && totalMarks > 0 && totalMarks <= 1000;
    const estimate = paper?.estimate?.estimate;
    const insufficient = estimate?.sufficient === false;
    const tooLong = (paper?.pages ?? 0) > MAX_PAPER_PAGES;
    const canCreate =
        name.trim().length > 0 &&
        marksValid &&
        paper?.state === 'ready' &&
        !insufficient &&
        !tooLong &&
        !preparing;

    /** Upload the paper for the read (a public link: the AI fetches it) and price the read. */
    const takePaper = async (file: File, pages: number | null) => {
        if (file.size > MAX_PAPER_MB * 1024 * 1024) {
            toast.error(t('create.tooLarge', { mb: MAX_PAPER_MB }));
            return;
        }
        const seq = ++pickSeq.current;
        setPaper({ file, pages, state: 'uploading' });
        try {
            const fileId = await uploadFile({
                file,
                setIsUploading,
                userId,
                source: instituteId,
                sourceId: 'ASSESSMENT_OFFLINE_ENTRY',
                publicUrl: true,
            });
            if (!fileId) throw new Error('upload failed');
            const url = await getPublicUrl(fileId);
            if (!url) throw new Error('no link for the uploaded paper');
            const priced = await estimatePaperDigitise(url);
            if (seq !== pickSeq.current) return;
            setPaper({ file, pages: priced.pages || pages, state: 'ready', url, estimate: priced });
        } catch (error) {
            if (seq !== pickSeq.current) return;
            setPaper({
                file,
                pages,
                state: 'error',
                error: paperDigitiseErrorMessage(error, t('create.uploadFailed')),
            });
        }
    };

    const onPick = async (picked: File[]) => {
        if (picked.length === 0) return;
        const pdf = picked.find((f) => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
        if (pdf) {
            if (picked.length > 1) toast.info(t('create.onePdf'));
            let pages: number | null = null;
            const url = URL.createObjectURL(pdf);
            try {
                pages = await countPdfPages(url);
            } catch {
                pages = null;
            } finally {
                URL.revokeObjectURL(url);
            }
            await takePaper(pdf, pages);
            return;
        }
        const photos = picked.filter((f) => f.type.startsWith('image/'));
        if (photos.length === 0) {
            toast.error(t('create.notSupported'));
            return;
        }
        // Photos join the paper's pages in the order picked; the tray lets the teacher fix it.
        setPreparing(true);
        const added: ScanPage[] = [];
        try {
            for (const photo of photos) added.push(await toScanPage(photo, settings.scanQuality));
            setPages((prev) => [...prev, ...added]);
        } catch {
            added.forEach((p) => URL.revokeObjectURL(p.url));
            toast.error(t('create.photosFailed'));
        } finally {
            setPreparing(false);
        }
    };

    /** The checked pages become one PDF. They stay here so the teacher can come back to them. */
    const usePages = async () => {
        setPreparing(true);
        try {
            const file = await scanPagesToPdfFile(pages, t('create.paperFileName'));
            await takePaper(file, pages.length);
        } catch {
            toast.error(t('create.photosFailed'));
        } finally {
            setPreparing(false);
        }
    };

    const clearPaper = () => {
        pickSeq.current++;
        setPaper(null);
        pages.forEach((p) => URL.revokeObjectURL(p.url));
        setPages([]);
    };

    const create = useMutation({
        mutationFn: async () => {
            if (!paper?.url) throw new Error(t('create.uploadFailed'));
            const title = name.trim();
            const assessmentId = await createCopyCheckAssessment({
                instituteId,
                name: title,
                totalMarks,
                paperUrl: paper.url,
                paperName: paper.file.name,
            });
            // The read takes minutes and runs on the server; the assessment page shows it.
            let readStarted = true;
            try {
                const started = await startPaperDigitise({
                    pdfUrl: paper.url,
                    expectedTotalMarks: totalMarks,
                    title,
                    assessmentId,
                    returnPath: `/evalezy/${assessmentId}`,
                });
                rememberPendingPaperRead({
                    taskId: started.task_id,
                    assessmentId,
                    name: title,
                    path: `/evalezy/${assessmentId}`,
                });
            } catch (error) {
                readStarted = false;
                toast.error(
                    isInsufficientCreditsError(error)
                        ? t('create.readNoCredits')
                        : paperDigitiseErrorMessage(error, t('create.readFailed'))
                );
            }
            return { assessmentId, readStarted };
        },
        onSuccess: ({ assessmentId, readStarted }) => {
            if (readStarted) toast.success(t('create.created'));
            navigate({ to: '/evalezy/$assessmentId', params: { assessmentId } });
        },
        onError: (error) =>
            toast.error(error instanceof Error ? error.message : t('create.createFailed')),
    });

    const busy = create.isPending;

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
                <h1 className="text-h3 font-semibold text-neutral-800">{t('create.title')}</h1>
                <p className="text-body text-neutral-500">{t('create.subtitle')}</p>
            </div>

            <section className="flex flex-col gap-4 rounded-lg border border-neutral-200 bg-white p-4">
                <MyInput
                    label={t('create.name')}
                    required
                    inputType="text"
                    inputPlaceholder={t('create.namePlaceholder')}
                    input={name}
                    onChangeFunction={(e) => setName(e.target.value)}
                    disabled={busy}
                    className="w-full sm:w-full"
                />
                <MyInput
                    label={t('create.marks')}
                    required
                    inputType="number"
                    inputPlaceholder={t('create.marksPlaceholder')}
                    input={marks}
                    onChangeFunction={(e) => setMarks(e.target.value)}
                    disabled={busy}
                    error={marks && !marksValid ? t('create.marksInvalid') : null}
                    className="w-full sm:w-full"
                />

                <div className="flex flex-col gap-2">
                    <p className="text-subtitle text-neutral-800">
                        {t('create.paper')}
                        <span className="text-danger-600">*</span>
                    </p>
                    <input
                        ref={inputRef}
                        type="file"
                        multiple
                        accept={pages.length > 0 ? 'image/*' : 'application/pdf,image/*'}
                        className="hidden"
                        onChange={(e) => {
                            const files = Array.from(e.target.files ?? []);
                            e.target.value = '';
                            void onPick(files);
                        }}
                    />
                    {!paper && !preparing && pages.length > 0 ? (
                        <PaperPagesTray
                            pages={pages}
                            maxPages={MAX_PAPER_PAGES}
                            allowCamera={settings.allowCamera}
                            onChange={setPages}
                            onTakeMore={() => setScannerOpen(true)}
                            onPickMore={() => inputRef.current?.click()}
                            onConfirm={() => void usePages()}
                        />
                    ) : !paper && !preparing ? (
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            {settings.allowCamera && (
                                <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => setScannerOpen(true)}
                                    className="flex flex-col items-center gap-2 rounded-lg border-2 border-primary-200 bg-primary-50 px-4 py-6 text-center transition-colors hover:border-primary-400"
                                >
                                    <Camera size={28} className="text-primary-500" />
                                    <span className="text-subtitle font-semibold text-neutral-800">
                                        {t('create.paperScan')}
                                    </span>
                                    <span className="text-caption text-neutral-500">
                                        {t('create.paperScanHint')}
                                    </span>
                                </button>
                            )}
                            <button
                                type="button"
                                disabled={busy}
                                onClick={() => inputRef.current?.click()}
                                className="flex flex-col items-center gap-2 rounded-lg border-2 border-dashed border-neutral-300 bg-neutral-50 px-4 py-6 text-center transition-colors hover:border-primary-400 hover:bg-primary-50"
                            >
                                <UploadSimple size={28} className="text-primary-500" />
                                <span className="text-subtitle font-semibold text-neutral-800">
                                    {t('create.paperPick')}
                                </span>
                                <span className="text-caption text-neutral-500">
                                    {t('create.paperHint')}
                                </span>
                            </button>
                        </div>
                    ) : preparing ? (
                        <div className="flex items-center gap-2 rounded-lg border border-neutral-200 p-3 text-body text-neutral-600">
                            <CircleNotch size={18} className="animate-spin text-primary-500" />
                            {t('create.preparingPhotos')}
                        </div>
                    ) : paper ? (
                        <div
                            className={cn(
                                'flex flex-col gap-2 rounded-lg border p-3',
                                paper.state === 'error'
                                    ? 'border-danger-200 bg-danger-50'
                                    : 'border-neutral-200'
                            )}
                        >
                            <div className="flex items-center gap-3">
                                <FilePdf size={24} className="shrink-0 text-danger-500" />
                                <div className="flex min-w-0 flex-1 flex-col">
                                    <span className="truncate text-body font-medium text-neutral-800">
                                        {paper.file.name}
                                    </span>
                                    <span className="text-caption text-neutral-500">
                                        {paper.state === 'uploading'
                                            ? t('create.uploading')
                                            : paper.pages
                                              ? t('create.pages', { count: paper.pages })
                                              : ''}
                                    </span>
                                </div>
                                {!busy && paper.state !== 'uploading' && (
                                    <MyButton
                                        type="button"
                                        buttonType="text"
                                        scale="small"
                                        layoutVariant="icon"
                                        aria-label={t('create.removePaper')}
                                        onClick={clearPaper}
                                    >
                                        <Trash size={16} />
                                    </MyButton>
                                )}
                            </div>
                            {paper.state === 'error' && (
                                <p className="text-caption text-danger-700">{paper.error}</p>
                            )}
                            {pages.length > 0 && !busy && paper.state !== 'uploading' && (
                                <MyButton
                                    type="button"
                                    buttonType="secondary"
                                    scale="small"
                                    className="h-9 w-full sm:w-fit"
                                    onClick={() => {
                                        pickSeq.current++;
                                        setPaper(null);
                                    }}
                                >
                                    {t('create.editPages')}
                                </MyButton>
                            )}
                            {tooLong && (
                                <p className="text-caption text-danger-700">
                                    {t('create.tooManyPages', { max: MAX_PAPER_PAGES })}
                                </p>
                            )}
                        </div>
                    ) : null}
                </div>

                {estimate && (
                    <div
                        className={cn(
                            'flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-body',
                            insufficient
                                ? 'border-danger-200 bg-danger-50 text-danger-700'
                                : 'border-neutral-200 bg-neutral-50 text-neutral-700'
                        )}
                    >
                        <span className="flex items-center gap-2">
                            <Coins size={16} className="text-primary-500" />
                            {t('create.readCost', { credits: estimate.estimated_credits })}
                        </span>
                        {estimate.current_balance != null && (
                            <span className="text-caption text-neutral-500">
                                {t('assessment.balance', { count: estimate.current_balance })}
                            </span>
                        )}
                    </div>
                )}
                {insufficient && (
                    <p className="flex items-start gap-2 text-caption text-danger-600">
                        <WarningCircle size={16} className="mt-px shrink-0" />
                        {t('create.insufficient')}
                    </p>
                )}

                <p className="text-caption text-neutral-500">{t('create.howItWorks')}</p>

                <MyButton
                    type="button"
                    buttonType="primary"
                    scale="large"
                    className="w-full"
                    disabled={!canCreate || busy}
                    onClick={() => create.mutate()}
                >
                    <Sparkle size={18} weight="fill" />
                    {busy ? t('create.creating') : t('create.submit')}
                </MyButton>
            </section>

            {scannerOpen && (
                <CameraScanner
                    singleDocument
                    scanQuality={settings.scanQuality}
                    onDone={(scanned) => {
                        setScannerOpen(false);
                        setPages((prev) => [...prev, ...scanned.flat()]);
                    }}
                />
            )}
        </div>
    );
}
