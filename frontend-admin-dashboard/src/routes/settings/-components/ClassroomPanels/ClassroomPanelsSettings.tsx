import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { getInstituteId } from '@/constants/helper';
import { isAdminForInstitute } from '@/lib/auth/roleUtils';
import { AddPanelDialog } from './AddPanelDialog';
import { PanelsCard } from './PanelsCard';
import { RoomsCard } from './RoomsCard';
import { useRefreshPanels, useRoomsQuery } from './api';

/**
 * Settings: Classroom Panels. Institute admins manage the rooms of the institute and the panels
 * paired to them. The server checks the same role on every call.
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
    return <ClassroomPanelsConsole instituteId={instituteId} />;
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
