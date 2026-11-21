import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { SquaresFour } from "@phosphor-icons/react";
import type { BuiltinWidget } from "@/types/learner-home";

/**
 * The admin preview has no learner data, so a built-in widget is drawn as a
 * labelled placeholder ("Continue learning: shows each learner's own lessons").
 */
export function BuiltinPlaceholder({ widget }: { widget: BuiltinWidget }) {
  const { t } = useTranslation("learnerHome");
  return (
    <div
      className="flex min-h-20 items-center gap-3 rounded-lg border-2 border-dashed border-border bg-muted/40 p-4 text-start"
      aria-label={t(`builtin.${widget}`)}
    >
      <SquaresFour size={28} weight="duotone" aria-hidden className="shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground">{t(`builtin.${widget}`)}</p>
        <p className="text-xs text-muted-foreground">{t("builtin.placeholderNote")}</p>
      </div>
    </div>
  );
}

export function BuiltinBlock({
  widget,
  placeholder,
  render,
}: {
  widget: BuiltinWidget;
  placeholder?: boolean;
  render: () => ReactNode;
}) {
  if (placeholder) return <BuiltinPlaceholder widget={widget} />;
  return <>{render()}</>;
}
