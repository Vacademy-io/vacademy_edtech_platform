import { useState, useCallback, useEffect, useRef } from 'react';
import {
    PaperPlaneRight,
    FileText,
    Paperclip,
    X,
    CircleNotch,
    Clock,
    Microphone,
    Stop,
} from '@phosphor-icons/react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import {
    sendReply,
    getSessionWindow,
    getInboxMediaSupport,
    type SessionWindow,
    type WhatsAppMediaKind,
} from '../-services/inbox-api';
import { useInboxStore } from '../-stores/inbox-store';
import { describeApiError, explainWhatsAppFailure } from '../-utils/whatsapp-errors';
import { templateHeaderKind } from '../-utils/template-header';
import { TemplateSendDialog } from './template-send-dialog';
import { splitTemplateText } from '@/components/templates/template-text';
import { getInstituteId } from '@/constants/helper';
import { getChatUser } from '@/services/chat/getChatUser';
import { UploadFileInS3, getPublicUrl } from '@/services/upload_file';
import { sendNotification } from '@/services/unified-send-service';
import { listTemplates, type WhatsAppTemplateDTO } from '@/routes/communication/whatsapp-templates/-services/template-api';

/**
 * Meta's ceilings for a free-form media message. Checked here so an oversized file is refused
 * before it is uploaded, rather than after a round trip that ends in an opaque provider error.
 */
const MEDIA_LIMITS: Record<WhatsAppMediaKind, number> = {
    image: 5 * 1024 * 1024,
    video: 16 * 1024 * 1024,
    audio: 16 * 1024 * 1024,
    document: 100 * 1024 * 1024,
};

/** The formats WhatsApp renders natively. Anything else has to travel as a document. */
const NATIVE_FORMATS: Record<Exclude<WhatsAppMediaKind, 'document'>, string[]> = {
    image: ['image/jpeg', 'image/png'],
    video: ['video/mp4', 'video/3gpp'],
    audio: ['audio/aac', 'audio/mpeg', 'audio/mp4', 'audio/amr', 'audio/ogg'],
};

interface Attachment {
    url: string;
    name: string;
    kind: WhatsAppMediaKind;
    size: number;
    /** Set when the file was downgraded to a document because WhatsApp cannot render its format. */
    downgradedFrom?: string;
}

function formatSize(bytes: number): string {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(seconds: number): string {
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/**
 * A recording format WhatsApp will actually play, or null if this browser can only produce one it
 * rejects.
 *
 * This is the whole difficulty with voice notes: MediaRecorder's universal format is WebM/Opus, and
 * WhatsApp accepts neither WebM nor any container it does not name. MP4/AAC and Ogg/Opus are the
 * two it does accept that browsers can also record, so we take whichever is on offer and refuse
 * rather than send a file that would come back as an opaque provider error.
 */
function pickRecordingFormat(): { mime: string; ext: string } | null {
    if (typeof MediaRecorder === 'undefined') return null;
    const candidates = [
        { mime: 'audio/mp4', ext: 'm4a' },
        { mime: 'audio/mp4;codecs=mp4a.40.2', ext: 'm4a' },
        { mime: 'audio/ogg;codecs=opus', ext: 'ogg' },
        { mime: 'audio/ogg', ext: 'ogg' },
    ];
    return candidates.find((c) => MediaRecorder.isTypeSupported(c.mime)) ?? null;
}

/**
 * Which WhatsApp message type a file should be sent as.
 *
 * A HEIC photo, a .mov clip or a FLAC track are all real files an admin will pick, and WhatsApp
 * refuses every one of them as its native type — so they are sent as documents instead, which
 * always delivers. The caller tells the admin when that happens rather than silently changing
 * what they asked for.
 */
function classifyAttachment(file: File): { kind: WhatsAppMediaKind; downgradedFrom?: string } {
    const mime = (file.type || '').toLowerCase();

    for (const [kind, formats] of Object.entries(NATIVE_FORMATS)) {
        const family = `${kind === 'image' ? 'image' : kind === 'video' ? 'video' : 'audio'}/`;
        if (!mime.startsWith(family)) continue;
        return formats.includes(mime)
            ? { kind: kind as WhatsAppMediaKind }
            : { kind: 'document', downgradedFrom: kind };
    }

    return { kind: 'document' };
}

interface Props {
    phone: string;
}

export function ReplyBox({ phone }: Props) {
    const { t } = useTranslation('communicationReplyBox');
    const [text, setText] = useState('');
    const [sending, setSending] = useState(false);
    const [showTemplates, setShowTemplates] = useState(false);
    const [templates, setTemplates] = useState<WhatsAppTemplateDTO[]>([]);
    const [templateSearch, setTemplateSearch] = useState('');
    /** The template open in the preview dialog; null = closed. */
    const [previewTemplate, setPreviewTemplate] = useState<WhatsAppTemplateDTO | null>(null);
    const appendMessage = useInboxStore((s) => s.appendMessage);
    const updateConversationLastMessage = useInboxStore((s) => s.updateConversationLastMessage);
    const markConversationAnswered = useInboxStore((s) => s.markConversationAnswered);
    const instituteId = getInstituteId() || '';

    const [attachment, setAttachment] = useState<Attachment | null>(null);
    const [uploading, setUploading] = useState(false);
    const [window24h, setWindow24h] = useState<SessionWindow | null>(null);
    const [mediaSupport, setMediaSupport] = useState(getInboxMediaSupport());
    const [recording, setRecording] = useState(false);
    const [recordedSeconds, setRecordedSeconds] = useState(0);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const recorderRef = useRef<MediaRecorder | null>(null);
    const chunksRef = useRef<Blob[]>([]);
    const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const discardRef = useRef(false);

    // How much of Meta's 24-hour reply window is left. Null when the backend does not report it,
    // in which case the composer behaves exactly as it always has.
    useEffect(() => {
        let cancelled = false;
        setWindow24h(null);
        setAttachment(null);
        getSessionWindow(phone, instituteId).then((w) => {
            if (cancelled) return;
            setWindow24h(w);
            setMediaSupport(getInboxMediaSupport());
        });
        return () => {
            cancelled = true;
        };
    }, [phone, instituteId]);

    // Load templates when panel opens
    useEffect(() => {
        if (showTemplates && templates.length === 0) {
            listTemplates(instituteId)
                .then((data) => setTemplates(data.filter((tpl) => tpl.status === 'APPROVED')))
                .catch(() => toast.error(t('toast.loadTemplatesFailed')));
        }
    }, [showTemplates]);

    /** Validate, upload and stage one file — shared by the file picker and the voice recorder. */
    const stageFile = useCallback(
        async (file: File) => {
            const { kind, downgradedFrom } = classifyAttachment(file);
            const limit = MEDIA_LIMITS[kind];
            if (file.size > limit) {
                toast.error(
                    t('toast.fileTooLarge', {
                        fileName: file.name,
                        fileSize: formatSize(file.size),
                        limit: formatSize(limit),
                        kindLabel: t(`mediaKindPlural.${kind}`),
                    })
                );
                return;
            }

            setUploading(true);
            try {
                const { userId } = getChatUser();
                const fileId = await UploadFileInS3(
                    file,
                    setUploading,
                    userId,
                    'WHATSAPP_INBOX',
                    instituteId,
                    true
                );
                if (!fileId) {
                    toast.error(t('toast.uploadFailed'));
                    return;
                }
                // WhatsApp fetches the file itself, so this has to be a public URL, not a file id.
                const url = await getPublicUrl(fileId);
                if (!url) {
                    toast.error(t('toast.noPublicLink'));
                    return;
                }
                setAttachment({ url, name: file.name, kind, size: file.size, downgradedFrom });
                if (downgradedFrom) {
                    toast.info(
                        t('toast.downgradedToDocument', {
                            fileType: file.type || t('thisFormat'),
                            asLabel: t(`downgradeAsLabel.${downgradedFrom}`),
                        })
                    );
                }
            } catch (err) {
                console.error(err);
                toast.error(t('toast.uploadFailed'));
            } finally {
                setUploading(false);
            }
        },
        [instituteId, t]
    );

    /** Release the mic and the timer. Safe to call twice. */
    const teardownRecorder = useCallback(() => {
        if (tickRef.current) {
            clearInterval(tickRef.current);
            tickRef.current = null;
        }
        recorderRef.current?.stream.getTracks().forEach((track) => track.stop());
        recorderRef.current = null;
        setRecording(false);
        setRecordedSeconds(0);
    }, []);

    // Never leave the microphone open because the admin navigated away mid-recording.
    useEffect(() => teardownRecorder, [teardownRecorder]);

    const startRecording = useCallback(async () => {
        if (mediaSupport === 'no') {
            toast.error(t('toast.voiceNotesUnavailable'));
            return;
        }
        const format = pickRecordingFormat();
        if (!format) {
            toast.error(t('toast.unsupportedRecordingFormat'));
            return;
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const recorder = new MediaRecorder(stream, { mimeType: format.mime });
            chunksRef.current = [];
            discardRef.current = false;

            recorder.ondataavailable = (e) => {
                if (e.data.size > 0) chunksRef.current.push(e.data);
            };
            recorder.onstop = async () => {
                const chunks = chunksRef.current;
                chunksRef.current = [];
                const discarded = discardRef.current;
                teardownRecorder();
                if (discarded || chunks.length === 0) return;

                const blob = new Blob(chunks, { type: format.mime });
                const file = new File([blob], `voice-note-${Date.now()}.${format.ext}`, {
                    // The bare mime without codec parameters — classifyAttachment matches on it.
                    type: format.mime.split(';')[0],
                });
                await stageFile(file);
            };

            recorderRef.current = recorder;
            recorder.start();
            setRecording(true);
            setRecordedSeconds(0);
            tickRef.current = setInterval(() => setRecordedSeconds((n) => n + 1), 1000);
        } catch (err) {
            console.error(err);
            toast.error(t('toast.micAccessDenied'));
        }
    }, [mediaSupport, stageFile, teardownRecorder, t]);

    const stopRecording = useCallback((discard: boolean) => {
        discardRef.current = discard;
        const recorder = recorderRef.current;
        if (recorder && recorder.state !== 'inactive') {
            recorder.stop(); // onstop uploads or discards, then tears down
        }
    }, []);

    /**
     * A greyed-out button that does nothing when clicked reads as a bug. If the backend cannot
     * accept attachments yet, say so out loud — `/inbox/send` ignores fields it does not know, so
     * an older backend would deliver the caption as a plain text message and drop the file with
     * nobody told.
     */
    const openFilePicker = useCallback(() => {
        if (mediaSupport === 'no') {
            toast.error(t('toast.attachmentsUnavailable'));
            return;
        }
        fileInputRef.current?.click();
    }, [mediaSupport, t]);

    const handleFilePick = useCallback(
        async (e: React.ChangeEvent<HTMLInputElement>) => {
            const file = e.target.files?.[0];
            // Reset immediately so picking the same file twice still fires a change event.
            e.target.value = '';
            if (!file) return;

            await stageFile(file);
        },
        [stageFile]
    );

    const handleSend = useCallback(async () => {
        if ((!text.trim() && !attachment) || sending) return;

        setSending(true);
        try {
            // With an attachment the typed text rides along as the caption.
            const caption = text.trim();
            const sent = await sendReply(phone, caption, instituteId, {
                ...(attachment
                    ? {
                          mediaType: attachment.kind,
                          mediaUrl: attachment.url,
                          filename: attachment.name,
                      }
                    : {}),
            });
            appendMessage(sent);
            updateConversationLastMessage(
                phone,
                sent.body || caption || attachment?.name || '',
                'OUTGOING'
            );
            // The backend resolved any open hand-over as part of this send; clear the badge now
            // rather than waiting for the next poll.
            markConversationAnswered(phone);
            setText('');
            setAttachment(null);
        } catch (err) {
            console.error(err);
            // A refused send is recorded in the thread as "Not delivered", so the toast says what
            // WhatsApp actually objected to — "24-hour reply window closed" rather than the raw
            // "Re-engagement message (131047)" — and points at the thread for the rest.
            const { title, detail } = describeApiError(err, t('toast.messageNotSent'));
            toast.error(title, {
                description: detail
                    ? `${detail} ${t('toast.notDeliveredNote')}`
                    : t('toast.notDeliveredNote'),
            });
        } finally {
            setSending(false);
        }
    }, [
        text,
        attachment,
        phone,
        sending,
        appendMessage,
        updateConversationLastMessage,
        markConversationAnswered,
        instituteId,
        t,
    ]);

    /**
     * Picking a template opens the preview dialog; nothing is sent until the admin confirms
     * there. The variable values arrive already keyed by position ("1", "2", …), which is
     * what the send API expects.
     */
    const handleSendTemplate = useCallback(async (
        template: WhatsAppTemplateDTO,
        variables: Record<string, string>
    ): Promise<boolean> => {
        // A template approved with a media header MUST be sent with that header: Meta rejects the
        // message otherwise (error 132012 "header: Format mismatch, expected DOCUMENT, received
        // UNKNOWN"). The Inbox has no file picker, so the file is the sample the template was
        // approved with — the same default the other send dialogs use. The dialog already blocks
        // this case; the check stays as the last line of defence.
        const headerKind = templateHeaderKind(template);
        const headerUrl = template.headerSampleUrl?.trim() || '';
        if (headerKind && !headerUrl) {
            toast.error(t('toast.templateNotSent', { name: template.name }), {
                description: t('toast.templateHeaderFileMissing', {
                    name: template.name,
                    kind: t(`mediaKindLabel.${headerKind}`),
                }),
            });
            return false;
        }

        setSending(true);
        try {
            const response = await sendNotification({
                instituteId,
                channel: 'WHATSAPP',
                templateName: template.name,
                languageCode: template.language || 'en',
                recipients: [{ phone, variables }],
                options: {
                    source: 'inbox-template-send',
                    ...(headerKind ? { headerType: headerKind, headerUrl } : {}),
                },
            });

            if (response.status === 'COMPLETED' && response.accepted > 0) {
                toast.success(t('toast.templateSent', { name: template.name }));
                // The bubble shows the message as sent — values in, placeholders out — so the
                // thread reads the same before and after a reload.
                const renderedBody = splitTemplateText(template.bodyText, {
                    variableNames: template.bodyVariableNames,
                    values: variables,
                })
                    .map((part) =>
                        part.kind === 'text' ? part.text : (part.value ?? `{{${part.token}}}`)
                    )
                    .join('');
                appendMessage({
                    id: Date.now().toString(),
                    body: `${t('templateLabel', { name: template.name })} ${renderedBody}`,
                    direction: 'OUTGOING',
                    timestamp: new Date().toISOString(),
                    source: 'unified-send',
                    ...(headerKind ? { headerType: headerKind, headerMediaUrl: headerUrl } : {}),
                });
                updateConversationLastMessage(
                    phone,
                    t('templateShortLabel', { name: template.name }),
                    'OUTGOING'
                );
                setShowTemplates(false);
                return true;
            }
            const failure = explainWhatsAppFailure(response.results?.[0]?.error);
            toast.error(t('toast.templateNotSent', { name: template.name }), {
                description: failure
                    ? [failure.title, failure.detail].filter(Boolean).join(' — ')
                    : t('toast.providerRejectedNoReason'),
            });
            return false;
        } catch (err) {
            console.error(err);
            const { title, detail } = describeApiError(
                err,
                t('toast.couldNotSendTemplate', { name: template.name })
            );
            toast.error(title, detail ? { description: detail } : undefined);
            return false;
        } finally {
            setSending(false);
        }
    }, [phone, instituteId, appendMessage, updateConversationLastMessage, t]);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const filteredTemplates = templates.filter(
        (tpl) => tpl.name.toLowerCase().includes(templateSearch.toLowerCase()) ||
               (tpl.bodyText || '').toLowerCase().includes(templateSearch.toLowerCase())
    );

    return (
        <div className="relative shrink-0">
            <TemplateSendDialog
                template={previewTemplate}
                phone={phone}
                onClose={() => setPreviewTemplate(null)}
                onSend={async (template, variables) => {
                    // Stay open on failure so the values can be corrected and retried.
                    if (await handleSendTemplate(template, variables)) setPreviewTemplate(null);
                }}
            />

            {/* Template picker dropdown */}
            {showTemplates && (
                <div className="absolute bottom-full left-0 right-0 bg-white border-t shadow-lg max-h-72 flex flex-col">
                    <div className="flex items-center justify-between px-3 py-2 border-b">
                        <span className="text-xs font-semibold text-gray-600">{t('sendTemplateHeader')}</span>
                        <button onClick={() => setShowTemplates(false)} className="p-1 hover:bg-gray-100 rounded">
                            <X size={14} />
                        </button>
                    </div>
                    <div className="px-3 py-1.5">
                        <input
                            type="text"
                            value={templateSearch}
                            onChange={(e) => setTemplateSearch(e.target.value)}
                            placeholder={t('searchTemplatesPlaceholder')}
                            className="w-full px-2 py-1 text-xs border rounded"
                        />
                    </div>
                    <div className="flex-1 overflow-y-auto">
                        {filteredTemplates.length === 0 ? (
                            <p className="text-xs text-gray-400 text-center py-4">{t('noApprovedTemplates')}</p>
                        ) : (
                            filteredTemplates.map((tpl) => (
                                <button
                                    key={tpl.id}
                                    onClick={() => {
                                        setPreviewTemplate(tpl);
                                        setShowTemplates(false);
                                    }}
                                    disabled={sending}
                                    className="w-full text-left px-3 py-2 hover:bg-green-50 border-b border-gray-50 disabled:opacity-50"
                                >
                                    <p className="text-xs font-medium text-gray-800">{tpl.name}</p>
                                    <p className="text-[10px] text-gray-400 truncate">{tpl.bodyText}</p>
                                </button>
                            ))
                        )}
                    </div>
                </div>
            )}

            {/* Why a reply will not go through. WhatsApp only accepts free-form messages and
                attachments for 24 hours after the contact's last message; after that an approved
                template is the only thing that reaches them. Shown only when we actually know the
                window has lapsed — an unknown window stays quiet and lets the send be attempted. */}
            {window24h && !window24h.open && !window24h.unknown && (
                <div className="flex items-start gap-2 border-t border-amber-200 bg-amber-50 px-4 py-2">
                    <Clock size={15} className="mt-0.5 shrink-0 text-amber-600" />
                    <p className="text-xs text-amber-800">
                        <span className="font-medium">{t('windowClosed.title')}</span>{' '}
                        {t('windowClosed.body')}{' '}
                        <button
                            onClick={() => setShowTemplates(true)}
                            className="underline underline-offset-2 hover:text-amber-900"
                        >
                            {t('windowClosed.linkText')}
                        </button>{' '}
                        {t('windowClosed.suffix')}
                    </p>
                </div>
            )}

            {/* Attachment staged for sending. The caption is whatever is in the text box. */}
            {attachment && (
                <div className="flex items-center gap-2 border-t bg-gray-50 px-4 py-2">
                    {attachment.kind === 'image' ? (
                        <img src={attachment.url} alt="" className="size-10 rounded object-cover" />
                    ) : (
                        <span className="flex size-10 items-center justify-center rounded bg-white text-gray-400">
                            <FileText size={18} />
                        </span>
                    )}
                    <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-gray-700">
                            {attachment.name}
                        </p>
                        <p className="text-[11px] text-gray-400">
                            {[
                                t(`mediaKindLabel.${attachment.kind}`),
                                formatSize(attachment.size),
                                attachment.downgradedFrom ? t('sentAsDocument') : null,
                                attachment.kind === 'audio' ? t('audioNoCaption') : null,
                            ]
                                .filter(Boolean)
                                .join(' · ')}
                        </p>
                    </div>
                    <button
                        onClick={() => setAttachment(null)}
                        className="rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-600"
                        title={t('removeAttachment')}
                    >
                        <X size={14} />
                    </button>
                </div>
            )}

            {/* Recording in progress */}
            {recording && (
                <div className="flex items-center gap-2 border-t bg-red-50 px-4 py-2">
                    <span className="size-2 animate-pulse rounded-full bg-red-500" />
                    <p className="flex-1 text-xs text-red-700">
                        {t('recordingInProgress', { duration: formatDuration(recordedSeconds) })}
                    </p>
                    <button
                        onClick={() => stopRecording(true)}
                        className="rounded px-2 py-1 text-xs text-red-600 hover:bg-red-100"
                    >
                        {t('cancel')}
                    </button>
                </div>
            )}

            {/* Reply bar */}
            <div className="px-4 py-3 bg-white border-t flex items-end gap-2">
                <button
                    onClick={() => setShowTemplates(!showTemplates)}
                    className="p-2 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg shrink-0"
                    title={t('sendTemplateTooltip')}
                >
                    <FileText size={20} />
                </button>
                <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv"
                    onChange={handleFilePick}
                />
                <button
                    onClick={openFilePicker}
                    disabled={uploading || sending || recording}
                    className={`shrink-0 rounded-lg p-2 hover:bg-green-50 hover:text-green-600 disabled:opacity-40 ${
                        mediaSupport === 'no' ? 'text-gray-300' : 'text-gray-400'
                    }`}
                    title={
                        mediaSupport === 'no'
                            ? t('attachmentsUnavailableTooltip')
                            : t('attachTooltip')
                    }
                >
                    {uploading ? (
                        <CircleNotch size={20} className="animate-spin" />
                    ) : (
                        <Paperclip size={20} />
                    )}
                </button>
                <button
                    onClick={recording ? () => stopRecording(false) : startRecording}
                    disabled={uploading || sending}
                    className={`shrink-0 rounded-lg p-2 disabled:opacity-40 ${
                        recording
                            ? 'bg-red-50 text-red-600 hover:bg-red-100'
                            : mediaSupport === 'no'
                              ? 'text-gray-300 hover:bg-green-50 hover:text-green-600'
                              : 'text-gray-400 hover:bg-green-50 hover:text-green-600'
                    }`}
                    title={recording ? t('stopRecordingTooltip') : t('recordVoiceNoteTooltip')}
                >
                    {recording ? <Stop size={20} weight="fill" /> : <Microphone size={20} />}
                </button>
                <textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={attachment ? t('captionPlaceholder') : t('messagePlaceholder')}
                    rows={1}
                    className="flex-1 px-3 py-2 text-sm border rounded-lg resize-none focus:outline-none focus:ring-1 focus:ring-green-400 max-h-24"
                    style={{ minHeight: '40px' }}
                />
                <button
                    onClick={handleSend}
                    disabled={(!text.trim() && !attachment) || sending || uploading}
                    className="p-2.5 bg-green-500 text-white rounded-full hover:bg-green-600 disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                >
                    <PaperPlaneRight size={18} weight="fill" />
                </button>
            </div>
        </div>
    );
}
