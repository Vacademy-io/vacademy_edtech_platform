import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { MagnifyingGlass } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import {
  searchPeople,
  openDirectConversation,
  type ChatPersonResponse,
  type ChatConversationResponse,
} from "@/services/chat/chatApi";
import { initialsOf } from "./chatUtils";
import { toast } from "sonner";
import { getTerminologyPlural } from "@/components/common/layout-container/sidebar/utils";
import { RoleTerms, SystemTerms } from "@/types/naming-settings";

export interface NewChatModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the opened/existing DM conversation after a person is picked. */
  onConversationReady: (conversation: ChatConversationResponse) => void;
}

const PAGE_SIZE = 20;

export function NewChatModal({
  open,
  onOpenChange,
  onConversationReady,
}: NewChatModalProps) {
  const { t } = useTranslation("chatFeatureA");
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<string | undefined>(undefined);
  const [people, setPeople] = useState<ChatPersonResponse[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [startingId, setStartingId] = useState<string | null>(null);

  // Labels are derived from per-institute naming settings; API role VALUES
  // (TEACHER / ADMIN / STUDENT) stay fixed. Computed inside the component so
  // it reflects the current institute's configured terminology.
  const roleFilters: { label: string; value?: string }[] = [
    { label: t("newChatModal.everyone"), value: undefined },
    {
      label: getTerminologyPlural(RoleTerms.Teacher, SystemTerms.Teacher),
      value: "TEACHER",
    },
    {
      label: getTerminologyPlural(RoleTerms.Admin, SystemTerms.Admin),
      value: "ADMIN",
    },
    {
      label: getTerminologyPlural(RoleTerms.Learner, SystemTerms.Learner),
      value: "STUDENT",
    },
  ];

  // Debounced search whenever the modal is open and query/role change.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setIsLoading(true);
    const handle = setTimeout(() => {
      searchPeople({
        roles: role ? [role] : undefined,
        nameQuery: query.trim() || undefined,
        pageNumber: 0,
        pageSize: PAGE_SIZE,
      })
        .then((res) => {
          if (!cancelled) setPeople(res.people ?? []);
        })
        .catch(() => {
          if (!cancelled) setPeople([]);
        })
        .finally(() => {
          if (!cancelled) setIsLoading(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [open, query, role]);

  // Reset transient state when closing.
  useEffect(() => {
    if (!open) {
      setQuery("");
      setRole(undefined);
      setPeople([]);
      setStartingId(null);
    }
  }, [open]);

  const startDm = async (person: ChatPersonResponse) => {
    setStartingId(person.userId);
    try {
      const conv = await openDirectConversation({
        targetUserId: person.userId,
        targetUserName: person.fullName,
        targetUserRole: person.role,
      });
      onConversationReady(conv);
      onOpenChange(false);
    } catch (err) {
      console.error("Failed to start direct conversation:", err);
      toast.error(t("newChatModal.startError"));
    } finally {
      setStartingId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("newChatModal.title")}</DialogTitle>
        </DialogHeader>

        <div className="relative">
          <MagnifyingGlass
            size={18}
            className="absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("newChatModal.searchPlaceholder")}
            className="ps-9"
          />
        </div>

        <div className="flex flex-wrap gap-1.5">
          {roleFilters.map((f) => (
            <button
              key={f.label}
              type="button"
              onClick={() => setRole(f.value)}
              className={cn(
                "rounded-full border px-3 py-1 text-caption font-medium transition-colors",
                role === f.value
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-input bg-background text-muted-foreground hover:bg-muted",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="max-h-72 overflow-y-auto">
          {isLoading ? (
            <div className="space-y-1 py-1">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="flex items-center gap-3 p-2">
                  <Skeleton className="size-9 shrink-0 rounded-full" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              ))}
            </div>
          ) : people.length === 0 ? (
            <p className="py-8 text-center text-caption text-muted-foreground">
              {t("newChatModal.empty")}
            </p>
          ) : (
            <ul className="flex flex-col py-1">
              {people.map((person) => (
                <li key={person.userId}>
                  <button
                    type="button"
                    disabled={startingId !== null}
                    onClick={() => startDm(person)}
                    className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-start transition-colors hover:bg-muted disabled:opacity-60"
                  >
                    <span
                      aria-hidden
                      className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-50 text-caption font-semibold text-primary-500"
                    >
                      {initialsOf(person.fullName)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body font-medium text-foreground">
                        {person.fullName || person.email || t("common.memberFallback")}
                      </span>
                      <span className="block truncate text-caption text-muted-foreground">
                        {person.role}
                        {person.email ? ` · ${person.email}` : ""}
                      </span>
                    </span>
                    {startingId === person.userId && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled
                        className="pointer-events-none"
                      >
                        {t("newChatModal.opening")}
                      </Button>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
