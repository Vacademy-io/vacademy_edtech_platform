import { type KeyboardEvent, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { formatNumber } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { useQueueCount } from '@/routes/commerce/orders/-shared/order-hooks';
import type { QueueDefinition } from '@/routes/commerce/orders/-shared/order-queues';
import type { OrderQueue } from '@/routes/commerce/orders/-shared/order-types';

/** The id of a queue's tab, for the panel's `aria-labelledby`. */
export const queueTabId = (queue: OrderQueue) => `order-queue-tab-${queue}`;

/** The id of the panel the tabs control (the filters and the list). */
export const QUEUE_PANEL_ID = 'order-queue-panel';

/**
 * The desk's queue tabs. A count follows each tab's name (one `pageSize=1`
 * read per tab, refreshed every minute while the page is visible); while it
 * loads or when it fails there is simply no number, never an error banner.
 * Keyboard: Tab reaches the selected tab only; the arrow keys, Home and End
 * move between tabs, and Enter or Space opens one (each opening loads a list,
 * so moving does not open).
 */
export function OrderQueueTabs({
    queues,
    active,
    onChange,
    enabled,
}: {
    queues: readonly QueueDefinition[];
    active: OrderQueue;
    onChange: (queue: OrderQueue) => void;
    enabled: boolean;
}) {
    const { t } = useTranslation('commerce');
    const listRef = useRef<HTMLDivElement | null>(null);

    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        const tabs = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? []);
        const current = tabs.indexOf(document.activeElement as HTMLButtonElement);
        if (current < 0 || tabs.length === 0) return;
        const last = tabs.length - 1;
        const moves: Record<string, number> = {
            ArrowRight: current === last ? 0 : current + 1,
            ArrowDown: current === last ? 0 : current + 1,
            ArrowLeft: current === 0 ? last : current - 1,
            ArrowUp: current === 0 ? last : current - 1,
            Home: 0,
            End: last,
        };
        const next = moves[event.key] ?? null;
        if (next === null) return;
        event.preventDefault();
        tabs[next]?.focus();
    };

    return (
        <div
            ref={listRef}
            role="tablist"
            aria-label={t('orders.queues.label')}
            onKeyDown={onKeyDown}
            className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1"
        >
            {queues.map((queue) => (
                <QueueTab
                    key={queue.id}
                    queue={queue}
                    selected={queue.id === active}
                    onSelect={() => onChange(queue.id)}
                    enabled={enabled}
                />
            ))}
        </div>
    );
}

function QueueTab({
    queue,
    selected,
    onSelect,
    enabled,
}: {
    queue: QueueDefinition;
    selected: boolean;
    onSelect: () => void;
    enabled: boolean;
}) {
    const { t } = useTranslation('commerce');
    const count = useQueueCount(queue.serverQueue ?? '', enabled && !!queue.serverQueue);
    const total = queue.serverQueue && count.isSuccess ? count.data : null;
    return (
        <button
            type="button"
            role="tab"
            id={queueTabId(queue.id)}
            aria-selected={selected}
            aria-controls={QUEUE_PANEL_ID}
            tabIndex={selected ? 0 : -1}
            data-queue={queue.id}
            onClick={onSelect}
            className={cn(
                'flex min-h-10 shrink-0 items-center gap-2 rounded-md border px-3 text-body transition-colors',
                selected
                    ? 'border-primary-500 bg-primary-50 font-medium text-primary-500'
                    : 'border-border bg-card text-muted-foreground hover:border-primary-200 hover:text-foreground'
            )}
        >
            <span className="whitespace-nowrap">{t(`orders.queues.${queue.id}`)}</span>
            {total !== null && (
                <span
                    data-testid={`queue-count-${queue.id}`}
                    aria-label={t('orders.queues.count', { count: total })}
                    className={cn(
                        'rounded-full px-1.5 text-caption tabular-nums',
                        selected ? 'bg-primary-100 text-primary-500' : 'bg-muted text-muted-foreground'
                    )}
                >
                    {formatNumber(total)}
                </span>
            )}
        </button>
    );
}
