import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { z } from 'zod';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { Form } from '@/components/ui/form';
import { readCommerceError } from '@/routes/commerce/-shared/commerce-errors';
import { useSaveMyPin } from '@/routes/commerce/-shared/commerce-hooks';
import {
    PIN_MAX_LENGTH,
    PIN_MIN_LENGTH,
    pinProblem,
    sanitizePinInput,
} from '@/routes/commerce/-shared/pin-rules';
import { CommerceTextField } from './CommerceFormFields';
import { CommerceErrorState } from './CommerceStates';

const buildSchema = (t: TFunction) =>
    z
        .object({
            pin: z.string().superRefine((pin, ctx) => {
                const problem = pinProblem(pin);
                if (problem === 'format') {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        message: t('setPin.validation.format', {
                            min: PIN_MIN_LENGTH,
                            max: PIN_MAX_LENGTH,
                        }),
                    });
                } else if (problem === 'trivial') {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        message: t('setPin.validation.trivial'),
                    });
                }
            }),
            confirm: z.string(),
        })
        .refine((values) => values.pin === values.confirm, {
            path: ['confirm'],
            message: t('setPin.validation.mismatch'),
        });

type SetPinValues = z.infer<ReturnType<typeof buildSchema>>;

const EMPTY: SetPinValues = { pin: '', confirm: '' };

interface SetPinDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** True when a PIN already exists: the wording becomes "change". */
    hasPin: boolean;
}

/**
 * "Set my PIN": a manager sets their OWN approval PIN (nobody can set one for
 * someone else). The PIN goes to the server and nowhere else.
 */
export function SetPinDialog({ open, onOpenChange, hasPin }: SetPinDialogProps) {
    const { t } = useTranslation('commerce');
    const mutation = useSaveMyPin();
    const [serverError, setServerError] = useState<string | null>(null);

    const schema = useMemo(() => buildSchema(t), [t]);
    const form = useForm<SetPinValues>({
        resolver: zodResolver(schema),
        defaultValues: EMPTY,
        mode: 'onBlur',
    });

    useEffect(() => {
        form.reset(EMPTY);
        setServerError(null);
    }, [open, form]);

    const onSubmit = async (values: SetPinValues) => {
        setServerError(null);
        try {
            await mutation.mutateAsync(values.pin);
            toast.success(hasPin ? t('setPin.toast.changed') : t('setPin.toast.set'));
            onOpenChange(false);
        } catch (error) {
            setServerError(readCommerceError(error, t('setPin.errors.failed')).message);
            form.reset(EMPTY);
        }
    };

    return (
        <MyDialog
            heading={hasPin ? t('setPin.headingChange') : t('setPin.headingSet')}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-md"
            footer={
                <div className="flex justify-end gap-2">
                    <MyButton
                        buttonType="secondary"
                        scale="medium"
                        type="button"
                        onClick={() => onOpenChange(false)}
                    >
                        {t('common.cancel')}
                    </MyButton>
                    <MyButton
                        buttonType="primary"
                        scale="medium"
                        type="button"
                        onAsyncClick={form.handleSubmit(onSubmit)}
                        loadingText={t('common.saving')}
                    >
                        {t('setPin.save')}
                    </MyButton>
                </div>
            }
        >
            <Form {...form}>
                <form className="flex flex-col gap-4" noValidate>
                    <p className="text-body text-muted-foreground">{t('setPin.description')}</p>
                    <CommerceTextField
                        control={form.control}
                        name="pin"
                        label={t('setPin.fields.pin')}
                        description={t('setPin.fields.pinHint', {
                            min: PIN_MIN_LENGTH,
                            max: PIN_MAX_LENGTH,
                        })}
                        inputType="password"
                        inputMode="numeric"
                        transform={sanitizePinInput}
                        required
                    />
                    <CommerceTextField
                        control={form.control}
                        name="confirm"
                        label={t('setPin.fields.confirm')}
                        inputType="password"
                        inputMode="numeric"
                        transform={sanitizePinInput}
                        required
                    />
                    {serverError && <CommerceErrorState message={serverError} />}
                </form>
            </Form>
        </MyDialog>
    );
}
