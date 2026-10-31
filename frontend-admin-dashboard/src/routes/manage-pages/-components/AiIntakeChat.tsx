/**
 * Assistive intake — the wizard's chat-first mode. The AI interviews the
 * admin (one question per turn), requests uploads (logo / photos /
 * inspiration screenshots) when they'd lift the result, and assembles a
 * composer-ready brief. On completion the wizard takes over with the
 * existing confirm → generate → review flow.
 */
import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { CircleNotch, PaperPlaneTilt, Image as ImageIcon, Sparkle, X } from '@phosphor-icons/react';
import { useToast } from '@/hooks/use-toast';
import { useFileUpload } from '@/hooks/use-file-upload';
import { getPublicUrl } from '@/services/upload_file';
import { getUserId } from '@/utils/userDetails';
import {
    intakeAiTurn, IntakeTurn, IntakeResponse, AiPageImage, AiCourseSnapshotItem,
    MAX_INSPIRATION_IMAGES,
} from '../-services/ai-page-service';
import { findFigmaUrl } from '../-utils/figma-link';
import { FigmaLinkNotice } from './FigmaLinkNotice';

export interface IntakeResult {
    brief: string;
    pageType: string;
    wholeSite: boolean;
    images: AiPageImage[];
    inspiration: string[];
}

const UPLOAD_LABELS: Record<string, string> = {
    logo: 'Upload your logo',
    photo: 'Upload a photo',
    inspiration: 'Upload a screenshot of a site you like',
};

/** One chat bubble; long pasted briefs collapse so they don't wall the chat. */
const Bubble = ({ turn }: { turn: IntakeTurn }) => {
    const [expanded, setExpanded] = useState(false);
    const isUser = turn.role === 'user';
    const long = turn.content.length > 360;
    return (
        <div className={`flex items-end gap-2 ${isUser ? 'justify-end' : 'justify-start'}`}>
            {!isUser && (
                <div className="mb-1 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary-50">
                    <Sparkle className="size-4 text-primary-500" weight="duotone" />
                </div>
            )}
            <div
                className={`max-w-md rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                    isUser
                        ? 'rounded-br-sm bg-primary-500 text-white'
                        : 'rounded-bl-sm border border-gray-100 bg-gray-50 text-gray-800'
                }`}
            >
                <p className={`whitespace-pre-wrap ${long && !expanded ? 'line-clamp-6' : ''}`}>
                    {turn.content}
                </p>
                {long && (
                    <button
                        onClick={() => setExpanded((e) => !e)}
                        className={`mt-1 text-xs font-medium underline ${isUser ? 'text-white' : 'text-primary-500'}`}
                    >
                        {expanded ? 'Show less' : 'Show more'}
                    </button>
                )}
                {turn.image_urls && turn.image_urls.length > 0 && (
                    <div className="mt-2 flex gap-2">
                        {turn.image_urls.map((u, j) => (
                            <img key={j} src={u} alt="" className="size-16 rounded-md border border-white/30 object-cover" />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export const AiIntakeChat = ({
    instituteName,
    courses,
    terminology,
    onComplete,
}: {
    instituteName?: string;
    courses: AiCourseSnapshotItem[];
    terminology: Record<string, string>;
    onComplete: (result: IntakeResult) => void;
}) => {
    const { toast } = useToast();
    // Local opening turn — instant, free, and the first real API call only
    // happens once the admin actually replies.
    const opening: IntakeResponse = {
        reply:
            `Hi! I'll help you create ${instituteName ? `${instituteName}'s` : 'your'} website — ` +
            `I'll ask a few quick questions, and you can share your logo, photos, or screenshots of ` +
            `sites you like along the way.\n\nFirst: what is this website mainly for, and what makes ` +
            `your institute special?`,
        chips: ['Attract new admissions', 'Showcase our results', 'Replace our old website'],
        request_upload: null,
        ready: false,
        brief: null,
        page_type: 'homepage',
        whole_site: false,
        run_id: '',
        model: '',
    };
    const [messages, setMessages] = useState<IntakeTurn[]>([
        { role: 'assistant', content: opening.reply },
    ]);
    const [last, setLast] = useState<IntakeResponse | null>(opening);
    const [input, setInput] = useState('');
    // Images staged on the composer bar (sent with the next message).
    const [pendingImages, setPendingImages] = useState<string[]>([]);
    const [uploadBusy, setUploadBusy] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const { uploadFile } = useFileUpload();
    // Everything collected across the conversation, handed to the generator.
    const collectedImages = useRef<AiPageImage[]>([]);
    const collectedInspiration = useRef<string[]>([]);
    // Images from the message in flight — classified once the assistant
    // replies (it SEES them): a website screenshot must land in inspiration,
    // not as a content photo the composer could place on the page.
    const inFlightImages = useRef<string[]>([]);
    const inFlightKindHint = useRef<string | null>(null);
    const inFlightText = useRef('');
    const scrollRef = useRef<HTMLDivElement>(null);

    const turnMutation = useMutation({
        mutationFn: (history: IntakeTurn[]) =>
            intakeAiTurn({
                history,
                institute_name: instituteName,
                courses,
                terminology,
            }),
        onSuccess: (res) => {
            setLast(res);
            setMessages((m) => [...m, { role: 'assistant', content: res.reply }]);
            // Route the just-sent images using the assistant's classification,
            // falling back to whatever it had asked for.
            const kind = res.received_image_kind || inFlightKindHint.current || 'photo';
            for (const url of inFlightImages.current) {
                if (kind === 'inspiration') {
                    if (!collectedInspiration.current.includes(url)) collectedInspiration.current.push(url);
                } else if (!collectedImages.current.some((i) => i.url === url)) {
                    collectedImages.current.push({ url, kind: kind as AiPageImage['kind'] });
                }
            }
            inFlightImages.current = [];
            inFlightKindHint.current = null;
        },
        onError: (err: any) => {
            const detail = err?.response?.data?.detail;
            toast({
                title: 'That message didn’t go through',
                description: typeof detail === 'string' ? detail : 'Your message is back in the box — just send it again.',
                variant: 'destructive',
            });
            // Put the failed turn back in the composer so one tap retries it —
            // otherwise a long pasted brief + image would strand the chat.
            setMessages((m) => (m[m.length - 1]?.role === 'user' ? m.slice(0, -1) : m));
            setInput(inFlightText.current);
            setPendingImages(inFlightImages.current);
            inFlightImages.current = [];
            inFlightKindHint.current = null;
            inFlightText.current = '';
        },
    });

    useEffect(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    }, [messages, turnMutation.isPending]);

    const send = (text: string) => {
        const content = text.trim();
        if ((!content && pendingImages.length === 0) || turnMutation.isPending) return;
        // Hold uploads unclassified until the assistant (which sees them)
        // tells us what they are in its reply.
        inFlightImages.current = pendingImages;
        inFlightKindHint.current = last?.request_upload || null;
        inFlightText.current = content;
        const turn: IntakeTurn = {
            role: 'user',
            content: content || '(uploaded an image)',
            ...(pendingImages.length ? { image_urls: pendingImages } : {}),
        };
        const history = [...messages, turn];
        setMessages(history);
        setInput('');
        setPendingImages([]);
        turnMutation.mutate(history);
    };

    // Upload from the composer — stages EVERY selected image for the next send
    // (admins share several screenshots/photos at once; forcing one-by-one
    // uploads was the field complaint).
    const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        if (files.length === 0) return;
        const userId = getUserId();
        if (!userId) return;
        try {
            setUploadBusy(true);
            for (const file of files) {
                const fileId = await uploadFile({
                    file,
                    setIsUploading: () => {},
                    userId,
                    source: 'CATALOGUE_IMAGES',
                    sourceId: 'ADMIN',
                    publicUrl: true,
                });
                if (fileId) {
                    const url = (await getPublicUrl(fileId)) || fileId;
                    setPendingImages((p) => (p.includes(url) ? p : [...p, url]));
                }
            }
        } catch {
            toast({ title: 'Upload failed', description: 'Some images may not have uploaded — please retry.', variant: 'destructive' });
        } finally {
            setUploadBusy(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const finish = () => {
        if (!last?.brief) return;
        onComplete({
            brief: last.brief,
            pageType: last.page_type || 'homepage',
            wholeSite: last.whole_site,
            images: collectedImages.current,
            inspiration: collectedInspiration.current.slice(0, MAX_INSPIRATION_IMAGES),
        });
    };

    const askingUpload = !!last?.request_upload && !turnMutation.isPending;
    // Said while the link is still in the box: the assistant cannot open Figma
    // either (its reply repeats this and opens the screenshot uploader).
    const typingFigmaLink = !!findFigmaUrl(input);

    return (
        <div className="flex h-dialog-chat flex-col">
            {/* Transcript */}
            <div ref={scrollRef} className="min-h-40 flex-1 space-y-3 overflow-y-auto border-y border-gray-100 py-3 pr-1">
                {messages.map((m, i) => (
                    <Bubble key={i} turn={m} />
                ))}
                {turnMutation.isPending && (
                    <div className="flex items-end gap-2">
                        <div className="mb-1 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary-50">
                            <Sparkle className="size-4 text-primary-500" weight="duotone" />
                        </div>
                        <div className="flex items-center gap-2 rounded-2xl rounded-bl-sm border border-gray-100 bg-gray-50 px-4 py-2.5 text-sm text-gray-400">
                            <CircleNotch className="size-4 animate-spin" /> thinking…
                        </div>
                    </div>
                )}
            </div>

            {/* Quick-reply chips */}
            {!turnMutation.isPending && (last?.chips?.length ?? 0) > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                    {last!.chips.map((c, i) => (
                        <button
                            key={i}
                            onClick={() => send(c)}
                            className="rounded-full border border-primary-200 bg-primary-50 px-3 py-1 text-xs font-medium text-primary-500 hover:bg-primary-100"
                        >
                            {c}
                        </button>
                    ))}
                </div>
            )}

            {/* Slim upload prompt — one tap opens the file picker */}
            {askingUpload && (
                <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="mt-2 flex items-center gap-2 rounded-lg border border-dashed border-primary-200 bg-primary-50 px-3 py-2 text-xs font-medium text-primary-500 hover:bg-primary-100"
                >
                    <ImageIcon className="size-4" />
                    {UPLOAD_LABELS[last?.request_upload || 'photo']}
                </button>
            )}

            {/* Staged images going out with the next message */}
            {pendingImages.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                    {pendingImages.map((u, i) => (
                        <div key={i} className="relative">
                            <img src={u} alt="" className="size-12 rounded border border-gray-200 object-cover" />
                            <button
                                onClick={() => setPendingImages((p) => p.filter((x) => x !== u))}
                                className="absolute -right-1.5 -top-1.5 rounded-full bg-danger-500 p-0.5 text-white"
                            >
                                <X className="size-3" />
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {typingFigmaLink && <FigmaLinkNotice className="mt-2" />}

            {/* Composer */}
            <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={handleFile}
            />
            <div className="mt-2 flex items-end gap-1.5">
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className={`size-9 shrink-0 p-0 ${askingUpload ? 'border-primary-300 text-primary-500 ring-2 ring-primary-100' : ''}`}
                    title="Attach an image"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadBusy}
                >
                    {uploadBusy ? <CircleNotch className="size-4 animate-spin" /> : <ImageIcon className="size-4" />}
                </Button>
                <Textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            send(input);
                        }
                    }}
                    rows={2}
                    placeholder={askingUpload ? 'Upload above, or reply here… (Shift+Enter for a new line)' : 'Type your answer… (Shift+Enter for a new line)'}
                    className="max-h-40 min-h-9 flex-1 resize-none"
                    autoFocus
                />
                <Button
                    type="button"
                    size="sm"
                    className="size-9 shrink-0 p-0"
                    onClick={() => send(input)}
                    disabled={turnMutation.isPending || (!input.trim() && pendingImages.length === 0)}
                >
                    <PaperPlaneTilt className="size-4" />
                </Button>
            </div>

            {/* Build handoff — primary once the assistant says it has enough */}
            {last?.brief && messages.length >= 2 && (
                <Button
                    type="button"
                    variant={last.ready ? 'default' : 'outline'}
                    size="sm"
                    className="mt-2 w-full"
                    onClick={finish}
                >
                    <Sparkle className="mr-1.5 size-4" weight="duotone" />
                    {last.ready ? 'Create my website' : 'Skip ahead — build with what we have'}
                </Button>
            )}
        </div>
    );
};
