import React from "react";
import type { ChatMessage } from "../types";
import { AssistantAvatar, MessageBubble } from "../MessageBubble";
import { parseCard } from "./parse-card";
import { LinkListCard } from "./LinkListCard";
import { ProgressCard } from "./ProgressCard";
import { StepsCard } from "./StepsCard";
import { FlashcardsCard } from "./FlashcardsCard";

/**
 * Renders a "card" message by `metadata.card.kind`. An unknown kind or
 * malformed data falls back to the message's markdown `content`, so the
 * backend can ship a new kind before this UI learns it.
 */
export const ChatCard: React.FC<{ message: ChatMessage }> = ({ message }) => {
  const card = parseCard(message.metadata?.card);

  if (!card) {
    return message.content ? <MessageBubble role="assistant" content={message.content} /> : null;
  }

  return (
    <div className="flex w-full me-auto max-w-pct-95 gap-1.5">
      <AssistantAvatar className="mt-0.5" />
      <div className="min-w-0 flex-1">
        {card.kind === "link_list" && <LinkListCard card={card} />}
        {card.kind === "progress" && <ProgressCard card={card} />}
        {card.kind === "steps" && <StepsCard card={card} />}
        {card.kind === "flashcards" && <FlashcardsCard card={card} />}
      </div>
    </div>
  );
};
