import { useState, useEffect } from "react";
import { MyButton } from "@/components/design-system/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useNavigate } from "@tanstack/react-router";
import {
  Eye,
  EyeSlash,
  User,
  Lock,
  CheckCircle,
  WarningCircle,
  SpinnerGap,
} from "@phosphor-icons/react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import { Preferences } from "@capacitor/preferences";
import { LEARNER_LMS_LANDING, UPDATE_USER_DETAILS } from "@/constants/urls";
import authenticatedAxiosInstance from "@/lib/auth/axiosInstance";
import { removeTokensAndLogout } from "@/lib/auth/sessionUtility";
import { navigateAfterLogin } from "@/lib/auth/post-login-redirect";

/**
 * Where to send the learner once the new password is saved, for institutes whose courses
 * live on a connected WordPress/LearnDash site. The backend mirrors the new password to
 * that site, so the site — not the Vacademy dashboard, which for these institutes holds
 * nothing they came for — is the screen they actually want next.
 *
 * Must be called BEFORE removeTokensAndLogout(): it is an authenticated request, and it
 * deliberately takes no userId so it can only ever answer for the caller.
 *
 * Best-effort. A learner who has just changed their password must land somewhere, so any
 * failure here returns null and the caller keeps its ordinary landing route.
 */
const fetchLmsLandingUrl = async (): Promise<string | null> => {
  try {
    const { data } = await authenticatedAxiosInstance.get(LEARNER_LMS_LANDING);
    const url: unknown = data?.redirect_url;
    // Only ever an absolute http(s) URL on the LMS. Anything else is a misconfigured
    // connection, and handing it to location.assign would be an open redirect.
    if (typeof url === "string" && /^https?:\/\//i.test(url)) {
      return url;
    }
  } catch (error) {
    console.warn("LMS landing lookup failed, using the default landing route", error);
  }
  return null;
};

// Validation schemas
const accountDetailsSchema = z
  .object({
    username: z
      .string()
      .min(3, i18n.t("userProfileExtra:accountDetails.validation.usernameMin"))
      .max(50, i18n.t("userProfileExtra:accountDetails.validation.usernameMax"))
      .refine((value) => !/\s/.test(value), {
        message: i18n.t("userProfileExtra:accountDetails.validation.usernameNoSpaces"),
      }),
    newPassword: z
      .string()
      .min(6, i18n.t("userProfileExtra:accountDetails.validation.passwordMin")),
    confirmPassword: z
      .string()
      .min(1, i18n.t("userProfileExtra:accountDetails.validation.confirmPasswordRequired")),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: i18n.t("userProfileExtra:accountDetails.validation.passwordsDontMatch"),
    path: ["confirmPassword"],
  });

type AccountDetailsFormData = z.infer<typeof accountDetailsSchema>;

interface AccountDetailsProps {
  onClose?: () => void;
  isModal?: boolean;
}

export default function AccountDetailsEdit({
  onClose,
  isModal = true,
}: AccountDetailsProps) {
  const { t } = useTranslation("userProfileExtra");
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [userId, setUserId] = useState<string>("");
  const [currentUsername, setCurrentUsername] = useState<string>("");
  const [redirecting, setRedirecting] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors },
    setValue,
    watch,
  } = useForm<AccountDetailsFormData>({
    resolver: zodResolver(accountDetailsSchema),
    defaultValues: {
      username: "",
      newPassword: "",
      confirmPassword: "",
    },
  });

  // Watch for password changes to show validation feedback
  const newPassword = watch("newPassword");
  const confirmPassword = watch("confirmPassword");

  const passwordValidations = [
    { label: t("accountDetails.passwordMinCharacters"), valid: newPassword.length >= 6 },
  ];

  const passwordsMatch =
    newPassword && confirmPassword && newPassword === confirmPassword;

  // Load user details from preferences
  useEffect(() => {
    const loadUserDetails = async () => {
      try {
        const { value } = await Preferences.get({ key: "StudentDetails" });
        if (value) {
          const userData = JSON.parse(value);
          const user = Array.isArray(userData) ? userData[0] : userData;
          setUserId(user.user_id || "");
          setCurrentUsername(user.username || "");
          setValue("username", user.username || "");
        }
      } catch (error) {
        console.error("Error loading user details:", error);
        toast.error(t("accountDetails.toast.loadUserError"));
      }
    };

    loadUserDetails();
  }, [setValue]);

  const handleClose = async () => {
    setRedirecting(true);
    if (onClose) {
      onClose();
    } else {
      // Standalone (post-login) screen: send the learner on to the landing route.
      await navigateAfterLogin(navigate);
    }
    setRedirecting(false);
  };

  const onSubmit = async (data: AccountDetailsFormData) => {
    if (!userId) {
      toast.error(t("accountDetails.toast.userIdMissing"));
      return;
    }

    setIsLoading(true);

    try {
      // Prepare the request payload
      const updatePayload = {
        username: data.username,
        password: data.newPassword,
      };

      // Make API call to update user details
      const response = await authenticatedAxiosInstance.put(
        `${UPDATE_USER_DETAILS}?userId=${userId}`,
        updatePayload
      );

      if (response.status === 200) {
        // Resolved while the token is still valid — the logout below invalidates it.
        const lmsLandingUrl = await fetchLmsLandingUrl();
        if (lmsLandingUrl) {
          // Awaited, unlike the in-app path below: the wipe clears storage
          // asynchronously, and leaving the origin mid-wipe would strand portal
          // tokens on a device the learner is walking away from.
          await removeTokensAndLogout();
          toast.success(t("accountDetails.toast.updateSuccess"));
          // A real page navigation, not navigate({ to }) — another origin.
          window.location.assign(lmsLandingUrl);
          return;
        }
        removeTokensAndLogout();
        toast.success(t("accountDetails.toast.updateSuccess"));
        handleClose();
      }
    } catch (error: unknown) {
      console.error("Error updating account details:", error);

      // Handle specific error cases
      const axiosError = error as {
        response?: { status?: number; data?: { message?: string } };
      };
      if (axiosError.response?.status === 510) {
        toast.error(t("accountDetails.toast.usernameExists"));
      } else if (axiosError.response?.data?.message) {
        toast.error(axiosError.response.data.message);
      } else {
        toast.error(t("accountDetails.toast.updateError"));
      }
    } finally {
      setIsLoading(false);
    }
  };

  const headerProps = isModal ? {} : { className: "p-4 border-b" };
  const contentProps = isModal ? {} : { className: "p-4" };

  return (
    <div
      className={`${
        isModal
          ? "bg-white rounded-lg w-full max-w-md mx-auto shadow-lg"
          : "w-full"
      }`}
    >
      {/* Header */}
      <div
        className={`p-4 flex items-center justify-between ${
          isModal ? "border-b" : ""
        }`}
        {...headerProps}
      >
        <h1 className="text-lg font-medium text-primary-500 flex items-center gap-2">
          <User size={20} />
          {t("accountDetails.header")}
        </h1>
      </div>

      {/* Form Content */}
      <div className="p-4 space-y-6" {...contentProps}>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          {/* Username Section */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
              <User size={16} />
              <h3>{t("accountDetails.usernameSection")}</h3>
            </div>

            <div className="space-y-2">
              <Label htmlFor="username" className="text-sm">
                {t("accountDetails.usernameLabel")}
              </Label>
              <Input
                id="username"
                {...register("username")}
                onChange={(e) => {
                  // Strip whitespace so usernames can never contain spaces
                  e.target.value = e.target.value.replace(/\s/g, "");
                  register("username").onChange(e);
                }}
                placeholder={t("accountDetails.usernamePlaceholder")}
                className="h-11 text-sm"
                disabled={isLoading}
              />
              {errors.username && (
                <p className="text-xs text-red-500">
                  {errors.username.message}
                </p>
              )}
              {currentUsername && (
                <p className="text-xs text-gray-500">
                  {t("accountDetails.currentUsername", { username: currentUsername })}
                </p>
              )}
            </div>
          </div>

          {/* Password Section */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
              <Lock size={16} />
              <h3>{t("accountDetails.passwordSection")}</h3>
            </div>

            {/* New Password */}
            <div className="space-y-2">
              <Label htmlFor="newPassword" className="text-sm">
                {t("accountDetails.newPasswordLabel")}
              </Label>
              <div className="relative">
                <Input
                  id="newPassword"
                  type={showNewPassword ? "text" : "password"}
                  {...register("newPassword")}
                  placeholder={t("accountDetails.newPasswordPlaceholder")}
                  className="h-11 text-sm pe-10"
                  disabled={isLoading}
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                  className="absolute end-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showNewPassword ? <EyeSlash size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {errors.newPassword && (
                <p className="text-xs text-red-500">
                  {errors.newPassword.message}
                </p>
              )}

              {/* Password validation indicators */}
              {newPassword && (
                <div className="space-y-1 mt-2">
                  {passwordValidations.map((validation, index) => (
                    <div
                      key={index}
                      className={`flex items-center gap-1 text-xs ${
                        validation.valid ? "text-green-600" : "text-gray-400"
                      }`}
                    >
                      {validation.valid ? (
                        <CheckCircle size={12} />
                      ) : (
                        <WarningCircle size={12} />
                      )}
                      <span>{validation.label}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Confirm Password */}
            <div className="space-y-2">
              <Label htmlFor="confirmPassword" className="text-sm">
                {t("accountDetails.confirmPasswordLabel")}
              </Label>
              <div className="relative">
                <Input
                  id="confirmPassword"
                  type={showConfirmPassword ? "text" : "password"}
                  {...register("confirmPassword")}
                  placeholder={t("accountDetails.confirmPasswordPlaceholder")}
                  className="h-11 text-sm pe-10"
                  disabled={isLoading}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute end-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showConfirmPassword ? (
                    <EyeSlash size={16} />
                  ) : (
                    <Eye size={16} />
                  )}
                </button>
              </div>
              {errors.confirmPassword && (
                <p className="text-xs text-red-500">
                  {errors.confirmPassword.message}
                </p>
              )}

              {/* Password match indicator */}
              {confirmPassword && (
                <div
                  className={`flex items-center gap-1 text-xs ${
                    passwordsMatch ? "text-green-600" : "text-red-500"
                  }`}
                >
                  {passwordsMatch ? (
                    <CheckCircle size={12} />
                  ) : (
                    <WarningCircle size={12} />
                  )}
                  <span>
                    {passwordsMatch
                      ? t("accountDetails.passwordsMatch")
                      : t("accountDetails.validation.passwordsDontMatch")}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3 pt-4">
            <MyButton
              type="button"
              scale="medium"
              buttonType="secondary"
              layoutVariant="default"
              className="flex-1"
              onClick={handleClose}
              disable={isLoading || redirecting}
            >
              {redirecting && (
                <SpinnerGap className="animate-spin text-primary-500 size-10" />
              )}
              {t("common.cancel")}
            </MyButton>
            <MyButton
              type="submit"
              scale="medium"
              buttonType="primary"
              layoutVariant="default"
              className="flex-1"
              disabled={isLoading}
            >
              {isLoading ? t("accountDetails.updating") : t("accountDetails.updateDetails")}
            </MyButton>
          </div>
        </form>
      </div>
    </div>
  );
}
