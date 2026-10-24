import React, { useState, useRef, useEffect, useMemo } from "react";
import { FullScreenLoader } from "@/components/common/FullScreenLoader";
import { z } from "zod";
import { useForm } from "react-hook-form";
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
import { MyInput } from "@/components/design-system/input";
import { motion, AnimatePresence } from "framer-motion";
import {
  Envelope,
  ArrowLeft,
  ArrowsClockwise,
  Shield,
  CheckCircle,
  Warning,
} from "@phosphor-icons/react";

import { TokenKey } from "@/constants/auth/tokens";
import {
  getTokenDecodedData,
  setTokenInStorage,
} from "@/lib/auth/sessionUtility";
import { LOGIN_OTP, REQUEST_OTP } from "@/constants/urls";
import { fetchAndStoreInstituteDetails } from "@/services/fetchAndStoreInstituteDetails";
import { fetchAndStoreStudentDetails } from "@/services/studentDetails";
import { hydrateParentSession } from "@/lib/auth/detect-user-role";
import { useDomainRouting } from "@/hooks/use-domain-routing";
import { ENABLE_OTP_FOR_LOGIN_SIGNUP } from "@/constants/feature-flags";
import { SessionLimitDialog } from "@/components/common/auth/login/components/SessionLimitDialog";
import { navigateAfterLogin } from "@/lib/auth/post-login-redirect";
import { useTranslation } from "react-i18next";
import { isSignupLinkVisible } from "./signup-link-visibility";
import i18n from "@/i18n";

/**
 * Built per-render (not a module constant) so the validation message follows
 * the active language instead of freezing at import time.
 */
const makeEmailSchema = () =>
  z.object({
    email: z.string().email({ message: i18n.t("auth:validation.invalidEmail") }),
  });

const otpSchema = z.object({
  otp: z
    .array(z.string())
    .length(6)
    .transform((val) => val.join("")),
});

type EmailFormValues = z.infer<ReturnType<typeof makeEmailSchema>>;
type OtpFormValues = { otp: string[] };

export function EmailLogin({
  onSwitchToUsername,
  type,
  courseId,
  onSwitchToSignup,
  onEmailVerificationSuccess,
  allowUsernamePasswordAuth,
  allowPhoneAuth,
  allowSignup,
  onSwitchToPhone,
  initialEmail,
}: {
  onSwitchToUsername: () => void;
  onSwitchToPhone?: () => void;
  type?: string;
  courseId?: string;
  onSwitchToSignup?: () => void;
  onEmailVerificationSuccess?: (email: string) => void;
  allowUsernamePasswordAuth?: boolean;
  allowPhoneAuth?: boolean;
  /** Portal policy from domain routing; undefined = unknown, see isSignupLinkVisible. */
  allowSignup?: boolean;
  /** Pre-fills the email field; the learner still has to receive and enter the OTP. */
  initialEmail?: string;
}) {
  const { t, i18n: i18nInstance } = useTranslation("auth");
  const emailSchema = useMemo(
    () => makeEmailSchema(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [i18nInstance.language]
  );
  const [isOtpSent, setIsOtpSent] = useState(false);
  const [email, setEmail] = useState("");
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

  const emailForm = useForm<EmailFormValues>({
    resolver: zodResolver(emailSchema),
    defaultValues: {
      email: initialEmail ?? "",
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
      email,
      instituteId,
    }: {
      email: string;
      instituteId: string;
    }) => axios.post(REQUEST_OTP, { email, institute_id: instituteId }),
    onMutate: () => {
      setIsLoading(true);
    },
    onSuccess: () => {
      setIsLoading(false);
      setIsOtpSent(true);
      startTimer(); // Add this line
      toast.success(i18n.t("auth:toasts.otpSent"));
    },
    onError: (error: AxiosError<ErrorResponse>) => {
      setIsLoading(false);

      // Handle specific backend error responses
      const errorData = error.response?.data;

      if (
        errorData?.ex === "User not found!" ||
        errorData?.responseCode === "User not found!"
      ) {
        // User doesn't exist - show signup message
        toast.error(i18n.t("auth:toasts.accountNotFoundSignup"), {
          duration: 5000,
          description: i18n.t("auth:toasts.emailNotRegistered"),
        });

        // Automatically switch to signup after a short delay
        setTimeout(() => {
          if (onSwitchToSignup) {
            onSwitchToSignup();
          }
        }, 2000);
      } else if (errorData?.ex || errorData?.responseCode) {
        // Show specific backend error message
        toast.error(
          errorData.ex ||
            errorData.responseCode ||
            i18n.t("auth:toasts.failedToSendOtp"),
          {
            duration: 5000,
            description: i18n.t("auth:toasts.retryOrContactSupport"),
          },
        );
      } else {
        // Generic error fallback
        toast.error(i18n.t("auth:toasts.failedToSendOtpRetry"), {
          duration: 5000,
          description: i18n.t("auth:toasts.checkConnection"),
        });
      }
    },
  });

  const verifyOtpMutation = useMutation({
    mutationFn: (data: { email: string; otp: string }) =>
      axios.post(LOGIN_OTP, data),
    onSuccess: async (response) => {
      try {
        // Check for session limit exceeded
        if (response.data.session_limit_exceeded === true) {
          setActiveSessions(response.data.active_sessions || []);
          setSessionLimitOpen(true);
          return;
        }

        // If onEmailVerificationSuccess callback is provided, use it for signup flow
        if (onEmailVerificationSuccess) {
          onEmailVerificationSuccess(email);
          return;
        }

        // Store tokens
        await setTokenInStorage(
          TokenKey.accessToken,
          response.data.accessToken,
        );
        await setTokenInStorage(
          TokenKey.refreshToken,
          response.data.refreshToken,
        );

        // Decode token to get user data
        const decodedData = await getTokenDecodedData(
          response.data.accessToken,
        );
        const authorities = decodedData?.authorities;
        const userId = decodedData?.user;
        const authorityKeys = authorities ? Object.keys(authorities) : [];

        // Check if user has PARENT role by examining authorities
        let isParent = false;
        const allRoles: string[] = [];

        if (authorities && typeof authorities === "object") {
          for (const [, instAuthority] of Object.entries(authorities)) {
            if (instAuthority && typeof instAuthority === "object") {
              const instRoles = (instAuthority as { roles?: string[] }).roles;
              if (Array.isArray(instRoles)) {
                allRoles.push(...instRoles);
              }
            }
          }
        }

        const upperRoles = allRoles.map((r) => r.toUpperCase());
        isParent = upperRoles.includes("PARENT");
        const isStudentToo = upperRoles.includes("STUDENT");

        console.log("[EmailLogin] Token decoded:", {
          user: userId,
          authorities: authorities,
          allRoles: allRoles,
          upperRoles: upperRoles,
          isParent: isParent,
        });

        // PARENT-only guardians route to the monitoring portal after a minimal
        // session hydration. This branch previously navigated away BEFORE writing
        // any StudentDetails/InstituteDetails, so parents could never satisfy
        // isAuthenticated(). Dual-role users fall through to the learner dashboard.
        if (isParent && !isStudentToo) {
          const parentInstituteId = authorities
            ? Object.keys(authorities)[0]
            : undefined;
          if (parentInstituteId && userId) {
            await hydrateParentSession(userId, parentInstituteId, {
              user: userId,
              authorities,
            });
          }
          setIsLoading(false);
          navigate({ to: "/parent/child" });
          return;
        }

        if (authorityKeys.length > 1) {
          // `redirect` defaults to the "/login/" sentinel with no real deep-link;
          // forwarding it would bounce the user back to /login after they pick an
          // institute, so collapse it to /dashboard/.
          const forwardRedirect =
            typeof redirect === "string" && redirect && redirect !== "/login/"
              ? redirect
              : "/dashboard/";
          navigate({
            to: "/institute-selection",
            search: { redirect: forwardRedirect, type, courseId },
          });
        } else {
          const instituteId = authorityKeys[0];

          if (instituteId && userId) {
            try {
              await fetchAndStoreInstituteDetails(instituteId, userId);
              await fetchAndStoreStudentDetails(instituteId, userId);

              // For email OTP login, assume status 200 (success) since we have tokens
              const loginStatus = 200;

              if (loginStatus == 200) {
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

                // A learner who logged in from a course page returns to that
                // course; everyone else lands on the configured landing route.
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
              } else {
                // Unexpected login status
              }
            } catch {
              toast.error(i18n.t("auth:toasts.failedToFetchDetails"));
            }
          } else {
            // Institute ID or User ID is undefined
          }
        }
      } catch {
        // Error processing decoded data
      }
    },
    onError: (error: AxiosError<ErrorResponse>) => {
      // Handle specific backend error responses
      const errorData = error.response?.data;

      if (errorData?.ex || errorData?.responseCode) {
        // Show specific backend error message
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
        // Generic error fallback
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
    // Re-submit the OTP verification
    if (email && otpForm.getValues()) {
      const otpValues = otpForm.getValues();
      const otpString = Array.isArray(otpValues.otp) ? otpValues.otp.join("") : otpValues.otp;
      verifyOtpMutation.mutate({ email, otp: otpString });
    }
  };

  const onEmailSubmit = (data: EmailFormValues) => {
    setEmail(data.email);
    const instituteId = domainRouting.instituteId || "";
    sendOtpMutation.mutate({ email: data.email, instituteId });
  };

  const onOtpSubmit = () => {
    const otpArray = otpForm.getValues().otp;
    if (otpArray.every((val) => val !== "")) {
      verifyOtpMutation.mutate({
        email,
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
      otpForm.setValue("otp", newOtp);

      if (index < 5 && value.length === 1) {
        otpInputRefs.current[index + 1]?.focus();
      }
    }
  };

  const handleOtpKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
    index: number,
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
      {/* Only during OTP VERIFY (login + hydration) — sending the code keeps the
          inline button spinner so the form stays visible. */}
      {isOtpSent && isLoading && <FullScreenLoader label="Signing you in…" />}
      <AnimatePresence mode="wait">
        {!isOtpSent ? (
          <motion.div
            key="email"
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -30 }}
            transition={{ duration: 0.2 }}
          >
            {/* Email Service Unavailable Warning */}
            {!ENABLE_OTP_FOR_LOGIN_SIGNUP && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mb-4 p-4 bg-amber-50 border border-amber-200 rounded-lg"
              >
                <div className="flex items-start gap-3">
                  <Warning className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <h4 className="font-medium text-amber-800 text-sm">
                      {t("login.emailLoginUnavailableTitle")}
                    </h4>
                    <p className="text-amber-700 text-sm mt-1">
                      {t("login.emailLoginUnavailableBody")}
                    </p>
                  </div>
                </div>
              </motion.div>
            )}
            <Form {...emailForm}>
              <form
                onSubmit={emailForm.handleSubmit(onEmailSubmit)}
                className="space-y-4"
              >
                <motion.div
                  initial={{ y: 10, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 0.1 }}
                  className="space-y-2"
                >
                  <FormField
                    control={emailForm.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormControl>
                          <div className="relative">
                            <MyInput
                              inputType="email"
                              inputPlaceholder={t("common.enterEmailAddress")}
                              label={t("common.emailAddressLabel")}
                              required
                              size="large"
                              error={emailForm.formState.errors.email?.message}
                              {...field}
                              className="w-full transition-all duration-200 border-gray-200 focus:border-gray-300 focus:ring-0 focus-visible:ring-0 rounded-lg bg-gray-50/50 focus:bg-white hover:bg-white font-normal pe-10"
                              input={field.value}
                              onChangeFunction={field.onChange}
                              disabled={!ENABLE_OTP_FOR_LOGIN_SIGNUP}
                            />
                            <Envelope className="absolute end-3 bottom-3 w-4 h-4 text-gray-400" />
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
                    disabled={isLoading || !ENABLE_OTP_FOR_LOGIN_SIGNUP}
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.99 }}
                    className="w-full bg-gray-900 hover:bg-black text-white font-medium py-3 px-4 rounded-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm hover:shadow-md"
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
                        <span className="text-sm">{t("common.sendingCode")}</span>
                      </div>
                    ) : (
                      <div className="flex items-center justify-center space-x-2">
                        <Envelope className="w-4 h-4" />
                        <span className="text-sm">{t("common.sendVerificationCode")}</span>
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
            {/* Compact OTP Header */}
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
                  stiffness: 200,
                }}
                className="w-12 h-12 bg-gray-100 rounded-md mx-auto flex items-center justify-center"
              >
                <Envelope className="w-6 h-6 text-gray-700" />
              </motion.div>
              <div className="space-y-1">
                <h3 className="text-lg font-semibold text-gray-900">
                  {t("common.checkYourEmail")}
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
                    {email}
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
                  {otpForm.formState.errors.otp && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="text-sm text-red-600 text-center bg-red-50 border border-red-200 rounded-lg p-2"
                    >
                      {t("validation.invalidOtpCode")}
                    </motion.div>
                  )}
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
                    className="w-full bg-gray-900 hover:bg-black text-white font-medium py-3 px-4 rounded-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm hover:shadow-md"
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
                      onClick={handleBackToEmail}
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      className="flex items-center space-x-1 text-gray-500 hover:text-gray-700 transition-colors duration-200 font-medium"
                    >
                      <ArrowLeft className="w-3 h-3" />
                      <span className="text-xs">{t("common.backToEmail")}</span>
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
                          email,
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
        className="text-center pt-3 space-y-2"
      >
        {(allowUsernamePasswordAuth ?? true) && (
          <motion.button
            type="button"
            whileHover={{ scale: 1.02 }}
            className="text-sm text-gray-600 hover:text-gray-800 transition-colors duration-200 relative group font-medium"
            onClick={onSwitchToUsername}
          >
            {t("login.useUsernamePassword")}
            <span className="absolute -bottom-1 start-0 w-0 h-0.5 bg-gray-800 transition-all duration-200 group-hover:w-full"></span>
          </motion.button>
        )}

        {(allowPhoneAuth ?? true) && onSwitchToPhone && (
          <motion.button
            type="button"
            whileHover={{ scale: 1.02 }}
            className="text-sm text-gray-600 hover:text-gray-800 transition-colors duration-200 relative group font-medium pt-2"
            onClick={onSwitchToPhone}
          >
            {t("login.usePhoneOtp")}
            <span className="absolute -bottom-1 start-0 w-0 h-0.5 bg-gray-800 transition-all duration-200 group-hover:w-full"></span>
          </motion.button>
        )}

        {isSignupLinkVisible(allowSignup) && (
          <div className="text-sm text-gray-600">
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
