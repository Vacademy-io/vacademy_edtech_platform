import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
    ArrowLeft,
    DotsThreeVertical,
    NotePencil,
    Sparkle,
    WarningCircle,
} from '@phosphor-icons/react';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { MyDropdown } from '@/components/design-system/dropdown';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { createEngagementPlan } from '../-services/engagement-service';
import {
    AI_CREDITS_QUERY_KEY,
    newIdempotencyKey,
    withoutImagePlaceholders,
} from '../-services/ai-plan-service';
import {
    aiBriefSchema,
    briefRunDates,
    defaultAiBrief,
    useAiDraftStore,
    type AiBriefValues,
} from '../-stores/ai-draft-store';
import type { EngagementPlanRequest, PlanStatus } from '../-types/types';
import {
    composerSchema,
    flattenFormErrors,
    formToRequest,
    newComposerForm,
    requestToForm,
    type ComposerForm,
} from './forms/composer-schema';
import { saveErrorText } from './composer/use-composer-save';
import { PlanComposerDialog } from './PlanComposerDialog';
import { useBatchInfo } from './list/PlanListToolbar';
import { BriefCostLine, BriefStep, useBriefGrounding, useDraftCost } from './ai/BriefStep';
import { GeneratingStep } from './ai/GeneratingStep';
import { ReviewStep } from './ai/ReviewStep';

/**
 * Plan with AI.
 *
 * Brief → draft (a background job) → review → save. The teacher sees and can edit every
 * task before a learner does; the AI never publishes. Cost is shown before it is spent.
 *
 * A thin shell: the steps live in `ai/BriefStep`, `ai/GeneratingStep` and
 * `ai/ReviewStep`; the job and the draft under review live in `useAiDraftStore`, so
 * closing the dialog never loses paid work:
 * - Closing while drafting keeps the job running; a toast reports "draft ready".
 * - Closing a draft under review asks first (Keep editing / Keep for later / Save as
 *   draft / Discard); the draft is offered back ("Resume") until saved or discarded.
 * - "Edit in full editor" hands the draft to the composer (`PlanComposerDialog`'s
 *   `draft` prop).
 */

type View = 'brief' | 'review';

type Confirm = 'close' | 'cancel' | 'replace' | null;

export function AiPlanWizard({
    open,
    onOpenChange,
    onCreated,
    defaultPackageSessionId,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onCreated: () => void;
    defaultPackageSessionId?: string;
}) {
    const { t } = useTranslation('engagement');
    const queryClient = useQueryClient();

    const job = useAiDraftStore((s) => s.job);
    const review = useAiDraftStore((s) => s.review);
    const groundingMemo = useAiDraftStore((s) => s.grounding);
    const openRequest = useAiDraftStore((s) => s.openRequest);
    const creditsSeq = useAiDraftStore((s) => s.creditsSeq);
    const hydrate = useAiDraftStore((s) => s.hydrate);
    const mount = useAiDraftStore((s) => s.mount);
    const setVisible = useAiDraftStore((s) => s.setVisible);
    const startDraft = useAiDraftStore((s) => s.startDraft);
    const cancelJob = useAiDraftStore((s) => s.cancelJob);
    const dismissJob = useAiDraftStore((s) => s.dismissJob);
    const setReviewPlan = useAiDraftStore((s) => s.setReviewPlan);
    const addCredits = useAiDraftStore((s) => s.addCredits);
    const discardReview = useAiDraftStore((s) => s.discardReview);

    // Opened by the parent, or by "Review" on the draft-ready toast.
    const [selfOpen, setSelfOpen] = useState(false);
    const isOpen = open || selfOpen;
    const [view, setView] = useState<View>('brief');
    const [confirm, setConfirm] = useState<Confirm>(null);
    const [briefError, setBriefError] = useState<string | null>(null);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [cancelling, setCancelling] = useState(false);
    const [selectedDay, setSelectedDay] = useState(0);
    const [openKey, setOpenKey] = useState<string | null>(null);
    const [composerDraft, setComposerDraft] = useState<EngagementPlanRequest | null>(null);
    const [composerOpen, setComposerOpen] = useState(false);

    useEffect(() => {
        hydrate();
        return mount();
    }, [hydrate, mount]);

    useEffect(() => {
        setVisible(isOpen);
        return () => setVisible(false);
    }, [isOpen, setVisible]);

    // Every paid call refreshes the balance in the header and the cost line.
    useEffect(() => {
        if (creditsSeq > 0) void queryClient.invalidateQueries({ queryKey: AI_CREDITS_QUERY_KEY });
    }, [creditsSeq, queryClient]);

    // ── Brief form ──
    const briefForm = useForm<AiBriefValues>({
        resolver: zodResolver(aiBriefSchema),
        defaultValues: defaultAiBrief(),
        mode: 'onSubmit',
        reValidateMode: 'onChange',
    });
    const chapterIds = useWatch({ control: briefForm.control, name: 'chapterIds' });
    const startDate = useWatch({ control: briefForm.control, name: 'startDate' });
    const spanDays = useWatch({ control: briefForm.control, name: 'spanDays' });
    const dowMask = useWatch({ control: briefForm.control, name: 'dowMask' });
    const perDay = useWatch({ control: briefForm.control, name: 'perDay' });
    const grounding = useBriefGrounding(chapterIds);
    const draftDays = briefRunDates({ startDate, spanDays, dowMask }).length;
    const cost = useDraftCost(isOpen, Math.max(1, draftDays), Math.max(1, draftDays) * perDay);

    // ── Review form (the composer's model, so ItemEditor works unchanged) ──
    const reviewForm = useForm<ComposerForm>({
        resolver: zodResolver(composerSchema, undefined, { raw: true }),
        defaultValues: newComposerForm(),
        mode: 'onSubmit',
        reValidateMode: 'onChange',
        shouldFocusError: false,
    });
    const reviewLoaded = useRef(false);

    const loadReview = useCallback(() => {
        const current = useAiDraftStore.getState().review;
        if (!current) return false;
        const values = requestToForm(current.plan);
        values.status = 'DRAFT';
        values.packageSessionIds = current.brief.batches.map((b) => b.id);
        reviewForm.reset(values);
        reviewLoaded.current = true;
        setSelectedDay(0);
        setOpenKey(values.slots[0]?.items[0]?.key ?? null);
        setSaveError(null);
        return true;
    }, [reviewForm]);

    // Mirror review edits to the store (and sessionStorage), lightly debounced.
    useEffect(() => {
        if (view !== 'review') return;
        let timer: number | undefined;
        const subscription = reviewForm.watch(() => {
            if (!reviewLoaded.current) return;
            window.clearTimeout(timer);
            timer = window.setTimeout(
                () => setReviewPlan(formToRequest(reviewForm.getValues())),
                400
            );
        });
        return () => {
            subscription.unsubscribe();
            window.clearTimeout(timer);
            if (reviewLoaded.current) setReviewPlan(formToRequest(reviewForm.getValues()));
        };
    }, [view, reviewForm, setReviewPlan]);

    // Seed the brief's batch from the caller (a course page opens it for its batch), named
    // as the plans list names it; a name that arrives after seeding replaces the fallback.
    const seedInfo = useBatchInfo(isOpen ? defaultPackageSessionId : null);
    const seededFor = useRef<string | null>(null);
    useEffect(() => {
        if (!isOpen || !defaultPackageSessionId) return;
        const current = briefForm.getValues('batches');
        const option = seedInfo
            ? {
                  id: seedInfo.id,
                  label: seedInfo.label,
                  courseId: seedInfo.courseId,
                  courseName: seedInfo.courseName,
              }
            : null;
        if (seededFor.current !== defaultPackageSessionId) {
            seededFor.current = defaultPackageSessionId;
            if (current.length > 0) return;
            briefForm.setValue('batches', [
                option ?? { id: defaultPackageSessionId, label: t('composer.thisBatch') },
            ]);
            briefForm.setValue('groundingBatchId', defaultPackageSessionId);
            return;
        }
        const only = current.length === 1 ? current[0] : null;
        if (
            option &&
            only &&
            only.id === option.id &&
            !only.courseId &&
            only.label !== option.label
        ) {
            briefForm.setValue('batches', [option]);
        }
    }, [isOpen, defaultPackageSessionId, seedInfo, briefForm, t]);

    // A job that lands while the wizard shows it opens the review.
    const hadJob = useRef(Boolean(job));
    const lastReview = useRef(review);
    useEffect(() => {
        // Landed = the job just went away AND a new review arrived with it (a dismissed
        // or cancelled job never opens an older draft).
        const landed = hadJob.current && !job && review && review !== lastReview.current;
        hadJob.current = Boolean(job);
        lastReview.current = review;
        if (landed && isOpen) {
            loadReview();
            setView('review');
        }
    }, [job, review, isOpen, loadReview]);

    // "Review" on the toast.
    const handledRequest = useRef(openRequest?.seq ?? 0);
    useEffect(() => {
        if (!openRequest || openRequest.seq === handledRequest.current) return;
        handledRequest.current = openRequest.seq;
        setSelfOpen(true);
        if (openRequest.step === 'review' && loadReview()) setView('review');
    }, [openRequest, loadReview]);

    // Opening again starts on the brief (the draft is offered as "Resume"), unless a
    // draft is being written or was just asked for.
    const wasOpen = useRef(isOpen);
    useEffect(() => {
        if (isOpen && !wasOpen.current && view === 'review' && !reviewLoaded.current) {
            setView('brief');
        }
        wasOpen.current = isOpen;
    }, [isOpen, view]);

    const step: 'brief' | 'generating' | 'review' = job
        ? 'generating'
        : view === 'review' && review
          ? 'review'
          : 'brief';

    // ── Closing ──
    function closeNow() {
        setConfirm(null);
        setSelfOpen(false);
        if (view === 'review' && reviewLoaded.current) {
            setReviewPlan(formToRequest(reviewForm.getValues()));
        }
        // Next open shows the brief with "Resume" rather than a stale form.
        reviewLoaded.current = false;
        setView('brief');
        onOpenChange(false);
    }

    function requestClose() {
        if (saving) return;
        if (step === 'review') {
            setConfirm('close');
            return;
        }
        if (step === 'generating' && job?.status === 'RUNNING') {
            toast.info(t('wizard.toast.stillDrafting'), {
                description: t('wizard.toast.stillDraftingBody'),
            });
        }
        closeNow();
    }

    // ── Drafting ──
    function draftWith(values: AiBriefValues, key: string) {
        setBriefError(null);
        void startDraft({
            brief: values,
            grounding: grounding.texts,
            idempotencyKey: key,
            credits: cost.credits,
        });
    }

    const submitBrief = briefForm.handleSubmit((values) => {
        if (grounding.status === 'loading') {
            setBriefError(t('wizard.errors.groundingLoading'));
            return;
        }
        if (
            values.chapterIds.length > 0 &&
            grounding.status === 'ready' &&
            grounding.textLessons === 0 &&
            !values.topic.trim()
        ) {
            setBriefError(
                grounding.unusable === 0 && grounding.unpublished === 0
                    ? t('wizard.grounding.emptyNoTopic')
                    : t('wizard.grounding.noneNoTopic')
            );
            return;
        }
        if (review) {
            setConfirm('replace');
            return;
        }
        draftWith(values, newIdempotencyKey('engagement-draft'));
    });

    function confirmReplace() {
        setConfirm(null);
        discardReview();
        reviewLoaded.current = false;
        draftWith(briefForm.getValues(), newIdempotencyKey('engagement-draft'));
    }

    function retry() {
        if (!job) return;
        // The same attempt keeps its key, so a draft that did finish is never billed twice.
        void startDraft({
            brief: job.brief,
            grounding: groundingMemo,
            idempotencyKey: job.idempotencyKey,
            credits: job.credits,
        });
    }

    async function stopDrafting() {
        setConfirm(null);
        setCancelling(true);
        try {
            await cancelJob();
        } finally {
            setCancelling(false);
        }
    }

    function backToBrief() {
        if (job) {
            briefForm.reset(job.brief, { keepDefaultValues: true });
            dismissJob();
        }
        setView('brief');
    }

    // ── Review actions ──
    function goToFirstError(errors: unknown) {
        const flat = flattenFormErrors(errors);
        const first = flat[0];
        setSaveError(t('wizard.reviewStep.fixErrors', { count: flat.length }));
        if (!first) return;
        const match = /^slots\.(\d+)(?:\.items\.(\d+))?/.exec(first.path);
        if (match) {
            const day = Number(match[1]);
            setSelectedDay(day);
            if (match[2] != null) {
                const key = reviewForm.getValues(`slots.${day}.items.${Number(match[2])}.key`);
                setOpenKey(key ?? null);
            }
        } else if (first.path === 'title') {
            reviewForm.setFocus('title');
        }
    }

    function save(status: PlanStatus) {
        setConfirm(null);
        void reviewForm.handleSubmit(async (values) => {
            setSaving(true);
            setSaveError(null);
            try {
                // Picture slots never filled would reach learners as broken images.
                const request = withoutImagePlaceholders(formToRequest({ ...values, status }));
                const created = await createEngagementPlan(request);
                discardReview();
                reviewLoaded.current = false;
                toast.success(
                    status === 'PUBLISHED'
                        ? t('wizard.toast.published', { count: created.length })
                        : t('wizard.toast.savedDraft', { count: created.length })
                );
                onCreated();
                setView('brief');
                setSelfOpen(false);
                onOpenChange(false);
            } catch (e: unknown) {
                setSaveError(saveErrorText(e, t));
            } finally {
                setSaving(false);
            }
        }, goToFirstError)();
    }

    function openInComposer() {
        const values = reviewForm.getValues();
        const draft = formToRequest({ ...values, status: 'DRAFT' });
        setReviewPlan(draft);
        // The composer can't fill picture slots; the kept draft still can.
        setComposerDraft(withoutImagePlaceholders(draft));
        setComposerOpen(true);
        closeNow();
    }

    function discardAndClose() {
        discardReview();
        reviewLoaded.current = false;
        closeNow();
    }

    const resumable = useMemo(
        () =>
            step === 'brief' && review
                ? {
                      title: review.plan.title,
                      savedAt: review.savedAt,
                      creditsSpent: review.creditsSpent,
                  }
                : null,
        [step, review]
    );

    const batchCount = review?.brief.batches.length ?? 0;
    const reviewErrors = flattenFormErrors(reviewForm.formState.errors).length;

    const heading =
        step === 'review'
            ? t('wizard.review')
            : step === 'generating'
              ? t('wizard.job.heading')
              : t('wizard.title');

    const footer =
        step === 'brief' ? (
            <MyButton
                type="button"
                scale="medium"
                disable={cost.sufficient === false}
                onClick={() => void submitBrief()}
            >
                <Sparkle size={16} aria-hidden /> {t('wizard.draft')}
            </MyButton>
        ) : step === 'generating' ? (
            job?.status === 'RUNNING' ? (
                <MyButton
                    type="button"
                    buttonType="secondary"
                    scale="medium"
                    onClick={requestClose}
                >
                    {t('wizard.job.runInBackground')}
                </MyButton>
            ) : undefined
        ) : (
            <div className="flex flex-wrap items-center justify-end gap-2">
                <MyDropdown
                    dropdownList={[
                        {
                            label: t('wizard.reviewStep.editInComposer'),
                            value: 'composer',
                            icon: <NotePencil size={16} />,
                        },
                        {
                            label: t('wizard.back'),
                            value: 'brief',
                            icon: <ArrowLeft size={16} />,
                        },
                    ]}
                    onSelect={(value) => {
                        if (value === 'composer') openInComposer();
                        else setView('brief');
                    }}
                >
                    <span className="flex size-9 items-center justify-center rounded-md border border-neutral-300 text-neutral-600 hover:bg-neutral-50">
                        <DotsThreeVertical size={18} aria-hidden />
                        <span className="sr-only">{t('wizard.reviewStep.more')}</span>
                    </span>
                </MyDropdown>
                <MyButton
                    type="button"
                    buttonType="secondary"
                    scale="medium"
                    disable={saving}
                    onClick={() => save('DRAFT')}
                >
                    {t('wizard.saveDraft')}
                </MyButton>
                <MyButton
                    type="button"
                    scale="medium"
                    disable={saving}
                    onClick={() => save('PUBLISHED')}
                >
                    {saving ? t('wizard.publishing') : t('wizard.publish', { count: batchCount })}
                </MyButton>
            </div>
        );

    const footerLeft =
        step === 'brief' ? (
            <BriefCostLine cost={cost} />
        ) : step === 'review' && reviewErrors > 0 ? (
            <p className="flex items-center gap-1.5 text-caption text-danger-600">
                <WarningCircle size={14} aria-hidden />
                {t('composer.rail.problems', { count: reviewErrors })}
                <MyButton
                    type="button"
                    buttonType="text"
                    scale="small"
                    onClick={() => goToFirstError(reviewForm.formState.errors)}
                >
                    {t('wizard.reviewStep.goToFirst')}
                </MyButton>
            </p>
        ) : step === 'review' ? (
            <p className="text-caption text-neutral-500">{t('wizard.reviewStep.footerHint')}</p>
        ) : undefined;

    return (
        <>
            <MyDialog
                heading={heading}
                open={isOpen}
                onOpenChange={(next) => (next ? onOpenChange(true) : requestClose())}
                dialogWidth={step === 'review' ? 'max-w-7xl' : 'max-w-4xl'}
                className={step === 'review' ? 'h-dialog-tall' : undefined}
                footer={footer}
                footerLeft={footer ? footerLeft : undefined}
            >
                {step === 'brief' && (
                    <BriefStep
                        form={briefForm}
                        grounding={grounding}
                        resumable={resumable}
                        onResume={() => {
                            if (loadReview()) setView('review');
                        }}
                        onDiscardResumable={() => {
                            discardReview();
                            reviewLoaded.current = false;
                        }}
                        error={briefError}
                    />
                )}
                {step === 'generating' && job && (
                    <GeneratingStep
                        job={job}
                        cancelling={cancelling}
                        onCancel={() => setConfirm('cancel')}
                        onRetry={retry}
                        onBack={backToBrief}
                    />
                )}
                {step === 'review' && review && (
                    <ReviewStep
                        form={reviewForm}
                        meta={review}
                        grounding={groundingMemo}
                        selectedDay={selectedDay}
                        onSelectDay={setSelectedDay}
                        openKey={openKey}
                        onOpenKeyChange={setOpenKey}
                        onCreditsSpent={addCredits}
                        error={saveError}
                    />
                )}
            </MyDialog>

            <AlertDialog open={confirm !== null} onOpenChange={(next) => !next && setConfirm(null)}>
                <AlertDialogContent className={confirm === 'close' ? 'sm:max-w-2xl' : undefined}>
                    <AlertDialogHeader>
                        <AlertDialogTitle className="text-start">
                            {confirm === 'close' && t('wizard.discard.closeTitle')}
                            {confirm === 'cancel' && t('wizard.job.cancelTitle')}
                            {confirm === 'replace' && t('wizard.replace.title')}
                        </AlertDialogTitle>
                        <AlertDialogDescription className="text-start">
                            {confirm === 'close' &&
                                `${t('wizard.discard.charged', {
                                    count: review?.creditsSpent ?? 0,
                                })} ${t('wizard.discard.keptForLater')}`}
                            {confirm === 'cancel' &&
                                (job?.mode === 'sync'
                                    ? t('wizard.job.cancelSync', { count: job?.credits ?? 0 })
                                    : t('wizard.job.cancelJobBody'))}
                            {confirm === 'replace' &&
                                t('wizard.replace.body', {
                                    title: review?.plan.title || t('preview.untitled'),
                                    count: cost.credits,
                                })}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter className="gap-2 sm:space-x-0">
                        {confirm === 'close' && (
                            <>
                                <AlertDialogCancel className="mt-0">
                                    {t('wizard.discard.keep')}
                                </AlertDialogCancel>
                                <AlertDialogAction
                                    className="bg-danger-600 text-neutral-50 hover:bg-danger-500"
                                    onClick={discardAndClose}
                                >
                                    {t('wizard.discard.confirm')}
                                </AlertDialogAction>
                                <MyButton
                                    type="button"
                                    buttonType="secondary"
                                    scale="medium"
                                    disable={saving}
                                    onClick={() => save('DRAFT')}
                                >
                                    {t('wizard.saveDraft')}
                                </MyButton>
                                <MyButton type="button" scale="medium" onClick={closeNow}>
                                    {t('wizard.discard.later')}
                                </MyButton>
                            </>
                        )}
                        {confirm === 'cancel' && (
                            <>
                                <AlertDialogCancel className="mt-0">
                                    {t('wizard.job.keepDrafting')}
                                </AlertDialogCancel>
                                <AlertDialogAction
                                    className="bg-danger-600 text-neutral-50 hover:bg-danger-500"
                                    onClick={() => void stopDrafting()}
                                >
                                    {t('wizard.job.stop')}
                                </AlertDialogAction>
                            </>
                        )}
                        {confirm === 'replace' && (
                            <>
                                <AlertDialogCancel className="mt-0">
                                    {t('wizard.replace.keep')}
                                </AlertDialogCancel>
                                <AlertDialogAction onClick={confirmReplace}>
                                    {t('wizard.replace.confirm')}
                                </AlertDialogAction>
                            </>
                        )}
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <PlanComposerDialog
                open={composerOpen}
                onOpenChange={(next) => {
                    setComposerOpen(next);
                    if (!next) setComposerDraft(null);
                }}
                onCreated={() => {
                    discardReview();
                    reviewLoaded.current = false;
                    onCreated();
                }}
                draft={composerDraft}
            />
        </>
    );
}
