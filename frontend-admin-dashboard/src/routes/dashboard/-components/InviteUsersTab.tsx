import { Badge } from '@/components/ui/badge';
import { TabsContent } from '@/components/ui/tabs';
import { RoleTypeEmptyScreen } from '@/svgs';
import InviteUsersOptions from './InviteUsersOptions';
import { RolesDummyDataType, UserRolesDataEntry } from '@/types/dashboard/user-roles';
import { mapRoleToCustomName } from '@/utils/roleUtils';
import { useTranslation } from 'react-i18next';

interface InviteUsersTabProps {
    selectedTab: keyof RolesDummyDataType;
    selectedTabData: UserRolesDataEntry[];
    refetchData: () => void;
}

const InviteUsersTab: React.FC<InviteUsersTabProps> = ({
    selectedTab,
    selectedTabData,
    refetchData,
}) => {
    const { t } = useTranslation('dashboardInviteUsersTab');
    return (
        <>
            {selectedTab === 'invites' && selectedTabData.length === 0 ? (
                <div className="flex h-[60vh] w-screen flex-col items-center justify-center">{/* design-lint-ignore: viewport-relative empty-state height, no fixed-height token fits a full-page empty state */}
                    <RoleTypeEmptyScreen />
                    <p>{t('emptyState.message')}</p>
                </div>
            ) : (
                <TabsContent key="invites" value="invites" className="mt-6 flex flex-col gap-6">
                    {selectedTabData?.map((item, idx) => {
                        return (
                            <div key={idx} className="flex justify-between">
                                <div className="flex items-center gap-4">
                                    <div className="flex flex-col gap-1">
                                        <div className="flex items-center gap-4">
                                            <p>{item.full_name}</p>
                                            {item.roles?.map((role, index) => {
                                                const customRoleName = mapRoleToCustomName(
                                                    role.role_name
                                                );
                                                return (
                                                    <Badge
                                                        key={index}
                                                        className={`whitespace-nowrap rounded-lg border border-neutral-300 py-1.5 font-thin shadow-none ${
                                                            role.role_name === 'ADMIN'
                                                                ? 'bg-info-50'
                                                                : role.role_name ===
                                                                    'CONTENT CREATOR'
                                                                  ? 'bg-success-50'
                                                                  : role.role_name ===
                                                                      'ASSESSMENT CREATOR'
                                                                    ? 'bg-danger-50'
                                                                    : 'bg-violet-50'
                                                        }`}
                                                    >
                                                        {customRoleName}
                                                    </Badge>
                                                );
                                            })}
                                        </div>
                                        <p className="text-sm">{item.email}</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-4">
                                    <InviteUsersOptions user={item} refetchData={refetchData} />
                                </div>
                            </div>
                        );
                    })}
                </TabsContent>
            )}
        </>
    );
};

export default InviteUsersTab;
