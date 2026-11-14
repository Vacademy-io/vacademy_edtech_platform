/**
 * Pair a new panel from its #pair= link. The number tap is what stops a forwarded
 * link from finishing on its own: without the panel in front of you, you cannot
 * know which of the three to pick, and a wrong pick cancels the code.
 *
 * Schools where the account is an ADMIN always use the admin flow. An installer account
 * also gets the schools that linked its organisation and where it is not an ADMIN:
 * never a replace there, and a panel that waits for the school's approval. With no
 * admin school at all, the installer form opens directly.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import type {
    ClassroomRoom,
    DeviceClaimResponse,
    PairPreviewResponse,
    PanelApiError,
    PanelPartnerCustomerRow,
    PanelPartnerRoomRow,
    PanelRoomCurrentDevice,
} from '@/classroom-shared/apiTypes';
import { isPanelApiError } from '@/classroom-shared/apiTypes';
import { Form } from '@/components/ui/form';
import { SelectInput, TextField } from '../components/fields';
import { SignedIn } from '../components/SignedIn';
import {
    ActionButton,
    FailureCard,
    NumberChoice,
    Spinner,
    StateCard,
    Warning,
} from '../components/ui';
import {
    adminInstitutes,
    adminRooms,
    deviceClaim,
    installerProbe,
    pairPreview,
    partnerClaim,
    partnerCustomers,
    partnerRooms,
    resolveInstitute,
} from '../lib/api';
import { errorCode, errorKind, PhoneApiError } from '../lib/http';
import { clearRoute, setRoute, type PhoneRoute } from '../lib/route';
import { applyTheme } from '../lib/theme';
import { fill, useStrings, type PhoneStrings } from '../strings';
import { formatDay, NotInstallerCard, schoolName } from './InstallerScreen';

type Route = Extract<PhoneRoute, { kind: 'pair' }>;

const NEW_ROOM = '__new__';

interface InstituteChoice {
    id: string;
    name: string;
    theme: string | null;
}

/** No routing row is normal, so the id prefix is the fallback name. */
export const instituteLabel = (id: string, name?: string | null): string =>
    name?.trim() || id.slice(0, 8);

type Stage =
    | { kind: 'loading' }
    | {
          kind: 'form';
          preview: PairPreviewResponse;
          institutes: InstituteChoice[];
          /** Linked schools where the account is not an ADMIN: the installer flow. */
          customers: PanelPartnerCustomerRow[] | null;
      }
    | {
          kind: 'installer';
          preview: PairPreviewResponse;
          customers: PanelPartnerCustomerRow[];
          /** The admin form this came from, for its Back button. */
          adminForm?: Extract<Stage, { kind: 'form' }>;
      }
    | { kind: 'not-admin' }
    | { kind: 'not-installer' }
    | { kind: 'installed'; claim: DeviceClaimResponse; school: string }
    | { kind: 'expired' }
    | { kind: 'wrong-number' }
    | { kind: 'done'; claim: DeviceClaimResponse }
    | { kind: 'failed'; failure: 'network' | 'busy' | 'error'; retry: () => void };

const failureOf = (error: unknown): 'network' | 'busy' | 'error' => {
    const kind = errorKind(error);
    return kind === 'network' ? 'network' : kind === 'busy' ? 'busy' : 'error';
};

export function PairScreen({
    route,
    onSignOutRetry,
}: {
    route: Route;
    onSignOutRetry: () => void;
}) {
    return (
        <SignedIn>
            <PairFlow route={route} onSignOutRetry={onSignOutRetry} />
        </SignedIn>
    );
}

function PairFlow({ route, onSignOutRetry }: { route: Route; onSignOutRetry: () => void }) {
    const s = useStrings();
    const [stage, setStage] = useState<Stage>({ kind: 'loading' });

    const load = useCallback(async () => {
        setStage({ kind: 'loading' });
        try {
            const [preview, rows, partner] = await Promise.all([
                pairPreview(route.code),
                adminInstitutes(),
                installerProbe(),
            ]);
            // An ADMIN school always takes the admin claim, so each school is offered once.
            const adminIds = rows.map((row) => row.institute_id);
            const customers = partner
                ? (await partnerCustomers()).filter((row) => adminIds.indexOf(row.institute_id) < 0)
                : null;
            if (rows.length === 0) {
                setStage(
                    customers ? { kind: 'installer', preview, customers } : { kind: 'not-admin' }
                );
                return;
            }
            const institutes = await Promise.all(
                rows.map(async ({ institute_id: id }) => {
                    const branding = await resolveInstitute(id);
                    return {
                        id,
                        name: instituteLabel(id, branding?.instituteName),
                        theme: branding?.instituteThemeCode ?? null,
                    };
                })
            );
            applyTheme(institutes[0]?.theme);
            setStage({ kind: 'form', preview, institutes, customers });
        } catch (error) {
            const kind = errorKind(error);
            if (kind === 'sign-in') return;
            const code = errorCode(error);
            if (code === 'NOT_FOUND' || code === 'EXPIRED') setStage({ kind: 'expired' });
            else if (code === 'FORBIDDEN') setStage({ kind: 'not-admin' });
            else setStage({ kind: 'failed', failure: failureOf(error), retry: () => void load() });
        }
    }, [route.code]);

    useEffect(() => {
        void load();
    }, [load]);

    switch (stage.kind) {
        case 'loading':
            return <Spinner />;
        case 'not-admin':
            return (
                <StateCard tone="danger" testId="pair-not-admin" title={s.pairNotAdmin}>
                    <ActionButton onClick={onSignOutRetry}>{s.signOutTryAnother}</ActionButton>
                </StateCard>
            );
        case 'not-installer':
            return <NotInstallerCard onSignOutRetry={onSignOutRetry} />;
        case 'installed':
            return (
                <StateCard
                    tone="success"
                    testId="pair-installed"
                    title={s.pairDone}
                    body={fill(s.installerDoneBody, {
                        room: stage.claim.room.name,
                        school: stage.school,
                    })}
                >
                    <ActionButton secondary onClick={clearRoute}>
                        {s.done}
                    </ActionButton>
                </StateCard>
            );
        case 'installer': {
            const back = stage.adminForm;
            if (stage.customers.length === 0) {
                return (
                    <StateCard
                        tone="info"
                        testId="pair-no-schools"
                        title={s.noSchoolsTitle}
                        body={s.noSchoolsBody}
                    >
                        <ActionButton
                            onClick={() => setRoute({ kind: 'installer', resume: route.code })}
                        >
                            {s.enterSchoolCode}
                        </ActionButton>
                    </StateCard>
                );
            }
            return (
                <InstallerPairForm
                    code={route.code}
                    preview={stage.preview}
                    customers={stage.customers}
                    onBack={back ? () => setStage(back) : undefined}
                    onExpired={() => setStage({ kind: 'expired' })}
                    onWrongNumber={() => setStage({ kind: 'wrong-number' })}
                    onDone={(claim, school) => setStage({ kind: 'installed', claim, school })}
                />
            );
        }
        case 'expired':
            return (
                <StateCard
                    tone="warning"
                    testId="pair-expired"
                    title={s.pairExpiredTitle}
                    body={s.pairExpiredBody}
                >
                    <ActionButton secondary onClick={clearRoute}>
                        {s.done}
                    </ActionButton>
                </StateCard>
            );
        case 'wrong-number':
            return (
                <StateCard tone="danger" testId="pair-wrong-number" title={s.pairWrongNumber}>
                    <ActionButton secondary onClick={clearRoute}>
                        {s.done}
                    </ActionButton>
                </StateCard>
            );
        case 'done':
            return (
                <StateCard
                    tone="success"
                    testId="pair-done"
                    title={s.pairDone}
                    body={fill(s.pairDoneBody, { room: stage.claim.room.name })}
                >
                    <ActionButton secondary onClick={clearRoute}>
                        {s.done}
                    </ActionButton>
                </StateCard>
            );
        case 'failed':
            return <FailureCard kind={stage.failure} onRetry={stage.retry} />;
        case 'form': {
            const form = stage;
            const linked = form.customers;
            return (
                <PairForm
                    code={route.code}
                    preview={form.preview}
                    institutes={form.institutes}
                    onLinkedSchool={
                        linked && linked.length > 0
                            ? () =>
                                  setStage({
                                      kind: 'installer',
                                      preview: form.preview,
                                      customers: linked,
                                      adminForm: form,
                                  })
                            : undefined
                    }
                    onExpired={() => setStage({ kind: 'expired' })}
                    onWrongNumber={() => setStage({ kind: 'wrong-number' })}
                    onNotAdmin={() => setStage({ kind: 'not-admin' })}
                    onDone={(claim) => setStage({ kind: 'done', claim })}
                />
            );
        }
    }
}

function roomLabel(room: ClassroomRoom, s: PhoneStrings): string {
    return room.device_id ? fill(s.roomInUse, { room: room.name }) : room.name;
}

function PairForm({
    code,
    preview,
    institutes,
    onLinkedSchool,
    onExpired,
    onWrongNumber,
    onNotAdmin,
    onDone,
}: {
    code: string;
    preview: PairPreviewResponse;
    institutes: InstituteChoice[];
    /** Present when the account may also set panels up at linked schools. */
    onLinkedSchool?: () => void;
    onExpired: () => void;
    onWrongNumber: () => void;
    onNotAdmin: () => void;
    onDone: (claim: DeviceClaimResponse) => void;
}) {
    const s = useStrings();
    const [instituteId, setInstituteId] = useState(institutes[0]?.id ?? '');
    const [rooms, setRooms] = useState<ClassroomRoom[] | null>(null);
    const [roomsFailed, setRoomsFailed] = useState<'network' | 'busy' | 'error' | null>(null);
    const [roomsTick, setRoomsTick] = useState(0);
    const [roomId, setRoomId] = useState('');
    const [matchCode, setMatchCode] = useState<number | null>(null);
    const [showNumberHint, setShowNumberHint] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [formError, setFormError] = useState<string | null>(null);
    const [occupied, setOccupied] = useState<PanelRoomCurrentDevice | null>(null);

    useEffect(() => {
        let live = true;
        setRooms(null);
        setRoomsFailed(null);
        applyTheme(institutes.find((item) => item.id === instituteId)?.theme);
        adminRooms(instituteId)
            .then((response) => {
                if (!live) return;
                const active = response.rooms.filter((room) => room.status === 'ACTIVE');
                setRooms(active);
                // Every room taken: default to a new one, so nobody replaces a panel by accident.
                setRoomId(response.next_unpaired_room_id ?? NEW_ROOM);
            })
            .catch((error) => {
                if (live && errorKind(error) !== 'sign-in') setRoomsFailed(failureOf(error));
            });
        return () => {
            live = false;
        };
    }, [instituteId, institutes, roomsTick]);

    const schema = useMemo(
        () =>
            z.object({
                newRoomName:
                    roomId === NEW_ROOM
                        ? z.string().trim().min(1, s.enterRoomName)
                        : z.string().optional(),
            }),
        [roomId, s]
    );
    const form = useForm<{ newRoomName?: string }>({
        resolver: zodResolver(schema),
        defaultValues: { newRoomName: '' },
    });

    const roomName = (): string =>
        roomId === NEW_ROOM
            ? (form.getValues('newRoomName') ?? '').trim()
            : rooms?.find((room) => room.id === roomId)?.name ?? '';

    const claim = async (replaceExisting: boolean): Promise<void> => {
        if (matchCode === null) return;
        setSubmitting(true);
        setFormError(null);
        try {
            onDone(
                await deviceClaim({
                    code,
                    match_code: matchCode,
                    institute_id: instituteId,
                    ...(roomId === NEW_ROOM
                        ? { new_room_name: (form.getValues('newRoomName') ?? '').trim() }
                        : { room_id: roomId }),
                    replace_existing: replaceExisting,
                })
            );
        } catch (error) {
            const kind = errorKind(error);
            if (kind === 'sign-in') return;
            const body: PanelApiError | null =
                error instanceof PhoneApiError && isPanelApiError(error.body) ? error.body : null;
            const failureCode = errorCode(error);
            if (failureCode === 'WRONG_NUMBER') onWrongNumber();
            else if (failureCode === 'NOT_FOUND' || failureCode === 'EXPIRED') onExpired();
            else if (failureCode === 'FORBIDDEN') onNotAdmin();
            else if (failureCode === 'ROOM_OCCUPIED')
                setOccupied(body?.current_device ?? { id: '', model: null, last_seen_at: null });
            else if (failureCode === 'ROOM_NAME_TAKEN') setFormError(s.roomNameTaken);
            else if (failureCode === 'ROOM_OTHER_INSTITUTE') setFormError(s.roomOtherInstitute);
            else if (failureCode === 'TRY_AGAIN') setFormError(s.tryAgainShortly);
            else if (kind === 'network') setFormError(s.noConnection);
            else if (kind === 'busy') setFormError(s.busy);
            else setFormError(s.genericError);
        } finally {
            setSubmitting(false);
        }
    };

    const submit = form.handleSubmit(() => {
        if (matchCode === null) {
            setShowNumberHint(true);
            return;
        }
        void claim(false);
    });

    if (occupied !== null) {
        const seen = occupied.last_seen_at
            ? new Date(occupied.last_seen_at).toLocaleString(document.documentElement.lang || 'en')
            : s.seenNever;
        return (
            <StateCard
                tone="warning"
                testId="pair-occupied"
                title={s.replaceTitle}
                body={fill(s.replaceBody, {
                    room: roomName(),
                    model: occupied.model ?? s.unknownValue,
                    seen,
                })}
            >
                <ActionButton
                    disable={submitting}
                    onClick={() => {
                        setOccupied(null);
                        void claim(true);
                    }}
                >
                    {s.replaceConfirm}
                </ActionButton>
                <ActionButton secondary onClick={() => setOccupied(null)}>
                    {s.cancel}
                </ActionButton>
            </StateCard>
        );
    }

    return (
        <section className="flex flex-col gap-4" data-state="pair">
            <h1 className="text-h3 text-foreground">{s.pairTitle}</h1>
            <p className="text-body text-muted-foreground" data-state="pair-reported">
                {fill(s.reportedByPanel, {
                    model:
                        [preview.manufacturer, preview.model].filter(Boolean).join(' ') ||
                        s.unknownValue,
                    webview: preview.webview_major ?? s.unknownValue,
                })}
            </p>
            <Warning>{s.pairWarning}</Warning>

            {institutes.length > 1 && (
                <SelectInput
                    name="institute"
                    label={s.institute}
                    value={instituteId}
                    onChange={setInstituteId}
                    options={institutes.map((item) => ({ value: item.id, label: item.name }))}
                />
            )}

            {roomsFailed && (
                <FailureCard kind={roomsFailed} onRetry={() => setRoomsTick((n) => n + 1)} />
            )}
            {!roomsFailed && rooms === null && <Spinner />}
            {!roomsFailed && rooms !== null && (
                <Form {...form}>
                    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
                        {rooms.length === 0 && (
                            <p className="text-body text-muted-foreground">{s.emptyRooms}</p>
                        )}
                        {rooms.length > 0 && (
                            <SelectInput
                                name="room"
                                label={s.room}
                                value={roomId}
                                onChange={setRoomId}
                                options={[
                                    ...rooms.map((room) => ({
                                        value: room.id,
                                        label: roomLabel(room, s),
                                    })),
                                    { value: NEW_ROOM, label: s.newRoomOption },
                                ]}
                            />
                        )}
                        {roomId === NEW_ROOM && (
                            <TextField
                                control={form.control}
                                name="newRoomName"
                                label={s.newRoomName}
                                autoComplete="off"
                                maxLength={100}
                            />
                        )}
                        <div className="flex flex-col gap-2">
                            <p className="text-subtitle text-foreground">{s.chooseNumber}</p>
                            <NumberChoice
                                options={preview.match_options}
                                selected={matchCode}
                                disabled={submitting}
                                onPick={(value) => {
                                    setMatchCode(value);
                                    setShowNumberHint(false);
                                }}
                            />
                            {showNumberHint && (
                                <p role="alert" className="text-body text-danger-600">
                                    {s.chooseNumber}
                                </p>
                            )}
                        </div>
                        <ActionButton type="submit" disable={submitting}>
                            {submitting ? s.pairing : s.pair}
                        </ActionButton>
                        {formError && (
                            <p
                                role="alert"
                                data-state="pair-form-error"
                                className="text-body text-danger-600"
                            >
                                {formError}
                            </p>
                        )}
                    </form>
                </Form>
            )}
            {onLinkedSchool && (
                <ActionButton text onClick={onLinkedSchool}>
                    {s.installerLinkedSchool}
                </ActionButton>
            )}
        </section>
    );
}

function PanelReported({ preview }: { preview: PairPreviewResponse }) {
    const s = useStrings();
    return (
        <p className="text-body text-muted-foreground" data-state="pair-reported">
            {fill(s.reportedByPanel, {
                model:
                    [preview.manufacturer, preview.model].filter(Boolean).join(' ') ||
                    s.unknownValue,
                webview: preview.webview_major ?? s.unknownValue,
            })}
        </p>
    );
}

/**
 * The installer's form: one of the schools this installer org may set panels up for,
 * then a room. A room that has a panel is refused by the server; only the school can
 * remove a panel, so there is no replace here. This form opens only after /partner/me said
 * the account is an installer, so NOT_INSTALLER here means this school no longer lets the
 * organisation set panels up (link removed or install window over).
 */
function InstallerPairForm({
    code,
    preview,
    customers,
    onBack,
    onExpired,
    onWrongNumber,
    onDone,
}: {
    code: string;
    preview: PairPreviewResponse;
    customers: PanelPartnerCustomerRow[];
    /** Back to the admin form, when this was opened from it. */
    onBack?: () => void;
    onExpired: () => void;
    onWrongNumber: () => void;
    onDone: (claim: DeviceClaimResponse, school: string) => void;
}) {
    const s = useStrings();
    const [instituteId, setInstituteId] = useState(customers[0]?.institute_id ?? '');
    const [rooms, setRooms] = useState<PanelPartnerRoomRow[] | null>(null);
    const [roomsFailed, setRoomsFailed] = useState<'network' | 'busy' | 'error' | null>(null);
    const [roomsTick, setRoomsTick] = useState(0);
    const [roomId, setRoomId] = useState('');
    const [matchCode, setMatchCode] = useState<number | null>(null);
    const [showNumberHint, setShowNumberHint] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [formError, setFormError] = useState<string | null>(null);

    const customer = customers.find((row) => row.institute_id === instituteId);

    useEffect(() => {
        let live = true;
        setRooms(null);
        setRoomsFailed(null);
        setFormError(null);
        partnerRooms(instituteId)
            .then((list) => {
                if (!live) return;
                setRooms(list);
                // A new room unless one is free, so a pick never lands on a room with a panel.
                setRoomId(list.find((room) => !room.has_panel)?.id ?? NEW_ROOM);
            })
            .catch((error) => {
                if (!live || errorKind(error) === 'sign-in') return;
                if (errorCode(error) === 'NOT_INSTALLER' || errorCode(error) === 'FORBIDDEN') {
                    setRooms([]);
                    setRoomId(NEW_ROOM);
                    setFormError(s.installerNotLinked);
                } else setRoomsFailed(failureOf(error));
            });
        return () => {
            live = false;
        };
    }, [instituteId, roomsTick, s]);

    const schema = useMemo(
        () =>
            z.object({
                newRoomName:
                    roomId === NEW_ROOM
                        ? z.string().trim().min(1, s.enterRoomName)
                        : z.string().optional(),
            }),
        [roomId, s]
    );
    const form = useForm<{ newRoomName?: string }>({
        resolver: zodResolver(schema),
        defaultValues: { newRoomName: '' },
    });

    const claim = async (): Promise<void> => {
        if (matchCode === null) return;
        setSubmitting(true);
        setFormError(null);
        try {
            const response = await partnerClaim({
                code,
                match_code: matchCode,
                institute_id: instituteId,
                ...(roomId === NEW_ROOM
                    ? { new_room_name: (form.getValues('newRoomName') ?? '').trim() }
                    : { room_id: roomId }),
            });
            onDone(response, schoolName(customer?.institute_name, s));
        } catch (error) {
            const kind = errorKind(error);
            if (kind === 'sign-in') return;
            const failureCode = errorCode(error);
            if (failureCode === 'WRONG_NUMBER') onWrongNumber();
            else if (failureCode === 'NOT_FOUND' || failureCode === 'EXPIRED') onExpired();
            else if (failureCode === 'ROOM_OCCUPIED') setFormError(s.installerRoomTaken);
            else if (failureCode === 'NOT_INSTALLER' || failureCode === 'FORBIDDEN')
                setFormError(s.installerNotLinked);
            else if (failureCode === 'ROOM_NAME_TAKEN') setFormError(s.roomNameTaken);
            else if (failureCode === 'ROOM_OTHER_INSTITUTE') setFormError(s.roomOtherInstitute);
            else if (failureCode === 'TRY_AGAIN') setFormError(s.tryAgainShortly);
            else if (kind === 'network') setFormError(s.noConnection);
            else if (kind === 'busy') setFormError(s.busy);
            else setFormError(s.genericError);
        } finally {
            setSubmitting(false);
        }
    };

    const submit = form.handleSubmit(() => {
        if (matchCode === null) {
            setShowNumberHint(true);
            return;
        }
        void claim();
    });

    return (
        <section className="flex flex-col gap-4" data-state="pair-installer">
            <h1 className="text-h3 text-foreground">{s.pairTitle}</h1>
            <PanelReported preview={preview} />
            <Warning>{s.pairWarning}</Warning>

            <SelectInput
                name="school"
                label={s.school}
                value={instituteId}
                onChange={setInstituteId}
                options={customers.map((row) => ({
                    value: row.institute_id,
                    label: schoolName(row.institute_name, s),
                }))}
            />
            {customer?.install_until && (
                <p className="text-body text-muted-foreground" data-state="pair-install-until">
                    {fill(s.installUntil, { date: formatDay(customer.install_until) })}
                </p>
            )}

            {roomsFailed && (
                <FailureCard kind={roomsFailed} onRetry={() => setRoomsTick((n) => n + 1)} />
            )}
            {!roomsFailed && rooms === null && <Spinner />}
            {!roomsFailed && rooms !== null && (
                <Form {...form}>
                    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
                        {rooms.length === 0 && (
                            <p className="text-body text-muted-foreground">{s.emptyRooms}</p>
                        )}
                        {rooms.length > 0 && (
                            <SelectInput
                                name="room"
                                label={s.room}
                                value={roomId}
                                onChange={setRoomId}
                                options={[
                                    ...rooms.map((room) => ({
                                        value: room.id,
                                        label: room.has_panel
                                            ? fill(s.roomInUse, { room: room.name })
                                            : room.name,
                                    })),
                                    { value: NEW_ROOM, label: s.newRoomOption },
                                ]}
                            />
                        )}
                        {roomId === NEW_ROOM && (
                            <TextField
                                control={form.control}
                                name="newRoomName"
                                label={s.newRoomName}
                                autoComplete="off"
                                maxLength={100}
                            />
                        )}
                        <div className="flex flex-col gap-2">
                            <p className="text-subtitle text-foreground">{s.chooseNumber}</p>
                            <NumberChoice
                                options={preview.match_options}
                                selected={matchCode}
                                disabled={submitting}
                                onPick={(value) => {
                                    setMatchCode(value);
                                    setShowNumberHint(false);
                                }}
                            />
                            {showNumberHint && (
                                <p role="alert" className="text-body text-danger-600">
                                    {s.chooseNumber}
                                </p>
                            )}
                        </div>
                        <ActionButton type="submit" disable={submitting}>
                            {submitting ? s.pairing : s.pair}
                        </ActionButton>
                        {formError && (
                            <p
                                role="alert"
                                data-state="pair-form-error"
                                className="text-body text-danger-600"
                            >
                                {formError}
                            </p>
                        )}
                    </form>
                </Form>
            )}
            {onBack && (
                <ActionButton text onClick={onBack}>
                    {s.installerBackToAdmin}
                </ActionButton>
            )}
        </section>
    );
}
