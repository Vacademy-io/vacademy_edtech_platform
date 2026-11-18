import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
    ArrowBendDownRight,
    Check,
    CheckCircle,
    Clock,
    Copy,
    ShieldCheck,
    Sparkle,
    SpinnerGap,
    Warning,
    XCircle,
} from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { cn } from '@/lib/utils';
import { formatMessageTime } from './assistant-format';
import type { AssistantAction, AssistantMessage } from './types';

const FOCUS_RING =
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300 focus-visible:ring-offset-1';

// Token-styled markdown renderer for assistant replies (mirrors the AI-usage
// dialog's map, so it stays design-system-conformant — no `prose` plugin).
// Tables scroll sideways inside the bubble instead of widening the panel.
type MdProps = { children?: ReactNode; href?: string };
export function createMdComponents(
    onInternalLink: (to: string) => void,
    tableLabel = 'Table'
): Components {
    return {
        p: ({ children }: MdProps) => <p className="mb-2 last:mb-0">{children}</p>,
        ul: ({ children }: MdProps) => (
            <ul className="mb-2 list-disc ps-5 last:mb-0">{children}</ul>
        ),
        ol: ({ children }: MdProps) => (
            <ol className="mb-2 list-decimal ps-5 last:mb-0">{children}</ol>
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
                        className={cn(
                            'rounded-sm font-medium text-primary-600 underline',
                            FOCUS_RING
                        )}
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
                    className={cn('rounded-sm text-primary-600 underline', FOCUS_RING)}
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
        table: ({ children }: MdProps) => (
            <div
                role="region"
                aria-label={tableLabel}
                tabIndex={0}
                className={cn(
                    'mb-2 max-w-full overflow-x-auto rounded-md border border-neutral-200 bg-white last:mb-0',
                    FOCUS_RING
                )}
            >
                <table className="w-full border-collapse text-caption">{children}</table>
            </div>
        ),
        thead: ({ children }: MdProps) => <thead className="bg-neutral-50">{children}</thead>,
        tr: ({ children }: MdProps) => (
            <tr className="border-b border-neutral-100 last:border-b-0">{children}</tr>
        ),
        th: ({ children }: MdProps) => (
            <th className="whitespace-nowrap px-2 py-1.5 text-start font-semibold text-neutral-700">
                {children}
            </th>
        ),
        td: ({ children }: MdProps) => (
            <td className="px-2 py-1.5 align-top text-neutral-700">{children}</td>
        ),
        h1: ({ children }: MdProps) => <p className="mb-1 text-body font-semibold">{children}</p>,
        h2: ({ children }: MdProps) => <p className="mb-1 text-body font-semibold">{children}</p>,
        h3: ({ children }: MdProps) => <p className="mb-1 text-body font-semibold">{children}</p>,
    };
}

/** Copies an answer's text; says so for a moment (also to screen readers). */
function CopyButton({ text }: { text: string }) {
    const { t } = useTranslation('dashboardIndex');
    const [copied, setCopied] = useState(false);
    const timer = useRef<ReturnType<typeof setTimeout>>();
    useEffect(() => () => clearTimeout(timer.current), []);
    const copy = async () => {
        try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            clearTimeout(timer.current);
            timer.current = setTimeout(() => setCopied(false), 2000);
        } catch {
            // Clipboard blocked (insecure context or permission): nothing to undo.
        }
    };
    return (
        <button
            type="button"
            onClick={copy}
            aria-label={
                copied ? t('assistant.panel.actions.copied') : t('assistant.panel.actions.copy')
            }
            title={t('assistant.panel.actions.copy')}
            className={cn(
                'flex size-6 items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700 motion-reduce:transition-none',
                FOCUS_RING
            )}
        >
            {copied ? (
                <Check size={14} weight="bold" className="text-success-600" aria-hidden="true" />
            ) : (
                <Copy size={14} aria-hidden="true" />
            )}
            <span className="sr-only" aria-live="polite">
                {copied ? t('assistant.panel.actions.copied') : ''}
            </span>
        </button>
    );
}

export function MessageBubble({
    message,
    mdComponents,
}: {
    message: AssistantMessage;
    mdComponents: Components;
}) {
    const { i18n } = useTranslation('dashboardIndex');
    const isUser = message.role === 'user';
    const time = formatMessageTime(message.createdAt, i18n.language);

    if (isUser) {
        return (
            <div className="flex flex-col items-end gap-1 ps-10">
                <div className="w-fit max-w-full whitespace-pre-wrap break-words rounded-lg rounded-ee-sm bg-primary-500 px-3 py-2 text-body text-white">
                    {message.content}
                </div>
                {time && <span className="px-1 text-2xs text-neutral-400">{time}</span>}
            </div>
        );
    }

    return (
        <div className="flex items-start gap-2 pe-4">
            <span
                className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary-50 text-primary-500"
                aria-hidden="true"
            >
                <Sparkle size={13} weight="fill" />
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="min-w-0 break-words rounded-lg rounded-ss-sm border border-neutral-200 bg-neutral-50 px-3 py-2 text-body text-neutral-800">
                    {message.content ? (
                        <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                            {message.content}
                        </ReactMarkdown>
                    ) : (
                        message.streaming && <span className="text-neutral-400">…</span>
                    )}
                </div>
                {!message.streaming && message.content && (
                    <div className="flex items-center gap-1 px-1">
                        {time && <span className="text-2xs text-neutral-400">{time}</span>}
                        <CopyButton text={message.content} />
                    </div>
                )}
            </div>
        </div>
    );
}

/** Next-question chips under the latest answer; a click sends the question. */
export function FollowUpChips({
    suggestions,
    disabled,
    onPick,
}: {
    suggestions: string[];
    disabled?: boolean;
    onPick: (text: string) => void;
}) {
    const { t } = useTranslation('dashboardIndex');
    if (!suggestions.length) return null;
    return (
        <div
            role="group"
            aria-label={t('assistant.panel.followUps')}
            className="flex flex-wrap gap-2 ps-8"
        >
            {suggestions.map((s) => (
                <button
                    key={s}
                    type="button"
                    disabled={disabled}
                    onClick={() => onPick(s)}
                    className={cn(
                        'flex min-h-8 max-w-full items-center gap-1.5 rounded-full border border-primary-200 bg-white px-3 py-1 text-start text-caption text-primary-600 transition-colors hover:border-primary-300 hover:bg-primary-50 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none',
                        FOCUS_RING
                    )}
                >
                    <ArrowBendDownRight
                        size={12}
                        className="shrink-0 rtl:-scale-x-100"
                        aria-hidden="true"
                    />
                    <span className="min-w-0 break-words">{s}</span>
                </button>
            ))}
        </div>
    );
}

/**
 * The assistant's progress while it works: one line in a fixed-height slot, replaced as tools
 * run, so the conversation above it never jumps.
 */
export function ActivityLine({ label }: { label: string }) {
    return (
        <div
            className="flex h-6 items-center gap-2 ps-8 text-caption text-neutral-500"
            role="status"
            aria-live="polite"
        >
            <SpinnerGap
                size={14}
                className="shrink-0 text-primary-500 motion-safe:animate-spin"
                aria-hidden="true"
            />
            <span className="truncate">{label}</span>
        </div>
    );
}

const CARD_OUTCOME: Record<string, { key: string; Icon: typeof CheckCircle; tone: string }> = {
    executed: { key: 'executed', Icon: CheckCircle, tone: 'bg-success-50 text-success-700' },
    cancelled: { key: 'cancelled', Icon: XCircle, tone: 'bg-neutral-100 text-neutral-600' },
    applying: { key: 'applying', Icon: SpinnerGap, tone: 'bg-info-50 text-info-700' },
    expired: { key: 'expired', Icon: Clock, tone: 'bg-neutral-100 text-neutral-600' },
    failed: { key: 'failed', Icon: XCircle, tone: 'bg-danger-50 text-danger-700' },
};

/**
 * Nonce-backed confirmation card for a proposed write. The change only executes
 * when Confirm posts the server-held nonce back — the model cannot trigger it.
 * Cards from a past chat (no nonce) are read-only.
 */
export function ActionCard({
    action,
    onResolve,
}: {
    action: AssistantAction;
    onResolve: (actionId: string, decision: 'confirm' | 'cancel') => void;
}) {
    const { t } = useTranslation('dashboardIndex');
    const isPending = action.status === 'pending' && !!action.actionId;
    const isWorking = action.status === 'working';
    const outcome = CARD_OUTCOME[action.status] ?? CARD_OUTCOME.failed!;
    const OutcomeIcon = outcome.Icon;
    return (
        <div className="ms-8 rounded-lg border border-warning-200 bg-warning-50 p-3">
            <div className="flex items-start gap-2">
                <ShieldCheck
                    size={18}
                    weight="fill"
                    className="mt-0.5 shrink-0 text-warning-600"
                    aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                    <p className="text-caption font-semibold uppercase tracking-wide text-warning-700">
                        {t('assistant.panel.card.title')}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap break-words text-body text-neutral-800">
                        {action.summary}
                    </p>
                    <ActionCardLines
                        details={action.details}
                        warnings={action.warnings}
                        warningsLabel={t('assistant.panel.card.beforeConfirm')}
                    />
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
                        {t('assistant.panel.card.cancel')}
                    </MyButton>
                    <MyButton
                        buttonType="primary"
                        scale="small"
                        disable={isWorking}
                        onClick={() => onResolve(action.actionId, 'confirm')}
                    >
                        {isWorking
                            ? t('assistant.panel.card.working')
                            : t('assistant.panel.card.confirm')}
                    </MyButton>
                </div>
            ) : (
                <p
                    className={cn(
                        'mt-3 flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-caption font-medium',
                        outcome.tone
                    )}
                >
                    <OutcomeIcon size={14} weight="fill" className="shrink-0" aria-hidden="true" />
                    {t(`assistant.panel.card.${outcome.key}`)}
                </p>
            )}
        </div>
    );
}

/** What a card changes (one line each) and what to know first, under its summary. */
export function ActionCardLines({
    details,
    warnings,
    warningsLabel = 'Before you confirm',
}: {
    details?: string[];
    warnings?: string[];
    warningsLabel?: string;
}) {
    if (!details?.length && !warnings?.length) return null;
    return (
        <>
            {details?.length ? (
                <ul className="mt-2 space-y-1 rounded-md bg-white px-2 py-1.5 text-caption text-neutral-700">
                    {details.map((line, i) => (
                        <li key={i} className="break-words">
                            {line}
                        </li>
                    ))}
                </ul>
            ) : null}
            {warnings?.length ? (
                <ul
                    className="mt-2 space-y-1 rounded-md border border-warning-200 bg-white p-2 text-caption text-warning-700"
                    aria-label={warningsLabel}
                >
                    {warnings.map((line, i) => (
                        <li key={i} className="flex items-start gap-1.5 break-words">
                            <Warning size={12} weight="bold" className="mt-0.5 shrink-0" />
                            <span>{line}</span>
                        </li>
                    ))}
                </ul>
            ) : null}
        </>
    );
}
