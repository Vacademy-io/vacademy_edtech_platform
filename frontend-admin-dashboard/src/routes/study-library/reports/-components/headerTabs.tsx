import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import BatchReports from './batch/batchReports';
import StudentReports from './student/studentReports';
import LiveClassReports from './live/liveClassReports';
import LeaderboardReports from './leaderboard/LeaderboardReports';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { useSearch } from '@tanstack/react-router';
import { Route } from '@/routes/study-library/reports';
import { fetchInstituteSetting, updateInstituteReportSetting } from '../../reports/-services/utils';
import {
    InstituteSettingResponse,
    RoleSetting,
    RoleSettingEnum,
    CommunicationTypeEnum,
    ReportDurationEnum,
    ReportTypeEnum,
} from '../../reports/-types/types';
import { getInstituteId } from '@/constants/helper';
import { useMutation, useQuery } from '@tanstack/react-query';
import { getBadgesEnabled } from '@/routes/settings/-services/badges-settings';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { toast } from 'sonner';
import { RoleTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';

const reportTypes = [
    ReportDurationEnum.DAILY,
    ReportDurationEnum.WEEKLY,
    ReportDurationEnum.MONTHLY,
] as const;

export default function HeaderTabs() {
    const { t } = useTranslation('studyLibraryReportsHeaderTabs');
    const search = useSearch({ from: Route.id });

    const [selectedTab, setSelectedTab] = useState(
        search.studentReport ? search.studentReport.tab : 'BATCH'
    );
    const [settingDialogState, setSettingDialogState] = useState(false);
    const [settingDetails, setSettingDetails] = useState<InstituteSettingResponse>();

    // Leaderboard tab is gated on the badges + leaderboard master toggle.
    const { data: badgesEnabled } = useQuery({
        queryKey: ['badges-enabled'],
        queryFn: getBadgesEnabled,
        staleTime: 5 * 60 * 1000,
    });
    // Default OFF: only show once the toggle is confirmed enabled (avoids a flicker
    // for disabled institutes while the query resolves).
    const showLeaderboard = badgesEnabled === true;

    useEffect(() => {
        if (!showLeaderboard && selectedTab === 'LEADERBOARD') setSelectedTab('BATCH');
    }, [showLeaderboard, selectedTab]);

    const settingsMutation = useMutation({ mutationFn: fetchInstituteSetting });
    const { isPending } = settingsMutation;
    const updateSettingsMutation = useMutation({ mutationFn: updateInstituteReportSetting });

    const handleTabChange = (value: string) => {
        setSelectedTab(value);
    };

    const isCommTypeEnabled = (
        setting: RoleSetting | undefined,
        type: CommunicationTypeEnum.EMAIL | CommunicationTypeEnum.WHATSAPP
    ) => {
        if (!setting) return false;
        else return setting.comma_separated_communication_types?.split(',').includes(type);
    };

    const toggleCommType = (
        role: RoleSettingEnum.LEARNER | RoleSettingEnum.PARENT,
        type: CommunicationTypeEnum.EMAIL | CommunicationTypeEnum.WHATSAPP,
        checked: boolean
    ) => {
        setSettingDetails((prev) => {
            if (!prev) return prev;
            const updated = { ...prev };
            const setting = updated[role];

            let commTypes = setting.comma_separated_communication_types?.split(',') || [];

            if (checked) {
                if (!commTypes.includes(type)) commTypes.push(type);
            } else {
                commTypes = commTypes.filter((t) => t !== type);
            }

            setting.comma_separated_communication_types = commTypes.join(',');
            return updated;
        });
    };

    const toggleReportSetting = (
        role: RoleSettingEnum.LEARNER | RoleSettingEnum.PARENT,
        reportType: ReportTypeEnum.LEARNER_PROGRESS | ReportTypeEnum.BATCH_PROGRESS,
        duration: ReportDurationEnum,
        value: boolean
    ) => {
        const currentSetting = settingDetails?.[role];
        if (!currentSetting) return;

        const updatedSetting = {
            ...currentSetting,
            [reportType]: {
                ...currentSetting[reportType],
                [duration]: value,
            },
        };

        setSettingDetails({
            ...settingDetails,
            [role]: updatedSetting,
        });
    };

    const renderProgressReportSection = (
        roleKey: RoleSettingEnum.LEARNER | RoleSettingEnum.PARENT,
        settingKey: ReportTypeEnum.LEARNER_PROGRESS | ReportTypeEnum.BATCH_PROGRESS,
        title: string
    ) => (
        <div className="flex flex-col items-start gap-4">
            <div className="text-subtitle font-[600]">{title}</div>
            <div className="flex flex-col gap-4 sm:flex-row sm:gap-6">
                {reportTypes.map((type) => (
                    <div key={type} className="flex flex-row items-center gap-2">
                        <Checkbox
                            checked={!!settingDetails?.[roleKey]?.[settingKey]?.[type]}
                            onCheckedChange={(checked) =>
                                toggleReportSetting(roleKey, settingKey, type, !!checked)
                            }
                        />
                        <div className="text-body">{t('generateTypeReports', { type })}</div>
                    </div>
                ))}
            </div>
        </div>
    );

    const handleSave = () => {
        if (!settingDetails) return;

        console.log('Saving updated settings:', settingDetails);

        updateSettingsMutation.mutate(settingDetails, {
            onSuccess: () => toast.success(t('toast.settingsUpdated')),
            onError: () => toast.error(t('toast.updateFailed')),
        });
    };

    useEffect(() => {
        if (settingDialogState) {
            // Same institute the save writes to (current, not the token's first).
            const INSTITUTE_ID = getInstituteId();

            settingsMutation.mutate(INSTITUTE_ID || '', {
                onSuccess: (data) => {
                    console.log(data);
                    setSettingDetails(data);
                },
                onError: (error) => {
                    console.error('Error:', error);
                },
            });
        }
    }, [settingDialogState]);

    return (
        <div>
            <Tabs value={selectedTab} onValueChange={handleTabChange}>
                <div className="flex flex-col gap-4 sm:flex-row sm:justify-between">
                    <TabsList className="inline-flex h-auto w-full justify-start overflow-x-auto rounded-none border-b !bg-transparent p-0 sm:w-auto sm:overflow-visible">
                        <TabsTrigger
                            value="BATCH"
                            className={`flex min-w-fit gap-1.5 rounded-none px-6 py-2 !shadow-none sm:px-12 ${selectedTab === 'BATCH'
                                    ? 'border-4px rounded-t-sm border !border-b-0 border-primary-200 !bg-primary-50'
                                    : 'border-none bg-transparent'
                                }`}
                        >
                            {t('tabs.batch')}
                        </TabsTrigger>
                        <TabsTrigger
                            value="STUDENT"
                            className={`flex min-w-fit gap-1.5 rounded-none px-6 py-2 !shadow-none sm:px-12 ${selectedTab === 'STUDENT'
                                    ? 'border-4px rounded-t-sm border !border-b-0 border-primary-200 !bg-primary-50'
                                    : 'border-none bg-transparent'
                                }`}
                        >
                            {getTerminology(RoleTerms.Learner, SystemTerms.Learner)}
                        </TabsTrigger>
                        <TabsTrigger
                            value="LIVE"
                            className={`flex min-w-fit gap-1.5 rounded-none px-6 py-2 !shadow-none sm:px-12 ${selectedTab === 'LIVE'
                                    ? 'border-4px rounded-t-sm border !border-b-0 border-primary-200 !bg-primary-50'
                                    : 'border-none bg-transparent'
                                }`}
                        >
                            {t('tabs.liveClasses')}
                        </TabsTrigger>
                        {showLeaderboard && (
                            <TabsTrigger
                                value="LEADERBOARD"
                                className={`flex min-w-fit gap-1.5 rounded-none px-6 py-2 !shadow-none sm:px-12 ${selectedTab === 'LEADERBOARD'
                                        ? 'border-4px rounded-t-sm border !border-b-0 border-primary-200 !bg-primary-50'
                                        : 'border-none bg-transparent'
                                    }`}
                            >
                                {t('tabs.leaderboard')}
                            </TabsTrigger>
                        )}
                    </TabsList>
                    <div className="w-full sm:w-auto">
                        <MyButton
                            onClick={() => {
                                setSettingDialogState(!settingDialogState);
                            }}
                            buttonType="secondary"
                            className="w-full sm:w-auto"
                        >
                            {t('reportSettings')}
                        </MyButton>
                    </div>
                </div>
                <TabsContent value="BATCH">
                    <BatchReports></BatchReports>
                </TabsContent>
                <TabsContent value="STUDENT">
                    <StudentReports></StudentReports>
                </TabsContent>
                <TabsContent value="LIVE">
                    <LiveClassReports></LiveClassReports>
                </TabsContent>
                {showLeaderboard && (
                    <TabsContent value="LEADERBOARD">
                        <LeaderboardReports></LeaderboardReports>
                    </TabsContent>
                )}
            </Tabs>
            <MyDialog
                heading={t('reportsSettingsHeading')}
                open={settingDialogState}
                onOpenChange={setSettingDialogState}
                dialogWidth="w-full max-w-[800px]"
            >
                {isPending && <DashboardLoader />}
                {!isPending && (
                    <div className="flex flex-col gap-10">
                        <div className="flex h-[350px] flex-col gap-10 overflow-y-scroll pr-2">
                            <div className="flex flex-col gap-10">
                                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
                                    <Checkbox
                                        checked={isCommTypeEnabled(
                                            settingDetails?.learner_setting,
                                            CommunicationTypeEnum.EMAIL
                                        )}
                                        onCheckedChange={(checked) =>
                                            toggleCommType(
                                                RoleSettingEnum.LEARNER,
                                                CommunicationTypeEnum.EMAIL,
                                                !!checked
                                            )
                                        }
                                    />
                                    <div className="text-subtitle font-[600]">
                                        {t('sendReportsToStudentViaMail')}
                                    </div>
                                </div>
                                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
                                    <Checkbox
                                        checked={isCommTypeEnabled(
                                            settingDetails?.learner_setting,
                                            CommunicationTypeEnum.WHATSAPP
                                        )}
                                        onCheckedChange={(checked) =>
                                            toggleCommType(
                                                RoleSettingEnum.LEARNER,
                                                CommunicationTypeEnum.WHATSAPP,
                                                !!checked
                                            )
                                        }
                                    />
                                    <div className="text-subtitle font-[600]">
                                        {t('sendReportsToStudentViaWhatsapp')}
                                    </div>
                                </div>
                                {renderProgressReportSection(
                                    RoleSettingEnum.LEARNER,
                                    ReportTypeEnum.LEARNER_PROGRESS,
                                    t('studentLearningProgressReport')
                                )}
                                {renderProgressReportSection(
                                    RoleSettingEnum.LEARNER,
                                    ReportTypeEnum.BATCH_PROGRESS,
                                    t('batchLearningProgressReport')
                                )}
                            </div>
                            <div className="border"></div>
                            <div className="flex flex-col gap-10">
                                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
                                    <Checkbox
                                        checked={isCommTypeEnabled(
                                            settingDetails?.parent_setting,
                                            CommunicationTypeEnum.EMAIL
                                        )}
                                        onCheckedChange={(checked) =>
                                            toggleCommType(
                                                RoleSettingEnum.PARENT,
                                                CommunicationTypeEnum.EMAIL,
                                                !!checked
                                            )
                                        }
                                    />
                                    <div className="text-subtitle font-[600]">
                                        {t('sendReportsToParentViaMail')}
                                    </div>
                                </div>
                                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
                                    <Checkbox
                                        checked={isCommTypeEnabled(
                                            settingDetails?.parent_setting,
                                            CommunicationTypeEnum.WHATSAPP
                                        )}
                                        onCheckedChange={(checked) =>
                                            toggleCommType(
                                                RoleSettingEnum.PARENT,
                                                CommunicationTypeEnum.WHATSAPP,
                                                !!checked
                                            )
                                        }
                                    />
                                    <div className="text-subtitle font-[600]">
                                        {t('sendReportsToParentViaWhatsapp')}
                                    </div>
                                </div>
                                {renderProgressReportSection(
                                    RoleSettingEnum.PARENT,
                                    ReportTypeEnum.LEARNER_PROGRESS,
                                    t('studentLearningProgressReport')
                                )}
                                {renderProgressReportSection(
                                    RoleSettingEnum.PARENT,
                                    ReportTypeEnum.BATCH_PROGRESS,
                                    t('batchLearningProgressReport')
                                )}
                            </div>
                        </div>
                        <div className="flex w-full items-center justify-center">
                            <MyButton onClick={handleSave} className="w-full sm:w-auto">
                                {t('saveChanges')}
                            </MyButton>
                        </div>
                    </div>
                )}
            </MyDialog>
        </div>
    );
}
