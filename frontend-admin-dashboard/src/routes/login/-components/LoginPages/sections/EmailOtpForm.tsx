import React, { useState, useRef, useEffect } from 'react';
import { z } from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useNavigate } from '@tanstack/react-router';
import axios from 'axios';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Form, FormControl, FormField, FormItem } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { MyInput } from '@/components/design-system/input';
import { MyButton } from '@/components/design-system/button';
import { motion, AnimatePresence } from 'framer-motion';
import { Mail, RefreshCw, Shield, ArrowRight } from 'lucide-react';

// Removed unused auth imports
import { LOGIN_OTP, REQUEST_OTP } from '@/constants/urls';
import { handleLoginFlow, navigateFromLoginFlow } from '@/lib/auth/loginFlowHandler';
import { trackEvent } from '@/lib/amplitude';
import { getCachedInstituteBranding } from '@/services/domain-routing';

const buildEmailSchema = (t: TFunction) =>
    z.object({
        email: z.string().email({ message: t('invalidEmail') }),
    });

const otpSchema = z.object({
    otp: z
        .array(z.string())
        .length(6)
        .transform((val) => val.join('')),
});

type EmailFormValues = { email: string };
type OtpFormValues = { otp: string[] };

export function EmailLogin({
    onSwitchToUsername,
    onSwitchToPhone,
    allowUsernamePasswordAuth: allowUsernamePasswordAuthProp,
    allowPhoneAuth: allowPhoneAuthProp,
}: {
    onSwitchToUsername: () => void;
    onSwitchToPhone?: () => void;
    allowUsernamePasswordAuth?: boolean;
    allowPhoneAuth?: boolean;
}) {
    const { t } = useTranslation('loginEmailOtpForm');
    const [isOtpSent, setIsOtpSent] = useState(false);
    const [email, setEmail] = useState('');
    const [timer, setTimer] = useState(0);
    const timerRef = useRef<NodeJS.Timeout | null>(null);
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const otpInputRefs = useRef<(HTMLInputElement | null)[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [allowSignup, setAllowSignup] = useState(false);
    const [allowUsernamePasswordAuth, setAllowUsernamePasswordAuth] = useState(false);
    const [allowPhoneAuth, setAllowPhoneAuth] = useState(false);

    const emailForm = useForm<EmailFormValues>({
        resolver: zodResolver(buildEmailSchema(t)),
        defaultValues: {
            email: '',
        },
    });

    const startTimer = () => {
        setTimer(60);
        if (timerRef.current) clearInterval(timerRef.current);

        timerRef.current = setInterval(() => {
            setTimer((prev) => {
                if (prev <= 1) {
                    clearInterval(timerRef.current!);
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);
    };

    useEffect(() => {
        try {
            const cached = getCachedInstituteBranding();
            if (cached) {
                setAllowSignup(cached.allowSignup !== false);
                setAllowUsernamePasswordAuth(cached.allowUsernamePasswordAuth !== false);
                setAllowPhoneAuth(cached.allowPhoneAuth !== false);
            }
        } catch (_e) {
            // ignore
        }
        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
        };
    }, []);

    const otpForm = useForm<OtpFormValues>({
        resolver: zodResolver(otpSchema),
        defaultValues: {
            otp: Array(6).fill(''),
        },
    });

    const sendOtpMutation = useMutation({
        mutationFn: (email: string) => {
            // institute_id decides which sender address and branding the OTP mail goes out with.
            // Without it the backend falls back to support@vacademy.io and Vacademy branding, so a
            // white-labelled portal mails its admins under the wrong name. The phone login on this
            // same page already reads the institute from the resolved domain branding.
            const instituteId = getCachedInstituteBranding()?.instituteId;
            return axios.post(
                REQUEST_OTP,
                { email, client_name: 'ADMIN', ...(instituteId && { institute_id: instituteId }) },
                {
                    headers: {
                        'Content-Type': 'application/json',
                        Accept: '*/*',
                    },
                }
            );
        },
        onMutate: () => {
            setIsLoading(true);
        },
        onSuccess: () => {
            setIsLoading(false);
            setIsOtpSent(true);
            startTimer();
            toast.success(t('toast.otpSent'));
        },
        onError: () => {
            setIsLoading(false);
            toast.error(t('toast.emailNotRegistered'), {
                description: t('toast.emailNotRegisteredDescription'),
                duration: 3000,
            });
        },
    });

    const verifyOtpMutation = useMutation({
        mutationFn: (data: { email: string; otp: string }) => {
            // Prepare request body according to backend API specification
            const requestBody = {
                user_name: data.email, // Using email as username
                password: '', // Empty password for OTP login
                client_name: 'ADMIN', // Client identifier
                institute_id: '', // Will be determined by backend
                email: data.email,
                otp: data.otp,
            };

            return axios.post(LOGIN_OTP, requestBody, {
                headers: {
                    'Content-Type': 'application/json',
                    Accept: '*/*',
                },
            });
        },
        onSuccess: async (response) => {
            // Track successful login
            trackEvent('Login Success', {
                login_method: 'email_otp',
                timestamp: new Date().toISOString(),
            });

            // Use centralized login flow
            const result = await handleLoginFlow({
                loginMethod: 'email_otp',
                accessToken: response.data.accessToken,
                refreshToken: response.data.refreshToken,
                queryClient,
            });

            if (result.shouldShowInstituteSelection) {
                // For email OTP, we'll redirect to institute selection page
                window.location.href = '/login?showInstituteSelection=true';
            } else {
                navigateFromLoginFlow(result);
            }
        },
        onError: () => {
            toast.error(t('toast.invalidOtp'), {
                description: t('toast.invalidOtpDescription'),
                duration: 3000,
            });
            otpForm.reset();
        },
    });

    const onEmailSubmit = (data: EmailFormValues) => {
        setEmail(data.email);
        sendOtpMutation.mutate(data.email);
    };

    const onOtpSubmit = () => {
        const otpArray = otpForm.getValues().otp;
        if (otpArray.every((val) => val !== '')) {
            verifyOtpMutation.mutate({
                email,
                otp: otpArray.join(''),
            });
        } else {
            setIsLoading(false);
            toast.error(t('toast.fillAllOtpFields'));
        }
    };

    const handleOtpPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
        e.preventDefault();

        const pastedData = e.clipboardData.getData('text');
        const digits = pastedData.replace(/[^0-9]/g, '').split('');
        const validDigits = digits.slice(0, 6);

        if (validDigits.length > 0) {
            const newOtp = Array(6).fill('');

            validDigits.forEach((digit, index) => {
                newOtp[index] = digit;
            });

            otpForm.setValue('otp', newOtp);

            const nextEmptyIndex = validDigits.length < 6 ? validDigits.length : 5;
            otpInputRefs.current[nextEmptyIndex]?.focus();
        }
    };

    const handleBackToEmail = () => {
        setIsOtpSent(false);
        setTimer(0);
        otpForm.reset();
    };

    const handleOtpChange = (element: HTMLInputElement, index: number) => {
        const value = element.value;
        if (value) {
            const newOtp = [...otpForm.getValues().otp];
            newOtp[index] = value.substring(0, 1);
            otpForm.setValue('otp', newOtp);

            if (index < 5 && value.length === 1) {
                otpInputRefs.current[index + 1]?.focus();
            }
        }
    };

    const handleOtpKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, index: number) => {
        const currentValue = otpForm.getValues().otp[index];

        if (e.key === 'Backspace') {
            if (!currentValue && index > 0) {
                const newOtp = [...otpForm.getValues().otp];
                newOtp[index - 1] = '';
                otpForm.setValue('otp', newOtp);
                otpInputRefs.current[index - 1]?.focus();
            } else if (currentValue) {
                const newOtp = [...otpForm.getValues().otp];
                newOtp[index] = '';
                otpForm.setValue('otp', newOtp);
            }
        }
    };

    return (
        <div className="w-full">
            <AnimatePresence mode="wait">
                {!isOtpSent ? (
                    <motion.div
                        key="email"
                        initial={{ opacity: 0, x: 30 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -30 }}
                        transition={{ duration: 0.2 }}
                    >
                        <Form {...emailForm}>
                            <form
                                onSubmit={emailForm.handleSubmit(onEmailSubmit)}
                                className="w-full"
                            >
                                <div className="flex w-full flex-col items-center justify-center gap-8 px-16">
                                    <FormField
                                        control={emailForm.control}
                                        name="email"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormControl>
                                                    <MyInput
                                                        inputType="email"
                                                        inputPlaceholder={t('emailPlaceholder')}
                                                        input={field.value}
                                                        onChangeFunction={field.onChange}
                                                        error={
                                                            emailForm.formState.errors.email
                                                                ?.message
                                                        }
                                                        required={true}
                                                        size="large"
                                                        label={t('emailLabel')}
                                                        // Real login identifier
                                                        // — keep browser fill.
                                                        autoComplete="email"
                                                        {...field}
                                                        className="w-[348px]"
                                                    />
                                                </FormControl>
                                            </FormItem>
                                        )}
                                    />
                                </div>
                                <div className="mt-10 flex flex-col items-center gap-1">
                                    <MyButton
                                        type="submit"
                                        scale="large"
                                        buttonType="primary"
                                        layoutVariant="default"
                                        disabled={isLoading}
                                        className="w-full"
                                    >
                                        {isLoading ? (
                                            <div className="flex items-center justify-center space-x-2">
                                                <motion.div
                                                    animate={{ rotate: 360 }}
                                                    transition={{
                                                        duration: 1,
                                                        repeat: Infinity,
                                                        ease: 'linear',
                                                    }}
                                                >
                                                    <RefreshCw className="size-4" />
                                                </motion.div>
                                                <span className="text-sm">{t('sendingCode')}</span>
                                            </div>
                                        ) : (
                                            <div className="flex items-center justify-center space-x-2">
                                                <Mail className="size-4" />
                                                <span className="text-sm">
                                                    {t('sendVerificationCode')}
                                                </span>
                                                <ArrowRight className="size-3" />
                                            </div>
                                        )}
                                    </MyButton>
                                </div>
                            </form>
                        </Form>
                    </motion.div>
                ) : (
                    <motion.div
                        key="otp"
                        initial={{ opacity: 0, x: 30 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -30 }}
                        transition={{ duration: 0.2 }}
                        className="w-full"
                    >
                        {/* OTP Header */}
                        <motion.div
                            initial={{ y: 10, opacity: 0 }}
                            animate={{ y: 0, opacity: 1 }}
                            transition={{ delay: 0.1 }}
                            className="mb-6 text-center"
                        >
                            <h3 className="mb-2 text-lg font-semibold text-gray-900">
                                {t('checkYourEmail')}
                            </h3>
                            <p className="text-sm text-gray-600">
                                {t('codeSentTo')}{' '}
                                <span className="font-medium text-gray-800">{email}</span>
                            </p>
                        </motion.div>

                        <Form {...otpForm}>
                            <form onSubmit={otpForm.handleSubmit(onOtpSubmit)} className="w-full">
                                <div className="flex w-full flex-col items-center justify-center gap-8 px-16">
                                    <div className="flex justify-center gap-2">
                                        {[0, 1, 2, 3, 4, 5].map((index) => (
                                            <FormField
                                                key={index}
                                                control={otpForm.control}
                                                name={`otp.${index}`}
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormControl>
                                                            <Input
                                                                {...field}
                                                                ref={(el) =>
                                                                (otpInputRefs.current[index] =
                                                                    el)
                                                                }
                                                                type="text"
                                                                inputMode="numeric"
                                                                maxLength={1}
                                                                className="size-12 rounded-lg border border-neutral-200 bg-white text-center text-lg font-semibold shadow-sm transition-colors hover:bg-neutral-50 focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
                                                                onChange={(e) =>
                                                                    handleOtpChange(e.target, index)
                                                                }
                                                                onKeyDown={(e) =>
                                                                    handleOtpKeyDown(e, index)
                                                                }
                                                                onPaste={(e) => handleOtpPaste(e)}
                                                            />
                                                        </FormControl>
                                                    </FormItem>
                                                )}
                                            />
                                        ))}
                                    </div>
                                    {otpForm.formState.errors.otp && (
                                        <div className="text-center text-sm text-red-600">
                                            {t('validOtpRequired')}
                                        </div>
                                    )}
                                </div>
                                <div className="mt-10 flex flex-col items-center gap-1">
                                    <MyButton
                                        type="submit"
                                        scale="large"
                                        buttonType="primary"
                                        layoutVariant="default"
                                        disabled={
                                            !otpForm
                                                .getValues()
                                                .otp.every((value) => value !== '') || isLoading
                                        }
                                        className="w-full"
                                    >
                                        {isLoading ? (
                                            <div className="flex items-center justify-center space-x-2">
                                                <motion.div
                                                    animate={{ rotate: 360 }}
                                                    transition={{
                                                        duration: 1,
                                                        repeat: Infinity,
                                                        ease: 'linear',
                                                    }}
                                                >
                                                    <RefreshCw className="size-4" />
                                                </motion.div>
                                                <span className="text-sm">{t('verifying')}</span>
                                            </div>
                                        ) : (
                                            <div className="flex items-center justify-center space-x-2">
                                                <Shield className="size-4" />
                                                <span className="text-sm">{t('verifyAndSignIn')}</span>
                                                <ArrowRight className="size-3" />
                                            </div>
                                        )}
                                    </MyButton>

                                    <div className="flex items-center justify-center space-x-3 text-sm">
                                        <button
                                            type="button"
                                            onClick={handleBackToEmail}
                                            className="hover:text-primary-600 text-primary-500 transition-colors"
                                        >
                                            {t('backToEmail')}
                                        </button>
                                        <div className="h-3 w-px bg-gray-300"></div>
                                        <button
                                            type="button"
                                            className={`transition-colors ${timer > 0
                                                    ? 'cursor-not-allowed text-gray-400'
                                                    : 'hover:text-primary-600 text-primary-500'
                                                }`}
                                            onClick={() =>
                                                timer === 0 && sendOtpMutation.mutate(email)
                                            }
                                            disabled={timer > 0}
                                        >
                                            {timer > 0 ? (
                                                <span>{t('resendIn', { count: timer })}</span>
                                            ) : (
                                                <span>{t('resendCode')}</span>
                                            )}
                                        </button>
                                    </div>
                                </div>
                            </form>
                        </Form>
                    </motion.div>
                )}
            </AnimatePresence>

            {(allowUsernamePasswordAuthProp ?? allowUsernamePasswordAuth) && (
                <div className="mt-6 text-center">
                    <button
                        type="button"
                        className="hover:text-primary-600 text-sm text-primary-500 transition-colors"
                        onClick={onSwitchToUsername}
                    >
                        {t('preferUsernameLogin')}
                    </button>
                </div>
            )}

            {(allowPhoneAuthProp ?? allowPhoneAuth) && onSwitchToPhone && (
                <div className="mt-2 text-center">
                    <button
                        type="button"
                        className="hover:text-primary-600 text-sm text-primary-500 transition-colors"
                        onClick={onSwitchToPhone}
                    >
                        {t('usePhoneOtpInstead')}
                    </button>
                </div>
            )}

            {allowSignup && (
                <div className="mt-4 text-center">
                    <p className="text-sm">
                        {t('noAccount')}&nbsp;&nbsp;
                        <span
                            className="cursor-pointer text-primary-500"
                            onClick={() => navigate({ to: '/signup' })}
                        >
                            {t('createOne')}
                        </span>
                    </p>
                </div>
            )}
        </div>
    );
}
