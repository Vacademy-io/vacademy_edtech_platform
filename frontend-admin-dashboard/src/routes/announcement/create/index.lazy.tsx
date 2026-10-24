import { useCallback, useEffect, useMemo, useState } from 'react';
import { createLazyFileRoute, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
    CheckCircle,
    Eye,
    ListChecks,
    Megaphone,
    PaperPlaneTilt,
    WarningCircle,
} from '@phosphor-icons/react';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AnnouncementService, type MediumType, type ModeType } from '@/services/announcement';
import { getUserId, getUserName } from '@/utils/userDetails';
import {
    getTerminology,
    getTerminologyPlural,
} from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, RoleTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { PreviewPanel } from './-components/PreviewPanel';
import { IssueSummary, SummaryRow } from './-components/primitives';
import { StepRail, type RailStep, type StepState } from './-components/StepRail';
import { BasicInfoStep } from './-components/steps/BasicInfoStep';
import { RecipientsStep } from './-components/steps/RecipientsStep';
import { DisplayLocationsStep } from './-components/steps/DisplayLocationsStep';
import { DeliveryStep } from './-components/steps/DeliveryStep';
import { ReviewStep } from './-components/steps/ReviewStep';
import { useAnnouncementDraft } from './-hooks/useAnnouncementDraft';
import {
    ANNOUNCEMENT_PRESETS,
    FORM_SECTIONS,
    buildMediumMeta,
    buildModeMeta,
    defaultModeSettings,
} from './-utils/constants';
import { mergeErrors, validateAll } from './-utils/validation';
import { buildCreatePayload, expandRecipients, interpretApiError } from './-utils/payload';
import type { FieldErrors, FormSectionId } from './-types';

export const Route = createLazyFileRoute('/announcement/create/')({
    component: () => (
        /* overflow-x-clip overrides the layout's overflow-x-hidden. `hidden` computes overflow-y
           to `auto`, which turns the layout into a scroll container and silently kills the sticky
           footer and preview rail below; `clip` clips exactly the same way without creating one.
           Browsers too old for `clip` drop the declaration and keep `hidden` — sticky then simply
           degrades to static, which this layout still reads correctly. */
        <LayoutContainer intrnalMargin={false} className="overflow-x-clip">
            <CreateAnnouncementPage />
        </LayoutContainer>
    ),
});

/** Anchors so the review summary's "Edit" links can jump to the right section. */
const SECTION_ID: Record<FormSectionId, string> = {
    basics: 'announcement-basics',
    recipients: 'announcement-recipients',
    placements: 'announcement-placements',
    delivery: 'announcement-delivery',
    review: 'announcement-basics',
};

function CreateAnnouncementPage() {
    const { t } = useTranslation('announcementCreateIndex');
    const { t: tValidation } = useTranslation('announcementValidation');
    const { t: tPayload } = useTranslation('announcementPayload');
    const { t: tConstants } = useTranslation('announcementCreateConstants');
    const { t: tDelivery } = useTranslation('announcementDeliveryStep');
    const { setNavHeading } = useNavHeadingStore();
    const navigate = useNavigate();
    const draft = useAnnouncementDraft();

    const [contentView, setContentView] = useState<'editor' | 'source'>('editor');
    const [submitting, setSubmitting] = useState(false);
    /** Errors stay hidden until the first create attempt, so a fresh form isn't a wall of red. */
    const [attempted, setAttempted] = useState(false);
    const [serverErrors, setServerErrors] = useState<FieldErrors>({});
    const [reviewOpen, setReviewOpen] = useState(false);

    useEffect(() => {
        setNavHeading(t('navHeading'));
    }, [setNavHeading, t]);

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
    const validationInput = useMemo(
        () => ({
            title: draft.title,
            htmlContent: draft.htmlContent,
            contentText: draft.contentText,
            previewText: draft.previewText,
            rules: draft.rules,
            batchById: draft.batchById,
            modes: draft.modes,
            modeSettings: draft.modeSettings,
            mediums: draft.mediums,
            push: draft.push,
            email: draft.email,
            whatsapp: draft.whatsapp,
            selectedWaTemplate: draft.selectedWaTemplate,
            hasEmailSenders: draft.emailSenders.length > 0,
            scheduleType: draft.scheduleType,
            oneTimeStart: draft.oneTimeStart,
            cronExpression: draft.cronExpression,
        }),
        [
            draft.title,
            draft.htmlContent,
            draft.contentText,
            draft.previewText,
            draft.rules,
            draft.batchById,
            draft.modes,
            draft.modeSettings,
            draft.mediums,
            draft.push,
            draft.email,
            draft.whatsapp,
            draft.selectedWaTemplate,
            draft.emailSenders.length,
            draft.scheduleType,
            draft.oneTimeStart,
            draft.cronExpression,
        ]
    );

    const validation = useMemo(
        () => validateAll(tValidation, validationInput),
        [tValidation, validationInput]
    );

    const errors = useMemo<FieldErrors>(
        () => ({ ...mergeErrors(validation), ...serverErrors }),
        [validation, serverErrors]
    );

    /** Every blocker on the page, in section order, so the summary reads top to bottom. */
    const blockers = useMemo(
        () =>
            FORM_SECTIONS.filter((definition) => definition.id !== 'review').flatMap(
                (definition) => validation[definition.id].blockers
            ),
        [validation]
    );

    const warnings = useMemo(
        () =>
            FORM_SECTIONS.filter((definition) => definition.id !== 'review').flatMap(
                (definition) => validation[definition.id].warnings
            ),
        [validation]
    );

    /** Has the user actually begun filling this in? Gates the advisory notes. */
    const started = draft.title.trim().length > 0 || draft.contentText.trim().length > 0;

    const scrollToSection = useCallback((section: FormSectionId) => {
        setReviewOpen(false);
        if (typeof document === 'undefined') return;
        document
            .getElementById(SECTION_ID[section])
            ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, []);

    const scrollToAnchor = (anchor: string) => {
        if (typeof document === 'undefined') return;
        document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    // ------------------------------------------------------------------ progress rail
    const deliveryErrorKeys = Object.keys(validation.delivery.errors);
    const scheduleIssues = deliveryErrorKeys.filter((key) => key.startsWith('schedule.')).length;
    const channelIssues = deliveryErrorKeys.length - scheduleIssues;
    const railInput: Array<{ key: string; issues: number; complete: boolean; go: () => void }> = [
        {
            key: 'message',
            issues: validation.basics.blockers.length,
            complete: validation.basics.blockers.length === 0,
            go: () => scrollToSection('basics'),
        },
        {
            key: 'recipients',
            issues: validation.recipients.blockers.length,
            complete: draft.rules.length > 0 && validation.recipients.blockers.length === 0,
            go: () => scrollToSection('recipients'),
        },
        {
            key: 'placements',
            issues: validation.placements.blockers.length,
            complete: draft.modes.length > 0 && validation.placements.blockers.length === 0,
            go: () => scrollToSection('placements'),
        },
        {
            key: 'channels',
            issues: channelIssues,
            complete: started && channelIssues === 0,
            go: () => scrollToSection('delivery'),
        },
        {
            key: 'schedule',
            issues: scheduleIssues,
            complete: started && scheduleIssues === 0,
            go: () => scrollToAnchor('announcement-schedule'),
        },
    ];
    const firstOpen = railInput.findIndex((step) => !step.complete);
    const railSteps: RailStep[] = [
        ...railInput.map((step, index): RailStep => {
            const state: StepState =
                attempted && step.issues > 0
                    ? 'error'
                    : step.complete
                      ? 'done'
                      : index === firstOpen
                        ? 'current'
                        : 'todo';
            return {
                key: step.key,
                label: t(`steps.${step.key}`),
                state,
                onSelect: step.go,
            };
        }),
        {
            key: 'review',
            label: t('steps.review'),
            state: firstOpen === -1 ? 'current' : 'todo',
            onSelect: () => setReviewOpen(true),
        },
    ];
    const stepsDone = railInput.filter((step) => step.complete).length;

    // ------------------------------------------------------------------ "so far" summary
    const modeLabels = buildModeMeta(tConstants)
        .filter((meta) => draft.modes.includes(meta.type))
        .map((meta) => meta.label);
    const mediumLabels = buildMediumMeta(tConstants)
        .filter((meta) => draft.mediums.includes(meta.type))
        .map((meta) => meta.label);
    const scheduleLabel =
        draft.scheduleType === 'IMMEDIATE'
            ? tDelivery('schedule.type.immediate.label')
            : draft.scheduleType === 'ONE_TIME'
              ? [
                    tDelivery('schedule.type.oneTime.label'),
                    draft.oneTimeStart ? new Date(draft.oneTimeStart).toLocaleString() : '',
                ]
                    .filter(Boolean)
                    .join(' · ')
              : [tDelivery('schedule.type.recurring.label'), draft.cronExpression.trim()]
                    .filter(Boolean)
                    .join(' · ');

    // ------------------------------------------------------------------ presets
    const applyPreset = (presetId: 'GENERAL' | 'PINNED') => {
        const preset = ANNOUNCEMENT_PRESETS.find((p) => p.id === presetId);
        if (!preset) return;
        draft.setModes((prev) => [...new Set([...prev, ...preset.modes])] as ModeType[]);
        draft.setModeSettings((prev) => {
            const next = { ...prev };
            preset.modes.forEach((mode) => {
                if (!next[mode]) next[mode] = defaultModeSettings(mode);
            });
            return next;
        });
        draft.setMediums((prev) => [...new Set([...prev, ...preset.mediums])] as MediumType[]);
    };

    // ------------------------------------------------------------------ submit
    const tagNameById = useMemo(
        () =>
            Object.fromEntries(Object.entries(draft.tagById).map(([id, tag]) => [id, tag.tagName])),
        [draft.tagById]
    );

    const recipientsPreview = useMemo(
        () => expandRecipients(draft.rules, draft.batchById, tagNameById),
        [draft.rules, draft.batchById, tagNameById]
    );

    const handleCreate = async () => {
        setAttempted(true);
        setServerErrors({});

        if (blockers.length > 0) {
            const firstBroken = FORM_SECTIONS.find(
                (definition) =>
                    definition.id !== 'review' && validation[definition.id].blockers.length > 0
            );
            if (firstBroken) scrollToSection(firstBroken.id);
            toast.error(t('fixIssues', { count: blockers.length }));
            return;
        }

        setSubmitting(true);
        try {
            const payload = buildCreatePayload({
                title: draft.title,
                htmlContent: draft.htmlContent,
                previewText: draft.previewText,
                createdBy: getUserId(),
                createdByName: getUserName(),
                createdByRole: draft.primaryRole,
                rules: draft.rules,
                batchById: draft.batchById,
                tagNameById,
                modes: draft.modes,
                modeSettings: draft.modeSettings,
                mediums: draft.mediums,
                push: draft.push,
                email: draft.email,
                emailSenders: draft.emailSenders,
                whatsapp: draft.whatsapp,
                selectedWaTemplate: draft.selectedWaTemplate,
                scheduleType: draft.scheduleType,
                timezone: draft.timezone,
                oneTimeStart: draft.oneTimeStart,
                cronExpression: draft.cronExpression,
            });

            await AnnouncementService.create(payload);
            toast.success(
                draft.scheduleType === 'IMMEDIATE'
                    ? t('toast.createdImmediate')
                    : t('toast.scheduled')
            );
            navigate({ to: '/announcement/history' });
        } catch (err) {
            const failure = interpretApiError(tPayload, err);
            setServerErrors(failure.fieldErrors);
            toast.error(failure.message);
            if (failure.section) scrollToSection(failure.section);
        } finally {
            setSubmitting(false);
        }
    };

    // ------------------------------------------------------------------ preview data
    const emailSenderLabel = useMemo(() => {
        const sender = draft.emailSenders.find(
            (config) => `${config.email}-${config.name}` === draft.email.fromKey
        );
        return sender ? `${sender.name} (${sender.email})` : '';
    }, [draft.emailSenders, draft.email.fromKey]);

    const reviewBody = (
        <div className="space-y-6">
            <ReviewStep
                title={draft.title}
                previewText={draft.previewText}
                contentText={draft.contentText}
                rules={draft.rules}
                batchById={draft.batchById}
                tagNameById={tagNameById}
                recipients={recipientsPreview}
                modes={draft.modes}
                mediums={draft.mediums}
                emailSenderLabel={emailSenderLabel}
                whatsappTemplateName={draft.whatsapp.templateName}
                scheduleType={draft.scheduleType}
                timezone={draft.timezone}
                oneTimeStart={draft.oneTimeStart}
                cronExpression={draft.cronExpression}
                batchNounPlural={batchNounPlural}
                onEditSection={scrollToSection}
            />
            <div className="space-y-2">
                <h3 className="text-subtitle font-semibold">{t('sections.howItWillLook')}</h3>
                <PreviewPanel
                    title={draft.title}
                    previewText={draft.previewText}
                    htmlContent={draft.htmlContent}
                    contentText={draft.contentText}
                    modes={draft.modes}
                    push={draft.push}
                    whatsapp={draft.whatsapp}
                    whatsappTemplate={draft.selectedWaTemplate}
                    senderName={emailSenderLabel}
                />
            </div>
        </div>
    );

    return (
        <div className="flex min-h-full flex-1 flex-col">
            <div className="flex-1 px-4 py-6 sm:px-6">
                <div className="mx-auto w-full max-w-7xl space-y-6">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="flex min-w-0 items-start gap-3">
                            <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-500">
                                <Megaphone className="size-6" weight="duotone" />
                            </span>
                            <div className="min-w-0">
                                <h1 className="text-h3 font-semibold text-foreground sm:text-h2">
                                    {t('navHeading')}
                                </h1>
                                <p className="text-caption text-muted-foreground">
                                    {t('header.subtitle')}
                                </p>
                            </div>
                        </div>
                        <MyButton
                            buttonType="secondary"
                            scale="medium"
                            onClick={() => setReviewOpen(true)}
                            disable={submitting}
                        >
                            <Eye className="mr-1 size-4" />
                            {t('actions.reviewAndPreview')}
                        </MyButton>
                    </div>

                    <StepRail steps={railSteps} label={t('steps.label')} />

                    <div className="grid gap-6 xl:grid-cols-12">
                        <div className="min-w-0 space-y-6 xl:col-span-8">
                            {/* A pristine form shouldn't greet the user with advice about content
                                they haven't written yet. On wide screens this sits in the rail. */}
                            <div className="xl:hidden">
                                <IssueSummary
                                    blockers={blockers}
                                    warnings={started || attempted ? warnings : []}
                                    showBlockers={attempted}
                                />
                            </div>

                            <section id={SECTION_ID.basics} className="scroll-mt-24">
                                <BasicInfoStep
                                    title={draft.title}
                                    onTitleChange={draft.setTitle}
                                    previewText={draft.previewText}
                                    onPreviewTextChange={draft.setPreviewText}
                                    htmlContent={draft.htmlContent}
                                    onHtmlContentChange={draft.setHtmlContent}
                                    contentView={contentView}
                                    onContentViewChange={setContentView}
                                    modes={draft.modes}
                                    mediums={draft.mediums}
                                    onApplyPreset={applyPreset}
                                    errors={errors}
                                    showErrors={attempted}
                                />
                            </section>

                            <section id={SECTION_ID.recipients} className="scroll-mt-24">
                                <RecipientsStep
                                    rules={draft.rules}
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
                            </section>

                            <section id={SECTION_ID.placements} className="scroll-mt-24">
                                <DisplayLocationsStep
                                    modes={draft.modes}
                                    modeSettings={draft.modeSettings}
                                    allowedModes={draft.allowedModes}
                                    loading={draft.permissionsLoading}
                                    onToggle={draft.toggleMode}
                                    onSettingsChange={draft.updateModeSettings}
                                    errors={errors}
                                    showErrors={attempted}
                                />
                            </section>

                            <section id={SECTION_ID.delivery} className="scroll-mt-24">
                                <DeliveryStep
                                    mediums={draft.mediums}
                                    onToggleMedium={draft.toggleMedium}
                                    push={draft.push}
                                    onPushChange={(patch) => {
                                        draft.setPushSynced(false);
                                        draft.setPush((prev) => ({ ...prev, ...patch }));
                                    }}
                                    pushSynced={draft.pushSynced}
                                    onPushSyncedChange={draft.setPushSynced}
                                    email={draft.email}
                                    onEmailChange={(patch) =>
                                        draft.setEmail((prev) => ({ ...prev, ...patch }))
                                    }
                                    onApplyEmailTemplate={draft.applyEmailTemplate}
                                    applyingEmailTemplate={draft.applyingEmailTemplate}
                                    emailTemplates={draft.emailTemplates}
                                    emailTemplatesLoading={draft.emailTemplatesLoading}
                                    emailTemplatesError={draft.emailTemplatesError}
                                    onLoadEmailTemplates={draft.loadEmailTemplates}
                                    emailSenders={draft.emailSenders}
                                    emailSendersLoading={draft.emailSendersLoading}
                                    emailSendersError={draft.emailSendersError}
                                    onReloadEmailSenders={draft.reloadEmailSenders}
                                    announcementTitle={draft.title}
                                    whatsapp={draft.whatsapp}
                                    onWhatsAppChange={(patch) =>
                                        draft.setWhatsapp((prev) => ({ ...prev, ...patch }))
                                    }
                                    whatsappTemplates={draft.approvedWaTemplates}
                                    selectedWhatsAppTemplate={draft.selectedWaTemplate}
                                    whatsappLoading={draft.waTemplatesLoading}
                                    whatsappError={draft.waTemplatesError}
                                    whatsappSyncing={draft.waSyncing}
                                    onLoadWhatsApp={draft.loadWhatsAppTemplates}
                                    onReloadWhatsApp={() => draft.loadWhatsAppTemplates(true)}
                                    onSyncWhatsApp={draft.syncWhatsAppTemplates}
                                    scheduleType={draft.scheduleType}
                                    onScheduleTypeChange={draft.setScheduleType}
                                    timezone={draft.timezone}
                                    onTimezoneChange={draft.setTimezone}
                                    oneTimeStart={draft.oneTimeStart}
                                    onOneTimeStartChange={draft.setOneTimeStart}
                                    cronExpression={draft.cronExpression}
                                    onCronExpressionChange={draft.setCronExpression}
                                    errors={errors}
                                    showErrors={attempted}
                                />
                            </section>
                        </div>

                        <aside className="hidden min-w-0 space-y-6 self-start xl:sticky xl:top-24 xl:col-span-4 xl:block">
                            <IssueSummary
                                blockers={blockers}
                                warnings={started || attempted ? warnings : []}
                                showBlockers={attempted}
                            />
                            <Card className="rounded-xl border-neutral-200 shadow-sm">
                                <CardHeader className="pb-3">
                                    <CardTitle className="flex items-center gap-2 text-subtitle font-semibold">
                                        <Eye className="size-5 text-primary-500" weight="duotone" />
                                        {t('rail.livePreview')}
                                    </CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <PreviewPanel
                                        title={draft.title}
                                        previewText={draft.previewText}
                                        htmlContent={draft.htmlContent}
                                        contentText={draft.contentText}
                                        modes={draft.modes}
                                        push={draft.push}
                                        whatsapp={draft.whatsapp}
                                        whatsappTemplate={draft.selectedWaTemplate}
                                        senderName={emailSenderLabel}
                                    />
                                </CardContent>
                            </Card>
                            <Card className="rounded-xl border-neutral-200 shadow-sm">
                                <CardHeader className="pb-2">
                                    <CardTitle className="flex items-center gap-2 text-subtitle font-semibold">
                                        <ListChecks
                                            className="size-5 text-primary-500"
                                            weight="duotone"
                                        />
                                        {t('rail.soFar')}
                                    </CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <dl className="divide-y divide-border">
                                        <SummaryRow label={t('rail.audiences')}>
                                            {draft.rules.length > 0
                                                ? t('rail.audienceCount', {
                                                      count: draft.rules.length,
                                                  })
                                                : t('rail.none')}
                                        </SummaryRow>
                                        <SummaryRow label={t('rail.appearsIn')}>
                                            {modeLabels.length > 0
                                                ? modeLabels.join(', ')
                                                : t('rail.none')}
                                        </SummaryRow>
                                        <SummaryRow label={t('rail.channels')}>
                                            {mediumLabels.length > 0
                                                ? mediumLabels.join(', ')
                                                : t('rail.inProductOnly')}
                                        </SummaryRow>
                                        <SummaryRow label={t('rail.when')}>
                                            {scheduleLabel}
                                        </SummaryRow>
                                    </dl>
                                </CardContent>
                            </Card>
                        </aside>
                    </div>
                </div>
            </div>

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
                        ) : blockers.length === 0 ? (
                            <>
                                <CheckCircle
                                    className="size-4 shrink-0 text-success-600"
                                    weight="fill"
                                />
                                <span className="font-semibold text-foreground">
                                    {t('footer.ready')}
                                </span>
                            </>
                        ) : (
                            t('footer.progress', { done: stepsDone, total: railInput.length })
                        )}
                    </p>
                    <div className="ms-auto flex flex-wrap items-center justify-end gap-3">
                        <MyButton
                            buttonType="secondary"
                            scale="medium"
                            onClick={() => setReviewOpen(true)}
                            disable={submitting}
                        >
                            <ListChecks className="mr-1 size-4" />
                            {t('actions.reviewAndPreview')}
                        </MyButton>
                        <MyButton
                            buttonType="primary"
                            scale="medium"
                            onClick={handleCreate}
                            disable={submitting}
                            loadingText={t('actions.creating')}
                        >
                            <PaperPlaneTilt className="mr-1 size-4" />
                            {submitting
                                ? t('actions.creating')
                                : draft.scheduleType === 'IMMEDIATE'
                                  ? t('actions.createAndSend')
                                  : t('actions.scheduleAnnouncement')}
                        </MyButton>
                    </div>
                </div>
            </div>

            <MyDialog
                heading={t('dialog.reviewHeading')}
                open={reviewOpen}
                onOpenChange={setReviewOpen}
                dialogWidth="max-w-4xl"
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
                            disable={submitting}
                            onClick={() => {
                                setReviewOpen(false);
                                void handleCreate();
                            }}
                        >
                            {draft.scheduleType === 'IMMEDIATE'
                                ? t('actions.createAndSend')
                                : t('actions.scheduleAnnouncement')}
                        </MyButton>
                    </>
                }
            >
                {reviewBody}
            </MyDialog>
        </div>
    );
}
