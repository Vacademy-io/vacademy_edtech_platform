import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight, CaretDown, Lightning, Play, Trophy } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { usePlayTheme } from "@/hooks/use-play-theme";
import type {
  CompanionLeaf,
  CompanionResume,
  CompanionTopic,
} from "@/services/kb-companion-api";
import { ProgressBar, ProgressRingMini } from "./CompanionVisuals";
import { findLeaf, leafPercent, masteryTone } from "./companion-utils";

function pagesLabel(t: (k: string, o?: Record<string, unknown>) => string, start?: number | null, end?: number | null) {
  if (!start) return null;
  return end && end !== start ? t("map.pages", { start, end }) : t("map.page", { page: start });
}

function LeafRow({
  leaf,
  active,
  onSelect,
  number,
}: {
  leaf: CompanionLeaf;
  active: boolean;
  onSelect: (leafId: string) => void;
  number: number;
}) {
  const { t } = useTranslation("kbCompanion");
  const p = leaf.progress;
  const completed = p?.status === "COMPLETED";
  const percent = leafPercent(p);
  const statusText = completed
    ? t("map.status.mastery", { mastery: p?.mastery ?? 0 })
    : p
      ? t("map.status.inProgress", { percent })
      : t("map.status.notStarted");

  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(leaf.id)}
        aria-current={active ? "true" : undefined}
        className={cn(
          "group flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300",
          active
            ? "bg-primary-50 ring-1 ring-inset ring-primary-200 dark:bg-primary-500/10 dark:ring-primary-500/30"
            : "hover:bg-neutral-50 dark:hover:bg-neutral-800/60",
        )}
      >
        <ProgressRingMini
          percent={completed ? 100 : percent}
          size="sm"
          tone={completed ? masteryTone(p?.mastery) : "none"}
          complete={completed && (p?.mastery ?? 0) >= 80}
        >
          {completed && (p?.mastery ?? 0) < 80 ? (
            <span className="text-xs font-bold tabular-nums text-neutral-700 dark:text-neutral-200">✓</span>
          ) : !completed ? (
            <span
              className={cn(
                "text-xs font-bold tabular-nums",
                p ? "text-primary-500" : "text-neutral-400 dark:text-neutral-500",
              )}
            >
              {number}
            </span>
          ) : null}
        </ProgressRingMini>
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              "block truncate text-sm",
              active
                ? "font-semibold text-neutral-900 dark:text-neutral-50"
                : "font-medium text-neutral-800 dark:text-neutral-200",
            )}
          >
            {leaf.title}
          </span>
          <span
            className={cn(
              "block truncate text-xs",
              completed ? "text-success-600" : p ? "text-primary-500" : "text-neutral-500 dark:text-neutral-400",
            )}
          >
            {statusText}
          </span>
        </span>
        {leaf.lesson_ready && !p && (
          <span
            className="flex shrink-0 items-center gap-0.5 rounded-full bg-warning-50 px-1.5 py-0.5 text-xs font-semibold text-warning-700 dark:bg-warning-700/20 dark:text-warning-200"
            title={t("map.readyHint")}
          >
            <Lightning className="size-3" weight="fill" aria-hidden />
            <span className="sr-only">{t("map.readyHint")}</span>
          </span>
        )}
      </button>
    </li>
  );
}

/**
 * The knowledge base as a map: topics as groups, each subtopic with a status
 * ring (not started / % through the lesson / done, coloured by mastery).
 */
export function TopicMap({
  topics,
  activeLeafId,
  resumeLeafId,
  onSelect,
}: {
  topics: CompanionTopic[];
  activeLeafId: string | null;
  resumeLeafId: string | null;
  onSelect: (leafId: string) => void;
}) {
  const { t } = useTranslation("kbCompanion");
  const many = topics.length > 6;
  const focusTopicId = useMemo(
    () => findLeaf(topics, activeLeafId ?? resumeLeafId)?.topic.id ?? topics[0]?.id ?? null,
    [topics, activeLeafId, resumeLeafId],
  );
  // With a long book, open only the topic being studied; the rest stay tidy.
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const isOpen = (id: string) => open[id] ?? (!many || id === focusTopicId);

  if (topics.length === 0) {
    return <p className="px-2 py-6 text-center text-sm text-neutral-500">{t("map.empty")}</p>;
  }

  let counter = 0;
  return (
    <nav aria-label={t("map.title")} className="space-y-2">
      {topics.map((topic, topicIndex) => {
        const single = topic.leaves.length === 1 && topic.leaves[0].is_topic;
        const done = topic.leaves.filter((l) => l.progress?.status === "COMPLETED").length;
        const expanded = single || isOpen(topic.id);
        const leafNumbers = topic.leaves.map(() => {
          counter += 1;
          return counter;
        });
        if (single) {
          return (
            <ul key={topic.id} className="space-y-0.5">
              <LeafRow
                leaf={topic.leaves[0]}
                active={topic.leaves[0].id === activeLeafId}
                onSelect={onSelect}
                number={leafNumbers[0]}
              />
            </ul>
          );
        }
        const pages = pagesLabel(t, topic.page_start, topic.page_end);
        return (
          <section key={topic.id} className="rounded-2xl border border-neutral-100 bg-neutral-50/60 p-1.5 dark:border-neutral-800 dark:bg-neutral-900/60">
            <button
              type="button"
              onClick={() => setOpen((prev) => ({ ...prev, [topic.id]: !expanded }))}
              aria-expanded={expanded}
              className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-start hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              <span className="flex size-6 shrink-0 items-center justify-center rounded-lg bg-white text-xs font-bold text-neutral-600 shadow-sm dark:bg-neutral-800 dark:text-neutral-300">
                {topicIndex + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold text-neutral-900 dark:text-neutral-50">
                  {topic.title}
                </span>
                <span className="block truncate text-xs text-neutral-500 dark:text-neutral-400">
                  {t("map.topicDone", { done, total: topic.leaves.length })}
                  {pages ? ` · ${pages}` : ""}
                </span>
              </span>
              <CaretDown
                className={cn("size-4 shrink-0 text-neutral-400 transition-transform", expanded && "rotate-180")}
                aria-hidden
              />
            </button>
            {expanded && (
              <ul className="mt-0.5 space-y-0.5">
                {topic.leaves.map((leaf, i) => (
                  <LeafRow
                    key={leaf.id}
                    leaf={leaf}
                    active={leaf.id === activeLeafId}
                    onSelect={onSelect}
                    number={leafNumbers[i]}
                  />
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </nav>
  );
}

/** "Continue where you left off" — the one big button that matters most. */
export function ContinueCard({
  topics,
  resume,
  onContinue,
  compact = false,
}: {
  topics: CompanionTopic[];
  resume: CompanionResume | null;
  onContinue: (leafId: string) => void;
  compact?: boolean;
}) {
  const { t } = useTranslation("kbCompanion");
  const isPlay = usePlayTheme();
  const found = findLeaf(topics, resume?.node_id);

  if (!resume || !found) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-success-200 bg-success-50 p-card dark:border-success-700 dark:bg-success-700/10">
        <Trophy className="size-8 shrink-0 text-success-600" weight="duotone" aria-hidden />
        <div>
          <p className="text-sm font-bold text-success-700 dark:text-success-200">{t("continue.allDoneTitle")}</p>
          <p className="text-xs text-success-700 dark:text-success-200">{t("continue.allDoneBody")}</p>
        </div>
      </div>
    );
  }

  const { leaf, topic } = found;
  const percent = leafPercent(leaf.progress);
  const isContinue = resume.reason === "continue";
  const title = resume.title || leaf.title;

  return (
    <button
      type="button"
      onClick={() => onContinue(leaf.id)}
      className={cn(
        "group relative w-full overflow-hidden text-start shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300 focus-visible:ring-offset-2",
        isPlay ? "rounded-play-card-sm" : "rounded-2xl",
        "bg-primary-500 text-primary-foreground",
        compact ? "p-card" : "p-card-lg",
      )}
    >
      <span aria-hidden className="absolute -end-6 -top-6 size-24 rounded-full bg-white/10" />
      <span aria-hidden className="absolute -bottom-10 end-10 size-20 rounded-full bg-white/10" />
      <span className="relative block text-xs font-semibold uppercase tracking-wide opacity-90">
        {isContinue ? t("continue.title") : t("continue.upNext")}
      </span>
      <span className={cn("relative mt-1 block font-bold leading-tight", compact ? "text-base" : "text-xl")}>
        {title}
      </span>
      {!leaf.is_topic && (
        <span className="relative mt-0.5 block truncate text-xs opacity-80">{topic.title}</span>
      )}
      {isContinue && percent > 0 && (
        <span className="relative mt-3 block">
          <ProgressBar percent={percent} className="h-1.5 bg-white/25 [&>div]:bg-white" />
        </span>
      )}
      <span className="relative mt-3 inline-flex items-center gap-2 rounded-full bg-white/20 px-3 py-1.5 text-sm font-semibold backdrop-blur-sm">
        <Play weight="fill" className="size-4" aria-hidden />
        {isContinue ? t("continue.cta") : t("continue.startCta")}
        <ArrowRight className="size-4 transition-transform group-hover:translate-x-1 rtl:rotate-180" weight="bold" aria-hidden />
      </span>
    </button>
  );
}
