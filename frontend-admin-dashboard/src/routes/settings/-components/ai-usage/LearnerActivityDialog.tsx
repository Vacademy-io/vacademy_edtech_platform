import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import { useTranslation } from 'react-i18next';
import i18next from 'i18next';
import {
    ChatCircleDots,
    ListBullets,
    Coins,
    Lightning,
    Microphone,
    PuzzlePiece,
    BookOpen,
    Question,
    GraduationCap,
} from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { MyTable } from '@/components/design-system/table';
import { MyPagination } from '@/components/design-system/pagination';
import { mapRoleToCustomName } from '@/utils/roleUtils';
import {
    useUsageUserLogsQuery,
    useUserConversationsQuery,
    useConversationMessagesQuery,
    type UsageDateRange,
    type UsageLogRow,
    type ConversationRow,
    type ConversationMessage,
} from '../../-services/ai-usage-service';

const PAGE_SIZE = 20;

export interface SelectedLearner {
    userId: string;
    name: string;
    email: string | null;
    roles: string | null;
    totalCredits: number;
    requestCount: number;
}

interface Props {
    learner: SelectedLearner | null;
    range: UsageDateRange;
    onClose: () => void;
}

// ── small presentational helpers ────────────────────────────────────────────
const prettify = (s: string | null | undefined): string =>
    s ? s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : '—';

const formatDateTime = (ms: number | null): string =>
    ms
        ? new Date(ms).toLocaleString(undefined, {
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
          })
        : '—';

function contextIcon(contextType: string | null) {
    switch (contextType) {
        case 'slide':
            return BookOpen;
        case 'question':
            return Question;
        case 'course_details':
            return GraduationCap;
        default:
            return ChatCircleDots;
    }
}

// Markdown rendered with design tokens (no prose plugin in this app). Handlers
// read only children/href; the explicit prop type keeps them assignable to
// react-markdown's Components map (whose props also carry ExtraProps).
type MdProps = { children?: ReactNode; href?: string };
const mdComponents: Components = {
    p: ({ children }: MdProps) => <p className="mb-2 last:mb-0">{children}</p>,
    ul: ({ children }: MdProps) => <ul className="mb-2 list-disc pl-5 last:mb-0">{children}</ul>,
    ol: ({ children }: MdProps) => <ol className="mb-2 list-decimal pl-5 last:mb-0">{children}</ol>,
    li: ({ children }: MdProps) => <li className="mb-1">{children}</li>,
    strong: ({ children }: MdProps) => <strong className="font-semibold">{children}</strong>,
    em: ({ children }: MdProps) => <em className="italic">{children}</em>,
    a: ({ children, href }: MdProps) => (
        <a href={href} target="_blank" rel="noreferrer" className="text-primary-600 underline">
            {children}
        </a>
    ),
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

// ── header summary ──────────────────────────────────────────────────────────
function LearnerHeader({ learner }: { learner: SelectedLearner }) {
    const { t } = useTranslation('settingsLearnerActivityDialog');
    const roleList = useMemo(
        () =>
            Array.from(
                new Set(
                    (learner.roles ?? '')
                        .split(',')
                        .map((r) => r.trim())
                        .filter(Boolean)
                )
            ),
        [learner.roles]
    );
    const initial = (learner.name || learner.email || '?').charAt(0).toUpperCase();

    return (
        <div className="flex shrink-0 items-start gap-3 border-b border-neutral-200 p-5 pr-10">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-50 text-h3 font-semibold text-primary-500">
                {initial}
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-subtitle font-semibold text-neutral-700">
                        {learner.name || learner.userId}
                    </span>
                    {roleList.map((r) => (
                        <span
                            key={r}
                            className="rounded-full border border-neutral-200 bg-neutral-50 px-2 py-0.5 text-caption text-neutral-600"
                        >
                            {mapRoleToCustomName(r)}
                        </span>
                    ))}
                </div>
                {learner.email && (
                    <span className="truncate text-caption text-neutral-500">{learner.email}</span>
                )}
                <div className="mt-1 flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1 rounded-md bg-primary-50 px-2 py-1 text-caption font-medium text-primary-600">
                        <Coins className="size-3.5" weight="fill" />
                        {t('header.credits', {
                            count: learner.totalCredits,
                            value: learner.totalCredits.toFixed(2),
                        })}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-md bg-neutral-100 px-2 py-1 text-caption font-medium text-neutral-600">
                        <Lightning className="size-3.5" weight="fill" />
                        {t('header.requests', { count: learner.requestCount })}
                    </span>
                </div>
            </div>
        </div>
    );
}

// ── chat transcript pane ────────────────────────────────────────────────────
// Tool messages carry a `tool_name` in metadata; surface it without dumping the
// (potentially large) raw tool_result content.
function toolLabel(message: ConversationMessage): string {
    let toolName: string | null = null;
    if (message.metadata) {
        try {
            const meta = JSON.parse(message.metadata) as { tool_name?: unknown };
            if (typeof meta?.tool_name === 'string') toolName = meta.tool_name;
        } catch {
            // ignore malformed metadata
        }
    }
    const pretty = toolName ? prettify(toolName) : null;
    if (message.type === 'tool_call') {
        return pretty
            ? i18next.t('settingsLearnerActivityDialog:toolLabel.usedTool', { name: pretty })
            : i18next.t('settingsLearnerActivityDialog:toolLabel.usedToolGeneric');
    }
    return pretty
        ? i18next.t('settingsLearnerActivityDialog:toolLabel.toolResult', { name: pretty })
        : i18next.t('settingsLearnerActivityDialog:toolLabel.toolResultGeneric');
}

function MessageBubble({ message }: { message: ConversationMessage }) {
    if (message.type === 'tool_call' || message.type === 'tool_result') {
        return (
            <div className="flex justify-center">
                <span className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2.5 py-1 text-caption text-neutral-400">
                    <PuzzlePiece className="size-3.5" />
                    {toolLabel(message)}
                </span>
            </div>
        );
    }

    const isUser = message.type === 'user';
    return (
        <div className={cn('flex w-full', isUser ? 'justify-end' : 'justify-start')}>
            <div className={cn('flex max-w-lg flex-col gap-1', isUser ? 'items-end' : 'items-start')}>
                <div
                    className={cn(
                        'rounded-lg px-3 py-2 text-body',
                        isUser
                            ? 'rounded-br-sm bg-primary-500 text-white'
                            : 'rounded-bl-sm border border-neutral-200 bg-neutral-50 text-neutral-700'
                    )}
                >
                    {isUser ? (
                        <p className="whitespace-pre-wrap">{message.content}</p>
                    ) : (
                        <ReactMarkdown components={mdComponents}>{message.content}</ReactMarkdown>
                    )}
                </div>
                <span className="px-1 text-caption text-neutral-400">
                    {formatDateTime(message.createdAt)}
                </span>
            </div>
        </div>
    );
}

function TranscriptPane({ sessionId }: { sessionId: string | null }) {
    const { t } = useTranslation('settingsLearnerActivityDialog');
    const messagesQ = useConversationMessagesQuery(sessionId);

    if (!sessionId) {
        return (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
                <ChatCircleDots className="size-8 text-neutral-300" />
                <p className="text-body text-neutral-400">{t('transcript.selectConversation')}</p>
            </div>
        );
    }
    if (messagesQ.isLoading) {
        return (
            <div className="flex flex-1 items-center justify-center p-8">
                <p className="animate-pulse text-body text-neutral-400">{t('transcript.loading')}</p>
            </div>
        );
    }
    if (messagesQ.error) {
        return (
            <div className="flex flex-1 items-center justify-center p-8">
                <p className="text-body text-danger-600">{t('transcript.loadError')}</p>
            </div>
        );
    }
    const messages = messagesQ.data ?? [];
    if (messages.length === 0) {
        return (
            <div className="flex flex-1 items-center justify-center p-8">
                <p className="text-body text-neutral-400">{t('transcript.empty')}</p>
            </div>
        );
    }

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
            {messages.map((m) => (
                <MessageBubble key={m.id} message={m} />
            ))}
        </div>
    );
}

// ── session list pane ───────────────────────────────────────────────────────
function SessionListItem({
    session,
    active,
    onClick,
}: {
    session: ConversationRow;
    active: boolean;
    onClick: () => void;
}) {
    const { t } = useTranslation('settingsLearnerActivityDialog');
    const Icon = contextIcon(session.contextType);
    const isVoice = !!session.sessionMode && session.sessionMode !== 'text';
    return (
        <button
            type="button"
            onClick={onClick}
            className={cn(
                'flex w-full flex-col gap-1 border-l-2 px-3 py-2.5 text-left transition-colors',
                active
                    ? 'border-primary-500 bg-primary-50'
                    : 'border-transparent hover:bg-neutral-50'
            )}
        >
            <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5 text-caption font-medium text-neutral-600">
                    <Icon className="size-3.5 shrink-0" />
                    <span className="truncate">
                        {session.contextTitle || prettify(session.contextType)}
                    </span>
                </span>
                <span className="shrink-0 text-caption text-neutral-400">
                    {formatDateTime(session.lastActive)}
                </span>
            </div>
            <p className="line-clamp-2 text-body text-neutral-700">
                {session.preview || (
                    <span className="text-neutral-400">{t('conversations.noMessagePreview')}</span>
                )}
            </p>
            <div className="flex items-center gap-2 text-caption text-neutral-400">
                <span className="inline-flex items-center gap-1">
                    <ChatCircleDots className="size-3" />
                    {session.messageCount}
                </span>
                {isVoice && (
                    <span className="inline-flex items-center gap-1 text-primary-500">
                        <Microphone className="size-3" />
                        {prettify(session.sessionMode)}
                    </span>
                )}
            </div>
        </button>
    );
}

function ConversationsTab({
    learner,
    range,
}: {
    learner: SelectedLearner;
    range: UsageDateRange;
}) {
    const { t } = useTranslation('settingsLearnerActivityDialog');
    const [sessionPage, setSessionPage] = useState(0);
    const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

    const conversationsQ = useUserConversationsQuery(learner.userId, sessionPage, PAGE_SIZE, range);
    const sessions = conversationsQ.data?.content ?? [];

    // Auto-select the first session on the page when none is chosen.
    useEffect(() => {
        const first = sessions[0];
        if (!selectedSessionId && first) {
            setSelectedSessionId(first.sessionId);
        }
    }, [sessions, selectedSessionId]);

    // Loading — fill the whole area.
    if (conversationsQ.isLoading) {
        return (
            <div className="flex min-h-0 flex-1 items-center justify-center p-8">
                <p className="animate-pulse text-body text-neutral-400">
                    {t('conversations.loading')}
                </p>
            </div>
        );
    }

    // No sessions — one centered empty state across the whole view.
    if (sessions.length === 0) {
        return (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
                <div className="flex size-14 items-center justify-center rounded-full bg-neutral-100">
                    <ChatCircleDots className="size-7 text-neutral-400" />
                </div>
                <p className="text-subtitle font-semibold text-neutral-600">
                    {t('conversations.emptyTitle')}
                </p>
                <p className="max-w-sm text-body text-neutral-400">
                    {t('conversations.emptyDescription', {
                        name: learner.name || t('conversations.thisMember'),
                    })}
                </p>
            </div>
        );
    }

    return (
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
            {/* Session list */}
            <div className="flex max-h-48 min-h-0 flex-col overflow-y-auto border-b border-neutral-200 md:max-h-none md:w-80 md:shrink-0 md:border-b-0 md:border-r">
                <div className="flex-1">
                    {sessions.map((s) => (
                        <SessionListItem
                            key={s.sessionId}
                            session={s}
                            active={s.sessionId === selectedSessionId}
                            onClick={() => setSelectedSessionId(s.sessionId)}
                        />
                    ))}
                </div>
                {conversationsQ.data && conversationsQ.data.total_pages > 1 && (
                    <div className="sticky bottom-0 border-t border-neutral-200 bg-white p-2">
                        <MyPagination
                            currentPage={sessionPage}
                            totalPages={conversationsQ.data.total_pages}
                            onPageChange={(p) => {
                                setSessionPage(p);
                                setSelectedSessionId(null);
                            }}
                        />
                    </div>
                )}
            </div>

            {/* Transcript */}
            <TranscriptPane sessionId={selectedSessionId} />
        </div>
    );
}

// ── credit-activity tab ─────────────────────────────────────────────────────
function ActivityTab({ learner, range }: { learner: SelectedLearner; range: UsageDateRange }) {
    const { t } = useTranslation('settingsLearnerActivityDialog');
    const [logPage, setLogPage] = useState(0);
    const logsQ = useUsageUserLogsQuery(learner.userId, logPage, PAGE_SIZE, range);

    const columns: ColumnDef<UsageLogRow>[] = useMemo(
        () => [
            {
                accessorKey: 'createdAt',
                header: t('activity.columns.when'),
                size: 200,
                cell: ({ row }) =>
                    row.original.createdAt ? formatDateTime(row.original.createdAt) : '—',
            },
            {
                accessorKey: 'requestType',
                header: t('activity.columns.tool'),
                size: 220,
                cell: ({ row }) => prettify(row.original.requestType),
            },
            {
                accessorKey: 'model',
                header: t('activity.columns.model'),
                size: 400,
                cell: ({ row }) => (
                    <span className="block truncate" title={row.original.model || undefined}>
                        {row.original.model || '—'}
                    </span>
                ),
            },
            {
                accessorKey: 'credits',
                header: t('activity.columns.credits'),
                size: 160,
                cell: ({ row }) => (
                    <span className="font-semibold text-neutral-800">
                        {row.original.credits.toFixed(4)}
                    </span>
                ),
            },
        ],
        [t]
    );

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
            <div className="flex items-center gap-2 text-caption text-neutral-500">
                <ListBullets className="size-4" />
                {t('activity.description')}
            </div>
            <MyTable<UsageLogRow>
                data={logsQ.data}
                columns={columns}
                isLoading={logsQ.isLoading}
                error={logsQ.error}
                currentPage={logPage}
            />
            {logsQ.data && logsQ.data.total_pages > 1 && (
                <MyPagination
                    currentPage={logPage}
                    totalPages={logsQ.data.total_pages}
                    onPageChange={setLogPage}
                />
            )}
        </div>
    );
}

// ── dialog shell ────────────────────────────────────────────────────────────
function TabPill({
    active,
    onClick,
    children,
}: {
    active: boolean;
    onClick: () => void;
    children: ReactNode;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={cn(
                'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-body font-medium transition-colors',
                active
                    ? 'bg-primary-50 text-primary-600'
                    : 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700'
            )}
        >
            {children}
        </button>
    );
}

export function LearnerActivityDialog({ learner, range, onClose }: Props) {
    const { t } = useTranslation('settingsLearnerActivityDialog');
    const [tab, setTab] = useState<'conversations' | 'activity'>('conversations');

    // Reset to the first tab whenever a new learner is opened.
    useEffect(() => {
        setTab('conversations');
    }, [learner?.userId]);

    const stateKey = learner ? `${learner.userId}:${range.startDate}:${range.endDate}` : 'none';

    return (
        <Sheet open={!!learner} onOpenChange={(o) => !o && onClose()}>
            <SheetContent
                side="right"
                className="flex h-full w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl"
            >
                {learner && (
                    <>
                        <LearnerHeader learner={learner} />
                        <div className="flex shrink-0 items-center gap-1.5 border-b border-neutral-100 px-5 py-2">
                            <TabPill
                                active={tab === 'conversations'}
                                onClick={() => setTab('conversations')}
                            >
                                <ChatCircleDots className="size-4" />
                                {t('tabs.conversations')}
                            </TabPill>
                            <TabPill active={tab === 'activity'} onClick={() => setTab('activity')}>
                                <Coins className="size-4" />
                                {t('tabs.creditActivity')}
                            </TabPill>
                        </div>
                        <div className="flex min-h-0 flex-1 flex-col">
                            {tab === 'conversations' ? (
                                <ConversationsTab key={stateKey} learner={learner} range={range} />
                            ) : (
                                <ActivityTab key={stateKey} learner={learner} range={range} />
                            )}
                        </div>
                    </>
                )}
            </SheetContent>
        </Sheet>
    );
}
