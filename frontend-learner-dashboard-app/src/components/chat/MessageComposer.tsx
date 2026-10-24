import { useRef, useState } from "react";
import { PaperPlaneRight, ImageSquare, X, Spinner } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useFileUpload } from "@/hooks/use-file-upload";
import { getChatUser } from "@/services/chat/getChatUser";
import { toast } from "sonner";

export interface ComposerAttachment {
  url: string;
  name: string;
  mime: string;
  size: number;
}

export interface MessageComposerProps {
  conversationId: string;
  disabled?: boolean;
  /** Reason shown in place of the composer when posting is blocked. */
  disabledReason?: string;
  allowAttachments?: boolean;
  onSend: (text: string, attachment?: ComposerAttachment) => void;
}

/**
 * Plain-text composer: a native <textarea> (v1 is text-first), Enter to send,
 * Shift+Enter for newline, with an optional single image attachment.
 */
export function MessageComposer({
  conversationId,
  disabled = false,
  disabledReason,
  allowAttachments = true,
  onSend,
}: MessageComposerProps) {
  const { t } = useTranslation("chatFeatureA");
  const [text, setText] = useState("");
  const [attachment, setAttachment] = useState<ComposerAttachment | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const { uploadFile, getPublicUrl } = useFileUpload();

  const canSend =
    !disabled && !isUploading && (text.trim().length > 0 || attachment !== null);

  const submit = () => {
    if (!canSend) return;
    onSend(text.trim(), attachment ?? undefined);
    setText("");
    setAttachment(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const handlePickFile = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error(t("composer.imageOnlyError"));
      e.target.value = "";
      return;
    }
    try {
      const { userId } = await getChatUser();
      const fileId = await uploadFile({
        file,
        setIsUploading,
        userId,
        source: "CHAT_MESSAGE",
        sourceId: conversationId,
      });
      const url = await getPublicUrl(fileId as string);
      setAttachment({
        url,
        name: file.name,
        mime: file.type,
        size: file.size,
      });
    } catch (err) {
      console.error("Chat attachment upload failed:", err);
      toast.error(t("composer.uploadFailedError"));
    } finally {
      e.target.value = "";
    }
  };

  if (disabled) {
    return (
      <div className="shrink-0 border-t border-border bg-muted/30 px-4 py-3 text-center text-caption text-muted-foreground">
        {disabledReason || t("composer.disabledDefault")}
      </div>
    );
  }

  return (
    <div className="shrink-0 border-t border-border bg-background px-3 py-2">
      {attachment && (
        <div className="mb-2 flex items-center gap-2 rounded-lg border border-border bg-muted/40 p-2">
          <img
            src={attachment.url}
            alt={attachment.name}
            className="size-12 shrink-0 rounded-md object-cover"
          />
          <span className="min-w-0 flex-1 truncate text-caption text-muted-foreground">
            {attachment.name}
          </span>
          <button
            type="button"
            aria-label={t("composer.removeAttachmentAria")}
            onClick={() => setAttachment(null)}
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
          >
            <X size={16} />
          </button>
        </div>
      )}

      <div className="flex items-end gap-2">
        {allowAttachments && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handlePickFile}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="shrink-0"
              aria-label={t("composer.attachAria")}
              disabled={isUploading}
              onClick={() => fileInputRef.current?.click()}
            >
              {isUploading ? (
                <Spinner size={20} className="animate-spin" />
              ) : (
                <ImageSquare size={20} />
              )}
            </Button>
          </>
        )}

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          placeholder={t("composer.placeholder")}
          className={cn(
            "max-h-40 min-h-10 flex-1 resize-none rounded-lg border border-input bg-background px-3 py-2",
            "text-body placeholder:text-muted-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        />

        <Button
          type="button"
          size="icon"
          className="shrink-0"
          aria-label={t("composer.sendAria")}
          disabled={!canSend}
          onClick={submit}
        >
          <PaperPlaneRight size={20} weight="fill" />
        </Button>
      </div>
    </div>
  );
}
