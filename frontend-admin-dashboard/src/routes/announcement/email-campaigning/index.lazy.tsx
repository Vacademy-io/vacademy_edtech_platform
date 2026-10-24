import { useCallback, useEffect, useMemo, useState } from 'react';
import { createLazyFileRoute, useNavigate, useSearch } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
    ArrowLeft,
    CheckCircle,
    DeviceMobile,
    EnvelopeSimple,
    Eye,
    Laptop,
    Lightbulb,
    ListChecks,
    LockSimple,
    PaperPlaneTilt,
    WarningCircle,
} from '@phosphor-icons/react';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { cn } from '@/lib/utils';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { AnnouncementService } from '@/services/announcement';
import { getUserId, getUserName } from '@/utils/userDetails';
import {
    getTerminology,
    getTerminologyPlural,
} from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, RoleTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { IssueSummary, LoadFailure } from '../create/-components/primitives';
import { RecipientsStep } from '../create/-components/steps/RecipientsStep';
import { expandRecipients } from '../create/-utils/payload';
import { useEmailCampaignDraft } from './-hooks/useEmailCampaignDraft';
import { CampaignDetailsSection } from './-components/CampaignDetailsSection';
import { EmailContentSection, type ContentView } from './-components/EmailContentSection';
import { SenderSettingsSection } from './-components/SenderSettingsSection';
import { EmailPreviewDialog, EmailPreviewFrame } from './-components/EmailPreview';
import { CampaignSummary } from './-components/CampaignSummary';
import { StepBadge } from './-components/primitives';
import {
    collectBlockers,
    collectWarnings,
    firstInvalidSection,
    mergeErrors,
    senderKey,
    validateEmailCampaign,
} from './-utils/validation';
import { buildEmailCampaignPayload, interpretApiError } from './-utils/payload';
import type { EmailSectionId, FieldErrors } from './-types';

export const Route = createLazyFileRoute('/announcement/email-campaigning/')({
    component: () => (
        /* overflow-x-clip instead of the layout's overflow-x-hidden: `hidden` would turn the
           layout into a scroll container and kill the sticky footer and preview rail. */
        <LayoutContainer intrnalMargin={false} className="overflow-x-clip">
            <EmailCampaigningRoute />
        </LayoutContainer>
    ),
});

/**
 * `?id=<announcementId>` means we are editing an already scheduled campaign. Keying on it gives
 * each campaign — and the blank create form — fresh state, so leaving an edit for the sidebar's
 * "Email Campaigning" link never shows the edited campaign's values in a new one.
 */
function EmailCampaigningRoute() {
    const search = useSearch({ strict: false }) as { id?: string };
    return <EmailCampaigningPage key={search.id ?? 'new'} editingId={search.id} />;
}

const SECTION_ID: Record<EmailSectionId, string> = {
    details: 'email-campaign-details',
    content: 'email-campaign-content',
    audience: 'email-campaign-audience',
    settings: 'email-campaign-settings',
};

function EmailCampaigningPage({ editingId }: { editingId?: string }) {
    const { t } = useTranslation('announcementEmailCampaigningIndex');
    const { t: tValidation } = useTranslation('announcementValidation');
    const { setNavHeading } = useNavHeadingStore();
    const navigate = useNavigate();
    const isEditing = Boolean(editingId);

    const draft = useEmailCampaignDraft(editingId);

    const [contentView, setContentView] = useState<ContentView>('editor');
    const [submitting, setSubmitting] = useState(false);
    /** Blockers stay hidden until the first send attempt, so a fresh form isn't a wall of red. */
    const [attempted, setAttempted] = useState(false);
    const [serverErrors, setServerErrors] = useState<FieldErrors>({});
    const [reviewOpen, setReviewOpen] = useState(false);
    const [previewOpen, setPreviewOpen] = useState(false);
    const [railDevice, setRailDevice] = useState<'desktop' | 'mobile'>('desktop');

    useEffect(() => {
        setNavHeading(isEditing ? t('page.navHeadingEdit') : t('page.navHeadingCreate'));
    }, [setNavHeading, isEditing, t]);

    const batchNoun = getTerminology(ContentTerms.Batch, SystemTerms.Batch).toLowerCase();
    const batchNounPlural = getTerminologyPlural(
        ContentTerms.Batch,
        SystemTerms.Batch
    ).toLowerCase();
    const learnerNounPlural = getTerminologyPlural(
        RoleTerms.Learner,
        SystemTerms.Learner
    ).toLowerCase();
    const teacherNounPlural = getTerminologyPlural(
        RoleTerms.Teacher,
        SystemTerms.Teacher
    ).toLowerCase();

    // ------------------------------------------------------------------ validation
    const validation = useMemo(
        () =>
            validateEmailCampaign(t, tValidation, {
                draft: draft.draft,
                batchById: draft.batchById,
                senders: draft.senders,
                sendersLoaded: draft.sendersLoaded,
            }),
        [t, tValidation, draft.draft, draft.batchById, draft.senders, draft.sendersLoaded]
    );

    // Server errors win over local ones for the same path, and any edit clears them.
    const errors = useMemo<FieldErrors>(
        () => ({ ...mergeErrors(validation), ...serverErrors }),
        [validation, serverErrors]
    );
    useEffect(() => {
        setServerErrors((prev) => (Object.keys(prev).length ? {} : prev));
    }, [draft.draft]);

    const blockers = useMemo(() => collectBlockers(validation), [validation]);
    const warnings = useMemo(() => collectWarnings(validation), [validation]);
    const sectionInvalid = (section: EmailSectionId) =>
        attempted && validation[section].blockers.length > 0;

    /** Has the user actually started? Gates the advisory notes so a pristine form stays quiet. */
    const started =
        draft.draft.title.trim().length > 0 ||
        draft.draft.subject.trim().length > 0 ||
        draft.contentText.length > 0;

    const scrollToSection = useCallback((section: EmailSectionId) => {
        setReviewOpen(false);
        if (typeof document === 'undefined') return;
        document
            .getElementById(SECTION_ID[section])
            ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, []);

    // ------------------------------------------------------------------ derived
    const recipients = useMemo(
        () => expandRecipients(draft.draft.rules, draft.batchById, draft.tagNameById),
        [draft.draft.rules, draft.batchById, draft.tagNameById]
    );

    const senderLabel = useMemo(() => {
        const sender = draft.senders.find((s) => senderKey(s) === draft.draft.fromKey);
        return sender ? `${sender.name} <${sender.email}>` : '';
    }, [draft.senders, draft.draft.fromKey]);

    const locked = draft.prefill.locked;
    const formDisabled = locked || submitting;

    // ------------------------------------------------------------------ submit
    const handleSubmit = async () => {
        setAttempted(true);
        setServerErrors({});
        setReviewOpen(false);

        if (locked) {
            toast.error(t('locked.toast', { status: draft.prefill.status ?? '' }));
            return;
        }

        if (blockers.length > 0) {
            const section = firstInvalidSection(validation);
            if (section) scrollToSection(section);
            toast.error(t('fixIssues', { count: blockers.length }));
            return;
        }

        setSubmitting(true);
        try {
            const payload = buildEmailCampaignPayload({
                draft: draft.draft,
                batchById: draft.batchById,
                tagNameById: draft.tagNameById,
                senders: draft.senders,
                createdBy: getUserId(),
                createdByName: getUserName(),
                createdByRole: draft.primaryRole,
            });

            if (isEditing && editingId) {
                await AnnouncementService.update(editingId, payload);
                toast.success(t('toast.updated'));
                navigate({ to: '/announcement/schedule' });
                return;
            }

            const created = (await AnnouncementService.create(payload)) as {
                status?: string;
            } | null;
            const status = (created?.status ?? '').toUpperCase();
            const immediate = draft.draft.scheduleType === 'IMMEDIATE';
            if (status === 'PENDING_APPROVAL') {
                toast.success(t('toast.pendingApproval'));
            } else {
                toast.success(immediate ? t('toast.sent') : t('toast.scheduled'));
            }
            draft.resetDraft();
            setAttempted(false);
            navigate({
                to:
                    status === 'PENDING_APPROVAL'
                        ? '/announcement/approval'
                        : immediate
                          ? '/announcement/history'
                          : '/announcement/schedule',
            });
        } catch (err) {
            const failure = interpretApiError(t, err);
            setServerErrors(failure.fieldErrors);
            toast.error(failure.message);
            if (failure.section) scrollToSection(failure.section);
        } finally {
            setSubmitting(false);
        }
    };

    const primaryLabel = submitting
        ? isEditing
            ? t('actions.updating')
            : t('actions.sending')
        : isEditing
          ? t('actions.updateCampaign')
          : draft.draft.scheduleType === 'IMMEDIATE'
            ? t('actions.sendCampaign')
            : t('actions.scheduleCampaign');

    // ------------------------------------------------------------------ edit-mode states
    if (isEditing && draft.prefill.loading) {
        return (
            <div className="flex min-h-full flex-1 flex-col px-4 py-6 sm:px-6">
                <div className="mx-auto w-full max-w-7xl space-y-6" aria-busy>
                    <Skeleton className="h-10 w-72 rounded-md" />
                    <div className="grid gap-6 xl:grid-cols-12">
                        <div className="space-y-6 xl:col-span-8">
                            <Skeleton className="h-52 w-full rounded-lg" />
                            <Skeleton className="h-96 w-full rounded-lg" />
                            <Skeleton className="h-64 w-full rounded-lg" />
                        </div>
                        <div className="space-y-6 xl:col-span-4">
                            <Skeleton className="h-80 w-full rounded-lg" />
                            <Skeleton className="h-64 w-full rounded-lg" />
                        </div>
                    </div>
                    <p className="sr-only">{t('prefill.loading')}</p>
                </div>
            </div>
        );
    }

    if (isEditing && draft.prefill.error) {
        return (
            <div className="flex min-h-full flex-1 flex-col px-4 py-6 sm:px-6">
                <div className="mx-auto w-full max-w-3xl space-y-4">
                    <LoadFailure
                        message={draft.prefill.error}
                        onRetry={draft.prefill.notFound ? undefined : draft.reloadPrefill}
                    />
                    <MyButton
                        buttonType="secondary"
                        scale="medium"
                        onClick={() => navigate({ to: '/announcement/schedule' })}
                    >
                        <ArrowLeft className="me-1 size-4" />
                        {t('actions.backToSchedule')}
                    </MyButton>
                </div>
            </div>
        );
    }

    // ------------------------------------------------------------------ review dialog body
    const reviewBody = (
        <div className="space-y-6">
            <CampaignSummary
                draft={draft.draft}
                recipients={recipients}
                batchById={draft.batchById}
                tagNameById={draft.tagNameById}
                senderLabel={senderLabel}
                tagReach={draft.tagReach}
                tagReachLoading={draft.tagReachLoading}
                variant="review"
                onEditSection={scrollToSection}
            />
            <div className="space-y-2">
                <h3 className="text-subtitle font-semibold">{t('review.howItWillLook')}</h3>
                <div className="rounded-md bg-muted/40 p-3">
                    <EmailPreviewFrame
                        subject={draft.draft.subject}
                        previewText={draft.draft.previewText}
                        htmlContent={draft.draft.htmlContent}
                        senderLabel={senderLabel}
                        className="h-preview-inline"
                    />
                </div>
            </div>
        </div>
    );

    return (
        <div className="flex min-h-full flex-1 flex-col">
            <div className="flex-1 px-4 py-6 sm:px-6">
                <div className="mx-auto w-full max-w-7xl space-y-6">
                    {/* Header */}
                    <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="flex min-w-0 items-start gap-3">
                            <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-500">
                                <EnvelopeSimple className="size-6" weight="duotone" />
                            </span>
                            <div className="min-w-0">
                                <h1 className="text-h3 font-semibold text-foreground sm:text-h2">
                                    {isEditing ? t('page.titleEdit') : t('page.titleCreate')}
                                </h1>
                                <p className="text-caption text-muted-foreground">
                                    {t('page.subtitle', {
                                        learners: learnerNounPlural,
                                        teachers: teacherNounPlural,
                                    })}
                                </p>
                            </div>
                        </div>
                        {isEditing && (
                            <div className="flex items-center gap-2">
                                <span className="rounded-full bg-warning-50 px-2.5 py-1 text-caption font-semibold text-warning-600">
                                    {t('page.editingBadge')}
                                </span>
                                <MyButton
                                    buttonType="secondary"
                                    scale="small"
                                    onClick={() => navigate({ to: '/announcement/schedule' })}
                                >
                                    {t('actions.cancel')}
                                </MyButton>
                            </div>
                        )}
                    </div>

                    {locked && (
                        <div
                            role="alert"
                            className="flex items-start gap-2 rounded-md border border-warning-400 bg-warning-50 p-3 text-caption text-warning-600"
                        >
                            <LockSimple className="mt-0.5 size-4 shrink-0" weight="fill" />
                            <span>
                                {t('locked.banner', { status: draft.prefill.status ?? '' })}
                            </span>
                        </div>
                    )}

                    <IssueSummary
                        blockers={blockers}
                        warnings={started || attempted ? warnings : []}
                        showBlockers={attempted}
                    />

                    <div className="grid gap-6 xl:grid-cols-12">
                        {/* Form column */}
                        <div className="min-w-0 space-y-6 xl:col-span-8">
                            <section id={SECTION_ID.details} className="scroll-mt-24">
                                <CampaignDetailsSection
                                    title={draft.draft.title}
                                    onTitleChange={draft.setTitle}
                                    subject={draft.draft.subject}
                                    onSubjectChange={draft.setSubject}
                                    previewText={draft.draft.previewText}
                                    onPreviewTextChange={draft.setPreviewText}
                                    errors={errors}
                                    showErrors={attempted}
                                    disabled={formDisabled}
                                />
                            </section>

                            <section id={SECTION_ID.content} className="scroll-mt-24">
                                <EmailContentSection
                                    htmlContent={draft.draft.htmlContent}
                                    onHtmlContentChange={draft.setHtmlContent}
                                    contentText={draft.contentText}
                                    contentView={contentView}
                                    onContentViewChange={setContentView}
                                    templateId={draft.draft.templateId}
                                    templateName={draft.draft.templateName}
                                    onApplyTemplate={(id, name) =>
                                        void draft.applyTemplate(id, name)
                                    }
                                    applyingTemplate={draft.applyingTemplate}
                                    loadTemplateOptions={draft.loadTemplateOptions}
                                    templatesError={draft.templatesError}
                                    onRetryTemplates={draft.clearTemplatesError}
                                    onOpenPreview={() => setPreviewOpen(true)}
                                    errors={errors}
                                    showErrors={attempted}
                                    disabled={formDisabled}
                                />
                            </section>

                            <section id={SECTION_ID.audience} className="scroll-mt-24">
                                <RecipientsStep
                                    badge={
                                        <StepBadge
                                            step={3}
                                            invalid={sectionInvalid('audience')}
                                            done={
                                                recipients.length > 0 &&
                                                validation.audience.blockers.length === 0
                                            }
                                        />
                                    }
                                    rules={draft.draft.rules}
                                    onAddRule={draft.addRule}
                                    onUpdateRule={draft.updateRule}
                                    onRemoveRule={draft.removeRule}
                                    batches={draft.batches}
                                    batchesLoading={draft.batchesLoading}
                                    batchNoun={batchNoun}
                                    batchNounPlural={batchNounPlural}
                                    learnerNounPlural={learnerNounPlural}
                                    teacherNounPlural={teacherNounPlural}
                                    tags={draft.tags}
                                    tagsLoading={draft.tagsLoading}
                                    tagsError={draft.tagsError}
                                    onReloadTags={draft.reloadTags}
                                    campaigns={draft.campaigns}
                                    campaignsLoading={draft.campaignsLoading}
                                    campaignsError={draft.campaignsError}
                                    onReloadCampaigns={draft.reloadCampaigns}
                                    customFields={draft.customFields}
                                    tagReach={draft.tagReach}
                                    tagReachLoading={draft.tagReachLoading}
                                    errors={errors}
                                    showErrors={attempted}
                                />
                                {draft.customFieldsError && (
                                    <LoadFailure
                                        className="mt-3"
                                        message={draft.customFieldsError}
                                        onRetry={draft.reloadCustomFields}
                                    />
                                )}
                            </section>

                            <section id={SECTION_ID.settings} className="scroll-mt-24">
                                <SenderSettingsSection
                                    senders={draft.senders}
                                    sendersLoading={draft.sendersLoading}
                                    sendersError={draft.sendersError}
                                    onReloadSenders={draft.reloadSenders}
                                    fromKey={draft.draft.fromKey}
                                    onFromKeyChange={draft.setFromKey}
                                    priority={draft.draft.priority}
                                    onPriorityChange={draft.setPriority}
                                    expiresAt={draft.draft.expiresAt}
                                    onExpiresAtChange={draft.setExpiresAt}
                                    scheduleType={draft.draft.scheduleType}
                                    onScheduleTypeChange={draft.setScheduleType}
                                    timezone={draft.draft.timezone}
                                    onTimezoneChange={draft.setTimezone}
                                    oneTimeStart={draft.draft.oneTimeStart}
                                    onOneTimeStartChange={draft.setOneTimeStart}
                                    cronExpression={draft.draft.cronExpression}
                                    onCronExpressionChange={draft.setCronExpression}
                                    errors={errors}
                                    showErrors={attempted}
                                    disabled={formDisabled}
                                />
                            </section>
                        </div>

                        {/* Preview + summary rail */}
                        <aside className="min-w-0 space-y-6 self-start xl:sticky xl:top-6 xl:col-span-4">
                            <Card className="rounded-xl border-neutral-200 shadow-sm">
                                <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
                                    <CardTitle className="flex items-center gap-2 text-subtitle font-semibold">
                                        <Eye className="size-5 text-primary-500" weight="duotone" />
                                        {t('rail.previewTitle')}
                                    </CardTitle>
                                    <div className="flex items-center gap-1 rounded-md border p-0.5">
                                        <MyButton
                                            buttonType={
                                                railDevice === 'desktop' ? 'primary' : 'text'
                                            }
                                            scale="small"
                                            aria-pressed={railDevice === 'desktop'}
                                            onClick={() => setRailDevice('desktop')}
                                        >
                                            <Laptop className="me-1 size-4" />
                                            {t('preview.device.desktop')}
                                        </MyButton>
                                        <MyButton
                                            buttonType={
                                                railDevice === 'mobile' ? 'primary' : 'text'
                                            }
                                            scale="small"
                                            aria-pressed={railDevice === 'mobile'}
                                            onClick={() => setRailDevice('mobile')}
                                        >
                                            <DeviceMobile className="me-1 size-4" />
                                            {t('preview.device.mobile')}
                                        </MyButton>
                                    </div>
                                </CardHeader>
                                <CardContent className="space-y-3">
                                    <div className="rounded-md bg-muted/40 p-2">
                                        <EmailPreviewFrame
                                            subject={draft.draft.subject}
                                            previewText={draft.draft.previewText}
                                            htmlContent={draft.draft.htmlContent}
                                            senderLabel={senderLabel}
                                            className={cn(
                                                'h-preview-inline',
                                                railDevice === 'mobile' && 'max-w-xs'
                                            )}
                                        />
                                    </div>
                                    <p className="text-caption text-muted-foreground">
                                        {t('rail.previewNote')}
                                    </p>
                                </CardContent>
                            </Card>

                            <Card className="rounded-xl border-neutral-200 shadow-sm">
                                <CardHeader className="pb-2">
                                    <CardTitle className="flex items-center gap-2 text-subtitle font-semibold">
                                        <ListChecks
                                            className="size-5 text-primary-500"
                                            weight="duotone"
                                        />
                                        {t('rail.summaryTitle')}
                                    </CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <CampaignSummary
                                        draft={draft.draft}
                                        recipients={recipients}
                                        batchById={draft.batchById}
                                        tagNameById={draft.tagNameById}
                                        senderLabel={senderLabel}
                                        tagReach={draft.tagReach}
                                        tagReachLoading={draft.tagReachLoading}
                                    />
                                </CardContent>
                            </Card>

                            <div className="flex items-start gap-2 rounded-xl border border-info-200 bg-info-50 p-3 text-caption text-info-600">
                                <Lightbulb className="mt-0.5 size-4 shrink-0" weight="fill" />
                                <p>
                                    <span className="font-semibold">{t('rail.tipTitle')} </span>
                                    {t('rail.tipBody')}
                                </p>
                            </div>
                        </aside>
                    </div>
                </div>
            </div>

            {/* Sticky action bar */}
            <div className="sticky bottom-0 z-20 border-t bg-background/95 px-4 py-3 backdrop-blur sm:px-6">
                <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-3">
                    <p className="hidden items-center gap-2 text-caption text-muted-foreground sm:flex">
                        {attempted && blockers.length > 0 ? (
                            <>
                                <WarningCircle
                                    className="size-4 shrink-0 text-danger-600"
                                    weight="fill"
                                />
                                {t('footer.blocked', { count: blockers.length })}
                            </>
                        ) : recipients.length > 0 ? (
                            <>
                                <CheckCircle
                                    className="size-4 shrink-0 text-success-600"
                                    weight="fill"
                                />
                                <span className="font-semibold text-foreground">
                                    {t('footer.ready', { count: recipients.length })}
                                </span>
                            </>
                        ) : (
                            t('footer.noAudience')
                        )}
                    </p>
                    <div className="ms-auto flex flex-wrap items-center justify-end gap-3">
                        <MyButton
                            buttonType="secondary"
                            scale="medium"
                            onClick={() => setReviewOpen(true)}
                            disable={submitting}
                        >
                            <ListChecks className="me-1 size-4" />
                            {t('actions.review')}
                        </MyButton>
                        <MyButton
                            buttonType="primary"
                            scale="medium"
                            onClick={handleSubmit}
                            disable={formDisabled}
                        >
                            <PaperPlaneTilt className="me-1 size-4" />
                            {primaryLabel}
                        </MyButton>
                    </div>
                </div>
            </div>

            <MyDialog
                heading={t('review.heading')}
                open={reviewOpen}
                onOpenChange={setReviewOpen}
                dialogWidth="w-dialog-lg"
                footer={
                    <>
                        <MyButton
                            buttonType="secondary"
                            scale="medium"
                            onClick={() => setReviewOpen(false)}
                        >
                            {t('actions.keepEditing')}
                        </MyButton>
                        <MyButton
                            buttonType="primary"
                            scale="medium"
                            disable={formDisabled}
                            onClick={() => void handleSubmit()}
                        >
                            {primaryLabel}
                        </MyButton>
                    </>
                }
            >
                {reviewBody}
            </MyDialog>

            <EmailPreviewDialog
                open={previewOpen}
                onOpenChange={setPreviewOpen}
                subject={draft.draft.subject}
                previewText={draft.draft.previewText}
                htmlContent={draft.draft.htmlContent}
                senderLabel={senderLabel}
            />
        </div>
    );
}
