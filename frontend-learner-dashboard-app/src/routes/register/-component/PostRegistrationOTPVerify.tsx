import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { useNavigate } from "@tanstack/react-router";
import {
  CheckCircle,
  Envelope,
  ArrowsClockwise,
  ShieldCheck,
  Sparkle,
} from "@phosphor-icons/react";
import { MyButton } from "@/components/design-system/button";
import { LOGIN_OTP, REQUEST_OTP } from "@/constants/urls";
import { TokenKey } from "@/constants/auth/tokens";
import { getTokenDecodedData, setTokenInStorage } from "@/lib/auth/sessionUtility";
import { fetchAndStoreInstituteDetails } from "@/services/fetchAndStoreInstituteDetails";
import { fetchAndStoreStudentDetails } from "@/services/studentDetails";
import {
  resolveAssessmentById,
  storeAssessmentInfo,
} from "@/routes/assessment/examination/-utils.ts/useFetchAssessment";
import {
  InstituteBrandingComponent,
  type InstituteBranding,
} from "@/components/common/institute-branding";
import { useInstituteDetails } from "../live-class/-hooks/useInstituteDetails";
import { useTranslation } from "react-i18next";

interface Props {
  email: string;
  assessmentId: string;
  assessmentName: string;
  instituteId: string;
  /**
   * Branding resolved by the register page. It already merges local
   * Preferences with the public-branding fallback, which is the only source
   * that works for a logged-out visitor (Preferences has no InstituteDetails
   * until after login, so useInstituteDetails() alone renders an empty logo
   * placeholder here). Optional so the component still stands alone.
   */
  branding?: InstituteBranding;
}

const RESEND_COOLDOWN = 60;

const PostRegistrationOTPVerify = ({
  email,
  assessmentId,
  assessmentName,
  instituteId,
  branding: brandingFromParent,
}: Props) => {
  const { t } = useTranslation("registrationA");
  const navigate = useNavigate();
  const { data: instituteDetails } = useInstituteDetails();
  const [otp, setOtp] = useState(Array(6).fill(""));
  const [isSending, setIsSending] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [timer, setTimer] = useState(0);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const branding: InstituteBranding = brandingFromParent ?? {
    instituteId: instituteDetails?.id ?? null,
    instituteName: instituteDetails?.institute_name ?? null,
    instituteLogoFileId: instituteDetails?.institute_logo_file_id ?? null,
    instituteThemeCode: null,
    homeIconClickRoute: instituteDetails?.homeIconClickRoute ?? null,
  };

  const startCooldown = () => {
    setTimer(RESEND_COOLDOWN);
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

  const sendOtp = async () => {
    setIsSending(true);
    try {
      await axios.post(REQUEST_OTP, { email, institute_id: instituteId });
      toast.success(t("otpVerify.toast.otpSentTo", { email }));
      startCooldown();
    } catch {
      toast.error(t("otpVerify.toast.sendFailed"));
    } finally {
      setIsSending(false);
    }
  };

  useEffect(() => {
    sendOtp();
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleChange = (el: HTMLInputElement, index: number) => {
    const val = el.value.replace(/\D/, "");
    if (!val) return;
    const next = [...otp];
    next[index] = val[0];
    setOtp(next);
    if (index < 5) inputRefs.current[index + 1]?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, index: number) => {
    if (e.key === "Backspace") {
      if (otp[index]) {
        const next = [...otp];
        next[index] = "";
        setOtp(next);
      } else if (index > 0) {
        const next = [...otp];
        next[index - 1] = "";
        setOtp(next);
        inputRefs.current[index - 1]?.focus();
      }
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const digits = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    const next = Array(6).fill("");
    digits.split("").forEach((d, i) => { next[i] = d; });
    setOtp(next);
    inputRefs.current[Math.min(digits.length, 5)]?.focus();
  };

  const handleVerify = async () => {
    const code = otp.join("");
    if (code.length < 6) {
      toast.error(t("otpVerify.toast.enterFullOtp"));
      return;
    }
    setIsVerifying(true);
    try {
      const res = await axios.post(LOGIN_OTP, { email, otp: code });
      const { accessToken, refreshToken } = res.data;

      await setTokenInStorage(TokenKey.accessToken, accessToken);
      await setTokenInStorage(TokenKey.refreshToken, refreshToken);

      const decoded = await getTokenDecodedData(accessToken);
      const authorities = decoded?.authorities ?? {};
      const userId = decoded?.user;
      const authorityKeys = Object.keys(authorities);

      const assessmentRoute = `/assessment/examination/${assessmentId}`;

      if (authorityKeys.length > 1) {
        navigate({
          to: "/institute-selection",
          search: { redirect: assessmentRoute, isPublicAssessment: true },
        });
        return;
      }

      const instId = authorityKeys[0];
      if (instId && userId) {
        await fetchAndStoreInstituteDetails(instId, userId);
        await fetchAndStoreStudentDetails(instId, userId);
        const fullAssessment = await resolveAssessmentById(assessmentId);
        if (fullAssessment) await storeAssessmentInfo(fullAssessment);
      }

      navigate({ to: assessmentRoute, search: { isPublicAssessment: true } });
    } catch {
      toast.error(t("otpVerify.toast.invalidOtp"));
      setOtp(Array(6).fill(""));
      inputRefs.current[0]?.focus();
    } finally {
      setIsVerifying(false);
    }
  };

  const isComplete = otp.every((d) => d !== "");

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-gradient-to-b from-primary-50/40 via-background to-background px-4 py-8">
      <div className="relative w-full max-w-md overflow-hidden rounded-3xl border border-primary-100 bg-white/90 backdrop-blur-sm p-6 sm:p-8 shadow-xl">
        <div className="pointer-events-none absolute -end-20 -top-20 size-48 rounded-full bg-primary-100/60 blur-3xl" />
        <div className="pointer-events-none absolute -start-16 -bottom-16 size-40 rounded-full bg-success-100/50 blur-3xl" />

        <div className="relative flex flex-col items-center gap-5">
          <InstituteBrandingComponent branding={branding} size="large" showName={false} />

          {/* Success + registration badge */}
          <div className="flex flex-col items-center gap-stack text-center">
            <span className="inline-flex items-center gap-1 rounded-full bg-success-50 border border-success-200 px-3 py-0.5 text-caption font-semibold uppercase tracking-wide text-success-700">
              <Sparkle size={12} weight="fill" />
              {t("common.registrationCompletedBadge")}
            </span>
            <h1 className="text-xl sm:text-2xl font-semibold text-neutral-900">
              {t("otpVerify.title")}
            </h1>
            <p className="text-sm text-neutral-500 max-w-xs">
              {t("otpVerify.subtitle", { assessmentName })}
            </p>
          </div>

          {/* Email indicator */}
          <div className="w-full rounded-2xl border border-primary-100 bg-primary-50/60 px-4 py-3 flex items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary-100">
              <Envelope size={16} weight="duotone" className="text-primary-500" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-neutral-500">{t("otpVerify.otpSentToLabel")}</p>
              <p className="truncate text-sm font-semibold text-neutral-800">{email}</p>
            </div>
            {isSending && (
              <ArrowsClockwise size={16} className="ms-auto shrink-0 animate-spin text-primary-400" />
            )}
          </div>

          {/* OTP inputs */}
          <div className="flex gap-2 sm:gap-3">
            {otp.map((digit, i) => (
              <input
                key={i}
                ref={(el) => { inputRefs.current[i] = el; }}
                type="text"
                inputMode="numeric"
                maxLength={1}
                value={digit}
                onChange={(e) => handleChange(e.target, i)}
                onKeyDown={(e) => handleKeyDown(e, i)}
                onPaste={handlePaste}
                className="size-11 sm:size-12 rounded-xl border border-neutral-200 bg-white text-center text-lg font-bold text-neutral-900 shadow-sm outline-none transition-all focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
              />
            ))}
          </div>

          {/* Verify button */}
          <MyButton
            type="button"
            buttonType="primary"
            scale="large"
            layoutVariant="default"
            className="w-full gap-2"
            disable={!isComplete || isVerifying}
            onClick={handleVerify}
          >
            {isVerifying ? (
              <ArrowsClockwise size={16} className="animate-spin" />
            ) : (
              <ShieldCheck size={16} weight="bold" />
            )}
            {isVerifying ? t("otpVerify.verifying") : t("otpVerify.verify")}
          </MyButton>

          {/* Resend */}
          <div className="flex items-center gap-2 text-xs text-neutral-500">
            <CheckCircle size={13} className="text-success-500" weight="fill" />
            <span>{t("otpVerify.resendPrompt")}</span>
            {timer > 0 ? (
              <span className="font-medium text-neutral-400">{t("otpVerify.resendIn", { seconds: timer })}</span>
            ) : (
              <button
                type="button"
                onClick={sendOtp}
                disabled={isSending}
                className="font-semibold text-primary-500 hover:text-primary-600 transition-colors disabled:opacity-50"
              >
                {t("common.resendOtp")}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default PostRegistrationOTPVerify;
