import { Badge } from '@/components/ui/badge';
import { Route } from '..';
import { useSuspenseQuery } from '@tanstack/react-query';
import { useInstituteQuery } from '@/services/student-list-section/getInstituteDetails';
import { getAssessmentDetails } from '@/routes/assessment/create-assessment/$assessmentId/$examtype/-services/assessment-services';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { handleGetInstituteUsersForAccessControl } from '@/routes/dashboard/-services/dashboard-services';
import { RoleTypeUserIcon } from '@/svgs';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

interface Role {
    role_name: string;
    status: string;
    role_id: string;
}

// Known backend role codes -> translation keys. Roles outside this fixed set
// (there isn't one today, but the API contract doesn't guarantee it) fall
// back to the raw backend value instead of rendering blank/missing text.
const ROLE_NAME_TRANSLATION_KEYS: Record<string, string> = {
    ADMIN: 'roles.admin',
    'CONTENT CREATOR': 'roles.contentCreator',
    'ASSESSMENT CREATOR': 'roles.assessmentCreator',
    EVALUATOR: 'roles.evaluator',
    TEACHER: 'roles.teacher',
};

const getRoleDisplayName = (t: TFunction, roleName: string): string => {
    const translationKey = ROLE_NAME_TRANSLATION_KEYS[roleName];
    return translationKey ? t(translationKey) : roleName;
};

interface AccessControlUser {
    id: string;
    username: string;
    email: string;
    full_name: string;
    address_line: string | null;
    city: string | null;
    region: string | null;
    pin_code: string | null;
    mobile_number: string | null;
    date_of_birth: string | null;
    gender: string | null;
    password: string | null;
    profile_pic_file_id: string | null;
    roles: Role[];
    status: string;
    root_user: boolean;
}

const AssessmentAccessControlTab = () => {
    const { t } = useTranslation('homeworkCreationAssessmentAccessControlTab');
    const { assessmentId, examType } = Route.useParams();
    const { data: instituteDetails } = useSuspenseQuery(useInstituteQuery());
    const { data: assessmentDetails, isLoading } = useSuspenseQuery(
        getAssessmentDetails({
            assessmentId: assessmentId,
            instituteId: instituteDetails?.id,
            type: examType,
        })
    );
    const { data: accessControlUsers, isLoading: isUsersLoading } = useSuspenseQuery(
        handleGetInstituteUsersForAccessControl(instituteDetails?.id, {
            roles: [
                { id: '1', name: 'ADMIN' },
                { id: '2', name: 'CONTENT CREATOR' },
                { id: '3', name: 'ASSESSMENT CREATOR' },
                { id: '4', name: 'EVALUATOR' },
                { id: '5', name: 'TEACHER' },
            ],
            status: [
                { id: '1', name: 'ACTIVE' },
                { id: '2', name: 'DISABLED' },
                { id: '3', name: 'INVITED' },
            ],
        })
    );

    if (isLoading || isUsersLoading) return <DashboardLoader />;
    return (
        <div className="mt-4 flex flex-col gap-5">
            <div className="flex flex-col gap-3 rounded-xl border p-5">
                <h1 className="font-semibold">{t('sections.creationAccessTitle')}</h1>
                <div className="flex flex-wrap items-center gap-4">
                    <div className="flex flex-wrap items-center gap-4">
                        {assessmentDetails[3]?.saved_data?.creation_access?.user_ids?.map(
                            (userId) => {
                                const matchedUser = accessControlUsers?.find(
                                    (user: AccessControlUser) => user.id === userId
                                );
                                return matchedUser ? (
                                    <div
                                        key={matchedUser.id}
                                        className="flex items-center justify-between gap-4"
                                    >
                                        <div className="flex items-center gap-4">
                                            {matchedUser.status !== 'INVITED' && (
                                                <RoleTypeUserIcon />
                                            )}
                                            <div className="flex flex-col gap-2">
                                                <div className="flex items-center gap-4">
                                                    <p>{matchedUser.full_name}</p>
                                                    <div className="flex items-start gap-4">
                                                        <div className="flex items-center gap-4">
                                                            {matchedUser.roles.map((role: Role) => {
                                                                return (
                                                                    <Badge
                                                                        key={role.role_id}
                                                                        className={`whitespace-nowrap rounded-lg border border-neutral-300 ${
                                                                            role.role_name ===
                                                                            'ADMIN'
                                                                                ? 'bg-info-50'
                                                                                : role.role_name ===
                                                                                    'CONTENT CREATOR'
                                                                                  ? 'bg-success-50'
                                                                                  : role.role_name ===
                                                                                      'ASSESSMENT CREATOR'
                                                                                    ? 'bg-danger-50'
                                                                                    : 'bg-violet-50'
                                                                        } py-1.5 font-thin shadow-none`}
                                                                    >
                                                                        {getRoleDisplayName(
                                                                            t,
                                                                            role.role_name
                                                                        )}
                                                                    </Badge>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                </div>
                                                <p className="text-xs">{matchedUser.email}</p>
                                            </div>
                                        </div>
                                    </div>
                                ) : null;
                            }
                        )}
                    </div>
                </div>
            </div>
            <div className="flex flex-col gap-3 rounded-xl border p-5">
                <h1 className="font-semibold">{t('sections.liveNotificationsTitle')}</h1>
                <div className="flex items-center gap-4">
                    <div className="flex flex-wrap items-center gap-4">
                        {assessmentDetails[3]?.saved_data?.live_assessment_access?.user_ids?.map(
                            (userId) => {
                                const matchedUser = accessControlUsers?.find(
                                    (user: AccessControlUser) => user.id === userId
                                );
                                return matchedUser ? (
                                    <div
                                        key={matchedUser.id}
                                        className="flex items-center justify-between gap-4"
                                    >
                                        <div className="flex items-center gap-4">
                                            {matchedUser.status !== 'INVITED' && (
                                                <RoleTypeUserIcon />
                                            )}
                                            <div className="flex flex-col gap-2">
                                                <div className="flex items-center gap-4">
                                                    <p>{matchedUser.full_name}</p>
                                                    <div className="flex items-start gap-4">
                                                        <div className="flex items-center gap-4">
                                                            {matchedUser.roles.map((role: Role) => {
                                                                return (
                                                                    <Badge
                                                                        key={role.role_id}
                                                                        className={`whitespace-nowrap rounded-lg border border-neutral-300 ${
                                                                            role.role_name ===
                                                                            'ADMIN'
                                                                                ? 'bg-info-50'
                                                                                : role.role_name ===
                                                                                    'CONTENT CREATOR'
                                                                                  ? 'bg-success-50'
                                                                                  : role.role_name ===
                                                                                      'ASSESSMENT CREATOR'
                                                                                    ? 'bg-danger-50'
                                                                                    : 'bg-violet-50'
                                                                        } py-1.5 font-thin shadow-none`}
                                                                    >
                                                                        {getRoleDisplayName(
                                                                            t,
                                                                            role.role_name
                                                                        )}
                                                                    </Badge>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                </div>
                                                <p className="text-xs">{matchedUser.email}</p>
                                            </div>
                                        </div>
                                    </div>
                                ) : null;
                            }
                        )}
                    </div>
                </div>
            </div>
            <div className="flex flex-col gap-3 rounded-xl border p-5">
                <h1 className="font-semibold">{t('sections.submissionReportsTitle')}</h1>
                <div className="flex items-center gap-4">
                    <div className="flex flex-wrap items-center gap-4">
                        {assessmentDetails[3]?.saved_data?.report_and_submission_access?.user_ids?.map(
                            (userId) => {
                                const matchedUser = accessControlUsers?.find(
                                    (user: AccessControlUser) => user.id === userId
                                );
                                return matchedUser ? (
                                    <div
                                        key={matchedUser.id}
                                        className="flex items-center justify-between gap-4"
                                    >
                                        <div className="flex items-center gap-4">
                                            {matchedUser.status !== 'INVITED' && (
                                                <RoleTypeUserIcon />
                                            )}
                                            <div className="flex flex-col gap-2">
                                                <div className="flex items-center gap-4">
                                                    <p>{matchedUser.full_name}</p>
                                                    <div className="flex items-start gap-4">
                                                        <div className="flex items-center gap-4">
                                                            {matchedUser.roles.map((role: Role) => {
                                                                return (
                                                                    <Badge
                                                                        key={role.role_id}
                                                                        className={`whitespace-nowrap rounded-lg border border-neutral-300 ${
                                                                            role.role_name ===
                                                                            'ADMIN'
                                                                                ? 'bg-info-50'
                                                                                : role.role_name ===
                                                                                    'CONTENT CREATOR'
                                                                                  ? 'bg-success-50'
                                                                                  : role.role_name ===
                                                                                      'ASSESSMENT CREATOR'
                                                                                    ? 'bg-danger-50'
                                                                                    : 'bg-violet-50'
                                                                        } py-1.5 font-thin shadow-none`}
                                                                    >
                                                                        {getRoleDisplayName(
                                                                            t,
                                                                            role.role_name
                                                                        )}
                                                                    </Badge>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                </div>
                                                <p className="text-xs">{matchedUser.email}</p>
                                            </div>
                                        </div>
                                    </div>
                                ) : null;
                            }
                        )}
                    </div>
                </div>
            </div>
            <div className="flex flex-col gap-3 rounded-xl border p-5">
                <h1 className="font-semibold">{t('sections.evaluationTitle')}</h1>
                <div className="flex items-center gap-4">
                    <div className="flex flex-wrap items-center gap-4">
                        {assessmentDetails[3]?.saved_data?.evaluation_access?.user_ids?.map(
                            (userId) => {
                                const matchedUser = accessControlUsers?.find(
                                    (user: AccessControlUser) => user.id === userId
                                );
                                return matchedUser ? (
                                    <div
                                        key={matchedUser.id}
                                        className="flex items-center justify-between gap-4"
                                    >
                                        <div className="flex items-center gap-4">
                                            {matchedUser.status !== 'INVITED' && (
                                                <RoleTypeUserIcon />
                                            )}
                                            <div className="flex flex-col gap-2">
                                                <div className="flex items-center gap-4">
                                                    <p>{matchedUser.full_name}</p>
                                                    <div className="flex items-start gap-4">
                                                        <div className="flex items-center gap-4">
                                                            {matchedUser.roles.map((role: Role) => {
                                                                return (
                                                                    <Badge
                                                                        key={role.role_id}
                                                                        className={`whitespace-nowrap rounded-lg border border-neutral-300 ${
                                                                            role.role_name ===
                                                                            'ADMIN'
                                                                                ? 'bg-info-50'
                                                                                : role.role_name ===
                                                                                    'CONTENT CREATOR'
                                                                                  ? 'bg-success-50'
                                                                                  : role.role_name ===
                                                                                      'ASSESSMENT CREATOR'
                                                                                    ? 'bg-danger-50'
                                                                                    : 'bg-violet-50'
                                                                        } py-1.5 font-thin shadow-none`}
                                                                    >
                                                                        {getRoleDisplayName(
                                                                            t,
                                                                            role.role_name
                                                                        )}
                                                                    </Badge>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                </div>
                                                <p className="text-xs">{matchedUser.email}</p>
                                            </div>
                                        </div>
                                    </div>
                                ) : null;
                            }
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default AssessmentAccessControlTab;
