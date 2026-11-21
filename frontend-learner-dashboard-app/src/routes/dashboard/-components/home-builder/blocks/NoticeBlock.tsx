import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle, Info, Warning, X, CaretRight } from "@phosphor-icons/react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { NoticeConfig, NoticeTone } from "@/types/learner-home";
import { CustomWidgetCard } from "../../CustomWidgetCard";
import { useHomeBuilder } from "../home-context";
import { altOf, srcSetOf } from "../image-sources";
import { isPlainNotice } from "../block-helpers";

const TONE: Record<Exclude<NoticeTone, "NEUTRAL">, { border: string; icon: string; Icon: typeof Info }> = {
  INFO: { border: "border-s-info-500", icon: "text-info-700", Icon: Info },
  SUCCESS: { border: "border-s-success-500", icon: "text-success-700", Icon: CheckCircle },
  WARNING: { border: "border-s-warning-500", icon: "text-warning-700", Icon: Warning },
};

export function NoticeBlock({ blockKey, config }: { blockKey: string; config: NoticeConfig }) {
  const { t, i18n } = useTranslation("learnerHome");
  const { t: tDash } = useTranslation("dashboard");
  const { openLink, skin, onDismiss, onAcknowledge } = useHomeBuilder();
  const headingId = useId();
  // The server's answer, or the moment this learner pressed the button (shown at once).
  const [ackedAt, setAckedAt] = useState<string | null>(config.state?.acknowledged_at ?? null);
  const acknowledged = !!(config.state?.acknowledged_at || ackedAt);
  const button = config.button;
  const openButton = button ? () => openLink(button.link, blockKey, "button") : undefined;

  if (isPlainNotice(config)) {
    return (
      <CustomWidgetCard
        fun={skin.fun}
        title={config.title}
        subTitle={config.body || undefined}
        openLabel={button?.label?.trim() || tDash("dashboardPage.openButton")}
        onOpen={openButton}
      />
    );
  }

  const tone = config.tone && config.tone !== "NEUTRAL" ? TONE[config.tone] : null;
  const canDismiss = config.dismissible === true && (!config.require_ack || acknowledged);
  const ackDate = config.state?.acknowledged_at || ackedAt;
  let ackDateText = "";
  if (ackDate) {
    try {
      ackDateText = new Intl.DateTimeFormat(i18n.language, { day: "numeric", month: "short" }).format(
        new Date(ackDate)
      );
    } catch {
      ackDateText = "";
    }
  }

  return (
    <Card
      role="region"
      aria-labelledby={headingId}
      className={cn(
        "relative overflow-hidden",
        tone && cn("border-s-4", tone.border),
        "[.ui-vibrant_&]:border-primary/20",
        "[.ui-play_&]:rounded-play-card-sm [.ui-play_&]:shadow-play-soft-card",
        "cp-card fun-block-notice"
      )}
    >
      {config.image?.url && (
        <img
          src={config.image.url}
          srcSet={srcSetOf(config.image) || undefined}
          sizes="(max-width: 1023px) 100vw, 66vw"
          alt={altOf(config.image)}
          loading="lazy"
          decoding="async"
          className="block aspect-video w-full object-cover"
        />
      )}
      <CardContent className="space-y-2 p-card">
        <div className="flex items-start gap-3">
          {tone && <tone.Icon size={22} weight="fill" aria-hidden className={cn("mt-0.5 shrink-0", tone.icon)} />}
          <div className="min-w-0 flex-1">
            <h3 id={headingId} className="text-title font-semibold text-foreground [.ui-play_&]:font-black cp-heading fun-block-title">
              <bdi>{config.title}</bdi>
            </h3>
            {config.body ? (
              <p className="mt-1 whitespace-pre-line break-words text-sm text-muted-foreground fun-block-notice__body">
                <bdi>{config.body}</bdi>
              </p>
            ) : null}
          </div>
          {canDismiss && (
            <button
              type="button"
              aria-label={t("notice.dismiss")}
              onClick={() => onDismiss(blockKey)}
              className="-me-2 -mt-2 flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            >
              <X size={18} weight="bold" aria-hidden />
            </button>
          )}
        </div>
        {(button || config.require_ack) && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {config.require_ack &&
              (acknowledged ? (
                <span className="inline-flex items-center gap-1.5 text-sm font-medium text-success-700">
                  <CheckCircle size={16} weight="fill" aria-hidden />
                  {ackDateText ? t("notice.readOn", { date: ackDateText }) : t("notice.read")}
                </span>
              ) : (
                <Button
                  size="sm"
                  onClick={() => {
                    setAckedAt(new Date().toISOString());
                    void onAcknowledge(blockKey).then((ok) => {
                      if (!ok) setAckedAt(null);
                    });
                  }}
                  className="bg-primary-500 text-white hover:bg-primary-500/90"
                >
                  {config.ack_label || t("notice.ackDefault")}
                </Button>
              ))}
            {button && openButton && (
              <Button
                size="sm"
                variant={config.require_ack && !acknowledged ? "outline" : "default"}
                onClick={openButton}
                className={cn(
                  "gap-1",
                  !(config.require_ack && !acknowledged) && "bg-primary-500 text-white hover:bg-primary-500/90"
                )}
              >
                {button.label?.trim() || tDash("dashboardPage.openButton")}
                <CaretRight size={14} aria-hidden className="rtl:rotate-180" />
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
