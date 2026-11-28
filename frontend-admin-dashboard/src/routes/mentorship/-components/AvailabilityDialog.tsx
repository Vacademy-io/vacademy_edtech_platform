import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Plus, Trash } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { useMyBookingPage, useUpdateMyBookingPage } from '../-hooks/use-mentorship';
import type {
    DateOverride,
    MentorAvailabilityRequest,
    SessionType,
    WeeklyWindow,
} from '../-types/mentorship-types';
import { reportApiError } from '@/lib/report-api-error';
import type { TFunction } from 'i18next';

const genId = (): string =>
    typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `st-${Math.floor(Math.random() * 1e9)}`;

/** A date override with a transient client key (stripped before saving). */
type OverrideRow = DateOverride & { _id: string };

const todayYmd = (): string => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
        d.getDate()
    ).padStart(2, '0')}`;
};

const buildDays = (t: TFunction): { key: string; label: string }[] => [
    { key: 'MONDAY', label: t('days.monday') },
    { key: 'TUESDAY', label: t('days.tuesday') },
    { key: 'WEDNESDAY', label: t('days.wednesday') },
    { key: 'THURSDAY', label: t('days.thursday') },
    { key: 'FRIDAY', label: t('days.friday') },
    { key: 'SATURDAY', label: t('days.saturday') },
    { key: 'SUNDAY', label: t('days.sunday') },
];

const DURATIONS = [15, 20, 30, 45, 60, 90];

interface DayRow {
    enabled: boolean;
    start: string;
    end: string;
}

const emptyRows = (days: { key: string; label: string }[]): Record<string, DayRow> =>
    Object.fromEntries(days.map((d) => [d.key, { enabled: false, start: '09:00', end: '17:00' }]));

interface AvailabilityDialogProps {
    instituteId: string | undefined;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function AvailabilityDialog({ instituteId, open, onOpenChange }: AvailabilityDialogProps) {
    const { t } = useTranslation('mentorshipAvailabilityDialog');
    const DAYS = buildDays(t);
    const { data: page, isLoading } = useMyBookingPage(open ? instituteId : undefined);
    const update = useUpdateMyBookingPage();

    const [rows, setRows] = useState<Record<string, DayRow>>(emptyRows(DAYS));
    const [duration, setDuration] = useState(30);
    const [minNoticeHours, setMinNoticeHours] = useState(2);
    const [bufferBefore, setBufferBefore] = useState(0);
    const [bufferAfter, setBufferAfter] = useState(0);
    const [horizonDays, setHorizonDays] = useState(30);
    const [sessionTypes, setSessionTypes] = useState<SessionType[]>([]);
    const [overrides, setOverrides] = useState<OverrideRow[]>([]);
    const [locationMode, setLocationMode] = useState<'GOOGLE_MEET' | 'CUSTOM_LINK'>('GOOGLE_MEET');
    const [customLink, setCustomLink] = useState('');

    // Hydrate the form once the page loads.
    useEffect(() => {
        if (!page) return;
        const next = emptyRows(DAYS);
        (page.availability?.weekly_windows ?? []).forEach((w) => {
            const row = next[w.day_of_week];
            if (row && !row.enabled) {
                row.enabled = true;
                row.start = w.start_time || row.start;
                row.end = w.end_time || row.end;
            }
        });
        setRows(next);
        setDuration(page.duration_minutes ?? 30);
        setMinNoticeHours(Math.round((page.min_notice_minutes ?? 120) / 60));
        setBufferBefore(page.buffer_before_minutes ?? 0);
        setBufferAfter(page.buffer_after_minutes ?? 0);
        setHorizonDays(page.booking_horizon_days ?? 30);
        setSessionTypes(
            (page.session_types ?? []).map((s) => ({ ...s, id: s.id || genId() }))
        );
        setOverrides(
            (page.availability?.date_overrides ?? []).map((o) => ({ ...o, _id: genId() }))
        );
        const isCustom =
            (page.location_type ?? '').toUpperCase() === 'CUSTOM_LINK' ||
            page.allocate_google_meet === false;
        setLocationMode(isCustom ? 'CUSTOM_LINK' : 'GOOGLE_MEET');
        setCustomLink(page.custom_meeting_link ?? '');
    }, [page]);

    const addOverride = () =>
        setOverrides((prev) => [...prev, { _id: genId(), date: todayYmd(), blocked: true }]);
    const removeOverride = (id: string) =>
        setOverrides((prev) => prev.filter((o) => o._id !== id));
    const patchOverride = (id: string, patch: Partial<OverrideRow>) =>
        setOverrides((prev) => prev.map((o) => (o._id === id ? { ...o, ...patch } : o)));
    const setOverrideMode = (id: string, mode: 'off' | 'custom') =>
        patchOverride(
            id,
            mode === 'off'
                ? { blocked: true, windows: undefined }
                : {
                      blocked: false,
                      windows: [{ day_of_week: '', start_time: '09:00', end_time: '17:00' }],
                  }
        );
    const setOverrideTime = (id: string, patch: Partial<WeeklyWindow>) =>
        setOverrides((prev) =>
            prev.map((o) =>
                o._id === id
                    ? {
                          ...o,
                          windows: [
                              {
                                  ...(o.windows?.[0] ?? {
                                      day_of_week: '',
                                      start_time: '09:00',
                                      end_time: '17:00',
                                  }),
                                  ...patch,
                              },
                          ],
                      }
                    : o
            )
        );

    const setDay = (key: string, patch: Partial<DayRow>) =>
        setRows((prev) => ({ ...prev, [key]: { ...prev[key]!, ...patch } }));

    const addSessionType = () =>
        setSessionTypes((prev) => [...prev, { id: genId(), name: '', duration_minutes: 30 }]);
    const updateSessionType = (id: string, patch: Partial<SessionType>) =>
        setSessionTypes((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    const removeSessionType = (id: string) =>
        setSessionTypes((prev) => prev.filter((s) => s.id !== id));

    const save = async () => {
        if (!instituteId) return;
        const weekly_windows: WeeklyWindow[] = [];
        for (const d of DAYS) {
            const r = rows[d.key]!;
            if (!r.enabled) continue;
            if (r.start >= r.end) {
                toast.error(t('validation.endAfterStart', { day: d.label }));
                return;
            }
            weekly_windows.push({ day_of_week: d.key, start_time: r.start, end_time: r.end });
        }
        if (weekly_windows.length === 0) {
            toast.error(t('validation.enableOneDay'));
            return;
        }
        if (locationMode === 'CUSTOM_LINK' && !customLink.trim()) {
            toast.error(t('validation.addMeetingLink'));
            return;
        }
        const cleanTypes = sessionTypes
            .filter((s) => s.name.trim() && s.duration_minutes > 0)
            .map((s) => ({ id: s.id, name: s.name.trim(), duration_minutes: s.duration_minutes }));
        const cleanOverrides: DateOverride[] = overrides
            .filter((o) => o.date)
            .map((o) =>
                o.blocked
                    ? { date: o.date, blocked: true }
                    : { date: o.date, blocked: false, windows: o.windows }
            );
        const payload: MentorAvailabilityRequest = {
            availability: { weekly_windows, date_overrides: cleanOverrides },
            duration_minutes: duration,
            min_notice_minutes: Math.max(0, minNoticeHours) * 60,
            buffer_before_minutes: Math.max(0, bufferBefore),
            buffer_after_minutes: Math.max(0, bufferAfter),
            booking_horizon_days: Math.max(1, horizonDays),
            session_types: cleanTypes,
            location_type: locationMode,
            allocate_google_meet: locationMode === 'GOOGLE_MEET',
            custom_meeting_link: locationMode === 'CUSTOM_LINK' ? customLink.trim() : '',
        };
        try {
            await update.mutateAsync({ instituteId, data: payload });
            toast.success(t('savedToast'));
            onOpenChange(false);
        } catch (error) {
            reportApiError(error, {
                feature: 'mentorship',
                tags: { 'mentorship.action': 'save-availability' },
                fallbackMessage: t('saveFailed'),
            });
        }
    };

    return (
        <MyDialog
            heading={t('heading')}
            open={open}
            onOpenChange={onOpenChange}
            footer={
                <>
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="small"
                        onClick={() => onOpenChange(false)}
                    >
                        {t('cancel')}
                    </MyButton>
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="small"
                        onClick={save}
                        disable={update.isPending || isLoading}
                    >
                        {update.isPending ? t('saving') : t('save')}
                    </MyButton>
                </>
            }
        >
            {isLoading ? (
                <div className="py-8 text-center text-body text-neutral-400">
                    {t('loading')}
                </div>
            ) : (
                <div className="flex flex-col gap-5">
                    <p className="text-body text-neutral-600">{t('intro')}</p>
                    {page?.timezone && (
                        <p className="-mt-3 text-caption text-neutral-500">
                            {t('timezoneNote.prefix')}{' '}
                            <span className="font-medium">{page.timezone}</span>
                            {t('timezoneNote.suffix')}
                        </p>
                    )}

                    <div>
                        <div className="mb-1 text-caption font-semibold uppercase tracking-wide text-neutral-400">
                            {t('location.heading')}
                        </div>
                        <p className="mb-2 text-caption text-neutral-400">
                            {t('location.description')}
                        </p>
                        <Select
                            value={locationMode}
                            onValueChange={(v) =>
                                setLocationMode(v as 'GOOGLE_MEET' | 'CUSTOM_LINK')
                            }
                        >
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="GOOGLE_MEET">
                                    {t('location.googleMeetOption')}
                                </SelectItem>
                                <SelectItem value="CUSTOM_LINK">
                                    {t('location.customLinkOption')}
                                </SelectItem>
                            </SelectContent>
                        </Select>
                        {locationMode === 'CUSTOM_LINK' && (
                            <div className="mt-2">
                                <Label className="text-caption text-neutral-600">
                                    {t('location.meetingLinkLabel')}
                                </Label>
                                <Input
                                    value={customLink}
                                    placeholder={t('location.meetingLinkPlaceholder')}
                                    onChange={(e) => setCustomLink(e.target.value)}
                                    className="mt-1"
                                />
                            </div>
                        )}
                    </div>

                    <div>
                        <div className="mb-1 text-caption font-semibold uppercase tracking-wide text-neutral-400">
                            {t('weeklyHours.heading')}
                        </div>
                        <p className="mb-2 text-caption text-neutral-400">
                            {t('weeklyHours.description')}
                        </p>
                        <div className="flex flex-col gap-2">
                            {DAYS.map((d) => {
                                const r = rows[d.key]!;
                                return (
                                    <div key={d.key} className="flex items-center gap-3">
                                        <div className="flex w-32 items-center gap-2">
                                            <Switch
                                                checked={r.enabled}
                                                onCheckedChange={(v) => setDay(d.key, { enabled: v })}
                                            />
                                            <span className="text-body text-neutral-700">{d.label}</span>
                                        </div>
                                        {r.enabled ? (
                                            <div className="flex items-center gap-2">
                                                <Input
                                                    type="time"
                                                    value={r.start}
                                                    onChange={(e) =>
                                                        setDay(d.key, { start: e.target.value })
                                                    }
                                                    className="w-32"
                                                />
                                                <span className="text-caption text-neutral-400">
                                                    {t('to')}
                                                </span>
                                                <Input
                                                    type="time"
                                                    value={r.end}
                                                    onChange={(e) => setDay(d.key, { end: e.target.value })}
                                                    className="w-32"
                                                />
                                            </div>
                                        ) : (
                                            <span className="text-caption text-neutral-400">
                                                {t('unavailable')}
                                            </span>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    <div>
                        <div className="mb-1 flex items-center justify-between">
                            <span className="text-caption font-semibold uppercase tracking-wide text-neutral-400">
                                {t('overrides.heading')}
                            </span>
                            <MyButton
                                type="button"
                                buttonType="text"
                                scale="small"
                                onClick={addOverride}
                                title={t('overrides.addDateTitle')}
                            >
                                <Plus size={14} /> {t('overrides.addDate')}
                            </MyButton>
                        </div>
                        <p className="mb-2 text-caption text-neutral-400">
                            {t('overrides.description')}
                        </p>
                        {overrides.length === 0 ? (
                            <p className="text-caption text-neutral-400">{t('overrides.empty')}</p>
                        ) : (
                            <div className="flex flex-col gap-2">
                                {overrides.map((o) => (
                                    <div key={o._id} className="flex flex-wrap items-center gap-2">
                                        <Input
                                            type="date"
                                            value={o.date}
                                            onChange={(e) =>
                                                patchOverride(o._id, { date: e.target.value })
                                            }
                                            className="w-40"
                                        />
                                        <Select
                                            value={o.blocked ? 'off' : 'custom'}
                                            onValueChange={(v) =>
                                                setOverrideMode(o._id, v as 'off' | 'custom')
                                            }
                                        >
                                            <SelectTrigger className="w-40">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="off">
                                                    {t('overrides.unavailable')}
                                                </SelectItem>
                                                <SelectItem value="custom">
                                                    {t('overrides.customHours')}
                                                </SelectItem>
                                            </SelectContent>
                                        </Select>
                                        {!o.blocked && (
                                            <div className="flex items-center gap-1">
                                                <Input
                                                    type="time"
                                                    value={o.windows?.[0]?.start_time ?? '09:00'}
                                                    onChange={(e) =>
                                                        setOverrideTime(o._id, {
                                                            start_time: e.target.value,
                                                        })
                                                    }
                                                    className="w-28"
                                                />
                                                <span className="text-caption text-neutral-400">
                                                    {t('to')}
                                                </span>
                                                <Input
                                                    type="time"
                                                    value={o.windows?.[0]?.end_time ?? '17:00'}
                                                    onChange={(e) =>
                                                        setOverrideTime(o._id, {
                                                            end_time: e.target.value,
                                                        })
                                                    }
                                                    className="w-28"
                                                />
                                            </div>
                                        )}
                                        <MyButton
                                            type="button"
                                            buttonType="text"
                                            scale="small"
                                            onClick={() => removeOverride(o._id)}
                                            aria-label={t('overrides.removeAriaLabel')}
                                            title={t('overrides.removeTitle')}
                                        >
                                            <Trash size={16} className="text-danger-500" />
                                        </MyButton>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <div>
                        <div className="mb-1 text-caption font-semibold uppercase tracking-wide text-neutral-400">
                            {t('sessionSettings.heading')}
                        </div>
                        <p className="mb-2 text-caption text-neutral-400">
                            {t('sessionSettings.description')}
                        </p>
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <div>
                                <Label className="text-caption text-neutral-600">
                                    {t('sessionSettings.defaultDuration')}
                                </Label>
                                <Select
                                    value={String(duration)}
                                    onValueChange={(v) => setDuration(Number(v))}
                                >
                                    <SelectTrigger className="mt-1">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {DURATIONS.map((m) => (
                                            <SelectItem key={m} value={String(m)}>
                                                {t('sessionSettings.minutesOption', { count: m })}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div>
                                <Label className="text-caption text-neutral-600">
                                    {t('sessionSettings.minimumNotice')}
                                </Label>
                                <Input
                                    type="number"
                                    min={0}
                                    value={minNoticeHours}
                                    onChange={(e) => setMinNoticeHours(Number(e.target.value))}
                                    className="mt-1"
                                />
                            </div>
                            <div>
                                <Label className="text-caption text-neutral-600">
                                    {t('sessionSettings.bufferBefore')}
                                </Label>
                                <Input
                                    type="number"
                                    min={0}
                                    value={bufferBefore}
                                    onChange={(e) => setBufferBefore(Number(e.target.value))}
                                    className="mt-1"
                                />
                            </div>
                            <div>
                                <Label className="text-caption text-neutral-600">
                                    {t('sessionSettings.bufferAfter')}
                                </Label>
                                <Input
                                    type="number"
                                    min={0}
                                    value={bufferAfter}
                                    onChange={(e) => setBufferAfter(Number(e.target.value))}
                                    className="mt-1"
                                />
                            </div>
                            <div>
                                <Label className="text-caption text-neutral-600">
                                    {t('sessionSettings.bookingHorizon')}
                                </Label>
                                <Input
                                    type="number"
                                    min={1}
                                    value={horizonDays}
                                    onChange={(e) => setHorizonDays(Number(e.target.value))}
                                    className="mt-1"
                                />
                            </div>
                        </div>
                    </div>

                    <div>
                        <div className="mb-1 flex items-center justify-between">
                            <span className="text-caption font-semibold uppercase tracking-wide text-neutral-400">
                                {t('sessionTypes.heading')}
                            </span>
                            <MyButton
                                type="button"
                                buttonType="text"
                                scale="small"
                                onClick={addSessionType}
                                title={t('sessionTypes.addTypeTitle')}
                            >
                                <Plus size={14} /> {t('sessionTypes.addType')}
                            </MyButton>
                        </div>
                        <p className="mb-2 text-caption text-neutral-400">
                            {t('sessionTypes.description')}
                        </p>
                        {sessionTypes.length === 0 ? (
                            <p className="text-caption text-neutral-400">
                                {t('sessionTypes.empty')}
                            </p>
                        ) : (
                            <div className="flex flex-col gap-2">
                                {sessionTypes.map((st) => (
                                    <div key={st.id} className="flex items-center gap-2">
                                        <Input
                                            value={st.name}
                                            placeholder={t('sessionTypes.namePlaceholder')}
                                            onChange={(e) =>
                                                updateSessionType(st.id!, { name: e.target.value })
                                            }
                                            className="flex-1"
                                        />
                                        <Select
                                            value={String(st.duration_minutes)}
                                            onValueChange={(v) =>
                                                updateSessionType(st.id!, {
                                                    duration_minutes: Number(v),
                                                })
                                            }
                                        >
                                            <SelectTrigger className="w-32">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {DURATIONS.map((m) => (
                                                    <SelectItem key={m} value={String(m)}>
                                                        {t('sessionTypes.minutesShortOption', {
                                                            count: m,
                                                        })}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        <MyButton
                                            type="button"
                                            buttonType="text"
                                            scale="small"
                                            onClick={() => removeSessionType(st.id!)}
                                            aria-label={t('sessionTypes.removeAriaLabel')}
                                            title={t('sessionTypes.removeTitle')}
                                        >
                                            <Trash size={16} className="text-danger-500" />
                                        </MyButton>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </MyDialog>
    );
}
