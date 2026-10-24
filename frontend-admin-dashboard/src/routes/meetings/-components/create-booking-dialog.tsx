import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import SelectField from '@/components/design-system/select-field';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { getInstituteId } from '@/constants/helper';
import { useCreateMeetingBooking } from '../-hooks/use-meetings';
import { browserTimezone, toIsoWithOffset } from '../-utils/meetings-utils';
import { PickedUser, UserSearchCombobox } from './user-search-combobox';

const buildDurationOptions = (t: TFunction) =>
    [15, 30, 45, 60].map((minutes) => ({
        _id: minutes,
        value: String(minutes),
        label: t('durationOption', { count: minutes }),
    }));

const buildCreateBookingSchema = (t: TFunction) =>
    z.object({
        title: z.string().min(1, t('schema.titleRequired')),
        date: z.string().min(1, t('schema.dateRequired')),
        startTime: z.string().min(1, t('schema.startTimeRequired')),
        durationMinutes: z.string().min(1, t('schema.durationRequired')),
        inviteeName: z.string().optional(),
        inviteeEmail: z.string().email(t('schema.emailInvalid')).optional().or(z.literal('')),
        inviteePhone: z.string().optional(),
    });

type CreateBookingFormValues = z.infer<ReturnType<typeof buildCreateBookingSchema>>;

/** Lead context used to pre-populate and link an on-behalf booking to a CRM lead. */
export interface CreateBookingPrefill {
    inviteeName?: string;
    inviteeEmail?: string;
    inviteePhone?: string;
    audienceResponseId?: string;
    inviteeUserId?: string;
}

interface CreateBookingDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** When provided (lead surfaces), invitee fields are prefilled and the
     *  booking is linked to the lead via audience_response_id / invitee_user_id. */
    prefill?: CreateBookingPrefill;
}

export const CreateBookingDialog = ({ open, onOpenChange, prefill }: CreateBookingDialogProps) => {
    const { t } = useTranslation('meetingsCreateBookingDialog');
    const instituteId = getInstituteId();
    const createBooking = useCreateMeetingBooking();
    const [participants, setParticipants] = useState<PickedUser[]>([]);
    const [allocateGoogleMeet, setAllocateGoogleMeet] = useState(true);

    const durationOptions = useMemo(() => buildDurationOptions(t), [t]);
    const createBookingSchema = useMemo(() => buildCreateBookingSchema(t), [t]);

    const defaultValues: CreateBookingFormValues = {
        title: '',
        date: '',
        startTime: '',
        durationMinutes: '30',
        inviteeName: prefill?.inviteeName ?? '',
        inviteeEmail: prefill?.inviteeEmail ?? '',
        inviteePhone: prefill?.inviteePhone ?? '',
    };

    const form = useForm<CreateBookingFormValues>({
        resolver: zodResolver(createBookingSchema),
        defaultValues,
    });

    // Re-apply the lead prefill each time the dialog opens — the hosting lead
    // side-view keeps this dialog mounted across lead switches, so defaults
    // captured at mount can go stale.
    useEffect(() => {
        if (open) {
            form.reset({
                ...defaultValues,
                inviteeName: prefill?.inviteeName ?? '',
                inviteeEmail: prefill?.inviteeEmail ?? '',
                inviteePhone: prefill?.inviteePhone ?? '',
            });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, prefill?.inviteeName, prefill?.inviteeEmail, prefill?.inviteePhone]);

    const resetAndClose = () => {
        form.reset(defaultValues);
        setParticipants([]);
        setAllocateGoogleMeet(true);
        onOpenChange(false);
    };

    const onSubmit = (values: CreateBookingFormValues) => {
        if (!instituteId) {
            toast.error(t('toast.missingInstitute'));
            return;
        }
        const startDateTime = new Date(`${values.date}T${values.startTime}`);
        createBooking.mutate(
            {
                institute_id: instituteId,
                title: values.title,
                start_time: toIsoWithOffset(startDateTime),
                duration_minutes: Number(values.durationMinutes),
                timezone: browserTimezone(),
                participant_user_ids:
                    participants.length > 0 ? participants.map((u) => u.id) : undefined,
                invitee_name: values.inviteeName || undefined,
                invitee_email: values.inviteeEmail || undefined,
                invitee_phone: values.inviteePhone || undefined,
                audience_response_id: prefill?.audienceResponseId || undefined,
                invitee_user_id: prefill?.inviteeUserId || undefined,
                allocate_google_meet: allocateGoogleMeet,
            },
            {
                onSuccess: () => {
                    toast.success(t('toast.scheduled'));
                    resetAndClose();
                },
                onError: () => {
                    toast.error(t('toast.scheduleFailed'));
                },
            }
        );
    };

    return (
        <MyDialog
            heading={t('heading')}
            open={open}
            onOpenChange={(next) => {
                // Esc / X / overlay dismissal must not leak form state into the
                // next open — mirror the cancel/submit reset path.
                if (!next) {
                    resetAndClose();
                } else {
                    onOpenChange(next);
                }
            }}
        >
            <Form {...form}>
                <form
                    id="create-meeting-form"
                    onSubmit={form.handleSubmit(onSubmit)}
                    className="flex flex-col gap-4"
                >
                    <FormField
                        control={form.control}
                        name="title"
                        render={({ field }) => (
                            <FormItem>
                                <FormControl>
                                    <MyInput
                                        label={t('titleLabel')}
                                        required
                                        inputType="text"
                                        inputPlaceholder={t('titlePlaceholder')}
                                        className="w-full sm:w-full"
                                        input={field.value}
                                        onChangeFunction={field.onChange}
                                    />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />

                    <div className="flex flex-col gap-4 sm:flex-row">
                        <FormField
                            control={form.control}
                            name="date"
                            render={({ field }) => (
                                <FormItem className="flex-1">
                                    <FormControl>
                                        <MyInput
                                            label={t('dateLabel')}
                                            required
                                            inputType="date"
                                            className="w-full sm:w-full"
                                            input={field.value}
                                            onChangeFunction={field.onChange}
                                        />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={form.control}
                            name="startTime"
                            render={({ field }) => (
                                <FormItem className="flex-1">
                                    <FormControl>
                                        <MyInput
                                            label={t('startTimeLabel')}
                                            required
                                            inputType="time"
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

                    <SelectField
                        label={t('durationLabel')}
                        name="durationMinutes"
                        options={durationOptions}
                        control={form.control}
                        required
                        className="w-full sm:w-full"
                    />

                    <div className="flex flex-col gap-1">
                        <Label className="text-subtitle font-regular">{t('participantsLabel')}</Label>
                        <UserSearchCombobox
                            instituteId={instituteId}
                            value={participants}
                            onChange={setParticipants}
                            mode="multi"
                        />
                    </div>

                    <div className="flex flex-col gap-4 rounded-lg border border-neutral-200 p-3">
                        <p className="text-body font-semibold text-neutral-600">
                            {prefill ? t('inviteeFromLead') : t('inviteeExternal')}
                        </p>
                        {prefill && (
                            <p className="-mt-3 text-caption text-neutral-500">
                                {t('prefilledFromLead')}
                            </p>
                        )}
                        <FormField
                            control={form.control}
                            name="inviteeName"
                            render={({ field }) => (
                                <FormItem>
                                    <FormControl>
                                        <MyInput
                                            label={t('inviteeNameLabel')}
                                            inputType="text"
                                            inputPlaceholder={t('inviteeNamePlaceholder')}
                                            className="w-full sm:w-full"
                                            input={field.value ?? ''}
                                            onChangeFunction={field.onChange}
                                        />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <div className="flex flex-col gap-4 sm:flex-row">
                            <FormField
                                control={form.control}
                                name="inviteeEmail"
                                render={({ field }) => (
                                    <FormItem className="flex-1">
                                        <FormControl>
                                            <MyInput
                                                label={t('inviteeEmailLabel')}
                                                inputType="email"
                                                inputPlaceholder={t('inviteeEmailPlaceholder')}
                                                className="w-full sm:w-full"
                                                input={field.value ?? ''}
                                                onChangeFunction={field.onChange}
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="inviteePhone"
                                render={({ field }) => (
                                    <FormItem className="flex-1">
                                        <FormControl>
                                            <MyInput
                                                label={t('inviteePhoneLabel')}
                                                inputType="tel"
                                                inputPlaceholder={t('inviteePhonePlaceholder')}
                                                className="w-full sm:w-full"
                                                input={field.value ?? ''}
                                                onChangeFunction={field.onChange}
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>
                    </div>

                    <div className="flex items-center justify-between rounded-lg border border-neutral-200 p-3">
                        <div>
                            <p className="text-body font-semibold text-neutral-600">
                                {t('allocateMeetTitle')}
                            </p>
                            <p className="text-caption text-neutral-500">
                                {t('allocateMeetDescription')}
                            </p>
                        </div>
                        <Switch checked={allocateGoogleMeet} onCheckedChange={setAllocateGoogleMeet} />
                    </div>

                    <div className="flex items-center justify-end gap-3 pt-2">
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="medium"
                            onClick={resetAndClose}
                            disable={createBooking.isPending}
                        >
                            {t('actions.cancel')}
                        </MyButton>
                        <MyButton
                            type="submit"
                            buttonType="primary"
                            scale="medium"
                            disable={createBooking.isPending}
                        >
                            {createBooking.isPending
                                ? t('actions.scheduling')
                                : t('actions.scheduleMeeting')}
                        </MyButton>
                    </div>
                </form>
            </Form>
        </MyDialog>
    );
};
