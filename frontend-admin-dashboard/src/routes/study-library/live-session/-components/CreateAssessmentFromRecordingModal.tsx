import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { ToolCostBadge } from '@/components/common/ai-credits/ToolCostBadge';
import { useToolCostPreview } from '@/components/common/ai-credits/useToolCostPreview';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { useMutation } from '@tanstack/react-query';
import {
    FileText,
    Languages,
    Loader2,
    AlertTriangle,
    Users,
    CheckCircle2,
    Sparkles,
    Info,
    CalendarClock,
    Award,
    Eye,
    Type as TypeIcon,
    ChevronDown,
    ChevronUp,
    Settings2,
    RotateCcw,
    GraduationCap,
} from 'lucide-react';
import { PencilSimple } from '@phosphor-icons/react';
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from '@/components/ui/popover';
import {
    createAssessmentFromRecording,
    publishAssessmentFromRecording,
    type AssessmentArtifact,
    type CreateAssessmentFromRecordingRequest,
    type GeneratedQuestion,
} from '../-services/utils';
import { RecordingAssessmentExportButtons } from './RecordingAssessmentExportButtons';
import { AddToCourseDialog } from './add-to-course/AddToCourseDialog';
import {
    buildQuestionTypes,
    type QuestionTypeCode,
} from './questionTypePresets';

interface BatchSummary {
    package_session_id: string;
    package_name: string;
    level_name?: string;
    session_name?: string;
}

/**
 * Pretty-print an OpenRouter model slug for the chip in the preview header.
 * Drops the provider prefix and title-cases segments, so `google/gemini-3-pro`
 * reads as `Gemini 3 Pro`. The raw slug stays available on the chip's `title`
 * tooltip for power users who want to verify the exact OpenRouter model.
 */
const formatModelLabel = (slug: string): string => {
    const tail = slug.includes('/') ? (slug.split('/').pop() ?? slug) : slug;
    return tail
        .split('-')
        .filter(Boolean)
        .map((part) =>
            /^[a-z]/.test(part) ? part[0]!.toUpperCase() + part.slice(1) : part
        )
        .join(' ');
};

interface CreateAssessmentFromRecordingModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    scheduleId: string;
    recordingId: string;
    detectedLanguage?: string;
    batches?: BatchSummary[];
    /** Transcript URLs published by the worker. Used to auto-suggest a title. */
    sourceTextUrl?: string | null;
    englishTextUrl?: string | null;
    /**
     * When provided, the modal opens directly into the Preview pane with this
     * artifact's questions already loaded — bypassing the form + generation
     * step entirely. Used by the "Past papers" reuse flow so teachers can
     * re-export PDFs or re-publish without spending another LLM call.
     */
    initialArtifact?: AssessmentArtifact | null;
}

/**
 * Two-state modal:
 *   - Form state — teacher fills date/marks/visibility, clicks Generate.
 *   - Preview state — shows generated title + questions in a scrollable list.
 *
 * All visual tokens use the institute theme (primary-500/100/50) and shadcn
 * primitives so a re-skinned institute automatically picks up new colors.
 */
export function CreateAssessmentFromRecordingModal({
    open,
    onOpenChange,
    scheduleId,
    recordingId,
    detectedLanguage,
    batches,
    sourceTextUrl,
    englishTextUrl,
    initialArtifact,
}: CreateAssessmentFromRecordingModalProps) {
    const { t } = useTranslation('studyLibraryCreateAssessmentFromRecordingModal');
    const [startDateTime, setStartDateTime] = useState<string>(defaultStartDateTime());
    const [endDateTime, setEndDateTime] = useState<string>(defaultEndDateTime());
    const [marksPerQuestion, setMarksPerQuestion] = useState<number>(4);
    const [negativeMarkingEnabled, setNegativeMarkingEnabled] = useState<boolean>(false);
    const [negativeMarkPerQuestion, setNegativeMarkPerQuestion] = useState<number>(1);
    const [numQuestions, setNumQuestions] = useState<number>(20);
    const [durationMinutes, setDurationMinutes] = useState<number>(60);
    // Attempts & preview controls — mirror the create-assessment wizard.
    // Default reattemptCount=0 (single attempt) and previewTime=0 (no
    // instructions/cover screen). Both travel as publish overrides; if
    // the teacher leaves them at default they still get sent so the
    // assessment row is populated explicitly rather than relying on a
    // column default that may differ across environments.
    const [reattemptCount, setReattemptCount] = useState<number>(0);
    const [previewTime, setPreviewTime] = useState<number>(0);
    const [visibility, setVisibility] = useState<'PRIVATE' | 'PUBLIC'>('PRIVATE');
    const [title, setTitle] = useState<string>('');
    const [titleLoading, setTitleLoading] = useState<boolean>(false);
    const [titleEdited, setTitleEdited] = useState<boolean>(false);
    const [result, setResult] = useState<AssessmentArtifact | null>(null);

    // Selected question types. Empty by default — the user must pick at
    // least one before Generate is allowed. Title/schedule/marking are
    // collected AFTER generation, inside the preview pane.
    const [questionTypes, setQuestionTypes] = useState<QuestionTypeCode[]>([]);

    // When true, the backend will generate an illustration for every
    // question stem and every option. Off by default — it adds real
    // latency and Gemini API spend.
    const [includeImages, setIncludeImages] = useState<boolean>(false);

    // Live "≈ N credits" preview driven by the number of questions + illustrations.
    const costPreview = useToolCostPreview('assessment', {
        num_questions: numQuestions,
        include_images: includeImages,
    });

    useEffect(() => {
        if (!open) {
            setResult(null);
            setStartDateTime(defaultStartDateTime());
            setEndDateTime(defaultEndDateTime());
            setMarksPerQuestion(4);
            setNegativeMarkingEnabled(false);
            setNegativeMarkPerQuestion(1);
            setNumQuestions(20);
            setDurationMinutes(60);
            setReattemptCount(0);
            setPreviewTime(0);
            setVisibility('PRIVATE');
            setTitle('');
            setTitleEdited(false);
            setQuestionTypes([]);
            setIncludeImages(false);
            return;
        }
        // Reuse flow: when the parent passes a past artifact, hydrate the
        // preview state directly so the modal skips the form + generation
        // step. titleEdited=true blocks the transcript-derived auto-suggest
        // from clobbering the artifact's stored title on open.
        if (initialArtifact) {
            setResult(initialArtifact);
            setTitle(initialArtifact.title ?? '');
            setTitleEdited(true);
        }
    }, [open, initialArtifact]);

    // Auto-suggest a title from the transcript when the modal opens. We pull
    // the English transcript (falls back to source) and use its first salient
    // sentence — short enough to fit in the title bar but specific enough that
    // the teacher recognizes which lecture it is. The teacher can override.
    useEffect(() => {
        if (!open || titleEdited) return;
        const url = englishTextUrl || sourceTextUrl;
        if (!url) {
            setTitle('');
            return;
        }
        let cancelled = false;
        setTitleLoading(true);
        fetch(url)
            .then((r) => (r.ok ? r.text() : ''))
            .then((text) => {
                if (cancelled) return;
                setTitle(suggestTitleFromTranscript(text));
            })
            .catch(() => {
                if (cancelled) return;
                setTitle('');
            })
            .finally(() => {
                if (!cancelled) setTitleLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [open, englishTextUrl, sourceTextUrl, titleEdited]);

    const { mutate, isPending } = useMutation({
        mutationFn: (body: CreateAssessmentFromRecordingRequest) =>
            createAssessmentFromRecording(scheduleId, recordingId, body),
        onSuccess: (data) => {
            setResult(data);
            if (data.status === 'COMPLETED') {
                toast.success(
                    t('toast.generatedQuestions', { count: data.questions?.length ?? 0 })
                );
            } else if (data.status === 'FAILED') {
                toast.error(data.errorMessage ?? t('toast.generationFailed'));
            }
        },
        onError: (err: unknown) => {
            const msg = (err as { response?: { data?: { message?: string } } })?.response?.data
                ?.message;
            toast.error(msg ?? t('toast.createFailed'));
        },
    });

    const handleSubmit = () => {
        if (!startDateTime || !endDateTime) {
            toast.error(t('toast.dateTimeRequired'));
            return;
        }
        if (new Date(endDateTime) <= new Date(startDateTime)) {
            toast.error(t('toast.endAfterStart'));
            return;
        }
        if (numQuestions < 1 || numQuestions > 50) {
            toast.error(t('toast.questionCountRange'));
            return;
        }
        mutate({
            // datetime-local inputs give us a naked wall-clock string with
            // no timezone. The user means "this time in my local clock";
            // attach the browser's IANA offset so the backend stores the
            // correct UTC instant (its parseTs prefers OffsetDateTime).
            startDateTime: toLocalIsoWithOffset(startDateTime),
            endDateTime: toLocalIsoWithOffset(endDateTime),
            marksPerQuestion,
            negativeMarkingEnabled,
            negativeMarkPerQuestion: negativeMarkingEnabled ? negativeMarkPerQuestion : undefined,
            numQuestions,
            durationMinutes,
            assessmentVisibility: visibility,
            // Empty/whitespace title leaves it null so admin-core falls back to
            // the title Gemini generates from the full transcript.
            overrideTitle: title.trim() ? title.trim() : undefined,
            // From Phase 1 of the wizard — sent for forward-compat. Backend
            // currently ignores it (still produces MCQs); once the LLM
            // prompt and AiPublishAssessmentService support new types,
            // this becomes the routing key.
            questionTypes: questionTypes.length > 0 ? questionTypes : undefined,
            // Opt-in image enrichment — backend pings Gemini for an
            // illustration per question + per option when true.
            includeImages: includeImages || undefined,
        });
    };

    // PUBLISHED artifacts must also open into the preview (with the saved
    // questions) — not the generate form. Previously only COMPLETED matched,
    // so reopening a published assessment from history wrongly showed "regenerate".
    const isPreview =
        result !== null && (result.status === 'COMPLETED' || result.status === 'PUBLISHED');
    const isFailed = result !== null && result.status === 'FAILED';
    const isForm = !isPreview && !isFailed && !isPending;

    return (
        <MyDialog
            open={open}
            onOpenChange={onOpenChange}
            heading={isPreview ? t('dialog.headingPreview') : t('dialog.headingCreate')}
            // Form mode keeps the compact 3xl card; preview mode goes
            // full-screen so the sidebar + detail layout has room to breathe.
            dialogWidth={isPreview ? '!max-w-none !w-screen' : 'max-w-3xl'}
            className={
                isPreview
                    ? '!h-screen !max-h-none !w-screen !rounded-none border-0'
                    : ''
            }
        >
            <div
                className={
                    isPreview
                        ? 'flex flex-col gap-4 px-6 py-5 lg:px-10 lg:py-6'
                        : 'flex flex-col gap-4 px-6 py-5'
                }
            >
                {/* Compact context summary — language + batch count condensed
                    into a single card. Batches collapse behind a "show all"
                    expander once there's more than 4 so the dialog doesn't
                    drown in pills. */}
                {isForm && (
                    <ContextSummaryCard
                        detectedLanguage={detectedLanguage}
                        batches={batches}
                    />
                )}

                {/* Single pre-generation step — picker + number of questions.
                    All other details (title, schedule, marking, visibility)
                    are collected AFTER the LLM returns, so teachers don't
                    have to think about scheduling before they've seen the
                    questions. Defaults are used silently at generation time
                    and become editable in the preview pane. */}
                {isForm && (
                    <QuestionTypePickerStep
                        selected={questionTypes}
                        onChange={setQuestionTypes}
                        numQuestions={numQuestions}
                        setNumQuestions={setNumQuestions}
                        includeImages={includeImages}
                        setIncludeImages={setIncludeImages}
                    />
                )}

                {/* Loading state */}
                {isPending && (
                    <div className="flex flex-col items-center justify-center gap-3 py-12">
                        <div className="relative">
                            <div className="absolute inset-0 size-12 animate-ping rounded-full bg-primary-200/60" />
                            <div className="relative flex size-12 items-center justify-center rounded-full bg-primary-50">
                                <Sparkles className="size-5 text-primary-500" />
                            </div>
                        </div>
                        <div className="text-center">
                            <div className="text-sm font-medium text-neutral-800">
                                {t('loading.generating', { count: numQuestions })}
                                {includeImages ? t('loading.withIllustrations') : ''}
                            </div>
                            <div className="mt-1 text-xs text-neutral-500">
                                {includeImages
                                    ? t('loading.hintWithImages')
                                    : t('loading.hintPlain')}
                            </div>
                        </div>
                        <Loader2 className="size-4 animate-spin text-primary-500" />
                    </div>
                )}

                {/* Preview pane — includes the Configure form that the
                    teacher fills AFTER seeing the questions. Form state is
                    owned by the parent (already used as generation
                    defaults), edits in the preview are sent through as
                    overrides on the publish call. */}
                {isPreview && (
                    <PreviewPane
                        result={result!}
                        batches={batches}
                        recordingId={recordingId}
                        configFields={{
                            title,
                            setTitle: (v) => {
                                setTitle(v);
                                setTitleEdited(true);
                            },
                            titleLoading,
                            startDateTime,
                            setStartDateTime,
                            endDateTime,
                            setEndDateTime,
                            marksPerQuestion,
                            setMarksPerQuestion,
                            negativeMarkingEnabled,
                            setNegativeMarkingEnabled,
                            negativeMarkPerQuestion,
                            setNegativeMarkPerQuestion,
                            numQuestions,
                            setNumQuestions,
                            durationMinutes,
                            setDurationMinutes,
                            reattemptCount,
                            setReattemptCount,
                            previewTime,
                            setPreviewTime,
                            visibility,
                            setVisibility,
                        }}
                        onPublished={(updated, opts) => {
                            // Surface the published row so the toast and caches
                            // hydrate. Normally close the modal afterwards, but
                            // keep it open when the publish came from the nested
                            // "Add to course" flow (it owns its own close).
                            setResult(updated);
                            if (!opts?.keepOpen) onOpenChange(false);
                        }}
                    />
                )}

                {/* Failure state */}
                {isFailed && (
                    <Alert variant="destructive" className="border-red-200 bg-red-50">
                        <AlertTriangle className="size-4 text-red-600" />
                        <AlertDescription className="ms-2">
                            <div className="font-medium text-red-800">{t('failure.title')}</div>
                            <div className="mt-1 text-xs text-red-700">
                                {result?.errorMessage ?? t('failure.unknownError')}
                            </div>
                        </AlertDescription>
                    </Alert>
                )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 border-t bg-neutral-50 px-6 py-3">
                <MyButton
                    buttonType="secondary"
                    onClick={() => onOpenChange(false)}
                    disabled={isPending}
                >
                    {isPreview ? t('dialog.close') : t('dialog.cancel')}
                </MyButton>
                {isForm && (
                    <>
                        <ToolCostBadge
                            credits={costPreview.credits}
                            sufficient={costPreview.sufficient}
                            coverage={costPreview.coverage}
                            loading={costPreview.isLoading}
                        />
                        <MyButton
                            onClick={() => {
                                if (questionTypes.length === 0) {
                                    toast.error(t('toast.pickQuestionType'));
                                    return;
                                }
                                handleSubmit();
                            }}
                            disable={questionTypes.length === 0 || isPending}
                        >
                            <Sparkles className="size-3.5" />
                            {t('generate')}
                        </MyButton>
                    </>
                )}
                {isFailed && (
                    <MyButton onClick={() => setResult(null)}>{t('failure.tryAgain')}</MyButton>
                )}
            </div>
        </MyDialog>
    );
}

// -------------------------------------------------------------------------
// Form fields
// -------------------------------------------------------------------------

/**
 * Tiny dotted step indicator used at the top of the wizard. Two-step
 * version covers the entire form flow we have today; if we add more
 * steps (Configure, Preview), this can grow without restructuring.
 */
function StepIndicator({
    steps,
    current,
}: {
    steps: Array<{ id: string; label: string }>;
    current: string;
}) {
    const currentIndex = steps.findIndex((s) => s.id === current);
    return (
        <div className="flex items-center gap-2 text-[11px] font-medium text-neutral-500">
            {steps.map((step, idx) => {
                const isActive = idx === currentIndex;
                const isDone = idx < currentIndex;
                return (
                    <div key={step.id} className="flex items-center gap-2">
                        <span
                            className={`inline-flex size-5 items-center justify-center rounded-full text-[10px] ${
                                isActive
                                    ? 'bg-primary-500 text-white'
                                    : isDone
                                      ? 'bg-primary-100 text-primary-600'
                                      : 'bg-neutral-200 text-neutral-500'
                            }`}
                        >
                            {isDone ? '✓' : idx + 1}
                        </span>
                        <span
                            className={
                                isActive
                                    ? 'text-neutral-800'
                                    : isDone
                                      ? 'text-neutral-500'
                                      : 'text-neutral-400'
                            }
                        >
                            {step.label}
                        </span>
                        {idx < steps.length - 1 && (
                            <span className="h-px w-6 bg-neutral-200" />
                        )}
                    </div>
                );
            })}
        </div>
    );
}

/**
 * First step of the create-assessment wizard. Lets teachers pick a
 * preset (5 curated bundles) or toggle individual question types. Also
 * captures the number of questions inline since that decision pairs
 * naturally with "what kind of questions?". Question count is also
 * editable on the next step's form — both update the same state.
 */
function QuestionTypePickerStep({
    selected,
    onChange,
    numQuestions,
    setNumQuestions,
    includeImages,
    setIncludeImages,
}: {
    selected: QuestionTypeCode[];
    onChange: (next: QuestionTypeCode[]) => void;
    numQuestions: number;
    setNumQuestions: (n: number) => void;
    includeImages: boolean;
    setIncludeImages: (v: boolean) => void;
}) {
    const { t } = useTranslation('studyLibraryCreateAssessmentFromRecordingModal');
    const QUESTION_TYPES = useMemo(() => buildQuestionTypes(t), [t]);
    const toggle = (code: QuestionTypeCode) => {
        const has = selected.includes(code);
        if (has) {
            // Allow deselecting back to empty — the Continue button below
            // enforces the at-least-1 rule. We don't pre-select on open
            // either, so the "min 1" guard belongs at submit-time, not here.
            onChange(selected.filter((c) => c !== code));
        } else {
            onChange([...selected, code]);
        }
    };

    const accentClasses: Record<
        'sky' | 'violet' | 'emerald' | 'amber' | 'rose',
        { bg: string; ring: string; text: string }
    > = {
        sky: { bg: 'bg-sky-50', ring: 'ring-sky-200', text: 'text-sky-700' },
        violet: { bg: 'bg-violet-50', ring: 'ring-violet-200', text: 'text-violet-700' },
        emerald: { bg: 'bg-emerald-50', ring: 'ring-emerald-200', text: 'text-emerald-700' },
        amber: { bg: 'bg-amber-50', ring: 'ring-amber-200', text: 'text-amber-700' },
        rose: { bg: 'bg-rose-50', ring: 'ring-rose-200', text: 'text-rose-700' },
    };

    return (
        <div className="flex flex-col gap-5">

            {/* Fine-tune — individual checkboxes */}
            <section className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between">
                    <div className="text-sm font-semibold text-neutral-800">
                        {t('picker.pickTypes')}
                    </div>
                    <span className="text-[11px] text-neutral-500">
                        {t('picker.selectedCount', { count: selected.length })}
                    </span>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {QUESTION_TYPES.map((qt) => {
                        const isOn = selected.includes(qt.code);
                        const a = accentClasses[qt.accent];
                        return (
                            <label
                                key={qt.code}
                                className={`flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 transition-colors ${
                                    isOn
                                        ? 'border-neutral-300 bg-white shadow-sm'
                                        : 'border-neutral-200 bg-neutral-50/40 hover:bg-white'
                                }`}
                            >
                                <input
                                    type="checkbox"
                                    className="mt-0.5 size-4 cursor-pointer accent-primary-500"
                                    checked={isOn}
                                    onChange={() => toggle(qt.code)}
                                />
                                <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-1.5">
                                        <span className="text-sm font-medium text-neutral-800">
                                            {qt.label}
                                        </span>
                                        <span
                                            className={`rounded px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide ring-1 ring-inset ${a.bg} ${a.ring} ${a.text}`}
                                        >
                                            {qt.code.replace('_', ' ')}
                                        </span>
                                    </div>
                                    <div className="mt-0.5 text-[11px] leading-relaxed text-neutral-500">
                                        {qt.hint}
                                    </div>
                                </div>
                            </label>
                        );
                    })}
                </div>
                <p className="text-[11px] text-neutral-500">{t('picker.note')}</p>
            </section>

            <Separator />

            {/* Number of questions — kept on this step because the count
                pairs naturally with the type selection. */}
            <section className="flex flex-col gap-2">
                <div className="text-sm font-semibold text-neutral-800">
                    {t('picker.howMany')}
                </div>
                <div className="flex items-center gap-2">
                    <Input
                        id="numq-step1"
                        type="number"
                        min={1}
                        max={50}
                        value={numQuestions}
                        onChange={(e) =>
                            setNumQuestions(parseInt(e.target.value, 10) || 20)
                        }
                        className="h-10 w-24"
                    />
                    <div className="flex gap-1.5">
                        {[5, 10, 20, 30, 50].map((n) => (
                            <button
                                key={n}
                                type="button"
                                onClick={() => setNumQuestions(n)}
                                className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                                    numQuestions === n
                                        ? 'bg-primary-500 text-white'
                                        : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
                                }`}
                            >
                                {n}
                            </button>
                        ))}
                    </div>
                </div>
                <p className="text-[11px] text-neutral-500">{t('picker.rangeHint')}</p>
            </section>

            {/* Image enrichment toggle. Same visual weight as a normal
                form-row checkbox — no scary badges. */}
            <section>
                <label className="flex cursor-pointer items-center gap-2.5 text-sm text-neutral-700">
                    <input
                        type="checkbox"
                        className="size-4 cursor-pointer accent-primary-500"
                        checked={includeImages}
                        onChange={(e) => setIncludeImages(e.target.checked)}
                    />
                    {t('picker.includeImages')}
                </label>
            </section>
        </div>
    );
}

function FormFields(props: {
    title: string;
    setTitle: (v: string) => void;
    titleLoading: boolean;
    startDateTime: string;
    setStartDateTime: (v: string) => void;
    endDateTime: string;
    setEndDateTime: (v: string) => void;
    marksPerQuestion: number;
    setMarksPerQuestion: (v: number) => void;
    negativeMarkingEnabled: boolean;
    setNegativeMarkingEnabled: (v: boolean) => void;
    negativeMarkPerQuestion: number;
    setNegativeMarkPerQuestion: (v: number) => void;
    numQuestions: number;
    setNumQuestions: (v: number) => void;
    durationMinutes: number;
    setDurationMinutes: (v: number) => void;
    reattemptCount: number;
    setReattemptCount: (v: number) => void;
    previewTime: number;
    setPreviewTime: (v: number) => void;
    visibility: 'PRIVATE' | 'PUBLIC';
    setVisibility: (v: 'PRIVATE' | 'PUBLIC') => void;
}) {
    const { t } = useTranslation('studyLibraryCreateAssessmentFromRecordingModal');
    return (
        <div className="flex flex-col gap-4">
            {/* Section: Title — auto-suggested from transcript on open. Empty
                value falls through to the Gemini-generated title server-side. */}
            <FieldGroup label={t('form.titleGroup')} icon={<TypeIcon className="size-3" />}>
                <Field id="title" label={t('form.titleLabel')}>
                    <Input
                        id="title"
                        type="text"
                        value={props.title}
                        placeholder={
                            props.titleLoading
                                ? t('form.titlePlaceholderLoading')
                                : t('form.titlePlaceholderEmpty')
                        }
                        onChange={(e) => props.setTitle(e.target.value)}
                        maxLength={200}
                    />
                </Field>
            </FieldGroup>

            {/* Section: Schedule */}
            <FieldGroup label={t('form.scheduleGroup')} icon={<CalendarClock className="size-3" />}>
                <div className="grid grid-cols-2 gap-3">
                    <Field id="start-dt" label={t('form.startLabel')}>
                        <Input
                            id="start-dt"
                            type="datetime-local"
                            value={props.startDateTime}
                            onChange={(e) => props.setStartDateTime(e.target.value)}
                        />
                    </Field>
                    <Field id="end-dt" label={t('form.endLabel')}>
                        <Input
                            id="end-dt"
                            type="datetime-local"
                            value={props.endDateTime}
                            onChange={(e) => props.setEndDateTime(e.target.value)}
                        />
                    </Field>
                </div>
                {/* Timezone hint — schedule is interpreted in the user's
                    local timezone client-side, then sent to the backend as
                    a proper ISO string with offset so it's stored correctly. */}
                <p className="text-[11px] text-neutral-500">
                    {t('form.timezoneHint')}{' '}
                    <span className="font-medium text-neutral-700">
                        {describeUserTimezone(t)}
                    </span>
                </p>
            </FieldGroup>

            {/* Section: Marking */}
            <FieldGroup label={t('form.markingGroup')} icon={<Award className="size-3" />}>
                <div className="grid grid-cols-2 gap-3">
                    <Field id="marks" label={t('form.marksLabel')}>
                        <Input
                            id="marks"
                            type="number"
                            min={1}
                            value={props.marksPerQuestion}
                            onChange={(e) =>
                                props.setMarksPerQuestion(parseInt(e.target.value, 10) || 1)
                            }
                        />
                    </Field>
                    <Field id="duration" label={t('form.durationLabel')}>
                        <DurationHrsMinInput
                            totalMinutes={props.durationMinutes}
                            onChange={props.setDurationMinutes}
                        />
                    </Field>
                </div>

                <Card className="border-dashed">
                    <CardContent className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                        <Switch
                            id="negmarking"
                            checked={props.negativeMarkingEnabled}
                            onCheckedChange={props.setNegativeMarkingEnabled}
                        />
                        <Label htmlFor="negmarking" className="cursor-pointer text-sm">
                            {t('form.negativeMarkingLabel')}
                        </Label>
                        {props.negativeMarkingEnabled && (
                            <div className="ms-auto flex items-center gap-2">
                                <Label
                                    htmlFor="neg"
                                    className="text-xs font-normal text-neutral-500"
                                >
                                    {t('form.deductLabel')}
                                </Label>
                                <Input
                                    id="neg"
                                    type="number"
                                    min={0}
                                    value={props.negativeMarkPerQuestion}
                                    onChange={(e) =>
                                        props.setNegativeMarkPerQuestion(
                                            parseInt(e.target.value, 10) || 0
                                        )
                                    }
                                    className="w-20"
                                />
                                <span className="text-xs text-neutral-500">
                                    {t('form.perWrongAnswer')}
                                </span>
                            </div>
                        )}
                    </CardContent>
                </Card>
            </FieldGroup>

            {/* Section: Attempts & preview — matches the equivalent step in
                the regular create-assessment wizard. Both values are sent on
                publish; reattemptCount=0 means single-attempt, previewTime=0
                means the timer starts immediately when a learner enters the
                assessment (no cover/instructions screen). */}
            <FieldGroup label={t('form.attemptsGroup')} icon={<RotateCcw className="size-3" />}>
                <div className="grid grid-cols-2 gap-3">
                    <Field id="reattempt" label={t('form.reattemptLabel')}>
                        <Input
                            id="reattempt"
                            type="number"
                            min={0}
                            value={props.reattemptCount}
                            onChange={(e) =>
                                props.setReattemptCount(
                                    Math.max(0, parseInt(e.target.value, 10) || 0)
                                )
                            }
                        />
                        <p className="text-[11px] text-neutral-500">{t('form.reattemptHint')}</p>
                    </Field>
                    <Field id="preview" label={t('form.previewTimeLabel')}>
                        <Input
                            id="preview"
                            type="number"
                            min={0}
                            value={props.previewTime}
                            onChange={(e) =>
                                props.setPreviewTime(
                                    Math.max(0, parseInt(e.target.value, 10) || 0)
                                )
                            }
                        />
                        <p className="text-[11px] text-neutral-500">
                            {t('form.previewTimeHint')}
                        </p>
                    </Field>
                </div>
            </FieldGroup>

            {/* Section: Content & visibility — number of questions is set
                on the picker step BEFORE generation. By the time this form
                is visible, questions are already produced, so we show the
                count as a read-only chip rather than an editable input
                that wouldn't actually do anything. */}
            <FieldGroup label={t('form.contentGroup')} icon={<Eye className="size-3" />}>
                <div className="grid grid-cols-2 gap-3">
                    <Field id="numq" label={t('form.numQuestionsLabel')}>
                        <div
                            id="numq"
                            className="inline-flex h-10 items-center gap-2 rounded-md border border-neutral-200 bg-neutral-50 px-3 text-sm text-neutral-700"
                        >
                            <span className="font-medium text-neutral-800">
                                {props.numQuestions}
                            </span>
                            <span className="text-[11px] text-neutral-500">
                                {t('form.fixedAtGeneration')}
                            </span>
                        </div>
                    </Field>
                    <div className="flex flex-col gap-1.5">
                        <Label className="text-xs font-medium text-neutral-700">
                            {t('form.visibilityLabel')}
                        </Label>
                        <RadioGroup
                            value={props.visibility}
                            onValueChange={(v) =>
                                props.setVisibility(v as 'PRIVATE' | 'PUBLIC')
                            }
                            className="grid grid-cols-2 gap-2"
                        >
                            <VisibilityOption
                                value="PRIVATE"
                                label={t('form.visibilityPrivate')}
                                hint={t('form.visibilityPrivateHint')}
                            />
                            <VisibilityOption
                                value="PUBLIC"
                                label={t('form.visibilityPublic')}
                                hint={t('form.visibilityPublicHint')}
                            />
                        </RadioGroup>
                    </div>
                </div>
            </FieldGroup>
        </div>
    );
}

function FieldGroup({
    label,
    icon,
    children,
}: {
    label: string;
    icon?: React.ReactNode;
    children: React.ReactNode;
}) {
    return (
        <section className="flex flex-col gap-3 rounded-xl border border-neutral-200 bg-white p-4 shadow-[0_1px_0_rgba(0,0,0,0.02)]">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                {icon && (
                    <span className="flex size-5 items-center justify-center rounded-md bg-neutral-100 text-neutral-500">
                        {icon}
                    </span>
                )}
                {label}
            </div>
            {children}
        </section>
    );
}

/**
 * Single-card context summary shown at the top of the form mode.
 *
 * Collapses the previous two stacked alerts (language + batches) into a
 * compact card with the language as a soft pill on one side and a
 * collapsible batch list on the other. Batches expand on click when there
 * are more than 4 — keeps the dialog focused on the actionable form fields
 * rather than a wall of pills.
 */
function ContextSummaryCard({
    detectedLanguage,
    batches,
}: {
    detectedLanguage?: string;
    batches?: BatchSummary[];
}) {
    const { t } = useTranslation('studyLibraryCreateAssessmentFromRecordingModal');
    const [expanded, setExpanded] = useState(false);
    const hasBatches = !!batches && batches.length > 0;
    const noBatches = batches !== undefined && batches.length === 0;

    if (!detectedLanguage && !hasBatches && !noBatches) return null;

    return (
        <div className="rounded-xl border border-neutral-200 bg-gradient-to-br from-neutral-50 to-white p-3.5">
            {/* Single row by default — language + batch count + helper text.
                Batch chips are tucked behind a "View" toggle so the dialog
                doesn't open with a wall of pills. */}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                {hasBatches && (
                    <button
                        type="button"
                        onClick={() => setExpanded((v) => !v)}
                        className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-2.5 py-1 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-50"
                        title={expanded ? t('context.hideBatchList') : t('context.viewBatches')}
                    >
                        <Users className="size-3" />
                        {t('context.assignedToBatches', { count: batches.length })}
                        {expanded ? (
                            <ChevronUp className="size-3" />
                        ) : (
                            <ChevronDown className="size-3" />
                        )}
                    </button>
                )}
                {noBatches && (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
                        <AlertTriangle className="size-3" />
                        {t('context.noBatches')}
                    </span>
                )}
                {detectedLanguage && (
                    <span className="ms-auto text-[11px] text-neutral-500">
                        {t('context.languageHint', { language: detectedLanguage })}
                    </span>
                )}
            </div>

            {/* Batch chips — collapsed by default. Click the count pill above
                to expand. Scrollable past ~30 to keep the dialog short even
                when expanded. */}
            {hasBatches && expanded && (
                <div className="mt-3 flex max-h-32 flex-wrap items-center gap-1.5 overflow-y-auto rounded-md border border-dashed border-neutral-200 bg-white p-2">
                    {batches.map((b) => (
                        <span
                            key={b.package_session_id}
                            className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-neutral-200 bg-neutral-50 px-2 py-0.5 text-[11px] font-normal text-neutral-700"
                        >
                            {b.package_name}
                            {b.session_name && (
                                <span className="text-neutral-400">· {b.session_name}</span>
                            )}
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
}

/**
 * HRS : MIN inline editor — mirrors the regular create-assessment wizard's
 * Entire Test Duration field. The underlying state is always a single
 * integer (total minutes) so the publish call doesn't need a separate
 * `durationHours` field. Both inputs are text-mode with a numeric-only
 * guard because <input type="number"> spinners look out of place inside
 * the bordered hr/min pill and reject typed leading zeros.
 */
function DurationHrsMinInput({
    totalMinutes,
    onChange,
}: {
    totalMinutes: number;
    onChange: (totalMinutes: number) => void;
}) {
    const { t } = useTranslation('studyLibraryCreateAssessmentFromRecordingModal');
    const safe = Number.isFinite(totalMinutes) && totalMinutes >= 0 ? totalMinutes : 0;
    const hrs = Math.floor(safe / 60);
    const min = safe % 60;
    const setHrs = (next: number) => {
        const h = Math.max(0, Number.isFinite(next) ? next : 0);
        onChange(h * 60 + min);
    };
    const setMin = (next: number) => {
        // 0–59 keeps the digit segment readable; values >=60 silently
        // bump into the hours column so paste of "90" still resolves to
        // 1h 30m without throwing the input away.
        const m = Math.max(0, Number.isFinite(next) ? next : 0);
        const extraHrs = Math.floor(m / 60);
        const minPart = m % 60;
        onChange((hrs + extraHrs) * 60 + minPart);
    };
    const sanitize = (raw: string) => raw.replace(/[^0-9]/g, '');
    return (
        <div className="inline-flex h-10 items-center gap-2 rounded-md border border-neutral-200 bg-white px-3 shadow-sm">
            <input
                type="text"
                inputMode="numeric"
                value={String(hrs)}
                onChange={(e) => setHrs(parseInt(sanitize(e.target.value), 10) || 0)}
                aria-label={t('duration.hoursAria')}
                className="w-10 border-none bg-transparent text-center text-sm font-medium text-neutral-800 focus:outline-none"
            />
            <span className="text-[11px] font-medium uppercase text-neutral-500">
                {t('duration.hoursUnit')}
            </span>
            <span className="text-neutral-300">:</span>
            <input
                type="text"
                inputMode="numeric"
                value={String(min).padStart(2, '0')}
                onChange={(e) => setMin(parseInt(sanitize(e.target.value), 10) || 0)}
                aria-label={t('duration.minutesAria')}
                className="w-10 border-none bg-transparent text-center text-sm font-medium text-neutral-800 focus:outline-none"
            />
            <span className="text-[11px] font-medium uppercase text-neutral-500">
                {t('duration.minutesUnit')}
            </span>
        </div>
    );
}

function Field({
    id,
    label,
    children,
}: {
    id: string;
    label: string;
    children: React.ReactNode;
}) {
    return (
        <div className="flex flex-col gap-1.5">
            <Label htmlFor={id} className="text-xs font-medium text-neutral-700">
                {label}
            </Label>
            {children}
        </div>
    );
}

function VisibilityOption({
    value,
    label,
    hint,
}: {
    value: string;
    label: string;
    hint: string;
}) {
    return (
        <Label
            htmlFor={`vis-${value}`}
            className="flex cursor-pointer items-center gap-2 rounded-md border bg-white px-3 py-2 transition-colors has-[:checked]:border-primary-500 has-[:checked]:bg-primary-50"
        >
            <RadioGroupItem value={value} id={`vis-${value}`} />
            <div className="flex flex-col">
                <span className="text-sm font-medium text-neutral-800">{label}</span>
                <span className="text-[10px] text-neutral-500">{hint}</span>
            </div>
        </Label>
    );
}

// -------------------------------------------------------------------------
// Preview pane
// -------------------------------------------------------------------------

interface PreviewPaneConfigFields {
    title: string;
    setTitle: (v: string) => void;
    titleLoading: boolean;
    startDateTime: string;
    setStartDateTime: (v: string) => void;
    endDateTime: string;
    setEndDateTime: (v: string) => void;
    marksPerQuestion: number;
    setMarksPerQuestion: (v: number) => void;
    negativeMarkingEnabled: boolean;
    setNegativeMarkingEnabled: (v: boolean) => void;
    negativeMarkPerQuestion: number;
    setNegativeMarkPerQuestion: (v: number) => void;
    numQuestions: number;
    setNumQuestions: (v: number) => void;
    durationMinutes: number;
    setDurationMinutes: (v: number) => void;
    reattemptCount: number;
    setReattemptCount: (v: number) => void;
    previewTime: number;
    setPreviewTime: (v: number) => void;
    visibility: 'PRIVATE' | 'PUBLIC';
    setVisibility: (v: 'PRIVATE' | 'PUBLIC') => void;
}

function PreviewPane({
    result,
    batches,
    recordingId,
    configFields,
    onPublished,
}: {
    result: AssessmentArtifact;
    batches?: BatchSummary[];
    recordingId: string;
    configFields: PreviewPaneConfigFields;
    onPublished: (updated: AssessmentArtifact, opts?: { keepOpen?: boolean }) => void;
}) {
    const { t } = useTranslation('studyLibraryCreateAssessmentFromRecordingModal');
    const isPublished = result.status === 'PUBLISHED' || !!result.assessmentId;
    // "Create Assessment" dialog state. The form fields used to render
    // inline above the questions, but users found it cluttered — they
    // wanted the questions to be the focus. Now the form lives behind
    // a button click instead.
    const [configDialogOpen, setConfigDialogOpen] = useState(false);
    const [addToCourseOpen, setAddToCourseOpen] = useState(false);
    const { mutate: doPublish, isPending: publishing } = useMutation({
        mutationFn: () =>
            // Publish with full overrides from the post-generation form.
            // Title falls back to the artifact's own title when blank so
            // the LLM-generated default isn't accidentally wiped out.
            publishAssessmentFromRecording(recordingId, result.artifactId!, {
                title:
                    configFields.title.trim()
                        ? configFields.title.trim()
                        : (result.title ?? undefined),
                startDateTime: toLocalIsoWithOffset(configFields.startDateTime),
                endDateTime: toLocalIsoWithOffset(configFields.endDateTime),
                assessmentVisibility: configFields.visibility,
                marksPerQuestion: configFields.marksPerQuestion,
                durationMinutes: configFields.durationMinutes,
                negativeMarkingEnabled: configFields.negativeMarkingEnabled,
                negativeMarkPerQuestion: configFields.negativeMarkingEnabled
                    ? configFields.negativeMarkPerQuestion
                    : undefined,
                reattemptCount: configFields.reattemptCount,
                previewTime: configFields.previewTime,
            }),
        onSuccess: (updated) => {
            onPublished(updated);
            toast.success(t('toast.publishSuccess'));
        },
        onError: (err: unknown) => {
            const msg =
                (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
            toast.error(msg ?? t('toast.publishFailed'));
        },
    });
    return (
        <div className="flex flex-col gap-4">
            {/* Compact header — title on top, tag-row chips underneath.
                Matches the slim header style of the AI-tools preview rather
                than the previous heavy primary-tinted card. */}
            <div className="flex flex-col gap-1.5 px-1">
                {/* Inline editable title bound to configFields.title (strict
                    controlled — the export buttons fall back to result.title
                    when this is empty so clearing the field is safe). The
                    always-visible pencil makes the affordance discoverable;
                    most users miss that a heading can be clicked to edit. */}
                <div className="group flex items-center gap-2 rounded-sm border border-neutral-200 px-2 py-1 transition-colors hover:border-neutral-300 focus-within:border-primary-400">
                    <Input
                        value={configFields.title}
                        onChange={(e) => configFields.setTitle(e.target.value)}
                        placeholder={result.title ?? t('preview.untitled')}
                        aria-label={t('preview.titleAria')}
                        className="h-auto flex-1 border-0 bg-transparent px-0 py-0 text-lg font-semibold leading-tight text-neutral-800 shadow-none placeholder:text-neutral-400 focus-visible:ring-0 focus-visible:ring-offset-0"
                    />
                    <PencilSimple
                        aria-hidden
                        weight="bold"
                        className="size-4 shrink-0 text-neutral-500 transition-colors group-focus-within:text-primary-500"
                    />
                </div>
                <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-neutral-500">
                    <span className="inline-flex items-center gap-1 rounded-full border border-neutral-200 bg-white px-2 py-0.5 font-medium text-neutral-600">
                        {t('preview.questionsCount', { count: result.numQuestions ?? 0 })}
                    </span>
                    {result.targetLanguage && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-neutral-200 bg-white px-2 py-0.5 font-medium uppercase text-neutral-600">
                            {result.targetLanguage}
                        </span>
                    )}
                    {result.modelUsed && (
                        <span
                            className="inline-flex items-center gap-1 rounded-full border border-neutral-200 bg-white px-2 py-0.5 font-medium text-neutral-600"
                            title={result.modelUsed}
                        >
                            {formatModelLabel(result.modelUsed)}
                        </span>
                    )}
                    {batches && batches.length > 0 && (
                        <Popover>
                            <PopoverTrigger asChild>
                                <button
                                    type="button"
                                    className="inline-flex items-center gap-1 rounded-full border border-neutral-200 bg-white px-2 py-0.5 font-medium text-neutral-600 transition-colors hover:border-primary-300 hover:bg-primary-50 hover:text-primary-700"
                                >
                                    <Users className="size-3" />
                                    {t('preview.batchesCount', { count: batches.length })}
                                    <ChevronDown className="size-3" />
                                </button>
                            </PopoverTrigger>
                            <PopoverContent
                                align="start"
                                className="w-72 p-0"
                            >
                                <div className="border-b border-neutral-200 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                                    {t('preview.assignedBatchesHeader', { count: batches.length })}
                                </div>
                                <ul className="max-h-64 overflow-y-auto py-1">
                                    {batches.map((b) => (
                                        <li
                                            key={b.package_session_id}
                                            className="flex flex-col gap-0.5 px-3 py-2 text-sm text-neutral-800 hover:bg-neutral-50"
                                        >
                                            <span className="font-medium">
                                                {b.package_name}
                                            </span>
                                            {(b.level_name ||
                                                b.session_name) && (
                                                <span className="text-xs text-neutral-500">
                                                    {[
                                                        b.level_name,
                                                        b.session_name,
                                                    ]
                                                        .filter(Boolean)
                                                        .join(' · ')}
                                                </span>
                                            )}
                                        </li>
                                    ))}
                                </ul>
                            </PopoverContent>
                        </Popover>
                    )}
                </div>
            </div>

            {/* Rich question viewer — sidebar of thumbnails on the left,
                full detail on the right. Mirrors the vsmart-prompt question
                preview UX so users see the same layout across both flows.
                Layered into a single PreviewPane so we keep the simple
                {question, options, correctAnswerIndex, explanation} shape
                without coupling to AIQuestionsPreview's task-based store. */}
            <RichQuestionsViewer questions={result.questions ?? []} />


            {/* Publish row. Shows a Publish button while artifact is in
                COMPLETED state, and a success banner once published. */}
            {isPublished ? (
                <Alert className="border-green-200 bg-green-50">
                    <CheckCircle2 className="size-4 text-green-600" />
                    <AlertDescription className="ms-2 flex items-center justify-between text-xs text-green-900">
                        <span>
                            {t('preview.publishedBanner', {
                                count: result.registeredBatchIds?.length ?? 0,
                            })}
                        </span>
                        {result.assessmentId && (
                            <Badge variant="outline" className="border-green-300 bg-white font-mono text-[10px] text-green-700">
                                {result.assessmentId.slice(0, 8)}…
                            </Badge>
                        )}
                    </AlertDescription>
                </Alert>
            ) : (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-primary-200 bg-primary-50/40 px-4 py-3">
                    <div className="text-xs text-neutral-700">
                        {t('preview.reviewHintPrefix')}{' '}
                        <strong>{t('preview.createAssessment')}</strong>{' '}
                        {t('preview.reviewHintSuffix')}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <RecordingAssessmentExportButtons
                            questions={result.questions ?? []}
                            title={
                                configFields.title?.trim() ||
                                result.title ||
                                t('preview.defaultTitle')
                            }
                        />
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            onClick={() => setAddToCourseOpen(true)}
                        >
                            <GraduationCap className="size-3.5" />
                            {t('preview.addToCourse')}
                        </MyButton>
                        <MyButton
                            type="button"
                            onClick={() => setConfigDialogOpen(true)}
                        >
                            <Settings2 className="size-3.5" />
                            {t('preview.createAssessment')}
                        </MyButton>
                    </div>
                </div>
            )}

            {/* When already published, the publish row is replaced by a success
                banner — keep an "Add to course" affordance available there too,
                so the published assessment can be linked as a slide. */}
            {isPublished && (
                <div className="flex flex-wrap items-center justify-end">
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        onClick={() => setAddToCourseOpen(true)}
                    >
                        <GraduationCap className="size-3.5" />
                        {t('preview.addToCourseAsSlide')}
                    </MyButton>
                </div>
            )}

            {/* Push these questions into a course slide — an embedded quiz, or
                (once published) a linked assessment slide. */}
            <AddToCourseDialog
                open={addToCourseOpen}
                onOpenChange={setAddToCourseOpen}
                linkedBatches={batches}
                assessmentConfig={<FormFields {...configFields} />}
                content={{
                    kind: 'ASSESSMENT',
                    questions: result.questions ?? [],
                    suggestedTitle:
                        configFields.title?.trim() || result.title || t('preview.defaultTitle'),
                    assessmentId: result.assessmentId,
                }}
                publishAssessment={
                    result.artifactId
                        ? async (opts?: {
                              packageSessionIds?: string[];
                              skipBatchRegistration?: boolean;
                          }) => {
                              // Already published? reuse it. Otherwise publish with
                              // the current config and return the new assessmentId.
                              if (result.assessmentId) return result.assessmentId;
                              const updated = await publishAssessmentFromRecording(
                                  recordingId,
                                  result.artifactId!,
                                  {
                                      title: configFields.title.trim()
                                          ? configFields.title.trim()
                                          : (result.title ?? undefined),
                                      startDateTime: toLocalIsoWithOffset(
                                          configFields.startDateTime
                                      ),
                                      endDateTime: toLocalIsoWithOffset(configFields.endDateTime),
                                      assessmentVisibility: configFields.visibility,
                                      marksPerQuestion: configFields.marksPerQuestion,
                                      durationMinutes: configFields.durationMinutes,
                                      negativeMarkingEnabled: configFields.negativeMarkingEnabled,
                                      negativeMarkPerQuestion: configFields.negativeMarkingEnabled
                                          ? configFields.negativeMarkPerQuestion
                                          : undefined,
                                      reattemptCount: configFields.reattemptCount,
                                      previewTime: configFields.previewTime,
                                      // Register the destination course batches too.
                                      packageSessionIds:
                                          opts?.packageSessionIds &&
                                          opts.packageSessionIds.length > 0
                                              ? opts.packageSessionIds
                                              : undefined,
                                      skipBatchRegistration: opts?.skipBatchRegistration,
                                  }
                              );
                              // keepOpen — the AddToCourse dialog owns its close.
                              onPublished(updated, { keepOpen: true });
                              return updated.assessmentId ?? null;
                          }
                        : undefined
                }
            />

            {/* Configuration dialog — collected fields the teacher overrides
                AFTER reviewing questions: title, schedule, marking, visibility.
                Publish lives at the bottom of this dialog now; the preview
                pane no longer carries its own standalone Publish button so
                the user has exactly one funnel from preview → published. */}
            <ConfigureAssessmentDialog
                open={configDialogOpen}
                onOpenChange={setConfigDialogOpen}
                configFields={configFields}
                onPublish={() => doPublish()}
                publishing={publishing}
                canPublish={!!result.artifactId}
            />
        </div>
    );
}

// -------------------------------------------------------------------------
// Rich questions viewer — sidebar + detail layout matching vsmart-prompt
// -------------------------------------------------------------------------

/**
 * Displays AI-generated MCQ questions as a sidebar (clickable thumbnails)
 * plus a detailed right pane showing the selected question with its full
 * text, options grid, correct-answer highlight, and explanation.
 *
 * Stateless w.r.t. the questions list itself — caller hands in the array
 * and we just track which one is selected.
 *
 * Kept side-by-side with the modal so the preview UX is consistent with
 * the AI-center preview (sidebar + main view) without coupling to that
 * component's react-hook-form + task-mutation machinery.
 */
/**
 * Configuration dialog shown when the teacher clicks "Create Assessment"
 * after the questions are generated. Wraps the existing FormFields
 * component in a focused popover so the schedule + marking inputs don't
 * compete with the question preview for attention.
 *
 * The dialog is stateless — every field reads/writes the same
 * configFields object the parent already owns. Closing the dialog
 * doesn't lose edits; reopening it shows the latest values.
 */
function ConfigureAssessmentDialog({
    open,
    onOpenChange,
    configFields,
    onPublish,
    publishing,
    canPublish,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    configFields: PreviewPaneConfigFields;
    /** Fires when the in-dialog Publish button is clicked. The parent
     *  owns the mutation; this is the only place from which it's now
     *  invoked (the standalone preview-pane Publish button was removed). */
    onPublish: () => void;
    publishing: boolean;
    canPublish: boolean;
}) {
    const { t } = useTranslation('studyLibraryCreateAssessmentFromRecordingModal');
    return (
        <MyDialog
            open={open}
            onOpenChange={onOpenChange}
            heading={t('config.heading')}
            dialogWidth="max-w-2xl"
        >
            <div className="flex flex-col gap-4 p-5">
                <p className="text-xs text-neutral-500">{t('config.description')}</p>
                <FormFields
                    title={configFields.title}
                    setTitle={configFields.setTitle}
                    titleLoading={configFields.titleLoading}
                    startDateTime={configFields.startDateTime}
                    setStartDateTime={configFields.setStartDateTime}
                    endDateTime={configFields.endDateTime}
                    setEndDateTime={configFields.setEndDateTime}
                    marksPerQuestion={configFields.marksPerQuestion}
                    setMarksPerQuestion={configFields.setMarksPerQuestion}
                    negativeMarkingEnabled={configFields.negativeMarkingEnabled}
                    setNegativeMarkingEnabled={configFields.setNegativeMarkingEnabled}
                    negativeMarkPerQuestion={configFields.negativeMarkPerQuestion}
                    setNegativeMarkPerQuestion={configFields.setNegativeMarkPerQuestion}
                    numQuestions={configFields.numQuestions}
                    setNumQuestions={configFields.setNumQuestions}
                    durationMinutes={configFields.durationMinutes}
                    setDurationMinutes={configFields.setDurationMinutes}
                    reattemptCount={configFields.reattemptCount}
                    setReattemptCount={configFields.setReattemptCount}
                    previewTime={configFields.previewTime}
                    setPreviewTime={configFields.setPreviewTime}
                    visibility={configFields.visibility}
                    setVisibility={configFields.setVisibility}
                />
                <div className="flex items-center justify-end gap-2 border-t pt-3">
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        onClick={() => onOpenChange(false)}
                        disabled={publishing}
                    >
                        {t('config.cancel')}
                    </MyButton>
                    <MyButton
                        type="button"
                        onClick={onPublish}
                        disable={publishing || !canPublish}
                    >
                        {publishing ? (
                            <>
                                <Loader2 className="size-3.5 animate-spin" />
                                {t('config.publishing')}
                            </>
                        ) : (
                            <>
                                <Sparkles className="size-3.5" />
                                {t('config.publish')}
                            </>
                        )}
                    </MyButton>
                </div>
            </div>
        </MyDialog>
    );
}

function RichQuestionsViewer({ questions }: { questions: GeneratedQuestion[] }) {
    const { t } = useTranslation('studyLibraryCreateAssessmentFromRecordingModal');
    const [selected, setSelected] = useState(0);
    if (!questions || questions.length === 0) {
        return (
            <div className="flex h-[70vh] items-center justify-center rounded-md border bg-neutral-50 text-sm text-neutral-500">
                {t('questions.empty')}
            </div>
        );
    }
    const active = questions[Math.min(selected, questions.length - 1)] ?? questions[0]!;
    return (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_1fr] lg:gap-5">
            {/* Sidebar */}
            <ScrollArea className="h-[70vh] rounded-md border bg-neutral-50/40">
                <div className="flex flex-col gap-1.5 p-2">
                    {questions.map((q, i) => {
                        const isActive = i === selected;
                        return (
                            <button
                                key={q.id ?? i}
                                type="button"
                                onClick={() => setSelected(i)}
                                className={`group flex flex-col gap-1 rounded-md border px-2.5 py-2 text-left transition-colors ${
                                    isActive
                                        ? 'border-primary-400 bg-white shadow-sm ring-1 ring-primary-200'
                                        : 'border-transparent bg-white/60 hover:border-neutral-200 hover:bg-white'
                                }`}
                            >
                                <div className="flex items-center gap-1.5">
                                    <span
                                        className={`flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${
                                            isActive
                                                ? 'bg-primary-500 text-white'
                                                : 'bg-neutral-200 text-neutral-600 group-hover:bg-neutral-300'
                                        }`}
                                    >
                                        {i + 1}
                                    </span>
                                    <span className="text-[10px] font-medium uppercase tracking-wide text-neutral-500">
                                        {t('questions.multipleChoice')}
                                    </span>
                                </div>
                                <div className="line-clamp-2 text-[11px] leading-snug text-neutral-700">
                                    {/* Sidebar thumbnail — strip HTML so any
                                        embedded <img> doesn't blow up the
                                        tiny preview card. Plain text is
                                        plenty for navigation. */}
                                    {(q.question || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()}
                                </div>
                                <div className="mt-0.5 grid grid-cols-2 gap-1">
                                    {q.options.slice(0, 4).map((_, idx) => {
                                        const correct = idx === q.correctAnswerIndex;
                                        return (
                                            <div
                                                key={idx}
                                                className={`flex items-center gap-1 rounded-sm px-1 py-0.5 text-[9px] ${
                                                    correct
                                                        ? 'bg-emerald-50 text-emerald-700'
                                                        : 'bg-neutral-100 text-neutral-500'
                                                }`}
                                            >
                                                <span className="font-mono opacity-80">
                                                    {String.fromCharCode(97 + idx)}.
                                                </span>
                                                {correct && (
                                                    <CheckCircle2 className="ml-auto size-2.5 text-emerald-600" />
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </button>
                        );
                    })}
                </div>
            </ScrollArea>

            {/* Detail panel — generous breathing room so question text +
                inline illustrations have room to read at a glance. */}
            <div className="flex h-[70vh] flex-col gap-5 overflow-y-auto rounded-lg border bg-white p-6 sm:p-8">
                <div className="flex items-center justify-between border-b pb-2.5">
                    <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-neutral-800">
                            {t('questions.questionLabel', { number: selected + 1 })}
                        </span>
                        <Badge
                            variant="outline"
                            className="border-amber-300 bg-amber-50 text-[10px] font-medium uppercase tracking-wide text-amber-700"
                        >
                            {t('questions.difficultyMedium')}
                        </Badge>
                    </div>
                    <span className="text-[10px] text-neutral-400">
                        {selected + 1} / {questions.length}
                    </span>
                </div>

                {/* Question body — rendered as HTML so any embedded <img>
                    tags from the image-enrichment pipeline show up
                    inline, matching how the existing AI-tools preview
                    renders diagram questions. Larger leading + bigger
                    image max-height so questions feel like the AI Center
                    preview rather than a cramped dense form. */}
                <div
                    className="rounded-lg border border-neutral-200 bg-white px-5 py-4 text-base leading-7 text-neutral-800 [&_img]:my-3 [&_img]:max-h-[420px] [&_img]:w-auto [&_img]:rounded-lg [&_img]:object-contain"
                    dangerouslySetInnerHTML={{ __html: active.question || '' }}
                />

                {/* Answers grid — option text also rendered as HTML so
                    image-enriched options display the illustration. */}
                <div>
                    <div className="mb-1.5 text-xs font-semibold text-neutral-700">
                        {t('questions.answer')}
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {active.options.map((opt, idx) => {
                            const correct = idx === active.correctAnswerIndex;
                            return (
                                <div
                                    key={idx}
                                    className={`relative flex min-h-[58px] gap-2.5 rounded-lg border px-3 py-2.5 transition-colors ${
                                        correct
                                            ? 'border-emerald-300 bg-emerald-50/70'
                                            : 'border-neutral-200 bg-white hover:border-neutral-300'
                                    }`}
                                >
                                    <span
                                        className={`mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${
                                            correct
                                                ? 'bg-emerald-500 text-white'
                                                : 'bg-neutral-100 text-neutral-600'
                                        }`}
                                    >
                                        {String.fromCharCode(97 + idx)}
                                    </span>
                                    <span
                                        className="flex-1 self-center text-sm leading-snug text-neutral-800 [&_img]:mt-2 [&_img]:max-h-40 [&_img]:rounded-md"
                                        dangerouslySetInnerHTML={{ __html: opt || '' }}
                                    />
                                    {correct && (
                                        <CheckCircle2 className="size-4 shrink-0 self-center text-emerald-500" />
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>

                {active.explanation && (
                    <div className="rounded-md border border-blue-100 bg-blue-50/50 px-3 py-2 text-xs leading-relaxed text-blue-900">
                        <span className="me-1 font-semibold">{t('questions.why')}</span>
                        {active.explanation}
                    </div>
                )}
            </div>
        </div>
    );
}

// -------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------

/**
 * Heuristic title suggestion from a raw transcript blob.
 *
 * Strategy: take the first non-trivial sentence (or first 8–12 words if no
 * sentence punctuation in the first 150 chars), trim to title-case-friendly
 * length. The teacher can override, so being approximate is fine — the goal
 * is to give them a starting point instead of an empty field.
 */
function suggestTitleFromTranscript(text: string): string {
    if (!text) return '';
    const cleaned = text.replace(/\s+/g, ' ').trim();
    if (!cleaned) return '';
    // First sentence by Latin or Devanagari punctuation.
    const m = cleaned.match(/^([^.!?।]{8,120}[.!?।])/);
    let candidate = m?.[1] ?? cleaned.slice(0, 90);
    candidate = candidate.replace(/[.!?।]+$/, '').trim();
    // Cap word count to keep titles compact.
    const words = candidate.split(/\s+/);
    if (words.length > 12) candidate = words.slice(0, 12).join(' ') + '…';
    return candidate;
}

function defaultStartDateTime(): string {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(10, 0, 0, 0);
    return localIsoForInput(d);
}

function defaultEndDateTime(): string {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(12, 0, 0, 0);
    return localIsoForInput(d);
}

function localIsoForInput(d: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
        d.getHours()
    )}:${pad(d.getMinutes())}`;
}

/**
 * Convert a datetime-local string (no tz, e.g. "2026-05-21T10:00") into a
 * full ISO-8601 string with the browser's current UTC offset appended
 * (e.g. "2026-05-21T10:00:00+05:30"). The assessment-service `parseTs`
 * prefers OffsetDateTime, so this guarantees the stored UTC instant
 * matches the wall-clock time the teacher actually typed.
 */
function toLocalIsoWithOffset(localStr: string): string {
    if (!localStr) return localStr;
    // The browser parses a naked datetime-local string as local wall-clock.
    const d = new Date(localStr);
    if (Number.isNaN(d.getTime())) return localStr;
    const offsetMin = -d.getTimezoneOffset(); // east of UTC is positive
    const sign = offsetMin >= 0 ? '+' : '-';
    const absMin = Math.abs(offsetMin);
    const pad = (n: number) => String(n).padStart(2, '0');
    const oh = pad(Math.floor(absMin / 60));
    const om = pad(absMin % 60);
    // localStr is already "yyyy-MM-ddTHH:mm" — append seconds + offset.
    return `${localStr}:00${sign}${oh}:${om}`;
}

/** Human-readable timezone label, e.g. "Asia/Kolkata · GMT+5:30". */
function describeUserTimezone(t: TFunction): string {
    try {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const offsetMin = -new Date().getTimezoneOffset();
        const sign = offsetMin >= 0 ? '+' : '-';
        const absMin = Math.abs(offsetMin);
        const hours = Math.floor(absMin / 60);
        const mins = absMin % 60;
        const offsetLabel = mins === 0 ? `GMT${sign}${hours}` : `GMT${sign}${hours}:${String(mins).padStart(2, '0')}`;
        return tz ? `${tz} · ${offsetLabel}` : offsetLabel;
    } catch {
        return t('timezone.fallback');
    }
}
