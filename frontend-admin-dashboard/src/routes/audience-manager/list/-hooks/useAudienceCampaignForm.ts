import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import {
    buildAudienceCampaignSchema,
    AudienceCampaignForm,
    defaultFormValues,
} from '../-schema/AudienceCampaignSchema';
import { useLeadTerminology } from '@/hooks/use-lead-terminology';

export const useAudienceCampaignForm = (initialValues?: AudienceCampaignForm) => {
    const [isSubmitting, setIsSubmitting] = useState(false);
    const { t } = useTranslation('audienceManagerAudienceCampaignSchema');
    const { campaignType: campaignTypeTerm } = useLeadTerminology();

    // Rebuilt from this hook's own `t` so the validation messages stay in sync with the
    // active locale (see buildAudienceCampaignSchema's doc comment in AudienceCampaignSchema.ts).
    const audienceCampaignSchema = useMemo(
        () => buildAudienceCampaignSchema(t, campaignTypeTerm),
        [t, campaignTypeTerm]
    );

    const form = useForm<AudienceCampaignForm>({
        resolver: zodResolver(audienceCampaignSchema),
        defaultValues: initialValues || defaultFormValues,
        mode: 'onChange',
    });

    const { setValue, getValues, reset } = form;

    const handleDateChange = (fieldName: 'start_date_local' | 'end_date_local', date: Date) => {
        setValue(fieldName, date.toISOString(), {
            shouldValidate: true,
            shouldDirty: true,
        });
    };

    const validateDateRange = (payload: Pick<AudienceCampaignForm, 'start_date_local' | 'end_date_local'>) => {
        const startDateValue = payload.start_date_local;
        const endDateValue = payload.end_date_local;
        const startDate = startDateValue ? new Date(startDateValue) : null;
        const endDate = endDateValue ? new Date(endDateValue) : null;

        if (!startDate || !endDate) {
            toast.error('Start and end dates are required');
            return false;
        }

        if (startDate >= endDate) {
            toast.error('End date must be after start date');
            return false;
        }
        return true;
    };

    const handleSubmit = (onSubmit: (data: AudienceCampaignForm) => Promise<void>) =>
        form.handleSubmit(async (data) => {
            if (!validateDateRange(data)) return;

            setIsSubmitting(true);
            try {
                await onSubmit(data);
                reset(initialValues || defaultFormValues);
            } catch (error) {
                console.error('Form submission error:', error);
            } finally {
                setIsSubmitting(false);
            }
        });

    const handleReset = () => {
        reset(initialValues || defaultFormValues);
    };

    return {
        form,
        handleDateChange,
        handleSubmit,
        handleReset,
        isSubmitting,
        getValues,
        setValue,
    };
};