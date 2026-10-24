import React, { useState, useRef, useEffect, useMemo } from "react";
import { z } from "zod";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import axios, { AxiosError } from "axios";

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
import { Phone, ArrowLeft, ArrowsClockwise, Shield, CheckCircle, Warning } from "@phosphor-icons/react";
import PhoneInput from "react-phone-input-2";
import "react-phone-input-2/lib/bootstrap.css";

import { TokenKey } from "@/constants/auth/tokens";
import {
    getTokenDecodedData,
    setTokenInStorage,
} from "@/lib/auth/sessionUtility";
import { REQUEST_WHATSAPP_OTP, VERIFY_WHATSAPP_OTP_LOGIN } from "@/constants/urls";
import { fetchAndStoreInstituteDetails } from "@/services/fetchAndStoreInstituteDetails";
import { fetchAndStoreStudentDetails } from "@/services/studentDetails";
import { useDomainRouting } from "@/hooks/use-domain-routing";
import {
    phoneFieldHasInput,
    usePreferredPhoneCountries,
} from "@/hooks/use-preferred-phone-countries";
import { SessionLimitDialog } from "@/components/common/auth/login/components/SessionLimitDialog";
import { phoneSchema as phoneValidationSchema } from "@/lib/phone-validation";
import { navigateAfterLogin } from "@/lib/auth/post-login-redirect";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";

/**
 * Built per-render (not a module constant) so the field label baked into the
 * validation messages follows the active language.
 */
const makePhoneSchema = () =>
    z.object({
        phone: phoneValidationSchema({
            required: true,
            label: i18n.t("auth:validation.phoneNumberLabel"),
        }),
    });

const otpSchema = z.object({
    otp: z
        .array(z.string())
        .length(6)
        .transform((val) => val.join("")),
});

type PhoneFormValues = z.infer<ReturnType<typeof makePhoneSchema>>;
type OtpFormValues = { otp: string[] };

export function PhoneLoginForm({
    onSwitchToUsername,
    onSwitchToEmail,
    type,
    courseId,
    onSwitchToSignup,
    allowUsernamePasswordAuth,
    allowEmailOtpAuth,
    allowSignup,
    initialPhone,
}: {
    onSwitchToUsername?: () => void;
    onSwitchToEmail?: () => void;
    type?: string;
    courseId?: string;
    onSwitchToSignup?: () => void;
    allowUsernamePasswordAuth?: boolean;
    allowEmailOtpAuth?: boolean;
    /** Portal policy from domain routing. This form never gated the link before, so only an explicit false hides it. */
    allowSignup?: boolean;
    /** Pre-fills the number (digits with dial code); the learner still has to receive and enter the OTP. */
    initialPhone?: string;
}) {
    const { t, i18n: i18nInstance } = useTranslation("auth");
    const phoneSchema = useMemo(
        () => makePhoneSchema(),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [i18nInstance.language]
    );
    const [isOtpSent, setIsOtpSent] = useState(false);
    const [phoneDial, setPhoneDial] = useState("");
    const [timer, setTimer] = useState(0);
    const timerRef = useRef<NodeJS.Timeout | null>(null);
    const navigate = useNavigate();
    const otpInputRefs = useRef<(HTMLInputElement | null)[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [sessionLimitOpen, setSessionLimitOpen] = useState(false);
    const [activeSessions, setActiveSessions] = useState<any[]>([]);
    const domainRouting = useDomainRouting();

    const redirect = useRouterState({
        select: (s) =>
            (s.location.search as Record<string, unknown>).redirect ?? "/login/",
    });

    const phoneForm = useForm<PhoneFormValues>({
        resolver: zodResolver(phoneSchema),
        defaultValues: {
            phone: initialPhone ?? "",
        },
    });

    // Resolved after `phoneForm` so the freeze flag can read the field. The
    // login page is public and can render before domain routing replies, which
    // is exactly the case this hook corrects; it never moves the country once a
    // number has been typed.
    const typedPhone = useWatch({ control: phoneForm.control, name: "phone" });
    const { defaultCountry, preferredCountries } = usePreferredPhoneCountries({
        freeze: phoneFieldHasInput(typedPhone),
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
            toast.success(i18n.t("auth:toasts.otpSentWhatsapp"));
        },
        onError: (error: AxiosError<ErrorResponse>) => {
            setIsLoading(false);
            const errorData = error.response?.data;
            if (
                errorData?.ex === "User not found!" ||
                errorData?.responseCode === "User not found!"
            ) {
                toast.error(i18n.t("auth:toasts.accountNotFoundSignup"), {
                    duration: 5000,
                    description: i18n.t("auth:toasts.phoneNotRegistered"),
                });
                setTimeout(() => {
                    if (onSwitchToSignup) {
                        onSwitchToSignup();
                    }
                }, 2000);
            } else if (errorData?.ex || errorData?.responseCode) {
                toast.error(
                    errorData.ex ||
                        errorData.responseCode ||
                        i18n.t("auth:phoneLogin.failedToSendOtpWhatsapp"),
                );
            } else {
                toast.error(i18n.t("auth:toasts.failedToSendOtpRetry"));
            }
        },
    });

    const verifyOtpMutation = useMutation({
        mutationFn: (data: { phone: string; otp: string }) =>
            axios.post(VERIFY_WHATSAPP_OTP_LOGIN, { phone_number: data.phone, otp: data.otp, institute_id: domainRouting.instituteId }),
        onSuccess: async (response) => {
            try {
                // Check for session limit exceeded
                if (response.data.session_limit_exceeded === true) {
                    setActiveSessions(response.data.active_sessions || []);
                    setSessionLimitOpen(true);
                    return;
                }

                if (!response.data || !response.data.accessToken) {
                    toast.error(i18n.t("auth:toasts.missingSessionCredentials"));
                    return;
                }

                await setTokenInStorage(
                    TokenKey.accessToken,
                    response.data.accessToken
                );
                await setTokenInStorage(
                    TokenKey.refreshToken,
                    response.data.refreshToken
                );

                const decodedData = await getTokenDecodedData(
                    response.data.accessToken
                );
                const authorities = decodedData?.authorities;
                const userId = decodedData?.user;
                const authorityKeys = authorities ? Object.keys(authorities) : [];

                if (authorityKeys.length > 1) {
                    // `redirect` defaults to the "/login/" sentinel with no real
                    // deep-link; forwarding it would bounce the user back to /login
                    // after they pick an institute, so collapse it to /dashboard/.
                    const forwardRedirect =
                        typeof redirect === "string" && redirect && redirect !== "/login/"
                            ? redirect
                            : "/dashboard/";
                    navigate({
                        to: "/institute-selection",
                        search: { redirect: forwardRedirect, type, courseId },
                    });
                } else if (authorityKeys.length === 0) {
                    // A valid token with no authorities: the number resolved to an
                    // account that holds no role here. Without this the code fell
                    // through every branch and simply did nothing — the OTP screen
                    // sat there looking like it had hung.
                    toast.error(i18n.t("auth:toasts.noAccessForNumber", {
                        defaultValue:
                            "This number isn't registered for this institute. Try email or username sign-in.",
                    }));
                } else {
                    const instituteId = authorityKeys[0];

                    if (instituteId && userId) {
                        try {
                            await fetchAndStoreInstituteDetails(instituteId, userId);
                            await fetchAndStoreStudentDetails(instituteId, userId);

                            // Honor explicit deep-link redirect FIRST (highest priority).
                            const explicitRedirect =
                                typeof redirect === "string" && redirect && redirect !== "/login/"
                                    ? redirect
                                    : null;
                            if (explicitRedirect) {
                                if (
                                    /^https?:\/\//.test(explicitRedirect) ||
                                    explicitRedirect.includes("?")
                                ) {
                                    window.location.assign(explicitRedirect);
                                } else {
                                    navigate({ to: explicitRedirect as never });
                                }
                                return;
                            }

                            // A learner who logged in from a course page returns
                            // to that course; everyone else lands on the
                            // institute's configured landing route.
                            if (type === "courseDetailsPage" && courseId) {
                                navigate({
                                    to: "/study-library/courses/course-details",
                                    search: { courseId, selectedTab: "ALL" },
                                });
                            } else if (type === "courseDetailsPage") {
                                navigate({ to: "/study-library/courses" });
                            } else {
                                await navigateAfterLogin(navigate);
                            }
                        } catch {
                            toast.error(i18n.t("auth:toasts.failedToFetchDetails"));
                        }
                    }
                }
            } catch {
                toast.error(i18n.t("auth:toasts.errorProcessingLogin"));
            }
        },
        onError: (error: AxiosError<ErrorResponse>) => {
            const errorData = error.response?.data;
            if (errorData?.ex || errorData?.responseCode) {
                toast.error(
                    errorData.ex ||
                        errorData.responseCode ||
                        i18n.t("auth:toasts.invalidOtp"),
                    {
                        duration: 5000,
                        description: i18n.t("auth:toasts.checkOtpAndRetry"),
                    },
                );
            } else {
                toast.error(i18n.t("auth:toasts.invalidOtp"), {
                    description: i18n.t("auth:toasts.tryAgain"),
                    duration: 5000,
                });
            }
            otpForm.reset();
        },
        onSettled: () => {
            setIsLoading(false);
        },
    });

    const handleSessionTerminated = () => {
        // Session was terminated
    };

    const handleRetryLogin = () => {
        setSessionLimitOpen(false);
        if (phoneDial) {
            const otpValues = otpForm.getValues();
            const otpString = Array.isArray(otpValues.otp) ? otpValues.otp.join("") : otpValues.otp;
            verifyOtpMutation.mutate({ phone: phoneDial, otp: otpString });
        }
    };

    const onPhoneSubmit = (data: PhoneFormValues) => {
        // Clean numeric phone for DB query
        const cleanedPhone = data.phone.replace(/\D/g, "");
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
            toast.error(i18n.t("auth:toasts.fillAllOtpFields"));
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
                                                        <label className="text-body font-bold text-gray-700 block mb-1">
                                                            {t("phoneLogin.whatsappNumber")}
                                                        </label>
                                                        <div className="relative flex-1">
                                                            <PhoneInput
                                                                country={defaultCountry}
                                                                preferredCountries={preferredCountries}
                                                                value={field.value}
                                                                onChange={(value) => field.onChange(value)}
                                                                inputClass={`!w-full !px-3 !py-2 !ps-12 !h-11 !bg-gray-50/50 hover:!bg-white !border ${phoneForm.formState.errors.phone ? "!border-red-300" : "!border-gray-200"} !rounded-lg !text-sm !font-medium focus:!bg-white focus:!ring-0`}
                                                                containerClass="!w-full"
                                                                buttonClass={`!rounded-s-lg !border-gray-200 !bg-gray-50/50 !w-10`}
                                                                dropdownClass="!rounded-lg !shadow-xl"
                                                            />
                                                        </div>
                                                        {phoneForm.formState.errors.phone && <p className="text-red-500 text-3xs font-semibold mt-1">{phoneForm.formState.errors.phone.message}</p>}
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
                                                    <ArrowsClockwise className="w-4 h-4" />
                                                </motion.div>
                                                <span className="text-sm">{t("phoneLogin.sendingOtp")}</span>
                                            </div>
                                        ) : (
                                            <div className="flex items-center justify-center space-x-2">
                                                <Phone className="w-4 h-4" />
                                                <span className="text-sm">{t("phoneLogin.sendOtpWhatsapp")}</span>
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
                                    {t("phoneLogin.checkWhatsapp")}
                                </h3>
                                <p className="text-sm text-gray-600">
                                    {t("common.sentSixDigitCode")}
                                </p>
                                <motion.div
                                    initial={{ scale: 0.9, opacity: 0 }}
                                    animate={{ scale: 1, opacity: 1 }}
                                    transition={{ delay: 0.3 }}
                                    className="inline-flex items-center space-x-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-1"
                                >
                                    <CheckCircle className="w-3 h-3 text-gray-600" />
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
                                                    <ArrowsClockwise className="w-4 h-4" />
                                                </motion.div>
                                                <span className="text-sm">{t("common.verifying")}</span>
                                            </div>
                                        ) : (
                                            <div className="flex items-center justify-center space-x-2">
                                                <Shield className="w-4 h-4" />
                                                <span className="text-sm">{t("common.verifyAndSignIn")}</span>
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
                                            <span className="text-xs">{t("phoneLogin.backToPhone")}</span>
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
                                                    <ArrowsClockwise className="w-3 h-3" />
                                                    <span className="text-xs">{t("common.resendIn", { count: timer })}</span>
                                                </div>
                                            ) : (
                                                <div className="flex items-center space-x-1">
                                                    <ArrowsClockwise className="w-3 h-3" />
                                                    <span className="text-xs">{t("common.resendCode")}</span>
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
                <div className="flex items-center justify-center gap-4 text-sm font-medium">
                    {(allowEmailOtpAuth ?? true) && onSwitchToEmail && (
                        <motion.button
                            type="button"
                            whileHover={{ scale: 1.02 }}
                            className="text-gray-600 hover:text-gray-800 transition-colors duration-200 relative group"
                            onClick={onSwitchToEmail}
                        >
                            {t("login.useEmailOtpShort")}
                            <span className="absolute -bottom-1 start-0 w-0 h-0.5 bg-gray-800 transition-all duration-200 group-hover:w-full"></span>
                        </motion.button>
                    )}

                    {(allowUsernamePasswordAuth ?? true) && onSwitchToUsername && (
                        <motion.button
                            type="button"
                            whileHover={{ scale: 1.02 }}
                            className="text-gray-600 hover:text-gray-800 transition-colors duration-200 relative group"
                            onClick={onSwitchToUsername}
                        >
                            {t("login.useUsernamePasswordShort")}
                            <span className="absolute -bottom-1 start-0 w-0 h-0.5 bg-gray-800 transition-all duration-200 group-hover:w-full"></span>
                        </motion.button>
                    )}
                </div>

                {allowSignup !== false && (
                    <div className="text-sm text-gray-600 pt-2">
                        {t("common.dontHaveAccount")}{" "}
                        <motion.button
                            type="button"
                            whileHover={{ scale: 1.02 }}
                            onClick={
                                onSwitchToSignup || (() => navigate({ to: "/signup" }))
                            }
                            className="text-gray-800 hover:text-gray-900 font-medium underline cursor-pointer"
                        >
                            {t("common.signUpHere")}
                        </motion.button>
                    </div>
                )}
            </motion.div>

            <SessionLimitDialog
                open={sessionLimitOpen}
                onOpenChange={setSessionLimitOpen}
                activeSessions={activeSessions}
                onSessionTerminated={handleSessionTerminated}
                onRetryLogin={handleRetryLogin}
            />
        </div>
    );
}
