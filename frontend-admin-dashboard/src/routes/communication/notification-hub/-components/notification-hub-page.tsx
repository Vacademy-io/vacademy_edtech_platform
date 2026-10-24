import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ChatCircle, EnvelopeSimple, ChartLine, Tray, type Icon } from '@phosphor-icons/react';
import { OverviewTab } from './overview/overview-tab';
import { InboxPage } from '../../inbox/-components/inbox-page';
import { EmailInboxPanel } from './email-inbox/email-inbox-panel';

type HubTab = 'overview' | 'whatsapp' | 'email';

export function NotificationHubPage() {
    const { t } = useTranslation('communicationNotificationHubPage');
    const [activeTab, setActiveTab] = useState<HubTab>('overview');

    // Built every render (not memoised) so the labels follow a language switch.
    const tabs: { value: HubTab; label: string; icon: Icon }[] = [
        { value: 'overview', label: t('tabs.overview'), icon: ChartLine },
        { value: 'whatsapp', label: t('tabs.whatsapp'), icon: ChatCircle },
        { value: 'email', label: t('tabs.email'), icon: EnvelopeSimple },
    ];

    return (
        <div className="flex h-full flex-col bg-neutral-50">
            {/* Header */}
            <div className="shrink-0 border-b border-neutral-200 bg-white px-4 pt-4 sm:px-6">
                <div className="flex min-w-0 items-start gap-3">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-500">
                        <Tray size={20} weight="duotone" />
                    </span>
                    <div className="min-w-0">
                        <h1 className="font-semibold text-neutral-900">
                            <span className="text-h3">{t('title')}</span>
                        </h1>
                        <p className="text-neutral-500">
                            <span className="text-caption">{t('subtitle')}</span>
                        </p>
                    </div>
                </div>
            </div>

            {/* Tabs */}
            <Tabs
                value={activeTab}
                onValueChange={(v) => setActiveTab(v as HubTab)}
                className="flex min-h-0 flex-1 flex-col"
            >
                <div className="shrink-0 overflow-x-auto border-b border-neutral-200 bg-white px-4 sm:px-6">
                    <TabsList className="h-auto w-max gap-1 rounded-none bg-transparent p-0">
                        {tabs.map((tab) => (
                            <TabsTrigger
                                key={tab.value}
                                value={tab.value}
                                className="-mb-px gap-2 rounded-none border-b-2 border-transparent px-3 py-2.5 text-neutral-500 hover:text-neutral-700 data-[state=active]:border-primary-500 data-[state=active]:bg-transparent data-[state=active]:text-primary-600 data-[state=active]:shadow-none"
                            >
                                <tab.icon size={16} /> {tab.label}
                            </TabsTrigger>
                        ))}
                    </TabsList>
                </div>

                <TabsContent value="overview" className="m-0 min-h-0 flex-1 overflow-y-auto">
                    <OverviewTab />
                </TabsContent>

                <TabsContent
                    value="whatsapp"
                    className="m-0 min-h-0 flex-1 overflow-hidden bg-white"
                >
                    <InboxPage />
                </TabsContent>

                <TabsContent value="email" className="m-0 min-h-0 flex-1 overflow-hidden">
                    <EmailInboxPanel />
                </TabsContent>
            </Tabs>
        </div>
    );
}
