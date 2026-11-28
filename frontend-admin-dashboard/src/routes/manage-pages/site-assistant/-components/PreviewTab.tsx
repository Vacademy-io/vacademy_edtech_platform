import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowClockwise, PaperPlaneRight, Sparkle, WarningCircle } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import type { SiteAssistantCard } from '../-utils/cards';
import type { SiteAssistantErrorCode } from '../-utils/sse';
import {
    MAX_MESSAGE_LENGTH,
    sendPreviewMessage,
    startPreviewSession,
    type PreviewSession,
} from '../-services/site-assistant-service';
import { CardsView } from './CardsView';
import { ErrorState } from './TabStates';

interface ChatItem {
    id: string;
    role: 'user' | 'assistant';
    text: string;
    cards: SiteAssistantCard[];
    streaming: boolean;
    answered: boolean | null;
    error: string | null;
}

export const PREVIEW_ERROR_TEXT: Record<SiteAssistantErrorCode, string> = {
    rate_limited: 'Too many messages at once. Wait a moment and try again.',
    daily_cap:
        'This site has used up today’s answer limit. Visitors now see your contact details instead.',
    no_credits:
        'Your institute is out of AI credits. Visitors see your contact details until you top up.',
    disabled: 'The assistant is switched off right now.',
    invalid: 'That message could not be sent. It may be empty or too long.',
    internal: 'Something went wrong. Try again.',
};

let seq = 0;
const nextId = () => `chat-${Date.now()}-${++seq}`;

/**
 * A live chat with this site's assistant, as a visitor on the home page would
 * see it. It works while the assistant is switched off, uses the settings as
 * last published, and each answer uses 1 AI credit like a real one.
 */
export const PreviewTab = ({ siteTag }: { siteTag: string }) => {
    const [session, setSession] = useState<PreviewSession | null>(null);
    const [starting, setStarting] = useState(false);
    const [startError, setStartError] = useState<string | null>(null);
    const [expired, setExpired] = useState(false);
    const [items, setItems] = useState<ChatItem[]>([]);
    const [text, setText] = useState('');
    const [busy, setBusy] = useState(false);
    const abortRef = useRef<AbortController | null>(null);
    const endRef = useRef<HTMLDivElement | null>(null);

    const start = useCallback(async () => {
        abortRef.current?.abort();
        setStarting(true);
        setStartError(null);
        setExpired(false);
        setItems([]);
        try {
            setSession(await startPreviewSession(siteTag));
        } catch {
            setSession(null);
            setStartError('Could not start the preview. The assistant service may be unavailable.');
        } finally {
            setStarting(false);
        }
    }, [siteTag]);

    useEffect(() => {
        void start();
        return () => abortRef.current?.abort();
    }, [start]);

    useEffect(() => {
        endRef.current?.scrollIntoView?.({ block: 'end' });
    }, [items]);

    const patch = (id: string, fn: (item: ChatItem) => ChatItem) =>
        setItems((list) => list.map((it) => (it.id === id ? fn(it) : it)));

    const send = async (raw: string) => {
        const message = raw.trim();
        if (!session || !message || busy) return;
        const userItem: ChatItem = {
            id: nextId(),
            role: 'user',
            text: message,
            cards: [],
            streaming: false,
            answered: null,
            error: null,
        };
        const botId = nextId();
        setItems((list) => [
            ...list,
            userItem,
            {
                id: botId,
                role: 'assistant',
                text: '',
                cards: [],
                streaming: true,
                answered: null,
                error: null,
            },
        ]);
        setText('');
        setBusy(true);
        const controller = new AbortController();
        abortRef.current = controller;
        try {
            await sendPreviewMessage(
                session,
                siteTag,
                message,
                (ev) => {
                    if (ev.type === 'token')
                        patch(botId, (it) => ({ ...it, text: it.text + ev.text }));
                    else if (ev.type === 'card')
                        patch(botId, (it) => ({ ...it, cards: [...it.cards, ev.card] }));
                    else if (ev.type === 'done')
                        patch(botId, (it) => ({ ...it, streaming: false, answered: ev.answered }));
                    else if (ev.type === 'error')
                        patch(botId, (it) => ({
                            ...it,
                            streaming: false,
                            error: PREVIEW_ERROR_TEXT[ev.code],
                        }));
                },
                controller.signal
            );
            patch(botId, (it) => ({ ...it, streaming: false }));
        } catch (err) {
            if (controller.signal.aborted) return;
            const status = (err as { status?: number }).status;
            if (status === 401 || status === 403) setExpired(true);
            patch(botId, (it) => ({
                ...it,
                streaming: false,
                error:
                    status === 401 || status === 403
                        ? 'This preview has expired. Start over to chat again.'
                        : PREVIEW_ERROR_TEXT.internal,
            }));
        } finally {
            setBusy(false);
        }
    };

    if (starting && !session) {
        return (
            <div className="flex flex-col gap-3">
                <Skeleton className="h-12 w-2/3" />
                <Skeleton className="h-8 w-1/2" />
            </div>
        );
    }
    if (startError) {
        return <ErrorState message={startError} onRetry={() => void start()} />;
    }
    if (!session) return null;

    const suggestions = session.assistant.suggestions;

    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <p className="max-w-2xl text-body text-neutral-600">
                    Chat as a visitor would. This uses the settings as last published, works even
                    while the assistant is switched off, and each answer uses 1 AI credit.
                </p>
                <MyButton buttonType="secondary" scale="small" onClick={() => void start()}>
                    <ArrowClockwise className="size-4" />
                    Start over
                </MyButton>
            </div>

            <div className="flex h-96 flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white">
                <div className="flex items-center gap-2 border-b border-neutral-200 px-4 py-3">
                    {session.assistant.avatarUrl ? (
                        <img
                            src={session.assistant.avatarUrl}
                            alt=""
                            className="size-8 rounded-full object-cover"
                        />
                    ) : (
                        <span className="flex size-8 items-center justify-center rounded-full bg-primary-50">
                            <Sparkle className="size-4 text-primary-500" weight="fill" />
                        </span>
                    )}
                    <p className="text-subtitle font-medium text-neutral-800">
                        {session.assistant.name}
                    </p>
                </div>

                <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4" aria-live="polite">
                    {session.assistant.greeting && (
                        <div className="max-w-md self-start whitespace-pre-line rounded-lg bg-neutral-100 px-3 py-2 text-body text-neutral-800">
                            {session.assistant.greeting}
                        </div>
                    )}
                    {items.length === 0 && suggestions.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                            {suggestions.map((s) => (
                                <MyButton
                                    key={s}
                                    buttonType="secondary"
                                    scale="small"
                                    onClick={() => void send(s)}
                                >
                                    {s}
                                </MyButton>
                            ))}
                        </div>
                    )}
                    {items.map((it) => (
                        <div
                            key={it.id}
                            className={cn(
                                'flex flex-col gap-2',
                                it.role === 'user' ? 'items-end' : 'items-start'
                            )}
                        >
                            {(it.text || (it.streaming && it.cards.length === 0)) && (
                                <div
                                    className={cn(
                                        'max-w-md whitespace-pre-line rounded-lg px-3 py-2 text-body',
                                        it.role === 'user'
                                            ? 'bg-primary-50 text-neutral-800'
                                            : 'bg-neutral-100 text-neutral-800'
                                    )}
                                >
                                    {it.text || <span className="text-neutral-400">Typing…</span>}
                                </div>
                            )}
                            {it.cards.length > 0 && (
                                <div className="w-full max-w-md">
                                    <CardsView cards={it.cards} />
                                </div>
                            )}
                            {it.answered === false && (
                                <p className="text-caption text-warning-600">
                                    Not answered: this shows in the Unanswered tab.
                                </p>
                            )}
                            {it.error && (
                                <p
                                    role="alert"
                                    className="flex items-center gap-1 text-caption text-danger-600"
                                >
                                    <WarningCircle className="size-3.5" /> {it.error}
                                </p>
                            )}
                        </div>
                    ))}
                    <div ref={endRef} />
                </div>

                <form
                    className="flex items-end gap-2 border-t border-neutral-200 p-3"
                    onSubmit={(e) => {
                        e.preventDefault();
                        void send(text);
                    }}
                >
                    <Textarea
                        aria-label="Message"
                        rows={1}
                        maxLength={MAX_MESSAGE_LENGTH}
                        placeholder={expired ? 'Start over to chat again' : 'Ask something…'}
                        value={text}
                        disabled={expired}
                        onChange={(e) => setText(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                void send(text);
                            }
                        }}
                        className="min-h-9 resize-none"
                    />
                    <MyButton
                        type="submit"
                        layoutVariant="icon"
                        scale="medium"
                        aria-label="Send"
                        disable={busy || expired || !text.trim()}
                    >
                        <PaperPlaneRight className="size-4" />
                    </MyButton>
                </form>
            </div>
        </div>
    );
};
