import React, { useState, useRef, useEffect, useMemo } from "react";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import axios, { AxiosError } from "axios";
import { useTranslation } from "react-i18next";

interface ErrorResponse {
    message?: string;
    ex?: string;
    responseCode?: string;
    url?: string;
    date?: string;
}
import { Form, FormControl, FormField, FormItem } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { motion, AnimatePresence } from "framer-motion";
import { Phone, ArrowLeft, RefreshCw, Shield, CheckCircle2 } from "lucide-react";
import PhoneInput from "react-phone-input-2";
import "react-phone-input-2/lib/bootstrap.css";

import { useQueryClient } from '@tanstack/react-query';
import { handleLoginFlow, navigateFromLoginFlow } from '@/lib/auth/loginFlowHandler';
import { trackEvent } from '@/lib/amplitude';
import { getCachedInstituteBranding, getPreferredPhoneCountries } from '@/services/domain-routing';
import { REQUEST_WHATSAPP_OTP, VERIFY_WHATSAPP_OTP_LOGIN } from "@/constants/urls";
import { phoneSchema as phoneValidationSchema } from "@/lib/phone-validation";

const phoneSchema = z.object({
    phone: phoneValidationSchema({ required: true, label: 'WhatsApp number' }),
});

const otpSchema = z.object({
    otp: z
        .array(z.string())
        .length(6)
        .transform((val) => val.join("")),
});

type PhoneFormValues = z.infer<typeof phoneSchema>;
type OtpFormValues = { otp: string[] };

export function PhoneLoginForm({
    onSwitchToUsername,
    onSwitchToEmail,
    type,
    courseId,
    onSwitchToSignup,
    allowUsernamePasswordAuth,
    allowEmailOtpAuth,
}: {
    onSwitchToUsername?: () => void;
    onSwitchToEmail?: () => void;
    type?: string;
    courseId?: string;
    onSwitchToSignup?: () => void;
    allowUsernamePasswordAuth?: boolean;
    allowEmailOtpAuth?: boolean;
}) {
    const { t } = useTranslation("loginPhoneLoginForm");
    const [isOtpSent, setIsOtpSent] = useState(false);
    const { defaultCountry, preferredCountries } = useMemo(
        () => getPreferredPhoneCountries(),
        [],
    );
    const [phoneDial, setPhoneDial] = useState("");
    const [timer, setTimer] = useState(0);
    const timerRef = useRef<NodeJS.Timeout | null>(null);
    const navigate = useNavigate();
    const otpInputRefs = useRef<(HTMLInputElement | null)[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const queryClient = useQueryClient();
    const domainRouting = getCachedInstituteBranding() || { instituteId: "" };

    const redirect = useRouterState({
        select: (s) =>
            (s.location.search as Record<string, unknown>).redirect ?? "/login/",
    });

    const phoneForm = useForm<PhoneFormValues>({
        resolver: zodResolver(phoneSchema),
        defaultValues: {
            phone: "",
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
        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
        };
    }, []);

    const otpForm = useForm<OtpFormValues>({
        resolver: zodResolver(otpSchema),
        defaultValues: {
            otp: Array(6).fill(""),
        },
    });

    const sendOtpMutation = useMutation({
        mutationFn: ({
            phone,
            instituteId,
        }: {
            phone: string;
            instituteId: string;
        }) => axios.post(REQUEST_WHATSAPP_OTP, { phone_number: phone, institute_id: instituteId }),
        onMutate: () => {
            setIsLoading(true);
        },
        onSuccess: () => {
            setIsLoading(false);
            setIsOtpSent(true);
            startTimer();
            toast.success(t("toast.otpSent"));
        },
        onError: (error: AxiosError<ErrorResponse>) => {
            setIsLoading(false);
            const errorData = error.response?.data;
            if (
                errorData?.ex === "User not found!" ||
                errorData?.responseCode === "User not found!"
            ) {
                toast.error(t("toast.accountNotFound"), {
                    duration: 5000,
                });
                setTimeout(() => {
                    if (onSwitchToSignup) {
                        onSwitchToSignup();
                    }
                }, 2000);
            } else if (errorData?.ex || errorData?.responseCode) {
                toast.error(
                    errorData.ex || errorData.responseCode || t("toast.sendOtpFailedFallback"),
                );
            } else {
                toast.error(t("toast.sendOtpFailedGeneric"));
            }
        },
    });

    const verifyOtpMutation = useMutation({
        mutationFn: (data: { phone: string; otp: string }) =>
            axios.post(VERIFY_WHATSAPP_OTP_LOGIN, { phone_number: data.phone, otp: data.otp, institute_id: domainRouting.instituteId }),
        onSuccess: async (response) => {
            try {
                if (!response.data || !response.data.accessToken) {
                    toast.error(t("toast.loginMissingCredentials"));
                    return;
                }

                trackEvent('Login Success', {
                    login_method: 'phone_otp',
                    timestamp: new Date().toISOString(),
                });

                const result = await handleLoginFlow({
                    loginMethod: 'phone_otp',
                    accessToken: response.data.accessToken,
                    refreshToken: response.data.refreshToken,
                    queryClient,
                });

                if (result.shouldShowInstituteSelection) {
                    window.location.href = '/login?showInstituteSelection=true';
                } else {
                    navigateFromLoginFlow(result);
                }
            } catch {
                toast.error(t("toast.loginProcessingError"));
            }
        },
        onError: (error: AxiosError<ErrorResponse>) => {
            const errorData = error.response?.data;
            if (errorData?.ex || errorData?.responseCode) {
                toast.error(errorData.ex || errorData.responseCode || t("toast.invalidOtpFallback"), {
                    duration: 5000,
                    description: t("toast.invalidOtpDescription"),
                });
            } else {
                toast.error(t("toast.invalidOtpFallback"), {
                    description: t("toast.invalidOtpGenericDescription"),
                    duration: 5000,
                });
            }
            otpForm.reset();
        },
        onSettled: () => {
            setIsLoading(false);
        },
    });

    const onPhoneSubmit = (data: PhoneFormValues) => {
        // Clean numeric phone for DB query (phone is validated as required by the
        // form schema, but the type is optional — guard so the build type-checks).
        const cleanedPhone = (data.phone ?? "").replace(/\D/g, "");
        setPhoneDial(cleanedPhone);
        const instituteId = domainRouting.instituteId || "";
        sendOtpMutation.mutate({ phone: cleanedPhone, instituteId });
    };

    const onOtpSubmit = () => {
        const otpArray = otpForm.getValues().otp;
        if (otpArray.every((val) => val !== "")) {
            verifyOtpMutation.mutate({
                phone: phoneDial,
                otp: otpArray.join(""),
            });
        } else {
            setIsLoading(false);
            toast.error(t("toast.fillAllOtpFields"));
        }
    };

    const handleOtpPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
        e.preventDefault();

        const pastedData = e.clipboardData.getData("text");
        const digits = pastedData.replace(/[^0-9]/g, "").split("");
        const validDigits = digits.slice(0, 6);

        if (validDigits.length > 0) {
            const newOtp = Array(6).fill("");

            validDigits.forEach((digit, index) => {
                newOtp[index] = digit;
            });

            otpForm.setValue("otp", newOtp);

            const nextEmptyIndex = validDigits.length < 6 ? validDigits.length : 5;
            otpInputRefs.current[nextEmptyIndex]?.focus();
        }
    };

    const handleBackToPhone = () => {
        setIsOtpSent(false);
        setTimer(0);
        otpForm.reset();
    };

    const handleOtpChange = (element: HTMLInputElement, index: number) => {
        const value = element.value;
        if (value) {
            const newOtp = [...otpForm.getValues().otp];
            newOtp[index] = value.substring(0, 1);
            otpForm.setValue("otp", newOtp);

            if (index < 5 && value.length === 1) {
                otpInputRefs.current[index + 1]?.focus();
            }
        }
    };

    const handleOtpKeyDown = (
        e: React.KeyboardEvent<HTMLInputElement>,
        index: number
    ) => {
        const currentValue = otpForm.getValues().otp[index];

        if (e.key === "Backspace") {
            if (!currentValue && index > 0) {
                const newOtp = [...otpForm.getValues().otp];
                newOtp[index - 1] = "";
                otpForm.setValue("otp", newOtp);
                otpInputRefs.current[index - 1]?.focus();
            } else if (currentValue) {
                const newOtp = [...otpForm.getValues().otp];
                newOtp[index] = "";
                otpForm.setValue("otp", newOtp);
            }
        }
    };

    return (
        <div className="w-full space-y-5">
            <AnimatePresence mode="wait">
                {!isOtpSent ? (
                    <motion.div
                        key="phone"
                        initial={{ opacity: 0, x: 30 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -30 }}
                        transition={{ duration: 0.2 }}
                    >
                        <Form {...phoneForm}>
                            <form
                                onSubmit={phoneForm.handleSubmit(onPhoneSubmit)}
                                className="space-y-4"
                            >
                                <motion.div
                                    initial={{ y: 10, opacity: 0 }}
                                    animate={{ y: 0, opacity: 1 }}
                                    transition={{ delay: 0.1 }}
                                    className="space-y-2 relative"
                                >
                                    <FormField
                                        control={phoneForm.control}
                                        name="phone"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormControl>
                                                    <div className="relative">
                                                        <label className="text-[13px] font-bold text-gray-700 block mb-1">{t("whatsappLabel")}</label>
                                                        <div className="relative flex-1">
                                                            <PhoneInput
                                                                country={defaultCountry}
                                                                preferredCountries={preferredCountries}
                                                                value={field.value}
                                                                onChange={(value) => field.onChange(value)}
                                                                inputClass={`!w-full !px-3 !py-2 !pl-12 !h-[45px] !bg-gray-50/50 hover:!bg-white !border ${phoneForm.formState.errors.phone ? "!border-red-300" : "!border-gray-200"} !rounded-lg !text-sm !font-medium focus:!bg-white focus:!ring-0`}
                                                                containerClass="!w-full"
                                                                buttonClass={`!rounded-l-lg !border-gray-200 !bg-gray-50/50 !w-10`}
                                                                dropdownClass="!rounded-lg !shadow-xl"
                                                            />
                                                        </div>
                                                        {phoneForm.formState.errors.phone && <p className="text-red-500 text-[10px] font-semibold mt-1">{phoneForm.formState.errors.phone.message}</p>}
                                                    </div>
                                                </FormControl>
                                            </FormItem>
                                        )}
                                    />
                                </motion.div>

                                <motion.div
                                    initial={{ y: 10, opacity: 0 }}
                                    animate={{ y: 0, opacity: 1 }}
                                    transition={{ delay: 0.2 }}
                                    className="pt-1"
                                >
                                    <motion.button
                                        type="submit"
                                        disabled={isLoading}
                                        whileHover={{ scale: 1.01 }}
                                        whileTap={{ scale: 0.99 }}
                                        className="w-full bg-primary-500 hover:bg-primary-400 text-white font-medium py-3 px-4 rounded-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm hover:shadow-md"
                                    >
                                        {isLoading ? (
                                            <div className="flex items-center justify-center space-x-2">
                                                <motion.div
                                                    animate={{ rotate: 360 }}
                                                    transition={{
                                                        duration: 1,
                                                        repeat: Infinity,
                                                        ease: "linear",
                                                    }}
                                                >
                                                    <RefreshCw className="w-4 h-4" />
                                                </motion.div>
                                                <span className="text-sm">{t("sendingOtp")}</span>
                                            </div>
                                        ) : (
                                            <div className="flex items-center justify-center space-x-2">
                                                <Phone className="w-4 h-4" />
                                                <span className="text-sm">{t("sendOtpWhatsapp")}</span>
                                            </div>
                                        )}
                                    </motion.button>
                                </motion.div>
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
                        className="space-y-5"
                    >
                        <motion.div
                            initial={{ y: 10, opacity: 0 }}
                            animate={{ y: 0, opacity: 1 }}
                            transition={{ delay: 0.1 }}
                            className="text-center space-y-3"
                        >
                            <motion.div
                                initial={{ scale: 0 }}
                                animate={{ scale: 1 }}
                                transition={{
                                    delay: 0.2,
                                    type: "spring",
                                }}
                                className="w-12 h-12 bg-gray-100 rounded-md mx-auto flex items-center justify-center"
                            >
                                <Phone className="w-6 h-6 text-gray-700" />
                            </motion.div>
                            <div className="space-y-1">
                                <h3 className="text-lg font-semibold text-gray-900">
                                    {t("checkWhatsapp")}
                                </h3>
                                <p className="text-sm text-gray-600">
                                    {t("codeSentTo")}
                                </p>
                                <motion.div
                                    initial={{ scale: 0.9, opacity: 0 }}
                                    animate={{ scale: 1, opacity: 1 }}
                                    transition={{ delay: 0.3 }}
                                    className="inline-flex items-center space-x-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-1"
                                >
                                    <CheckCircle2 className="w-3 h-3 text-gray-600" />
                                    <span className="text-sm font-medium text-gray-800">
                                        +{phoneDial}
                                    </span>
                                </motion.div>
                            </div>
                        </motion.div>

                        <Form {...otpForm}>
                            <form
                                onSubmit={otpForm.handleSubmit(onOtpSubmit)}
                                className="space-y-4"
                            >
                                <motion.div
                                    initial={{ y: 10, opacity: 0 }}
                                    animate={{ y: 0, opacity: 1 }}
                                    transition={{ delay: 0.4 }}
                                    className="space-y-3"
                                >
                                    <div className="flex justify-center gap-2">
                                        {[0, 1, 2, 3, 4, 5].map((index) => (
                                            <motion.div
                                                key={index}
                                                initial={{
                                                    scale: 0,
                                                    opacity: 0,
                                                }}
                                                animate={{
                                                    scale: 1,
                                                    opacity: 1,
                                                }}
                                                transition={{
                                                    delay: 0.5 + index * 0.03,
                                                }}
                                            >
                                                <FormField
                                                    control={otpForm.control}
                                                    name={`otp.${index}`}
                                                    render={({ field }) => (
                                                        <FormItem>
                                                            <FormControl>
                                                                <Input
                                                                    {...field}
                                                                    ref={(el) =>
                                                                        (otpInputRefs.current[index] = el)
                                                                    }
                                                                    type="text"
                                                                    inputMode="numeric"
                                                                    maxLength={1}
                                                                    className="h-12 w-12 text-center text-lg font-semibold border border-gray-200 rounded-lg transition-all duration-200 focus:border-gray-400 focus:ring-2 focus:ring-gray-100 hover:border-gray-300 bg-white shadow-sm"
                                                                    onChange={(e) =>
                                                                        handleOtpChange(e.target, index)
                                                                    }
                                                                    onKeyDown={(e) => handleOtpKeyDown(e, index)}
                                                                    onPaste={(e) => handleOtpPaste(e)}
                                                                />
                                                            </FormControl>
                                                        </FormItem>
                                                    )}
                                                />
                                            </motion.div>
                                        ))}
                                    </div>
                                </motion.div>

                                <motion.div
                                    initial={{ y: 10, opacity: 0 }}
                                    animate={{ y: 0, opacity: 1 }}
                                    transition={{ delay: 0.6 }}
                                    className="space-y-3"
                                >
                                    <motion.button
                                        type="submit"
                                        disabled={
                                            !otpForm.getValues().otp.every((value) => value !== "") ||
                                            isLoading
                                        }
                                        whileHover={{ scale: 1.01 }}
                                        whileTap={{ scale: 0.99 }}
                                        className="w-full bg-primary-500 hover:bg-primary-400 text-white font-medium py-3 px-4 rounded-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm hover:shadow-md"
                                    >
                                        {isLoading ? (
                                            <div className="flex items-center justify-center space-x-2">
                                                <motion.div
                                                    animate={{ rotate: 360 }}
                                                    transition={{
                                                        duration: 1,
                                                        repeat: Infinity,
                                                        ease: "linear",
                                                    }}
                                                >
                                                    <RefreshCw className="w-4 h-4" />
                                                </motion.div>
                                                <span className="text-sm">{t("verifying")}</span>
                                            </div>
                                        ) : (
                                            <div className="flex items-center justify-center space-x-2">
                                                <Shield className="w-4 h-4" />
                                                <span className="text-sm">{t("verifyAndSignIn")}</span>
                                            </div>
                                        )}
                                    </motion.button>

                                    <div className="flex justify-center items-center space-x-3 text-sm">
                                        <motion.button
                                            type="button"
                                            onClick={handleBackToPhone}
                                            whileHover={{ scale: 1.02 }}
                                            whileTap={{ scale: 0.98 }}
                                            className="flex items-center space-x-1 text-gray-500 hover:text-gray-700 transition-colors duration-200 font-medium"
                                        >
                                            <ArrowLeft className="w-3 h-3" />
                                            <span className="text-xs">{t("backToPhoneEntry")}</span>
                                        </motion.button>

                                        <div className="w-px h-3 bg-gray-300"></div>

                                        <motion.button
                                            type="button"
                                            whileHover={timer === 0 ? { scale: 1.02 } : {}}
                                            whileTap={timer === 0 ? { scale: 0.98 } : {}}
                                            className={`transition-colors duration-200 font-medium ${timer > 0
                                                ? "text-gray-400 cursor-not-allowed"
                                                : "text-gray-700 hover:text-gray-900"
                                                }`}
                                            onClick={() =>
                                                timer === 0 &&
                                                sendOtpMutation.mutate({
                                                    phone: phoneDial,
                                                    instituteId: domainRouting.instituteId || "",
                                                })
                                            }
                                            disabled={timer > 0}
                                        >
                                            {timer > 0 ? (
                                                <div className="flex items-center space-x-1">
                                                    <RefreshCw className="w-3 h-3" />
                                                    <span className="text-xs">{t("resendIn", { count: timer })}</span>
                                                </div>
                                            ) : (
                                                <div className="flex items-center space-x-1">
                                                    <RefreshCw className="w-3 h-3" />
                                                    <span className="text-xs">{t("resendCode")}</span>
                                                </div>
                                            )}
                                        </motion.button>
                                    </div>
                                </motion.div>
                            </form>
                        </Form>
                    </motion.div>
                )}
            </AnimatePresence>

            <motion.div
                initial={{ y: 10, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.8 }}
                className="text-center pt-3 flex flex-col space-y-2"
            >
                <div className="flex flex-col gap-2 items-center text-sm font-medium">
                    {(allowEmailOtpAuth ?? true) && onSwitchToEmail && (
                        <motion.button
                            type="button"
                            whileHover={{ scale: 1.02 }}
                            className="text-gray-600 hover:text-gray-800 transition-colors duration-200 relative group"
                            onClick={onSwitchToEmail}
                        >
                            {t("useEmailOtp")}
                            <span className="absolute -bottom-1 left-0 w-0 h-0.5 bg-gray-800 transition-all duration-200 group-hover:w-full"></span>
                        </motion.button>
                    )}

                    {(allowUsernamePasswordAuth ?? true) && onSwitchToUsername && (
                        <motion.button
                            type="button"
                            whileHover={{ scale: 1.02 }}
                            className="text-gray-600 hover:text-gray-800 transition-colors duration-200 relative group"
                            onClick={onSwitchToUsername}
                        >
                            {t("useUsernamePassword")}
                            <span className="absolute -bottom-1 left-0 w-0 h-0.5 bg-gray-800 transition-all duration-200 group-hover:w-full"></span>
                        </motion.button>
                    )}
                </div>

                <div className="text-sm text-gray-600 pt-2">
                    {t("noAccount")}{" "}
                    <motion.button
                        type="button"
                        whileHover={{ scale: 1.02 }}
                        onClick={
                            onSwitchToSignup || (() => navigate({ to: "/signup" }))
                        }
                        className="text-gray-800 hover:text-gray-900 font-medium underline cursor-pointer"
                    >
                        {t("signUpHere")}
                    </motion.button>
                </div>
            </motion.div>
        </div>
    );
}
