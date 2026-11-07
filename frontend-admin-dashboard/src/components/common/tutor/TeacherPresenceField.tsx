import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { CheckCircle, CircleNotch, Sparkle, UserCircle, UserFocus } from '@phosphor-icons/react';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { MyButton } from '@/components/design-system/button';
import {
    getTutorAvatarRequest,
    requestTutorAvatar,
    type TutorAsset,
    type TutorOptions,
} from '@/services/tutor';
import { TeacherFaceField } from './TeacherFaceField';

interface Props {
    /** Media file id of the teacher's photo at this level; blank inherits / default. */
    fileId?: string;
    inheritedFileId?: string;
    teacherName?: string;
    /** 'none' = photo only, 'spatius' = animated avatar; undefined on the course tab = inherit. */
    provider?: 'none' | 'spatius';
    avatarId?: string;
    inheritedAvatarId?: string;
    options: TutorOptions | null;
    onFaceChange: (fileId: string | undefined) => void;
    onAvatarChange: (provider: 'none' | 'spatius' | undefined, avatarId: string) => void;
    /** Course tab: the field may fall back to the institute's choice. */
    inheritable?: boolean;
}

const POLL_MS = 10000;

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/**
 * How learners see the teacher: the photo next to the name (always), and
 * optionally an animated, lip-synced avatar in voice lessons. Avatars come
 * from the registry — platform stock plus the institute's own — so nobody
 * can pick another institute's likeness. Requesting a custom avatar needs the
 * photo and consent; it is built by Vacademy and charged once when ready.
 */
export const TeacherPresenceField: React.FC<Props> = ({
    fileId,
    inheritedFileId,
    teacherName,
    provider,
    avatarId,
    inheritedAvatarId,
    options,
    onFaceChange,
    onAvatarChange,
    inheritable,
}) => {
    const [consent, setConsent] = useState(false);
    const [requesting, setRequesting] = useState(false);
    const [pending, setPending] = useState<TutorAsset | null>(null);
    const available = !!options?.avatar_available;
    const fees = options?.fees;
    const avatars = (options?.avatars ?? []).filter((a) => a.status !== 'disabled');
    const ready = avatars.filter((a) => a.status === 'ready' && a.external_id);
    const queued = avatars.find((a) => !a.stock && (a.status === 'requested' || a.status === 'processing'));
    const photo = fileId || inheritedFileId;

    const effectiveProvider = provider ?? (inheritedAvatarId ? 'spatius' : 'none');
    const effectiveAvatar = provider === undefined ? inheritedAvatarId : avatarId;
    const animated = effectiveProvider === 'spatius';
    const inherits = inheritable && provider === undefined;

    useEffect(() => {
        const target = pending ?? queued ?? null;
        if (!target || !(target.status === 'requested' || target.status === 'processing')) return;
        let stop = false;
        const tick = async () => {
            try {
                const j = await getTutorAvatarRequest(target.id);
                if (stop) return;
                if (j.status === 'ready' && j.avatar_id) {
                    setPending(null);
                    onAvatarChange('spatius', j.avatar_id);
                    toast.success('Your teacher avatar is ready. Save the settings to use it.');
                } else if (j.status === 'failed') {
                    setPending(null);
                    toast.error(j.error || 'The avatar could not be built from this photo');
                }
            } catch {
                /* transient */
            }
        };
        void tick();
        const t = setInterval(() => void tick(), POLL_MS);
        return () => {
            stop = true;
            clearInterval(t);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pending?.id, queued?.id]);

    const request = async () => {
        if (!photo) return;
        setRequesting(true);
        try {
            const r = await requestTutorAvatar(photo, teacherName);
            setPending({
                id: r.asset_id,
                kind: 'avatar',
                provider: 'spatius',
                external_id: r.avatar_id,
                display_name: r.display_name,
                status: r.status,
                stock: false,
            });
            toast.success(
                r.status === 'processing'
                    ? 'Building your avatar. This takes a few minutes.'
                    : 'Request received. We build the avatar and it appears here when ready.'
            );
        } catch (e: unknown) {
            const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data
                ?.detail;
            toast.error(detail || (e instanceof Error ? e.message : 'Could not request the avatar'));
        } finally {
            setRequesting(false);
        }
    };

    const live = fees?.live_minute ?? 0;
    const extra = fees?.avatar_minute ?? 0;
    const inQueue = pending ?? queued;

    return (
        <div className="space-y-3">
            <TeacherFaceField
                fileId={fileId}
                inheritedFileId={inheritedFileId}
                teacherName={teacherName}
                onChange={onFaceChange}
            />

            <div className="space-y-2">
                <Label>How learners see the teacher in voice lessons</Label>
                <div className="grid gap-2 sm:grid-cols-2">
                    <button
                        type="button"
                        onClick={() => onAvatarChange('none', '')}
                        className={`flex items-start gap-3 rounded-lg border p-3 text-start transition ${
                            !animated && !inherits
                                ? 'border-primary-500 bg-primary-50'
                                : 'border-neutral-200 bg-white hover:bg-neutral-50'
                        }`}
                    >
                        <UserCircle className="mt-0.5 size-5 shrink-0 text-neutral-600" />
                        <span>
                            <span className="block text-sm font-medium text-neutral-800">
                                Photo only
                            </span>
                            <span className="block text-xs text-neutral-600">
                                The photo next to the teacher&apos;s name. {fmt(live)} credits per
                                learner-minute.
                            </span>
                        </span>
                    </button>
                    <button
                        type="button"
                        disabled={!available}
                        onClick={() => onAvatarChange('spatius', avatarId || ready[0]?.external_id || '')}
                        className={`flex items-start gap-3 rounded-lg border p-3 text-start transition ${
                            animated && !inherits
                                ? 'border-primary-500 bg-primary-50'
                                : 'border-neutral-200 bg-white hover:bg-neutral-50'
                        } disabled:cursor-not-allowed disabled:opacity-60`}
                    >
                        <Sparkle className="mt-0.5 size-5 shrink-0 text-primary-500" weight="fill" />
                        <span>
                            <span className="block text-sm font-medium text-neutral-800">
                                Animated avatar{' '}
                                <span className="rounded-full bg-primary-100 px-1.5 py-0.5 text-xs font-semibold text-primary-500">
                                    Premium
                                </span>
                            </span>
                            <span className="block text-xs text-neutral-600">
                                A lip-synced teacher that speaks the lesson. {fmt(live + extra)} credits
                                per learner-minute ({fmt(extra)} more). Learners can hide it.
                            </span>
                        </span>
                    </button>
                </div>
                {!available && (
                    <p className="text-xs text-neutral-500">
                        The animated avatar is not enabled on this server yet.
                    </p>
                )}
                {inherits && (
                    <p className="text-xs text-neutral-500">
                        Using the institute default:{' '}
                        {inheritedAvatarId ? 'animated avatar' : 'photo only'}.
                    </p>
                )}
                {inheritable && provider !== undefined && (
                    <button
                        type="button"
                        className="text-xs text-neutral-500 underline-offset-2 hover:underline"
                        onClick={() => onAvatarChange(undefined, '')}
                    >
                        Use the institute default instead
                    </button>
                )}
            </div>

            {available && animated && !inherits && (
                <div className="space-y-3 rounded-md border border-neutral-200 bg-neutral-50 p-3">
                    <p className="flex items-center gap-2 text-sm font-medium text-neutral-800">
                        <UserFocus className="size-4 text-primary-500" />
                        Choose the avatar
                    </p>
                    {ready.length === 0 && !inQueue && (
                        <p className="text-xs text-neutral-500">
                            No avatars yet. Request your own below, or ask Vacademy to add stock
                            avatars.
                        </p>
                    )}
                    {ready.length > 0 && (
                        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                            {ready.map((a) => {
                                const selected = effectiveAvatar === a.external_id;
                                return (
                                    <button
                                        key={a.id}
                                        type="button"
                                        onClick={() => onAvatarChange('spatius', a.external_id || '')}
                                        className={`flex items-center gap-3 rounded-lg border bg-white p-2 text-start transition ${
                                            selected
                                                ? 'border-primary-500 ring-2 ring-primary-100'
                                                : 'border-neutral-200 hover:bg-neutral-50'
                                        }`}
                                    >
                                        <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary-100 text-sm font-semibold text-primary-500">
                                            {a.preview_url ? (
                                                <img
                                                    src={a.preview_url}
                                                    alt={a.display_name}
                                                    className="size-full object-cover"
                                                />
                                            ) : (
                                                a.display_name.slice(0, 1).toUpperCase()
                                            )}
                                        </span>
                                        <span className="min-w-0 flex-1">
                                            <span className="block truncate text-sm text-neutral-800">
                                                {a.display_name}
                                            </span>
                                            <span className="block text-xs text-neutral-500">
                                                {a.stock ? 'Stock' : 'Your avatar'}
                                                {a.gender ? ` · ${a.gender}` : ''}
                                            </span>
                                        </span>
                                        {selected && (
                                            <CheckCircle
                                                className="size-5 shrink-0 text-primary-500"
                                                weight="fill"
                                            />
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                    )}

                    <div className="space-y-2 border-t border-neutral-200 pt-3">
                        <p className="text-sm font-medium text-neutral-800">Your own teacher avatar</p>
                        {inQueue ? (
                            <p className="flex items-center gap-2 text-xs text-neutral-700">
                                <CircleNotch className="size-4 animate-spin text-primary-500" />
                                {inQueue.status === 'processing'
                                    ? `Building “${inQueue.display_name}”… it appears above when ready.`
                                    : `“${inQueue.display_name}” is requested. Vacademy builds it from the photo and it appears above when ready.`}
                            </p>
                        ) : (
                            <>
                                <p className="text-xs text-neutral-600">
                                    Built from the photo above (a clear, front-facing photo of one
                                    person). Charged once
                                    {fees?.avatar ? ` (${fmt(fees.avatar)} credits)` : ''} when it is
                                    ready.
                                    {!photo && ' Upload the teacher’s photo first.'}
                                </p>
                                <div className="flex items-start gap-2">
                                    <Checkbox
                                        id="avatar-consent"
                                        checked={consent}
                                        onCheckedChange={(v) => setConsent(v === true)}
                                    />
                                    <Label
                                        htmlFor="avatar-consent"
                                        className="text-xs font-normal text-neutral-700"
                                    >
                                        The person in the photo has agreed that we may create and
                                        show an animated likeness of them to learners of this
                                        institute.
                                    </Label>
                                </div>
                                <MyButton
                                    type="button"
                                    buttonType="secondary"
                                    scale="small"
                                    layoutVariant="default"
                                    disabled={!photo || !consent || requesting}
                                    onClick={() => void request()}
                                >
                                    {requesting ? <CircleNotch className="size-4 animate-spin" /> : null}
                                    Request my avatar
                                </MyButton>
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};
