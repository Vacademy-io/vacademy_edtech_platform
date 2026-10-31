import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { MyButton } from '@/components/design-system/button';
import { Copy, Check, CaretRight, User, Globe, Database } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import type { AdminActivityLog } from '@/services/admin-activity-logs/getActivityLogs';

interface Props {
    log: AdminActivityLog | null;
    open: boolean;
    onClose: () => void;
    /** Narrow the list to this actor — the drawer's one shortcut back into the log. */
    onFilterByActor?: (actorId: string) => void;
}

const ACTION_VARIANT: Record<string, 'default' | 'destructive' | 'secondary' | 'outline'> = {
    CREATE: 'default',
    UPDATE: 'secondary',
    DELETE: 'destructive',
    CANCEL: 'destructive',
    TERMINATE: 'destructive',
    UNASSIGN: 'destructive',
    ENROLL: 'default',
    ASSIGN: 'default',
};

const statusTone = (status: number | null | undefined): string => {
    if (status == null) return 'text-neutral-500';
    if (status >= 200 && status < 300) return 'text-success-600';
    if (status >= 400 && status < 500) return 'text-warning-600';
    return 'text-danger-600';
};

/** "lead_status_id" → "Lead status id". Audit payloads are snake_case. */
const humanizeKey = (key: string): string => {
    const spaced = key.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const isEmptyPayload = (value: unknown): boolean =>
    value == null ||
    (isPlainObject(value) && Object.keys(value).length === 0) ||
    (Array.isArray(value) && value.length === 0);

export function PayloadDrawer({ log, open, onClose, onFilterByActor }: Props) {
    const { t, i18n } = useTranslation('adminActivityLogsPayloadDrawer');
    return (
        <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
            {/*
              Explicit flex column with a min-h-0 scroll body. The previous
              `overflow-y-auto` on the panel itself left a long payload clipped
              at the bottom of the viewport with nothing to scroll, because the
              nested payload box swallowed the wheel and the panel's own content
              had no bounded height to scroll within.
            */}
            <SheetContent className="flex size-full flex-col gap-0 p-0 sm:max-w-2xl">
                {log && (
                    <DrawerBody
                        log={log}
                        onFilterByActor={onFilterByActor}
                        t={t}
                        locale={i18n.language}
                    />
                )}
            </SheetContent>
        </Sheet>
    );
}

function DrawerBody({
    log,
    onFilterByActor,
    t,
    locale,
}: {
    log: AdminActivityLog;
    onFilterByActor?: (actorId: string) => void;
    t: TFunction;
    locale: string;
}) {
    const hasBefore = !isEmptyPayload(log.before_payload);
    const hasPayload = !isEmptyPayload(log.request_payload);

    return (
        <>
            <header className="shrink-0 border-b border-neutral-200 px-6 py-4 pr-14">
                <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={ACTION_VARIANT[log.action] || 'outline'}>{log.action}</Badge>
                    <span className="text-caption font-medium uppercase tracking-wide text-neutral-500">
                        {log.entity_type.replace(/_/g, ' ')}
                    </span>
                </div>
                <SheetTitle className="mt-2 text-subtitle font-semibold leading-snug text-neutral-700">
                    {log.description ||
                        t('titleFallback', {
                            action: log.action.toLowerCase(),
                            entityType: log.entity_type.toLowerCase().replace(/_/g, ' '),
                        })}
                </SheetTitle>
                <SheetDescription className="mt-1 text-body text-neutral-500">
                    <span className="font-medium text-neutral-600">
                        {log.actor_name || log.actor_email || t('unknownUser')}
                    </span>
                    {' · '}
                    {log.created_at && new Date(log.created_at).toLocaleString(locale)}
                </SheetDescription>
            </header>

            {/* The only scroll container in the drawer. */}
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
                <div className="flex flex-col gap-6">
                    <Section title={t('sections.performedBy')} icon={<User className="size-4" />}>
                        <KeyValue label={t('fields.name')} value={log.actor_name} />
                        <KeyValue label={t('fields.email')} value={log.actor_email} />
                        <KeyValue label={t('fields.userId')} value={log.actor_id} mono />
                        {log.actor_id && onFilterByActor && (
                            <div className="pt-1">
                                <MyButton
                                    buttonType="secondary"
                                    scale="small"
                                    className="sm:!min-w-0"
                                    onClick={() => onFilterByActor(log.actor_id as string)}
                                >
                                    {t('buttons.seeEverythingByPerson')}
                                </MyButton>
                            </div>
                        )}
                    </Section>

                    <Section title={t('sections.request')} icon={<Globe className="size-4" />}>
                        <KeyValue label={t('fields.method')} value={log.http_method} />
                        <KeyValue label={t('fields.endpoint')} value={log.endpoint} mono />
                        <KeyValue label={t('fields.ipAddress')} value={log.ip_address} mono />
                        <KeyValue
                            label={t('fields.response')}
                            value={log.response_status?.toString() ?? null}
                            valueClassName={statusTone(log.response_status)}
                        />
                        <KeyValue
                            label={t('fields.latency')}
                            value={
                                log.response_time_ms != null ? `${log.response_time_ms} ms` : null
                            }
                        />
                        <KeyValue label={t('fields.entityId')} value={log.entity_id} mono />
                        <KeyValue label={t('fields.logId')} value={log.id} mono />
                        <KeyValue label={t('fields.device')} value={log.user_agent} />
                    </Section>

                    {hasBefore ? (
                        <Section
                            title={t('sections.whatChanged')}
                            icon={<Database className="size-4" />}
                        >
                            <div className="flex flex-col gap-4">
                                <PayloadBlock
                                    label={t('payload.before')}
                                    value={log.before_payload}
                                    tone="muted"
                                    t={t}
                                />
                                <PayloadBlock
                                    label={t('payload.afterSubmitted')}
                                    value={log.request_payload}
                                    tone="accent"
                                    t={t}
                                />
                            </div>
                        </Section>
                    ) : (
                        <Section
                            title={t('sections.submittedData')}
                            icon={<Database className="size-4" />}
                        >
                            {hasPayload ? (
                                <PayloadBlock value={log.request_payload} t={t} />
                            ) : (
                                <p className="text-body italic text-neutral-500">
                                    {t('payload.noPayloadCaptured')}
                                </p>
                            )}
                        </Section>
                    )}
                </div>
            </div>
        </>
    );
}

function Section({
    title,
    icon,
    children,
}: {
    title: string;
    icon?: React.ReactNode;
    children: React.ReactNode;
}) {
    return (
        <section>
            <h3 className="mb-2 flex items-center gap-1.5 text-caption font-semibold uppercase tracking-wide text-neutral-500">
                {icon}
                {title}
            </h3>
            <div className="flex flex-col gap-1.5">{children}</div>
        </section>
    );
}

/**
 * Two-column row that WRAPS instead of truncating. Endpoints, user agents and
 * ids are the values an auditor actually needs to read in full; the previous
 * version cut them off at 60% of the drawer width with only a title tooltip.
 */
function KeyValue({
    label,
    value,
    mono,
    valueClassName,
}: {
    label: string;
    value: string | null | undefined;
    mono?: boolean;
    valueClassName?: string;
}) {
    if (!value) return null;
    return (
        <div className="grid grid-cols-[9rem_1fr] gap-3 text-body">
            <span className="text-neutral-500">{label}</span>
            <span
                className={cn(
                    'min-w-0 break-words text-neutral-700',
                    mono && 'font-mono text-caption',
                    valueClassName
                )}
            >
                {value}
            </span>
        </div>
    );
}

/**
 * A payload rendered as readable fields, with the raw JSON one click away.
 * Admins read these to answer "what did they actually change?", and a wall of
 * braces is a poor answer.
 */
function PayloadBlock({
    value,
    label,
    tone = 'default',
    t,
}: {
    value: unknown;
    label?: string;
    tone?: 'default' | 'muted' | 'accent';
    t: TFunction;
}) {
    const [showRaw, setShowRaw] = useState(false);
    const [copied, setCopied] = useState(false);
    const formatted = useMemo(() => JSON.stringify(value, null, 2), [value]);

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(formatted);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            /* clipboard blocked — no-op */
        }
    };

    const toneClasses =
        tone === 'accent'
            ? 'border-primary-200 bg-primary-50/40'
            : tone === 'muted'
              ? 'border-neutral-200 bg-neutral-50'
              : 'border-neutral-200 bg-neutral-50';

    return (
        <div>
            <div className="mb-1 flex items-center justify-between gap-2">
                {label ? (
                    <span className="text-caption font-medium uppercase tracking-wide text-neutral-500">
                        {label}
                    </span>
                ) : (
                    <span />
                )}
                <div className="flex items-center gap-1">
                    <MyButton
                        buttonType="text"
                        scale="small"
                        className="sm:!min-w-0"
                        onClick={() => setShowRaw((prev) => !prev)}
                    >
                        {showRaw ? t('buttons.fields') : t('buttons.rawJson')}
                    </MyButton>
                    <MyButton
                        buttonType="text"
                        scale="small"
                        className="sm:!min-w-0"
                        onClick={copy}
                    >
                        {copied ? (
                            <>
                                <Check className="mr-1 size-3.5" />
                                {t('buttons.copied')}
                            </>
                        ) : (
                            <>
                                <Copy className="mr-1 size-3.5" />
                                {t('buttons.copy')}
                            </>
                        )}
                    </MyButton>
                </div>
            </div>
            <div className={cn('overflow-x-auto rounded-lg border p-3', toneClasses)}>
                {showRaw ? (
                    <pre className="whitespace-pre-wrap break-words font-mono text-caption leading-snug text-neutral-700">
                        {formatted}
                    </pre>
                ) : (
                    <JsonFields value={value} t={t} />
                )}
            </div>
        </div>
    );
}

/** Recursive field renderer: objects become labelled rows, arrays become lists. */
function JsonFields({
    value,
    depth = 0,
    t,
}: {
    value: unknown;
    depth?: number;
    t: TFunction;
}) {
    if (value == null) {
        return <span className="text-body italic text-neutral-500">{t('payload.null')}</span>;
    }

    if (Array.isArray(value)) {
        if (value.length === 0) {
            return (
                <span className="text-body italic text-neutral-500">{t('payload.emptyList')}</span>
            );
        }
        return (
            <ol className="flex list-none flex-col gap-2">
                {value.map((item, index) => (
                    <li key={index} className="flex gap-2">
                        <span className="shrink-0 font-mono text-caption text-neutral-400">
                            {index + 1}.
                        </span>
                        <div className="min-w-0 flex-1">
                            <JsonFields value={item} depth={depth + 1} t={t} />
                        </div>
                    </li>
                ))}
            </ol>
        );
    }

    if (isPlainObject(value)) {
        const entries = Object.entries(value);
        if (entries.length === 0) {
            return (
                <span className="text-body italic text-neutral-500">{t('payload.noFields')}</span>
            );
        }
        return (
            <dl className="flex flex-col gap-1.5">
                {entries.map(([key, child]) => {
                    const nested = isPlainObject(child) || Array.isArray(child);
                    return (
                        <div
                            key={key}
                            className={cn(
                                nested
                                    ? 'flex flex-col gap-1'
                                    : 'grid grid-cols-[9rem_1fr] items-start gap-3'
                            )}
                        >
                            <dt
                                className={cn(
                                    'text-body text-neutral-500',
                                    nested && 'flex items-center gap-1 font-medium'
                                )}
                            >
                                {nested && <CaretRight className="size-3 text-neutral-400" />}
                                {humanizeKey(key)}
                            </dt>
                            <dd
                                className={cn(
                                    'min-w-0 break-words text-body text-neutral-700',
                                    nested && 'border-l border-neutral-200 pl-3'
                                )}
                            >
                                <JsonFields value={child} depth={depth + 1} t={t} />
                            </dd>
                        </div>
                    );
                })}
            </dl>
        );
    }

    if (typeof value === 'boolean') {
        return (
            <span className={value ? 'text-success-600' : 'text-neutral-500'}>
                {value ? t('payload.yes') : t('payload.no')}
            </span>
        );
    }

    return <span className="break-words">{String(value)}</span>;
}
