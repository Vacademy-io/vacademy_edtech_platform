import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { buildEnquirySchema, EnquiryForm, defaultEnquiryFormValues } from '../-schema/EnquirySchema';

export const useEnquiryForm = (initialValues?: EnquiryForm) => {
    const [isSubmitting, setIsSubmitting] = useState(false);
    const { t } = useTranslation('admissionsEnquirySchema');

    // Rebuilt from this hook's own `t` so the validation messages stay in sync with the
    // active locale (see buildEnquirySchema's doc comment in EnquirySchema.ts).
    const enquirySchema = useMemo(() => buildEnquirySchema(t), [t]);

    const form = useForm<EnquiryForm>({
        resolver: zodResolver(enquirySchema),
        defaultValues: initialValues || defaultEnquiryFormValues,
        mode: 'onChange',
    });

    const handleDateChange = (field: 'start_date_local' | 'end_date_local', value: string) => {
        form.setValue(field, value, {
            shouldValidate: true,
            shouldDirty: true,
        });
    };

    const handleSubmit = (onSubmit: (data: EnquiryForm) => Promise<void> | void) => {
        return form.handleSubmit(async (data) => {
            setIsSubmitting(true);
            try {
                await onSubmit(data);
            } finally {
                setIsSubmitting(false);
            }
        });
    };

    const handleReset = () => {
        form.reset(initialValues || defaultEnquiryFormValues);
    };

    return {
        form,
        handleDateChange,
        handleSubmit,
        handleReset,
        isSubmitting,
    };
};
