import { MyInput } from "@/components/design-system/input";
import { forgotPasswordSchema } from "@/schemas/login/login";
import { z } from "zod";
import { forgotPassword } from "@/components/common/auth/login/hooks/send-link-button";
import { sendResetLink } from "@/components/common/auth/login/hooks/reset-link-click";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormField, FormItem } from "@/components/ui/form";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Envelope, ArrowLeft, Key, Shield, CheckCircle, ArrowsClockwise } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";

type FormValues = z.infer<typeof forgotPasswordSchema>;

interface ModalForgotPasswordFormProps {
    onBackToLogin?: () => void;
}

export function ModalForgotPasswordForm({
    onBackToLogin,
}: ModalForgotPasswordFormProps) {
    const { t } = useTranslation("auth");
    const [isLoading, setIsLoading] = useState(false);
    const [emailSent, setEmailSent] = useState(false);

    const form = useForm<FormValues>({
        resolver: zodResolver(forgotPasswordSchema),
        defaultValues: {
            email: "",
        },
        mode: "onTouched",
    });

    const forgotPasswordMutation = useMutation({
        mutationFn: (email: string) => forgotPassword(email),
        onMutate: () => setIsLoading(true),
        onSuccess: async (response) => {
            if (response.status === "success") {
                setEmailSent(true);
                toast.success(i18n.t("auth:toasts.credentialsSent"), { duration: 2000 });
                sendResetLinkMutation.mutate();
            } else {
                toast.error(i18n.t("auth:toasts.accountNotFound"), {
                    description: i18n.t("auth:forgotPassword.emailNotRegisteredDesc"),
                    duration: 2000,
                });
                form.reset();
            }
            setIsLoading(false);
        },
        onError: () => {
            setIsLoading(false);
            toast.error(i18n.t("auth:toasts.accountNotFound"), {
                description: i18n.t("auth:forgotPassword.emailNotRegisteredDesc"),
                duration: 2000,
            });
        },
    });

    const sendResetLinkMutation = useMutation({
        mutationFn: sendResetLink,
        onSuccess: (response) => {
            if (response.status !== "success") {
                toast.error(i18n.t("auth:toasts.failedResetPassword"), {
                    duration: 3000,
                });
            }
        },
        onError: () => {
            toast.error(i18n.t("auth:toasts.failedResetPassword"), {
                duration: 3000,
            });
        },
    });

    function onSubmit(values: FormValues) {
        forgotPasswordMutation.mutate(values.email);
    }

    const handleTryAgain = () => {
        setEmailSent(false);
        form.reset();
    };

    return (
        <div className="space-y-4">
            {/* Back Button */}
            <motion.button
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.1 }}
                onClick={onBackToLogin}
                className="flex items-center space-x-2 text-gray-600 hover:text-gray-800 transition-colors duration-200 mb-4 group"
            >
                <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform duration-200" />
                <span className="text-sm font-medium">{t("common.backToLogin")}</span>
            </motion.button>

            <AnimatePresence mode="wait">
                {!emailSent ? (
                    <motion.div
                        key="form"
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -20 }}
                        transition={{ duration: 0.3 }}
                        className="space-y-4"
                    >
                        {/* Header */}
                        <motion.div 
                            initial={{ y: 10, opacity: 0 }}
                            animate={{ y: 0, opacity: 1 }}
                            transition={{ delay: 0.2 }}
                            className="text-center space-y-3"
                        >
                            <motion.div
                                initial={{ scale: 0 }}
                                animate={{ scale: 1 }}
                                transition={{ delay: 0.3, type: "spring", stiffness: 200 }}
                                className="w-12 h-12 bg-gray-900 rounded-lg mx-auto flex items-center justify-center"
                            >
                                <Key className="w-6 h-6 text-white" />
                            </motion.div>
                            <div className="space-y-1">
                                <h3 className="text-lg font-semibold text-gray-900">
                                    {t("forgotPassword.title")}
                                </h3>
                                <p className="text-sm text-gray-600">
                                    {t("forgotPassword.subtitle")}
                                </p>
                            </div>
                        </motion.div>

                        {/* Form */}
                        <Form {...form}>
                            <motion.form 
                                initial={{ y: 10, opacity: 0 }}
                                animate={{ y: 0, opacity: 1 }}
                                transition={{ delay: 0.4 }}
                                onSubmit={form.handleSubmit(onSubmit)} 
                                className="space-y-4"
                            >
                                {/* Email Field */}
                                <FormField
                                    control={form.control}
                                    name="email"
                                    render={({ field: { onChange, value, ...field } }) => (
                                        <FormItem>
                                            <FormControl>
                                                <div className="relative">
                                                    <MyInput
                                                        inputType="email"
                                                        inputPlaceholder={t("common.enterEmailAddress")}
                                                        input={value}
                                                        onChangeFunction={onChange}
                                                        error={form.formState.errors.email?.message}
                                                        required={true}
                                                        size="large"
                                                        label={t("common.emailAddressLabel")}
                                                        {...field}
                                                        className="w-full transition-all duration-200 border-gray-200 focus:border-gray-300 focus:ring-0 focus-visible:ring-0 rounded-lg bg-gray-50/50 focus:bg-white hover:bg-white font-normal pe-10"
                                                    />
                                                    <Envelope className="absolute end-3 bottom-3 w-4 h-4 text-gray-400" />
                                                </div>
                                            </FormControl>
                                        </FormItem>
                                    )}
                                />

                                {/* Submit Button */}
                                <motion.button
                                    type="submit"
                                    disabled={isLoading}
                                    whileHover={{ scale: 1.01 }}
                                    whileTap={{ scale: 0.99 }}
                                    className="w-full bg-gray-900 hover:bg-black text-white font-medium py-3 px-4 rounded-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm hover:shadow-md"
                                >
                                    {isLoading ? (
                                        <div className="flex items-center justify-center space-x-2">
                                            <motion.div
                                                animate={{ rotate: 360 }}
                                                transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                                            >
                                                <ArrowsClockwise className="w-4 h-4" />
                                            </motion.div>
                                            <span className="text-sm">{t("forgotPassword.sending")}</span>
                                        </div>
                                    ) : (
                                        <div className="flex items-center justify-center space-x-2">
                                            <Envelope className="w-4 h-4" />
                                            <span className="text-sm">{t("forgotPassword.sendCredentials")}</span>
                                        </div>
                                    )}
                                </motion.button>
                            </motion.form>
                        </Form>

                        {/* Security Notice */}
                        <motion.div 
                            initial={{ y: 10, opacity: 0 }}
                            animate={{ y: 0, opacity: 1 }}
                            transition={{ delay: 0.6 }}
                            className="p-3 pb-6 bg-gray-50/80 border border-gray-200/60 rounded-lg mb-4"
                        >
                            <div className="flex items-start space-x-2">
                                <Shield className="w-4 h-4 text-gray-600 mt-0.5 flex-shrink-0" />
                                <div className="space-y-1">
                                    <p className="text-xs font-medium text-gray-800">
                                        {t("forgotPassword.accountSecurity")}
                                    </p>
                                    <p className="text-xs text-gray-600">
                                        {t("forgotPassword.securityNote")}
                                    </p>
                                </div>
                            </div>
                        </motion.div>
                    </motion.div>
                ) : (
                    <motion.div
                        key="success"
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -20 }}
                        transition={{ duration: 0.3 }}
                        className="text-center space-y-4"
                    >
                        {/* Success Icon */}
                        <motion.div
                            initial={{ scale: 0 }}
                            animate={{ scale: 1 }}
                            transition={{ delay: 0.2, type: "spring", stiffness: 200 }}
                            className="w-16 h-16 bg-gray-900 rounded-full mx-auto flex items-center justify-center"
                        >
                            <CheckCircle className="w-8 h-8 text-white" />
                        </motion.div>

                        {/* Success Message */}
                        <motion.div
                            initial={{ y: 10, opacity: 0 }}
                            animate={{ y: 0, opacity: 1 }}
                            transition={{ delay: 0.4 }}
                            className="space-y-2"
                        >
                            <h3 className="text-lg font-semibold text-gray-900">
                                {t("forgotPassword.emailSentTitle")}
                            </h3>
                            <p className="text-sm text-gray-600">
                                {t("forgotPassword.emailSentBody")}
                            </p>
                            <p className="font-medium text-gray-900 text-sm">
                                {form.getValues().email}
                            </p>
                            <p className="text-xs text-gray-500">
                                {t("forgotPassword.checkSpam")}
                            </p>
                        </motion.div>

                        {/* Action Buttons */}
                        <motion.div
                            initial={{ y: 10, opacity: 0 }}
                            animate={{ y: 0, opacity: 1 }}
                            transition={{ delay: 0.6 }}
                            className="space-y-3"
                        >
                            <motion.button
                                whileHover={{ scale: 1.01 }}
                                whileTap={{ scale: 0.99 }}
                                onClick={onBackToLogin}
                                className="w-full bg-gray-900 hover:bg-black text-white font-medium py-3 px-4 rounded-lg transition-all duration-200 shadow-sm hover:shadow-md"
                            >
                                <div className="flex items-center justify-center space-x-2">
                                    <ArrowLeft className="w-4 h-4" />
                                    <span className="text-sm">{t("common.backToLogin")}</span>
                                </div>
                            </motion.button>
                            
                            <motion.button
                                whileHover={{ scale: 1.01 }}
                                onClick={handleTryAgain}
                                className="w-full text-gray-600 hover:text-gray-800 font-medium py-2 transition-colors duration-200 text-sm"
                            >
                                {t("forgotPassword.tryDifferentEmail")}
                            </motion.button>
                        </motion.div>

                        {/* Additional Help */}
                        <motion.div
                            initial={{ y: 10, opacity: 0 }}
                            animate={{ y: 0, opacity: 1 }}
                            transition={{ delay: 0.8 }}
                            className="p-3 bg-gray-50/80 border border-gray-200/60 rounded-lg"
                        >
                            <p className="text-xs text-gray-600">
                                <strong>{t("forgotPassword.didntReceiveTitle")}</strong>
                                <br />
                                {t("forgotPassword.didntReceiveBody")}
                            </p>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
} 