import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CaretRight } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import type { ChatStarter, ChatStartersResponse } from "@/services/chatbot-api";
import { AssistantAvatar } from "../MessageBubble";
import { useAvailableTutor } from "./tutor-moments";

/** Time-relevant starters only; generic ones ("Explain a topic") are skipped. */
const TIMELY_ICONS = new Set(["live", "task", "test", "resume"]);

/** The server orders starters by relevance; take the first timely one. */
function pickTimelyStarter(data: ChatStartersResponse | null): ChatStarter | null {
  return data?.starters.find((s) => TIMELY_ICONS.has(String(s.icon))) ?? null;
}

/**
 * One slim line from the tutor at the top of the Today module: avatar + the
 * most time-relevant starter ("Your live class starts in 10 min — recap?").
 * Tap sends that starter's prompt. Hidden when the chatbot is off or hidden on
 * this route, or nothing timely is on offer. Uses the context's cached,
 * de-duplicated `loadStarters`, once per mount.
 */
export function TutorBuddyLine({ className }: { className?: string }) {
  const { t } = useTranslation("chatFeatureB");
  const tutor = useAvailableTutor();
  const loadStarters = tutor?.loadStarters;
  const [starter, setStarter] = useState<ChatStarter | null>(null);

  useEffect(() => {
    if (!loadStarters) return;
    let cancelled = false;
    void loadStarters().then((data) => {
      if (!cancelled) setStarter(pickTimelyStarter(data));
    });
    return () => {
      cancelled = true;
    };
    // loadStarters changes identity with the route/language; that is when to re-pick.
  }, [loadStarters]);

  if (!tutor || !starter) return null;
  const name = tutor.chatbotSettings.assistant_name;
  return (
    <button
      type="button"
      onClick={() => tutor.openAndSend(starter.prompt)}
      aria-label={t("moments.buddy.aria", { name, label: starter.label })}
      className={cn(
        "group flex min-h-11 w-full min-w-0 items-center gap-2 rounded-lg border border-primary-100 bg-primary-50 px-2 py-1.5 text-start transition-colors hover:bg-primary-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      <AssistantAvatar className="size-7" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-caption font-medium text-foreground">
          <span className="text-primary-500">{name}</span>
          <span aria-hidden> · </span>
          {starter.label}
        </span>
        {starter.sublabel && (
          <span className="block truncate text-caption text-muted-foreground">{starter.sublabel}</span>
        )}
      </span>
      <CaretRight
        aria-hidden
        className="size-4 shrink-0 text-primary-500 transition-transform group-hover:translate-x-0.5 rtl:-scale-x-100 rtl:group-hover:-translate-x-0.5"
      />
    </button>
  );
}
