import { type KeyboardEvent, useRef } from 'react';
import { cn } from '@/lib/utils';

/**
 * Tabs of the report screens (GSTR-1 sheets, audit log), drawn like the
 * inventory tabs: 48 px tall, scroll sideways on a phone, arrow keys move.
 */
export function ReportTabs<T extends string>({
    tabs,
    active,
    onChange,
    label,
    idPrefix,
}: {
    tabs: { id: T; label: string }[];
    active: T;
    onChange: (tab: T) => void;
    label: string;
    idPrefix: string;
}) {
    const listRef = useRef<HTMLDivElement | null>(null);
    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        const buttons = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? []);
        const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
        if (current < 0) return;
        const last = buttons.length - 1;
        const moves: Record<string, number> = {
            ArrowRight: current === last ? 0 : current + 1,
            ArrowLeft: current === 0 ? last : current - 1,
            Home: 0,
            End: last,
        };
        const next = moves[event.key];
        if (next === undefined) return;
        event.preventDefault();
        buttons[next]?.focus();
    };
    return (
        <div
            ref={listRef}
            role="tablist"
            aria-label={label}
            onKeyDown={onKeyDown}
            className="-mx-1 flex min-w-0 gap-1 overflow-x-auto px-1 pb-1"
        >
            {tabs.map((tab) => {
                const selected = tab.id === active;
                return (
                    <button
                        key={tab.id}
                        id={`${idPrefix}-tab-${tab.id}`}
                        type="button"
                        role="tab"
                        aria-selected={selected}
                        aria-controls={`${idPrefix}-panel`}
                        tabIndex={selected ? 0 : -1}
                        onClick={() => onChange(tab.id)}
                        className={cn(
                            'h-12 shrink-0 whitespace-nowrap rounded-md px-4 text-body transition-colors',
                            selected
                                ? 'bg-primary-50 font-medium text-primary-500'
                                : 'text-muted-foreground hover:bg-neutral-100 hover:text-foreground'
                        )}
                    >
                        {tab.label}
                    </button>
                );
            })}
        </div>
    );
}
