import React from "react";
import {
  BookmarkSimple,
  Cards,
  DotsThree,
  Exam,
  Feather,
  ListNumbers,
  Lightbulb,
  SpeakerHigh,
  SpinnerGap,
  Stop,
  Translate,
} from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useChatbotContext } from "./useChatbotContext";
import { ACTION_BUTTON } from "./MessageBubble";
import type { ChatMessage } from "./types";

/** How much of an older reply is quoted when a tool acts on it. */
const EXCERPT_CHARS = 80;

type TransformId = "simpler" | "example" | "examReady" | "hinglish" | "steps" | "flashcards";

const TRANSFORMS: { id: TransformId; Icon: React.ElementType }[] = [
  { id: "simpler", Icon: Feather },
  { id: "example", Icon: Lightbulb },
  { id: "examReady", Icon: Exam },
  { id: "hinglish", Icon: Translate },
  { id: "steps", Icon: ListNumbers },
  { id: "flashcards", Icon: Cards },
];

/** Plain one-line excerpt of a reply, for quoting it in a request. */
const excerptOf = (content: string): string => {
  const plain = content
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#*_`>$~|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > EXCERPT_CHARS ? `${plain.slice(0, EXCERPT_CHARS).trimEnd()}…` : plain;
};

/** Labels and requests of the answer tools, in the learner's language. */
const useTransformText = () => {
  const { t, i18n } = useTranslation("chatFeatureB");
  const isHindi = i18n.language?.toLowerCase().startsWith("hi");
  const label = (id: TransformId) =>
    id === "hinglish" && isHindi ? t("toolbelt.hindiLabel") : t(`toolbelt.${id}.label`);
  return { t, label };
};

/**
 * Read aloud + Save for a tutor reply (appended to its actions row). Compact
 * replies also get an overflow menu with the answer tools.
 */
export const AnswerActions: React.FC<{ msg: ChatMessage; compact: boolean }> = ({ msg, compact }) => {
  const {
    speakingMessageId,
    speechLoadingId,
    toggleReadAloud,
    setSaved,
  } = useChatbotContext();
  const { t } = useTranslation("chatFeatureB");
  const speaking = speakingMessageId === msg.id;
  const speechLoading = speechLoadingId === msg.id;
  const saved = !!msg.metadata?.saved_at;
  const readLabel = speaking || speechLoading ? t("toolbelt.stopReading") : t("toolbelt.readAloud");
  const saveLabel = saved ? t("toolbelt.unsave") : t("toolbelt.save");

  return (
    <>
      <button
        type="button"
        onClick={() => void toggleReadAloud(msg.id)}
        aria-label={readLabel}
        aria-pressed={speaking}
        aria-busy={speechLoading || undefined}
        title={readLabel}
        className={cn(ACTION_BUTTON, (speaking || speechLoading) && "bg-primary/10 text-primary md:opacity-100")}
      >
        {speechLoading ? (
          <SpinnerGap className="size-3.5 motion-safe:animate-spin" aria-hidden="true" />
        ) : speaking ? (
          <Stop className="size-3.5" weight="fill" aria-hidden="true" />
        ) : (
          <SpeakerHigh className="size-3.5" aria-hidden="true" />
        )}
      </button>
      <button
        type="button"
        onClick={() => void setSaved(msg.id, !saved)}
        aria-label={saveLabel}
        aria-pressed={saved}
        title={saveLabel}
        className={cn(ACTION_BUTTON, saved && "text-primary md:opacity-100")}
      >
        <BookmarkSimple className="size-3.5" weight={saved ? "fill" : "regular"} aria-hidden="true" />
      </button>
      {compact && <TransformMenu msg={msg} />}
    </>
  );
};

/** Overflow menu with the answer tools, for older replies. */
const TransformMenu: React.FC<{ msg: ChatMessage }> = ({ msg }) => {
  const { sendMessage, isLoading, sessionId, isSessionClosed } = useChatbotContext();
  const { t, label } = useTransformText();
  const disabled = isLoading || !sessionId || isSessionClosed;
  const excerpt = excerptOf(msg.content);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={t("toolbelt.more")}
          title={t("toolbelt.more")}
          className={cn(ACTION_BUTTON, "disabled:opacity-40")}
        >
          <DotsThree className="size-3.5" weight="bold" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-44">
        {TRANSFORMS.map(({ id, Icon }) => (
          <DropdownMenuItem
            key={id}
            onSelect={() =>
              sendMessage(
                t("toolbelt.aboutEarlier", { request: t(`toolbelt.${id}.request`), excerpt }),
              )
            }
            className="gap-2 text-caption"
          >
            <Icon className="size-3.5 text-primary" aria-hidden="true" />
            {label(id)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

/**
 * The answer toolbelt under the latest tutor reply: one tap asks for it again
 * simpler, with an example, exam-ready, in Hinglish, step by step, or as
 * flashcards. Each sends a plain request as the learner's message.
 */
export const AnswerTransforms: React.FC = () => {
  const { sendMessage, isLoading, sessionId, isSessionClosed } = useChatbotContext();
  const { t, label } = useTransformText();
  const disabled = isLoading || !sessionId || isSessionClosed;
  return (
    <div className="mt-1 flex flex-wrap gap-1" role="group" aria-label={t("toolbelt.label")}>
      {TRANSFORMS.map(({ id, Icon }) => (
        <button
          key={id}
          type="button"
          disabled={disabled}
          onClick={() => sendMessage(t(`toolbelt.${id}.request`))}
          className="inline-flex h-6 items-center gap-1 rounded-full border border-border/60 bg-background px-2 text-caption font-medium text-muted-foreground transition-colors hover:border-primary/30 hover:bg-primary/5 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:bg-primary/10 disabled:opacity-50"
        >
          <Icon className="size-3" aria-hidden="true" />
          {label(id)}
        </button>
      ))}
    </div>
  );
};
