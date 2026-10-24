import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
    BellRinging,
    CalendarBlank,
    Info,
    ListChecks,
    MapPinLine,
    Plus,
    Trash,
} from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import SelectField from '@/components/design-system/select-field';
import { Form, FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { getUserId, getUserName } from '@/utils/userDetails';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    listTemplates,
    type WhatsAppTemplateDTO,
} from '@/routes/communication/whatsapp-templates/-services/template-api';
import { useCreateBookingPage, useUpdateBookingPage } from '../-hooks/use-meetings';
import {
    BookingFormField,
    BookingPageDTO,
    DayOfWeek,
    ReminderChannel,
    WeeklyWindow,
} from '../-types/meetings-types';
import { browserTimezone, COMMON_TIMEZONES } from '../-utils/meetings-utils';
import { PickedUser, UserSearchCombobox } from './user-search-combobox';
import {
    TemplateSearchableSelect,
    toTemplateOptions,
} from '@/components/templates/TemplateSearchableSelect';

/**
 * Section header used to break the long booking-page form into clearly
 * labelled, scannable groups (Basics, Availability, Location, …). Purely
 * presentational — no effect on the fields rendered underneath it.
 */
const FormSection = ({
    icon: Icon,
    title,
    description,
    action,
    children,
}: {
    icon: React.ComponentType<{ className?: string }>;
    title: string;
    description?: string;
    action?: React.ReactNode;
    children: React.ReactNode;
}) => (
    <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="flex items-start gap-2">
                <Icon className="mt-0.5 size-5 shrink-0 text-primary-500" />
                <div>
                    <h3 className="text-subtitle font-semibold text-neutral-800">{title}</h3>
                    {description && <p className="text-caption text-neutral-500">{description}</p>}
                </div>
            </div>
            {action && <div className="shrink-0">{action}</div>}
        </div>
        {children}
    </div>
);

const buildWeekdays = (t: TFunction): Array<{ day: DayOfWeek; label: string }> => [
    { day: 'MONDAY', label: t('days.monday') },
    { day: 'TUESDAY', label: t('days.tuesday') },
    { day: 'WEDNESDAY', label: t('days.wednesday') },
    { day: 'THURSDAY', label: t('days.thursday') },
    { day: 'FRIDAY', label: t('days.friday') },
    { day: 'SATURDAY', label: t('days.saturday') },
    { day: 'SUNDAY', label: t('days.sunday') },
];

const DEFAULT_ENABLED_DAYS = new Set<DayOfWeek>([
    'MONDAY',
    'TUESDAY',
    'WEDNESDAY',
    'THURSDAY',
    'FRIDAY',
]);

interface DayRow {
    day: DayOfWeek;
    enabled: boolean;
    start: string;
    end: string;
}

const buildDurationOptions = (t: TFunction) =>
    [15, 30, 45, 60].map((minutes) => ({
        _id: minutes,
        value: String(minutes),
        label: t('durationOption', { count: minutes }),
    }));

const buildMinNoticeOptions = (t: TFunction) => [
    { _id: 0, value: '0', label: t('noMinimumNotice') },
    { _id: 1, value: '1', label: t('hoursOption', { count: 1 }) },
    { _id: 2, value: '2', label: t('hoursOption', { count: 2 }) },
    { _id: 4, value: '4', label: t('hoursOption', { count: 4 }) },
    { _id: 12, value: '12', label: t('hoursOption', { count: 12 }) },
    { _id: 24, value: '24', label: t('daysOption', { count: 1 }) },
    { _id: 48, value: '48', label: t('daysOption', { count: 2 }) },
];

const buildReminderOffsetOptions = (t: TFunction) => [
    { _id: 'none', value: 'none', label: t('noReminder') },
    { _id: 30, value: '30', label: t('minutesBeforeOption', { count: 30 }) },
    { _id: 60, value: '60', label: t('hoursBeforeOption', { count: 1 }) },
    { _id: 1440, value: '1440', label: t('daysBeforeOption', { count: 1 }) },
];

const NO_AUDIENCE_VALUE = '__NONE__';

const buildBookingPageSchema = (t: TFunction) =>
    z.object({
        title: z.string().min(1, t('schema.titleRequired')),
        durationMinutes: z.string().min(1, t('schema.durationRequired')),
        timezone: z.string().min(1, t('schema.timezoneRequired')),
        minNoticeHours: z.string(),
        horizonDays: z
            .string()
            .refine(
                (v) => v === '' || (/^\d+$/.test(v) && Number(v) > 0),
                t('schema.horizonDaysInvalid')
            ),
        reminderOffset: z.string(),
        audienceId: z.string().optional(),
    });

type BookingPageFormValues = z.infer<ReturnType<typeof buildBookingPageSchema>>;

const buildInitialDays = (
    weekdays: Array<{ day: DayOfWeek; label: string }>,
    windows: WeeklyWindow[] | undefined
): DayRow[] =>
    weekdays.map(({ day }) => {
        const match = windows?.find((w) => w.day_of_week === day);
        return {
            day,
            enabled: windows ? !!match : DEFAULT_ENABLED_DAYS.has(day),
            start: match?.start_time ?? '10:00',
            end: match?.end_time ?? '17:00',
        };
    });

/** Booking values an admin can map a WhatsApp template variable to. */
const buildBookingFieldOptions = (t: TFunction): { value: string; label: string }[] => [
    { value: 'invitee_name', label: t('fieldOptions.inviteeName') },
    { value: 'meeting_datetime', label: t('fieldOptions.meetingDatetime') },
    { value: 'meeting_date', label: t('fieldOptions.meetingDate') },
    { value: 'meeting_time', label: t('fieldOptions.meetingTime') },
    { value: 'meet_link', label: t('fieldOptions.meetLink') },
    { value: 'host_name', label: t('fieldOptions.hostName') },
    { value: 'meeting_title', label: t('fieldOptions.meetingTitle') },
    { value: 'duration_minutes', label: t('fieldOptions.durationMinutes') },
];

// Template variables: prefer the template's semantic names, else parse {{n}} tokens.
const templateVars = (t?: WhatsAppTemplateDTO | null): string[] => {
    if (!t) return [];
    if (t.bodyVariableNames && t.bodyVariableNames.length) return t.bodyVariableNames;
    const found = new Set<string>();
    const re = /\{\{(\w+)\}\}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(t.bodyText || '')) !== null) if (m[1]) found.add(m[1]);
    return Array.from(found);
};

interface BookingPageFormProps {
    instituteId: string;
    /** Present → edit mode (PUT); absent → create mode (POST). */
    initialPage?: BookingPageDTO;
    /** Locks the audience list (Booking Settings opened from a campaign card). */
    fixedAudienceId?: string;
    defaultTitle?: string;
    /** Optional audience choices for the standalone manager. */
    audienceOptions?: Array<{ id: string; label: string }>;
    onSaved?: (page: BookingPageDTO) => void;
    onCancel?: () => void;
}

export const BookingPageForm = ({
    instituteId,
    initialPage,
    fixedAudienceId,
    defaultTitle,
    audienceOptions,
    onSaved,
    onCancel,
}: BookingPageFormProps) => {
    const { t } = useTranslation('meetingsBookingPageForm');
    const createPage = useCreateBookingPage();
    const updatePage = useUpdateBookingPage();
    const isEdit = !!initialPage?.id;
    const isSaving = createPage.isPending || updatePage.isPending;

    const currentUserId = getUserId();
    const currentUserName = getUserName();

    const weekdays = useMemo(() => buildWeekdays(t), [t]);
    const durationOptions = useMemo(() => buildDurationOptions(t), [t]);
    const minNoticeOptions = useMemo(() => buildMinNoticeOptions(t), [t]);
    const reminderOffsetOptions = useMemo(() => buildReminderOffsetOptions(t), [t]);
    const bookingFieldOptions = useMemo(() => buildBookingFieldOptions(t), [t]);
    const bookingPageSchema = useMemo(() => buildBookingPageSchema(t), [t]);

    const [host, setHost] = useState<PickedUser[]>(() => {
        if (initialPage?.host_user_id) {
            return [
                {
                    id: initialPage.host_user_id,
                    fullName: initialPage.host_name || t('defaultHostSelected'),
                    email: '',
                },
            ];
        }
        return currentUserId
            ? [{ id: currentUserId, fullName: currentUserName || t('defaultHostMe'), email: '' }]
            : [];
    });
    const [days, setDays] = useState<DayRow[]>(() =>
        buildInitialDays(weekdays, initialPage?.availability?.weekly_windows)
    );
    const [allocateGoogleMeet, setAllocateGoogleMeet] = useState(
        initialPage?.allocate_google_meet ?? true
    );
    const [requireApproval, setRequireApproval] = useState(initialPage?.require_approval ?? false);
    const [formFields, setFormFields] = useState<BookingFormField[]>(
        initialPage?.form_fields ?? []
    );
    const initialChannels = initialPage?.reminder_config?.channels;
    const [remindEmail, setRemindEmail] = useState(
        initialChannels ? initialChannels.includes('EMAIL') : true
    );
    const [remindWhatsapp, setRemindWhatsapp] = useState(
        initialChannels ? initialChannels.includes('WHATSAPP') : false
    );
    const [waTemplateName, setWaTemplateName] = useState(
        initialPage?.reminder_config?.whatsapp_template_name ?? ''
    );
    const [waVarMapping, setWaVarMapping] = useState<Record<string, string>>(
        initialPage?.reminder_config?.whatsapp_variable_mapping ?? {}
    );
    const waTemplatesQuery = useQuery({
        queryKey: ['wa-templates-booking', instituteId],
        queryFn: () => listTemplates(instituteId),
        enabled: !!instituteId && remindWhatsapp,
        staleTime: 60_000,
    });
    const waTemplates = (waTemplatesQuery.data ?? []).filter((tpl) => tpl.status === 'APPROVED');
    const selectedWaTemplate = waTemplates.find((tpl) => tpl.name === waTemplateName) ?? null;
    const waVars = templateVars(selectedWaTemplate);

    const timezoneOptions = useMemo(() => {
        const zones = new Set<string>(COMMON_TIMEZONES);
        zones.add(browserTimezone());
        if (initialPage?.timezone) zones.add(initialPage.timezone);
        return [...zones].map((zone) => ({ _id: zone, value: zone, label: zone }));
    }, [initialPage?.timezone]);

    const form = useForm<BookingPageFormValues>({
        resolver: zodResolver(bookingPageSchema),
        defaultValues: {
            title: initialPage?.title ?? defaultTitle ?? '',
            durationMinutes: String(initialPage?.duration_minutes ?? 30),
            timezone: initialPage?.timezone ?? browserTimezone(),
            minNoticeHours: String(
                initialPage?.min_notice_minutes != null
                    ? Math.round(initialPage.min_notice_minutes / 60)
                    : 2
            ),
            horizonDays: String(initialPage?.booking_horizon_days ?? 30),
            reminderOffset: initialPage?.reminder_config
                ? String(initialPage.reminder_config.before_meeting_offsets_minutes?.[0] ?? 'none')
                : '60',
            audienceId: initialPage?.audience_id ?? NO_AUDIENCE_VALUE,
        },
    });

    const setDayField = (day: DayOfWeek, patch: Partial<DayRow>) => {
        setDays((prev) => prev.map((row) => (row.day === day ? { ...row, ...patch } : row)));
    };

    const genFieldId = (): string =>
        typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : `q-${Math.floor(Math.random() * 1e9)}`;
    const addFormField = () =>
        setFormFields((prev) => [
            ...prev,
            { id: genFieldId(), label: '', field_type: 'text', required: false },
        ]);
    const updateFormField = (id: string, patch: Partial<BookingFormField>) =>
        setFormFields((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
    const removeFormField = (id: string) =>
        setFormFields((prev) => prev.filter((f) => f.id !== id));

    const onSubmit = (values: BookingPageFormValues) => {
        const enabledDays = days.filter((d) => d.enabled);
        if (enabledDays.length === 0) {
            toast.error(t('toast.enableOneDay'));
            return;
        }

        const channels: ReminderChannel[] = [];
        if (remindEmail) channels.push('EMAIL');
        if (remindWhatsapp) channels.push('WHATSAPP');

        // On UPDATE the backend treats '' as an explicit audience detach while
        // null/undefined leaves the audience unchanged — so "None" must map to
        // '' when editing, and stay omitted when creating.
        const pickedAudienceId =
            fixedAudienceId ??
            (values.audienceId && values.audienceId !== NO_AUDIENCE_VALUE
                ? values.audienceId
                : undefined);
        const audienceId = pickedAudienceId ?? (isEdit ? '' : undefined);

        const payload: BookingPageDTO = {
            institute_id: instituteId,
            audience_id: audienceId,
            host_user_id: host[0]?.id ?? currentUserId ?? undefined,
            title: values.title,
            duration_minutes: Number(values.durationMinutes),
            min_notice_minutes: Number(values.minNoticeHours) * 60,
            booking_horizon_days: values.horizonDays ? Number(values.horizonDays) : undefined,
            timezone: values.timezone,
            allocate_google_meet: allocateGoogleMeet,
            require_approval: requireApproval,
            availability: {
                weekly_windows: enabledDays.map((d) => ({
                    day_of_week: d.day,
                    start_time: d.start,
                    end_time: d.end,
                })),
            },
            reminder_config: {
                on_booking_confirmation: true,
                channels,
                before_meeting_offsets_minutes:
                    values.reminderOffset === 'none' ? [] : [Number(values.reminderOffset)],
                ...(remindWhatsapp && waTemplateName
                    ? {
                          whatsapp_template_name: waTemplateName,
                          whatsapp_language_code: selectedWaTemplate?.language ?? 'en',
                          whatsapp_variable_mapping: waVars.reduce(
                              (acc, v) => {
                                  acc[v] = waVarMapping[v] ?? '';
                                  return acc;
                              },
                              {} as Record<string, string>
                          ),
                      }
                    : {}),
            },
            form_fields: formFields
                .filter((f) => f.label.trim())
                .map((f) => ({
                    id: f.id,
                    label: f.label.trim(),
                    field_type: f.field_type,
                    required: !!f.required,
                    ...(f.field_type === 'dropdown'
                        ? { options: (f.options ?? []).map((o) => o.trim()).filter(Boolean) }
                        : {}),
                })),
        };

        const callbacks = {
            onSuccess: (page: BookingPageDTO) => {
                toast.success(isEdit ? t('toast.updated') : t('toast.created'));
                onSaved?.(page);
            },
            onError: () => {
                toast.error(
                    isEdit ? t('toast.updateFailed') : t('toast.createFailed')
                );
            },
        };

        if (isEdit && initialPage?.id) {
            updatePage.mutate({ id: initialPage.id, instituteId, data: payload }, callbacks);
        } else {
            createPage.mutate(payload, callbacks);
        }
    };

    return (
        <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-6">
                <FormSection
                    icon={Info}
                    title={t('basics.title')}
                    description={t('basics.description')}
                >
                    <FormField
                        control={form.control}
                        name="title"
                        render={({ field }) => (
                            <FormItem>
                                <FormControl>
                                    <MyInput
                                        label={t('basics.titleLabel')}
                                        required
                                        inputType="text"
                                        inputPlaceholder={t('basics.titlePlaceholder')}
                                        className="w-full sm:w-full"
                                        input={field.value}
                                        onChangeFunction={field.onChange}
                                    />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />

                    <div className="flex flex-col gap-1">
                        <Label className="text-subtitle font-regular">{t('basics.hostLabel')}</Label>
                        <p className="text-caption text-neutral-500">
                            {t('basics.hostDescription')}
                        </p>
                        <UserSearchCombobox
                            instituteId={instituteId}
                            value={host}
                            onChange={setHost}
                            mode="single"
                        />
                    </div>

                    <div className="flex flex-col gap-4 sm:flex-row">
                        <SelectField
                            label={t('basics.durationLabel')}
                            name="durationMinutes"
                            options={durationOptions}
                            control={form.control}
                            required
                            className="w-full flex-1 sm:w-full"
                        />
                        <SelectField
                            label={t('basics.timezoneLabel')}
                            name="timezone"
                            options={timezoneOptions}
                            control={form.control}
                            required
                            className="w-full flex-1 sm:w-full"
                        />
                    </div>

                    {!fixedAudienceId && audienceOptions && audienceOptions.length > 0 && (
                        <SelectField
                            label={t('basics.audienceLabel')}
                            name="audienceId"
                            options={[
                                {
                                    _id: NO_AUDIENCE_VALUE,
                                    value: NO_AUDIENCE_VALUE,
                                    label: t('basics.audienceNone'),
                                },
                                ...audienceOptions.map((option) => ({
                                    _id: option.id,
                                    value: option.id,
                                    label: option.label,
                                })),
                            ]}
                            control={form.control}
                            className="w-full sm:w-full"
                        />
                    )}
                </FormSection>

                <FormSection
                    icon={CalendarBlank}
                    title={t('availability.title')}
                    description={t('availability.description')}
                >
                    {/* Weekly availability */}
                    <div className="flex flex-col gap-2 rounded-lg border border-neutral-200 p-3">
                        <div>
                            <p className="text-body font-semibold text-neutral-600">
                                {t('availability.weeklyAvailability')}
                            </p>
                            <p className="text-caption text-neutral-500">
                                {t('availability.weeklyAvailabilityDescription')}
                            </p>
                        </div>
                        <div className="flex flex-col gap-2">
                            {days.map((row) => {
                                const meta = weekdays.find((w) => w.day === row.day)!;
                                return (
                                    <div
                                        key={row.day}
                                        className="flex flex-wrap items-center gap-2 sm:gap-3"
                                    >
                                        <label className="flex w-32 cursor-pointer items-center gap-2">
                                            <Checkbox
                                                checked={row.enabled}
                                                onCheckedChange={(checked) =>
                                                    setDayField(row.day, {
                                                        enabled: checked === true,
                                                    })
                                                }
                                            />
                                            <span className="text-body text-neutral-600">
                                                {meta.label}
                                            </span>
                                        </label>
                                        <div className="flex items-center gap-2">
                                            <Input
                                                type="time"
                                                value={row.start}
                                                disabled={!row.enabled}
                                                onChange={(e) =>
                                                    setDayField(row.day, { start: e.target.value })
                                                }
                                                className="h-9 w-28"
                                            />
                                            <span className="text-caption text-neutral-500">
                                                {t('availability.to')}
                                            </span>
                                            <Input
                                                type="time"
                                                value={row.end}
                                                disabled={!row.enabled}
                                                onChange={(e) =>
                                                    setDayField(row.day, { end: e.target.value })
                                                }
                                                className="h-9 w-28"
                                            />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    <div className="flex flex-col gap-1">
                        <div className="flex flex-col gap-4 sm:flex-row">
                            <SelectField
                                label={t('availability.minNoticeLabel')}
                                name="minNoticeHours"
                                options={minNoticeOptions}
                                control={form.control}
                                className="w-full flex-1 sm:w-full"
                            />
                            <FormField
                                control={form.control}
                                name="horizonDays"
                                render={({ field }) => (
                                    <FormItem className="flex-1">
                                        <FormControl>
                                            <MyInput
                                                label={t('availability.horizonLabel')}
                                                inputType="number"
                                                inputPlaceholder={t('availability.horizonPlaceholder')}
                                                className="w-full sm:w-full"
                                                input={field.value}
                                                onChangeFunction={field.onChange}
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>
                        <p className="text-caption text-neutral-500">{t('availability.footnote')}</p>
                    </div>
                </FormSection>

                <FormSection
                    icon={MapPinLine}
                    title={t('location.title')}
                    description={t('location.description')}
                >
                    <div className="flex items-center justify-between rounded-lg border border-neutral-200 p-3">
                        <div>
                            <p className="text-body font-semibold text-neutral-600">
                                {t('location.meetTitle')}
                            </p>
                            <p className="text-caption text-neutral-500">
                                {t('location.meetDescription')}
                            </p>
                        </div>
                        <Switch
                            checked={allocateGoogleMeet}
                            onCheckedChange={setAllocateGoogleMeet}
                        />
                    </div>

                    <div className="flex items-center justify-between rounded-lg border border-neutral-200 p-3">
                        <div>
                            <p className="text-body font-semibold text-neutral-600">
                                {t('location.approvalTitle')}
                            </p>
                            <p className="text-caption text-neutral-500">
                                {t('location.approvalDescription')}
                            </p>
                        </div>
                        <Switch checked={requireApproval} onCheckedChange={setRequireApproval} />
                    </div>
                </FormSection>

                <FormSection
                    icon={BellRinging}
                    title={t('reminders.title')}
                    description={t('reminders.description')}
                >
                    <div className="flex flex-col gap-3 rounded-lg border border-neutral-200 p-3">
                        <div className="flex flex-wrap items-center gap-4">
                            <label className="flex cursor-pointer items-center gap-2">
                                <Checkbox
                                    checked={remindEmail}
                                    onCheckedChange={(checked) => setRemindEmail(checked === true)}
                                />
                                <span className="text-body text-neutral-600">{t('reminders.email')}</span>
                            </label>
                            <label className="flex cursor-pointer items-center gap-2">
                                <Checkbox
                                    checked={remindWhatsapp}
                                    onCheckedChange={(checked) =>
                                        setRemindWhatsapp(checked === true)
                                    }
                                />
                                <span className="text-body text-neutral-600">{t('reminders.whatsapp')}</span>
                            </label>
                        </div>

                        {remindWhatsapp && (
                            <div className="flex flex-col gap-3 rounded-md border border-neutral-200 bg-neutral-50 p-3">
                                <div className="flex flex-col gap-1.5">
                                    <Label>{t('reminders.templateLabel')}</Label>
                                    <TemplateSearchableSelect
                                        options={toTemplateOptions(waTemplates)}
                                        value={waTemplateName || 'NONE'}
                                        onChange={(v) => setWaTemplateName(v === 'NONE' ? '' : v)}
                                        loading={waTemplatesQuery.isLoading}
                                        placeholder={t('reminders.templatePlaceholder')}
                                        emptyText={t('reminders.templateEmptyText')}
                                        noneOption={{
                                            value: 'NONE',
                                            label: t('reminders.noTemplateOption'),
                                        }}
                                    />
                                    {waTemplatesQuery.isLoading && (
                                        <p className="text-caption text-neutral-500">
                                            {t('reminders.loadingTemplates')}
                                        </p>
                                    )}
                                    {!waTemplatesQuery.isLoading && waTemplates.length === 0 && (
                                        <p className="text-caption text-warning-600">
                                            {t('reminders.noApprovedTemplates')}
                                        </p>
                                    )}
                                </div>

                                {selectedWaTemplate && (
                                    <div className="flex flex-col gap-2">
                                        {selectedWaTemplate.bodyText && (
                                            <p className="rounded bg-white p-2 text-caption text-neutral-600">
                                                {selectedWaTemplate.bodyText}
                                            </p>
                                        )}
                                        {waVars.length > 0 ? (
                                            <>
                                                <Label>{t('reminders.fillVariables')}</Label>
                                                {waVars.map((v) => (
                                                    <div
                                                        key={v}
                                                        className="flex items-center gap-2"
                                                    >
                                                        <span className="w-28 shrink-0 truncate text-caption font-medium text-neutral-600">
                                                            {`{{${v}}}`}
                                                        </span>
                                                        <Select
                                                            value={waVarMapping[v] || 'UNSET'}
                                                            onValueChange={(val) =>
                                                                setWaVarMapping((prev) => ({
                                                                    ...prev,
                                                                    [v]: val === 'UNSET' ? '' : val,
                                                                }))
                                                            }
                                                        >
                                                            <SelectTrigger className="flex-1">
                                                                <SelectValue placeholder={t('reminders.mapToPlaceholder')} />
                                                            </SelectTrigger>
                                                            <SelectContent>
                                                                <SelectItem value="UNSET">
                                                                    {t('reminders.notSet')}
                                                                </SelectItem>
                                                                {bookingFieldOptions.map((o) => (
                                                                    <SelectItem
                                                                        key={o.value}
                                                                        value={o.value}
                                                                    >
                                                                        {o.label}
                                                                    </SelectItem>
                                                                ))}
                                                            </SelectContent>
                                                        </Select>
                                                    </div>
                                                ))}
                                            </>
                                        ) : (
                                            <p className="text-caption text-neutral-500">
                                                {t('reminders.noVariables')}
                                            </p>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}
                        <div className="flex flex-col gap-1">
                            <SelectField
                                label={t('reminders.remindBeforeLabel')}
                                name="reminderOffset"
                                options={reminderOffsetOptions}
                                control={form.control}
                                className="w-full sm:w-full"
                            />
                            <p className="text-caption text-neutral-500">
                                {t('reminders.remindBeforeFootnote')}
                            </p>
                        </div>
                    </div>
                </FormSection>

                <FormSection
                    icon={ListChecks}
                    title={t('formQuestions.title')}
                    description={t('formQuestions.description')}
                    action={
                        <MyButton
                            type="button"
                            buttonType="text"
                            scale="small"
                            onClick={addFormField}
                        >
                            <Plus size={14} /> {t('formQuestions.addQuestion')}
                        </MyButton>
                    }
                >
                    <div className="rounded-lg border border-neutral-200 p-4">
                        {formFields.length === 0 ? (
                            <p className="text-caption text-neutral-400">
                                {t('formQuestions.empty')}
                            </p>
                        ) : (
                            <div className="flex flex-col gap-3">
                                {formFields.map((f) => (
                                    <div
                                        key={f.id}
                                        className="flex flex-col gap-2 rounded-md border border-neutral-100 p-3"
                                    >
                                        <div className="flex flex-wrap items-center gap-2">
                                            <Input
                                                value={f.label}
                                                placeholder={t('formQuestions.questionPlaceholder')}
                                                onChange={(e) =>
                                                    updateFormField(f.id, { label: e.target.value })
                                                }
                                                className="min-w-0 flex-1"
                                            />
                                            <Select
                                                value={f.field_type}
                                                onValueChange={(v) =>
                                                    updateFormField(f.id, { field_type: v })
                                                }
                                            >
                                                <SelectTrigger className="w-36">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="text">{t('formQuestions.fieldTypes.text')}</SelectItem>
                                                    <SelectItem value="textarea">
                                                        {t('formQuestions.fieldTypes.textarea')}
                                                    </SelectItem>
                                                    <SelectItem value="dropdown">
                                                        {t('formQuestions.fieldTypes.dropdown')}
                                                    </SelectItem>
                                                    <SelectItem value="number">{t('formQuestions.fieldTypes.number')}</SelectItem>
                                                    <SelectItem value="email">{t('formQuestions.fieldTypes.email')}</SelectItem>
                                                    <SelectItem value="phone">{t('formQuestions.fieldTypes.phone')}</SelectItem>
                                                </SelectContent>
                                            </Select>
                                            <label className="flex items-center gap-1.5 text-caption text-neutral-600">
                                                <Switch
                                                    checked={!!f.required}
                                                    onCheckedChange={(v) =>
                                                        updateFormField(f.id, { required: v })
                                                    }
                                                />
                                                {t('formQuestions.required')}
                                            </label>
                                            <MyButton
                                                type="button"
                                                buttonType="text"
                                                scale="small"
                                                onClick={() => removeFormField(f.id)}
                                            >
                                                <Trash size={16} className="text-danger-500" />
                                            </MyButton>
                                        </div>
                                        {f.field_type === 'dropdown' && (
                                            <Input
                                                value={(f.options ?? []).join(', ')}
                                                placeholder={t('formQuestions.optionsPlaceholder')}
                                                onChange={(e) =>
                                                    updateFormField(f.id, {
                                                        options: e.target.value.split(','),
                                                    })
                                                }
                                            />
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </FormSection>

                <div className="flex items-center justify-end gap-3 border-t border-neutral-200 pt-4">
                    {onCancel && (
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="medium"
                            onClick={onCancel}
                            disable={isSaving}
                        >
                            {t('actions.cancel')}
                        </MyButton>
                    )}
                    <MyButton type="submit" buttonType="primary" scale="medium" disable={isSaving}>
                        {isSaving
                            ? t('actions.saving')
                            : isEdit
                              ? t('actions.saveChanges')
                              : t('actions.createBookingPage')}
                    </MyButton>
                </div>
            </form>
        </Form>
    );
};
