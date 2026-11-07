import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import type { RoomBulkCreateResponse } from '@/classroom-shared/apiTypes';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Textarea } from '@/components/ui/textarea';
import {
    Form,
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from '@/components/ui/form';
import {
    BULK_ROOM_MAX,
    ROOM_NAME_MAX,
    createRoom,
    createRoomsBulk,
    panelApiError,
    panelErrorMessage,
    parseRoomList,
    patchRoom,
} from './api';

/** Add a room, or rename one when `room` is given. */
export function RoomNameDialog({
    open,
    instituteId,
    room,
    onClose,
    onSaved,
}: {
    open: boolean;
    instituteId: string;
    room: { id: string; name: string } | null;
    onClose: () => void;
    onSaved: () => void | Promise<unknown>;
}) {
    const { t } = useTranslation('settingsClassroomPanels');
    return (
        <MyDialog
            open={open}
            onOpenChange={(next) => {
                if (!next) onClose();
            }}
            heading={room ? t('rooms.rename.title') : t('rooms.add.title')}
            dialogWidth="max-w-md"
        >
            {open && (
                <RoomNameForm
                    instituteId={instituteId}
                    room={room}
                    onClose={onClose}
                    onSaved={onSaved}
                />
            )}
        </MyDialog>
    );
}

function RoomNameForm({
    instituteId,
    room,
    onClose,
    onSaved,
}: {
    instituteId: string;
    room: { id: string; name: string } | null;
    onClose: () => void;
    onSaved: () => void | Promise<unknown>;
}) {
    const { t } = useTranslation('settingsClassroomPanels');
    const schema = useMemo(
        () =>
            z.object({
                name: z
                    .string()
                    .trim()
                    .min(1, t('rooms.name.required'))
                    .max(ROOM_NAME_MAX, t('rooms.name.tooLong', { max: ROOM_NAME_MAX })),
            }),
        [t]
    );
    const form = useForm<z.infer<typeof schema>>({
        resolver: zodResolver(schema),
        defaultValues: { name: room?.name ?? '' },
    });
    const [failure, setFailure] = useState<string | null>(null);

    const submit = form.handleSubmit(async ({ name }) => {
        setFailure(null);
        try {
            if (room) await patchRoom(room.id, { name });
            else await createRoom(instituteId, name);
            await onSaved();
            onClose();
        } catch (error) {
            if (panelApiError(error)?.code === 'ROOM_NAME_TAKEN') {
                form.setError('name', { message: panelErrorMessage(t, error) });
            } else {
                setFailure(panelErrorMessage(t, error));
            }
        }
    });

    return (
        <Form {...form}>
            <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
                <FormField
                    control={form.control}
                    name="name"
                    render={({ field: { value, onChange, ...field } }) => (
                        <FormItem>
                            <FormLabel>{t('rooms.name.label')}</FormLabel>
                            <FormControl>
                                <MyInput
                                    {...field}
                                    inputType="text"
                                    inputPlaceholder={t('rooms.name.placeholder')}
                                    input={value}
                                    onChangeFunction={onChange}
                                    size="large"
                                    className="sm:w-full"
                                    autoFocus
                                />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />
                {failure && (
                    <Alert variant="destructive" role="alert">
                        <AlertDescription>{failure}</AlertDescription>
                    </Alert>
                )}
                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                    <MyButton type="button" buttonType="secondary" onClick={onClose}>
                        {t('common.cancel')}
                    </MyButton>
                    <MyButton type="submit" disable={form.formState.isSubmitting}>
                        {form.formState.isSubmitting ? t('common.working') : t('common.save')}
                    </MyButton>
                </div>
            </form>
        </Form>
    );
}

export function PasteRoomsDialog({
    open,
    instituteId,
    onClose,
    onSaved,
}: {
    open: boolean;
    instituteId: string;
    onClose: () => void;
    onSaved: () => void | Promise<unknown>;
}) {
    const { t } = useTranslation('settingsClassroomPanels');
    return (
        <MyDialog
            open={open}
            onOpenChange={(next) => {
                if (!next) onClose();
            }}
            heading={t('rooms.paste.title')}
            dialogWidth="max-w-lg"
        >
            {open && (
                <PasteRoomsForm instituteId={instituteId} onClose={onClose} onSaved={onSaved} />
            )}
        </MyDialog>
    );
}

function PasteRoomsForm({
    instituteId,
    onClose,
    onSaved,
}: {
    instituteId: string;
    onClose: () => void;
    onSaved: () => void | Promise<unknown>;
}) {
    const { t } = useTranslation('settingsClassroomPanels');
    const schema = useMemo(
        () =>
            z.object({
                text: z.string().superRefine((text, ctx) => {
                    const names = parseRoomList(text);
                    const add = (message: string) =>
                        ctx.addIssue({ code: z.ZodIssueCode.custom, message });
                    if (names.length === 0) add(t('rooms.paste.required'));
                    if (names.length > BULK_ROOM_MAX) {
                        add(t('rooms.paste.tooMany', { max: BULK_ROOM_MAX }));
                    }
                    const long = names.find((name) => name.length > ROOM_NAME_MAX);
                    if (long) add(t('rooms.paste.lineTooLong', { max: ROOM_NAME_MAX, name: long }));
                }),
            }),
        [t]
    );
    const form = useForm<z.infer<typeof schema>>({
        resolver: zodResolver(schema),
        defaultValues: { text: '' },
    });
    const [failure, setFailure] = useState<string | null>(null);
    const [result, setResult] = useState<RoomBulkCreateResponse | null>(null);

    const submit = form.handleSubmit(async ({ text }) => {
        setFailure(null);
        try {
            const response = await createRoomsBulk(instituteId, parseRoomList(text));
            await onSaved();
            setResult(response);
        } catch (error) {
            setFailure(panelErrorMessage(t, error));
        }
    });

    if (result) {
        return (
            <div className="flex flex-col gap-4" role="status">
                <p className="text-body text-neutral-700">
                    {t('rooms.paste.created', { total: result.created.length })}
                </p>
                {result.skipped_duplicates.length > 0 && (
                    <div className="flex flex-col gap-1">
                        <p className="text-body text-neutral-700">
                            {t('rooms.paste.skipped', { total: result.skipped_duplicates.length })}
                        </p>
                        <p className="break-words text-caption text-neutral-500">
                            {result.skipped_duplicates.join(', ')}
                        </p>
                    </div>
                )}
                <div className="flex justify-end">
                    <MyButton type="button" onClick={onClose}>
                        {t('common.done')}
                    </MyButton>
                </div>
            </div>
        );
    }

    return (
        <Form {...form}>
            <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
                <FormField
                    control={form.control}
                    name="text"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>{t('rooms.paste.label')}</FormLabel>
                            <FormControl>
                                <Textarea {...field} rows={8} autoFocus />
                            </FormControl>
                            <FormDescription>
                                {t('rooms.paste.help', { max: BULK_ROOM_MAX })}
                            </FormDescription>
                            <FormMessage />
                        </FormItem>
                    )}
                />
                {failure && (
                    <Alert variant="destructive" role="alert">
                        <AlertDescription>{failure}</AlertDescription>
                    </Alert>
                )}
                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                    <MyButton type="button" buttonType="secondary" onClick={onClose}>
                        {t('common.cancel')}
                    </MyButton>
                    <MyButton type="submit" disable={form.formState.isSubmitting}>
                        {form.formState.isSubmitting
                            ? t('common.working')
                            : t('rooms.paste.submit')}
                    </MyButton>
                </div>
            </form>
        </Form>
    );
}
