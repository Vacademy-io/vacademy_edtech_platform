import { useEffect, useMemo, type ReactNode } from 'react';
import { useForm, type Control } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Info } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { MyButton } from '@/components/design-system/button';
import { MultiSelect } from '@/components/design-system/multi-select';
import { Card } from '@/components/ui/card';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';
import {
    Form,
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from '@/components/ui/form';
import { reportApiError } from '@/lib/report-api-error';
import { HrTextField, HrTextareaField } from '@/routes/erp/people/-components/HrFormFields';
import { humanizeToken } from '@/routes/erp/people/-components/EmployeeFields';
import { HrErrorState, HrLoadingRows } from '@/routes/erp/people/-components/HrStates';
import type { AttendanceMode } from '@/routes/erp/-shared/hr-types';
import { useAttendanceConfig, useSaveAttendanceConfig } from '../-hooks/use-attendance';
import { WEEKDAYS, toBackendTime, toTimeInput } from './attendance-meta';

const buildSchema = (t: TFunction) =>
    z.object({
        mode: z.enum(['TIME_TRACKING', 'DAY_LEVEL']),
        timezone: z.string().trim().min(1, t('timezoneRequired')),
        weekend_days: z.array(z.string()),
        half_day_threshold_min: z.string().regex(/^\d*$/, t('wholeMinutesOnly')),
        overtime_enabled: z.boolean(),
        overtime_threshold_min: z.string().regex(/^\d*$/, t('wholeMinutesOnly')),
        auto_checkout_enabled: z.boolean(),
        auto_checkout_time: z.string(),
        geo_fence_enabled: z.boolean(),
        geo_fence_lat: z.string(),
        geo_fence_lng: z.string(),
        geo_fence_radius_m: z.string().regex(/^\d*$/, t('wholeMetresOnly')),
        ip_restriction_enabled: z.boolean(),
        allowed_ips: z.string(),
    });

type ConfigForm = z.infer<ReturnType<typeof buildSchema>>;

/**
 * The browser's own zone as the starting suggestion for an institute that has
 * never configured attendance. Guessing wrong here silently moves check-ins
 * across day boundaries, so an admin who is simply in the right place gets the
 * right answer without typing, and everyone else sees a real zone to correct.
 */
const browserTimezone = (): string => {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    } catch {
        return '';
    }
};

const numberOrUndefined = (value: string): number | undefined => {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const numeric = Number(trimmed);
    return Number.isFinite(numeric) ? numeric : undefined;
};

/** A section of the configuration, with the sentence that says why it exists. */
const Section = ({
    title,
    description,
    children,
}: {
    title: string;
    description: string;
    children: ReactNode;
}) => (
    <Card className="flex flex-col gap-4 p-4 sm:p-6">
        <div className="flex flex-col gap-1">
            <h3 className="text-subtitle font-medium text-foreground">{title}</h3>
            <p className="text-caption text-muted-foreground">{description}</p>
        </div>
        {children}
    </Card>
);

const ToggleRow = ({
    control,
    name,
    label,
    description,
}: {
    control: Control<ConfigForm>;
    name:
        | 'overtime_enabled'
        | 'auto_checkout_enabled'
        | 'geo_fence_enabled'
        | 'ip_restriction_enabled';
    label: string;
    description: string;
}) => (
    <FormField
        control={control}
        name={name}
        render={({ field }) => (
            <FormItem className="flex items-start justify-between gap-4 rounded-md border border-border p-3">
                <div className="flex flex-col gap-1">
                    <FormLabel className="text-body font-regular text-foreground">
                        {label}
                    </FormLabel>
                    <FormDescription className="text-caption text-muted-foreground">
                        {description}
                    </FormDescription>
                </div>
                <FormControl>
                    <Switch checked={!!field.value} onCheckedChange={field.onChange} />
                </FormControl>
            </FormItem>
        )}
    />
);

/**
 * How this institute records attendance.
 *
 * Everything here changes how a day is interpreted rather than what a day says,
 * so it is grouped by the decision it drives — the mode first, because it decides
 * whether half of the rest applies at all.
 */
export const AttendanceConfigTab = ({ isHrAdmin }: { isHrAdmin: boolean }) => {
    const { t } = useTranslation('erpAttendanceConfigTab');
    const query = useAttendanceConfig();
    const mutation = useSaveAttendanceConfig();

    const schema = useMemo(() => buildSchema(t), [t]);

    const form = useForm<ConfigForm>({
        resolver: zodResolver(schema),
        defaultValues: {
            mode: 'TIME_TRACKING',
            timezone: browserTimezone(),
            weekend_days: ['SATURDAY', 'SUNDAY'],
            half_day_threshold_min: '',
            overtime_enabled: false,
            overtime_threshold_min: '',
            auto_checkout_enabled: false,
            auto_checkout_time: '',
            geo_fence_enabled: false,
            geo_fence_lat: '',
            geo_fence_lng: '',
            geo_fence_radius_m: '',
            ip_restriction_enabled: false,
            allowed_ips: '',
        },
        mode: 'onBlur',
    });

    const config = query.data;
    useEffect(() => {
        if (!query.isSuccess) return;
        form.reset({
            mode: (config?.mode ?? 'TIME_TRACKING') as AttendanceMode,
            timezone: config?.timezone ?? browserTimezone(),
            weekend_days: config?.weekend_days ?? ['SATURDAY', 'SUNDAY'],
            half_day_threshold_min:
                config?.half_day_threshold_min === undefined ||
                config?.half_day_threshold_min === null
                    ? ''
                    : String(config.half_day_threshold_min),
            overtime_enabled: config?.overtime_enabled ?? false,
            overtime_threshold_min:
                config?.overtime_threshold_min === undefined ||
                config?.overtime_threshold_min === null
                    ? ''
                    : String(config.overtime_threshold_min),
            auto_checkout_enabled: config?.auto_checkout_enabled ?? false,
            auto_checkout_time: toTimeInput(config?.auto_checkout_time),
            geo_fence_enabled: config?.geo_fence_enabled ?? false,
            geo_fence_lat:
                config?.geo_fence_lat === undefined || config?.geo_fence_lat === null
                    ? ''
                    : String(config.geo_fence_lat),
            geo_fence_lng:
                config?.geo_fence_lng === undefined || config?.geo_fence_lng === null
                    ? ''
                    : String(config.geo_fence_lng),
            geo_fence_radius_m:
                config?.geo_fence_radius_m === undefined || config?.geo_fence_radius_m === null
                    ? ''
                    : String(config.geo_fence_radius_m),
            ip_restriction_enabled: config?.ip_restriction_enabled ?? false,
            allowed_ips: (config?.allowed_ips ?? []).join('\n'),
        });
    }, [query.isSuccess, config, form]);

    const onSubmit = async (values: ConfigForm) => {
        try {
            await mutation.mutateAsync({
                ...(config?.id ? { id: config.id } : {}),
                mode: values.mode,
                timezone: values.timezone.trim(),
                weekend_days: values.weekend_days,
                half_day_threshold_min: numberOrUndefined(values.half_day_threshold_min),
                overtime_enabled: values.overtime_enabled,
                overtime_threshold_min: numberOrUndefined(values.overtime_threshold_min),
                auto_checkout_enabled: values.auto_checkout_enabled,
                auto_checkout_time: toBackendTime(values.auto_checkout_time),
                geo_fence_enabled: values.geo_fence_enabled,
                geo_fence_lat: numberOrUndefined(values.geo_fence_lat),
                geo_fence_lng: numberOrUndefined(values.geo_fence_lng),
                geo_fence_radius_m: numberOrUndefined(values.geo_fence_radius_m),
                ip_restriction_enabled: values.ip_restriction_enabled,
                allowed_ips: values.allowed_ips
                    .split('\n')
                    .map((entry) => entry.trim())
                    .filter(Boolean),
            });
            toast.success(t('saveSuccess'));
        } catch (error) {
            reportApiError(error, {
                feature: 'erp-attendance',
                tags: { action: 'save-attendance-config' },
                fallbackMessage: t('saveError'),
            });
        }
    };

    if (query.isLoading) return <HrLoadingRows rows={4} />;
    if (query.isError) {
        return (
            <HrErrorState message={t('loadError')} onRetry={() => void query.refetch()} />
        );
    }

    const isTimeTracking = form.watch('mode') === 'TIME_TRACKING';

    return (
        <Form {...form}>
            <form className="flex flex-col gap-4" noValidate>
                {!config && (
                    <div className="flex items-start gap-2 rounded-md bg-info-50 p-3 text-caption text-neutral-600">
                        <Info size={16} className="mt-0.5 shrink-0 text-info-600" />
                        <span>{t('noConfigInfo')}</span>
                    </div>
                )}

                <Section title={t('modeSectionTitle')} description={t('modeSectionDescription')}>
                    <FormField
                        control={form.control}
                        name="mode"
                        render={({ field }) => (
                            <FormItem className="flex flex-col gap-3">
                                <FormControl>
                                    <RadioGroup
                                        value={field.value}
                                        onValueChange={field.onChange}
                                        className="flex flex-col gap-3"
                                        disabled={!isHrAdmin}
                                    >
                                        <label className="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3">
                                            <RadioGroupItem
                                                value="TIME_TRACKING"
                                                className="mt-1"
                                            />
                                            <span className="flex flex-col gap-1">
                                                <span className="text-body font-semibold text-foreground">
                                                    {t('timeTrackingLabel')}
                                                </span>
                                                <span className="text-caption text-muted-foreground">
                                                    {t('timeTrackingDescription')}
                                                </span>
                                            </span>
                                        </label>
                                        <label className="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3">
                                            <RadioGroupItem value="DAY_LEVEL" className="mt-1" />
                                            <span className="flex flex-col gap-1">
                                                <span className="text-body font-semibold text-foreground">
                                                    {t('dayLevelLabel')}
                                                </span>
                                                <span className="text-caption text-muted-foreground">
                                                    {t('dayLevelDescription')}
                                                </span>
                                            </span>
                                        </label>
                                    </RadioGroup>
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                </Section>

                <Section
                    title={t('timezoneSectionTitle')}
                    description={t('timezoneSectionDescription')}
                >
                    <HrTextField
                        control={form.control}
                        name="timezone"
                        label={t('timezoneLabel')}
                        required
                        disabled={!isHrAdmin}
                        placeholder="Asia/Dubai"
                        description={t('timezoneDescription')}
                    />
                </Section>

                <Section
                    title={t('weekendSectionTitle')}
                    description={t('weekendSectionDescription')}
                >
                    <FormField
                        control={form.control}
                        name="weekend_days"
                        render={({ field }) => (
                            <FormItem className="flex flex-col gap-1.5">
                                <FormLabel className="text-body font-regular text-foreground">
                                    {t('weekendLabel')}
                                </FormLabel>
                                <FormControl>
                                    <MultiSelect
                                        options={WEEKDAYS.map((day) => ({
                                            label: humanizeToken(day),
                                            value: day,
                                        }))}
                                        selected={field.value ?? []}
                                        onChange={field.onChange}
                                        disabled={!isHrAdmin}
                                        placeholder={t('weekendPlaceholder')}
                                    />
                                </FormControl>
                                <FormDescription className="text-caption text-muted-foreground">
                                    {t('weekendDescription')}
                                </FormDescription>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                </Section>

                <Section
                    title={t('thresholdsSectionTitle')}
                    description={t('thresholdsSectionDescription')}
                >
                    <div className="grid gap-4 sm:grid-cols-2">
                        <HrTextField
                            control={form.control}
                            name="half_day_threshold_min"
                            label={t('halfDayThresholdLabel')}
                            inputType="number"
                            disabled={!isHrAdmin}
                            description={t('halfDayThresholdDescription')}
                        />
                        <HrTextField
                            control={form.control}
                            name="overtime_threshold_min"
                            label={t('overtimeThresholdLabel')}
                            inputType="number"
                            disabled={!isHrAdmin || !form.watch('overtime_enabled')}
                            description={t('overtimeThresholdDescription')}
                        />
                    </div>
                    <ToggleRow
                        control={form.control}
                        name="overtime_enabled"
                        label={t('trackOvertimeLabel')}
                        description={t('trackOvertimeDescription')}
                    />
                </Section>

                {isTimeTracking && (
                    <Section
                        title={t('autoCheckoutSectionTitle')}
                        description={t('autoCheckoutSectionDescription')}
                    >
                        <ToggleRow
                            control={form.control}
                            name="auto_checkout_enabled"
                            label={t('closeOpenDaysLabel')}
                            description={t('closeOpenDaysDescription')}
                        />
                        <HrTextField
                            control={form.control}
                            name="auto_checkout_time"
                            label={t('autoCheckoutTimeLabel')}
                            inputType="time"
                            disabled={!isHrAdmin || !form.watch('auto_checkout_enabled')}
                        />
                    </Section>
                )}

                {isTimeTracking && (
                    <Section
                        title={t('geoFenceSectionTitle')}
                        description={t('geoFenceSectionDescription')}
                    >
                        <ToggleRow
                            control={form.control}
                            name="geo_fence_enabled"
                            label={t('restrictByLocationLabel')}
                            description={t('restrictByLocationDescription')}
                        />
                        <div className="grid gap-4 sm:grid-cols-3">
                            <HrTextField
                                control={form.control}
                                name="geo_fence_lat"
                                label={t('latitudeLabel')}
                                disabled={!isHrAdmin || !form.watch('geo_fence_enabled')}
                                placeholder="25.2048"
                            />
                            <HrTextField
                                control={form.control}
                                name="geo_fence_lng"
                                label={t('longitudeLabel')}
                                disabled={!isHrAdmin || !form.watch('geo_fence_enabled')}
                                placeholder="55.2708"
                            />
                            <HrTextField
                                control={form.control}
                                name="geo_fence_radius_m"
                                label={t('radiusLabel')}
                                inputType="number"
                                disabled={!isHrAdmin || !form.watch('geo_fence_enabled')}
                                placeholder="200"
                            />
                        </div>
                    </Section>
                )}

                {isTimeTracking && (
                    <Section
                        title={t('ipRestrictionSectionTitle')}
                        description={t('ipRestrictionSectionDescription')}
                    >
                        <ToggleRow
                            control={form.control}
                            name="ip_restriction_enabled"
                            label={t('restrictByNetworkLabel')}
                            description={t('restrictByNetworkDescription')}
                        />
                        <HrTextareaField
                            control={form.control}
                            name="allowed_ips"
                            label={t('allowedIpsLabel')}
                            rows={5}
                            disabled={!isHrAdmin || !form.watch('ip_restriction_enabled')}
                            placeholder={'203.0.113.7\n198.51.100.0/24'}
                            description={t('allowedIpsDescription')}
                        />
                    </Section>
                )}

                {!isTimeTracking && (
                    <p className="text-caption text-muted-foreground">{t('dayLevelHiddenNote')}</p>
                )}

                {isHrAdmin ? (
                    <div className="flex justify-end">
                        <MyButton
                            type="button"
                            buttonType="primary"
                            scale="medium"
                            onAsyncClick={form.handleSubmit(onSubmit)}
                            loadingText={t('savingLoading')}
                        >
                            {t('saveButton')}
                        </MyButton>
                    </div>
                ) : (
                    <p className="text-caption text-muted-foreground">{t('needsAdminNote')}</p>
                )}
            </form>
        </Form>
    );
};
