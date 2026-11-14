import { motion } from "framer-motion";
import { CheckCircle, SpinnerGap, Envelope, ChatCircle, type Icon } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { StatusCard } from "./StatusCard";

interface UnsubscribeSummaryCardProps {
  icon: Icon;
  channelLabel: string;

  isError: boolean;
  isPending: boolean;
  activeAction: "UNSUBSCRIBE" | "RESUBSCRIBE";
  onRetry: () => void;
  onResubscribe: () => void;
  statusCardProps: React.ComponentProps<typeof StatusCard>;
}

export const UnsubscribeSummaryCard = ({
  icon: Icon,
  channelLabel,

  isError,
  isPending,
  activeAction,
  onRetry,
  onResubscribe,
  statusCardProps,
}: UnsubscribeSummaryCardProps) => {
  const { t } = useTranslation("miscRoutesA");
  const isResubscribePending = isPending && activeAction === "RESUBSCRIBE";
  const isUnsubscribePending = isPending && activeAction === "UNSUBSCRIBE";
  const hasSuccessfulUnsubscribe =
    !isError && statusCardProps.state === "success" && activeAction === "UNSUBSCRIBE";

  const showResubscribe = hasSuccessfulUnsubscribe;

  return (
    <Card className="w-full border border-slate-200/70 bg-white/90 shadow-lg ring-1 ring-white/40 backdrop-blur">
      <CardContent className="space-y-6 p-card-lg sm:p-7">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Icon className="h-5 w-5" />
            </span>
            <h2 className="text-xl font-semibold uppercase tracking-wide text-slate-900">
              {channelLabel}
            </h2>
          </div>
          <SummaryIllustration
            state={statusCardProps.state}
            icon={Icon}
            channelLabel={channelLabel}
          />
        </header>

        <StatusCard {...statusCardProps} />

        <div className="flex flex-wrap items-center gap-2">
          {isError ? (
            <>
              <Button onClick={onRetry} disabled={isPending}>
                {isPending
                  ? t("unsubscribe.summary.retrying")
                  : t("unsubscribe.summary.tryAgain")}
              </Button>
              {showResubscribe && (
                <Button
                  variant="outline"
                  onClick={onResubscribe}
                  disabled={isResubscribePending}
                >
                  {isResubscribePending
                    ? t("unsubscribe.summary.pleaseWait")
                    : t("unsubscribe.summary.resubscribe")}
                </Button>
              )}
            </>
          ) : showResubscribe ? (
            <Button onClick={onResubscribe} disabled={isResubscribePending}>
              {isResubscribePending
                ? t("unsubscribe.summary.pleaseWait")
                : t("unsubscribe.summary.resubscribe")}
            </Button>
          ) : (
            <Button onClick={onRetry} disabled={isUnsubscribePending}>
              {isUnsubscribePending
                ? t("unsubscribe.summary.pleaseWait")
                : t("unsubscribe.summary.unsubscribe")}
            </Button>
          )}
        </div>

      </CardContent>
    </Card>
  );
};

const SummaryIllustration = ({
  state,
  icon: Icon,
  channelLabel,
}: {
  state: "idle" | "pending" | "success" | "error";
  icon: Icon;
  channelLabel: string;
}) => {
  const getBaseIcon = () => {
    if (channelLabel.toLowerCase().includes("whatsapp")) {
      return ChatCircle;
    }
    if (channelLabel.toLowerCase().includes("email")) {
      return Envelope;
    }
    return Icon;
  };

  if (state === "success") {
    return (
      <motion.div
        key="success-illustration"
        initial={{ scale: 0.75, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
        className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-tr from-success-100 via-success-200 to-success-100 shadow-inner"
      >
        <motion.span
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.24, delay: 0.05, ease: [0.22, 1, 0.36, 1] }}
        >
          <CheckCircle className="h-8 w-8 text-emerald-600" />
        </motion.span>
      </motion.div>
    );
  }

  if (state === "pending") {
    return (
      <motion.div
        key="pending-illustration"
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.2 }}
        className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/80 shadow-inner"
      >
        <SpinnerGap className="h-6 w-6 animate-spin text-primary" />
      </motion.div>
    );
  }

  const BaseIcon = getBaseIcon();
  return (
    <motion.div
      key="idle-illustration"
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.2 }}
      className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/5 shadow-inner"
    >
      <BaseIcon className="h-6 w-6 text-primary" />
    </motion.div>
  );
};

export default SummaryIllustration;

