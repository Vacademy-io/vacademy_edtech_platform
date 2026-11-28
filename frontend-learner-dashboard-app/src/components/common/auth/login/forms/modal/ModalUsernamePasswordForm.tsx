import React, { useMemo, useState } from "react";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { useNavigate } from "@tanstack/react-router";
import axios from "axios";
import { Form, FormControl, FormField, FormItem } from "@/components/ui/form";
import { MyInput } from "@/components/design-system/input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { motion } from "framer-motion";
import { User, Lock, ArrowsClockwise, Shield, Eye, EyeSlash } from "@phosphor-icons/react";
import { XCircle } from "@phosphor-icons/react";

import { TokenKey } from "@/constants/auth/tokens";
import {
    getTokenDecodedData,
    setTokenInStorage,
} from "@/lib/auth/sessionUtility";
import { loginUser } from "@/components/common/auth/login/hooks/login-button";
import { fetchAndStoreInstituteDetails } from "@/services/fetchAndStoreInstituteDetails";
import { fetchAndStoreStudentDetails } from "@/services/studentDetails";
import { useDomainRouting } from "@/hooks/use-domain-routing";
import { navigateAfterLogin } from "@/lib/auth/post-login-redirect";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";

/**
 * Built per-render (not a module constant) so validation messages follow the
 * active language instead of freezing at import time.
 */
const makeLoginSchema = () =>
    z.object({
        username: z.string().min(1, i18n.t("auth:validation.usernameRequired")),
        password: z.string().min(1, i18n.t("auth:validation.passwordRequired")),
    });

type FormValues = z.infer<ReturnType<typeof makeLoginSchema>>;

interface ModalUsernameLoginProps {
    onSwitchToEmail: () => void;
    type?: string;
    courseId?: string;
    onLoginSuccess?: () => void;
    signupAvailable?: boolean; // Add this prop to check if signup is available
}

export function ModalUsernameLogin({
    onSwitchToEmail,
    type,
    courseId,
    onSwitchToSignup,
    onSwitchToForgotPassword,
    onLoginSuccess,
    showEmailSwitch = true,
    signupAvailable,
}: ModalUsernameLoginProps & {
    onSwitchToSignup?: () => void;
    onSwitchToForgotPassword?: () => void;
    showEmailSwitch?: boolean;
    signupAvailable?: boolean;
}) {
    const { t, i18n: i18nInstance } = useTranslation("auth");
    const loginSchema = useMemo(
        () => makeLoginSchema(),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [i18nInstance.language]
    );
    // Extract instituteId from current URL
    const urlParams = new URLSearchParams(window.location.search);
    const instituteId = urlParams.get("instituteId");
    const navigate = useNavigate();
    const [isLoading, setIsLoading] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const domainRouting = useDomainRouting();

    const form = useForm<FormValues>({
        resolver: zodResolver(loginSchema),
        defaultValues: {
            username: "",
            password: "",
        },
    });

    const mutation = useMutation({
        mutationFn: (data: FormValues) =>
            loginUser(
                data.username,
                data.password,
                domainRouting.convertUsernamePasswordToLowercase
            ),
        onMutate: () => {
            setIsLoading(true);
        },
        onSuccess: async (response) => {
            const { accessToken, refreshToken } = response;

            if (accessToken && refreshToken) {
                // Tokens are already stored by loginUser function

                try {
                    const decodedData = getTokenDecodedData(accessToken);
                    const authorities = decodedData?.authorities;
                    const userId = decodedData?.user;
                    const authorityKeys = authorities ? Object.keys(authorities) : [];

                    // If instituteId is provided, check if user is enrolled in that institute
                    if (instituteId && authorityKeys.includes(instituteId)) {
                        // User is enrolled in the specified institute
                        try {
                            await fetchAndStoreInstituteDetails(instituteId, userId);
                            await fetchAndStoreStudentDetails(instituteId, userId);

                            // Determine redirect URL based on type and courseId
                            let redirectUrl = "/dashboard";
                            
                            if (type === "courseDetailsPage" && courseId) {
                                redirectUrl = `/study-library/courses/course-details?courseId=${courseId}&selectedTab=ALL`;
                            } else if (type === "courseDetailsPage") {
                                redirectUrl = "/study-library/courses";
                            }
                            
                            // Open in new tab if login originated from course-related pages or if type is courseDetailsPage
                            if (type === "courseDetailsPage" || (type && type !== "mainLogin")) {
                                window.open(redirectUrl, '_blank');
                            }
                            // Only navigate away if this is NOT a modal login (i.e., main login page)
                            if (!type || type === "mainLogin") {
                                await navigateAfterLogin(navigate);
                            } else {
                                // Call onLoginSuccess callback for modal login
                                if (onLoginSuccess) {
                                    onLoginSuccess();
                                }
                            }
                        } catch (error) {
                            console.error("Error fetching details:", error);
                            toast.error(i18n.t("auth:toasts.failedToFetchDetails"));
                        }
                    } else if (instituteId && !authorityKeys.includes(instituteId)) {
                        // User is not enrolled in the specified institute
                        toast.error(i18n.t("auth:toasts.notEnrolledInstitute"));
                        if (onLoginSuccess) {
                            onLoginSuccess(); // Close modal
                        }
                    } else if (authorityKeys.length > 1) {
                        // No instituteId provided and user has multiple institutes - use first available
                        const firstInstituteId = authorityKeys[0];
                        
                        try {
                            await fetchAndStoreInstituteDetails(firstInstituteId, userId);
                            await fetchAndStoreStudentDetails(firstInstituteId, userId);

                            // Determine redirect URL based on type and courseId
                            let redirectUrl = "/dashboard";
                            
                            if (type === "courseDetailsPage" && courseId) {
                                redirectUrl = `/study-library/courses/course-details?courseId=${courseId}&selectedTab=ALL`;
                            } else if (type === "courseDetailsPage") {
                                redirectUrl = "/study-library/courses";
                            }
                            
                            // Redirect in same tab if login originated from course-related pages or if type is courseDetailsPage
                            if (type === "courseDetailsPage" || (type && type !== "mainLogin")) {
                                // For course-related pages, redirect to the appropriate study library page
                                if (redirectUrl !== "/dashboard") {
                                    // Close modal first, then redirect
                                    if (onLoginSuccess) {
                                        onLoginSuccess();
                                    }
                                    // Use setTimeout to ensure modal closes before redirect
                                    setTimeout(() => {
                                        window.location.href = redirectUrl;
                                    }, 100);
                                } else {
                                    // Call onLoginSuccess callback for modal login
                                    if (onLoginSuccess) {
                                        onLoginSuccess();
                                    }
                                }
                            } else {
                                // Only navigate away if this is NOT a modal login (i.e., main login page)
                                if (!type || type === "mainLogin") {
                                    await navigateAfterLogin(navigate);
                                } else {
                                    // Call onLoginSuccess callback for modal login
                                    if (onLoginSuccess) {
                                        onLoginSuccess();
                                    }
                                }
                            }
                        } catch (error) {
                            console.error("Error fetching details:", error);
                            toast.error(i18n.t("auth:toasts.failedToFetchDetails"));
                        }
                    } else if (authorityKeys.length === 1) {
                        // Single institute case
                        const instituteId = authorityKeys[0];
                        
                                                try {
                            await fetchAndStoreInstituteDetails(instituteId, userId);
                            await fetchAndStoreStudentDetails(instituteId, userId);

                            // Determine redirect URL based on type and courseId
                            let redirectUrl = "/dashboard";
                            
                            if (type === "courseDetailsPage" && courseId) {
                                redirectUrl = `/study-library/courses/course-details?courseId=${courseId}&selectedTab=ALL`;
                            } else if (type === "courseDetailsPage") {
                                redirectUrl = "/study-library/courses";
                            }
                            
                            // Redirect in same tab if login originated from course-related pages or if type is courseDetailsPage
                            if (type === "courseDetailsPage" || (type && type !== "mainLogin")) {
                                // For course-related pages, redirect to the appropriate study library page
                                if (redirectUrl !== "/dashboard") {
                                    // Close modal first, then redirect
                                    if (onLoginSuccess) {
                                        onLoginSuccess();
                                    }
                                    // Use setTimeout to ensure modal closes before redirect
                                    setTimeout(() => {
                                        window.location.href = redirectUrl;
                                    }, 100);
                                } else {
                                    // Call onLoginSuccess callback for modal login
                                    if (onLoginSuccess) {
                                        onLoginSuccess();
                                    }
                                }
                            } else {
                                // Only navigate away if this is NOT a modal login (i.e., main login page)
                                if (!type || type === "mainLogin") {
                                    await navigateAfterLogin(navigate);
                                } else {
                                    // Call onLoginSuccess callback for modal login
                                    if (onLoginSuccess) {
                                        onLoginSuccess();
                                    }
                                }
                            }
                        } catch (error) {
                            console.error("Error fetching details:", error);
                            toast.error(i18n.t("auth:toasts.failedToFetchDetails"));
                        }
                    }
                } catch (error) {
                    console.error("Error processing decoded data:", error);
                }
            } else {
                form.reset();
            }
        },
        onError: () => {
            setIsLoading(false);
            toast.error(i18n.t("auth:toasts.loginFailed"));
        },
    });

    function onSubmit(values: FormValues) {
        mutation.mutate(values);
    }

    return (
        <div className="w-full space-y-5">
            <Form {...form}>
                <form
                    onSubmit={form.handleSubmit(onSubmit)}
                    className="space-y-4"
                >
                    {/* Username Field */}
                    <motion.div
                        initial={{ y: 10, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        transition={{ delay: 0.1 }}
                        className="space-y-2"
                    >
                        <FormField
                            control={form.control}
                            name="username"
                            render={({
                                field: { onChange, value, ...field },
                            }) => (
                                <FormItem>
                                    <FormControl>
                                        <div className="relative">
                                            <MyInput
                                                inputType="text"
                                                inputPlaceholder={t("common.enterUsernameOrEmail")}
                                                input={value}
                                                onChangeFunction={onChange}
                                                error={
                                                    form.formState.errors
                                                        .username?.message
                                                }
                                                required
                                                size="large"
                                                label={t("common.usernameOrEmailLabel")}
                                                autoCapitalize="none"
                                                autoCorrect="off"
                                                spellCheck={false}
                                                {...field}
                                                className="w-full transition-all duration-200 border-gray-200 focus:border-gray-300 focus:ring-0 focus-visible:ring-0 rounded-lg bg-gray-50/50 focus:bg-white hover:bg-white font-normal pe-10"
                                            />
                                            <User className="absolute end-3 bottom-3 w-4 h-4 text-gray-400" />
                                        </div>
                                    </FormControl>
                                </FormItem>
                            )}
                        />
                    </motion.div>

                    {/* Password Field */}
                    <motion.div
                        initial={{ y: 10, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        transition={{ delay: 0.2 }}
                        className="space-y-2"
                    >
                        <FormField
                            control={form.control}
                            name="password"
                            render={({
                                field: { onChange, value, ...field },
                            }) => (
                                <FormItem>
                                    <FormControl>
                                        <div className="relative">
                                            <div className="relative">
                                                {/* Custom input wrapper to override MyInput's password behavior */}
                                                <div className="flex flex-col gap-1">
                                                    {/* Default label style, same as the
                                                        "Username or email" label above. */}
                                                    <Label>
                                                        {t("common.passwordLabel")}
                                                        <span className="text-subtitle text-danger-600">
                                                            *
                                                        </span>
                                                    </Label>
                                                    <div className="relative">
                                                        <Input
                                                            type={
                                                                showPassword
                                                                    ? "text"
                                                                    : "password"
                                                            }
                                                            placeholder={t("common.enterPassword")}
                                                            className="h-10 py-2 px-3 text-subtitle w-full border-gray-200 focus:border-gray-300 focus:ring-0 focus-visible:ring-0 rounded-lg bg-gray-50/50 focus:bg-white hover:bg-white font-normal pe-20 text-neutral-600 shadow-none placeholder:text-body placeholder:font-regular hover:border-primary-200 focus:border-primary-500"
                                                            value={value}
                                                            onChange={onChange}
                                                            required
                                                            {...field}
                                                        />
                                                        {/* Custom password toggle and lock icon */}
                                                        <div className="absolute end-3 top-1/2 -translate-y-1/2 flex items-center space-x-2">
                                                            <motion.button
                                                                type="button"
                                                                whileHover={{
                                                                    scale: 1.1,
                                                                }}
                                                                whileTap={{
                                                                    scale: 0.9,
                                                                }}
                                                                onClick={() =>
                                                                    setShowPassword(
                                                                        !showPassword
                                                                    )
                                                                }
                                                                className="text-gray-400 hover:text-gray-600 transition-colors duration-200 z-10"
                                                            >
                                                                {showPassword ? (
                                                                    <EyeSlash className="w-4 h-4" />
                                                                ) : (
                                                                    <Eye className="w-4 h-4" />
                                                                )}
                                                            </motion.button>
                                                            <Lock className="w-4 h-4 text-gray-400" />
                                                        </div>
                                                    </div>
                                                    {form.formState.errors
                                                        .password?.message && (
                                                        <div className="flex items-center gap-1 ps-1 text-body font-regular text-danger-600">
                                                            <XCircle />
                                                            <span className="mt-0.5">
                                                                {
                                                                    form
                                                                        .formState
                                                                        .errors
                                                                        .password
                                                                        .message
                                                                }
                                                            </span>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </FormControl>
                                </FormItem>
                            )}
                        />
                        <div className="flex justify-end">
                            <motion.button
                                type="button"
                                whileHover={{ scale: 1.02 }}
                                className="text-xs text-gray-500 hover:text-gray-700 transition-colors duration-200 font-medium"
                                onClick={onSwitchToForgotPassword}
                            >
                                {t("common.forgotPasswordQuestion")}
                            </motion.button>
                        </div>
                    </motion.div>



                    {/* Login Button */}
                    <motion.div
                        initial={{ y: 10, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        transition={{ delay: 0.3 }}
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
                                    <span className="text-sm">
                                        {t("common.signingIn")}
                                    </span>
                                </div>
                            ) : (
                                <div className="flex items-center justify-center space-x-2">
                                    <Shield className="w-4 h-4" />
                                    <span className="text-sm">{t("common.signIn")}</span>
                                </div>
                            )}
                        </motion.button>
                    </motion.div>

                </form>
            </Form>

            {/* Switch to Email Login */}
            <motion.div
                initial={{ y: 10, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.4 }}
                className="text-center pt-3 space-y-2"
            >
                {showEmailSwitch && (
                    <motion.button
                        type="button"
                        whileHover={{ scale: 1.02 }}
                        className="text-sm text-gray-500 hover:text-gray-700 transition-colors duration-200 relative group font-medium"
                        onClick={onSwitchToEmail}
                    >
                        {t("login.preferEmailOtpLogin")}
                        <span className="absolute -bottom-1 start-0 w-0 h-0.5 bg-gray-700 transition-all duration-200 group-hover:w-full"></span>
                    </motion.button>
                )}
                

            </motion.div>
        </div>
    );
} 