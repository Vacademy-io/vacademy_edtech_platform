import { useRef, useState } from 'react';
import { PaperPlaneRight, Paperclip, X, SpinnerGap } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { UploadFileInS3, getPublicUrl } from '@/services/upload_file';
import { getChatUser } from '@/services/chat/getChatUser';
import type { SendChatMessageRequest } from '@/services/chat/chatApi';

interface PendingAttachment {
    url: string;
    name: string;
    mime: string;
    size: number;
}

interface MessageComposerProps {
    conversationId: string;
    disabled?: boolean;
    disabledReason?: string;
    allowAttachments?: boolean;
    onSend: (body: SendChatMessageRequest) => void;
}

/**
 * Text-first composer: a plain <textarea> (Enter sends, Shift+Enter newline)
 * plus an optional single image attachment uploaded via the S3 helper.
 */
export function MessageComposer({
    conversationId,
    disabled = false,
    disabledReason,
    allowAttachments = true,
    onSend,
}: MessageComposerProps) {
    const [text, setText] = useState('');
    const [attachment, setAttachment] = useState<PendingAttachment | null>(null);
    const [isUploading, setIsUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const canSend = (text.trim().length > 0 || attachment !== null) && !disabled && !isUploading;

    const handleSubmit = () => {
        if (!canSend) return;
        const body: SendChatMessageRequest = {
            contentType: attachment ? 'IMAGE' : 'TEXT',
            text: text.trim() || undefined,
            clientDedupKey: crypto.randomUUID(),
        };
        if (attachment) {
            body.attachmentUrl = attachment.url;
            body.attachmentName = attachment.name;
            body.attachmentMime = attachment.mime;
            body.attachmentSize = attachment.size;
        }
        onSend(body);
        setText('');
        setAttachment(null);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSubmit();
        }
    };

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        if (!file.type.startsWith('image/')) {
            toast.error('Only images can be attached in this version.');
            return;
        }
        try {
            const { userId } = getChatUser();
            const fileId = await UploadFileInS3(
                file,
                setIsUploading,
                userId,
                'CHAT_MESSAGE',
                conversationId,
                true
            );
            if (!fileId) {
                toast.error('Upload failed. Please try again.');
                return;
            }
            const url = await getPublicUrl(fileId);
            if (!url) {
                toast.error('Could not resolve the uploaded image URL.');
                return;
            }
            setAttachment({ url, name: file.name, mime: file.type, size: file.size });
        } catch {
            toast.error('Upload failed. Please try again.');
        }
    };

    return (
        <div className="shrink-0 border-t border-neutral-200 bg-white p-3">
            {disabled && disabledReason && (
                <p className="mb-2 text-center text-xs text-neutral-500">{disabledReason}</p>
            )}

            {attachment && (
                <div className="mb-2 flex items-center gap-3 rounded-md border border-neutral-200 bg-neutral-50 p-2">
                    <img
                        src={attachment.url}
                        alt={attachment.name}
                        className="size-12 rounded object-cover"
                    />
                    <span className="min-w-0 flex-1 truncate text-xs text-neutral-600">
                        {attachment.name}
                    </span>
                    <button
                        type="button"
                        onClick={() => setAttachment(null)}
                        className="text-neutral-400 hover:text-danger-500"
                        aria-label="Remove attachment"
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
                            onChange={handleFileChange}
                        />
                        <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            disabled={disabled || isUploading}
                            onClick={() => fileInputRef.current?.click()}
                            className="size-10 shrink-0"
                            aria-label="Attach image"
                        >
                            {isUploading ? (
                                <SpinnerGap size={18} className="animate-spin" />
                            ) : (
                                <Paperclip size={18} />
                            )}
                        </Button>
                    </>
                )}

                <textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={handleKeyDown}
                    disabled={disabled}
                    rows={1}
                    placeholder={disabled ? 'You cannot post here' : 'Type a message...'}
                    className={cn(
                        'max-h-32 min-h-10 flex-1 resize-none rounded-md border border-neutral-300 px-3 py-2 text-sm',
                        'focus:border-primary-400 focus:outline-none focus:ring-1 focus:ring-primary-400',
                        'disabled:cursor-not-allowed disabled:bg-neutral-50'
                    )}
                />

                <Button
                    type="button"
                    onClick={handleSubmit}
                    disabled={!canSend}
                    className="size-10 shrink-0 bg-primary-500 p-0 text-white hover:opacity-90"
                    aria-label="Send message"
                >
                    <PaperPlaneRight size={18} weight="fill" />
                </Button>
            </div>
        </div>
    );
}
