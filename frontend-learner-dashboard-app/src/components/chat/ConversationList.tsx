import { Users, Megaphone, User, ChatCircle } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { ChatConversationResponse } from "@/services/chat/chatApi";
import { timeLabel, initialsOf } from "./chatUtils";
import { getTerminology } from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";

export interface ConversationListProps {
  conversations: ChatConversationResponse[];
  selectedId?: string;
  isLoading?: boolean;
  onSelect: (conversation: ChatConversationResponse) => void;
}

function typeMeta(conv: ChatConversationResponse, t: (key: string, opts?: Record<string, unknown>) => string) {
  const batchTerm = getTerminology(ContentTerms.Batch, SystemTerms.Batch);
  switch (conv.type) {
    case "COMMUNITY":
      return { Icon: Megaphone, fallbackTitle: t("common.typeCommunity") };
    case "BATCH_GROUP":
      return {
        Icon: Users,
        fallbackTitle: t("conversationList.typeFallback.batchGroup", { batch: batchTerm }),
      };
    case "DIRECT":
    default:
      return { Icon: User, fallbackTitle: t("common.typeDirectMessage") };
  }
}

export function ConversationList({
  conversations,
  selectedId,
  isLoading = false,
  onSelect,
}: ConversationListProps) {
  const { t } = useTranslation("chatFeatureA");

  if (isLoading) {
    return (
      <div className="space-y-1 p-2">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="flex items-center gap-3 p-2">
            <Skeleton className="size-10 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-3 w-1/2" />
              <Skeleton className="h-3 w-3/4" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (conversations.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <ChatCircle size={32} className="text-muted-foreground" />
        <p className="text-body font-medium text-foreground">
          {t("conversationList.empty.title")}
        </p>
        <p className="text-caption text-muted-foreground">
          {t("conversationList.empty.description")}
        </p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <ul className="flex flex-col py-1">
        {conversations.map((conv) => {
          const { Icon, fallbackTitle } = typeMeta(conv, t);
          const title = conv.title?.trim() || fallbackTitle;
          const isSelected = conv.id === selectedId;
          return (
            <li key={conv.id}>
              <button
                type="button"
                onClick={() => onSelect(conv)}
                className={cn(
                  "flex w-full items-center gap-3 px-3 py-2.5 text-start transition-colors",
                  "hover:bg-muted/60 focus-visible:outline-none focus-visible:bg-muted/60",
                  isSelected && "bg-muted",
                )}
              >
                <span
                  aria-hidden
                  className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-50 text-caption font-semibold text-primary-500"
                >
                  {conv.type === "DIRECT" ? (
                    initialsOf(title)
                  ) : (
                    <Icon size={18} weight="duotone" />
                  )}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="flex items-start justify-between gap-2">
                    <span className="line-clamp-2 break-words text-body font-medium text-foreground">
                      {title}
                    </span>
                    {conv.lastMessageAt && (
                      <span className="mt-0.5 shrink-0 text-caption text-muted-foreground">
                        {timeLabel(conv.lastMessageAt)}
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 flex items-center justify-between gap-2">
                    <span className="truncate text-caption text-muted-foreground">
                      {conv.lastMessagePreview || t("conversationList.noMessagesYet")}
                    </span>
                    {conv.unreadCount > 0 && (
                      <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-caption font-semibold text-primary-foreground">
                        {conv.unreadCount > 99
                          ? t("conversationList.unreadOverflow")
                          : conv.unreadCount}
                      </span>
                    )}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </ScrollArea>
  );
}
