import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { MyButton } from '@/components/design-system/button';
import { Badge } from '@/components/ui/badge';
import { Plus, Users, UserPlus } from '@phosphor-icons/react';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { ContentTerms, RoleTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import {
    getTerminology,
    getTerminologyPlural,
} from '@/components/common/layout-container/sidebar/utils';

interface EnrollLearnersWidgetProps {
    batchCount?: number;
    learnerCount?: number;
}

export default function EnrollLearnersWidget({
    batchCount = 0,
    learnerCount = 0,
}: EnrollLearnersWidgetProps) {
    const navigate = useNavigate();
    const { t } = useTranslation('dashboardEnrollLearnersWidget');

    const handleInviteStudents = () => {
        navigate({ to: '/manage-students/invite' });
    };

    const handleManageStudents = () => {
        navigate({ to: '/manage-students/students-list' });
    };

    const handleEnrollRequests = () => {
        navigate({ to: '/manage-students/enroll-requests' });
    };

    return (
        <Card className="flex h-full grow flex-col bg-neutral-50 shadow-none">
            <CardHeader className="p-4">
                <div className="flex flex-col items-start justify-between gap-y-2">
                    <div className="flex items-center gap-2">
                        <UserPlus size={18} className="text-primary-500" weight="duotone" />
                        <div>
                            <CardTitle className="text-sm font-semibold">
                                {t('header.title', {
                                    term: getTerminologyPlural(RoleTerms.Learner, SystemTerms.Learner),
                                })}
                            </CardTitle>
                            <CardDescription className="mt-1 text-xs text-neutral-600">
                                {t('header.description', {
                                    term: getTerminology(
                                        RoleTerms.Learner,
                                        SystemTerms.Learner
                                    ).toLocaleLowerCase(),
                                })}
                            </CardDescription>
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <Badge variant="secondary" className="text-xs">
                            {t('badges.learnerCount', {
                                count: learnerCount,
                                term: getTerminologyPlural(RoleTerms.Learner, SystemTerms.Learner),
                            })}
                        </Badge>
                        <Badge variant="secondary" className="text-xs">
                            {t('badges.batchCount', {
                                count: batchCount,
                                term: getTerminologyPlural(ContentTerms.Batch, SystemTerms.Batch),
                            })}
                        </Badge>
                    </div>
                </div>
            </CardHeader>
            <div className="flex-1 space-y-3 px-4 pb-4">
                <div className="grid grid-cols-1 gap-3">
                    <MyButton
                        type="button"
                        scale="medium"
                        buttonType="primary"
                        layoutVariant="default"
                        className="w-full justify-start gap-2 text-sm"
                        onClick={handleInviteStudents}
                    >
                        <Plus size={16} />
                        {t('actions.inviteNew', {
                            term: getTerminologyPlural(RoleTerms.Learner, SystemTerms.Learner),
                        })}
                    </MyButton>

                    <MyButton
                        type="button"
                        scale="medium"
                        buttonType="secondary"
                        layoutVariant="default"
                        className="w-full justify-start gap-2 text-sm"
                        onClick={handleManageStudents}
                    >
                        <Users size={16} />
                        {t('actions.manageList', {
                            term: getTerminologyPlural(RoleTerms.Learner, SystemTerms.Learner),
                        })}
                    </MyButton>

                    <MyButton
                        type="button"
                        scale="medium"
                        buttonType="secondary"
                        layoutVariant="default"
                        className="w-full justify-start gap-2 text-sm"
                        onClick={handleEnrollRequests}
                    >
                        <UserPlus size={16} />
                        {t('actions.enrollmentRequests')}
                    </MyButton>
                </div>
            </div>
        </Card>
    );
}
