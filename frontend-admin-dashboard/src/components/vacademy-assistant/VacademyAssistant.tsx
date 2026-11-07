import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
    ArrowClockwise,
    ArrowsInSimple,
    ArrowsOutSimple,
    ChatCircleDots,
    PaperPlaneRight,
    Sparkle,
    SpinnerGap,
    UserCircle,
    Warning,
    X,
} from '@phosphor-icons/react';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MyButton } from '@/components/design-system/button';
import { cn } from '@/lib/utils';
import { getTokenFromCookie, isTokenExpired } from '@/lib/auth/sessionUtility';
import { TokenKey } from '@/constants/auth/tokens';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { ASSISTANT_CAPABILITIES } from '@/constants/urls';
import { useSelectedStudentMirrorStore } from '@/stores/assistant/selected-student-mirror';
import { useVacademyAssistant } from './useVacademyAssistant';
import { useInstituteChatbotName } from './useInstituteChatbotName';
import { useAssistDock } from '@/components/assist-dock/store';
import type { AssistantAction, AssistantCapabilities, AssistantMessage } from './types';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import type { ReactNode } from 'react';

// Routes where no authenticated shell exists — the widget must stay hidden even
// if a stale token lingers. Mirrors the public routes in routes/__root.tsx.
const PUBLIC_PREFIXES = [
    '/login',
    '/signup',
    '/landing',
    '/pricing',
    '/content',
    '/vim/onboarding',
    '/vim/login',
    '/vim/waitlist',
];

/** Capability-group → human blurb + example prompts (role-accurate: only the
 * groups the /capabilities endpoint returns for THIS user are shown). */
export const CAPABILITY_COPY: Record<string, { blurb: string; suggestions: string[] }> = {
    search_help_knowledge: {
        blurb: 'How-to guidance',
        suggestions: ['How do I create a course?', 'How do I invite a team member?'],
    },
    learner_data: {
        blurb: 'Learner lookups — attendance, scores, activity, logins',
        suggestions: ['Find a learner by name', "What's this student's attendance this month?"],
    },
    payments: {
        blurb: 'Fees & payments',
        suggestions: ['Does this learner have overdue fees?'],
    },
    batch_data: {
        blurb: 'Batch rosters',
        suggestions: [],
    },
    schedule: {
        blurb: 'Class schedules',
        suggestions: ['What classes are live right now?'],
    },
    institute_overview: {
        blurb: 'Institute stats',
        suggestions: ['How much fees is pending across the institute?'],
    },
    learner_edits: {
        blurb: 'Make changes (with your confirmation)',
        suggestions: ["Extend a learner's access expiry"],
    },
    assessments: {
        blurb: 'Assessment results & pending evaluations',
        suggestions: ['Which submissions are still pending evaluation?'],
    },
    announcements: {
        blurb: 'Send announcements (with your confirmation)',
        suggestions: ['Send an announcement to a batch'],
    },
};

const FALLBACK_SUGGESTIONS = [
    'How do I create a course?',
    'Where do I add a learner to a batch?',
    'How do I invite a team member?',
];

export function VacademyAssistant() {
    const { t } = useTranslation('dashboardIndex');
    const chatbotName = useInstituteChatbotName();
    const pathname = useRouterState({ select: (s) => s.location.pathname });
    const [input, setInput] = useState('');
    const [expanded, setExpanded] = useState(false);
    const panel = useAssistDock((s) => s.panel);
    const setPanel = useAssistDock((s) => s.setPanel);
    const pendingPrompt = useAssistDock((s) => s.pendingPrompt);
    const clearPendingPrompt = useAssistDock((s) => s.clearPendingPrompt);
    const open = panel === 'assistant';
    const { messages, status, error, sendMessage, reset, resolveAction } = useVacademyAssistant();

    // A question handed over from the dashboard launch bar: send it as soon as
    // the panel opens (sendMessage cold-starts the session itself).
    useEffect(() => {
        if (open && pendingPrompt) {
            clearPendingPrompt();
            sendMessage(pendingPrompt);
        }
    }, [open, pendingPrompt, clearPendingPrompt, sendMessage]);
    const scrollEndRef = useRef<HTMLDivElement>(null);
    const navigate = useNavigate();

    // The student currently open in a side view — shown as an "Asking about" chip
    // so the context-awareness is visible (and clearable) instead of magic.
    const selectedStudent = useSelectedStudentMirrorStore((s) => s.student);
    const clearSelectedStudent = useSelectedStudentMirrorStore((s) => s.setStudent);

    // Role-accurate capabilities (the AND-gate applied server-side) drive the
    // empty state, so users see exactly what THEY can ask — nothing they can't.
    const { data: capabilities } = useQuery<AssistantCapabilities>({
        queryKey: ['assistant-capabilities'],
        queryFn: async () => (await authenticatedAxiosInstance.get(ASSISTANT_CAPABILITIES)).data,
        enabled: open,
        staleTime: 5 * 60 * 1000,
    });

    const { capabilityBlurbs, suggestions } = useMemo(() => {
        const groups = capabilities?.groups?.map((g) => g.key) ?? [];
        if (groups.length === 0) {
            return { capabilityBlurbs: [] as string[], suggestions: FALLBACK_SUGGESTIONS };
        }
        const blurbs: string[] = [];
        const sugg: string[] = [];
        for (const key of groups) {
            const copy = CAPABILITY_COPY[key];
            if (!copy) continue;
            blurbs.push(copy.blurb);
            sugg.push(...copy.suggestions);
        }
        return { capabilityBlurbs: blurbs, suggestions: sugg.slice(0, 5) };
    }, [capabilities]);

    // A help answer can include a route link (e.g. [Open Courses](/study-library/courses));
    // navigate in-app and collapse the panel so the user lands on the page.
    const handleInternalLink = useCallback(
        (to: string) => {
            setPanel('none');
            navigate({ to });
        },
        [navigate, setPanel]
    );
    const mdComponents = useMemo(
        () => createMdComponents(handleInternalLink),
        [handleInternalLink]
    );

    useEffect(() => {
        scrollEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, status]);

    const token = getTokenFromCookie(TokenKey.accessToken);
    const isAuthed = !!token && !isTokenExpired(token);
    const onPublicRoute = PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
    // The rail (AssistDock) owns the trigger now; render only when it asks us to.
    if (!isAuthed || onPublicRoute || !open) return null;

    const isBusy = status === 'connecting' || status === 'streaming';
    const lastMessage = messages[messages.length - 1];
    const awaitingFirstToken =
        status === 'connecting' ||
        (status === 'streaming' && (!lastMessage || lastMessage.role === 'user'));

    const handleSend = (e: React.FormEvent) => {
        e.preventDefault();
        if (!input.trim() || isBusy) return;
        sendMessage(input.trim());
        setInput('');
    };

    const handleSuggestion = (text: string) => {
        if (isBusy) return;
        sendMessage(text);
    };

    return (
        <div
            className={cn(
                'fixed inset-x-4 bottom-6 top-20 z-40 flex flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-xl sm:inset-x-auto sm:right-20 sm:top-24',
                expanded ? 'sm:left-1/3' : 'sm:w-96'
            )}
        >
            {/* Header */}
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-neutral-200 bg-primary-500 px-4 py-3 text-white">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white/20">
                        <Sparkle size={18} weight="fill" />
                    </div>
                    <div className="min-w-0">
                        <p className="break-words text-body font-semibold leading-tight">
                            {chatbotName}
                        </p>
                        <p className="text-caption text-white/80">
                            {isBusy ? 'Thinking…' : 'Here to help'}
                        </p>
                    </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                    <button
                        type="button"
                        aria-label={expanded ? 'Shrink panel' : 'Expand panel'}
                        onClick={() => setExpanded((e) => !e)}
                        className="hidden size-8 items-center justify-center rounded-md text-white/90 transition-colors hover:bg-white/20 sm:flex"
                    >
                        {expanded ? <ArrowsInSimple size={18} /> : <ArrowsOutSimple size={18} />}
                    </button>
                    {messages.length > 0 && (
                        <button
                            type="button"
                            aria-label="Start a new chat"
                            onClick={reset}
                            className="flex size-8 items-center justify-center rounded-md text-white/90 transition-colors hover:bg-white/20"
                        >
                            <ArrowClockwise size={18} />
                        </button>
                    )}
                    <button
                        type="button"
                        aria-label="Close assistant"
                        onClick={() => setPanel('none')}
                        className="flex size-8 items-center justify-center rounded-md text-white/90 transition-colors hover:bg-white/20"
                    >
                        <X size={18} />
                    </button>
                </div>
            </div>

            {/* Messages */}
            <ScrollArea className="flex-1">
                <div className="flex flex-col gap-3 p-4">
                    {messages.length === 0 && (
                        <div className="flex flex-col items-center gap-3 py-6 text-center">
                            <div className="flex size-12 items-center justify-center rounded-full bg-primary-50">
                                <ChatCircleDots
                                    size={26}
                                    weight="duotone"
                                    className="text-primary-500"
                                />
                            </div>
                            <p className="text-body font-semibold text-neutral-700">
                                Hi! How can I help?
                            </p>
                            {capabilityBlurbs.length > 0 ? (
                                <ul className="flex flex-col items-start gap-1 text-left">
                                    {capabilityBlurbs.map((b) => (
                                        <li
                                            key={b}
                                            className="flex items-start gap-1.5 text-caption text-neutral-600"
                                        >
                                            <Sparkle
                                                size={12}
                                                weight="fill"
                                                className="mt-0.5 shrink-0 text-primary-400"
                                            />
                                            {b}
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <p className="text-caption text-neutral-500">
                                    {t('assistant.helpDescription')}
                                </p>
                            )}
                            <div className="mt-1 flex flex-col gap-2">
                                {suggestions.map((s) => (
                                    <button
                                        key={s}
                                        type="button"
                                        onClick={() => handleSuggestion(s)}
                                        className="rounded-md border border-neutral-200 px-3 py-2 text-caption text-neutral-700 transition-colors hover:border-primary-300 hover:bg-primary-50"
                                    >
                                        {s}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {messages.map((message) =>
                        message.role === 'action' && message.action ? (
                            <ActionCard
                                key={message.id}
                                action={message.action}
                                onResolve={resolveAction}
                            />
                        ) : message.role === 'status' ? (
                            <p
                                key={message.id}
                                className="flex items-center gap-1.5 text-caption italic text-neutral-400"
                            >
                                <SpinnerGap size={12} className="animate-spin" />
                                {message.content}
                            </p>
                        ) : (
                            <MessageBubble
                                key={message.id}
                                message={message}
                                mdComponents={mdComponents}
                            />
                        )
                    )}

                    {awaitingFirstToken && (
                        <div className="flex items-center gap-2 py-1 text-neutral-500">
                            <SpinnerGap size={18} className="animate-spin text-primary-500" />
                            <span className="text-caption">Looking that up…</span>
                        </div>
                    )}

                    {error && (
                        <div className="flex items-start gap-2 rounded-md border border-danger-200 bg-danger-50 px-3 py-2">
                            <Warning size={18} className="mt-0.5 shrink-0 text-danger-500" />
                            <span className="text-caption text-danger-700">{error}</span>
                        </div>
                    )}

                    <div ref={scrollEndRef} />
                </div>
            </ScrollArea>

            {/* Context chip — makes "this student" visible instead of magic */}
            {selectedStudent && (
                <div className="flex shrink-0 items-center gap-1.5 border-t border-neutral-100 bg-primary-50 px-3 py-1.5">
                    <UserCircle size={14} weight="fill" className="shrink-0 text-primary-500" />
                    <span className="min-w-0 flex-1 truncate text-caption text-primary-700">
                        Asking about:{' '}
                        <span className="font-semibold">{selectedStudent.full_name}</span>
                    </span>
                    <button
                        type="button"
                        aria-label="Stop asking about this student"
                        onClick={() => clearSelectedStudent(null)}
                        className="flex size-5 shrink-0 items-center justify-center rounded-full text-primary-400 transition-colors hover:bg-primary-100 hover:text-primary-600"
                    >
                        <X size={12} />
                    </button>
                </div>
            )}

            {/* Input */}
            <form
                onSubmit={handleSend}
                className="flex shrink-0 items-center gap-2 border-t border-neutral-200 p-3"
            >
                <Input
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Ask the assistant…"
                    className="flex-1"
                />
                <MyButton
                    type="submit"
                    buttonType="primary"
                    scale="medium"
                    layoutVariant="icon"
                    disable={!input.trim() || isBusy}
                    aria-label="Send message"
                >
                    <PaperPlaneRight size={18} weight="fill" />
                </MyButton>
            </form>
        </div>
    );
}

// Token-styled markdown renderer for assistant replies (mirrors the AI-usage
// dialog's map, so it stays design-system-conformant — no `prose` plugin).
type MdProps = { children?: ReactNode; href?: string };
function createMdComponents(onInternalLink: (to: string) => void): Components {
    return {
        p: ({ children }: MdProps) => <p className="mb-2 last:mb-0">{children}</p>,
        ul: ({ children }: MdProps) => (
            <ul className="mb-2 list-disc pl-5 last:mb-0">{children}</ul>
        ),
        ol: ({ children }: MdProps) => (
            <ol className="mb-2 list-decimal pl-5 last:mb-0">{children}</ol>
        ),
        li: ({ children }: MdProps) => <li className="mb-1">{children}</li>,
        strong: ({ children }: MdProps) => <strong className="font-semibold">{children}</strong>,
        em: ({ children }: MdProps) => <em className="italic">{children}</em>,
        a: ({ children, href }: MdProps) => {
            // In-app routes start with "/": navigate within the SPA. Anything else
            // (http…) opens in a new tab.
            if (href && href.startsWith('/')) {
                return (
                    <button
                        type="button"
                        onClick={() => onInternalLink(href)}
                        className="font-medium text-primary-600 underline"
                    >
                        {children}
                    </button>
                );
            }
            return (
                <a
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary-600 underline"
                >
                    {children}
                </a>
            );
        },
        code: ({ children }: MdProps) => (
            <code className="rounded-sm bg-neutral-100 px-1 py-0.5 text-caption">{children}</code>
        ),
        pre: ({ children }: MdProps) => (
            <pre className="mb-2 overflow-x-auto rounded-md bg-neutral-100 p-3 text-caption last:mb-0">
                {children}
            </pre>
        ),
        h1: ({ children }: MdProps) => <p className="mb-1 text-body font-semibold">{children}</p>,
        h2: ({ children }: MdProps) => <p className="mb-1 text-body font-semibold">{children}</p>,
        h3: ({ children }: MdProps) => <p className="mb-1 text-body font-semibold">{children}</p>,
    };
}

/**
 * Nonce-backed confirmation card for a proposed write. The change only executes
 * when Confirm posts the server-held nonce back — the model cannot trigger it.
 */
function ActionCard({
    action,
    onResolve,
}: {
    action: AssistantAction;
    onResolve: (actionId: string, decision: 'confirm' | 'cancel') => void;
}) {
    const isPending = action.status === 'pending';
    const isWorking = action.status === 'working';
    return (
        <div className="rounded-lg border border-warning-300 bg-warning-50 p-3">
            <div className="flex items-start gap-2">
                <Warning size={18} weight="fill" className="mt-0.5 shrink-0 text-warning-600" />
                <div className="min-w-0 flex-1">
                    <p className="text-caption font-semibold text-neutral-800">
                        Confirm this change
                    </p>
                    <p className="mt-0.5 whitespace-pre-wrap text-caption text-neutral-700">
                        {action.summary}
                    </p>
                </div>
            </div>
            {isPending || isWorking ? (
                <div className="mt-3 flex items-center justify-end gap-2">
                    <MyButton
                        buttonType="secondary"
                        scale="small"
                        disable={isWorking}
                        onClick={() => onResolve(action.actionId, 'cancel')}
                    >
                        Cancel
                    </MyButton>
                    <MyButton
                        buttonType="primary"
                        scale="small"
                        disable={isWorking}
                        onClick={() => onResolve(action.actionId, 'confirm')}
                    >
                        {isWorking ? 'Working…' : 'Confirm'}
                    </MyButton>
                </div>
            ) : (
                <p
                    className={cn(
                        'mt-2 text-right text-caption font-medium',
                        action.status === 'executed' ? 'text-success-600' : 'text-neutral-500'
                    )}
                >
                    {action.status === 'executed'
                        ? 'Confirmed & applied'
                        : action.status === 'cancelled'
                          ? 'Cancelled'
                          : 'Not applied'}
                </p>
            )}
        </div>
    );
}

function MessageBubble({
    message,
    mdComponents,
}: {
    message: AssistantMessage;
    mdComponents: Components;
}) {
    const isUser = message.role === 'user';
    return (
        <div className={cn('flex', isUser ? 'justify-end pl-8' : 'justify-start pr-6')}>
            <div
                className={cn(
                    'rounded-lg px-3 py-2 text-body',
                    isUser
                        ? 'w-fit whitespace-pre-wrap bg-primary-500 text-white'
                        : 'border border-neutral-200 bg-neutral-50 text-neutral-800'
                )}
            >
                {isUser ? (
                    message.content
                ) : message.content ? (
                    <ReactMarkdown components={mdComponents}>{message.content}</ReactMarkdown>
                ) : (
                    message.streaming && <span className="text-neutral-400">…</span>
                )}
            </div>
        </div>
    );
}
