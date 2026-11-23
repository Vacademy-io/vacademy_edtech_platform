import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** A label and its value, one row of a detail card. */
export function DetailRow({
    label,
    children,
    strong,
    className,
}: {
    label: string;
    children: ReactNode;
    strong?: boolean;
    className?: string;
}) {
    return (
        <div className={cn('flex items-baseline justify-between gap-3 text-body', className)}>
            <span className="text-muted-foreground">{label}</span>
            <span className={cn('text-end tabular-nums text-foreground', strong && 'font-medium')}>
                {children}
            </span>
        </div>
    );
}
