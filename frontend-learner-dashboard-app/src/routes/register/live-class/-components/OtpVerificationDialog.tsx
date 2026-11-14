import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { MyButton } from "@/components/design-system/button";
import {
  LIVE_SESSION_REQUEST_OTP,
  LIVE_SESSION_VERIFY_OTP,
  REQUEST_WHATSAPP_OTP,
  VERIFY_WHATSAPP_OTP,
} from "@/constants/urls";
import { useTranslation } from "react-i18next";

export interface OtpChannel {
  type: "email" | "phone";
  value: string;
}

interface OtpVerificationDialogProps {
  open: boolean;
  channels: OtpChannel[];
  instituteId: string;
  /** Per-session WhatsApp template for the phone OTP (null = institute default). */
  whatsappTemplateName?: string | null;
  onVerified: () => void;
  onClose: () => void;
}

const phoneDigits = (value: string) => value.replace(/\D/g, "");

/**
 * Sequential OTP verification for public live-class registration. The session
 * config decides which channels must be verified (email OTP by mail, phone OTP
 * over WhatsApp); each channel is sent + confirmed in turn, then the parent's
 * pending registration is released via onVerified.
 */
export default function OtpVerificationDialog({
  open,
  channels,
  instituteId,
  whatsappTemplateName,
  onVerified,
  onClose,
}: OtpVerificationDialogProps) {
  const { t } = useTranslation("registrationA");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [otp, setOtp] = useState("");
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  // Channel we last auto-sent an OTP to, so reopening/re-rendering doesn't spam.
  const sentToRef = useRef<string>("");

  const current = channels[currentIndex];

  const sendOtp = useCallback(
    async (channel: OtpChannel) => {
      setSending(true);
      try {
        if (channel.type === "email") {
          await axios.post(
            LIVE_SESSION_REQUEST_OTP,
            {
              to: channel.value,
              subject: t("liveClass.otpDialog.emailSubject"),
              service: "live-session-registration",
              name: "Learner",
            },
            { params: { instituteId } }
          );
          toast.success(t("liveClass.otpDialog.toast.otpSentTo", { value: channel.value }));
        } else {
          await axios.post(REQUEST_WHATSAPP_OTP, {
            phone_number: phoneDigits(channel.value),
            institute_id: instituteId,
            // Session-configured template; backend falls back to the
            // institute default when absent.
            ...(whatsappTemplateName
              ? { template_name: whatsappTemplateName }
              : {}),
          });
          toast.success(t("liveClass.otpDialog.toast.otpSentWhatsapp"));
        }
      } catch (error) {
        console.error("Failed to send OTP:", error);
        toast.error(
          channel.type === "email"
            ? t("liveClass.otpDialog.toast.sendFailedEmail")
            : t("liveClass.otpDialog.toast.sendFailedWhatsapp")
        );
      } finally {
        setSending(false);
      }
    },
    [instituteId, whatsappTemplateName]
  );

  // Reset + auto-send whenever the dialog opens or moves to the next channel.
  useEffect(() => {
    if (!open) {
      setCurrentIndex(0);
      setOtp("");
      sentToRef.current = "";
      return;
    }
    const channel = channels[currentIndex];
    if (!channel) return;
    const key = `${channel.type}:${channel.value}`;
    if (sentToRef.current !== key) {
      sentToRef.current = key;
      setOtp("");
      sendOtp(channel);
    }
  }, [open, channels, currentIndex, sendOtp]);

  const verifyOtp = async () => {
    if (!current || !otp.trim()) {
      toast.error(t("liveClass.otpDialog.toast.enterOtp"));
      return;
    }
    setVerifying(true);
    try {
      if (current.type === "email") {
        // Public endpoint: 2xx = verified, invalid/expired OTP throws.
        await axios.post(LIVE_SESSION_VERIFY_OTP, {
          to: current.value,
          otp: otp.trim(),
        });
      } else {
        // Returns a boolean body — a 200 "false" is still a failed verify.
        const response = await axios.post(VERIFY_WHATSAPP_OTP, {
          phone_number: phoneDigits(current.value),
          otp: otp.trim(),
          institute_id: instituteId,
        });
        if (response.data !== true) {
          throw new Error("Invalid OTP");
        }
      }
      toast.success(
        current.type === "email"
          ? t("liveClass.otpDialog.toast.verifiedEmail")
          : t("liveClass.otpDialog.toast.verifiedPhone")
      );
      if (currentIndex + 1 < channels.length) {
        setCurrentIndex((i) => i + 1);
      } else {
        onVerified();
      }
    } catch (error) {
      console.error("OTP verification failed:", error);
      toast.error(t("liveClass.otpDialog.toast.invalidOtp"));
    } finally {
      setVerifying(false);
    }
  };

  if (!current) return null;

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {current.type === "email"
              ? t("liveClass.otpDialog.verifyEmailTitle")
              : t("liveClass.otpDialog.verifyPhoneTitle")}
          </DialogTitle>
          <DialogDescription>
            {current.type === "email"
              ? t("liveClass.otpDialog.descriptionEmail", { value: current.value })
              : t("liveClass.otpDialog.descriptionPhone", { value: current.value })}
            {channels.length > 1 &&
              t("liveClass.otpDialog.stepOf", {
                current: currentIndex + 1,
                total: channels.length,
              })}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <Input
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder={t("liveClass.otpDialog.placeholder")}
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !verifying) verifyOtp();
            }}
          />
          <MyButton
            buttonType="primary"
            type="button"
            className="w-full"
            disable={verifying || sending}
            onClick={verifyOtp}
          >
            {verifying ? t("common.verifying") : t("liveClass.otpDialog.verify")}
          </MyButton>
          <button
            type="button"
            className="text-sm text-muted-foreground underline-offset-2 hover:underline disabled:opacity-50"
            disabled={sending}
            onClick={() => current && sendOtp(current)}
          >
            {sending ? t("liveClass.otpDialog.sending") : t("liveClass.otpDialog.resend")}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
