import { useEffect, useMemo, useRef, useState } from 'react';
import {
    MagicWand,
    Code,
    Spinner,
    Image as ImageIcon,
    FilePdf,
    X,
    ArrowArcLeft,
    ArrowArcRight,
} from '@phosphor-icons/react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { MyButton } from '@/components/design-system/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { UploadFileInS3, getPublicUrl } from '@/services/upload_file';
import { getTokenFromCookie, getTokenDecodedData } from '@/lib/auth/sessionUtility';
import { TokenKey } from '@/constants/auth/tokens';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { useToolCostPreview } from '@/components/common/ai-credits/useToolCostPreview';
import { Slide } from '../../-hooks/use-slides';
import { getInitialHtmlDocContent } from './html-doc-utils';
import {
    generateHtmlDocumentStream,
    buildHtmlContentTypes,
    startHtmlDocJob,
    pollHtmlDocJob,
    getActiveHtmlDocJob,
    cancelHtmlDocJob,
    ackHtmlDocJob,
    type GenerateHtmlParams,
    type HtmlDocJob,
} from './html-doc-ai-service';
import { HtmlDocGenerationProgress, type GenerationProgress } from './html-doc-generation-progress';
import { HtmlSlidePreview } from '@/components/html-slide/html-slide-preview';

type HtmlDocAiAuthorProps = {
    slide: Slide;
    isLearnerView?: boolean;
    onHtmlChange: (slideId: string, html: string) => void;
};

type UploadedImage = { url: string; name: string };
type UploadedPdf = { fileId: string; name: string };

function currentUserId(): string {
    const data = getTokenDecodedData(getTokenFromCookie(TokenKey.accessToken));
    return (data as unknown as { userId?: string; sub?: string })?.userId || data?.sub || '';
}

/**
 * Authoring surface for the HTML Document slide type — no rich-text editor.
 * The admin supplies materials (images, a PDF, key points) + picks the content
 * sections they want, then AI generates a creative, self-contained HTML page
 * (rendered in a sandboxed iframe). Editing is conversational: each instruction
 * produces a new, revertible version.
 */
export function HtmlDocAiAuthor({
    slide,
    isLearnerView = false,
    onHtmlChange,
}: HtmlDocAiAuthorProps) {
    const { t } = useTranslation('studyLibraryHtmlDocAiAuthor');
    const htmlContentTypes = useMemo(() => buildHtmlContentTypes(t), [t]);
    const initial = useMemo(() => getInitialHtmlDocContent(slide), [slide.id]); // eslint-disable-line react-hooks/exhaustive-deps
    // Version history (in-session). versions[versionIndex] is the live doc.
    const [versions, setVersions] = useState<string[]>(initial ? [initial] : []);
    const [versionIndex, setVersionIndex] = useState(initial ? 0 : -1);

    const [prompt, setPrompt] = useState('');
    const [keyPoints, setKeyPoints] = useState('');
    const [contentTypes, setContentTypes] = useState<string[]>([]);
    const [images, setImages] = useState<UploadedImage[]>([]);
    const [pdf, setPdf] = useState<UploadedPdf | null>(null);
    const [isGenerating, setIsGenerating] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [showSource, setShowSource] = useState(false);
    // Bring-your-own HTML (create only) — paste a page made elsewhere instead of generating.
    const [showPaste, setShowPaste] = useState(false);
    const [pastedHtml, setPastedHtml] = useState('');
    const [testResult, setTestResult] = useState<string | null>(null);
    // Live-stream buffer while generating (null = not streaming).
    const [streamingHtml, setStreamingHtml] = useState<string | null>(null);
    // Live phase / section / picture count while generating (drives the
    // step-by-step progress panel).
    const [progress, setProgress] = useState<GenerationProgress | null>(null);
    const abortRef = useRef<AbortController | null>(null);
    const streamTsRef = useRef(0);
    // Background job being polled (generation runs server-side and survives
    // the author leaving the page). Null when nothing is running.
    const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
    const jobHtmlRef = useRef('');

    // Institute brand kit — applied so slides across a course share an identity.
    const { instituteDetails } = useInstituteDetailsStore();
    const brandColor = instituteDetails?.institute_theme_code || '';
    const brandName = instituteDetails?.institute_name || '';
    const [brandLogoUrl, setBrandLogoUrl] = useState('');
    const [useBrand, setUseBrand] = useState(true);
    const hasBrand = !!(brandColor || brandLogoUrl);

    useEffect(() => {
        const fileId = instituteDetails?.institute_logo_file_id;
        if (!fileId) return;
        let active = true;
        void getPublicUrl(fileId).then((url) => {
            if (active && url) setBrandLogoUrl(url);
        });
        return () => {
            active = false;
        };
    }, [instituteDetails?.institute_logo_file_id]);

    const slideIdRef = useRef(slide.id);
    slideIdRef.current = slide.id;
    const imageInputRef = useRef<HTMLInputElement | null>(null);
    const pdfInputRef = useRef<HTMLInputElement | null>(null);

    const html = (versionIndex >= 0 ? versions[versionIndex] : '') ?? '';
    const hasContent = !!html.trim();

    // Per-generation credit cost (read live from cached tool-pricing rates).
    // Create and edit are priced differently.
    const { credits: costCredits } = useToolCostPreview(
        hasContent ? 'html_document_edit' : 'html_document',
        {}
    );

    const commit = (next: string) => onHtmlChange(slideIdRef.current, next);

    const pushVersion = (next: string) => {
        setVersions((prev) => {
            const trimmed = prev.slice(0, versionIndex + 1);
            const updated = [...trimmed, next];
            setVersionIndex(updated.length - 1);
            return updated;
        });
        commit(next);
    };

    const goToVersion = (idx: number) => {
        const target = versions[idx];
        if (target === undefined) return;
        setVersionIndex(idx);
        commit(target);
    };

    // Poll callbacks outlive the render that created them — always call the
    // latest pushVersion so the version index they splice at is current.
    const pushVersionRef = useRef(pushVersion);
    pushVersionRef.current = pushVersion;
    const htmlRef = useRef(html);
    htmlRef.current = html;

    const resetGenerating = () => {
        abortRef.current = null;
        jobHtmlRef.current = '';
        setActiveTaskId(null);
        setStreamingHtml(null);
        setProgress(null);
        setIsGenerating(false);
    };

    /** Show a running (or just-started) job and start polling it. */
    const attachJob = (job: HtmlDocJob) => {
        jobHtmlRef.current = job.html || '';
        streamTsRef.current = 0;
        setIsGenerating(true);
        setStreamingHtml(jobHtmlRef.current);
        setProgress(progressFromJob(job));
        setActiveTaskId(job.task_id);
    };

    /** A job reached a terminal state — apply / report it once, then forget it. */
    const settleJob = (job: HtmlDocJob, { resumed }: { resumed: boolean }) => {
        if (job.slide_id && job.slide_id !== slideIdRef.current) return;
        if (job.status === 'COMPLETED' && job.html.trim()) {
            // Already the live page (applied earlier, ack didn't land) — don't duplicate.
            if (job.html !== htmlRef.current) pushVersionRef.current(job.html);
            setPrompt('');
            toast.success(
                resumed
                    ? t('toast.finishedWhileAway')
                    : job.is_edit
                      ? t('toast.updated')
                      : t('toast.documentCreated')
            );
        } else if (job.status === 'INTERRUPTED') {
            toast.error(t('toast.generationInterrupted'));
        } else if (job.status === 'FAILED') {
            toast.error(job.error || t('toast.generationFailed'));
        }
        if (job.status !== 'CANCELLED') {
            // The parent saves the draft on a 4 s debounce. Ack only after that,
            // so leaving right away re-offers the page instead of losing it.
            const ackDelay = job.status === 'COMPLETED' ? 6000 : 0;
            setTimeout(() => void ackHtmlDocJob(job.task_id).catch(() => undefined), ackDelay);
        }
        resetGenerating();
    };

    // Coming (back) to a slide: pick up a generation that is still running or
    // that finished / failed while the author was away.
    useEffect(() => {
        if (isLearnerView) return;
        let active = true;
        resetGenerating();
        void getActiveHtmlDocJob(slide.id)
            .then((job) => {
                if (!active || !job) return;
                if (job.status === 'PROGRESS') attachJob(job);
                else settleJob(job, { resumed: true });
            })
            .catch(() => undefined); // older ai-service without jobs — nothing to resume
        return () => {
            active = false;
        };
    }, [slide.id, isLearnerView]); // eslint-disable-line react-hooks/exhaustive-deps

    // Poll the active job. Unmounting / switching slide only stops watching —
    // the server keeps generating and the effect above re-attaches later.
    useEffect(() => {
        if (!activeTaskId) return;
        let stopped = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let failures = 0;
        const tick = async () => {
            try {
                const job = await pollHtmlDocJob(activeTaskId, jobHtmlRef.current.length);
                failures = 0;
                if (stopped) return;
                if (job.status === 'PROGRESS') {
                    jobHtmlRef.current += job.html;
                    setProgress(progressFromJob(job));
                    const now = Date.now();
                    if (job.html && now - streamTsRef.current > 1500) {
                        // Re-rendering the iframe is heavy — refresh the live
                        // preview at most every 1.5 s.
                        streamTsRef.current = now;
                        setStreamingHtml(jobHtmlRef.current);
                    }
                } else {
                    settleJob(job, { resumed: false });
                    return;
                }
            } catch {
                // Transient network / pod blip — keep trying for a while.
                if (++failures >= 15) {
                    toast.error(t('toast.lostConnection'));
                    resetGenerating();
                    return;
                }
            }
            if (!stopped) timer = setTimeout(() => void tick(), 2000);
        };
        timer = setTimeout(() => void tick(), 1000);
        return () => {
            stopped = true;
            if (timer) clearTimeout(timer);
        };
    }, [activeTaskId]); // eslint-disable-line react-hooks/exhaustive-deps

    const toggleType = (key: string) =>
        setContentTypes((prev) =>
            prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
        );

    const onPickImages = async (files: FileList | null) => {
        if (!files || !files.length) return;
        setIsUploading(true);
        try {
            const userId = currentUserId();
            const uploaded: UploadedImage[] = [];
            for (const file of Array.from(files)) {
                const fileId = await UploadFileInS3(
                    file,
                    () => {},
                    userId,
                    'STUDENTS',
                    undefined,
                    true
                );
                if (!fileId) continue;
                const url = await getPublicUrl(fileId);
                if (url) uploaded.push({ url, name: file.name });
            }
            if (uploaded.length) setImages((prev) => [...prev, ...uploaded]);
        } catch {
            toast.error(t('toast.someImagesFailed'));
        } finally {
            setIsUploading(false);
            if (imageInputRef.current) imageInputRef.current.value = '';
        }
    };

    const onPickPdf = async (files: FileList | null) => {
        const file = files?.[0];
        if (!file) return;
        setIsUploading(true);
        try {
            const fileId = await UploadFileInS3(file, () => {}, currentUserId(), 'STUDENTS');
            if (fileId) setPdf({ fileId, name: file.name });
        } catch {
            toast.error(t('toast.pdfFailed'));
        } finally {
            setIsUploading(false);
            if (pdfInputRef.current) pdfInputRef.current.value = '';
        }
    };

    const runGenerate = async () => {
        const text = prompt.trim();
        const kp = keyPoints
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean);
        // For a first generation we need SOMETHING to work from.
        if (!hasContent && !text && !contentTypes.length && !kp.length && !pdf) {
            toast.error(t('toast.describeRequired'));
            return;
        }
        const params: GenerateHtmlParams = {
            prompt: text,
            currentHtml: hasContent ? html : null,
            brand:
                useBrand && hasBrand
                    ? { primaryColor: brandColor, logoUrl: brandLogoUrl, name: brandName }
                    : null,
            contentTypes: hasContent ? undefined : contentTypes,
            keyPoints: kp,
            imageUrls: images.map((i) => i.url),
            referenceFileIds: pdf ? [pdf.fileId] : undefined,
        };
        setIsGenerating(true);
        setStreamingHtml('');
        setProgress({ phase: pdf ? 'reading_pdf' : 'planning', hasPdf: !!pdf, elapsedSeconds: 0 });
        try {
            attachJob(await startHtmlDocJob({ ...params, slideId: slide.id }));
        } catch (e) {
            const statusCode = (e as { response?: { status?: number } })?.response?.status;
            if (statusCode === 404 || statusCode === 405) {
                // ai-service not yet on the jobs API — stream in this tab instead.
                await runStreamInTab(params);
                return;
            }
            const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data
                ?.detail;
            toast.error(detail || (e instanceof Error ? e.message : t('toast.generationFailed')));
            resetGenerating();
        }
    };

    /** Legacy in-tab SSE flow (dies with the tab) — fallback only. */
    const runStreamInTab = async (params: GenerateHtmlParams) => {
        streamTsRef.current = 0;
        const controller = new AbortController();
        abortRef.current = controller;
        const startedAt = Date.now();
        const elapsed = () => Math.round((Date.now() - startedAt) / 1000);
        try {
            const generated = await generateHtmlDocumentStream(params, {
                signal: controller.signal,
                onImageProgress: (completed, total) =>
                    setProgress({
                        phase: 'images',
                        imagesDone: completed,
                        imagesTotal: total,
                        elapsedSeconds: elapsed(),
                    }),
                onDelta: (acc) => {
                    const now = Date.now();
                    if (now - streamTsRef.current > 350) {
                        streamTsRef.current = now;
                        setStreamingHtml(acc);
                        setProgress({
                            phase: 'writing',
                            contentChars: acc.length,
                            expectedChars: params.currentHtml?.length,
                            elapsedSeconds: elapsed(),
                        });
                    }
                },
            });
            pushVersion(generated);
            setPrompt('');
            toast.success(params.currentHtml ? t('toast.updated') : t('toast.documentCreated'));
        } catch (e) {
            if ((e as Error)?.name === 'AbortError') {
                toast.info(t('toast.generationCancelled'));
            } else {
                toast.error(e instanceof Error ? e.message : t('toast.generationFailed'));
            }
        } finally {
            resetGenerating();
        }
    };

    const cancelGenerate = () => {
        if (activeTaskId) {
            const id = activeTaskId;
            resetGenerating();
            void cancelHtmlDocJob(id)
                .then(() => toast.info(t('toast.generationCancelled')))
                .catch(() => toast.error(t('toast.generationFailed')));
            return;
        }
        abortRef.current?.abort();
    };

    const usePastedHtml = () => {
        const next = pastedHtml.trim();
        if (!next) {
            toast.error(t('toast.pasteHtmlFirst'));
            return;
        }
        if (!next.includes('<')) {
            toast.error(t('toast.notHtml'));
            return;
        }
        pushVersion(next);
        setPastedHtml('');
        setShowPaste(false);
        toast.success(t('toast.htmlAdded'));
    };

    if (isLearnerView) {
        return (
            <div className="mx-auto w-full max-w-5xl px-4 pb-10">
                <HtmlSlidePreview html={html} />
            </div>
        );
    }

    return (
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 pb-10">
            {/* Compose / edit controls */}
            <div className="rounded-lg border border-primary-100 bg-primary-50 p-3">
                <div className="mb-2 flex items-center gap-2 text-subtitle font-semibold text-primary-500">
                    <MagicWand className="size-4" />
                    {hasContent ? t('editWithAi') : t('createWithAi')}
                </div>

                {/* Materials (create) — attach reference PDF + images, pick sections */}
                {!hasContent && (
                    <div className="mb-3 flex flex-col gap-3">
                        <div className="flex flex-wrap items-center gap-2">
                            <input
                                ref={imageInputRef}
                                type="file"
                                accept="image/*"
                                multiple
                                className="hidden"
                                onChange={(e) => void onPickImages(e.target.files)}
                            />
                            <input
                                ref={pdfInputRef}
                                type="file"
                                accept="application/pdf"
                                className="hidden"
                                onChange={(e) => void onPickPdf(e.target.files)}
                            />
                            <MyButton
                                buttonType="secondary"
                                scale="small"
                                disable={isUploading}
                                onClick={() => imageInputRef.current?.click()}
                            >
                                <ImageIcon className="size-4" /> {t('addImages')}
                            </MyButton>
                            <MyButton
                                buttonType="secondary"
                                scale="small"
                                disable={isUploading || !!pdf}
                                onClick={() => pdfInputRef.current?.click()}
                            >
                                <FilePdf className="size-4" /> {t('attachPdf')}
                            </MyButton>
                            <MyButton
                                buttonType="secondary"
                                scale="small"
                                onClick={() => setShowPaste((s) => !s)}
                            >
                                <Code className="size-4" />
                                {showPaste ? t('hidePasteBox') : t('pasteHtml')}
                            </MyButton>
                            {isUploading && (
                                <Spinner className="size-4 animate-spin text-primary-500" />
                            )}
                        </div>

                        {/* Bring-your-own HTML — skip generation entirely */}
                        {showPaste && (
                            <div className="flex flex-col gap-2 rounded-md border border-neutral-200 bg-white p-3">
                                <span className="text-caption text-neutral-500">
                                    {t('pasteHtmlHint')}
                                </span>
                                <Textarea
                                    value={pastedHtml}
                                    onChange={(e) => setPastedHtml(e.target.value)}
                                    spellCheck={false}
                                    placeholder="<!doctype html>…"
                                    className="min-h-40 resize-y whitespace-pre font-mono text-caption"
                                />
                                <div className="flex justify-end">
                                    <MyButton
                                        buttonType="primary"
                                        scale="small"
                                        disable={!pastedHtml.trim()}
                                        onClick={usePastedHtml}
                                    >
                                        <Code className="size-4" /> {t('useThisHtml')}
                                    </MyButton>
                                </div>
                            </div>
                        )}
                        {pdf && (
                            <p className="text-caption text-neutral-400">{t('pdfGroundingHint')}</p>
                        )}

                        {/* Uploaded material chips */}
                        {(images.length > 0 || pdf) && (
                            <div className="flex flex-wrap gap-2">
                                {pdf && (
                                    <span
                                        className="flex items-center gap-1 rounded-md border border-neutral-200 bg-white px-2 py-1 text-caption text-neutral-600"
                                        title={t('pdfGroundingHint')}
                                    >
                                        <FilePdf className="size-3.5 text-danger-500" />
                                        {pdf.name}
                                        <button type="button" onClick={() => setPdf(null)}>
                                            <X className="size-3.5 text-neutral-400 hover:text-danger-500" />
                                        </button>
                                    </span>
                                )}
                                {images.map((img, i) => (
                                    <span
                                        key={img.url}
                                        className="flex items-center gap-1 rounded-md border border-neutral-200 bg-white px-2 py-1 text-caption text-neutral-600"
                                    >
                                        <ImageIcon className="size-3.5 text-primary-500" />
                                        {img.name}
                                        <button
                                            type="button"
                                            onClick={() =>
                                                setImages((prev) => prev.filter((_, j) => j !== i))
                                            }
                                        >
                                            <X className="size-3.5 text-neutral-400 hover:text-danger-500" />
                                        </button>
                                    </span>
                                ))}
                            </div>
                        )}

                        {/* Content-type chips */}
                        <div className="flex flex-col gap-1.5">
                            <span className="text-caption font-medium text-neutral-500">
                                {t('includeOptional')}
                            </span>
                            <div className="flex flex-wrap gap-2">
                                {htmlContentTypes.map((ct) => {
                                    const on = contentTypes.includes(ct.key);
                                    return (
                                        <button
                                            key={ct.key}
                                            type="button"
                                            onClick={() => toggleType(ct.key)}
                                            className={cn(
                                                'rounded-full border px-3 py-1 text-caption transition-colors',
                                                on
                                                    ? 'border-primary-500 bg-primary-500 text-white'
                                                    : 'border-neutral-300 bg-white text-neutral-600 hover:border-primary-300'
                                            )}
                                        >
                                            {ct.label}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Key points */}
                        <Textarea
                            value={keyPoints}
                            onChange={(e) => setKeyPoints(e.target.value)}
                            placeholder={t('keyPointsPlaceholder')}
                            className="min-h-16 resize-y border-neutral-300 text-caption"
                        />
                    </div>
                )}

                {/* Brand kit toggle — keeps slides across a course on-brand */}
                {hasBrand && (
                    <label className="mb-2 flex w-fit cursor-pointer items-center gap-2 text-caption text-neutral-600">
                        <input
                            type="checkbox"
                            checked={useBrand}
                            onChange={(e) => setUseBrand(e.target.checked)}
                            className="accent-primary-500"
                        />
                        <span className="flex items-center gap-1.5">
                            {t('matchBrand', { brand: brandName || t('institute') })}
                            {brandColor && (
                                <span
                                    className="size-3 rounded-full border border-neutral-200"
                                    // Dynamic institute brand color from settings.
                                    style={{ backgroundColor: brandColor }}
                                />
                            )}
                        </span>
                    </label>
                )}

                {/* Prompt / instruction */}
                <div className="flex items-end gap-2">
                    <Textarea
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        disabled={isGenerating}
                        placeholder={
                            hasContent ? t('promptPlaceholderEdit') : t('promptPlaceholderCreate')
                        }
                        className="min-h-16 flex-1 resize-y border-neutral-300 text-body focus-visible:ring-primary-200"
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                                e.preventDefault();
                                void runGenerate();
                            }
                        }}
                    />
                    {isGenerating ? (
                        <MyButton buttonType="secondary" scale="medium" onClick={cancelGenerate}>
                            <X className="size-4" /> {t('cancel')}
                        </MyButton>
                    ) : (
                        <MyButton
                            buttonType="primary"
                            scale="medium"
                            disable={isUploading}
                            onClick={() => void runGenerate()}
                        >
                            <MagicWand className="size-4" />
                            {hasContent ? t('update') : t('generate')}
                            {costCredits != null && (
                                <span className="ms-1 rounded-full bg-white/20 px-1.5 py-0.5 text-caption">
                                    {t('credits', { count: costCredits })}
                                </span>
                            )}
                        </MyButton>
                    )}
                </div>
                <p className="mt-2 text-caption text-neutral-400">{t('authoredByAiHint')}</p>
            </div>

            {/* Result */}
            {streamingHtml !== null ? (
                <div className="overflow-hidden rounded-lg border border-primary-200">
                    <HtmlDocGenerationProgress
                        progress={progress}
                        canLeave={!!activeTaskId}
                        onCancel={cancelGenerate}
                    />
                    {streamingHtml.trim() ? (
                        <HtmlSlidePreview html={streamingHtml} />
                    ) : (
                        <div className="py-12 text-center text-caption text-neutral-400">
                            {t('previewAppearsHere')}
                        </div>
                    )}
                </div>
            ) : hasContent ? (
                <div className="overflow-hidden rounded-lg border border-neutral-200">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-100 bg-neutral-50 px-3 py-2">
                        {/* Version history */}
                        <div className="flex items-center gap-1">
                            <button
                                type="button"
                                title={t('previousVersion')}
                                disabled={versionIndex <= 0}
                                onClick={() => goToVersion(versionIndex - 1)}
                                className="rounded p-1 text-neutral-500 hover:bg-neutral-100 disabled:opacity-40"
                            >
                                <ArrowArcLeft className="size-4" />
                            </button>
                            <div className="flex items-center gap-1">
                                {versions.map((_, i) => (
                                    <button
                                        key={i}
                                        type="button"
                                        title={t('version', { number: i + 1 })}
                                        onClick={() => goToVersion(i)}
                                        className={cn(
                                            'rounded px-1.5 py-0.5 text-caption',
                                            i === versionIndex
                                                ? 'bg-primary-500 text-white'
                                                : 'text-neutral-500 hover:bg-neutral-100'
                                        )}
                                    >
                                        v{i + 1}
                                    </button>
                                ))}
                            </div>
                            <button
                                type="button"
                                title={t('nextVersion')}
                                disabled={versionIndex >= versions.length - 1}
                                onClick={() => goToVersion(versionIndex + 1)}
                                className="rounded p-1 text-neutral-500 hover:bg-neutral-100 disabled:opacity-40"
                            >
                                <ArrowArcRight className="size-4" />
                            </button>
                        </div>
                        <MyButton
                            buttonType="secondary"
                            scale="small"
                            onClick={() => setShowSource((s) => !s)}
                        >
                            <Code className="size-4" />
                            {showSource ? t('hideHtml') : t('viewEditHtml')}
                        </MyButton>
                    </div>
                    {showSource ? (
                        <div className="p-3">
                            <Textarea
                                value={html}
                                onChange={(e) => {
                                    // Edit the live version in place.
                                    const next = e.target.value;
                                    setVersions((prev) => {
                                        const updated = [...prev];
                                        updated[versionIndex] = next;
                                        return updated;
                                    });
                                    commit(next);
                                }}
                                spellCheck={false}
                                className="min-h-80 resize-y whitespace-pre font-mono text-caption"
                            />
                        </div>
                    ) : (
                        <>
                            {testResult && (
                                <div className="border-b border-success-100 bg-success-50 px-3 py-1.5 text-caption text-success-600">
                                    {t('reportsResultsHint', { result: testResult })}
                                </div>
                            )}
                            <HtmlSlidePreview
                                html={html}
                                onResult={(r) => {
                                    const parts: string[] = [];
                                    if (
                                        typeof r.score === 'number' &&
                                        typeof r.maxScore === 'number'
                                    )
                                        parts.push(`${r.score}/${r.maxScore}`);
                                    else if (typeof r.wrong === 'number')
                                        parts.push(t('wrongCount', { count: r.wrong }));
                                    setTestResult(parts.join(' · ') || t('completed'));
                                }}
                            />
                        </>
                    )}
                </div>
            ) : (
                <div
                    className={cn(
                        'flex flex-col items-center justify-center rounded-lg border border-dashed border-neutral-200 py-16 text-center',
                        isGenerating && 'opacity-60'
                    )}
                >
                    <MagicWand className="size-8 text-neutral-300" />
                    <p className="mt-3 text-body font-medium text-neutral-500">
                        {isGenerating ? t('creatingYourPage') : t('noContentYet')}
                    </p>
                    <p className="mt-1 max-w-sm text-caption text-neutral-400">
                        {isGenerating ? t('generatingHint') : t('addMaterialsHint')}
                    </p>
                </div>
            )}
        </div>
    );
}

function progressFromJob(job: HtmlDocJob): GenerationProgress {
    const p = job.progress || {};
    return {
        phase: p.phase ?? 'planning',
        section: p.section,
        hasPdf: p.has_pdf,
        sectionsTotal: p.sections_total ?? undefined,
        sectionsDone: p.sections_done ?? undefined,
        contentChars: p.content_chars ?? job.html_length,
        expectedChars: p.expected_chars ?? undefined,
        imagesDone: p.images_done,
        imagesTotal: p.images_total,
        elapsedSeconds: job.elapsed_seconds,
    };
}
