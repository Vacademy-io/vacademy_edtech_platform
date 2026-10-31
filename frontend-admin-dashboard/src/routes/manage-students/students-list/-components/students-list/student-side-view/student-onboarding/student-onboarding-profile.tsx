/**
 * StudentOnboardingProfile — the "Onboarding" side-view tab.
 *
 * A subject (lead/student) can have onboarding instances from MULTIPLE flows
 * (e.g. re-enrolled, or started a second flow) — this tab shows ALL of them,
 * each with its ordered steps and status. Admin can complete or skip the
 * CURRENT step of each instance (skip only offered when that step's
 * `is_optional` is true — checked client-side against the flow's own step
 * list, since the step-instance payload doesn't carry `is_optional` itself).
 *
 * For a COMPLETED FORM step, "View form" shows the actual submitted values via
 * GET .../step-instances/{id}/submitted-values.
 */
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
    CheckCircle,
    Circle,
    Copy,
    GraduationCap,
    Key,
    ListChecks,
    PauseCircle,
    Path,
    PlayCircle,
    SkipForward,
    UserCircle,
    Users,
} from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { MyInput } from '@/components/design-system/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AsyncSearchableSelect } from '@/components/design-system/async-searchable-select';
import PhoneNumberInput from '@/components/design-system/phone-number-input';
import { getCurrentInstituteId, getActiveRoleDisplaySettingsKey } from '@/lib/auth/instituteUtils';
import { getDisplaySettingsWithFallback, getDisplaySettingsFromCache } from '@/services/display-settings';
import { useStudentCredentails } from '@/services/student-list-section/getStudentCredentails';
import {
    ProfileSectionCard,
    ProfileSkeleton,
    ProfileEmpty,
    ProfileError,
} from '../profile-ui';
import {
    fetchOnboardingSideView,
    fetchOnboardingSteps,
    fetchOnboardingFlows,
    fetchStepInstanceFields,
    fetchSubmittedFieldValues,
    completeStepInstance,
    saveStepInstanceProgress,
    skipStepInstance,
    startOnboardingInstance,
    searchPackageSessions,
    fetchPackageSessionPoolOptions,
    onboardingSideViewKey,
    onboardingStepsKey,
    onboardingFlowsKey,
    onboardingStepInstanceFieldsKey,
    type OnboardingInstanceDTO,
    type OnboardingStepInstanceDTO,
    type OnboardingStepDTO,
} from '@/routes/audience-manager/onboarding/-services/onboarding-service';
import { CustomFieldRenderer } from '@/components/common/custom-fields/CustomFieldRenderer';
import { CustomFieldValueDisplay } from '@/components/common/custom-fields/CustomFieldValueDisplay';
import { parseFieldOptions } from '@/routes/audience-manager/list/-utils/parseFieldOptions';
import { configJsonToFullConfig } from '@/services/custom-field-settings';

/** True for an HTTP 403 — "your role has no onboarding access", distinct from a real failure. */
function isForbidden(error: unknown): boolean {
    return (error as { response?: { status?: number } } | null)?.response?.status === 403;
}

interface StudentOnboardingProfileProps {
    userId: string;
    /** This subject's own existing details — shown when a create-student step's
     *  "filled by a parent" toggle is OFF, since that's what the student will be
     *  created from. */
    subjectFullName?: string | null;
    subjectEmail?: string | null;
    subjectMobileNumber?: string | null;
}

/** Translated display labels for the shared instance/step status enum (PENDING,
 *  IN_PROGRESS, COMPLETED, SKIPPED). Falls back to the raw value for anything
 *  unrecognized rather than hiding it. */
function buildStatusLabels(t: TFunction): Record<string, string> {
    return {
        PENDING: t('status.pending'),
        IN_PROGRESS: t('status.inProgress'),
        COMPLETED: t('status.completed'),
        SKIPPED: t('status.skipped'),
    };
}

export function StudentOnboardingProfile({
    userId,
    subjectFullName,
    subjectEmail,
    subjectMobileNumber,
}: StudentOnboardingProfileProps) {
    const { t } = useTranslation('manageStudentsOnboardingProfile');
    const instituteId = getCurrentInstituteId() ?? '';
    const queryClient = useQueryClient();
    const [startDialogOpen, setStartDialogOpen] = useState(false);

    const instancesQuery = useQuery({
        queryKey: onboardingSideViewKey(userId, instituteId),
        queryFn: () => fetchOnboardingSideView(userId, instituteId),
        enabled: !!userId && !!instituteId,
        staleTime: 30 * 1000,
        // A 403 here isn't a failure to retry — onboarding is enabled for the institute but no
        // step's role-access grid names any of this staff member's roles, so there is genuinely
        // nothing for them here. Retrying would 403 forever.
        retry: (failureCount, error) => !isForbidden(error) && failureCount < 2,
    });
    const forbidden = isForbidden(instancesQuery.error);

    const startButton = (
        <MyButton buttonType="primary" scale="small" onClick={() => setStartDialogOpen(true)}>
            <PlayCircle size={14} /> {t('startOnboarding.button')}
        </MyButton>
    );

    const startDialog = (
        <StartOnboardingDialog
            open={startDialogOpen}
            onOpenChange={setStartDialogOpen}
            instituteId={instituteId}
            subjectUserId={userId}
            onStarted={() =>
                queryClient.invalidateQueries({ queryKey: onboardingSideViewKey(userId, instituteId) })
            }
        />
    );

    if (instancesQuery.isLoading) return <ProfileSkeleton blocks={2} />;

    // No grant anywhere: show the same "nothing here" state a subject with no instances gets,
    // minus the Start button they couldn't use — not a scary error about a load that worked.
    if (forbidden) {
        return <ProfileEmpty icon={Path} title={t('empty.title')} hint={t('noAccess.hint')} />;
    }

    if (instancesQuery.isError) {
        return (
            <ProfileError
                title={t('loadError.title')}
                onRetry={() => instancesQuery.refetch()}
            />
        );
    }

    const instances = instancesQuery.data ?? [];

    if (instances.length === 0) {
        return (
            <div className="flex flex-col gap-3">
                <ProfileEmpty
                    icon={Path}
                    title={t('empty.title')}
                    hint={t('empty.hint')}
                />
                <div className="flex justify-center">{startButton}</div>
                {startDialog}
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-3">
            <div className="flex justify-end">{startButton}</div>
            {instances.map((instance) => (
                <OnboardingInstanceCard
                    key={instance.id}
                    instance={instance}
                    instituteId={instituteId}
                    subjectFullName={subjectFullName}
                    subjectEmail={subjectEmail}
                    subjectMobileNumber={subjectMobileNumber}
                />
            ))}
            {startDialog}
        </div>
    );
}

// ── Start a flow for this subject ───────────────────────────────────────────

function StartOnboardingDialog({
    open,
    onOpenChange,
    instituteId,
    subjectUserId,
    onStarted,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    instituteId: string;
    subjectUserId: string;
    onStarted: () => void;
}) {
    const { t } = useTranslation('manageStudentsOnboardingProfile');
    const [flowId, setFlowId] = useState('');

    const flowsQuery = useQuery({
        queryKey: onboardingFlowsKey(instituteId, 'ACTIVE'),
        queryFn: () => fetchOnboardingFlows(instituteId, 'ACTIVE'),
        enabled: open && !!instituteId,
        staleTime: 60 * 1000,
    });

    const { mutate: start, isPending } = useMutation({
        mutationFn: () => startOnboardingInstance(instituteId, flowId, subjectUserId),
        onSuccess: () => {
            toast.success(t('startOnboarding.started'));
            setFlowId('');
            onOpenChange(false);
            onStarted();
        },
        onError: () => toast.error(t('startOnboarding.startFailed')),
    });

    const flows = flowsQuery.data ?? [];

    return (
        <MyDialog
            open={open}
            onOpenChange={onOpenChange}
            heading={t('startOnboarding.dialogHeading')}
            dialogWidth="max-w-md"
            footer={
                <div className="flex w-full items-center justify-end gap-2">
                    <MyButton buttonType="secondary" scale="medium" onClick={() => onOpenChange(false)}>
                        {t('startOnboarding.cancel')}
                    </MyButton>
                    <MyButton
                        buttonType="primary"
                        scale="medium"
                        disable={!flowId || isPending}
                        onClick={() => start()}
                    >
                        {isPending ? t('startOnboarding.starting') : t('startOnboarding.start')}
                    </MyButton>
                </div>
            }
        >
            <div className="flex flex-col gap-3 px-6 py-6">
                {flowsQuery.isLoading ? (
                    <p className="text-body text-neutral-500">{t('startOnboarding.loadingFlows')}</p>
                ) : flows.length === 0 ? (
                    <p className="text-body text-neutral-500">
                        {t('startOnboarding.noActiveFlows')}
                    </p>
                ) : (
                    <>
                        <Label>{t('startOnboarding.flowLabel')}</Label>
                        <Select value={flowId} onValueChange={setFlowId}>
                            <SelectTrigger>
                                <SelectValue placeholder={t('startOnboarding.pickFlowPlaceholder')} />
                            </SelectTrigger>
                            <SelectContent>
                                {flows.map((f) => (
                                    <SelectItem key={f.id} value={f.id}>
                                        {f.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </>
                )}
            </div>
        </MyDialog>
    );
}

/**
 * Shows the resolved student's username/password right in the onboarding banner. Needed because
 * a resolved child created purely via grants_student_role/sends_login_credentials (no
 * create_student on any step) never gets a `student` row/enrollment, so there's no
 * manage-students entry -- and thus no side-view/Portal Access tab -- to find credentials in
 * otherwise. Reuses the same userId-only credentials lookup Portal Access uses, and respects the
 * same institute-level allowViewPassword display setting.
 */
function ResolvedSubjectCredentials({ userId }: { userId: string }) {
    const { t } = useTranslation('manageStudentsOnboardingProfile');
    const [allowViewPassword, setAllowViewPassword] = useState<boolean | null>(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            const roleKey = getActiveRoleDisplaySettingsKey();
            const cached = getDisplaySettingsFromCache(roleKey);
            const settings =
                cached?.learnerManagement ?? (await getDisplaySettingsWithFallback(roleKey)).learnerManagement;
            if (!cancelled) setAllowViewPassword(settings?.allowViewPassword ?? false);
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    const { data: credentials, isLoading } = useStudentCredentails({ userId });

    const handleCopy = async (text: string, label: string) => {
        try {
            await navigator.clipboard.writeText(text);
            toast.success(t('credentials.copiedToClipboard', { label }));
        } catch {
            toast.error(t('credentials.copyFailed', { label }));
        }
    };

    if (allowViewPassword === false) {
        return (
            <p className="mt-1.5 text-2xs text-success-600">
                {t('credentials.passwordVisibilityOff')}
            </p>
        );
    }
    if (allowViewPassword === null || isLoading) {
        return <p className="mt-1.5 text-2xs text-success-600">{t('credentials.loading')}</p>;
    }

    return (
        <div className="mt-2 flex flex-col gap-1 rounded-md border border-success-200 bg-white/60 px-2.5 py-2">
            <div className="flex items-center gap-1.5 text-2xs text-neutral-700">
                <Key size={12} className="text-success-600" />
                <span className="font-medium">{t('credentials.usernameLabel')}</span>
                <span>{credentials?.username || t('credentials.notAvailable')}</span>
                {credentials?.username && (
                    <button
                        type="button"
                        onClick={() => handleCopy(credentials.username, t('credentials.usernameFieldName'))}
                        className="rounded p-0.5 hover:bg-neutral-100"
                    >
                        <Copy size={11} />
                    </button>
                )}
            </div>
            <div className="flex items-center gap-1.5 text-2xs text-neutral-700">
                <Key size={12} className="text-success-600" />
                <span className="font-medium">{t('credentials.passwordLabel')}</span>
                <span>{credentials?.password || t('credentials.notFound')}</span>
                {credentials?.password && (
                    <button
                        type="button"
                        onClick={() => handleCopy(credentials.password, t('credentials.passwordFieldName'))}
                        className="rounded p-0.5 hover:bg-neutral-100"
                    >
                        <Copy size={11} />
                    </button>
                )}
            </div>
        </div>
    );
}

// ── One flow instance ────────────────────────────────────────────────────────

function OnboardingInstanceCard({
    instance,
    instituteId,
    subjectFullName,
    subjectEmail,
    subjectMobileNumber,
}: {
    instance: OnboardingInstanceDTO;
    instituteId: string;
    subjectFullName?: string | null;
    subjectEmail?: string | null;
    subjectMobileNumber?: string | null;
}) {
    const { t } = useTranslation('manageStudentsOnboardingProfile');
    const statusLabels = useMemo(() => buildStatusLabels(t), [t]);
    const queryClient = useQueryClient();

    // Step definitions (is_optional, order, name) — needed so the skip
    // affordance can be gated client-side, since step-instance rows don't
    // carry is_optional themselves.
    const stepsQuery = useQuery({
        queryKey: onboardingStepsKey(instance.flow_id),
        queryFn: () => fetchOnboardingSteps(instance.flow_id),
        staleTime: 60 * 1000,
    });
    const stepById = useMemo(
        () => new Map((stepsQuery.data ?? []).map((s) => [s.id, s])),
        [stepsQuery.data]
    );

    const [viewingFormFor, setViewingFormFor] = useState<OnboardingStepInstanceDTO | null>(null);
    const [skipTarget, setSkipTarget] = useState<OnboardingStepInstanceDTO | null>(null);
    const [skipReason, setSkipReason] = useState('');

    const invalidate = () => {
        queryClient.invalidateQueries({
            queryKey: onboardingSideViewKey(instance.subject_user_id, instituteId),
        });
    };

    const { mutate: complete, isPending: completing } = useMutation({
        mutationFn: ({ id, payload }: { id: string; payload: Record<string, unknown> }) =>
            completeStepInstance(id, payload),
        onSuccess: () => {
            toast.success(t('instance.stepCompleted'));
            setCompleteTarget(null);
            invalidate();
        },
        onError: () => toast.error(t('instance.completeFailed')),
    });
    const [completeTarget, setCompleteTarget] = useState<OnboardingStepInstanceDTO | null>(null);

    // Saves whatever fields the admin filled in without requiring every mandatory field on the
    // step -- e.g. recording a delivery's tracking id/vendor while the step's own "did the
    // student receive it?" field is the student's to fill in later.
    const { mutate: saveProgress, isPending: savingProgress } = useMutation({
        mutationFn: ({ id, payload }: { id: string; payload: Record<string, unknown> }) =>
            saveStepInstanceProgress(id, payload),
        onSuccess: () => {
            toast.success(t('instance.progressSaved'));
            setCompleteTarget(null);
            invalidate();
        },
        onError: () => toast.error(t('instance.saveFailed')),
    });

    const { mutate: skip, isPending: skipping } = useMutation({
        mutationFn: ({ id, reason }: { id: string; reason: string }) => skipStepInstance(id, reason),
        onSuccess: () => {
            toast.success(t('instance.stepSkipped'));
            setSkipTarget(null);
            setSkipReason('');
            invalidate();
        },
        onError: () => toast.error(t('instance.skipFailed')),
    });

    const steps = instance.step_instances ?? [];

    return (
        <ProfileSectionCard
            icon={Path}
            heading={t('instance.heading', { status: statusLabels[instance.status] ?? instance.status })}
            action={<InstanceStatusBadge status={instance.status} />}
        >
            {instance.resolved_subject_user_id && (
                <div className="mb-3 flex items-start gap-2 rounded-lg border border-success-200 bg-success-50 p-3">
                    <UserCircle size={18} className="mt-0.5 shrink-0 text-success-600" weight="fill" />
                    <div className="text-caption text-success-700">
                        {t('instance.resolvedSubjectPrefix')}{' '}
                        <span className="font-medium">
                            {instance.resolved_subject_name ||
                                instance.resolved_subject_email ||
                                t('instance.resolvedSubjectFallback')}
                        </span>
                        {instance.resolved_subject_email && instance.resolved_subject_name
                            ? ` (${instance.resolved_subject_email})`
                            : ''}{' '}
                        {t('instance.resolvedSubjectSuffix')}
                        <ResolvedSubjectCredentials userId={instance.resolved_subject_user_id} />
                    </div>
                </div>
            )}
            <div className="flex flex-col divide-y divide-border">
                {steps.map((si, index) => {
                    const stepDef = stepById.get(si.step_id);
                    const isCurrent = instance.current_step_id === si.step_id;
                    const canAct = isCurrent && (si.status === 'PENDING' || si.status === 'IN_PROGRESS');
                    const canSkip = canAct && stepDef?.is_optional === true;
                    return (
                        <div key={si.id} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
                            <StepStatusIcon status={si.status} />
                            <div className="min-w-0 flex-1">
                                <div className="truncate text-caption font-medium text-card-foreground">
                                    {index + 1}. {si.step_name}
                                </div>
                                <div className="text-2xs text-muted-foreground">
                                    {si.skip_reason
                                        ? t('instance.stepStatusWithReason', {
                                              status: statusLabels[si.status] ?? si.status,
                                              reason: si.skip_reason,
                                          })
                                        : (statusLabels[si.status] ?? si.status)}
                                </div>
                            </div>
                            {si.status === 'COMPLETED' && si.step_type === 'FORM' && (
                                <MyButton
                                    buttonType="secondary"
                                    scale="small"
                                    onClick={() => setViewingFormFor(si)}
                                >
                                    {t('instance.viewForm')}
                                </MyButton>
                            )}
                            {canAct && (
                                <>
                                    <MyButton
                                        buttonType="primary"
                                        scale="small"
                                        onClick={() =>
                                            si.step_type === 'FORM'
                                                ? setCompleteTarget(si)
                                                : complete({ id: si.id, payload: {} })
                                        }
                                        disable={completing}
                                    >
                                        {t('instance.complete')}
                                    </MyButton>
                                    {canSkip && (
                                        <MyButton
                                            buttonType="secondary"
                                            scale="small"
                                            onClick={() => setSkipTarget(si)}
                                            disable={skipping}
                                        >
                                            <SkipForward size={14} /> {t('instance.skip')}
                                        </MyButton>
                                    )}
                                </>
                            )}
                        </div>
                    );
                })}
                {steps.length === 0 && (
                    <div className="py-3 text-caption text-muted-foreground">{t('instance.noSteps')}</div>
                )}
            </div>

            {viewingFormFor && (
                <SubmittedFormDialog
                    stepInstance={viewingFormFor}
                    onClose={() => setViewingFormFor(null)}
                />
            )}

            {completeTarget && (
                <CompleteFormStepDialog
                    instituteId={instituteId}
                    stepInstance={completeTarget}
                    stepDef={stepById.get(completeTarget.step_id)}
                    submitting={completing}
                    saving={savingProgress}
                    subjectFullName={subjectFullName}
                    subjectEmail={subjectEmail}
                    subjectMobileNumber={subjectMobileNumber}
                    onClose={() => setCompleteTarget(null)}
                    onSubmit={(payload) => complete({ id: completeTarget.id, payload })}
                    onSave={(payload) => saveProgress({ id: completeTarget.id, payload })}
                />
            )}

            <MyDialog
                open={!!skipTarget}
                onOpenChange={(o) => !o && setSkipTarget(null)}
                heading={t('skipDialog.heading')}
                dialogWidth="max-w-md"
                footer={
                    <div className="flex w-full items-center justify-end gap-2">
                        <MyButton buttonType="secondary" scale="medium" onClick={() => setSkipTarget(null)}>
                            {t('skipDialog.cancel')}
                        </MyButton>
                        <MyButton
                            buttonType="primary"
                            scale="medium"
                            disable={skipping}
                            onClick={() =>
                                skipTarget &&
                                skip({ id: skipTarget.id, reason: skipReason || t('skipDialog.defaultReason') })
                            }
                        >
                            {skipping ? t('skipDialog.skipping') : t('skipDialog.skipStep')}
                        </MyButton>
                    </div>
                }
            >
                <div className="flex flex-col gap-3 px-6 py-6">
                    <p className="text-body text-neutral-600">
                        {t('skipDialog.description', { stepName: skipTarget?.step_name ?? '' })}
                    </p>
                    <MyInput
                        inputType="text"
                        inputPlaceholder={t('skipDialog.reasonPlaceholder')}
                        input={skipReason}
                        onChangeFunction={(e) => setSkipReason(e.target.value)}
                    />
                </div>
            </MyDialog>
        </ProfileSectionCard>
    );
}

function InstanceStatusBadge({ status }: { status: string }) {
    const { t } = useTranslation('manageStudentsOnboardingProfile');
    const statusLabels = useMemo(() => buildStatusLabels(t), [t]);
    const toneClass =
        status === 'COMPLETED'
            ? 'bg-success-50 text-success-700'
            : status === 'SKIPPED'
              ? 'bg-neutral-100 text-neutral-500'
              : 'bg-info-50 text-info-600';
    return (
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-2xs font-medium ${toneClass}`}>
            {statusLabels[status] ?? status}
        </span>
    );
}

function StepStatusIcon({ status }: { status: string }) {
    if (status === 'COMPLETED') return <CheckCircle className="size-4 shrink-0 text-success-500" weight="fill" />;
    if (status === 'SKIPPED') return <SkipForward className="size-4 shrink-0 text-neutral-400" />;
    if (status === 'IN_PROGRESS') return <PauseCircle className="size-4 shrink-0 text-warning-500" weight="fill" />;
    return <Circle className="size-4 shrink-0 text-neutral-300" />;
}

// ── Complete a FORM step (plain-text input per attached field, MVP-simple) ──

function CompleteFormStepDialog({
    instituteId,
    stepInstance,
    stepDef,
    submitting,
    saving,
    subjectFullName,
    subjectEmail,
    subjectMobileNumber,
    onClose,
    onSubmit,
    onSave,
}: {
    instituteId: string;
    stepInstance: OnboardingStepInstanceDTO;
    stepDef: OnboardingStepDTO | undefined;
    submitting: boolean;
    saving: boolean;
    subjectFullName?: string | null;
    subjectEmail?: string | null;
    subjectMobileNumber?: string | null;
    onClose: () => void;
    onSubmit: (payload: Record<string, unknown>) => void;
    /** Persists whatever fields have been filled in so far WITHOUT requiring every mandatory
     *  field and WITHOUT completing/advancing -- e.g. an admin recording a delivery's tracking
     *  id/vendor while the step's own "did the student receive it?" field is the student's to
     *  fill in later. */
    onSave: (payload: Record<string, unknown>) => void;
}) {
    const { t } = useTranslation('manageStudentsOnboardingProfile');
    // Step-INSTANCE-scoped (not step-scoped) so each field arrives with its own already-saved
    // value, in the step builder's order, carrying the field type/config needed to render it as
    // itself. The generic feature-fields catalog lookup this replaced had none of that: it
    // ordered by the institute catalog, always reported is_mandatory as null, and left every
    // field -- dropdown, date, file -- rendering as a plain text box.
    const fieldsQuery = useQuery({
        queryKey: onboardingStepInstanceFieldsKey(stepInstance.id),
        queryFn: () => fetchStepInstanceFields(stepInstance.id),
        staleTime: 10 * 1000,
    });
    const [values, setValues] = useState<Record<string, string>>({});
    const fields = fieldsQuery.data ?? [];

    // Whatever's already been saved for this step instance -- e.g. a PRIOR "Save" call by this
    // same admin, or a field the student already filled in -- so reopening this dialog shows
    // it instead of risking an overwrite with a blank input. A never-answered field falls back
    // to its configured default.
    useEffect(() => {
        if (!fieldsQuery.data) return;
        const seeded: Record<string, string> = {};
        fieldsQuery.data.forEach((f) => {
            const seed = f.value ?? f.default_value;
            if (seed) seeded[f.institute_custom_field_id] = seed;
        });
        setValues((prev) => ({ ...seeded, ...prev }));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fieldsQuery.data]);

    // "Create a student from this step" config: empty pool → search ANY course;
    // non-empty pool → pick only from the courses the flow builder allowed.
    const config = (stepDef?.step_type_config ?? {}) as Record<string, unknown>;
    const createsStudent = config.create_student === 'true' || config.create_student === true;
    const coursePool = Array.isArray(config.package_session_ids)
        ? (config.package_session_ids as unknown[]).filter((v): v is string => typeof v === 'string')
        : [];
    const hasPool = coursePool.length > 0;
    // When on, the backend allows completing without a course pick if the student already has
    // an active enrollment elsewhere -- so the client shouldn't hard-block Complete Step just
    // because no course was chosen; let the server make the real call (and surface its error if
    // the student in fact isn't already enrolled anywhere).
    const skipCourseIfEnrolled =
        config.skip_if_already_enrolled === 'true' || config.skip_if_already_enrolled === true;

    const [packageSessionId, setPackageSessionId] = useState('');
    const [packageSessionLabel, setPackageSessionLabel] = useState<string | undefined>(undefined);

    const poolOptionsQuery = useQuery({
        queryKey: ['onboarding-package-session-pool', instituteId],
        queryFn: fetchPackageSessionPoolOptions,
        enabled: createsStudent && hasPool,
        staleTime: 60 * 1000,
    });
    const poolChoices = (poolOptionsQuery.data ?? []).filter((o) =>
        coursePool.includes(o.package_session_id)
    );

    // Leads can be filled out by either the student or a parent on their behalf. When a
    // parent fills it, the person we have on file (the onboarding subject) isn't who should
    // receive the role/credentials/enrollment — their child is. This resolves/creates the real
    // student and redirects the rest of the flow to them (see OnboardingStudentCreationService).
    // Relevant on ANY step that touches identity, not just the one that assigns a course — role
    // grant and credentials can each live on their own, earlier step.
    const touchesIdentity =
        createsStudent || stepDef?.grants_student_role === true || stepDef?.sends_login_credentials === true;
    const [isParent, setIsParent] = useState(false);
    const [studentFullName, setStudentFullName] = useState('');
    const [studentEmail, setStudentEmail] = useState('');
    const [studentMobileNumber, setStudentMobileNumber] = useState('');

    const missingCourseChoice = createsStudent && !packageSessionId && !skipCourseIfEnrolled;
    const missingStudentDetails =
        touchesIdentity && isParent && (!studentFullName.trim() || (!studentEmail.trim() && !studentMobileNumber.trim()));

    return (
        <MyDialog
            open
            onOpenChange={(o) => !o && onClose()}
            heading={t('completeStepDialog.heading', { stepName: stepInstance.step_name })}
            dialogWidth="max-w-lg"
            footer={
                <div className="flex w-full items-center justify-end gap-2">
                    <MyButton buttonType="secondary" scale="medium" onClick={onClose} disable={submitting || saving}>
                        {t('completeStepDialog.cancel')}
                    </MyButton>
                    <MyButton
                        buttonType="secondary"
                        scale="medium"
                        disable={submitting || saving || fieldsQuery.isLoading}
                        onClick={() => onSave(values)}
                    >
                        {saving ? t('completeStepDialog.saving') : t('completeStepDialog.save')}
                    </MyButton>
                    <MyButton
                        buttonType="primary"
                        scale="medium"
                        disable={submitting || saving || fieldsQuery.isLoading || missingCourseChoice || missingStudentDetails}
                        onClick={() =>
                            onSubmit({
                                ...values,
                                ...(createsStudent ? { package_session_id: packageSessionId } : {}),
                                ...(touchesIdentity ? { is_parent: isParent } : {}),
                                ...(touchesIdentity && isParent
                                    ? {
                                          student_full_name: studentFullName,
                                          student_email: studentEmail,
                                          student_mobile_number: studentMobileNumber,
                                      }
                                    : {}),
                            })
                        }
                    >
                        {submitting ? t('completeStepDialog.completing') : t('completeStepDialog.completeStep')}
                    </MyButton>
                </div>
            }
        >
            <div className="flex flex-col gap-4 px-6 py-6">
                {touchesIdentity && (
                    <div className="flex items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-neutral-50/60 px-3.5 py-3">
                        <div className="flex items-center gap-2.5">
                            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
                                <Users size={16} weight="fill" />
                            </span>
                            <Label htmlFor="complete-step-is-parent" className="cursor-pointer text-body text-neutral-700">
                                {t('completeStepDialog.parentToggleLabel')}
                            </Label>
                        </div>
                        <Switch id="complete-step-is-parent" checked={isParent} onCheckedChange={setIsParent} />
                    </div>
                )}
                {touchesIdentity && !isParent && (
                    <div className="flex items-start gap-2.5 rounded-xl border border-neutral-200 bg-neutral-50/60 p-3.5">
                        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-500">
                            <UserCircle size={16} weight="fill" />
                        </span>
                        <div className="flex flex-col gap-0.5">
                            <p className="text-caption text-neutral-500">
                                {t('completeStepDialog.existingDetailsHint')}
                            </p>
                            <p className="text-body font-medium text-neutral-800">
                                {subjectFullName || t('completeStepDialog.noNameOnFile')}
                            </p>
                            <p className="text-caption text-neutral-600">
                                {[subjectEmail, subjectMobileNumber].filter(Boolean).join(' · ') ||
                                    t('completeStepDialog.noContactOnFile')}
                            </p>
                        </div>
                    </div>
                )}
                {touchesIdentity && isParent && (
                    <div className="flex flex-col gap-3 rounded-xl border border-neutral-200 bg-neutral-50/60 p-3.5">
                        <div className="flex items-start gap-2.5">
                            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
                                <UserCircle size={16} weight="fill" />
                            </span>
                            <p className="text-caption text-neutral-500">
                                {t('completeStepDialog.studentDetailsHint')}
                            </p>
                        </div>
                        <div className="flex flex-col gap-2.5 ps-10">
                            <MyInput
                                inputType="text"
                                label={t('completeStepDialog.studentFullNameLabel')}
                                required
                                inputPlaceholder={t('completeStepDialog.studentFullNamePlaceholder')}
                                input={studentFullName}
                                onChangeFunction={(e) => setStudentFullName(e.target.value)}
                            />
                            <MyInput
                                inputType="text"
                                label={t('completeStepDialog.studentEmailLabel')}
                                inputPlaceholder={t('completeStepDialog.studentEmailPlaceholder')}
                                input={studentEmail}
                                onChangeFunction={(e) => setStudentEmail(e.target.value)}
                            />
                            <PhoneNumberInput
                                name="student_mobile_number"
                                label={t('completeStepDialog.studentMobileLabel')}
                                placeholder={t('completeStepDialog.studentMobilePlaceholder')}
                                value={studentMobileNumber}
                                onChange={(_, value) => setStudentMobileNumber(value)}
                                validate={false}
                            />
                        </div>
                    </div>
                )}
                {createsStudent && (
                    <div className="flex flex-col gap-2 rounded-xl border border-neutral-200 bg-neutral-50/60 p-3.5">
                        <div className="flex items-center gap-2.5">
                            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-success-50 text-success-600">
                                <GraduationCap size={16} weight="fill" />
                            </span>
                            <Label className="text-neutral-700">
                                {t('completeStepDialog.enrollLabel')}{' '}
                                {skipCourseIfEnrolled ? (
                                    <span className="text-caption font-normal text-neutral-500">
                                        {t('completeStepDialog.optionalIfEnrolled')}
                                    </span>
                                ) : (
                                    <span className="text-danger-600">*</span>
                                )}
                            </Label>
                        </div>
                        {skipCourseIfEnrolled && (
                            <p className="text-caption text-neutral-500">
                                {t('completeStepDialog.skipCourseHint')}
                            </p>
                        )}
                        {hasPool ? (
                            <Select value={packageSessionId} onValueChange={setPackageSessionId}>
                                <SelectTrigger>
                                    <SelectValue placeholder={t('completeStepDialog.pickCoursePlaceholder')} />
                                </SelectTrigger>
                                <SelectContent>
                                    {poolChoices.map((o) => (
                                        <SelectItem key={o.package_session_id} value={o.package_session_id}>
                                            {o.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        ) : (
                            <AsyncSearchableSelect
                                value={packageSessionId}
                                onChange={(value, option) => {
                                    setPackageSessionId(value);
                                    setPackageSessionLabel(option?.label);
                                }}
                                selectedLabel={packageSessionLabel}
                                loadOptions={async (search, page) => {
                                    const { options, hasMore } = await searchPackageSessions(search, page);
                                    return {
                                        options: options.map((o) => ({
                                            label: o.label,
                                            value: o.package_session_id,
                                        })),
                                        hasMore,
                                    };
                                }}
                                placeholder={t('completeStepDialog.searchCoursePlaceholder')}
                                searchPlaceholder={t('completeStepDialog.searchPlaceholder')}
                            />
                        )}
                    </div>
                )}
                {fieldsQuery.isLoading ? (
                    <ProfileSkeleton blocks={1} />
                ) : fields.length === 0 ? (
                    !touchesIdentity && (
                        <p className="text-body text-neutral-500">
                            {t('completeStepDialog.noFieldsHint')}
                        </p>
                    )
                ) : (
                    <div className="flex flex-col gap-2.5 rounded-xl border border-neutral-200 p-3.5">
                        <div className="flex items-center gap-2.5">
                            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-info-50 text-info-600">
                                <ListChecks size={16} weight="fill" />
                            </span>
                            <Label className="text-neutral-700">{t('completeStepDialog.formFieldsLabel')}</Label>
                        </div>
                        <div className="flex flex-col gap-3.5 ps-10">
                            {fields.map((f) => {
                                const label =
                                    f.field_name ?? t('completeStepDialog.defaultFieldLabel');
                                return (
                                    <div
                                        key={f.institute_custom_field_id}
                                        className="flex flex-col gap-1.5"
                                    >
                                        <Label className="text-body text-neutral-700">
                                            {label}
                                            {f.is_mandatory && (
                                                <span className="text-danger-600"> *</span>
                                            )}
                                        </Label>
                                        <CustomFieldRenderer
                                            // `type` is what makes a dropdown a dropdown and a
                                            // date a date picker -- every field used to render
                                            // through a single hardcoded text input.
                                            type={f.field_type ?? 'text'}
                                            name={label}
                                            value={values[f.institute_custom_field_id] ?? ''}
                                            onChange={(value) =>
                                                setValues((prev) => ({
                                                    ...prev,
                                                    [f.institute_custom_field_id]: value,
                                                }))
                                            }
                                            options={parseFieldOptions(f.config)}
                                            config={configJsonToFullConfig(f.config ?? undefined)}
                                            required={f.is_mandatory ?? false}
                                            // A field this step assigns to the student/parent
                                            // only: shown pre-filled but not editable here,
                                            // matching what the server would accept anyway.
                                            disabled={f.can_edit === false}
                                        />
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>
        </MyDialog>
    );
}

// ── Submitted-form viewer ────────────────────────────────────────────────

function SubmittedFormDialog({
    stepInstance,
    onClose,
}: {
    stepInstance: OnboardingStepInstanceDTO;
    onClose: () => void;
}) {
    const { t } = useTranslation('manageStudentsOnboardingProfile');
    const valuesQuery = useQuery({
        queryKey: ['onboarding-submitted-values', stepInstance.id],
        queryFn: () => fetchSubmittedFieldValues(stepInstance.id),
        staleTime: 30 * 1000,
    });

    return (
        <MyDialog
            open
            onOpenChange={(o) => !o && onClose()}
            heading={t('submittedFormDialog.heading', { stepName: stepInstance.step_name })}
            dialogWidth="max-w-md"
            footer={
                <div className="flex w-full justify-end">
                    <MyButton buttonType="secondary" scale="medium" onClick={onClose}>
                        {t('submittedFormDialog.close')}
                    </MyButton>
                </div>
            }
        >
            <div className="flex flex-col gap-2 px-6 py-6">
                {valuesQuery.isLoading ? (
                    <ProfileSkeleton blocks={1} />
                ) : (valuesQuery.data ?? []).length === 0 ? (
                    <p className="text-body text-neutral-500">{t('submittedFormDialog.noFields')}</p>
                ) : (
                    <ul className="flex flex-col divide-y divide-border">
                        {(valuesQuery.data ?? []).map((f) => (
                            <li key={f.institute_custom_field_id} className="py-1.5">
                                <div className="text-caption text-neutral-500">
                                    {f.field_name ?? t('submittedFormDialog.untitledField')}
                                </div>
                                <div className="text-body text-neutral-800">
                                    {/* By type, not as a string: a file field's value is the
                                        uploaded object's URL, which is useless as raw text. */}
                                    <CustomFieldValueDisplay
                                        value={f.value}
                                        fieldType={f.field_type}
                                        emptyLabel={t('submittedFormDialog.notAnswered')}
                                    />
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </MyDialog>
    );
}
