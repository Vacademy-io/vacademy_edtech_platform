import { useState } from "react";
import { ShieldCheck, CaretDown, CaretUp } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ChatRulesResponse } from "@/services/chat/chatApi";

export interface CommunityRulesPanelProps {
  rules: ChatRulesResponse;
  /** Whether an acknowledge call is in flight. */
  isAcknowledging?: boolean;
  onAcknowledge: () => void;
}

/**
 * Shows the community guidelines. When acknowledgement is required and the
 * user hasn't accepted yet, the gate is expanded and the Accept button is
 * the only way forward (the page disables the composer until then).
 */
export function CommunityRulesPanel({
  rules,
  isAcknowledging = false,
  onAcknowledge,
}: CommunityRulesPanelProps) {
  const { t } = useTranslation("chatFeatureA");
  const needsAck =
    rules.rules?.acknowledgement_required === true && rules.acknowledged === false;

  // Collapsed by default once acknowledged; forced open while a gate is active.
  const [expanded, setExpanded] = useState(needsAck);

  const guidelines = rules.rules?.guidelines;
  const title = guidelines?.title?.trim() || t("communityRules.defaultTitle");
  const items = guidelines?.items ?? [];

  // Nothing meaningful to show and no gate → render nothing.
  if (!needsAck && items.length === 0) return null;

  return (
    <div
      className={cn(
        "border-b border-border px-4 py-3",
        needsAck ? "bg-primary-50" : "bg-muted/30",
      )}
    >
      <div className="flex items-start gap-2">
        <ShieldCheck
          size={18}
          weight="duotone"
          className="mt-0.5 shrink-0 text-primary-500"
        />
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={() => !needsAck && setExpanded((v) => !v)}
            className="flex w-full items-center justify-between gap-2 text-start"
            disabled={needsAck}
          >
            <span className="text-body font-medium text-foreground">{title}</span>
            {!needsAck &&
              items.length > 0 &&
              (expanded ? <CaretUp size={16} /> : <CaretDown size={16} />)}
          </button>

          {expanded && items.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 ps-4">
              {items.map((item, i) => (
                <li key={i} className="text-caption text-muted-foreground">
                  {item}
                </li>
              ))}
            </ul>
          )}

          {needsAck && (
            <div className="mt-3 space-y-2">
              <p className="text-caption text-muted-foreground">
                {t("communityRules.acceptNotice")}
              </p>
              <Button
                type="button"
                size="sm"
                onClick={onAcknowledge}
                disabled={isAcknowledging}
              >
                {isAcknowledging ? t("communityRules.accepting") : t("communityRules.accept")}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
