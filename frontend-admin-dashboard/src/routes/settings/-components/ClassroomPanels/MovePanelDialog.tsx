import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import type { ClassroomRoom, PanelDeviceRow } from '@/classroom-shared/apiTypes';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { SearchableSelect } from '@/components/design-system/searchable-select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
    Form,
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from '@/components/ui/form';
import { panelErrorMessage, patchDevice } from './api';

export function MovePanelDialog({
    device,
    rooms,
    onClose,
    onMoved,
}: {
    device: PanelDeviceRow | null;
    rooms: ClassroomRoom[];
    onClose: () => void;
    onMoved: (roomName: string) => void | Promise<unknown>;
}) {
    const { t } = useTranslation('settingsClassroomPanels');
    return (
        <MyDialog
            open={!!device}
            onOpenChange={(next) => {
                if (!next) onClose();
            }}
            heading={t('move.title', { room: device?.room.name ?? '' })}
            dialogWidth="max-w-md"
        >
            {device && (
                <MoveForm device={device} rooms={rooms} onClose={onClose} onMoved={onMoved} />
            )}
        </MyDialog>
    );
}

function MoveForm({
    device,
    rooms,
    onClose,
    onMoved,
}: {
    device: PanelDeviceRow;
    rooms: ClassroomRoom[];
    onClose: () => void;
    onMoved: (roomName: string) => void | Promise<unknown>;
}) {
    const { t } = useTranslation('settingsClassroomPanels');
    const freeRooms = useMemo(
        () => rooms.filter((room) => room.status === 'ACTIVE' && !room.device_id),
        [rooms]
    );
    const schema = useMemo(
        () => z.object({ room_id: z.string().min(1, t('move.roomRequired')) }),
        [t]
    );
    const form = useForm<z.infer<typeof schema>>({
        resolver: zodResolver(schema),
        defaultValues: { room_id: '' },
    });
    const [failure, setFailure] = useState<string | null>(null);

    const submit = form.handleSubmit(async ({ room_id }) => {
        setFailure(null);
        try {
            await patchDevice(device.id, { room_id });
            await onMoved(freeRooms.find((room) => room.id === room_id)?.name ?? '');
            onClose();
        } catch (error) {
            setFailure(panelErrorMessage(t, error));
        }
    });

    return (
        <Form {...form}>
            <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
                {freeRooms.length === 0 ? (
                    <p className="text-body text-neutral-600">{t('move.noFreeRooms')}</p>
                ) : (
                    <FormField
                        control={form.control}
                        name="room_id"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>{t('move.roomLabel')}</FormLabel>
                                <FormControl>
                                    <SearchableSelect
                                        options={freeRooms.map((room) => ({
                                            value: room.id,
                                            label: room.name,
                                        }))}
                                        value={field.value}
                                        onChange={field.onChange}
                                        placeholder={t('move.roomPlaceholder')}
                                        searchPlaceholder={t('common.searchRooms')}
                                        emptyText={t('common.noRoomMatch')}
                                        portal={false}
                                    />
                                </FormControl>
                                <FormDescription>{t('move.help')}</FormDescription>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                )}
                {failure && (
                    <Alert variant="destructive" role="alert">
                        <AlertDescription>{failure}</AlertDescription>
                    </Alert>
                )}
                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                    <MyButton type="button" buttonType="secondary" onClick={onClose}>
                        {t('common.cancel')}
                    </MyButton>
                    <MyButton
                        type="submit"
                        disable={form.formState.isSubmitting || freeRooms.length === 0}
                    >
                        {form.formState.isSubmitting ? t('common.working') : t('move.submit')}
                    </MyButton>
                </div>
            </form>
        </Form>
    );
}
