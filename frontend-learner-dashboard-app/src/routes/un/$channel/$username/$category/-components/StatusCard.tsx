import { WarningCircle, CheckCircle, SpinnerGap } from "@phosphor-icons/react";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";

interface StatusCardProps {
  state: "idle" | "pending" | "success" | "error";
  recipient: string;
  successMessage: string;
  errorMessage: string;

}

export const StatusCard = ({
  state,
  recipient,
  successMessage,
  errorMessage,

}: StatusCardProps) => {
  const { t } = useTranslation("miscRoutesA");
  if (state === "idle") {
    return null;
  }

  if (state === "pending") {
    return (
      <div className="rounded-xl border border-slate-200 bg-white px-4 py-5 shadow-sm">
        <div className="flex items-center gap-2.5">
          <SpinnerGap className="h-5 w-5 animate-spin text-primary" />
          <div>
            <p className="text-sm font-medium text-slate-800">
              {t("unsubscribe.status.updating")}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {t("unsubscribe.status.hangTight", { recipient })}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (state === "success") {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-5 shadow-sm">
        <motion.div
          key="success"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          className="flex items-start gap-2.5"
        >
          <motion.span
            key="success-icon"
            initial={{ scale: 0.85, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.25, delay: 0.05, ease: [0.22, 1, 0.36, 1] }}
          >
            <CheckCircle className="h-5 w-5 text-emerald-600" />
          </motion.span>
          <div>
            <p className="text-sm font-medium text-emerald-700">
              {t("unsubscribe.status.updated")}
            </p>
            <motion.p
              key="success-text"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, delay: 0.08 }}
              className="mt-1 text-xs text-emerald-700"
            >
              {successMessage}
            </motion.p>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-5 shadow-sm">
      <div className="flex items-start gap-2.5">
        <WarningCircle className="h-5 w-5 text-rose-600" />
        <div>
          <p className="text-sm font-medium text-rose-700">
            {t("unsubscribe.status.couldNotUpdate")}
          </p>
          <p className="mt-1 text-xs text-rose-700">{errorMessage}</p>

        </div>
      </div>
    </div>
  );
};

