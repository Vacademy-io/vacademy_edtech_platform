import { useMemo, useState } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { CheckCircle } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import PhoneInputField from '@/components/design-system/phone-input-field';
import { FormControl, FormField, FormItem } from '@/components/ui/form';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { phoneSchema } from '@/lib/phone-validation';
import { enterApp, Shell } from './SelfSignupFlow';
import {
    fetchProductOffer,
    fetchSignupConfig,
    signupErrorMessage,
    startDemo,
    type SignupContext,
    type SignupProductConfig,
} from '../-services/self-signup';

/**
 * The one-screen demo: name, email and phone, and the visitor is in the app with the demo
 * credits. One account per email (the backend refuses a repeat and points to log in).
 */
export const DemoSignup = ({ context }: { context: SignupContext }) => {
    const { t } = useTranslation('evalezy');
    const config = useQuery({
        queryKey: ['SELF_SIGNUP_CONFIG', context.product],
        queryFn: () => fetchSignupConfig(context.product),
        retry: false,
        staleTime: 60_000,
    });

    if (config.isLoading) return <DashboardLoader />;
    if (!config.data) {
        return (
            <Shell title={t('signup.closedTitle')} subtitle={t('signup.closedBody')}>
                <Link to="/login" className="text-body font-medium text-primary-500">
                    {t('signup.logIn')}
                </Link>
            </Shell>
        );
    }
    return <DemoForm context={context} product={config.data} />;
};

const DemoForm = ({
    context,
    product,
}: {
    context: SignupContext;
    product: SignupProductConfig;
}) => {
    const { t } = useTranslation('evalezy');
    const [error, setError] = useState<string | null>(null);
    const [alreadyRegistered, setAlreadyRegistered] = useState(false);
    const offer = useQuery({
        queryKey: ['PRODUCT_OFFER', context.product],
        queryFn: () => fetchProductOffer(context.product),
        retry: false,
        staleTime: 60_000,
    });
    const credits = offer.data?.demo_portal_credits ?? offer.data?.demo_credits ?? null;

    const schema = useMemo(
        () =>
            z.object({
                fullName: z.string().trim().min(2, t('signup.required')),
                email: z.string().trim().email(t('demo.emailInvalid')),
                phone: phoneSchema({ required: true, label: t('signup.phone') }),
            }),
        [t]
    );
    type Values = z.infer<typeof schema>;
    const form = useForm<Values>({
        resolver: zodResolver(schema),
        defaultValues: { fullName: '', email: '', phone: '' },
    });

    const start = useMutation({
        mutationFn: (values: Values) =>
            startDemo(context, {
                full_name: values.fullName,
                email: values.email,
                phone: values.phone ?? '',
            }),
        onSuccess: (tokens) => enterApp(tokens, product.app_path, { newAccount: true }),
        onError: (e) => {
            const status = (e as { response?: { status?: number } })?.response?.status;
            setAlreadyRegistered(status === 409);
            setError(
                status === 409
                    ? t('demo.alreadyUsed')
                    : signupErrorMessage(e) ?? t('signup.createFailed')
            );
        },
    });

    const textField = (name: 'fullName' | 'email', label: string, inputType = 'text') => (
        <FormField
            control={form.control}
            name={name}
            render={({ field }) => (
                <FormItem>
                    <FormControl>
                        <MyInput
                            label={label}
                            required
                            inputType={inputType}
                            input={field.value ?? ''}
                            onChangeFunction={field.onChange}
                            error={form.formState.errors[name]?.message}
                            className="w-full sm:w-full"
                        />
                    </FormControl>
                </FormItem>
            )}
        />
    );

    return (
        <Shell
            product={product}
            title={t('demo.title')}
            subtitle={
                credits != null
                    ? t('demo.subtitleCredits', { days: product.trial_days, credits })
                    : t('demo.subtitle', { days: product.trial_days })
            }
        >
            <FormProvider {...form}>
                <form
                    className="flex flex-col gap-3"
                    onSubmit={form.handleSubmit((values) => {
                        setError(null);
                        setAlreadyRegistered(false);
                        start.mutate(values);
                    })}
                >
                    {textField('fullName', t('signup.fullName'))}
                    {textField('email', t('signup.email'), 'email')}
                    <PhoneInputField
                        label={t('signup.phone')}
                        name="phone"
                        placeholder={t('signup.phone')}
                        control={form.control}
                        required
                        validate={false}
                    />
                    {error && (
                        <p role="alert" className="text-caption text-danger-600">
                            {error}{' '}
                            {alreadyRegistered && (
                                <Link to="/login" className="font-semibold underline">
                                    {t('signup.logIn')}
                                </Link>
                            )}
                        </p>
                    )}
                    <p className="flex items-start gap-1 text-caption text-neutral-500">
                        <CheckCircle size={14} className="mt-px shrink-0 text-success-600" />
                        {t('demo.note')}
                    </p>
                    <MyButton
                        type="submit"
                        buttonType="primary"
                        scale="large"
                        className="w-full"
                        disabled={start.isPending}
                    >
                        {start.isPending ? t('demo.starting') : t('demo.start')}
                    </MyButton>
                </form>
            </FormProvider>
            <p className="text-center text-caption text-neutral-500">
                {t('signup.haveAccount')}{' '}
                <Link to="/login" className="font-medium text-primary-500">
                    {t('signup.logIn')}
                </Link>
            </p>
        </Shell>
    );
};
