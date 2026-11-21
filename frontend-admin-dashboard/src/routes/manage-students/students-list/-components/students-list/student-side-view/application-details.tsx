import { useQuery } from '@tanstack/react-query';
import { fetchApplicantList } from '@/routes/admissions/-services/applicant-services';
import { format } from 'date-fns';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
    ClipboardText,
    Student,
    Users,
    CheckCircle,
    Clock,
    XCircle,
    Spinner,
    type Icon as PhosphorIcon,
} from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import {
    ProfileSectionCard,
    ProfileFieldRow,
    ProfileSkeleton,
    ProfileEmpty,
    ProfileError,
    ProfileHero,
} from './profile-ui';

interface ApplicationDetailsProps {
    applicantId: string | null;
}

const formatDate = (dateStr: string | null | undefined) => {
    if (!dateStr) return null;
    try {
        return format(new Date(dateStr), 'd MMM yyyy');
    } catch {
        return dateStr;
    }
};

const formatDateTime = (dateStr: string | null | undefined) => {
    if (!dateStr) return '—';
    try {
        return format(new Date(dateStr), 'd MMM yyyy, h:mm a');
    } catch {
        return dateStr ?? '—';
    }
};

// Derive the hero tone and display label from the raw overall_status value.
type StatusConfig = {
    tone: 'success' | 'danger' | 'warning' | 'neutral';
    label: string;
    icon: PhosphorIcon;
    pillBg: string;
    pillText: string;
    pillRing: string;
};

const buildStatusConfig =
    (t: TFunction) =>
    (status: string): StatusConfig => {
        switch (status) {
            case 'ADMITTED':
            case 'APPROVED':
                return {
                    tone: 'success',
                    label:
                        status === 'ADMITTED'
                            ? t('status.admitted')
                            : t('status.approved'),
                    icon: CheckCircle,
                    pillBg: 'bg-success-50',
                    pillText: 'text-success-700',
                    pillRing: 'ring-success-200',
                };
            case 'REJECTED':
                return {
                    tone: 'danger',
                    label: t('status.rejected'),
                    icon: XCircle,
                    pillBg: 'bg-danger-50',
                    pillText: 'text-danger-700',
                    pillRing: 'ring-danger-200',
                };
            case 'PENDING':
                return {
                    tone: 'warning',
                    label: t('status.pending'),
                    icon: Clock,
                    pillBg: 'bg-warning-50',
                    pillText: 'text-warning-700',
                    pillRing: 'ring-warning-200',
                };
            case 'UNDER_REVIEW':
            case 'SUBMITTED':
                return {
                    tone: 'warning',
                    label:
                        status === 'UNDER_REVIEW'
                            ? t('status.underReview')
                            : t('status.submitted'),
                    icon: Spinner,
                    pillBg: 'bg-warning-50',
                    pillText: 'text-warning-700',
                    pillRing: 'ring-warning-200',
                };
            default:
                return {
                    tone: 'neutral',
                    label: status || '—',
                    icon: ClipboardText,
                    pillBg: 'bg-neutral-100',
                    pillText: 'text-neutral-700',
                    pillRing: 'ring-neutral-200',
                };
        }
    };

// ── Stage progress indicator ──────────────────────────────────────────────────
//
// Derives a 3-step funnel from the raw overall_status: Submitted → Under Review
// → terminal (Approved / Rejected / Admitted). "current" step is highlighted with
// the tone colour; prior steps show success; future steps are muted neutral.

type StepState = 'done' | 'current' | 'upcoming';

interface Step {
    key: string;
    label: string;
}

const buildStageSteps = (t: TFunction): Step[] => [
    { key: 'submitted', label: t('stageSteps.submitted') },
    { key: 'review', label: t('stageSteps.review') },
    { key: 'terminal', label: t('stageSteps.decision') },
];

const deriveStepIndex = (status: string): number => {
    switch (status) {
        case 'SUBMITTED':
            return 0;
        case 'UNDER_REVIEW':
        case 'PENDING':
            return 1;
        case 'APPROVED':
        case 'ADMITTED':
        case 'REJECTED':
            return 2;
        default:
            return 0;
    }
};

const ApplicationStageProgress = ({
    status,
}: {
    status: string;
}) => {
    const { t } = useTranslation('manageStudentsApplicationDetails');
    const STAGE_STEPS = buildStageSteps(t);
    const currentIdx = deriveStepIndex(status);
    const isRejected = status === 'REJECTED';

    return (
        <div className="flex items-center gap-0">
            {STAGE_STEPS.map((step, i) => {
                const state: StepState =
                    i < currentIdx ? 'done' : i === currentIdx ? 'current' : 'upcoming';

                // Terminal step label: show actual decision text instead of generic "Decision"
                const label =
                    i === STAGE_STEPS.length - 1 && state === 'current'
                        ? status === 'REJECTED'
                            ? t('status.rejected')
                            : status === 'APPROVED'
                              ? t('status.approved')
                              : status === 'ADMITTED'
                                ? t('status.admitted')
                                : step.label
                        : step.label;

                const dotCn = cn(
                    'size-3 shrink-0 rounded-full ring-2',
                    state === 'done'
                        ? 'bg-success-500 ring-success-200'
                        : state === 'current' && isRejected
                          ? 'bg-danger-500 ring-danger-200'
                          : state === 'current'
                            ? 'bg-primary-500 ring-primary-200'
                            : 'bg-neutral-200 ring-neutral-100'
                );

                const labelCn = cn(
                    'text-xs font-medium',
                    state === 'done'
                        ? 'text-success-600'
                        : state === 'current' && isRejected
                          ? 'text-danger-600'
                          : state === 'current'
                            ? 'text-primary-600'
                            : 'text-neutral-400'
                );

                const connectorCn = cn(
                    'h-px flex-1 mx-1',
                    i < currentIdx ? 'bg-success-300' : 'bg-neutral-200'
                );

                return (
                    <div key={step.key} className="flex min-w-0 flex-1 items-center">
                        {/* Step node */}
                        <div className="flex shrink-0 flex-col items-center gap-1">
                            <span className={dotCn} />
                            <span className={labelCn}>{label}</span>
                        </div>
                        {/* Connector line — not after last step */}
                        {i < STAGE_STEPS.length - 1 && (
                            <div className={connectorCn} />
                        )}
                    </div>
                );
            })}
        </div>
    );
};

// ── Main component ────────────────────────────────────────────────────────────

export const ApplicationDetails = ({ applicantId }: ApplicationDetailsProps) => {
    const { t } = useTranslation('manageStudentsApplicationDetails');
    const getStatusConfig = buildStatusConfig(t);
    const { instituteDetails } = useInstituteDetailsStore();
    const instituteId = instituteDetails?.id || '';

    const { data, isLoading, isError, refetch } = useQuery({
        queryKey: ['applicant-details', applicantId, instituteId],
        queryFn: async () => {
            const response = await fetchApplicantList(
                {
                    institute_id: instituteId,
                    search: '',
                },
                0,
                100
            );
            const applicant = response.content.find((app) => app.applicant_id === applicantId);
            if (!applicant) throw new Error('Applicant not found');
            return applicant;
        },
        enabled: !!applicantId && !!instituteId,
    });

    if (!applicantId) {
        return (
            <ProfileEmpty
                icon={ClipboardText}
                title={t('empty.title')}
                hint={t('empty.hint')}
            />
        );
    }

    if (isLoading) {
        return <ProfileSkeleton blocks={4} />;
    }

    if (isError || !data) {
        return (
            <ProfileError
                title={t('error.title')}
                hint={t('error.hint')}
                onRetry={() => refetch()}
            />
        );
    }

    const cfg = getStatusConfig(data.overall_status);
    const stageName = data.application_stage?.stage_name;
    const heroSubtitle = [
        data.tracking_id ? t('hero.trackingId', { id: data.tracking_id }) : null,
        stageName ? t('hero.stage', { stage: stageName }) : null,
    ]
        .filter(Boolean)
        .join(' · ');

    return (
        <div className="flex flex-col gap-3">
            {/* Hero — status at a glance */}
            <ProfileHero
                eyebrow={t('eyebrow')}
                title={
                    <span
                        className={cn(
                            'inline-flex items-center gap-2 rounded-full px-3 py-1 text-lg font-bold ring-1',
                            cfg.pillBg,
                            cfg.pillText,
                            cfg.pillRing
                        )}
                    >
                        <cfg.icon className="size-5" weight="duotone" />
                        {cfg.label}
                    </span>
                }
                subtitle={heroSubtitle || undefined}
                icon={ClipboardText}
                tone={cfg.tone}
            >
                {/* Stage progress steps */}
                <ApplicationStageProgress status={data.overall_status} />
            </ProfileHero>

            {/* Student Information */}
            <ProfileSectionCard icon={Student} heading={t('sections.studentInformation')}>
                <dl className="divide-y divide-neutral-100">
                    <ProfileFieldRow
                        label={t('fields.fullName')}
                        value={data.student_data?.full_name || t('notAvailable')}
                    />
                    <ProfileFieldRow
                        label={t('fields.dateOfBirth')}
                        value={formatDate(data.student_data?.date_of_birth) || t('notAvailable')}
                    />
                    <ProfileFieldRow
                        label={t('fields.gender')}
                        value={data.student_data?.gender || t('notAvailable')}
                    />
                    <ProfileFieldRow
                        label={t('fields.classAppliedFor')}
                        value={data.package_session?.level_name || t('notAvailable')}
                    />
                    {data.student_data?.father_name && (
                        <ProfileFieldRow
                            label={t('fields.fatherName')}
                            value={data.student_data.father_name}
                        />
                    )}
                    {data.student_data?.mother_name && (
                        <ProfileFieldRow
                            label={t('fields.motherName')}
                            value={data.student_data.mother_name}
                        />
                    )}
                    {data.student_data?.applying_for_class && (
                        <ProfileFieldRow
                            label={t('fields.applyingForClass')}
                            value={data.student_data.applying_for_class}
                        />
                    )}
                    {data.student_data?.academic_year && (
                        <ProfileFieldRow
                            label={t('fields.academicYear')}
                            value={data.student_data.academic_year}
                        />
                    )}
                </dl>
            </ProfileSectionCard>

            {/* Parent Information */}
            <ProfileSectionCard icon={Users} heading={t('sections.parentInformation')}>
                <dl className="divide-y divide-neutral-100">
                    <ProfileFieldRow
                        label={t('fields.fullName')}
                        value={data.parent_data?.full_name || t('notAvailable')}
                    />
                    <ProfileFieldRow
                        label={t('fields.email')}
                        value={data.parent_data?.email || t('notAvailable')}
                    />
                    <ProfileFieldRow
                        label={t('fields.mobileNumber')}
                        value={data.parent_data?.mobile_number || t('notAvailable')}
                    />
                    {data.parent_data?.address_line && (
                        <ProfileFieldRow
                            label={t('fields.address')}
                            value={data.parent_data.address_line}
                        />
                    )}
                </dl>
            </ProfileSectionCard>

            {/* Application Timeline */}
            <ProfileSectionCard icon={ClipboardText} heading={t('sections.applicationTimeline')}>
                <dl className="divide-y divide-neutral-100">
                    <ProfileFieldRow label={t('fields.trackingId')} value={data.tracking_id} />
                    <ProfileFieldRow
                        label={t('fields.currentStage')}
                        value={data.application_stage?.stage_name || t('notAvailable')}
                    />
                    <ProfileFieldRow
                        label={t('fields.stageStatus')}
                        value={data.application_stage_status || t('notAvailable')}
                    />
                    <ProfileFieldRow
                        label={t('fields.createdAt')}
                        value={formatDateTime(data.created_at)}
                    />
                    <ProfileFieldRow
                        label={t('fields.lastUpdated')}
                        value={formatDateTime(data.updated_at)}
                    />
                </dl>
            </ProfileSectionCard>
        </div>
    );
};
