import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { getInstituteId } from '@/constants/helper';
import { isAdminForInstitute } from '@/lib/auth/roleUtils';
import { AddPanelDialog } from './AddPanelDialog';
import { PanelsCard } from './PanelsCard';
import { RoomsCard } from './RoomsCard';
import { useRefreshPanels, useRoomsQuery } from './api';
import type { TabAvailability } from './featureProbe';
import { AlertsTab } from './alerts/AlertsTab';
import { useAlertsAvailability } from './alerts/probe';
import { InstallersTab } from './installers/InstallersTab';
import { useInstallersAvailability } from './installers/probe';
import { LicenceTab } from './licence/LicenceTab';
import { useLicenceAvailability } from './licence/probe';
import { UsageTab } from './usage/UsageTab';
import { useUsageAvailability } from './usage/probe';

/**
 * Settings: Classroom Panels. Institute admins manage the rooms of the institute and the panels
 * paired to them. The server checks the same role on every call.
 *
 * Phase 2 sections (Usage, Licences, Installers, Alerts) are tabs, each shown only when its
 * endpoint answers: a switched-off feature (FEATURE_OFF) keeps its tab out. With every feature
 * off there is no tab list at all and the screen is the phase 1 one.
 */
export default function ClassroomPanelsSettings() {
    const { t } = useTranslation('settingsClassroomPanels');
    const instituteId = getInstituteId();

    if (!instituteId || !isAdminForInstitute(instituteId)) {
        return (
            <Alert role="status">
                <AlertDescription>{t('notAdmin')}</AlertDescription>
            </Alert>
        );
    }
    return <ClassroomPanelsTabs instituteId={instituteId} />;
}

export type ClassroomPanelsTab = 'panels' | 'usage' | 'licence' | 'installers' | 'alerts';

const PHASE2_TABS: readonly Exclude<ClassroomPanelsTab, 'panels'>[] = [
    'usage',
    'licence',
    'installers',
    'alerts',
];

const TAB_LABEL_KEYS = {
    usage: 'tabs.usage',
    licence: 'tabs.licence',
    installers: 'tabs.installers',
    alerts: 'tabs.alerts',
} as const;

/** ?view=usage (the weekly email links there) opens that tab once it is available. */
function requestedTab(): ClassroomPanelsTab {
    try {
        const view = new URLSearchParams(window.location.search).get('view');
        return (PHASE2_TABS as readonly string[]).includes(view ?? '')
            ? (view as ClassroomPanelsTab)
            : 'panels';
    } catch {
        return 'panels';
    }
}

function ClassroomPanelsTabs({ instituteId }: { instituteId: string }) {
    const { t } = useTranslation('settingsClassroomPanels');
    const availability: Record<Exclude<ClassroomPanelsTab, 'panels'>, TabAvailability> = {
        usage: useUsageAvailability(instituteId),
        licence: useLicenceAvailability(instituteId),
        installers: useInstallersAvailability(instituteId),
        alerts: useAlertsAvailability(instituteId),
    };
    const shown = PHASE2_TABS.filter((tab) => availability[tab] === 'on');
    const [chosen, setChosen] = useState<ClassroomPanelsTab>(requestedTab);
    const active: ClassroomPanelsTab =
        chosen === 'panels' || shown.includes(chosen) ? chosen : 'panels';

    // One tree whatever the probes say, so the console below never remounts (an open
    // dialog would close) when a tab appears.
    return (
        <Tabs
            value={active}
            onValueChange={(value) => setChosen(value as ClassroomPanelsTab)}
            className="flex flex-col gap-4"
        >
            {shown.length > 0 && (
                <TabsList
                    aria-label={t('tabs.label')}
                    className="w-full justify-start overflow-x-auto sm:w-fit"
                >
                    <TabsTrigger value="panels">{t('tabs.panels')}</TabsTrigger>
                    {shown.map((tab) => (
                        <TabsTrigger key={tab} value={tab}>
                            {t(TAB_LABEL_KEYS[tab])}
                        </TabsTrigger>
                    ))}
                </TabsList>
            )}
            <TabsContent value="panels" className="mt-0">
                <ClassroomPanelsConsole instituteId={instituteId} />
            </TabsContent>
            {shown.includes('usage') && (
                <TabsContent value="usage">
                    <UsageTab instituteId={instituteId} />
                </TabsContent>
            )}
            {shown.includes('licence') && (
                <TabsContent value="licence">
                    <LicenceTab instituteId={instituteId} />
                </TabsContent>
            )}
            {shown.includes('installers') && (
                <TabsContent value="installers">
                    <InstallersTab instituteId={instituteId} />
                </TabsContent>
            )}
            {shown.includes('alerts') && (
                <TabsContent value="alerts">
                    <AlertsTab instituteId={instituteId} />
                </TabsContent>
            )}
        </Tabs>
    );
}

function ClassroomPanelsConsole({ instituteId }: { instituteId: string }) {
    const rooms = useRoomsQuery(instituteId);
    const refresh = useRefreshPanels(instituteId);

    const [adding, setAdding] = useState(false);
    const [startRoomId, setStartRoomId] = useState<string | null>(null);

    const openFromPanels = useCallback(() => {
        setStartRoomId(rooms.data?.next_unpaired_room_id ?? null);
        setAdding(true);
    }, [rooms.data]);
    const openFromRoom = useCallback((roomId: string) => {
        setStartRoomId(roomId);
        setAdding(true);
    }, []);

    return (
        <div className="flex flex-col gap-6">
            <PanelsCard
                instituteId={instituteId}
                rooms={rooms.data?.rooms ?? []}
                roomsLoading={rooms.isPending}
                onAddPanel={openFromPanels}
            />
            <RoomsCard instituteId={instituteId} rooms={rooms} onAddPanel={openFromRoom} />
            <AddPanelDialog
                open={adding}
                instituteId={instituteId}
                rooms={rooms.data?.rooms ?? []}
                initialRoomId={startRoomId}
                onClose={() => setAdding(false)}
                onPaired={refresh}
            />
        </div>
    );
}
