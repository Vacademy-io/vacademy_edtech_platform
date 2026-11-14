import { useEffect, useMemo, useState } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { CheckCircle, EnvelopeSimple, GoogleLogo } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import PhoneInputField from '@/components/design-system/phone-input-field';
import SelectField from '@/components/design-system/select-field';
import { FormControl, FormField, FormItem } from '@/components/ui/form';
import { handleLoginFlow } from '@/lib/auth/loginFlowHandler';
import { phoneSchema } from '@/lib/phone-validation';
import { isNative } from '@/native/platform';
import { INDIAN_GST_STATES } from '@/services/ai-credits/credit-pack-services';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { cn } from '@/lib/utils';
import { clearPlanBuyIntent, isPaidPlanKey, rememberPlanBuyIntent } from '@/lib/plan-buy-intent';
import {
    completeSignup,
    consumeGoogleReturn,
    fetchProductOffer,
    fetchSignupConfig,
    requestSignupOtp,
    signupErrorMessage,
    startGoogleSignup,
    verifySignupOtp,
    type SignupContext,
    type SignupProductConfig,
    type SignupTokens,
} from '../-services/self-signup';

const MAX_RESENDS = 3;
const RESEND_SECONDS = 30;

type Step = 'method' | 'otp' | 'details';

const INSTITUTE_TYPES = ['school', 'coaching', 'college', 'university', 'company', 'other'];
/** What each answer stores as the teacher count. */
const TEACHER_BANDS = [1, 5, 15, 16];

const enterApp = async (tokens: SignupTokens, appPath: string) => {
    await handleLoginFlow({
        loginMethod: 'signup',
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
    });
    window.location.href = appPath;
};

/**
 * Sign up and start a trial, on the website and in the app: prove the email (Google, or a code
 * by email), set a username and password unless Google is the login, tell us about the institute.
 */
export const SelfSignupFlow = ({ context, buy }: { context: SignupContext; buy?: string }) => {
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
    return <SignupSteps context={context} product={config.data} buy={buy} />;
};

const SignupSteps = ({
    context,
    product,
    buy,
}: {
    context: SignupContext;
    product: SignupProductConfig;
    /** ?buy=<plan> from the website's Buy button; ?plan= alone is still a trial. */
    buy?: string;
}) => {
    const { t } = useTranslation('evalezy');
    // Credits shown only when the dashboard sets them; a failed read keeps the plain line.
    const offer = useQuery({
        queryKey: ['PRODUCT_OFFER', context.product],
        queryFn: () => fetchProductOffer(context.product),
        retry: false,
        staleTime: 60_000,
    });
    const google = useMemo(() => consumeGoogleReturn(), []);
    const [step, setStep] = useState<Step>(google?.signupToken ? 'details' : 'method');
    const [email, setEmail] = useState(google?.email ?? '');
    const [otp, setOtp] = useState('');
    const [signupToken, setSignupToken] = useState(google?.signupToken ?? '');
    const [error, setError] = useState<string | null>(null);
    const [googleFailed, setGoogleFailed] = useState(!!google?.failed);
    const [resendsLeft, setResendsLeft] = useState(MAX_RESENDS);
    const [resendIn, setResendIn] = useState(0);
    const viaGoogle = !!google?.signupToken;
    // "Buy <plan>" on the website: same sign-up, then the app opens that plan's checkout.
    const buyPlan = isPaidPlanKey(buy) ? buy.trim().toLowerCase() : null;
    const buyPlanName = buyPlan
        ? offer.data?.plans?.find((p) => p.key?.toLowerCase() === buyPlan)?.name ??
          buyPlan.charAt(0).toUpperCase() + buyPlan.slice(1)
        : null;

    // Remembered, so it survives Google, or "I already have an account" → log in.
    useEffect(() => {
        if (buyPlan) rememberPlanBuyIntent(buyPlan, context.product);
        else clearPlanBuyIntent();
    }, [buyPlan, context.product]);

    // A Google account that already has a workspace comes back signed in.
    useEffect(() => {
        if (google?.tokens) void enterApp(google.tokens, product.app_path);
    }, [google, product.app_path]);

    useEffect(() => {
        if (resendIn <= 0) return;
        const timer = setTimeout(() => setResendIn((s) => s - 1), 1000);
        return () => clearTimeout(timer);
    }, [resendIn]);

    const onFail = (fallback: string) => (err: unknown) =>
        setError(signupErrorMessage(err) ?? fallback);

    const sendCode = useMutation({
        mutationFn: () => requestSignupOtp(context.product, email.trim()),
        onSuccess: () => {
            setError(null);
            setGoogleFailed(false);
            setResendIn(RESEND_SECONDS);
            setStep('otp');
        },
        onError: onFail(t('signup.sendFailed')),
    });

    const checkCode = useMutation({
        mutationFn: () => verifySignupOtp(context.product, email.trim(), otp.trim()),
        onSuccess: (token) => {
            setSignupToken(token);
            setError(null);
            setStep('details');
        },
        onError: onFail(t('signup.codeWrong')),
    });

    const emailValid = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email.trim());

    if (google?.tokens) {
        return <Shell product={product} title={t('signup.signingIn')} />;
    }

    return (
        <Shell
            product={product}
            buySteps={!!buyPlan}
            title={
                buyPlanName
                    ? t('signup.buyTitle', { plan: buyPlanName })
                    : step === 'details'
                      ? t('signup.detailsTitle')
                      : t('signup.title')
            }
            subtitle={
                buyPlanName
                    ? step === 'details'
                        ? t('signup.buyDetailsSubtitle', { plan: buyPlanName })
                        : t('signup.buySubtitle')
                    : step === 'details'
                      ? t('signup.detailsSubtitle', { days: product.trial_days })
                      : offer.data?.demo_credits != null
                        ? t('signup.subtitleCredits', {
                              days: product.trial_days,
                              credits: offer.data.demo_credits,
                          })
                        : t('signup.subtitle', { days: product.trial_days })
            }
        >
            {(error || googleFailed) && (
                <p
                    role="alert"
                    className="rounded-md bg-danger-50 p-2 text-caption text-danger-700"
                >
                    {error ?? t('signup.googleFailed')}
                </p>
            )}

            {step === 'method' && (
                <div className="flex flex-col gap-4">
                    {/* Google refuses sign-in inside an app's WebView, and the way back needs the app link. */}
                    {!isNative() && (
                        <>
                            <MyButton
                                type="button"
                                buttonType="secondary"
                                scale="large"
                                className="w-full"
                                onClick={() => startGoogleSignup(context, buyPlan)}
                            >
                                <GoogleLogo size={18} weight="bold" />
                                {t('signup.google')}
                            </MyButton>
                            <div className="flex items-center gap-3 text-caption text-neutral-400">
                                <span className="h-px flex-1 bg-neutral-200" />
                                {t('signup.orWord')}
                                <span className="h-px flex-1 bg-neutral-200" />
                            </div>
                        </>
                    )}
                    <form
                        className="flex flex-col gap-3"
                        onSubmit={(event) => {
                            event.preventDefault();
                            if (emailValid) sendCode.mutate();
                        }}
                    >
                        <MyInput
                            label={t('signup.email')}
                            required
                            inputType="email"
                            inputPlaceholder={t('signup.emailPlaceholder')}
                            input={email}
                            onChangeFunction={(e) => setEmail(e.target.value)}
                            className="w-full sm:w-full"
                        />
                        <MyButton
                            type="submit"
                            buttonType="primary"
                            scale="large"
                            className="w-full"
                            disabled={!emailValid || sendCode.isPending}
                        >
                            <EnvelopeSimple size={18} />
                            {sendCode.isPending ? t('signup.sending') : t('signup.sendCode')}
                        </MyButton>
                    </form>
                    <p className="text-center text-body text-neutral-500">
                        {t('signup.haveAccount')}{' '}
                        <Link to="/login" className="font-medium text-primary-500">
                            {t('signup.logIn')}
                        </Link>
                    </p>
                </div>
            )}

            {step === 'otp' && (
                <form
                    className="flex flex-col gap-3"
                    onSubmit={(event) => {
                        event.preventDefault();
                        if (otp.trim().length >= 4) checkCode.mutate();
                    }}
                >
                    <p className="text-body text-neutral-600">
                        {t('signup.codeSent', { email: email.trim() })}
                    </p>
                    <MyInput
                        label={t('signup.code')}
                        required
                        inputType="tel"
                        autoComplete="one-time-code"
                        input={otp}
                        onChangeFunction={(e) =>
                            setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))
                        }
                        className="w-full sm:w-full"
                    />
                    <MyButton
                        type="submit"
                        buttonType="primary"
                        scale="large"
                        className="w-full"
                        disabled={otp.trim().length < 4 || checkCode.isPending}
                    >
                        {checkCode.isPending ? t('signup.checking') : t('signup.verify')}
                    </MyButton>
                    <div className="flex items-center justify-between text-body">
                        <button
                            type="button"
                            className="text-neutral-500"
                            onClick={() => {
                                setOtp('');
                                setError(null);
                                setStep('method');
                            }}
                        >
                            {t('signup.changeEmail')}
                        </button>
                        <button
                            type="button"
                            className="font-medium text-primary-500 disabled:text-neutral-400"
                            disabled={resendIn > 0 || resendsLeft === 0 || sendCode.isPending}
                            onClick={() => {
                                setResendsLeft((n) => n - 1);
                                sendCode.mutate();
                            }}
                        >
                            {resendIn > 0
                                ? t('signup.resendIn', { seconds: resendIn })
                                : t('signup.resend')}
                        </button>
                    </div>
                </form>
            )}

            {step === 'details' && (
                <DetailsForm
                    context={context}
                    product={product}
                    signupToken={signupToken}
                    email={email.trim()}
                    googleName={google?.name}
                    viaGoogle={viaGoogle}
                    buying={!!buyPlan}
                    onError={setError}
                />
            )}
        </Shell>
    );
};

/** Choose plan (done) → Create account (here) → Pay, so a buyer expects the payment screen. */
const BuySteps = () => {
    const { t } = useTranslation('evalezy');
    const steps = [t('signup.steps.plan'), t('signup.steps.account'), t('signup.steps.pay')];
    return (
        <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-neutral-500">
            {steps.map((label, i) => (
                <li key={label} className="flex items-center gap-2">
                    <span
                        className={cn(
                            'flex size-5 items-center justify-center rounded-full text-caption font-semibold',
                            i === 0 && 'bg-success-100 text-success-700',
                            i === 1 && 'bg-primary-500 text-white',
                            i === 2 && 'bg-neutral-100 text-neutral-500'
                        )}
                    >
                        {i === 0 ? <CheckCircle size={12} weight="bold" /> : i + 1}
                    </span>
                    <span className={cn(i === 1 && 'font-semibold text-neutral-800')}>{label}</span>
                    {i < steps.length - 1 && <span className="text-neutral-300">→</span>}
                </li>
            ))}
        </ol>
    );
};

const Shell = ({
    product,
    title,
    subtitle,
    buySteps,
    children,
}: {
    product?: SignupProductConfig;
    title: string;
    subtitle?: string;
    buySteps?: boolean;
    children?: React.ReactNode;
}) => (
    <main className="min-h-screen-safe flex w-full min-w-0 flex-col items-center bg-neutral-50 p-4 sm:justify-center">
        <div className="flex w-full max-w-md flex-col gap-4 rounded-lg border border-neutral-200 bg-white p-5 sm:p-6">
            {product?.logo_url && (
                <img src={product.logo_url} alt={product.display_name} className="h-8 w-fit" />
            )}
            {buySteps && <BuySteps />}
            <div className="flex flex-col gap-1">
                <h1 className="text-h3 font-semibold text-neutral-800">{title}</h1>
                {subtitle && <p className="text-body text-neutral-500">{subtitle}</p>}
            </div>
            {children}
        </div>
    </main>
);

const DetailsForm = ({
    context,
    product,
    signupToken,
    email,
    googleName,
    viaGoogle,
    buying,
    onError,
}: {
    context: SignupContext;
    product: SignupProductConfig;
    signupToken: string;
    email: string;
    googleName?: string;
    viaGoogle: boolean;
    buying: boolean;
    onError: (message: string | null) => void;
}) => {
    const { t } = useTranslation('evalezy');
    const schema = useMemo(
        () =>
            z.object({
                fullName: z.string().trim().min(1, t('signup.required')),
                phone: phoneSchema({ required: true, label: t('signup.phone') }),
                username: viaGoogle
                    ? z.string().optional()
                    : z
                          .string()
                          .trim()
                          .regex(/^[A-Za-z0-9._-]{4,40}$/, t('signup.usernameInvalid')),
                password: viaGoogle
                    ? z.string().optional()
                    : z.string().min(8, t('signup.passwordShort')),
                instituteName: z.string().trim().min(1, t('signup.required')),
                instituteType: z.string().min(1, t('signup.required')),
                teachers: z.string().min(1, t('signup.required')),
                city: z.string().trim().min(1, t('signup.required')),
                state: z.string().min(1, t('signup.required')),
            }),
        [t, viaGoogle]
    );
    type Values = z.infer<typeof schema>;
    const form = useForm<Values>({
        resolver: zodResolver(schema),
        defaultValues: {
            fullName: googleName ?? '',
            phone: '',
            username: email ? email.split('@')[0]?.replace(/[^A-Za-z0-9._-]/g, '') : '',
            password: '',
            instituteName: '',
            instituteType: '',
            teachers: '',
            city: '',
            state: '',
        },
    });

    const create = useMutation({
        mutationFn: (values: Values) =>
            completeSignup(context, {
                signup_token: signupToken,
                full_name: values.fullName,
                phone: values.phone ?? '',
                username: viaGoogle ? undefined : values.username,
                password: viaGoogle ? undefined : values.password,
                institute_name: values.instituteName,
                institute_type: values.instituteType,
                city: values.city,
                state: values.state,
                teachers: Number(values.teachers),
            }),
        onSuccess: (tokens) => enterApp(tokens, product.app_path),
        onError: (error) => onError(signupErrorMessage(error) ?? t('signup.createFailed')),
    });

    const textField = (
        name: 'fullName' | 'username' | 'password' | 'instituteName' | 'city',
        label: string,
        inputType = 'text'
    ) => (
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
        <FormProvider {...form}>
            <form
                className="flex flex-col gap-3"
                onSubmit={form.handleSubmit((values) => {
                    onError(null);
                    create.mutate(values);
                })}
            >
                {email && (
                    <MyInput
                        label={t('signup.email')}
                        inputType="email"
                        input={email}
                        onChangeFunction={() => undefined}
                        disabled
                        className="w-full sm:w-full"
                    />
                )}
                {textField('fullName', t('signup.fullName'))}
                <PhoneInputField
                    label={t('signup.phone')}
                    name="phone"
                    placeholder={t('signup.phone')}
                    control={form.control}
                    required
                    validate={false}
                />
                {!viaGoogle && textField('username', t('signup.username'))}
                {!viaGoogle && textField('password', t('signup.password'), 'password')}
                {textField('instituteName', t('signup.instituteName'))}
                <SelectField
                    label={t('signup.instituteType')}
                    name="instituteType"
                    required
                    control={form.control}
                    options={INSTITUTE_TYPES.map((value) => ({
                        _id: value,
                        value,
                        label: t(`signup.types.${value}`),
                    }))}
                />
                <SelectField
                    label={t('signup.teachers')}
                    name="teachers"
                    required
                    control={form.control}
                    options={TEACHER_BANDS.map((value) => ({
                        _id: value,
                        value: String(value),
                        label: t(`signup.teacherBands.b${value}`),
                    }))}
                />
                {textField('city', t('signup.city'))}
                <SelectField
                    label={t('signup.state')}
                    name="state"
                    required
                    control={form.control}
                    options={INDIAN_GST_STATES.map((s) => ({
                        _id: s.code,
                        value: s.name,
                        label: s.name,
                    }))}
                />
                <p className="flex items-start gap-1 text-caption text-neutral-500">
                    <CheckCircle size={14} className="mt-px shrink-0 text-success-600" />
                    {buying ? t('signup.buyNote') : t('signup.noCard')}
                </p>
                <MyButton
                    type="submit"
                    buttonType="primary"
                    scale="large"
                    className="w-full"
                    disabled={create.isPending}
                >
                    {create.isPending
                        ? t('signup.creating')
                        : buying
                          ? t('signup.buyStart')
                          : t('signup.start', { days: product.trial_days })}
                </MyButton>
            </form>
        </FormProvider>
    );
};
