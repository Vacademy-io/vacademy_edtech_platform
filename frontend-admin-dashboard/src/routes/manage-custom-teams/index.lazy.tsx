import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createLazyFileRoute } from '@tanstack/react-router';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { Helmet } from 'react-helmet';
import { cn } from '@/lib/utils';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SubOrgList } from './sub-orgs/-components/sub-org-list';
import { RegistrationLinksTab } from './sub-orgs/-components/registration-links-tab';
import { getTerminologyPlural } from '@/components/common/layout-container/sidebar/utils';
import { OtherTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { SubOrgModuleGate } from './-components/sub-org-module-gate';
import { isSubOrgAssignmentScoped } from '@/lib/display-settings/sub-org-module';
import { Buildings, LinkSimple, Monitor } from '@phosphor-icons/react';
import { ScreenHeader } from '@/components/shared/crm-enhance/screen-header';
import { SubOrgSummaryCards } from './sub-orgs/-components/sub-org-summary-cards';

export const Route = createLazyFileRoute('/manage-custom-teams/')({
    component: ManageCustomTeams,
});

function ManageCustomTeams() {
    const { t } = useTranslation('manageCustomTeamsIndex');
    const [selectedTab, setSelectedTab] = useState<string>('subOrgs');

    const subOrgTermPlural = getTerminologyPlural(OtherTerms.SubOrg, SystemTerms.SubOrg);

    // Registration Links are institute-wide — the templates and the registrations
    // they collect belong to the parent institute, not to any one channel partner,
    // so there is nothing to scope them by. Assignment-scoped users (a custom /
    // teacher role granted this module) get the list tab only.
    const assignmentScoped = isSubOrgAssignmentScoped();

    const TABS = [
        { value: 'subOrgs', label: subOrgTermPlural, icon: Monitor },
        ...(assignmentScoped
            ? []
            : [
                  {
                      value: 'registrationLinks',
                      label: t('tabs.registrationLinks'),
                      icon: LinkSimple,
                  },
              ]),
    ];

    return (
        <LayoutContainer>
            <Helmet>
                <title>{t('helmetTitle', { termPlural: subOrgTermPlural })}</title>
            </Helmet>
            <div className="p-5">
                {/* Title and the headline figures share one row: the cards are page
                    furniture, and stacking them full-width below pushed the table itself
                    below the fold on a laptop. */}
                <ScreenHeader
                    className="mb-5"
                    icon={Buildings}
                    title={t('heading', { termPlural: subOrgTermPlural })}
                    subtitle={t('subtitle', { termPlural: subOrgTermPlural })}
                    actions={<SubOrgSummaryCards />}
                />

                <SubOrgModuleGate>
                    <Tabs value={selectedTab} onValueChange={setSelectedTab}>
                        <TabsList className="mb-4 inline-flex h-auto w-full justify-start gap-2 rounded-none border-b !bg-transparent p-0">
                            {TABS.map((tab) => (
                                <TabsTrigger
                                    key={tab.value}
                                    value={tab.value}
                                    className={cn(
                                        'flex gap-1.5 rounded-t-md px-10 py-2.5 !shadow-none',
                                        selectedTab === tab.value
                                            ? '!bg-primary-500 !text-white'
                                            : 'border-none bg-transparent text-neutral-600'
                                    )}
                                >
                                    <span className="flex items-center gap-1.5">
                                        <tab.icon className="size-4" aria-hidden="true" />
                                        {tab.label}
                                    </span>
                                </TabsTrigger>
                            ))}
                        </TabsList>
                        <TabsContent value="subOrgs">
                            <SubOrgList />
                        </TabsContent>
                        {!assignmentScoped && (
                            <TabsContent value="registrationLinks">
                                <RegistrationLinksTab />
                            </TabsContent>
                        )}
                    </Tabs>
                </SubOrgModuleGate>
            </div>
        </LayoutContainer>
    );
}
