import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BASE_URL_LEARNER_DASHBOARD } from '@/constants/urls';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { useStudentSidebar } from '@/routes/manage-students/students-list/-context/selected-student-sidebar-context';
import {
    fetchSubOrgAdmins,
    fetchSubOrgMembers,
    SubOrgAdmin,
    SubOrgMember,
} from '@/routes/manage-students/students-list/-services/sub-org-service';
import {
    Users,
    User,
    Buildings,
    ShieldCheck,
    ArrowSquareOut,
    Copy,
    Check,
    Key,
} from '@phosphor-icons/react';
import { toast } from 'sonner';
import { useStudentCredentialsStore } from '@/stores/students/students-list/useStudentCredentialsStore';
import { useUsersCredentials } from '@/routes/manage-students/students-list/-services/usersCredentials';
import { BatchPicker } from '../BatchPicker';
import { cn } from '@/lib/utils';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { OtherTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import {
    ProfileSectionCard,
    ProfileFieldRow,
    ProfileSkeleton,
    ProfileEmpty,
    ProfileError,
    ProfileHero,
    ProfileActionBar,
} from '../profile-ui';
import { MyButton } from '@/components/design-system/button';

export const StudentSubOrg = ({ isSubmissionTab }: { isSubmissionTab?: boolean }) => {
    const { t } = useTranslation('manageStudentsSubOrg');
    const { selectedStudent } = useStudentSidebar();
    const { instituteDetails } = useInstituteDetailsStore();
    const [isLoading, setIsLoading] = useState(false);
    const [fetchError, setFetchError] = useState(false);
    const [admins, setAdmins] = useState<SubOrgAdmin[] | null>(null);
    const [members, setMembers] = useState<SubOrgMember[] | null>(null);
    const [copiedUsername, setCopiedUsername] = useState(false);
    const [copiedPassword, setCopiedPassword] = useState(false);

    // Credentials logic
    const { getCredentials } = useStudentCredentialsStore();
    const { mutate: fetchCredentials } = useUsersCredentials();

    // Helper to determine if current selected user is an admin in the sub-org
    const isSubOrgAdmin = () => {
        if (!selectedStudent?.comma_separated_org_roles) return false;
        const roles = selectedStudent.comma_separated_org_roles
            .split(',')
            .map((r) => r.trim().toUpperCase());
        return roles.includes('ADMIN');
    };

    const userId = isSubmissionTab ? selectedStudent?.id : selectedStudent?.user_id;

    // Fetch credentials if not available
    const credentials = userId ? getCredentials(userId) : null;

    // Multi-enrollment: admin picks which batch's sub-org members/admins to fetch.
    // Defaults to the row's primary (latest) ps_id; falls back to the legacy single field.
    const enrollmentPsIds: string[] = (selectedStudent?.all_package_session_ids?.length
        ? selectedStudent.all_package_session_ids
        : selectedStudent?.package_session_id
          ? [selectedStudent.package_session_id]
          : []) as string[];
    const [selectedPsId, setSelectedPsId] = useState<string>(enrollmentPsIds[0] ?? '');
    useEffect(() => {
        setSelectedPsId(enrollmentPsIds[0] ?? '');
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedStudent?.user_id]);

    useEffect(() => {
        if (userId && !credentials && isSubOrgAdmin()) {
            fetchCredentials({ userIds: [userId] });
        }
    }, [userId, credentials, fetchCredentials]);

    const handleCopy = (text: string, type: 'username' | 'password') => {
        navigator.clipboard.writeText(text);
        if (type === 'username') {
            setCopiedUsername(true);
            setTimeout(() => setCopiedUsername(false), 2000);
        } else {
            setCopiedPassword(true);
            setTimeout(() => setCopiedPassword(false), 2000);
        }
        toast.success(
            type === 'username' ? t('credentials.usernameCopied') : t('credentials.passwordCopied')
        );
    };

    const loadDetails = async () => {
        if (!selectedStudent || !selectedStudent.sub_org_id || !userId || !selectedPsId) return;
        setFetchError(false);
        setIsLoading(true);
        try {
            if (isSubOrgAdmin()) {
                const response = await fetchSubOrgMembers(
                    selectedPsId,
                    selectedStudent.sub_org_id
                );
                setMembers(response.student_mappings);
            } else {
                const response = await fetchSubOrgAdmins(
                    userId,
                    selectedPsId,
                    selectedStudent.sub_org_id
                );
                setAdmins(response.admins);
            }
        } catch (error) {
            console.error(error);
            setFetchError(true);
            toast.error(
                t('error.toast', {
                    term: getTerminology(OtherTerms.SubOrg, SystemTerms.SubOrg).toLowerCase(),
                })
            );
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        loadDetails();
    }, [selectedStudent, userId, selectedPsId]);

    const subOrgTerm = getTerminology(OtherTerms.SubOrg, SystemTerms.SubOrg);

    if (!selectedStudent?.sub_org_name) {
        return (
            <ProfileEmpty
                icon={Buildings}
                title={t('emptyState.title', { term: subOrgTerm })}
                hint={t('emptyState.hint', { term: subOrgTerm.toLowerCase() })}
            />
        );
    }

    const picker = (
        <BatchPicker
            packageSessionIds={enrollmentPsIds}
            value={selectedPsId}
            onChange={setSelectedPsId}
            label={t('picker.label', { term: subOrgTerm })}
        />
    );

    if (isLoading)
        return (
            <div className="flex flex-col gap-3">
                {picker}
                <ProfileSkeleton blocks={2} />
            </div>
        );

    if (fetchError)
        return (
            <div className="flex flex-col gap-3">
                {picker}
                <ProfileError
                    title={t('error.title', { term: subOrgTerm.toLowerCase() })}
                    hint={t('error.hint', { term: subOrgTerm.toLowerCase() })}
                    onRetry={loadDetails}
                />
            </div>
        );

    const isAdmin = isSubOrgAdmin();
    const heroTone = isAdmin ? 'primary' : 'neutral';
    const roleLabel = isAdmin ? t('role.admin') : t('role.member');

    // "Open Management Portal" must point at the institute's configured learner
    // portal (same source as enroll-invite / audience links), falling back to the
    // global default. learner_portal_base_url may be a bare domain, so normalize it.
    const rawPortalBase =
        instituteDetails?.learner_portal_base_url || BASE_URL_LEARNER_DASHBOARD;
    const managementPortalUrl =
        rawPortalBase.startsWith('http://') || rawPortalBase.startsWith('https://')
            ? rawPortalBase
            : `https://${rawPortalBase}`;

    return (
        <div className="flex flex-col gap-3">
            {picker}

            {/* Sub-org hero */}
            <ProfileHero
                eyebrow={subOrgTerm.toUpperCase()}
                title={selectedStudent.sub_org_name}
                subtitle={roleLabel}
                icon={Buildings}
                tone={heroTone}
            />

            {isAdmin ? (
                <>
                    {/* Admin action bar */}
                    <ProfileActionBar>
                        <a
                            href={managementPortalUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            <MyButton buttonType="primary" scale="small">
                                {t('actions.openManagementPortal')}
                                <ArrowSquareOut className="size-4" />
                            </MyButton>
                        </a>
                    </ProfileActionBar>

                    {/* Admin credentials card */}
                    <ProfileSectionCard icon={Key} heading={t('credentials.heading')}>
                        <dl className="divide-y divide-neutral-100">
                            <ProfileFieldRow
                                label={t('credentials.usernameLabel')}
                                value={
                                    <code className="rounded-sm bg-neutral-100 px-2 py-0.5 text-xs text-neutral-700">
                                        {credentials?.username ||
                                            selectedStudent.username ||
                                            'N/A'}
                                    </code>
                                }
                                copied={copiedUsername}
                                onCopy={() =>
                                    handleCopy(
                                        credentials?.username ||
                                            selectedStudent.username ||
                                            '',
                                        'username'
                                    )
                                }
                            />
                            <ProfileFieldRow
                                label={t('credentials.passwordLabel')}
                                value={
                                    <code className="rounded-sm bg-neutral-100 px-2 py-0.5 text-xs text-neutral-700">
                                        {credentials?.password || '••••••••'}
                                    </code>
                                }
                                copied={copiedPassword}
                                onCopy={
                                    credentials?.password
                                        ? () => handleCopy(credentials.password, 'password')
                                        : undefined
                                }
                            />
                        </dl>
                    </ProfileSectionCard>

                    {/* Managed members card */}
                    <ProfileSectionCard
                        icon={Users}
                        heading={t('members.heading', { count: members?.length ?? 0 })}
                    >
                        {members && members.length > 0 ? (
                            <div className="flex flex-col gap-2">
                                {members.map((member) => (
                                    <div
                                        key={member.id}
                                        className="flex items-center justify-between gap-3 rounded-lg border border-neutral-100 bg-neutral-50 p-3"
                                    >
                                        <div className="flex min-w-0 items-center gap-2">
                                            <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-neutral-100">
                                                <User className="size-4 text-neutral-500" />
                                            </span>
                                            <div className="min-w-0">
                                                <p
                                                    className="truncate text-sm font-medium text-neutral-700"
                                                    title={member.user.full_name}
                                                >
                                                    {member.user.full_name}
                                                </p>
                                                <p
                                                    className="truncate text-xs text-neutral-400"
                                                    title={member.user.username}
                                                >
                                                    {member.user.username}
                                                </p>
                                            </div>
                                        </div>
                                        <span
                                            className={cn(
                                                'inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1',
                                                member.status === 'ACTIVE'
                                                    ? 'bg-success-50 text-success-700 ring-success-200'
                                                    : 'bg-neutral-100 text-neutral-600 ring-neutral-200'
                                            )}
                                        >
                                            {member.status}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <ProfileEmpty
                                icon={Users}
                                title={t('members.emptyTitle')}
                                hint={t('members.emptyHint', { term: subOrgTerm.toLowerCase() })}
                            />
                        )}
                    </ProfileSectionCard>
                </>
            ) : (
                /* Sub-org admins card (member view) */
                <ProfileSectionCard icon={ShieldCheck} heading={t('admins.heading', { term: subOrgTerm })}>
                    {admins && admins.length > 0 ? (
                        <div className="flex flex-col gap-2">
                            {admins.map((admin, idx) => (
                                <div
                                    key={idx}
                                    className="flex items-center gap-3 rounded-lg border border-neutral-100 bg-neutral-50 p-3"
                                >
                                    <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-info-50">
                                        <User className="size-4 text-info-600" />
                                    </span>
                                    <div className="min-w-0">
                                        <p
                                            className="truncate text-sm font-medium text-neutral-700"
                                            title={admin.name}
                                        >
                                            {admin.name}
                                        </p>
                                        <span className="inline-flex items-center rounded-full bg-warning-50 px-2 py-0.5 text-xs font-medium text-warning-700 ring-1 ring-warning-200">
                                            {admin.role}
                                        </span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <ProfileEmpty
                            icon={ShieldCheck}
                            title={t('admins.emptyTitle')}
                            hint={t('admins.emptyHint', { term: subOrgTerm.toLowerCase() })}
                        />
                    )}
                </ProfileSectionCard>
            )}
        </div>
    );
};
