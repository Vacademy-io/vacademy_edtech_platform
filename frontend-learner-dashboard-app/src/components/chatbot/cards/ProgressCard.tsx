import React from "react";
import { useTranslation } from "react-i18next";
import { CaretRight } from "@phosphor-icons/react";
import { Progress } from "@/components/ui/progress";
import type { ProgressCardData } from "../types";
import { ChatLink } from "./ChatLink";
import { classifyHref } from "./href";

const ROW = "flex flex-col gap-1.5 px-3 py-2";

export const ProgressCard: React.FC<{ card: ProgressCardData }> = ({ card }) => {
  const { t } = useTranslation("chatFeatureB");
  return (
    <section className="overflow-hidden rounded-xl bg-card text-card-foreground shadow-sm ring-1 ring-border/30">
      {card.title && <h3 className="px-3 pt-2.5 pb-1 text-sm font-semibold">{card.title}</h3>}
      <ul className="divide-y divide-border/50">
        {card.items.map((item, i) => {
          const percent = Math.round(item.percent);
          const clickable = classifyHref(item.href).kind !== "none";
          return (
            <li key={i}>
              <ChatLink
                href={item.href}
                className={`${ROW} transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none`}
                inertClassName={ROW}
              >
                <span className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 text-sm font-medium line-clamp-2">{item.title}</span>
                  <span className="shrink-0 text-caption font-semibold tabular-nums text-muted-foreground">
                    {percent}%
                  </span>
                  {clickable && (
                    <CaretRight className="size-3.5 shrink-0 text-muted-foreground rtl:rotate-180" aria-hidden="true" />
                  )}
                </span>
                <Progress
                  value={item.percent}
                  className="h-1.5"
                  aria-label={t("cards.progressLabel", { title: item.title, percent })}
                />
                {item.subtitle && (
                  <span className="block truncate text-caption text-muted-foreground">{item.subtitle}</span>
                )}
              </ChatLink>
            </li>
          );
        })}
      </ul>
    </section>
  );
};
