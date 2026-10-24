import { useState, useEffect, useRef } from "react";
import { MyInput } from "@/components/design-system/input";
import { FullScreenLoader } from "@/components/common/FullScreenLoader";
import { loginSchema } from "@/schemas/login/login";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormField, FormItem } from "@/components/ui/form";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { loginUser, SessionLimitError } from "@/components/common/auth/login/hooks/login-button";
import { SessionLimitDialog } from "@/components/common/auth/login/components/SessionLimitDialog";
import { TokenKey } from "@/constants/auth/tokens";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { User, Lock, ArrowsClockwise, Shield, Eye, EyeSlash, XCircle } from "@phosphor-icons/react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

import {
  getTokenDecodedData,
  setTokenInStorage,
} from "@/lib/auth/sessionUtility";
import { fetchAndStoreInstituteDetails } from "@/services/fetchAndStoreInstituteDetails";
import { fetchAndStoreStudentDetails } from "@/services/studentDetails";
import { hydrateParentSession } from "@/lib/auth/detect-user-role";
import { useTheme } from "@/providers/theme/theme-provider";
import { HOLISTIC_INSTITUTE_ID } from "@/constants/urls";
import { useInstituteFeatureStore } from "@/stores/insititute-feature-store";
import { useDomainRouting } from "@/hooks/use-domain-routing";
import { navigateAfterLogin } from "@/lib/auth/post-login-redirect";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import { isSignupLinkVisible } from "./signup-link-visibility";
type FormValues = z.infer<typeof loginSchema>;

interface UsernameLoginProps {
  onSwitchToEmail: () => void;
  type?: string;
  courseId?: string;
  allowEmailOtpAuth?: boolean;
  allowPhoneAuth?: boolean;
  /** Portal policy from domain routing; undefined = unknown, see isSignupLinkVisible. */
  allowSignup?: boolean;
  initialUsername?: string;
  initialPassword?: string;
  autoSubmit?: boolean;
}
export function UsernameLogin({
  onSwitchToEmail,
  type,
  courseId,
  allowEmailOtpAuth,
  allowPhoneAuth,
  allowSignup,
  initialUsername,
  initialPassword,
  autoSubmit,
  onSwitchToPhone,
  onSwitchToSignup,
  onSwitchToForgotPassword,
}: UsernameLoginProps & {
  onSwitchToPhone?: () => void;
  onSwitchToSignup?: () => void;
  onSwitchToForgotPassword?: () => void;
}) {
  const { t } = useTranslation("auth");
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [sessionLimitOpen, setSessionLimitOpen] = useState(false);
  const [activeSessions, setActiveSessions] = useState<any[]>([]);
  const [pendingLoginValues, setPendingLoginValues] = useState<FormValues | null>(null);
  const { setInstituteId } = useInstituteFeatureStore();
  const domainRouting = useDomainRouting();

  const redirect = useRouterState({
    select: (s) =>
      (s.location.search as Record<string, unknown>).redirect ?? "/login/",
  });
  const { setPrimaryColor } = useTheme();

  const form = useForm<FormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      username: initialUsername ?? "",
      password: initialPassword ?? "",
    },
    mode: "onTouched",
  });

  useEffect(() => {
    if (initialUsername || initialPassword) {
      form.reset({
        username: initialUsername ?? "",
        password: initialPassword ?? "",
      });
    }
  }, [initialUsername, initialPassword, form]);

  const mutation = useMutation({
    mutationFn: (values: FormValues) =>
      loginUser(
        values.username,
        values.password,
        domainRouting.convertUsernamePasswordToLowercase,
      ),
    onMutate: () => {
      setIsLoading(true);
    },
    onSuccess: async (response) => {
      if (response) {
        try {
          // Store tokens in Capacitor Storage
          await setTokenInStorage(TokenKey.accessToken, response.accessToken);
          await setTokenInStorage(TokenKey.refreshToken, response.refreshToken);

          // Decode token to get user data
          const decodedData = await getTokenDecodedData(response.accessToken);

          // Check authorities in decoded data
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

          console.log("[UsernameLogin] Token decoded:", {
            user: userId,
            authorities: authorities,
            allRoles: allRoles,
            upperRoles: upperRoles,
            isParent: isParent,
          });

          // PARENT-only guardians route to the monitoring portal after a minimal
          // session hydration (they have no student row, so fetchAndStoreStudentDetails
          // alone never satisfies isAuthenticated). Dual-role users fall through to
          // their own learner dashboard.
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
            // Redirect to InstituteSelection if multiple authorities are found.
            // `redirect` defaults to the "/login/" sentinel when there's no real
            // deep-link — forwarding that would bounce the user back to /login
            // after they pick an institute, so collapse it to /dashboard/.
            const forwardRedirect =
              typeof redirect === "string" && redirect && redirect !== "/login/"
                ? redirect
                : "/dashboard/";
            navigate({
              to: "/institute-selection",
              search: { redirect: forwardRedirect, type, courseId },
            });
          } else {
            // Get the single institute ID
            const instituteId = authorities
              ? Object.keys(authorities)[0]
              : undefined;

            if (instituteId && userId) {
              try {
                const details = await fetchAndStoreInstituteDetails(
                  instituteId,
                  userId,
                );
                setInstituteId(instituteId);
                if (instituteId === HOLISTIC_INSTITUTE_ID) {
                  setPrimaryColor("holistic");
                } else {
                  setPrimaryColor(details?.institute_theme_code ?? "primary");
                }
              } catch (error) {
                console.error("Error fetching institute details:", error);
              }
            } else {
              console.error("Institute ID or User ID is undefined");
            }

            if (instituteId && userId) {
              try {
                await fetchAndStoreStudentDetails(instituteId, userId);
              } catch {
                toast.error(i18n.t("auth:toasts.failedToFetchDetails"));
              }
            } else {
              console.error("Institute ID or User ID is undefined");
            }

            // Honor explicit deep-link redirect FIRST (highest priority).
            // Set when an unauthenticated user clicks a deep link like
            // /reports/attendance?from=...&to=... — TanStack navigate({to})
            // strips query strings, so use window.location.assign for paths
            // that contain '?' to preserve the URL verbatim.
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

            // A learner who logged in from a course page returns to that course;
            // everyone else lands on the institute's configured landing route.
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
          }
        } catch (error) {
          console.error("Error processing decoded data:", error);
        }
      } else {
        form.reset();
      }
    },
    onError: (error) => {
      setIsLoading(false);
      if (error instanceof SessionLimitError) {
        setActiveSessions(error.activeSessions);
        setPendingLoginValues(form.getValues());
        setSessionLimitOpen(true);
      } else {
        toast.error(i18n.t("auth:toasts.loginFailed"));
      }
    },
  });

  const handleSessionTerminated = () => {
    // Session terminated, user can retry
  };

  const handleRetryLogin = () => {
    setSessionLimitOpen(false);
    if (pendingLoginValues) {
      mutation.mutate(pendingLoginValues);
    }
  };

  function onSubmit(values: FormValues) {
    mutation.mutate(values);
  }

  // Demo handoff: when creds are injected via the onboarding link, sign in automatically (once).
  const autoSubmittedRef = useRef(false);
  useEffect(() => {
    if (
      autoSubmit &&
      initialUsername &&
      initialPassword &&
      !autoSubmittedRef.current
    ) {
      autoSubmittedRef.current = true;
      const timer = setTimeout(
        () =>
          mutation.mutate({
            username: initialUsername,
            password: initialPassword,
          }),
        200,
      );
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSubmit, initialUsername, initialPassword]);

  return (
    <div className="w-full space-y-5">
      {/* Signing-in covers the whole authenticate → hydrate → navigate window,
          which previously looked like a blank/idle screen. */}
      {isLoading && <FullScreenLoader label="Signing you in…" />}
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
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
              render={({ field: { onChange, value, ...field } }) => (
                <FormItem>
                  <FormControl>
                    <div className="flex flex-col gap-1">
                      <Label className="text-subtitle font-regular">
                        {t("common.usernameOrEmailLabel")}
                        <span className="text-subtitle text-danger-600">*</span>
                      </Label>

                      <div className="relative">
                        <Input
                          type="text"
                          placeholder={t("common.enterUsernameOrEmail")}
                          value={value}
                          onChange={onChange}
                          required
                          autoCapitalize="none"
                          autoCorrect="off"
                          spellCheck={false}
                          {...field}
                          className="h-10 py-2 px-3 text-subtitle w-full border-gray-200
                                                        focus:border-gray-300 focus:ring-0 focus-visible:ring-0
                                                        rounded-lg bg-gray-50/50 focus:bg-white hover:bg-white
                                                        font-normal pe-10 text-neutral-600 shadow-none
                                                        placeholder:text-body placeholder:font-regular
                                                        hover:border-primary-200 focus:border-primary-500"
                        />

                        {/* User icon */}
                        <User className="absolute end-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      </div>
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
              render={({ field: { onChange, value, ...field } }) => (
                <FormItem>
                  <FormControl>
                    <div className="relative">
                      <div className="relative">
                        {/* Custom input wrapper to override MyInput's password behavior */}
                        <div className="flex flex-col gap-1">
                          <Label className="text-subtitle font-regular">
                            {t("common.passwordLabel")}
                            <span className="text-subtitle text-danger-600">
                              *
                            </span>
                          </Label>
                          <div className="relative">
                            <Input
                              type={showPassword ? "text" : "password"}
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
                                onClick={() => setShowPassword(!showPassword)}
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
                          {form.formState.errors.password?.message && (
                            <div className="flex items-center gap-1 ps-1 text-body font-regular text-danger-600">
                              <XCircle />
                              <span className="mt-0.5">
                                {form.formState.errors.password.message}
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
                onClick={
                  onSwitchToForgotPassword ||
                  (() => navigate({ to: "/login/forgot-password" }))
                }
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
              className="w-full bg-blue-600 hover:bg-blue-500 bg-primary-500 hover:bg-primary-400 text-white font-medium py-3 px-4 rounded-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm hover:shadow-md"
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
                  <span className="text-sm">{t("common.signingIn")}</span>
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
        {(allowEmailOtpAuth ?? true) && (
          <motion.button
            type="button"
            whileHover={{ scale: 1.02 }}
            className="text-sm text-gray-600 hover:text-gray-800 transition-colors duration-200 relative group font-medium"
            onClick={onSwitchToEmail}
          >
            {t("login.useEmailOtp")}
            <span className="absolute -bottom-1 start-0 w-0 h-0.5 bg-gray-800 transition-all duration-200 group-hover:w-full"></span>
          </motion.button>
        )}

        {(allowPhoneAuth ?? true) && onSwitchToPhone && (
          <motion.button
            type="button"
            whileHover={{ scale: 1.02 }}
            className="text-sm text-gray-600 hover:text-gray-800 transition-colors duration-200 relative group font-medium pt-2 block mx-auto"
            onClick={onSwitchToPhone}
          >
            {t("login.usePhoneOtp")}
            <span className="absolute -bottom-1 start-0 w-0 h-0.5 bg-gray-800 transition-all duration-200 group-hover:w-full"></span>
          </motion.button>
        )}

        {isSignupLinkVisible(allowSignup) && (
          <div className="text-xs text-gray-600">
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
