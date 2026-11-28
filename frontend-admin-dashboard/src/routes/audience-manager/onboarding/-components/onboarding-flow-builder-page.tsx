/**
 * OnboardingFlowBuilderPage — flow detail/builder: ordered steps, reorder,
 * add/edit/delete a step, and activate the flow once it has at least one step.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { toast } from 'sonner';
import {
    ArrowLeft,
    CheckCircle,
    ClipboardText,
    DotsSixVertical,
    FlowArrow,
    GraduationCap,
    ListChecks,
    Path,
    PencilSimple,
    Play,
    Plus,
    Rocket,
    TrashSimple,
    UsersThree,
} from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { instituteTerms } from '@/components/shared/crm-enhance/institute-terms';
import { cn } from '@/lib/utils';
import {
    EmptyChart,
    SectionCard,
} from '@/routes/study-library/live-session/-components/dashboard/dashboard-charts';
import { Sortable, SortableDragHandle, SortableItem } from '@/components/ui/sortable';
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
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { StepDialog } from './step-dialog';
import {
    fetchOnboardingFlow,
    fetchOnboardingStatusCounts,
    fetchOnboardingSteps,
    updateOnboardingFlow,
    deleteOnboardingStep,
    reorderOnboardingSteps,
    onboardingFlowKey,
    onboardingStepsKey,
    type OnboardingRoleAccess,
    type OnboardingStepDTO,
} from '../-services/onboarding-service';

const INSTANCE_STATUSES = ['IN_PROGRESS', 'COMPLETED', 'ABANDONED', 'CANCELLED'] as const;
const INSTANCE_TONE: Record<(typeof INSTANCE_STATUSES)[number], string> = {
    IN_PROGRESS: 'text-info-600',
    COMPLETED: 'text-success-700',
    ABANDONED: 'text-warning-700',
    CANCELLED: 'text-neutral-600',
};

interface OnboardingFlowBuilderPageProps {
    flowId: string;
}

export function OnboardingFlowBuilderPage({ flowId }: OnboardingFlowBuilderPageProps) {
    const { t } = useTranslation('audienceManagerOnboardingFlowBuilderPage');
    const setNavHeading = useNavHeadingStore((s) => s.setNavHeading);
    const navigate = useNavigate();
    const queryClient = useQueryClient();

    const flowQuery = useQuery({
        queryKey: onboardingFlowKey(flowId),
        queryFn: () => fetchOnboardingFlow(flowId),
        staleTime: 30 * 1000,
    });
    const instituteId = flowQuery.data?.institute_id ?? '';

    const stepsQuery = useQuery({
        queryKey: onboardingStepsKey(flowId),
        queryFn: () => fetchOnboardingSteps(flowId),
        staleTime: 15 * 1000,
    });

    // People on this flow, by status: one grouped count request, the same cache entry
    // the Dashboard tab's count cards use when filtered to this flow.
    const countsQuery = useQuery({
        queryKey: ['onboarding-status-counts', instituteId, flowId ?? null],
        queryFn: () => fetchOnboardingStatusCounts(instituteId, flowId),
        enabled: !!instituteId,
        staleTime: 5 * 60 * 1000,
        refetchOnWindowFocus: false,
    });

    useEffect(() => {
        setNavHeading(<h1 className="text-lg">{flowQuery.data?.name ?? t('navHeading.fallback')}</h1>);
    }, [setNavHeading, flowQuery.data?.name, t]);

    const [steps, setSteps] = useState<OnboardingStepDTO[]>([]);
    useEffect(() => {
        if (stepsQuery.data) setSteps(stepsQuery.data);
    }, [stepsQuery.data]);

    const [stepDialogOpen, setStepDialogOpen] = useState(false);
    const [editingStep, setEditingStep] = useState<OnboardingStepDTO | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<OnboardingStepDTO | null>(null);

    const invalidateSteps = () => {
        queryClient.invalidateQueries({ queryKey: onboardingStepsKey(flowId) });
        queryClient.invalidateQueries({ queryKey: onboardingFlowKey(flowId) });
    };

    const { mutate: reorder } = useMutation({
        mutationFn: (ordered: OnboardingStepDTO[]) =>
            reorderOnboardingSteps(
                flowId,
                ordered.map((s, index) => ({ step_id: s.id, order: index }))
            ),
        onError: () => {
            toast.error(t('toasts.reorderError'));
            invalidateSteps();
        },
    });

    const { mutate: removeStep, isPending: deleting } = useMutation({
        mutationFn: (stepId: string) => deleteOnboardingStep(flowId, stepId),
        onSuccess: () => {
            toast.success(t('toasts.stepRemoved'));
            setDeleteTarget(null);
            invalidateSteps();
        },
        onError: () => toast.error(t('toasts.removeError')),
    });

    const { mutate: activateFlow, isPending: activating } = useMutation({
        mutationFn: () => updateOnboardingFlow(flowId, { status: 'ACTIVE' }),
        onSuccess: () => {
            toast.success(t('toasts.flowActivated'));
            invalidateSteps();
        },
        onError: () => toast.error(t('toasts.activateError')),
    });

    const handleMove = ({ activeIndex, overIndex }: { activeIndex: number; overIndex: number }) => {
        const next = [...steps];
        const [moved] = next.splice(activeIndex, 1);
        if (!moved) return;
        next.splice(overIndex, 0, moved);
        setSteps(next);
        reorder(next);
    };

    const openAddStep = () => {
        setEditingStep(null);
        setStepDialogOpen(true);
    };
    const openEditStep = (step: OnboardingStepDTO) => {
        setEditingStep(step);
        setStepDialogOpen(true);
    };

    if (flowQuery.isLoading) {
        return <div className="p-6 text-body text-neutral-500">{t('states.loadingFlow')}</div>;
    }
    if (flowQuery.isError || !flowQuery.data) {
        return (
            <div className="flex flex-col items-center gap-3 p-12 text-center">
                <p className="text-body text-danger-700">{t('states.loadFlowError')}</p>
                <MyButton buttonType="secondary" scale="small" onClick={() => flowQuery.refetch()}>
                    {t('actions.retry')}
                </MyButton>
            </div>
        );
    }

    const flow = flowQuery.data;
    const canActivate = flow.status === 'DRAFT' && steps.length > 0;

    const terms = instituteTerms();
    const roleName = (key: string) =>
        key === 'STUDENT'
            ? terms.learner
            : key.charAt(0).toUpperCase() + key.slice(1).toLowerCase().replace(/_/g, ' ');
    const accessSummary = (access: OnboardingRoleAccess[] | null | undefined) =>
        (access ?? [])
            .filter((a) => a.can_view || a.can_edit)
            .map((a) =>
                a.can_edit
                    ? t('meta.roleEdit', { role: roleName(a.role_key) })
                    : t('meta.roleView', { role: roleName(a.role_key) })
            )
            .join(' · ');
    const counts = countsQuery.data;

    return (
        <div className="flex flex-col gap-5 p-2">
            <button
                type="button"
                onClick={() => navigate({ to: '/audience-manager/onboarding' })}
                className="flex w-fit items-center gap-1.5 text-caption font-medium text-neutral-500 hover:text-primary-600"
            >
                <ArrowLeft size={14} /> {t('actions.backToFlows')}
            </button>

            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                    <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-500">
                        <Path size={22} weight="duotone" />
                    </span>
                    <div className="flex min-w-0 flex-col gap-1">
                        <div className="flex flex-wrap items-center gap-2">
                            <h1 className="text-h2 font-semibold text-neutral-900">{flow.name}</h1>
                            <StatusBadge status={flow.status} t={t} />
                        </div>
                        {flow.description && (
                            <p className="text-body text-neutral-500">{flow.description}</p>
                        )}
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {canActivate && (
                        <MyButton
                            buttonType="secondary"
                            scale="medium"
                            onClick={() => activateFlow()}
                            disable={activating}
                        >
                            <Rocket size={16} />{' '}
                            {activating ? t('actions.activating') : t('actions.activateFlow')}
                        </MyButton>
                    )}
                    <MyButton buttonType="primary" scale="medium" onClick={openAddStep}>
                        <Plus size={16} weight="bold" /> {t('actions.addStep')}
                    </MyButton>
                </div>
            </div>

            {flow.status === 'DRAFT' && steps.length === 0 && (
                <div className="rounded-lg border border-warning-200 bg-warning-50 p-3 text-caption text-warning-700">
                    {t('states.addStepBeforeActivating')}
                </div>
            )}

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <SectionCard
                    className="lg:col-span-2"
                    icon={ListChecks}
                    title={t('sections.steps')}
                    subtitle={steps.length > 1 ? t('sections.stepsDragHint') : undefined}
                >
                    {stepsQuery.isLoading ? (
                        <div className="text-body text-neutral-500">{t('states.loadingSteps')}</div>
                    ) : steps.length === 0 ? (
                        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-neutral-200 bg-neutral-50 py-12 text-center">
                            <CheckCircle size={32} className="text-neutral-300" />
                            <h3 className="text-body font-semibold text-neutral-900">
                                {t('states.noStepsTitle')}
                            </h3>
                            <p className="max-w-sm text-caption text-neutral-500">
                                {t('states.noStepsDescription')}
                            </p>
                            <MyButton buttonType="primary" scale="medium" onClick={openAddStep}>
                                <Plus size={16} weight="bold" /> {t('actions.addStep')}
                            </MyButton>
                        </div>
                    ) : (
                        <Sortable value={steps.map((s) => ({ id: s.id }))} onMove={handleMove}>
                            <div className="flex flex-col divide-y divide-neutral-100 rounded-lg border border-neutral-200">
                                {steps.map((step, index) => {
                                    const access = accessSummary(step.role_access);
                                    const fieldCount = step.fields?.length ?? 0;
                                    return (
                                        <SortableItem key={step.id} value={step.id} asChild>
                                            <div className="flex items-center gap-3 bg-white p-3 first:rounded-t-lg last:rounded-b-lg hover:bg-neutral-50">
                                                <SortableDragHandle
                                                    variant="ghost"
                                                    size="icon"
                                                    className="cursor-grab"
                                                >
                                                    <DotsSixVertical size={18} />
                                                </SortableDragHandle>
                                                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary-50 text-caption font-semibold text-primary-600">
                                                    {index + 1}
                                                </span>
                                                <div className="min-w-0 flex-1">
                                                    <div className="truncate text-body font-medium text-neutral-900">
                                                        {step.step_name}
                                                    </div>
                                                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                                                        <Tag>
                                                            {stepTypeLabel(t, step.step_type)}
                                                        </Tag>
                                                        {step.is_optional && (
                                                            <Tag tone="neutral">
                                                                {t('tags.optional')}
                                                            </Tag>
                                                        )}
                                                        {step.grants_student_role && (
                                                            <Tag tone="info">
                                                                {t('tags.grantsStudentRole')}
                                                            </Tag>
                                                        )}
                                                        {step.sends_login_credentials && (
                                                            <Tag tone="success">
                                                                {t('tags.sendsCredentials')}
                                                            </Tag>
                                                        )}
                                                        <span className="text-caption text-neutral-500">
                                                            {[
                                                                t('meta.fields', {
                                                                    count: fieldCount,
                                                                }),
                                                                access,
                                                            ]
                                                                .filter(Boolean)
                                                                .join(' · ')}
                                                        </span>
                                                    </div>
                                                </div>
                                                <MyButton
                                                    buttonType="secondary"
                                                    scale="small"
                                                    onClick={() => openEditStep(step)}
                                                >
                                                    <PencilSimple size={14} /> {t('actions.edit')}
                                                </MyButton>
                                                <MyButton
                                                    buttonType="secondary"
                                                    scale="small"
                                                    onClick={() => setDeleteTarget(step)}
                                                    aria-label={t('actions.remove')}
                                                >
                                                    <TrashSimple
                                                        size={14}
                                                        className="text-danger-500"
                                                    />
                                                </MyButton>
                                            </div>
                                        </SortableItem>
                                    );
                                })}
                            </div>
                        </Sortable>
                    )}
                </SectionCard>

                <div className="flex flex-col gap-4">
                    {/* The flow as it runs, read from the steps above. */}
                    <SectionCard icon={FlowArrow} title={t('sections.howItRuns')}>
                        <ol className="flex flex-col items-stretch">
                            <FlowNode
                                icon={Play}
                                title={t('flow.startTitle')}
                                text={t('flow.startText', { learner: terms.learner.toLowerCase() })}
                                trigger
                            />
                            {steps.map((step) => (
                                <FlowNode
                                    key={step.id}
                                    icon={step.grants_student_role ? GraduationCap : ClipboardText}
                                    title={step.step_name}
                                    text={
                                        step.is_optional ? t('flow.optional') : t('flow.required')
                                    }
                                />
                            ))}
                            {steps.length > 0 && (
                                <FlowNode
                                    icon={CheckCircle}
                                    title={t('flow.doneTitle')}
                                    text={t('flow.doneText')}
                                />
                            )}
                        </ol>
                    </SectionCard>

                    <SectionCard icon={UsersThree} title={t('sections.people')}>
                        {countsQuery.isLoading ? (
                            <div className="grid grid-cols-2 gap-2">
                                {INSTANCE_STATUSES.map((s) => (
                                    <div
                                        key={s}
                                        className="h-16 animate-pulse rounded-lg bg-neutral-100"
                                    />
                                ))}
                            </div>
                        ) : !counts ? (
                            <EmptyChart text={t('people.unavailable')} className="h-24" />
                        ) : (
                            <div className="grid grid-cols-2 gap-2">
                                {INSTANCE_STATUSES.map((s) => (
                                    <div
                                        key={s}
                                        className="rounded-lg border border-neutral-200 px-3 py-2"
                                    >
                                        <div className="text-caption text-neutral-500">
                                            {t(`people.status.${s}`)}
                                        </div>
                                        <div
                                            className={cn(
                                                'text-h3 font-semibold tabular-nums',
                                                INSTANCE_TONE[s]
                                            )}
                                        >
                                            {(counts[s] ?? 0).toLocaleString()}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </SectionCard>
                </div>
            </div>

            {instituteId && (
                <StepDialog
                    instituteId={instituteId}
                    flowId={flowId}
                    open={stepDialogOpen}
                    onOpenChange={setStepDialogOpen}
                    editingStep={editingStep}
                    nextStepOrder={steps.length}
                    onSaved={invalidateSteps}
                />
            )}

            <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t('deleteDialog.title')}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {t('deleteDialog.description', { stepName: deleteTarget?.step_name ?? '' })}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={deleting}>{t('actions.cancel')}</AlertDialogCancel>
                        <AlertDialogAction
                            disabled={deleting}
                            onClick={() => deleteTarget && removeStep(deleteTarget.id)}
                            className="bg-danger-600 hover:bg-danger-700"
                        >
                            {deleting ? t('actions.removing') : t('actions.remove')}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}

/** One box of the "How it runs" column, with the connector line above it. */
function FlowNode({
    icon: IconCmp,
    title,
    text,
    trigger = false,
}: {
    icon: typeof Play;
    title: string;
    text: string;
    trigger?: boolean;
}) {
    return (
        <li className="flex flex-col items-center">
            {!trigger && <span className="h-5 w-px bg-neutral-300" aria-hidden />}
            <div
                className={cn(
                    'flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 shadow-sm',
                    trigger ? 'border-primary-200 bg-primary-50' : 'border-neutral-200 bg-white'
                )}
            >
                <IconCmp size={16} className={trigger ? 'text-primary-500' : 'text-neutral-500'} />
                <div className="min-w-0">
                    <div className="truncate text-body font-medium text-neutral-800">{title}</div>
                    <div className="text-caption text-neutral-500">{text}</div>
                </div>
            </div>
        </li>
    );
}

function StatusBadge({ status, t }: { status: string; t: TFunction }) {
    const toneClass =
        status === 'ACTIVE'
            ? 'bg-success-50 text-success-700'
            : status === 'ARCHIVED'
              ? 'bg-neutral-100 text-neutral-500'
              : 'bg-warning-50 text-warning-700';
    return (
        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-caption font-medium ${toneClass}`}>
            {status === 'DRAFT'
                ? t('statusLabels.draft')
                : status === 'ACTIVE'
                  ? t('statusLabels.active')
                  : t('statusLabels.archived')}
        </span>
    );
}

/** Translated label for a step's backend type — falls back to the raw enum
 *  value for a type the catalog doesn't know about yet (future-proofing
 *  against new OnboardingStepType values landing before copy does). */
function stepTypeLabel(t: TFunction, stepType: string): string {
    const key = `stepTypeLabels.${stepType}`;
    const translated = t(key);
    return translated === key ? stepType : translated;
}

function Tag({ children, tone = 'primary' }: { children: ReactNode; tone?: 'primary' | 'neutral' | 'info' | 'success' }) {
    const toneClass =
        tone === 'neutral'
            ? 'bg-neutral-100 text-neutral-600'
            : tone === 'info'
              ? 'bg-info-50 text-info-600'
              : tone === 'success'
                ? 'bg-success-50 text-success-700'
                : 'bg-primary-50 text-primary-700';
    return (
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-2xs font-medium ${toneClass}`}>
            {children}
        </span>
    );
}
