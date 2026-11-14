import { useMemo, useState, type ReactNode } from 'react';
import { useIsFetching, useQueries, useQuery } from '@tanstack/react-query';
import { useController, useFormState, useWatch, type UseFormReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import {
    ArrowClockwise,
    BookOpenText,
    ClockCounterClockwise,
    Info,
    Sparkle,
    UsersThree,
    Warning,
    WarningCircle,
} from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import SelectField from '@/components/design-system/select-field';
import { Form } from '@/components/ui/form';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useToolCostPreview } from '@/components/common/ai-credits/useToolCostPreview';
import type { PlanCoverage } from '@/components/common/ai-credits/aiPlan';
import { TopUpModal } from '@/components/common/ai-credits/TopUpModal';
import {
    useStudyLibraryStore,
    type SubjectType,
} from '@/stores/study-library/use-study-library-store';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { useStudyLibraryQuery } from '@/routes/study-library/courses/-services/getStudyLibraryDetails';
import { handleFetchModulesWithChapters } from '@/routes/study-library/courses/-services/getModulesWithChapters';
import { handleFetchSlides } from '@/routes/study-library/courses/-services/getAllSlides';
import { getEngagementSettings } from '@/routes/settings/-services/engagement-settings';
import { estimateDraftCredits } from '../../-services/ai-plan-service';
import {
    AI_KINDS,
    AI_LANGUAGES,
    DURATION_PRESETS,
    MAX_GROUNDING_CHARS,
    MAX_SPAN_DAYS,
    briefRunDates,
    type AiBriefValues,
    type GroundingText,
} from '../../-stores/ai-draft-store';
import {
    formatDay,
    formatDayRange,
    formatNumber,
    formatRelative,
    instituteToday,
    isEveryDay,
    weekdayLabels,
    EVERY_DAY_MASK,
} from '../../-utils/format';
import { isFlashcardsAuthoringEnabled } from '../../-utils/type-meta';
import { BatchPickerDialog, type BatchOption } from '../BatchPickerDialog';
import { useBatchInfo } from '../list/PlanListToolbar';
import { FieldBlock, FieldError, errorText } from '../items/item-fields';

/**
 * Step 1 of "Plan with AI": the brief.
 *
 * A react-hook-form over `aiBriefSchema`: batches, title, topic, the course content to
 * ground the draft in (with real loading / empty / error states and a pre-flight line
 * saying how much of it the AI can actually read), the plan's shape (start, "1 day" /
 * week / fortnight / month / custom, weekday chips, tasks per day, kinds including
 * Flashcards), language, difficulty and the daily window. The cost line (balance →
 * after) sits in the dialog footer (`BriefCostLine`).
 */

export { MAX_GROUNDING_CHARS };

const KIND_LABEL_KEY: Record<(typeof AI_KINDS)[number], string> = {
    question_of_day: 'wizard.kind_question',
    text_question: 'wizard.kind_text',
    poll: 'wizard.kind_poll',
    reading: 'wizard.kind_reading',
    flashcards: 'wizard.kind_flashcards',
};

const LEARNER_VISIBLE = new Set(['PUBLISHED', 'UNSYNC']);
/**
 * Document lessons whose stored data is prose the AI can read. PDFs, presentations
 * (drawing JSON), code, notebooks and Scratch projects store something else.
 */
const TEXT_DOC_TYPES = new Set(['', 'DOC', 'HTML']);

// ── Grounding ────────────────────────────────────────────────────────────────

interface SlideLike {
    id: string;
    title?: string;
    status?: string;
    source_type?: string;
    document_slide?: {
        type?: string | null;
        data?: string | null;
        published_data?: string | null;
    } | null;
}

function plainLength(html: string): number {
    return html
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim().length;
}

export interface GroundingSummary {
    /** none = no chapters picked. */
    status: 'none' | 'loading' | 'ready' | 'error';
    texts: GroundingText[];
    /** Text lessons the AI will read. */
    textLessons: number;
    /** Characters of readable text (before the AI's cap). */
    chars: number;
    /** Videos, PDFs, questions and other lessons with no readable text. */
    unusable: number;
    /** Lessons learners can't see yet; left out so a draft never quotes them. */
    unpublished: number;
    retry: () => void;
}

/**
 * The picked chapters' lessons, read once per chapter (cached for an hour), turned into
 * the grounding texts and the pre-flight counts. Only learner-visible lessons are used.
 */
export function useBriefGrounding(chapterIds: string[]): GroundingSummary {
    const queries = useQueries({
        queries: chapterIds.map((id) => ({ ...handleFetchSlides(id), retry: 1 })),
    });
    // One string that changes whenever any chapter's query settles or refetches.
    const signature = `${chapterIds.join('|')}#${queries
        .map((q) => `${q.status}:${q.dataUpdatedAt}`)
        .join('|')}`;
    return useMemo(() => {
        const retry = () => {
            for (const q of queries) if (q.isError) void q.refetch();
        };
        if (chapterIds.length === 0) {
            return {
                status: 'none',
                texts: [],
                textLessons: 0,
                chars: 0,
                unusable: 0,
                unpublished: 0,
                retry,
            };
        }
        const loading = queries.some((q) => q.isLoading);
        const failed = queries.some((q) => q.isError);
        const texts: GroundingText[] = [];
        let chars = 0;
        let unusable = 0;
        let unpublished = 0;
        for (const q of queries) {
            for (const slide of (q.data as SlideLike[] | undefined) ?? []) {
                if (!LEARNER_VISIBLE.has((slide.status ?? '').toUpperCase())) {
                    unpublished += 1;
                    continue;
                }
                const doc = slide.document_slide;
                const html = doc?.published_data || doc?.data || '';
                const readable = TEXT_DOC_TYPES.has((doc?.type ?? '').toUpperCase());
                const length = !doc || !readable ? 0 : plainLength(html);
                if (length > 40) {
                    texts.push({ title: slide.title, text: html });
                    chars += length;
                } else {
                    unusable += 1;
                }
            }
        }
        return {
            status: failed ? 'error' : loading ? 'loading' : 'ready',
            texts,
            textLessons: texts.length,
            chars,
            unusable,
            unpublished,
            retry,
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [signature]);
}

// ── Cost ─────────────────────────────────────────────────────────────────────

export interface DraftCost {
    credits: number;
    balance: number | null;
    after: number | null;
    sufficient: boolean | null;
    loading: boolean;
    /** The institute's AI plan pays (included / allowance); `after` uses the wallet part only. */
    coverage: PlanCoverage | null;
}

/**
 * The draft's price from the rate card (engagement_plan is priced per task requested:
 * `num_questions` = days × tasks per day) and the balance after it.
 */
export function useDraftCost(enabled: boolean, days: number, tasks: number): DraftCost {
    const preview = useToolCostPreview('engagement_plan', { days, num_questions: tasks }, enabled);
    const credits = preview.credits ?? estimateDraftCredits(tasks);
    const coverage = preview.coverage;
    const balance = preview.currentBalance;
    const after = balance != null ? balance - (coverage ? coverage.walletCredits : credits) : null;
    return {
        credits,
        balance,
        after,
        sufficient: after == null ? null : after >= 0,
        loading: preview.isLoading,
        coverage,
    };
}

/** "~10 credits · Balance 2,172 → ~2,162", or a warning when the balance is short. */
export function BriefCostLine({ cost, className }: { cost: DraftCost; className?: string }) {
    const { t, i18n } = useTranslation('engagement');
    const lang = i18n.language;
    const short = cost.sufficient === false;
    const [topUpOpen, setTopUpOpen] = useState(false);
    return (
        <div className={cn('min-w-0 space-y-0.5', className)}>
            <p className="flex items-center gap-1.5 text-caption text-neutral-600">
                <Sparkle size={14} className="shrink-0 text-primary-500" aria-hidden />
                <span className="font-semibold text-neutral-800">
                    {t('wizard.costLine.credits', { count: cost.credits })}
                </span>
                {cost.coverage && (
                    <span className="truncate font-semibold text-success-700">
                        {' · '}
                        {t(`wizard.costLine.plan.${cost.coverage.mode}`, {
                            plan: cost.coverage.planName,
                            count: Math.ceil(cost.coverage.walletCredits),
                        })}
                    </span>
                )}
                {!cost.coverage && cost.balance != null && cost.after != null && (
                    <span className="truncate">
                        {' · '}
                        {t('wizard.costLine.balance', {
                            balance: formatNumber(Math.round(cost.balance), lang),
                            after: formatNumber(Math.round(cost.after), lang),
                        })}
                    </span>
                )}
            </p>
            {short ? (
                <p
                    className="flex flex-wrap items-center gap-1.5 text-caption text-danger-600"
                    role="alert"
                >
                    <WarningCircle size={14} className="shrink-0" aria-hidden />
                    {t('wizard.costLine.short')}
                    <MyButton
                        type="button"
                        buttonType="text"
                        scale="small"
                        onClick={() => setTopUpOpen(true)}
                    >
                        {t('wizard.costLine.topUp')}
                    </MyButton>
                </p>
            ) : (
                // Below sm the footer is tight: the price and balance are what matter there.
                <p className="hidden text-caption text-neutral-500 sm:block">
                    {t('wizard.costLine.extras')}
                </p>
            )}
            {short && <TopUpModal open={topUpOpen} onOpenChange={setTopUpOpen} />}
        </div>
    );
}

// ── Small pieces ─────────────────────────────────────────────────────────────

function ChipButton({
    pressed,
    onClick,
    children,
    label,
    className,
}: {
    pressed: boolean;
    onClick: () => void;
    children: ReactNode;
    label?: string;
    className?: string;
}) {
    return (
        <button
            type="button"
            aria-pressed={pressed}
            aria-label={label}
            onClick={onClick}
            className={cn(
                'inline-flex h-8 items-center justify-center rounded-md border px-3 text-caption font-semibold transition-colors',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-300',
                pressed
                    ? 'border-primary-500 bg-primary-500 text-neutral-50'
                    : 'border-neutral-200 bg-white text-neutral-700 hover:border-neutral-300 hover:bg-neutral-50',
                className
            )}
        >
            {children}
        </button>
    );
}

function Section({
    title,
    hint,
    icon,
    children,
    aside,
}: {
    title: string;
    hint?: string;
    icon?: ReactNode;
    children: ReactNode;
    aside?: ReactNode;
}) {
    return (
        <section className="space-y-4 rounded-lg border border-neutral-200 p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex min-w-0 items-start gap-2">
                    {icon}
                    <div className="min-w-0">
                        <h3 className="text-subtitle font-semibold text-neutral-900">{title}</h3>
                        {hint && <p className="mt-0.5 text-caption text-neutral-500">{hint}</p>}
                    </div>
                </div>
                {aside}
            </div>
            {children}
        </section>
    );
}

/**
 * One row of GET modules-with-chapters. The API nests the chapter as `chapter`
 * (ChapterWithSlides); `chapter_dto` and the flat fields are read as fallbacks. Reading
 * only the fallbacks gave every row an undefined id, so no chapter could be picked.
 */
interface ChapterLike {
    id?: string;
    chapter_name?: string;
    chapter?: { id: string; chapter_name?: string } | null;
    chapter_dto?: { id: string; chapter_name?: string } | null;
}
interface ModuleLike {
    module: { id: string; module_name?: string };
    chapters: ChapterLike[];
}

// ── Brief step ───────────────────────────────────────────────────────────────

export interface ResumableDraft {
    title: string;
    savedAt: number;
    creditsSpent: number;
}

export interface BriefStepProps {
    form: UseFormReturn<AiBriefValues>;
    grounding: GroundingSummary;
    /** A reviewed draft from earlier in this tab that can be picked back up. */
    resumable?: ResumableDraft | null;
    onResume?: () => void;
    onDiscardResumable?: () => void;
    /** An error from the last draft attempt (already translated). */
    error?: string | null;
}

export function BriefStep({
    form,
    grounding,
    resumable,
    onResume,
    onDiscardResumable,
    error,
}: BriefStepProps) {
    const { t, i18n } = useTranslation('engagement');
    const lang = i18n.language;
    const { control, setValue } = form;
    const { errors, isSubmitted } = useFormState({ control });
    const [batchPickerOpen, setBatchPickerOpen] = useState(false);

    const batches = useWatch({ control, name: 'batches' });
    const groundingBatchId = useWatch({ control, name: 'groundingBatchId' });
    const subjectId = useWatch({ control, name: 'subjectId' });
    const chapterIds = useWatch({ control, name: 'chapterIds' });
    const spanDays = useWatch({ control, name: 'spanDays' });
    const customSpan = useWatch({ control, name: 'customSpan' });
    const startDate = useWatch({ control, name: 'startDate' });
    const dowMask = useWatch({ control, name: 'dowMask' });
    const perDay = useWatch({ control, name: 'perDay' });
    const kinds = useWatch({ control, name: 'kinds' });
    const topic = useWatch({ control, name: 'topic' });

    const titleCtl = useController({ control, name: 'title' });
    const topicCtl = useController({ control, name: 'topic' });
    const startCtl = useController({ control, name: 'startDate' });
    const openCtl = useController({ control, name: 'startTime' });
    const closeCtl = useController({ control, name: 'endTime' });
    const revealCtl = useController({ control, name: 'revealTime' });

    const validate = { shouldDirty: true, shouldValidate: isSubmitted };
    const today = useMemo(() => instituteToday(), []);
    const flashcardsOn = isFlashcardsAuthoringEnabled();
    const kindList = AI_KINDS.filter((kind) => kind !== 'flashcards' || flashcardsOn);

    // ── Batches + the course the grounding reads from ──
    const { studyLibraryData } = useStudyLibraryStore();
    const { getDetailsFromPackageSessionId } = useInstituteDetailsStore();
    const studyLibraryQuery = useStudyLibraryQuery();
    const libraryQuery = useQuery({ ...studyLibraryQuery, enabled: batches.length > 0 });

    const courseOf = (batch: BatchOption) => {
        const details = getDetailsFromPackageSessionId({ packageSessionId: batch.id });
        return {
            id: batch.courseId ?? details?.package_dto?.id ?? '',
            name: batch.courseName ?? details?.package_dto?.package_name ?? '',
        };
    };
    /** One representative batch per course among the selected batches. */
    const courses = useMemo(() => {
        const seen = new Map<string, { batchId: string; name: string }>();
        for (const batch of batches) {
            const course = courseOf(batch);
            const key = course.id || batch.id;
            if (!seen.has(key))
                seen.set(key, { batchId: batch.id, name: course.name || batch.label });
        }
        return [...seen.values()];
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [batches, getDetailsFromPackageSessionId]);
    const groundingBatch = batches.find((b) => b.id === groundingBatchId) ?? batches[0];
    // Course / session / level of the batch read from: the institute store, else fetched
    // by id (the store can miss batches, and then the course's chapters were unreachable).
    const groundingInfo = useBatchInfo(groundingBatch?.id);
    const groundingInfoLoading =
        useIsFetching({ queryKey: ['engagement-batch-info', groundingBatch?.id ?? ''] }) > 0;
    const groundingCourse = groundingBatch
        ? {
              ...courseOf(groundingBatch),
              ...(groundingInfo?.courseName ? { name: groundingInfo.courseName } : {}),
          }
        : null;

    const subjects: SubjectType[] = useMemo(() => {
        if (!groundingInfo?.courseId) return [];
        const library =
            (libraryQuery.data as typeof studyLibraryData | undefined) ?? studyLibraryData;
        const course = library?.find((c) => c.course.id === groundingInfo.courseId);
        const session = course?.sessions.find((s) => s.session_dto.id === groundingInfo.sessionId);
        const level = session?.level_with_details.find((l) => l.id === groundingInfo.levelId);
        return level?.subjects ?? [];
    }, [groundingInfo, studyLibraryData, libraryQuery.data]);

    // A course with a single subject needs no subject picker.
    const effectiveSubjectId = subjectId || (subjects.length === 1 ? subjects[0]!.id : '');
    const modulesQuery = useQuery({
        ...handleFetchModulesWithChapters(effectiveSubjectId, groundingBatch?.id ?? ''),
        enabled: Boolean(effectiveSubjectId) && Boolean(groundingBatch?.id),
        retry: 1,
    });
    const modules = useMemo(
        () =>
            ((modulesQuery.data as ModuleLike[] | undefined) ?? []).map((m) => ({
                id: m.module.id,
                name: m.module.module_name?.trim() || t('wizard.grounding.module'),
                chapters: (m.chapters ?? [])
                    .map((c) => ({
                        id: c.chapter?.id ?? c.chapter_dto?.id ?? c.id ?? '',
                        name:
                            c.chapter?.chapter_name?.trim() ||
                            c.chapter_dto?.chapter_name?.trim() ||
                            c.chapter_name?.trim() ||
                            t('wizard.grounding.chapter'),
                    }))
                    .filter((c) => c.id !== ''),
            })),
        [modulesQuery.data, t]
    );
    const chapterCount = modules.reduce((n, m) => n + m.chapters.length, 0);

    function setBatches(next: BatchOption[]) {
        setValue('batches', next, validate);
        const keep = next.some((b) => b.id === groundingBatchId);
        if (!keep) {
            setValue('groundingBatchId', next[0]?.id ?? '', { shouldDirty: true });
            setValue('subjectId', '', { shouldDirty: true });
            setValue('chapterIds', [], validate);
        }
    }

    function toggleChapter(id: string, on: boolean) {
        const next = on ? [...chapterIds, id] : chapterIds.filter((x) => x !== id);
        setValue('chapterIds', next, validate);
    }

    function toggleModule(ids: string[], on: boolean) {
        const rest = chapterIds.filter((x) => !ids.includes(x));
        setValue('chapterIds', on ? [...rest, ...ids] : rest, validate);
    }

    // ── Shape ──
    const runDates = briefRunDates({ startDate, spanDays, dowMask });
    const multiDay = Number.isFinite(spanDays) && spanDays > 1;
    const shownMask = isEveryDay(dowMask) ? EVERY_DAY_MASK : dowMask;
    const settingsQuery = useQuery({
        queryKey: ['engagement-settings'],
        queryFn: getEngagementSettings,
        staleTime: 5 * 60_000,
        retry: 1,
    });
    const dailyCap = settingsQuery.data?.settings.dailyItemCap ?? null;

    function toggleWeekday(bit: number) {
        const next = shownMask & bit ? shownMask & ~bit : shownMask | bit;
        // 0 means "every day" in the mask, so the last weekday can't be switched off.
        if (next === 0) return;
        setValue('dowMask', next === EVERY_DAY_MASK ? 0 : next, validate);
    }

    const languageOptions = useMemo(() => {
        let names: Intl.DisplayNames | null = null;
        try {
            names = new Intl.DisplayNames([lang, 'en'], { type: 'language' });
        } catch {
            names = null;
        }
        return AI_LANGUAGES.map((language) => ({
            _id: language.value,
            value: language.value,
            label: language.code
                ? names?.of(language.code) ?? language.value
                : t(`wizard.languages.${language.value}`, { defaultValue: language.value }),
        }));
    }, [lang, t]);

    const difficultyOptions = (['easy', 'medium', 'hard'] as const).map((value) => ({
        _id: value,
        value,
        label: t(`wizard.${value}`),
    }));

    const batchesError = errorText(errors.batches);
    const topicError = errorText(errors.topic);
    const kindsError = errorText(errors.kinds);

    const batchSummary =
        batches.length === 0
            ? t('wizard.selectBatches')
            : batches.length === 1
              ? batches[0]!.label
              : t('wizard.batchesSelected', { count: batches.length });

    return (
        <Form {...form}>
            <div className="space-y-5">
                {resumable && (
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary-200 bg-primary-50 px-4 py-3">
                        <div className="flex min-w-0 items-start gap-2">
                            <ClockCounterClockwise
                                size={18}
                                className="mt-0.5 shrink-0 text-primary-500"
                                aria-hidden
                            />
                            <div className="min-w-0">
                                <p className="text-body font-semibold text-neutral-900">
                                    {t('wizard.resume.title')}
                                </p>
                                <p className="truncate text-caption text-neutral-600">
                                    {t('wizard.resume.body', {
                                        title: resumable.title || t('preview.untitled'),
                                        when: formatRelative(
                                            new Date(resumable.savedAt).toISOString(),
                                            lang
                                        ),
                                    })}
                                </p>
                            </div>
                        </div>
                        <div className="flex gap-2">
                            <MyButton
                                type="button"
                                buttonType="secondary"
                                scale="small"
                                onClick={onDiscardResumable}
                            >
                                {t('wizard.resume.discard')}
                            </MyButton>
                            <MyButton type="button" scale="small" onClick={onResume}>
                                {t('wizard.resume.action')}
                            </MyButton>
                        </div>
                    </div>
                )}

                {error && (
                    <p
                        role="alert"
                        className="flex items-start gap-2 rounded-md bg-danger-50 px-3 py-2 text-body text-danger-700"
                    >
                        <WarningCircle size={16} className="mt-0.5 shrink-0" aria-hidden />
                        <span>{error}</span>
                    </p>
                )}

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <FieldBlock label={t('wizard.batches')} required error={batchesError}>
                        {(a11y) => (
                            <MyButton
                                {...a11y}
                                type="button"
                                buttonType="secondary"
                                scale="medium"
                                className={cn(
                                    'w-full justify-start font-regular',
                                    batchesError && 'border-danger-600'
                                )}
                                onClick={() => setBatchPickerOpen(true)}
                            >
                                <UsersThree size={16} className="shrink-0" aria-hidden />
                                <span className="truncate">{batchSummary}</span>
                            </MyButton>
                        )}
                    </FieldBlock>
                    <FieldBlock
                        label={t('wizard.planTitle')}
                        error={errorText(errors.title)}
                        hint={t('wizard.planTitlePlaceholder')}
                    >
                        {(a11y) => (
                            <MyInput
                                {...a11y}
                                ref={titleCtl.field.ref}
                                inputType="text"
                                dir="auto"
                                input={titleCtl.field.value}
                                onChangeFunction={(e) => titleCtl.field.onChange(e.target.value)}
                                onBlur={titleCtl.field.onBlur}
                                className="sm:w-full"
                            />
                        )}
                    </FieldBlock>
                </div>

                <FieldBlock
                    label={t('wizard.topic')}
                    error={topicError}
                    hint={t('wizard.topicHint')}
                >
                    {(a11y) => (
                        <Textarea
                            {...a11y}
                            ref={topicCtl.field.ref}
                            dir="auto"
                            value={topicCtl.field.value}
                            onChange={(e) => topicCtl.field.onChange(e.target.value)}
                            onBlur={topicCtl.field.onBlur}
                            rows={3}
                            placeholder={t('wizard.topicPlaceholder')}
                            className={cn(topicError && 'border-danger-600')}
                        />
                    )}
                </FieldBlock>

                {/* Grounding */}
                <Section
                    title={t('wizard.ground')}
                    hint={t('wizard.groundHint')}
                    icon={
                        <BookOpenText
                            size={18}
                            className="mt-0.5 shrink-0 text-neutral-500"
                            aria-hidden
                        />
                    }
                >
                    {batches.length === 0 ? (
                        <p className="text-caption text-neutral-500">
                            {t('wizard.pickBatchFirst')}
                        </p>
                    ) : (
                        <div className="space-y-4">
                            <div className="flex flex-wrap items-center gap-2 text-caption text-neutral-600">
                                <span>{t('wizard.grounding.readingFrom')}</span>
                                {courses.length > 1 ? (
                                    <Select
                                        value={groundingBatch?.id ?? ''}
                                        onValueChange={(value) => {
                                            setValue('groundingBatchId', value, {
                                                shouldDirty: true,
                                            });
                                            setValue('subjectId', '', { shouldDirty: true });
                                            setValue('chapterIds', [], validate);
                                        }}
                                    >
                                        <SelectTrigger
                                            className="h-8 w-auto min-w-40"
                                            aria-label={t('wizard.grounding.switchCourse')}
                                        >
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {courses.map((course) => (
                                                <SelectItem
                                                    key={course.batchId}
                                                    value={course.batchId}
                                                >
                                                    {course.name}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                ) : (
                                    <span className="font-semibold text-neutral-900">
                                        {groundingCourse?.name || groundingBatch?.label}
                                    </span>
                                )}
                            </div>

                            {(libraryQuery.isLoading || (!groundingInfo && groundingInfoLoading)) &&
                            subjects.length === 0 ? (
                                <div className="space-y-2" aria-busy="true">
                                    <Skeleton className="h-9 w-full sm:w-60" />
                                    <Skeleton className="h-24 w-full" />
                                </div>
                            ) : libraryQuery.isError && subjects.length === 0 ? (
                                <LoadError
                                    message={t('wizard.grounding.libraryError')}
                                    onRetry={() => void libraryQuery.refetch()}
                                />
                            ) : subjects.length === 0 ? (
                                <p className="flex items-start gap-2 rounded-md bg-neutral-50 px-3 py-2 text-caption text-neutral-600">
                                    <Info size={14} className="mt-0.5 shrink-0" aria-hidden />
                                    {t('wizard.grounding.noSubjects')}
                                </p>
                            ) : (
                                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                                    {subjects.length > 1 && (
                                        <div className="flex flex-col gap-1.5">
                                            <label
                                                htmlFor="ai-subject"
                                                className="text-body font-medium text-neutral-700"
                                            >
                                                {t('wizard.subject')}
                                            </label>
                                            <Select
                                                value={subjectId}
                                                onValueChange={(value) => {
                                                    setValue('subjectId', value, {
                                                        shouldDirty: true,
                                                    });
                                                    setValue('chapterIds', [], validate);
                                                }}
                                            >
                                                <SelectTrigger id="ai-subject">
                                                    <SelectValue
                                                        placeholder={t('wizard.selectSubject')}
                                                    />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {subjects.map((s) => (
                                                        <SelectItem key={s.id} value={s.id}>
                                                            {s.subject_name}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    )}
                                    <div
                                        className={cn(
                                            'flex min-w-0 flex-col gap-1.5',
                                            subjects.length > 1 ? 'sm:col-span-2' : 'sm:col-span-3'
                                        )}
                                    >
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="text-body font-medium text-neutral-700">
                                                {t('wizard.chapters')}
                                            </span>
                                            {chapterIds.length > 0 && (
                                                <MyButton
                                                    type="button"
                                                    buttonType="text"
                                                    scale="small"
                                                    onClick={() =>
                                                        setValue('chapterIds', [], validate)
                                                    }
                                                >
                                                    {t('wizard.grounding.clear', {
                                                        count: chapterIds.length,
                                                    })}
                                                </MyButton>
                                            )}
                                        </div>
                                        <div className="max-h-56 overflow-y-auto rounded-md border border-neutral-200">
                                            {!effectiveSubjectId ? (
                                                <p className="p-3 text-caption text-neutral-500">
                                                    {t('wizard.pickSubject')}
                                                </p>
                                            ) : modulesQuery.isLoading ? (
                                                <div className="space-y-2 p-3" aria-busy="true">
                                                    <Skeleton className="h-4 w-1/2" />
                                                    <Skeleton className="h-4 w-3/4" />
                                                    <Skeleton className="h-4 w-2/3" />
                                                </div>
                                            ) : modulesQuery.isError ? (
                                                <div className="p-3">
                                                    <LoadError
                                                        message={t(
                                                            'wizard.grounding.chaptersError'
                                                        )}
                                                        onRetry={() => void modulesQuery.refetch()}
                                                    />
                                                </div>
                                            ) : chapterCount === 0 ? (
                                                <p className="p-3 text-caption text-neutral-500">
                                                    {t('wizard.grounding.noChapters')}
                                                </p>
                                            ) : (
                                                <ul className="divide-y divide-neutral-100">
                                                    {modules
                                                        .filter((m) => m.chapters.length > 0)
                                                        .map((module) => {
                                                            const ids = module.chapters.map(
                                                                (c) => c.id
                                                            );
                                                            const all = ids.every((id) =>
                                                                chapterIds.includes(id)
                                                            );
                                                            return (
                                                                <li key={module.id} className="p-2">
                                                                    <div className="flex items-center justify-between gap-2 px-1">
                                                                        <span className="truncate text-caption font-semibold uppercase tracking-wide text-neutral-500">
                                                                            {module.name}
                                                                        </span>
                                                                        <MyButton
                                                                            type="button"
                                                                            buttonType="text"
                                                                            scale="small"
                                                                            onClick={() =>
                                                                                toggleModule(
                                                                                    ids,
                                                                                    !all
                                                                                )
                                                                            }
                                                                        >
                                                                            {all
                                                                                ? t(
                                                                                      'wizard.grounding.clearModule'
                                                                                  )
                                                                                : t(
                                                                                      'wizard.grounding.selectAll'
                                                                                  )}
                                                                        </MyButton>
                                                                    </div>
                                                                    <ul className="mt-1 space-y-0.5">
                                                                        {module.chapters.map(
                                                                            (chapter) => {
                                                                                const id = `ai-ch-${chapter.id}`;
                                                                                return (
                                                                                    <li
                                                                                        key={
                                                                                            chapter.id
                                                                                        }
                                                                                    >
                                                                                        <label
                                                                                            htmlFor={
                                                                                                id
                                                                                            }
                                                                                            className="flex cursor-pointer items-center gap-2 rounded-md p-1.5 text-body text-neutral-800 hover:bg-neutral-50"
                                                                                        >
                                                                                            <Checkbox
                                                                                                id={
                                                                                                    id
                                                                                                }
                                                                                                checked={chapterIds.includes(
                                                                                                    chapter.id
                                                                                                )}
                                                                                                onCheckedChange={(
                                                                                                    v
                                                                                                ) =>
                                                                                                    toggleChapter(
                                                                                                        chapter.id,
                                                                                                        v ===
                                                                                                            true
                                                                                                    )
                                                                                                }
                                                                                            />
                                                                                            <span className="truncate">
                                                                                                {
                                                                                                    chapter.name
                                                                                                }
                                                                                            </span>
                                                                                        </label>
                                                                                    </li>
                                                                                );
                                                                            }
                                                                        )}
                                                                    </ul>
                                                                </li>
                                                            );
                                                        })}
                                                </ul>
                                            )}
                                        </div>
                                        <GroundingPreflight
                                            grounding={grounding}
                                            hasTopic={Boolean(topic.trim())}
                                        />
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </Section>

                {/* Shape */}
                <Section title={t('wizard.shape')}>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <FieldBlock label={t('wizard.starts')} error={errorText(errors.startDate)}>
                            {(a11y) => (
                                <MyInput
                                    {...a11y}
                                    ref={startCtl.field.ref}
                                    inputType="date"
                                    min={today}
                                    input={startCtl.field.value}
                                    onChangeFunction={(e) =>
                                        startCtl.field.onChange(e.target.value)
                                    }
                                    onBlur={startCtl.field.onBlur}
                                    className="sm:w-full"
                                />
                            )}
                        </FieldBlock>
                        <div className="flex min-w-0 flex-col gap-1.5">
                            <span
                                id="ai-duration"
                                className="text-body font-medium text-neutral-700"
                            >
                                {t('wizard.duration')}
                            </span>
                            <div
                                role="group"
                                aria-labelledby="ai-duration"
                                className="flex flex-wrap gap-1.5"
                            >
                                {DURATION_PRESETS.map((days) => (
                                    <ChipButton
                                        key={days}
                                        pressed={!customSpan && spanDays === days}
                                        onClick={() => {
                                            setValue('customSpan', false, { shouldDirty: true });
                                            setValue('spanDays', days, validate);
                                        }}
                                    >
                                        {t(`wizard.span.${days}`)}
                                    </ChipButton>
                                ))}
                                <ChipButton
                                    pressed={customSpan}
                                    onClick={() =>
                                        setValue('customSpan', true, { shouldDirty: true })
                                    }
                                >
                                    {t('wizard.span.custom')}
                                </ChipButton>
                            </div>
                            {customSpan && (
                                <div className="flex items-center gap-2">
                                    <MyInput
                                        inputType="number"
                                        inputMode="numeric"
                                        min={1}
                                        max={MAX_SPAN_DAYS}
                                        aria-label={t('wizard.span.customLabel')}
                                        input={Number.isFinite(spanDays) ? String(spanDays) : ''}
                                        onChangeFunction={(e) =>
                                            setValue(
                                                'spanDays',
                                                e.target.value.trim() === ''
                                                    ? Number.NaN
                                                    : Number(e.target.value),
                                                validate
                                            )
                                        }
                                        className="sm:w-24"
                                    />
                                    <span className="text-caption text-neutral-500">
                                        {t('wizard.span.customUnit')}
                                    </span>
                                </div>
                            )}
                            <FieldError message={errorText(errors.spanDays)} />
                        </div>
                    </div>

                    {multiDay && (
                        <div className="flex flex-col gap-1.5">
                            <span
                                id="ai-weekdays"
                                className="text-body font-medium text-neutral-700"
                            >
                                {t('wizard.weekdays')}
                            </span>
                            <div
                                role="group"
                                aria-labelledby="ai-weekdays"
                                className="flex flex-wrap gap-1.5"
                            >
                                {weekdayLabels(lang, 'short').map(({ bit, label }) => (
                                    <ChipButton
                                        key={bit}
                                        pressed={(shownMask & bit) !== 0}
                                        onClick={() => toggleWeekday(bit)}
                                        className="min-w-12"
                                    >
                                        {label}
                                    </ChipButton>
                                ))}
                            </div>
                            <FieldError message={errorText(errors.dowMask)} />
                        </div>
                    )}

                    {runDates.length > 0 && (
                        <p className="flex items-start gap-2 rounded-md bg-neutral-50 px-3 py-2 text-caption text-neutral-700">
                            <Info
                                size={14}
                                className="mt-0.5 shrink-0 text-neutral-500"
                                aria-hidden
                            />
                            <span>
                                {runDates.length === 1
                                    ? t('wizard.runsOnDay', {
                                          day: formatDay(runDates[0]!, lang, { weekday: true }),
                                          tasks: t('wizard.tasks', { count: perDay }),
                                      })
                                    : t('wizard.runsOn', {
                                          days: t('wizard.days', { count: runDates.length }),
                                          range: formatDayRange(
                                              runDates[0]!,
                                              runDates[runDates.length - 1]!,
                                              lang
                                          ),
                                          tasks: t('wizard.tasks', {
                                              count: runDates.length * perDay,
                                          }),
                                      })}
                            </span>
                        </p>
                    )}

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <div className="flex min-w-0 flex-col gap-1.5">
                            <span id="ai-perday" className="text-body font-medium text-neutral-700">
                                {t('wizard.perDay')}
                            </span>
                            <div role="group" aria-labelledby="ai-perday" className="flex gap-1.5">
                                {[1, 2, 3].map((n) => (
                                    <ChipButton
                                        key={n}
                                        pressed={perDay === n}
                                        onClick={() => setValue('perDay', n, validate)}
                                        className="min-w-10"
                                    >
                                        {formatNumber(n, lang)}
                                    </ChipButton>
                                ))}
                            </div>
                            {dailyCap != null && perDay > dailyCap && (
                                <p className="flex items-start gap-1.5 text-caption text-warning-700">
                                    <Warning size={14} className="mt-0.5 shrink-0" aria-hidden />
                                    {t('wizard.overCap', { count: dailyCap })}
                                </p>
                            )}
                        </div>
                        <SelectField
                            control={control}
                            name="difficulty"
                            label={t('wizard.difficulty')}
                            options={difficultyOptions}
                            className="sm:w-full"
                            labelStyle="text-body font-medium text-neutral-700"
                        />
                    </div>

                    <div className="flex flex-col gap-1.5">
                        <span id="ai-kinds" className="text-body font-medium text-neutral-700">
                            {t('wizard.kinds')}
                        </span>
                        <div
                            role="group"
                            aria-labelledby="ai-kinds"
                            className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3"
                        >
                            {kindList.map((kind) => {
                                const id = `ai-kind-${kind}`;
                                return (
                                    <label
                                        key={kind}
                                        htmlFor={id}
                                        className={cn(
                                            'flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors',
                                            kinds[kind]
                                                ? 'border-primary-300 bg-primary-50'
                                                : 'border-neutral-200 hover:border-neutral-300'
                                        )}
                                    >
                                        <Switch
                                            id={id}
                                            checked={kinds[kind]}
                                            onCheckedChange={(on) =>
                                                setValue(`kinds.${kind}`, on, validate)
                                            }
                                            className="mt-0.5"
                                        />
                                        <span className="min-w-0">
                                            <span className="block text-body font-semibold text-neutral-900">
                                                {t(KIND_LABEL_KEY[kind])}
                                            </span>
                                            <span className="block text-caption text-neutral-500">
                                                {t(`${KIND_LABEL_KEY[kind]}_hint`)}
                                            </span>
                                        </span>
                                    </label>
                                );
                            })}
                        </div>
                        <FieldError message={kindsError} />
                    </div>
                </Section>

                {/* Window + language */}
                <Section title={t('wizard.window')} hint={t('wizard.windowHint')}>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                        <FieldBlock label={t('wizard.opensAt')} error={errorText(errors.startTime)}>
                            {(a11y) => (
                                <MyInput
                                    {...a11y}
                                    ref={openCtl.field.ref}
                                    inputType="time"
                                    input={openCtl.field.value}
                                    onChangeFunction={(e) => openCtl.field.onChange(e.target.value)}
                                    onBlur={openCtl.field.onBlur}
                                    className="sm:w-full"
                                />
                            )}
                        </FieldBlock>
                        <FieldBlock label={t('wizard.closesAt')} error={errorText(errors.endTime)}>
                            {(a11y) => (
                                <MyInput
                                    {...a11y}
                                    ref={closeCtl.field.ref}
                                    inputType="time"
                                    input={closeCtl.field.value}
                                    onChangeFunction={(e) =>
                                        closeCtl.field.onChange(e.target.value)
                                    }
                                    onBlur={closeCtl.field.onBlur}
                                    className="sm:w-full"
                                />
                            )}
                        </FieldBlock>
                        <FieldBlock
                            label={t('wizard.revealAt')}
                            error={errorText(errors.revealTime)}
                        >
                            {(a11y) => (
                                <MyInput
                                    {...a11y}
                                    ref={revealCtl.field.ref}
                                    inputType="time"
                                    input={revealCtl.field.value}
                                    onChangeFunction={(e) =>
                                        revealCtl.field.onChange(e.target.value)
                                    }
                                    onBlur={revealCtl.field.onBlur}
                                    className="sm:w-full"
                                />
                            )}
                        </FieldBlock>
                    </div>
                    <SelectField
                        control={control}
                        name="language"
                        label={t('wizard.language')}
                        options={languageOptions}
                        className="sm:w-60"
                        labelStyle="text-body font-medium text-neutral-700"
                    />
                </Section>
            </div>

            <BatchPickerDialog
                open={batchPickerOpen}
                onOpenChange={setBatchPickerOpen}
                selected={batches}
                onConfirm={setBatches}
            />
        </Form>
    );
}

function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
    const { t } = useTranslation('engagement');
    return (
        <div className="flex flex-wrap items-center gap-3 rounded-md bg-danger-50 px-3 py-2">
            <WarningCircle size={16} className="shrink-0 text-danger-600" aria-hidden />
            <span className="min-w-0 flex-1 text-caption text-danger-700">{message}</span>
            <MyButton type="button" buttonType="secondary" scale="small" onClick={onRetry}>
                <ArrowClockwise size={14} aria-hidden /> {t('common.retry')}
            </MyButton>
        </div>
    );
}

/** "Using 6 text lessons (~9k characters) · 3 videos or PDFs can't be used." */
function GroundingPreflight({
    grounding,
    hasTopic,
}: {
    grounding: GroundingSummary;
    hasTopic: boolean;
}) {
    const { t, i18n } = useTranslation('engagement');
    const lang = i18n.language;
    if (grounding.status === 'none') return null;
    if (grounding.status === 'loading') {
        return (
            <p className="text-caption text-neutral-500" aria-live="polite">
                {t('wizard.grounding.checking')}
            </p>
        );
    }
    if (grounding.status === 'error') {
        return <LoadError message={t('wizard.grounding.lessonsError')} onRetry={grounding.retry} />;
    }
    const approxK = (n: number) =>
        n >= 1000 ? `${formatNumber(Math.round(n / 1000), lang)}k` : formatNumber(n, lang);
    const parts: string[] = [];
    if (grounding.textLessons > 0) {
        parts.push(
            t('wizard.grounding.using', {
                count: grounding.textLessons,
                chars: approxK(grounding.chars),
            })
        );
    }
    if (grounding.unusable > 0) {
        parts.push(t('wizard.grounding.unusable', { count: grounding.unusable }));
    }
    if (grounding.unpublished > 0) {
        parts.push(t('wizard.grounding.unpublished', { count: grounding.unpublished }));
    }
    const none = grounding.textLessons === 0;
    // No lessons at all (not merely none with text) reads differently.
    const empty = none && grounding.unusable === 0 && grounding.unpublished === 0;
    const capped = grounding.chars > MAX_GROUNDING_CHARS;
    return (
        <div className="space-y-1" aria-live="polite">
            {parts.length > 0 && (
                <p className="text-caption text-neutral-600">{parts.join(' · ')}</p>
            )}
            {capped && (
                <p className="text-caption text-neutral-500">
                    {t('wizard.grounding.capped', { chars: approxK(MAX_GROUNDING_CHARS) })}
                </p>
            )}
            {none && (
                <p className="flex items-start gap-1.5 rounded-md bg-warning-50 px-2 py-1.5 text-caption text-warning-700">
                    <Warning size={14} className="mt-0.5 shrink-0" aria-hidden />
                    {empty
                        ? hasTopic
                            ? t('wizard.grounding.emptyWithTopic')
                            : t('wizard.grounding.emptyNoTopic')
                        : hasTopic
                          ? t('wizard.grounding.noneWithTopic')
                          : t('wizard.grounding.noneNoTopic')}
                </p>
            )}
        </div>
    );
}
