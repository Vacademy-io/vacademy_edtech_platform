import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { CheckCircle, WarningCircle } from '@phosphor-icons/react';
import type {
    ClassroomRoom,
    PairPreviewResponse,
    PanelRoomCurrentDevice,
    PanelRoomRef,
} from '@/classroom-shared/apiTypes';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
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
import { formatRelative } from '@/lib/formatters';
import {
    ROOM_NAME_MAX,
    SETUP_CODE_LENGTH,
    claimDevice,
    normaliseSetupCode,
    panelApiError,
    panelErrorMessage,
    previewPair,
    useDevicesQuery,
} from './api';
import { ConfirmActionDialog } from './ConfirmActionDialog';

/** While a claimed panel waits for its Confirm, the admin is watching for that one change. */
const CONFIRM_WATCH_POLL_MS = 5_000;

interface AddPanelDialogProps {
    open: boolean;
    instituteId: string;
    rooms: ClassroomRoom[];
    /** Room to start on: the row the admin came from, or the next room with no panel. */
    initialRoomId: string | null;
    onClose: () => void;
    onPaired: () => void | Promise<unknown>;
}

export function AddPanelDialog({
    open,
    instituteId,
    rooms,
    initialRoomId,
    onClose,
    onPaired,
}: AddPanelDialogProps) {
    const { t } = useTranslation('settingsClassroomPanels');
    return (
        <MyDialog
            open={open}
            onOpenChange={(next) => {
                if (!next) onClose();
            }}
            heading={t('addPanel.title')}
            dialogWidth="max-w-lg"
        >
            {open && (
                <AddPanelFlow
                    instituteId={instituteId}
                    rooms={rooms}
                    initialRoomId={initialRoomId}
                    onClose={onClose}
                    onPaired={onPaired}
                />
            )}
        </MyDialog>
    );
}

interface RoomChoice {
    mode: 'existing' | 'new';
    roomId: string;
    newRoomName: string;
}

type Step =
    | { kind: 'code'; notice: string | null }
    | { kind: 'details'; code: string; preview: PairPreviewResponse }
    | { kind: 'done'; deviceId: string; room: PanelRoomRef };

function AddPanelFlow({
    instituteId,
    rooms,
    initialRoomId,
    onClose,
    onPaired,
}: Omit<AddPanelDialogProps, 'open'>) {
    const activeRooms = useMemo(() => rooms.filter((room) => room.status === 'ACTIVE'), [rooms]);
    const [step, setStep] = useState<Step>({ kind: 'code', notice: null });
    // Kept across steps: a wrong number sends the admin back for a new code, not a new room.
    const [roomChoice, setRoomChoice] = useState<RoomChoice>(() => ({
        mode: activeRooms.length === 0 ? 'new' : 'existing',
        roomId: initialRoomId ?? '',
        newRoomName: '',
    }));

    if (step.kind === 'code') {
        return (
            <CodeStep
                notice={step.notice}
                onCancel={onClose}
                onPreview={(code, preview) => setStep({ kind: 'details', code, preview })}
            />
        );
    }
    if (step.kind === 'details') {
        return (
            <DetailsStep
                instituteId={instituteId}
                rooms={activeRooms}
                code={step.code}
                preview={step.preview}
                roomChoice={roomChoice}
                onRoomChoice={setRoomChoice}
                onCancel={onClose}
                onRestart={(notice) => setStep({ kind: 'code', notice })}
                onClaimed={async (deviceId, room) => {
                    await onPaired();
                    setStep({ kind: 'done', deviceId, room });
                }}
            />
        );
    }
    return (
        <DoneStep
            instituteId={instituteId}
            deviceId={step.deviceId}
            room={step.room}
            onAnother={() => {
                setRoomChoice({
                    mode: activeRooms.length === 0 ? 'new' : 'existing',
                    roomId: '',
                    newRoomName: '',
                });
                setStep({ kind: 'code', notice: null });
            }}
            onClose={onClose}
        />
    );
}

function CodeStep({
    notice,
    onCancel,
    onPreview,
}: {
    notice: string | null;
    onCancel: () => void;
    onPreview: (code: string, preview: PairPreviewResponse) => void;
}) {
    const { t } = useTranslation('settingsClassroomPanels');
    const schema = useMemo(
        () =>
            z.object({
                code: z
                    .string()
                    .transform(normaliseSetupCode)
                    .refine(
                        (value) => value.length === SETUP_CODE_LENGTH,
                        t('addPanel.code.invalid')
                    ),
            }),
        [t]
    );
    const form = useForm<{ code: string }>({
        resolver: zodResolver(schema),
        defaultValues: { code: '' },
    });
    const [failure, setFailure] = useState<string | null>(null);

    const submit = form.handleSubmit(async ({ code }) => {
        setFailure(null);
        try {
            onPreview(code, await previewPair(code));
        } catch (error) {
            if (panelApiError(error)?.code === 'NOT_FOUND') {
                form.setError('code', { message: t('addPanel.code.notFound') });
            } else {
                setFailure(panelErrorMessage(t, error));
            }
        }
    });

    return (
        <Form {...form}>
            <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
                {notice && (
                    <Alert variant="destructive" role="alert">
                        <AlertDescription>{notice}</AlertDescription>
                    </Alert>
                )}
                <p className="text-body text-neutral-600">{t('addPanel.code.intro')}</p>
                <FormField
                    control={form.control}
                    name="code"
                    render={({ field: { value, onChange, ...field } }) => (
                        <FormItem>
                            <FormLabel>{t('addPanel.code.label')}</FormLabel>
                            <FormControl>
                                <MyInput
                                    {...field}
                                    inputType="text"
                                    inputPlaceholder={t('addPanel.code.placeholder')}
                                    input={value}
                                    onChangeFunction={onChange}
                                    size="large"
                                    className="uppercase sm:w-full"
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
                    <MyButton type="button" buttonType="secondary" onClick={onCancel}>
                        {t('common.cancel')}
                    </MyButton>
                    <MyButton type="submit" disable={form.formState.isSubmitting}>
                        {form.formState.isSubmitting
                            ? t('common.working')
                            : t('addPanel.code.submit')}
                    </MyButton>
                </div>
            </form>
        </Form>
    );
}

interface DetailsValues {
    room_mode: 'existing' | 'new';
    room_id: string;
    new_room_name: string;
    match_code: number | null;
}

function DetailsStep({
    instituteId,
    rooms,
    code,
    preview,
    roomChoice,
    onRoomChoice,
    onCancel,
    onRestart,
    onClaimed,
}: {
    instituteId: string;
    rooms: ClassroomRoom[];
    code: string;
    preview: PairPreviewResponse;
    roomChoice: RoomChoice;
    onRoomChoice: (choice: RoomChoice) => void;
    onCancel: () => void;
    onRestart: (notice: string) => void;
    onClaimed: (deviceId: string, room: PanelRoomRef) => Promise<void>;
}) {
    const { t } = useTranslation('settingsClassroomPanels');
    const schema = useMemo(
        () =>
            z
                .object({
                    room_mode: z.enum(['existing', 'new']),
                    room_id: z.string(),
                    new_room_name: z.string().trim(),
                    match_code: z.number().nullable(),
                })
                .superRefine((values, ctx) => {
                    const issue = (path: keyof DetailsValues, message: string) =>
                        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
                    if (values.room_mode === 'existing' && !values.room_id) {
                        issue('room_id', t('addPanel.details.roomRequired'));
                    }
                    if (values.room_mode === 'new') {
                        if (!values.new_room_name) {
                            issue('new_room_name', t('rooms.name.required'));
                        } else if (values.new_room_name.length > ROOM_NAME_MAX) {
                            issue('new_room_name', t('rooms.name.tooLong', { max: ROOM_NAME_MAX }));
                        }
                    }
                    if (values.match_code === null) {
                        issue('match_code', t('addPanel.details.numberRequired'));
                    }
                }),
        [t]
    );
    const form = useForm<DetailsValues>({
        resolver: zodResolver(schema),
        defaultValues: {
            room_mode: roomChoice.mode,
            room_id: roomChoice.roomId,
            new_room_name: roomChoice.newRoomName,
            match_code: null,
        },
    });
    const [failure, setFailure] = useState<string | null>(null);
    const [occupied, setOccupied] = useState<{
        roomName: string;
        device: PanelRoomCurrentDevice | null;
        values: DetailsValues;
    } | null>(null);

    const roomMode = form.watch('room_mode');
    const roomOptions = useMemo(
        () =>
            rooms.map((room) => ({
                value: room.id,
                label: room.device_id
                    ? t('addPanel.details.roomHasPanel', { room: room.name })
                    : room.name,
                keywords: [room.name],
            })),
        [rooms, t]
    );

    const rememberRoom = () => {
        const values = form.getValues();
        onRoomChoice({
            mode: values.room_mode,
            roomId: values.room_id,
            newRoomName: values.new_room_name,
        });
    };

    /** Rejects only on a failure that belongs in the replace dialog. */
    const claim = async (values: DetailsValues, replace: boolean) => {
        const response = await claimDevice({
            code,
            match_code: values.match_code as number,
            institute_id: instituteId,
            ...(values.room_mode === 'existing'
                ? { room_id: values.room_id }
                : { new_room_name: values.new_room_name }),
            replace_existing: replace,
        });
        await onClaimed(response.device_id, response.room);
    };

    /** True when the failure moved the flow somewhere else, so no message belongs here. */
    const handledByRestart = (error: unknown): boolean => {
        const apiCode = panelApiError(error)?.code;
        if (apiCode === 'WRONG_NUMBER') {
            rememberRoom();
            onRestart(t('addPanel.details.wrongNumber'));
            return true;
        }
        if (apiCode === 'NOT_FOUND') {
            rememberRoom();
            onRestart(t('addPanel.details.expired'));
            return true;
        }
        return false;
    };

    const submit = form.handleSubmit(async (values) => {
        setFailure(null);
        try {
            await claim(values, false);
        } catch (error) {
            if (handledByRestart(error)) return;
            const apiError = panelApiError(error);
            if (apiError?.code === 'ROOM_OCCUPIED') {
                setOccupied({
                    roomName: rooms.find((room) => room.id === values.room_id)?.name ?? '',
                    device: apiError.current_device ?? null,
                    values,
                });
            } else if (apiError?.code === 'ROOM_NAME_TAKEN') {
                form.setError('new_room_name', { message: panelErrorMessage(t, error) });
            } else {
                setFailure(panelErrorMessage(t, error));
            }
        }
    });

    const reported = [preview.manufacturer, preview.model].filter(Boolean).join(' ');

    return (
        <Form {...form}>
            <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
                <dl className="flex flex-col gap-1 rounded-lg border border-neutral-200 p-3 text-body">
                    <dt className="text-caption text-neutral-500">
                        {t('addPanel.details.panelLabel')}
                    </dt>
                    <dd className="text-neutral-700">
                        {reported || t('panels.unknownModel')}
                        {preview.webview_major !== null &&
                            `, ${t('panels.webview', { version: preview.webview_major })}`}
                    </dd>
                </dl>

                {roomMode === 'existing' ? (
                    <FormField
                        control={form.control}
                        name="room_id"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>{t('addPanel.details.roomLabel')}</FormLabel>
                                <FormControl>
                                    <SearchableSelect
                                        options={roomOptions}
                                        value={field.value}
                                        onChange={field.onChange}
                                        placeholder={t('addPanel.details.roomPlaceholder')}
                                        searchPlaceholder={t('common.searchRooms')}
                                        emptyText={t('common.noRoomMatch')}
                                        portal={false}
                                    />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                ) : (
                    <FormField
                        control={form.control}
                        name="new_room_name"
                        render={({ field: { value, onChange, ...field } }) => (
                            <FormItem>
                                <FormLabel>{t('addPanel.details.newRoomLabel')}</FormLabel>
                                <FormControl>
                                    <MyInput
                                        {...field}
                                        inputType="text"
                                        inputPlaceholder={t('rooms.name.placeholder')}
                                        input={value}
                                        onChangeFunction={onChange}
                                        size="large"
                                        className="sm:w-full"
                                    />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                )}
                {rooms.length > 0 && (
                    <div>
                        <MyButton
                            type="button"
                            buttonType="text"
                            scale="small"
                            onClick={() => {
                                form.clearErrors(['room_id', 'new_room_name']);
                                form.setValue(
                                    'room_mode',
                                    roomMode === 'existing' ? 'new' : 'existing'
                                );
                            }}
                        >
                            {roomMode === 'existing'
                                ? t('addPanel.details.useNewRoom')
                                : t('addPanel.details.useExistingRoom')}
                        </MyButton>
                    </div>
                )}

                <FormField
                    control={form.control}
                    name="match_code"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel id="classroom-panel-number">
                                {t('addPanel.details.numberLabel')}
                            </FormLabel>
                            <FormDescription>{t('addPanel.details.numberHelp')}</FormDescription>
                            <div
                                role="radiogroup"
                                aria-labelledby="classroom-panel-number"
                                className="flex gap-2"
                            >
                                {preview.match_options.map((option) => (
                                    <MyButton
                                        key={option}
                                        type="button"
                                        role="radio"
                                        aria-checked={field.value === option}
                                        buttonType={
                                            field.value === option ? 'primary' : 'secondary'
                                        }
                                        scale="large"
                                        className="h-14 min-w-0 flex-1 text-h3 sm:min-w-0"
                                        onClick={() => {
                                            field.onChange(option);
                                            form.clearErrors('match_code');
                                        }}
                                    >
                                        {option}
                                    </MyButton>
                                ))}
                            </div>
                            <FormMessage />
                        </FormItem>
                    )}
                />

                <p className="flex items-start gap-2 text-caption text-warning-600">
                    <WarningCircle size={16} className="mt-0.5 shrink-0" />
                    <span>{t('addPanel.details.warning')}</span>
                </p>

                {failure && (
                    <Alert variant="destructive" role="alert">
                        <AlertDescription>{failure}</AlertDescription>
                    </Alert>
                )}
                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                    <MyButton type="button" buttonType="secondary" onClick={onCancel}>
                        {t('common.cancel')}
                    </MyButton>
                    <MyButton type="submit" disable={form.formState.isSubmitting}>
                        {form.formState.isSubmitting
                            ? t('common.working')
                            : t('addPanel.details.submit')}
                    </MyButton>
                </div>
            </form>

            <ConfirmActionDialog
                open={!!occupied}
                title={t('addPanel.replace.title', { room: occupied?.roomName ?? '' })}
                body={replaceBody(t, occupied?.device ?? null, occupied?.roomName ?? '')}
                confirmLabel={t('addPanel.replace.confirm')}
                onCancel={() => setOccupied(null)}
                onConfirm={async () => {
                    if (!occupied) return;
                    try {
                        await claim(occupied.values, true);
                        setOccupied(null);
                    } catch (error) {
                        if (handledByRestart(error)) {
                            setOccupied(null);
                            return;
                        }
                        throw error;
                    }
                }}
            />
        </Form>
    );
}

function replaceBody(
    t: ReturnType<typeof useTranslation>['t'],
    device: PanelRoomCurrentDevice | null,
    roomName: string
): string {
    const model = device?.model || t('panels.unknownModel');
    const seen = device?.last_seen_at
        ? t('addPanel.replace.lastSeen', { when: formatRelative(device.last_seen_at) })
        : t('addPanel.replace.neverSeen');
    return t('addPanel.replace.body', { room: roomName, model, seen });
}

function DoneStep({
    instituteId,
    deviceId,
    room,
    onAnother,
    onClose,
}: {
    instituteId: string;
    deviceId: string;
    room: PanelRoomRef;
    onAnother: () => void;
    onClose: () => void;
}) {
    const { t } = useTranslation('settingsClassroomPanels');
    const devices = useDevicesQuery(instituteId, CONFIRM_WATCH_POLL_MS);
    const status = devices.data?.find((device) => device.id === deviceId)?.status;

    return (
        <div className="flex flex-col gap-4">
            <div className="flex items-start gap-3" role="status" aria-live="polite">
                {status === 'REVOKED' ? (
                    <WarningCircle size={24} className="shrink-0 text-danger-600" />
                ) : (
                    <CheckCircle size={24} className="shrink-0 text-success-600" />
                )}
                <div className="flex flex-col gap-1">
                    <p className="text-subtitle font-medium text-neutral-700">
                        {status === 'ACTIVE'
                            ? t('addPanel.done.activeTitle', { room: room.name })
                            : status === 'REVOKED'
                              ? t('addPanel.done.declinedTitle')
                              : t('addPanel.done.title')}
                    </p>
                    <p className="text-body text-neutral-500">
                        {status === 'ACTIVE'
                            ? t('addPanel.done.activeBody')
                            : status === 'REVOKED'
                              ? t('addPanel.done.declinedBody', { room: room.name })
                              : t('addPanel.done.body', { room: room.name })}
                    </p>
                </div>
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <MyButton type="button" buttonType="secondary" onClick={onAnother}>
                    {t('addPanel.done.another')}
                </MyButton>
                <MyButton type="button" onClick={onClose}>
                    {t('common.done')}
                </MyButton>
            </div>
        </div>
    );
}
