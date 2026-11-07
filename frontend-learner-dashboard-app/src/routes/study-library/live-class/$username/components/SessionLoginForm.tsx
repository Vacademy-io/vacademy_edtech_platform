import React, { useState, useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import axios from "axios";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { Shield, ArrowsClockwise } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form";

import {
  LOGIN_USING_USERNAME,
  LOGIN_USING_OTP,
  REQUEST_OTP,
  LOGIN_BY_USERNAME_TRUSTED,
} from "@/constants/urls";
import {
  setTokenInStorage,
  getTokenDecodedData,
} from "@/lib/auth/sessionUtility";
import { TokenKey } from "@/constants/auth/tokens";
import { fetchAndStoreInstituteDetails } from "@/services/fetchAndStoreInstituteDetails";
import { fetchAndStoreStudentDetails } from "@/services/studentDetails";
import { getStudentDisplaySettings } from "@/services/student-display-settings";
import { identifyUser } from "@/lib/analytics";
import { EMAIL_OTP_VERIFICATION_ENABLED } from "@/constants/feature-flags";
import { useTranslation } from "react-i18next";
import { getTerminology } from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";

// Schemas for form validation
const usernameSchema = z.object({
  username: z.string().min(1, "Username is required"),
});

type UsernameFormValues = z.infer<typeof usernameSchema>;

/**
 * The institute to continue with after login.
 *
 * Prefers the one the caller already knows (domain routing resolved it). When it
 * could not — a shared domain has no institute_domain_routing row — fall back to
 * the access token, whose `authorities` map is keyed by institute id. Without this
 * the learner authenticates successfully and then stalls, because every follow-up
 * fetch is gated on having an institute.
 */
const resolveInstituteId = (
  known: string | undefined,
  tokenData: { authorities?: Record<string, unknown> } | null | undefined
): string | undefined => {
  if (known) return known;
  return Object.keys(tokenData?.authorities ?? {})[0];
};

interface UserDetails {
  id: string;
  username: string;
  email: string;
  full_name: string;
  password: string;
}

interface SessionLoginFormProps {
  username: string;
  /**
   * Optional. Institutes served from a shared domain have no domain-routing row,
   * so the caller genuinely cannot resolve one. The username is globally unique,
   * so lookup works without it and the institute is read back off the JWT after
   * login (see resolveInstituteId).
   */
  instituteId?: string;
  onLoginSuccess: () => void;
  /**
   * Post-login navigation override. Default keeps the original behavior
   * (re-navigate to the live-class username route). Pages that host this form
   * elsewhere (e.g. the public subscription-manage route) pass their own
   * handler — usually a no-op, since onLoginSuccess re-renders them in place.
   */
  onNavigate?: () => void;
  /** Success-toast subtitle; defaults to the live-session wording. */
  successToastDescription?: string;
  /**
   * Which passwordless landing route hosts the form (GO, LIVE_CLASS, SUBSCRIPTIONS,
   * SUB_ORG_LEARNERS, PROFILE_EDIT). Sent with the trusted login so an institute that
   * requires login codes can let chosen routes keep working from the username alone.
   */
  linkRoute?: LoginLinkRoute;
}

export type LoginLinkRoute = "GO" | "LIVE_CLASS" | "SUBSCRIPTIONS" | "SUB_ORG_LEARNERS" | "PROFILE_EDIT";

export const SessionLoginForm: React.FC<SessionLoginFormProps> = ({
  username: urlUsername,
  instituteId,
  onLoginSuccess,
  onNavigate,
  successToastDescription,
  linkRoute = "LIVE_CLASS",
}) => {
  const { t } = useTranslation("study");
  const liveSession = getTerminology(ContentTerms.LiveSession, SystemTerms.LiveSession);
  const resolvedSuccessToastDescription =
    successToastDescription ?? t("liveClass.loginForm.toast.welcome", { liveSession: liveSession.toLowerCase() });
  const [step, setStep] = useState<"username" | "otp">("username");
  const [userDetails, setUserDetails] = useState<UserDetails | null>(null);
  const [otpValues, setOtpValues] = useState<string[]>(Array(6).fill(""));
  const [isVerifyingOtp, setIsVerifyingOtp] = useState(false);
  const navigate = useNavigate();
  const hasCalledInitialAPI = useRef(false);
  const otpInputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Username form
  const usernameForm = useForm<UsernameFormValues>({
    resolver: zodResolver(usernameSchema),
    defaultValues: {
      username: urlUsername || "",
    },
  });

  // Step 1: Get user details by username
  const getUserDetailsMutation = useMutation({
    mutationFn: async (username: string) => {
      const response = await axios({
        method: "GET",
        url: LOGIN_USING_USERNAME,
        params: {
          username,
          portal: "LEARNER",
          // Omitted entirely when unknown — the endpoint treats it as optional
          // and matches on username + portal role instead.
          ...(instituteId ? { instituteId } : {}),
        },
      });
      return response.data;
    },
    onSuccess: async (data: UserDetails) => {
      setUserDetails(data);

      // If email OTP verification is disabled, use trusted login
      if (!EMAIL_OTP_VERIFICATION_ENABLED) {
        try {
          toast.info(t("liveClass.loginForm.toast.loggingIn"));
          const response = await axios.post(LOGIN_BY_USERNAME_TRUSTED, {
            username: data.username,
            institute_id: instituteId,
            route: linkRoute,
          });

          if (response.data.accessToken) {
            // Store tokens
            await setTokenInStorage(
              TokenKey.accessToken,
              response.data.accessToken
            );
            await setTokenInStorage(
              TokenKey.refreshToken,
              response.data.refreshToken
            );

            // Decode token to get user data
            const tokenData = getTokenDecodedData(response.data.accessToken);
            const userId = tokenData?.user;
            const resolvedInstituteId = resolveInstituteId(
              instituteId,
              tokenData
            );

            if (resolvedInstituteId && userId) {
              identifyUser(userId, {
                username: tokenData?.username,
                email: tokenData?.email,
              });

              try {
                await fetchAndStoreInstituteDetails(
                  resolvedInstituteId,
                  userId
                );
                getStudentDisplaySettings(true);
              } catch (error) {
                console.error("Error fetching institute details:", error);
              }

              try {
                await fetchAndStoreStudentDetails(resolvedInstituteId, userId);
              } catch {
                toast.error(t("liveClass.loginForm.toast.studentDetailsFailed"));
              }

              toast.success(t("liveClass.loginForm.toast.loginSuccessTitle"), {
                description: resolvedSuccessToastDescription,
              });

              if (onNavigate) {
                onNavigate();
              } else {
                navigate({
                  to: "/study-library/live-class/$username",
                  params: { username: urlUsername },
                });
              }

              onLoginSuccess();
            }
          }
        } catch (error) {
          console.error("Trusted login failed:", error);
          // 401 = the institute requires a login code (?lc=) and this link has
          // none, or its code expired. The root route already tried any code.
          if (axios.isAxiosError(error) && error.response?.status === 401) {
            toast.error(t("liveClass.loginForm.toast.linkExpired"), {
              description: t("liveClass.loginForm.toast.linkExpiredDescription"),
            });
            return;
          }
          toast.error(t("liveClass.loginForm.toast.loginFailedLater"), {
            description: t("liveClass.loginForm.toast.emailServiceUnavailable"),
          });
        }
        return;
      }

      // Step 2: Request OTP for the user's email (normal flow)
      try {
        await axios.post(REQUEST_OTP, {
          email: data.email,
          institute_id: instituteId,
        });

        setStep("otp");
        toast.success(t("liveClass.loginForm.toast.otpSent"));
      } catch (error) {
        console.error("Failed to send OTP:", error);
        toast.error(t("liveClass.loginForm.toast.otpSendFailed"), {
          description: t("liveClass.loginForm.toast.tryAgain"),
        });
      }
    },
    onError: (error: unknown) => {
      console.error("User lookup error:", error);
      let errorMessage = t("liveClass.loginForm.toast.userNotFound");
      if (error && typeof error === "object" && "response" in error) {
        const responseError = error as {
          response?: { data?: { message?: string; ex?: string } };
        };
        errorMessage =
          responseError.response?.data?.message ||
          responseError.response?.data?.ex ||
          t("liveClass.loginForm.toast.userNotFound");
      }
      toast.error(t("liveClass.loginForm.toast.userLookupFailed"), {
        description: errorMessage,
      });
    },
  });

  // Automatically call the API when component mounts with urlUsername
  useEffect(() => {
    if (
      urlUsername &&
      urlUsername.trim() !== "" &&
      !hasCalledInitialAPI.current
    ) {
      hasCalledInitialAPI.current = true;
      getUserDetailsMutation.mutate(urlUsername);
    }
  }, [urlUsername]); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle OTP verification with new API flow
  const handleOtpVerified = async () => {
    if (!userDetails || otpValues.join("").length !== 6) {
      toast.error(t("liveClass.loginForm.toast.otpIncomplete"));
      return;
    }

    try {
      setIsVerifyingOtp(true);

      // Step 3: Login using OTP with only email and OTP
      const response = await axios.post(LOGIN_USING_OTP, {
        email: userDetails.email,
        otp: otpValues.join(""),
      });

      if (response.data.accessToken) {
        toast.success(t("liveClass.loginForm.toast.otpVerified"));
        // Store tokens
        await setTokenInStorage(
          TokenKey.accessToken,
          response.data.accessToken
        );
        await setTokenInStorage(
          TokenKey.refreshToken,
          response.data.refreshToken
        );

        // Decode token to get user data
        const tokenData = getTokenDecodedData(response.data.accessToken);
        const userId = tokenData?.user;
        const resolvedInstituteId = resolveInstituteId(instituteId, tokenData);

        if (resolvedInstituteId && userId) {
          identifyUser(userId, {
            username: tokenData?.username,
            email: tokenData?.email,
          });

          try {
            // Fetch and store institute details
            await fetchAndStoreInstituteDetails(resolvedInstituteId, userId);
            getStudentDisplaySettings(true);
          } catch (error) {
            console.error("Error fetching institute details:", error);

          }

          try {
            await fetchAndStoreStudentDetails(resolvedInstituteId, userId);
          } catch {
            toast.error(t("liveClass.loginForm.toast.studentDetailsFailed"));
          }

          toast.success(t("liveClass.loginForm.toast.loginSuccessTitle"), {
            description: resolvedSuccessToastDescription,
          });

          // Navigate to live class route (or the host page's own destination)
          if (onNavigate) {
            onNavigate();
          } else {
            navigate({
              to: "/study-library/live-class/$username",
              params: { username: urlUsername },
            });
          }

          // Call success callback
          onLoginSuccess();
        } else {
          toast.error(t("liveClass.loginForm.toast.invalidUserData"));
          throw new Error(t("liveClass.loginForm.toast.invalidUserData"));
        }
      } else {
        toast.error(t("liveClass.loginForm.toast.loginFailedRetry"));
      }
    } catch (error) {
      console.error("Login failed:", error);
      toast.error(t("liveClass.loginForm.toast.otpInvalid"));
      // Reset OTP values on error
      setOtpValues(Array(6).fill(""));
      otpInputRefs.current[0]?.focus();
    } finally {
      setIsVerifyingOtp(false);
    }
  };

  // OTP input handlers
  const handleOtpChange = (index: number, value: string) => {
    // Only handle single character input here
    const newOtpValues = [...otpValues];
    newOtpValues[index] = value.replace(/\D/g, "");
    setOtpValues(newOtpValues);

    // Auto-focus next input for single character
    if (value && index < 5) {
      otpInputRefs.current[index + 1]?.focus();
    }
  };

  const handleOtpPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();

    const pastedData = e.clipboardData.getData("text");
    const digits = pastedData.replace(/\D/g, "").slice(0, 6);

    if (digits.length > 0) {
      const newOtpValues = Array(6).fill("");
      digits.split("").forEach((digit, i) => {
        if (i < 6) {
          newOtpValues[i] = digit;
        }
      });
      setOtpValues(newOtpValues);

      // Focus the next empty input or the last filled input
      const nextIndex = Math.min(digits.length, 5);
      otpInputRefs.current[nextIndex]?.focus();
    }
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !otpValues[index] && index > 0) {
      otpInputRefs.current[index - 1]?.focus();
    }
  };

  const onUsernameSubmit = (values: UsernameFormValues) => {
    getUserDetailsMutation.mutate(values.username);
  };

  return (
    <div className="w-full max-w-md mx-auto space-y-6">
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-semibold text-gray-900">
          {t("liveClass.loginForm.heading")}
        </h2>
        <p className="text-sm text-gray-600">
          {getUserDetailsMutation.isPending && step === "username"
            ? t("liveClass.loginForm.loadingUserDetails")
            : step === "username"
            ? t("liveClass.loginForm.subtitle", { liveSession: liveSession.toLowerCase() })
            : ``}
        </p>
      </div>

      {/* Show info when email service is disabled - using direct login */}
      {!EMAIL_OTP_VERIFICATION_ENABLED && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-4 bg-blue-50 border border-blue-200 rounded-lg"
        >
          <div className="flex items-start gap-3">
            <Shield className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
            <div>
              <h4 className="font-medium text-blue-800 text-sm">
                {t("liveClass.loginForm.quickLoginTitle")}
              </h4>
              <p className="text-blue-700 text-sm mt-1">
                {t("liveClass.loginForm.quickLoginDescription")}
              </p>
            </div>
          </div>
        </motion.div>
      )}

      {getUserDetailsMutation.isPending && !userDetails ? (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="flex flex-col items-center space-y-4"
        >
          <ArrowsClockwise className="w-8 h-8 animate-spin text-gray-600" />
          <p className="text-sm text-gray-600">{t("liveClass.loginForm.findingUserDetails")}</p>
        </motion.div>
      ) : step === "username" ? (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <Form {...usernameForm}>
            <form
              onSubmit={usernameForm.handleSubmit(onUsernameSubmit)}
              className="space-y-4"
            >
              <FormField
                control={usernameForm.control}
                name="username"
                render={({ field }) => (
                  <FormItem>
                    <Label htmlFor="username">{t("liveClass.loginForm.usernameLabel")}</Label>
                    <FormControl>
                      <div className="relative">
                        <Input
                          {...field}
                          id="username"
                          type="text"
                          placeholder={t("liveClass.loginForm.usernamePlaceholder")}
                          className="h-11 pe-10"
                          disabled={getUserDetailsMutation.isPending}
                        />
                        <Shield className="absolute end-3 top-3 w-4 h-4 text-gray-400" />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button
                type="submit"
                className="w-full h-11"
                disabled={getUserDetailsMutation.isPending}
              >
                {getUserDetailsMutation.isPending ? (
                  <div className="flex items-center space-x-2">
                    <ArrowsClockwise className="w-4 h-4 animate-spin" />
                    <span>{t("liveClass.loginForm.findingUser")}</span>
                  </div>
                ) : (
                  <div className="flex items-center space-x-2">
                    <Shield className="w-4 h-4" />
                    <span>{t("liveClass.loginForm.continue")}</span>
                  </div>
                )}
              </Button>
            </form>
          </Form>
        </motion.div>
      ) : (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="space-y-6"
        >
          {/* OTP Header */}
          <div className="text-center space-y-3">
            <div className="w-12 h-12 bg-gray-100 rounded-md mx-auto flex items-center justify-center">
              <Shield className="w-6 h-6 text-gray-700" />
            </div>
            <div className="space-y-1">
              <h3 className="text-lg font-semibold text-gray-900">{t("liveClass.loginForm.enterOtp")}</h3>
              <p className="text-sm text-gray-600">
                {t("liveClass.loginForm.otpSentTo")}{" "}
                <span className="font-medium">{userDetails?.email}</span>
              </p>
            </div>
          </div>

          {/* OTP Input */}
          <div className="space-y-6">
            <div className="flex justify-center space-x-2">
              {Array.from({ length: 6 }).map((_, index) => (
                <Input
                  key={index}
                  ref={(el) => (otpInputRefs.current[index] = el)}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={otpValues[index]}
                  onChange={(e) => handleOtpChange(index, e.target.value)}
                  onKeyDown={(e) => handleOtpKeyDown(index, e)}
                  onPaste={index === 0 ? handleOtpPaste : undefined}
                  className="h-12 w-12 text-center text-lg font-semibold border border-gray-200 rounded-lg transition-all duration-200 focus:border-gray-400 focus:ring-2 focus:ring-gray-100 hover:border-gray-300 bg-white shadow-sm"
                />
              ))}
            </div>

            <Button
              onClick={handleOtpVerified}
              disabled={isVerifyingOtp || otpValues.join("").length !== 6}
              className="w-full bg-gray-900 hover:bg-black text-white font-medium py-3 rounded-lg transition-all duration-200 shadow-sm hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isVerifyingOtp ? (
                <>
                  <ArrowsClockwise className="w-4 h-4 me-2 animate-spin" />
                  {t("liveClass.loginForm.verifying")}
                </>
              ) : (
                t("liveClass.loginForm.verifyAndContinue")
              )}
            </Button>
          </div>
        </motion.div>
      )}
    </div>
  );
};
