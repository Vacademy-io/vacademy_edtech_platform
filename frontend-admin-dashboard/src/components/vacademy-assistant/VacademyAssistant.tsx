import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
    ArrowLeft,
    ArrowsInSimple,
    ArrowsOutSimple,
    CalendarBlank,
    CalendarCheck,
    ChartBar,
    ChartLineUp,
    ChatText,
    ClipboardText,
    ClockCounterClockwise,
    GitMerge,
    MagnifyingGlass,
    Megaphone,
    Money,
    NotePencil,
    PencilSimple,
    Phone,
    Question,
    Sparkle,
    UserCircle,
    UserPlus,
    UsersThree,
    VideoCamera,
    Wallet,
    Warning,
    X,
    type Icon,
} from '@phosphor-icons/react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MyButton } from '@/components/design-system/button';
import { cn } from '@/lib/utils';
import { getTokenDecodedData, getTokenFromCookie, isTokenExpired } from '@/lib/auth/sessionUtility';
import { TokenKey } from '@/constants/auth/tokens';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { ASSISTANT_CAPABILITIES } from '@/constants/urls';
import { useSelectedStudentMirrorStore } from '@/stores/assistant/selected-student-mirror';
import { useVacademyAssistant } from './useVacademyAssistant';
import { useInstituteChatbotName } from './useInstituteChatbotName';
import { useVoiceInput } from '@/hooks/use-voice-input';
import { useAssistDock } from '@/components/assist-dock/store';
import type { AssistantCapabilities } from './types';
import {
    ActionCard,
    ActivityLine,
    FollowUpChips,
    MessageBubble,
    createMdComponents,
} from './AssistantMessages';
import { AssistantComposer } from './AssistantComposer';
import { AssistantEmptyState, type CapabilityItem } from './AssistantEmptyState';
import { ASSISTANT_CHATS_KEY, AssistantHistoryList, useRecentChats } from './AssistantHistoryList';
import { firstNameOf } from './assistant-format';
import { WELCOME_QUESTIONS } from './page-ask';

export { ActionCardLines } from './AssistantMessages';

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

interface CapabilityCopy {
    blurb: string;
    suggestions: string[];
}

/** Capability-group → i18n keys (dashboardIndex) for the blurb and example prompts
 * (role-accurate: only the groups the /capabilities endpoint returns for THIS user are shown). */
export const CAPABILITY_COPY: Record<string, CapabilityCopy> = {
    search_help_knowledge: {
        blurb: 'assistant.capabilityCopy.search_help_knowledge',
        suggestions: [
            'assistant.capabilityCopy.examples.createCourse',
            'assistant.capabilityCopy.examples.inviteMember',
        ],
    },
    learner_data: {
        blurb: 'assistant.capabilityCopy.learner_data',
        suggestions: [
            'assistant.capabilityCopy.examples.findLearner',
            'assistant.capabilityCopy.examples.studentAttendance',
        ],
    },
    payments: {
        blurb: 'assistant.capabilityCopy.payments',
        suggestions: ['assistant.capabilityCopy.examples.overdueFees'],
    },
    batch_data: {
        blurb: 'assistant.capabilityCopy.batch_data',
        suggestions: [],
    },
    schedule: {
        blurb: 'assistant.capabilityCopy.schedule',
        suggestions: ['assistant.capabilityCopy.examples.liveNow'],
    },
    institute_overview: {
        blurb: 'assistant.capabilityCopy.institute_overview',
        suggestions: ['assistant.capabilityCopy.examples.pendingFees'],
    },
    learner_edits: {
        blurb: 'assistant.capabilityCopy.learner_edits',
        suggestions: ['assistant.capabilityCopy.examples.extendAccess'],
    },
    assessments: {
        blurb: 'assistant.capabilityCopy.assessments',
        suggestions: ['assistant.capabilityCopy.examples.pendingEvaluation'],
    },
    announcements: {
        blurb: 'assistant.capabilityCopy.announcements',
        suggestions: ['assistant.capabilityCopy.examples.sendAnnouncement'],
    },
};

const FALLBACK_SUGGESTIONS = [
    'assistant.capabilityCopy.examples.createCourse',
    'assistant.capabilityCopy.examples.addToBatch',
    'assistant.capabilityCopy.examples.inviteMember',
];

/** CRM groups → i18n keys (dashboardIndex) for the blurb and example prompts. */
export const CRM_CAPABILITY_COPY_KEYS: Record<string, CapabilityCopy> = {
    crm_leads: { blurb: 'assistant.crmCopy.crm_leads', suggestions: [] },
    crm_calls: { blurb: 'assistant.crmCopy.crm_calls', suggestions: [] },
    crm_meetings: { blurb: 'assistant.crmCopy.crm_meetings', suggestions: [] },
    crm_messages: { blurb: 'assistant.crmCopy.crm_messages', suggestions: [] },
    crm_reports: {
        blurb: 'assistant.crmCopy.crm_reports',
        suggestions: [
            'assistant.starters.crmNewLeads.prompt',
            'assistant.starters.crmFirstContact.prompt',
        ],
    },
    crm_collections: {
        blurb: 'assistant.crmCopy.crm_collections',
        suggestions: [
            'assistant.starters.crmFeesDue.prompt',
            'assistant.crmCopy.admissionsNoFeePlan',
        ],
    },
    // CRM changes: each one is proposed on a card and made only when the user confirms it.
    crm_lead_activity: {
        blurb: 'assistant.crmCopy.crm_lead_activity',
        suggestions: ['assistant.crmCopy.examples.leadFollowUp'],
    },
    crm_lead_edits: {
        blurb: 'assistant.crmCopy.crm_lead_edits',
        suggestions: ['assistant.crmCopy.examples.leadStatus'],
    },
    crm_team_edits: {
        blurb: 'assistant.crmCopy.crm_team_edits',
        suggestions: [
            'assistant.crmCopy.examples.assignLeads',
            'assistant.crmCopy.examples.pauseRouting',
        ],
    },
    crm_lead_intake: {
        blurb: 'assistant.crmCopy.crm_lead_intake',
        suggestions: ['assistant.crmCopy.examples.addLead'],
    },
    crm_lead_merges: {
        blurb: 'assistant.crmCopy.crm_lead_merges',
        suggestions: ['assistant.crmCopy.examples.mergeLeads'],
    },
    crm_meeting_edits: {
        blurb: 'assistant.crmCopy.crm_meeting_edits',
        suggestions: ['assistant.crmCopy.examples.meetingOutcome'],
    },
};

/** The icon on each capability card. */
export const CAPABILITY_ICONS: Record<string, Icon> = {
    search_help_knowledge: Question,
    learner_data: MagnifyingGlass,
    payments: Money,
    batch_data: UsersThree,
    schedule: VideoCamera,
    institute_overview: ChartBar,
    learner_edits: PencilSimple,
    assessments: ClipboardText,
    announcements: Megaphone,
    crm_leads: UserPlus,
    crm_calls: Phone,
    crm_meetings: CalendarBlank,
    crm_messages: ChatText,
    crm_reports: ChartLineUp,
    crm_collections: Wallet,
    crm_lead_activity: NotePencil,
    crm_lead_edits: PencilSimple,
    crm_team_edits: UsersThree,
    crm_lead_intake: UserPlus,
    crm_lead_merges: GitMerge,
    crm_meeting_edits: CalendarCheck,
};

/**
 * Capability cards (icon + blurb) and example prompts for the groups the capabilities endpoint
 * returned, in its order; at most five prompts.
 */
export function capabilityItemsFor(
    groups: string[],
    t: (key: string) => string
): { items: CapabilityItem[]; suggestions: string[] } {
    if (groups.length === 0) {
        return { items: [], suggestions: FALLBACK_SUGGESTIONS.map((k) => t(k)) };
    }
    const items: CapabilityItem[] = [];
    const sugg: string[] = [];
    for (const key of groups) {
        const copy = CAPABILITY_COPY[key] ?? CRM_CAPABILITY_COPY_KEYS[key];
        if (!copy) continue;
        items.push({ key, blurb: t(copy.blurb), Icon: CAPABILITY_ICONS[key] ?? Sparkle });
        sugg.push(...copy.suggestions.map((k) => t(k)));
    }
    return { items, suggestions: sugg.slice(0, 5) };
}

/** Blurbs and example prompts for the groups the capabilities endpoint returned (see above). */
export function capabilityCopyFor(
    groups: string[],
    t: (key: string) => string
): { capabilityBlurbs: string[]; suggestions: string[] } {
    const { items, suggestions } = capabilityItemsFor(groups, t);
    return { capabilityBlurbs: items.map((i) => i.blurb), suggestions };
}

/**
 * Radix wraps the scroll content in a `display: table` box that grows to the widest
 * unwrapped line (a truncated chat title, a long chip), pushing the narrow panel's
 * content past its edge. A block box keeps the content at the panel's width.
 */
const SCROLL_FIT = 'flex-1 [&_[data-radix-scroll-area-viewport]>div]:!block';

const HEADER_BUTTON =
    'flex size-8 shrink-0 items-center justify-center rounded-md text-white/90 transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none';

function HeaderButton({
    label,
    onClick,
    pressed,
    className,
    children,
}: {
    label: string;
    onClick: () => void;
    pressed?: boolean;
    className?: string;
    children: ReactNode;
}) {
    return (
        <button
            type="button"
            aria-label={label}
            title={label}
            aria-pressed={pressed}
            onClick={onClick}
            className={cn(HEADER_BUTTON, pressed && 'bg-white/20', className)}
        >
            {children}
        </button>
    );
}

function prefersReducedMotion(): boolean {
    try {
        return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    } catch {
        return false;
    }
}

export function VacademyAssistant() {
    const { t } = useTranslation('dashboardIndex');
    const chatbotName = useInstituteChatbotName();
    const pathname = useRouterState({ select: (s) => s.location.pathname });
    const [input, setInput] = useState('');
    const [expanded, setExpanded] = useState(false);
    const [view, setView] = useState<'chat' | 'history'>('chat');
    const panel = useAssistDock((s) => s.panel);
    const setPanel = useAssistDock((s) => s.setPanel);
    const pendingPrompt = useAssistDock((s) => s.pendingPrompt);
    const clearPendingPrompt = useAssistDock((s) => s.clearPendingPrompt);
    const welcome = useAssistDock((s) => s.welcome);
    const clearWelcome = useAssistDock((s) => s.clearWelcome);
    const open = panel === 'assistant';
    const {
        messages,
        status,
        error,
        activity,
        sessionId,
        pastChat,
        loadingChat,
        sendMessage,
        reset,
        resolveAction,
        openChat,
        continueChat,
        forgetChat,
    } = useVacademyAssistant();
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const queryClient = useQueryClient();

    const focusComposer = useCallback(() => {
        requestAnimationFrame(() => inputRef.current?.focus());
    }, []);

    // Spoken questions land in the input for the user to check and send.
    const voice = useVoiceInput({
        onTranscript: (text) => {
            setInput((current) => (current.trim() ? `${current.trimEnd()} ${text}` : text));
            focusComposer();
        },
    });
    // Whether the panel renders at all (see the early return below). The mic
    // must never keep listening, or start listening, behind a hidden panel.
    const token = getTokenFromCookie(TokenKey.accessToken);
    const isAuthed = !!token && !isTokenExpired(token);
    const onPublicRoute = PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
    const panelVisible = isAuthed && !onPublicRoute && open;
    const cancelVoice = voice.cancel;
    useEffect(() => {
        if (!panelVisible) cancelVoice();
    }, [panelVisible, cancelVoice]);

    // The first-visit welcome lasts while the panel stays open.
    useEffect(() => {
        if (!open && welcome) clearWelcome();
    }, [open, welcome, clearWelcome]);

    // The message box takes focus when the panel opens.
    useEffect(() => {
        if (panelVisible) focusComposer();
    }, [panelVisible, focusComposer]);

    // A question handed over from the dashboard launch bar: send it as soon as
    // the panel opens (sendMessage cold-starts the session itself).
    useEffect(() => {
        if (open && pendingPrompt) {
            clearPendingPrompt();
            setView('chat');
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

    const { items: capabilityItems, suggestions } = useMemo(
        () =>
            capabilityItemsFor(
                Array.isArray(capabilities?.groups) ? capabilities.groups.map((g) => g.key) : [],
                (key) => t(key)
            ),
        [capabilities, t]
    );

    const isBusy = status === 'connecting' || status === 'streaming';
    const showEmpty = view === 'chat' && messages.length === 0 && !pastChat;
    const recentChats = useRecentChats(panelVisible && showEmpty);
    const firstName = useMemo(() => {
        try {
            return firstNameOf(getTokenDecodedData(token)?.fullname);
        } catch {
            return '';
        }
    }, [token]);

    // The history reflects each finished answer.
    const wasBusy = useRef(false);
    useEffect(() => {
        if (wasBusy.current && !isBusy) {
            void queryClient.invalidateQueries({ queryKey: [ASSISTANT_CHATS_KEY] });
        }
        wasBusy.current = isBusy;
    }, [isBusy, queryClient]);

    // A help answer can include a route link (e.g. [Open Courses](/study-library/courses));
    // navigate in-app and collapse the panel so the user lands on the page.
    const handleInternalLink = useCallback(
        (to: string) => {
            setPanel('none');
            navigate({ to });
        },
        [navigate, setPanel]
    );
    const tableLabel = t('assistant.panel.tableLabel');
    const mdComponents = useMemo(
        () => createMdComponents(handleInternalLink, tableLabel),
        [handleInternalLink, tableLabel]
    );

    useEffect(() => {
        if (view !== 'chat') return;
        scrollEndRef.current?.scrollIntoView({
            behavior: prefersReducedMotion() ? 'auto' : 'smooth',
            block: 'end',
        });
    }, [messages, status, activity, view]);

    // The rail (AssistDock) owns the trigger now; render only when it asks us to.
    if (!panelVisible) return null;

    const lastMessage = messages[messages.length - 1];
    const answerStreaming =
        status === 'streaming' &&
        lastMessage?.role === 'assistant' &&
        !!lastMessage.streaming &&
        !!lastMessage.content;
    const showActivity = isBusy && (!!activity || !answerStreaming);
    const followUps =
        !isBusy && lastMessage?.role === 'assistant' ? lastMessage.suggestions ?? [] : [];

    const ask = (text: string) => {
        if (isBusy || !text.trim()) return;
        setView('chat');
        sendMessage(text.trim());
    };

    const handleSend = () => {
        const text = input.trim();
        if (!text || isBusy) return;
        setInput('');
        // A send that could not start (the past chat did not reopen) gives the text back.
        void Promise.resolve(sendMessage(text)).then((sent) => {
            if (sent === false) setInput((current) => current || text);
        });
    };

    const startNewChat = () => {
        void reset();
        setInput('');
        setView('chat');
        focusComposer();
    };

    const showChat = async (id: string) => {
        await openChat(id);
        setView('chat');
        focusComposer();
    };

    const closeHistory = () => {
        setView('chat');
        focusComposer();
    };

    const subtitle = isBusy
        ? t('assistant.panel.status.thinking')
        : pastChat
          ? t('assistant.panel.status.pastChat')
          : t('assistant.panel.status.ready');

    return (
        // z-50, not z-40: page toolbars such as the slide editor's sticky Save Draft /
        // Publish bar sit at z-50 and covered this header, hiding the close button.
        // Mounted after <Outlet /> in __root, so at equal z it paints on top, while
        // dialogs and popovers (portalled to the end of <body>) still stack above it.
        <section
            aria-label={t('assistant.panel.label', { chatbotName })}
            className={cn(
                'fixed inset-x-4 bottom-6 top-20 z-50 flex flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-xl sm:inset-x-auto sm:right-20 sm:top-24',
                expanded ? 'sm:left-1/3' : 'sm:w-96'
            )}
        >
            {/* Header */}
            <div className="flex shrink-0 items-center justify-between gap-2 bg-primary-500 py-2.5 pe-2 ps-3 text-white">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                    <div
                        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white/20"
                        aria-hidden="true"
                    >
                        <Sparkle size={18} weight="fill" />
                    </div>
                    <div className="min-w-0">
                        <p
                            className="truncate text-body font-semibold leading-tight"
                            title={chatbotName}
                        >
                            {chatbotName}
                        </p>
                        <p className="truncate text-caption text-white/80" aria-live="polite">
                            {subtitle}
                        </p>
                    </div>
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                    <HeaderButton
                        label={t('assistant.panel.actions.history')}
                        pressed={view === 'history'}
                        onClick={() => (view === 'history' ? closeHistory() : setView('history'))}
                    >
                        <ClockCounterClockwise size={18} aria-hidden="true" />
                    </HeaderButton>
                    <HeaderButton
                        label={t('assistant.panel.actions.newChat')}
                        onClick={startNewChat}
                    >
                        <NotePencil size={18} aria-hidden="true" />
                    </HeaderButton>
                    <HeaderButton
                        label={
                            expanded
                                ? t('assistant.panel.actions.shrink')
                                : t('assistant.panel.actions.expand')
                        }
                        onClick={() => setExpanded((e) => !e)}
                        className="hidden sm:flex"
                    >
                        {expanded ? (
                            <ArrowsInSimple size={18} aria-hidden="true" />
                        ) : (
                            <ArrowsOutSimple size={18} aria-hidden="true" />
                        )}
                    </HeaderButton>
                    <HeaderButton
                        label={t('assistant.panel.actions.close')}
                        onClick={() => setPanel('none')}
                    >
                        <X size={18} aria-hidden="true" />
                    </HeaderButton>
                </div>
            </div>

            {view === 'history' ? (
                <div
                    className="flex min-h-0 flex-1 flex-col"
                    onKeyDown={(event) => {
                        if (event.key === 'Escape') {
                            event.stopPropagation();
                            closeHistory();
                        }
                    }}
                >
                    <div className="flex shrink-0 items-center gap-2 border-b border-neutral-200 p-2">
                        <button
                            type="button"
                            onClick={closeHistory}
                            aria-label={t('assistant.panel.actions.back')}
                            title={t('assistant.panel.actions.back')}
                            className="flex size-8 items-center justify-center rounded-md text-neutral-600 transition-colors hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300 motion-reduce:transition-none"
                        >
                            <ArrowLeft size={18} className="rtl:-scale-x-100" aria-hidden="true" />
                        </button>
                        <h2 className="text-body font-semibold text-neutral-800">
                            {t('assistant.panel.recentChats')}
                        </h2>
                    </div>
                    <ScrollArea className={SCROLL_FIT}>
                        <AssistantHistoryList
                            currentId={pastChat?.id ?? sessionId}
                            onOpen={showChat}
                            onDeleted={forgetChat}
                        />
                    </ScrollArea>
                </div>
            ) : (
                <>
                    {/* Messages */}
                    <ScrollArea className={SCROLL_FIT}>
                        <div className="flex flex-col gap-4 p-4">
                            {showEmpty && (
                                <AssistantEmptyState
                                    firstName={firstName}
                                    capabilities={capabilityItems}
                                    starters={
                                        welcome ? WELCOME_QUESTIONS.map((k) => t(k)) : suggestions
                                    }
                                    welcome={welcome}
                                    recentChats={recentChats.data ?? []}
                                    busy={isBusy || loadingChat}
                                    onAsk={ask}
                                    onOpenChat={showChat}
                                    onViewAllChats={() => setView('history')}
                                />
                            )}

                            {pastChat && (
                                <p className="truncate text-center text-caption font-semibold text-neutral-500">
                                    {pastChat.title}
                                </p>
                            )}

                            {messages.map((message) =>
                                message.role === 'action' && message.action ? (
                                    <ActionCard
                                        key={message.id}
                                        action={message.action}
                                        onResolve={resolveAction}
                                    />
                                ) : message.role === 'status' ? null : (
                                    <MessageBubble
                                        key={message.id}
                                        message={message}
                                        mdComponents={mdComponents}
                                    />
                                )
                            )}

                            <FollowUpChips suggestions={followUps} disabled={isBusy} onPick={ask} />

                            {(showActivity || loadingChat) && (
                                <ActivityLine
                                    label={
                                        loadingChat
                                            ? t('assistant.panel.pastChat.loading')
                                            : activity ?? t('assistant.panel.activity.thinking')
                                    }
                                />
                            )}

                            {error && (
                                <div
                                    role="alert"
                                    className="flex items-start gap-2 rounded-md border border-danger-200 bg-danger-50 px-3 py-2"
                                >
                                    <Warning
                                        size={18}
                                        className="mt-0.5 shrink-0 text-danger-500"
                                        aria-hidden="true"
                                    />
                                    <span className="text-caption text-danger-700">{error}</span>
                                </div>
                            )}

                            <div ref={scrollEndRef} />
                        </div>
                    </ScrollArea>

                    {/* A past chat: read-only until continued (sending continues it too). */}
                    {pastChat && (
                        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-neutral-100 bg-neutral-50 px-3 py-2">
                            <span className="min-w-0 flex-1 text-caption text-neutral-600">
                                {t('assistant.panel.pastChat.notice')}
                            </span>
                            <MyButton
                                buttonType="secondary"
                                scale="small"
                                disable={isBusy}
                                onClick={async () => {
                                    if (await continueChat()) focusComposer();
                                }}
                            >
                                {t('assistant.panel.actions.continue')}
                            </MyButton>
                        </div>
                    )}

                    {/* Context chip — makes "this student" visible instead of magic */}
                    {selectedStudent && (
                        <div className="flex shrink-0 items-center gap-1.5 border-t border-neutral-100 bg-primary-50 px-3 py-1.5">
                            <UserCircle
                                size={14}
                                weight="fill"
                                className="shrink-0 text-primary-500"
                                aria-hidden="true"
                            />
                            <span className="min-w-0 flex-1 truncate text-caption text-primary-700">
                                {t('assistant.panel.askingAbout')}{' '}
                                <span className="font-semibold">{selectedStudent.full_name}</span>
                            </span>
                            <button
                                type="button"
                                aria-label={t('assistant.panel.actions.clearStudent')}
                                title={t('assistant.panel.actions.clearStudent')}
                                onClick={() => clearSelectedStudent(null)}
                                className="flex size-6 shrink-0 items-center justify-center rounded-full text-primary-400 transition-colors hover:bg-primary-100 hover:text-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300 motion-reduce:transition-none"
                            >
                                <X size={12} aria-hidden="true" />
                            </button>
                        </div>
                    )}

                    <AssistantComposer
                        ref={inputRef}
                        value={input}
                        onChange={(value) => {
                            setInput(value);
                            if (voice.error) voice.clearError();
                        }}
                        onSend={handleSend}
                        busy={isBusy || loadingChat}
                        chatbotName={chatbotName}
                        voice={voice}
                    />
                </>
            )}
        </section>
    );
}
