import type { ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import {
    ChatCircleDots,
    GraduationCap,
    PuzzlePiece,
    Student,
    BookOpen,
} from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { MyDialog } from '@/components/design-system/dialog';
import { cn } from '@/lib/utils';
import {
    CONTEXT_TYPE_LABELS,
    SESSION_MODE_LABELS,
    formatDateTime,
    prettifyLabel,
    useChatTranscriptQuery,
    type ChatbotSessionRow,
    type ChatTranscriptMessage,
} from '../-services/chatbot-analytics';

/** Markdown rendered with design tokens (this app has no prose plugin). */
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
    table: ({ children }: MdProps) => (
        <div className="mb-2 overflow-x-auto last:mb-0">
            <table className="w-full border-collapse text-caption">{children}</table>
        </div>
    ),
    th: ({ children }: MdProps) => (
        <th className="border border-neutral-200 bg-neutral-50 p-1 text-left font-semibold">
            {children}
        </th>
    ),
    td: ({ children }: MdProps) => <td className="border border-neutral-200 p-1">{children}</td>,
};

/** Tool traffic is noise for an admin — collapse it to one line, no raw payload. */
function toolLabel(message: ChatTranscriptMessage, t: TFunction): string {
    let toolName: string | null = null;
    if (message.metadata) {
        try {
            const meta = JSON.parse(message.metadata) as { tool_name?: unknown };
            if (typeof meta?.tool_name === 'string') toolName = meta.tool_name;
        } catch {
            // ignore malformed metadata
        }
    }
    const pretty = toolName ? prettifyLabel(toolName) : null;
    if (message.type === 'tool_call') {
        return pretty ? t('usedTool', { tool: pretty }) : t('aiUsedTool');
    }
    return pretty ? t('toolResultNamed', { tool: pretty }) : t('toolResult');
}

function MessageBubble({ message }: { message: ChatTranscriptMessage }) {
    const { t } = useTranslation('studyLibraryChatTranscriptDialog');
    if (message.type === 'tool_call' || message.type === 'tool_result') {
        return (
            <div className="flex justify-center">
                <span className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2.5 py-1 text-caption text-neutral-400">
                    <PuzzlePiece className="size-3.5" />
                    {toolLabel(message, t)}
                </span>
            </div>
        );
    }

    const isUser = message.type === 'user';
    const isQuiz = message.type === 'quiz' || message.type === 'quiz_feedback';
    return (
        <div className={cn('flex w-full', isUser ? 'justify-end' : 'justify-start')}>
            <div
                className={cn('flex max-w-lg flex-col gap-1', isUser ? 'items-end' : 'items-start')}
            >
                {isQuiz && (
                    <span className="px-1 text-caption font-medium text-info-600">
                        {message.type === 'quiz' ? t('practiceQuiz') : t('quizResult')}
                    </span>
                )}
                <div
                    className={cn(
                        'rounded-lg px-3 py-2 text-body',
                        isUser
                            ? 'rounded-br-sm bg-primary-500 text-white'
                            : 'rounded-bl-sm border border-neutral-200 bg-neutral-50 text-neutral-700',
                        isQuiz && 'border-info-200 bg-info-50'
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

function contextIcon(contextType: string | null) {
    switch (contextType) {
        case 'slide':
            return BookOpen;
        case 'course_details':
            return GraduationCap;
        default:
            return ChatCircleDots;
    }
}

interface Props {
    session: ChatbotSessionRow | null;
    onClose: () => void;
}

/** Full transcript of one Student AI chat, opened from the recent-chats table. */
export const ChatTranscriptDialog = ({ session, onClose }: Props) => {
    const { t } = useTranslation('studyLibraryChatTranscriptDialog');
    const transcriptQuery = useChatTranscriptQuery(session?.sessionId ?? null);
    const messages = transcriptQuery.data ?? [];
    const ContextIcon = contextIcon(session?.contextType ?? null);

    return (
        <MyDialog
            heading={
                session ? t('chatWith', { name: session.studentName }) : t('chatHeading')
            }
            open={!!session}
            onOpenChange={(open) => {
                if (!open) onClose();
            }}
            dialogWidth="max-w-3xl"
        >
            {session && (
                <div className="flex flex-col gap-4">
                    <div className="flex flex-wrap items-center gap-2 border-b border-neutral-200 pb-3">
                        {session.studentEmail && (
                            <span className="inline-flex items-center gap-1 text-caption text-neutral-500">
                                <Student className="size-3.5" />
                                {session.studentEmail}
                            </span>
                        )}
                        <span className="inline-flex items-center gap-1 rounded-md bg-neutral-100 px-2 py-1 text-caption text-neutral-600">
                            <ContextIcon className="size-3.5" />
                            {session.contextTitle ||
                                CONTEXT_TYPE_LABELS[session.contextType ?? ''] ||
                                prettifyLabel(session.contextType)}
                        </span>
                        <span className="rounded-md bg-neutral-100 px-2 py-1 text-caption text-neutral-600">
                            {SESSION_MODE_LABELS[session.sessionMode ?? 'text'] ??
                                prettifyLabel(session.sessionMode)}
                        </span>
                        <span className="rounded-md bg-neutral-100 px-2 py-1 text-caption text-neutral-600">
                            {t('started', { time: formatDateTime(session.createdAt) })}
                        </span>
                    </div>

                    {transcriptQuery.isLoading && (
                        <p className="animate-pulse py-8 text-center text-body text-neutral-400">
                            {t('loadingTranscript')}
                        </p>
                    )}
                    {transcriptQuery.error && (
                        <p className="py-8 text-center text-body text-danger-600">
                            {t('loadFailed')}
                        </p>
                    )}
                    {!transcriptQuery.isLoading &&
                        !transcriptQuery.error &&
                        messages.length === 0 && (
                            <p className="py-8 text-center text-body text-neutral-400">
                                {t('noMessages')}
                            </p>
                        )}

                    <div className="flex flex-col gap-3">
                        {messages.map((m) => (
                            <MessageBubble key={m.id} message={m} />
                        ))}
                    </div>
                </div>
            )}
        </MyDialog>
    );
};

export default ChatTranscriptDialog;
