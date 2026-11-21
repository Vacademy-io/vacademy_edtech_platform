/**
 * Settings → Payment reminders: the institute's reminder schedule for memberships
 * (FEE_REMINDER_SETTING, read by FeeReminderService) and calendar-month billing
 * (PAYMENT_SETTING.calendarMonthBilling). Both off by default.
 *
 * Reminders are sent by the institute's own workflow: each step fires the event
 * "Membership Payment Reminder" (and once, "Membership Payment Red List"), and the
 * workflow chooses the WhatsApp or email template.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Bell, CalendarBlank, Lightning } from '@phosphor-icons/react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { GET_INSITITUTE_SETTINGS } from '@/constants/urls';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';

const REMINDER_KEY = 'FEE_REMINDER_SETTING';
const PAYMENT_KEY = 'PAYMENT_SETTING';
const SAVE_URL = GET_INSITITUTE_SETTINGS.replace('/get', '/save-setting');
const QUERY_KEY = 'payment-reminder-settings';

interface ReminderSettings {
    enabled: boolean;
    days_before: number[];
    on_due_date: boolean;
    overdue_every_days: number;
    stop_after_days: number | null;
    red_list_after_days: number | null;
    include_autopay: boolean;
    send_hour: number;
}

const DEFAULTS: ReminderSettings = {
    enabled: false,
    days_before: [7],
    on_due_date: true,
    overdue_every_days: 2,
    stop_after_days: null,
    red_list_after_days: 15,
    include_autopay: false,
    send_hour: 9,
};

interface Loaded {
    reminders: ReminderSettings;
    /** The whole PAYMENT_SETTING data, kept so saving one flag never drops the others. */
    payment: Record<string, unknown>;
}

const getSetting = async (settingKey: string) => {
    const res = await authenticatedAxiosInstance.get(GET_INSITITUTE_SETTINGS, {
        params: { instituteId: getCurrentInstituteId(), settingKey },
    });
    return (res.data?.data ?? null) as Record<string, unknown> | null;
};

const saveSetting = (settingKey: string, name: string, data: unknown) =>
    authenticatedAxiosInstance.post(
        SAVE_URL,
        { setting_name: name, setting_data: data },
        { params: { instituteId: getCurrentInstituteId(), settingKey } }
    );

const load = async (): Promise<Loaded> => {
    const [r, p] = await Promise.all([getSetting(REMINDER_KEY), getSetting(PAYMENT_KEY)]);
    return { reminders: { ...DEFAULTS, ...(r ?? {}) } as ReminderSettings, payment: p ?? {} };
};

const parseDays = (text: string): number[] =>
    Array.from(
        new Set(
            text
                .split(/[,\s]+/)
                .map((x) => Number(x))
                .filter((n) => Number.isInteger(n) && n > 0 && n <= 60)
        )
    ).sort((a, b) => b - a);

const NumberField = ({
    id,
    label,
    hint,
    value,
    onChange,
    disabled,
}: {
    id: string;
    label: string;
    hint?: string;
    value: string;
    onChange: (v: string) => void;
    disabled?: boolean;
}) => (
    <div className="space-y-1">
        <Label htmlFor={id}>{label}</Label>
        <MyInput
            id={id}
            inputType="text"
            input={value}
            onChangeFunction={(e) => onChange(e.target.value)}
            disabled={disabled}
            className="w-full sm:w-40"
        />
        {hint && <p className="text-caption text-neutral-500">{hint}</p>}
    </div>
);

export default function PaymentReminderSettings() {
    const { t } = useTranslation('settingsPaymentReminders');
    const queryClient = useQueryClient();
    const { data, isLoading, isError, refetch } = useQuery({ queryKey: [QUERY_KEY], queryFn: load });

    const [r, setR] = useState<ReminderSettings>(DEFAULTS);
    const [daysText, setDaysText] = useState('7');
    const [calendar, setCalendar] = useState(false);
    const [dirty, setDirty] = useState(false);

    useEffect(() => {
        if (!data) return;
        setR(data.reminders);
        setDaysText(data.reminders.days_before.join(', '));
        setCalendar(Boolean(data.payment.calendarMonthBilling));
        setDirty(false);
    }, [data]);

    const patch = (p: Partial<ReminderSettings>) => {
        setR((prev) => ({ ...prev, ...p }));
        setDirty(true);
    };

    const { mutateAsync } = useMutation({
        mutationFn: async () => {
            const reminders: ReminderSettings = { ...r, days_before: parseDays(daysText) };
            await saveSetting(REMINDER_KEY, 'Payment reminders', reminders);
            if (Boolean(data?.payment.calendarMonthBilling) !== calendar) {
                // Read the latest copy again just before writing, so a change saved elsewhere is kept.
                const latest = (await getSetting(PAYMENT_KEY)) ?? {};
                await saveSetting(PAYMENT_KEY, 'Payment Settings', { ...latest, calendarMonthBilling: calendar });
            }
        },
        onSuccess: () => {
            toast.success(t('saved'));
            queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
        },
        onError: () => toast.error(t('saveFailed')),
    });

    const num = (v: string): number | null => {
        const n = Number(v);
        return v.trim() === '' || !Number.isFinite(n) || n <= 0 ? null : Math.round(n);
    };

    const days = parseDays(daysText);
    const summary = [
        ...days.map((d) => t('summary.before', { count: d })),
        ...(r.on_due_date ? [t('summary.due')] : []),
        ...(r.overdue_every_days > 0
            ? [
                  r.stop_after_days
                      ? t('summary.afterUntil', { every: r.overdue_every_days, until: r.stop_after_days })
                      : t('summary.after', { every: r.overdue_every_days }),
              ]
            : []),
    ];

    if (isLoading) {
        return (
            <div className="space-y-4 p-6">
                <Skeleton className="h-40 w-full" />
                <Skeleton className="h-28 w-full" />
            </div>
        );
    }
    if (isError) {
        return (
            <div className="flex items-center gap-3 p-6 text-body text-danger-600">
                {t('loadFailed')}
                <MyButton type="button" buttonType="text" scale="small" onClick={() => refetch()}>
                    {t('retry')}
                </MyButton>
            </div>
        );
    }

    return (
        <div className="space-y-6 p-6">
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Bell className="size-5 text-primary-500" />
                        {t('reminders.title')}
                    </CardTitle>
                    <CardDescription>{t('reminders.description')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="flex items-center gap-3">
                        <Switch
                            id="fee-reminders-enabled"
                            checked={r.enabled}
                            onCheckedChange={(v) => patch({ enabled: v })}
                        />
                        <Label htmlFor="fee-reminders-enabled" className="cursor-pointer">
                            {t('reminders.toggle')}
                        </Label>
                    </div>

                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <NumberField
                            id="fee-days-before"
                            label={t('reminders.daysBefore')}
                            hint={t('reminders.daysBeforeHint')}
                            value={daysText}
                            onChange={(v) => {
                                setDaysText(v);
                                setDirty(true);
                            }}
                            disabled={!r.enabled}
                        />
                        <div className="flex items-center gap-3 self-end pb-6">
                            <Switch
                                id="fee-on-due"
                                checked={r.on_due_date}
                                disabled={!r.enabled}
                                onCheckedChange={(v) => patch({ on_due_date: v })}
                            />
                            <Label htmlFor="fee-on-due">{t('reminders.onDueDate')}</Label>
                        </div>
                        <NumberField
                            id="fee-every"
                            label={t('reminders.every')}
                            hint={t('reminders.everyHint')}
                            value={r.overdue_every_days ? String(r.overdue_every_days) : ''}
                            onChange={(v) => patch({ overdue_every_days: num(v) ?? 0 })}
                            disabled={!r.enabled}
                        />
                        <NumberField
                            id="fee-stop"
                            label={t('reminders.stopAfter')}
                            hint={t('reminders.stopAfterHint')}
                            value={r.stop_after_days ? String(r.stop_after_days) : ''}
                            onChange={(v) => patch({ stop_after_days: num(v) })}
                            disabled={!r.enabled}
                        />
                        <NumberField
                            id="fee-red-list"
                            label={t('reminders.redList')}
                            hint={t('reminders.redListHint')}
                            value={r.red_list_after_days ? String(r.red_list_after_days) : ''}
                            onChange={(v) => patch({ red_list_after_days: num(v) })}
                            disabled={!r.enabled}
                        />
                        <NumberField
                            id="fee-hour"
                            label={t('reminders.sendHour')}
                            hint={t('reminders.sendHourHint')}
                            value={String(r.send_hour)}
                            onChange={(v) => {
                                const n = Number(v);
                                if (v.trim() === '' || (Number.isInteger(n) && n >= 0 && n <= 23)) {
                                    patch({ send_hour: v.trim() === '' ? 9 : n });
                                }
                            }}
                            disabled={!r.enabled}
                        />
                    </div>

                    <div className="flex items-center gap-3">
                        <Switch
                            id="fee-autopay"
                            checked={r.include_autopay}
                            disabled={!r.enabled}
                            onCheckedChange={(v) => patch({ include_autopay: v })}
                        />
                        <Label htmlFor="fee-autopay">{t('reminders.includeAutopay')}</Label>
                    </div>

                    {r.enabled && (
                        <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4 text-body text-neutral-700">
                            <p className="mb-1 font-semibold">{t('summary.title')}</p>
                            <p>{summary.length ? summary.join(' · ') : t('summary.none')}</p>
                            {r.red_list_after_days && (
                                <p className="mt-1 text-caption text-neutral-500">
                                    {t('summary.redList', { count: r.red_list_after_days })}
                                </p>
                            )}
                        </div>
                    )}

                    <div className="flex items-start gap-2 rounded-md bg-info-50 p-3 text-caption text-info-700 ring-1 ring-info-200">
                        <Lightning className="mt-0.5 size-4 shrink-0" />
                        <span>{t('reminders.workflowNote')}</span>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <CalendarBlank className="size-5 text-primary-500" />
                        {t('calendar.title')}
                    </CardTitle>
                    <CardDescription>{t('calendar.description')}</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="flex items-center gap-3">
                        <Switch
                            id="calendar-billing"
                            checked={calendar}
                            onCheckedChange={(v) => {
                                setCalendar(v);
                                setDirty(true);
                            }}
                        />
                        <Label htmlFor="calendar-billing" className="cursor-pointer">
                            {t('calendar.toggle')}
                        </Label>
                    </div>
                </CardContent>
            </Card>

            <div className="flex justify-end">
                <MyButton
                    type="button"
                    buttonType="primary"
                    scale="medium"
                    disable={!dirty}
                    onAsyncClick={() => mutateAsync()}
                    loadingText={t('saving')}
                >
                    {t('save')}
                </MyButton>
            </div>
        </div>
    );
}
