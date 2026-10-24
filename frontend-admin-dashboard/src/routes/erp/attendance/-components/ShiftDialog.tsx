import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { Switch } from '@/components/ui/switch';
import {
    Form,
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
} from '@/components/ui/form';
import { reportApiError } from '@/lib/report-api-error';
import { HrTextField } from '@/routes/erp/people/-components/HrFormFields';
import type { ShiftDTO } from '@/routes/erp/-shared/hr-types';
import { useSaveShift } from '../-hooks/use-attendance';
import { toBackendTime, toNumber, toTimeInput } from './attendance-meta';

const buildSchema = (t: TFunction) =>
    z.object({
        name: z.string().trim().min(1, t('validation.nameRequired')),
        code: z
            .string()
            .trim()
            .min(2, t('validation.codeMinLength'))
            .regex(/^[A-Z0-9_]+$/, t('validation.codeFormat')),
        start_time: z.string().min(1, t('validation.startTimeRequired')),
        end_time: z.string().min(1, t('validation.endTimeRequired')),
        break_duration_min: z.string().regex(/^\d*$/, t('validation.wholeMinutesOnly')),
        grace_period_min: z.string().regex(/^\d*$/, t('validation.wholeMinutesOnly')),
        min_hours_full_day: z.string().regex(/^\d*\.?\d*$/, t('validation.hoursExampleFull')),
        min_hours_half_day: z.string().regex(/^\d*\.?\d*$/, t('validation.hoursExampleHalf')),
        is_night_shift: z.boolean(),
        is_default: z.boolean(),
    });

type ShiftForm = z.infer<ReturnType<typeof buildSchema>>;

const emptyValues: ShiftForm = {
    name: '',
    code: '',
    start_time: '09:00',
    end_time: '18:00',
    break_duration_min: '60',
    grace_period_min: '15',
    min_hours_full_day: '8',
    min_hours_half_day: '4',
    is_night_shift: false,
    is_default: false,
};

/** A labelled switch — the two boolean shift settings both read as a sentence + toggle. */
const SwitchRow = ({
    control,
    name,
    label,
    description,
}: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    control: any;
    name: 'is_night_shift' | 'is_default';
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

interface ShiftDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** `null` to create; a shift to edit. */
    shift: ShiftDTO | null;
}

/**
 * Add or edit one shift.
 *
 * The hour thresholds are the load-bearing fields: they are what turns a pair of
 * check-in/check-out stamps into PRESENT, HALF_DAY or ABSENT, so a shift with no
 * thresholds produces days no rule can classify.
 */
export const ShiftDialog = ({ open, onOpenChange, shift }: ShiftDialogProps) => {
    const { t } = useTranslation('erpShiftDialog');
    const mutation = useSaveShift();
    const isEdit = !!shift?.id;

    const schema = useMemo(() => buildSchema(t), [t]);

    const form = useForm<ShiftForm>({
        resolver: zodResolver(schema),
        defaultValues: emptyValues,
        mode: 'onBlur',
    });

    useEffect(() => {
        if (!open) return;
        form.reset(
            shift
                ? {
                      name: shift.name ?? '',
                      code: (shift.code ?? '').toUpperCase(),
                      start_time: toTimeInput(shift.start_time),
                      end_time: toTimeInput(shift.end_time),
                      break_duration_min:
                          shift.break_duration_min === undefined ||
                          shift.break_duration_min === null
                              ? ''
                              : String(shift.break_duration_min),
                      grace_period_min:
                          shift.grace_period_min === undefined || shift.grace_period_min === null
                              ? ''
                              : String(shift.grace_period_min),
                      min_hours_full_day:
                          shift.min_hours_full_day === undefined ||
                          shift.min_hours_full_day === null
                              ? ''
                              : String(shift.min_hours_full_day),
                      min_hours_half_day:
                          shift.min_hours_half_day === undefined ||
                          shift.min_hours_half_day === null
                              ? ''
                              : String(shift.min_hours_half_day),
                      is_night_shift: shift.is_night_shift ?? false,
                      is_default: shift.is_default ?? false,
                  }
                : emptyValues
        );
    }, [open, shift, form]);

    const onSubmit = async (values: ShiftForm) => {
        try {
            await mutation.mutateAsync({
                ...(shift?.id ? { id: shift.id } : {}),
                name: values.name,
                code: values.code.toUpperCase(),
                // Time inputs give `HH:mm`; the backend's LocalTime parser wants seconds.
                start_time: toBackendTime(values.start_time),
                end_time: toBackendTime(values.end_time),
                break_duration_min: values.break_duration_min
                    ? Number(values.break_duration_min)
                    : 0,
                grace_period_min: values.grace_period_min ? Number(values.grace_period_min) : 0,
                min_hours_full_day: values.min_hours_full_day
                    ? toNumber(values.min_hours_full_day)
                    : undefined,
                min_hours_half_day: values.min_hours_half_day
                    ? toNumber(values.min_hours_half_day)
                    : undefined,
                is_night_shift: values.is_night_shift,
                is_default: values.is_default,
                // Preserved so an edit never silently retires a shift employees are on.
                status: shift?.status ?? 'ACTIVE',
            });
            toast.success(isEdit ? t('toast.updated') : t('toast.created'));
            onOpenChange(false);
        } catch (error) {
            reportApiError(error, {
                feature: 'erp-attendance',
                tags: { action: isEdit ? 'update-shift' : 'create-shift' },
                fallbackMessage: t('errors.save'),
            });
        }
    };

    return (
        <MyDialog
            heading={isEdit ? t('dialog.editHeading') : t('dialog.addHeading')}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-2xl"
            footer={
                <div className="flex justify-end gap-2">
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="medium"
                        onClick={() => onOpenChange(false)}
                    >
                        {t('cancel')}
                    </MyButton>
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="medium"
                        onAsyncClick={form.handleSubmit(onSubmit)}
                        loadingText={t('saving')}
                    >
                        {isEdit ? t('dialog.saveChanges') : t('dialog.createShift')}
                    </MyButton>
                </div>
            }
        >
            <Form {...form}>
                <form className="flex flex-col gap-4" noValidate>
                    <div className="grid gap-4 sm:grid-cols-2">
                        <HrTextField
                            control={form.control}
                            name="name"
                            label={t('fields.name')}
                            required
                            placeholder={t('fields.namePlaceholder')}
                        />
                        <HrTextField
                            control={form.control}
                            name="code"
                            label={t('fields.code')}
                            required
                            placeholder={t('fields.codePlaceholder')}
                            description={t('fields.codeDescription')}
                        />
                        <HrTextField
                            control={form.control}
                            name="start_time"
                            label={t('fields.startTime')}
                            inputType="time"
                            required
                        />
                        <HrTextField
                            control={form.control}
                            name="end_time"
                            label={t('fields.endTime')}
                            inputType="time"
                            required
                        />
                        <HrTextField
                            control={form.control}
                            name="break_duration_min"
                            label={t('fields.breakMinutes')}
                            inputType="number"
                            description={t('fields.breakDescription')}
                        />
                        <HrTextField
                            control={form.control}
                            name="grace_period_min"
                            label={t('fields.gracePeriodMinutes')}
                            inputType="number"
                            description={t('fields.gracePeriodDescription')}
                        />
                        <HrTextField
                            control={form.control}
                            name="min_hours_full_day"
                            label={t('fields.minHoursFullDay')}
                            inputType="number"
                        />
                        <HrTextField
                            control={form.control}
                            name="min_hours_half_day"
                            label={t('fields.minHoursHalfDay')}
                            inputType="number"
                        />
                    </div>

                    <SwitchRow
                        control={form.control}
                        name="is_night_shift"
                        label={t('switches.nightShiftLabel')}
                        description={t('switches.nightShiftDescription')}
                    />
                    <SwitchRow
                        control={form.control}
                        name="is_default"
                        label={t('switches.defaultShiftLabel')}
                        description={t('switches.defaultShiftDescription')}
                    />
                </form>
            </Form>
        </MyDialog>
    );
};
