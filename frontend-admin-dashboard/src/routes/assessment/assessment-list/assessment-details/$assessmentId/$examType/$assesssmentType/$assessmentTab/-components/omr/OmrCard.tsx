import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** The bordered block every part of the OMR tab sits in (same look as the copy-intake panel). */
export const OmrCard = ({
    title,
    subtitle,
    actions,
    className,
    children,
}: {
    title: string;
    subtitle?: string;
    actions?: ReactNode;
    className?: string;
    children: ReactNode;
}) => (
    <section
        className={cn(
            'flex flex-col gap-4 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm sm:p-5',
            className
        )}
    >
        <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
                <h3 className="text-subtitle font-semibold text-neutral-800">{title}</h3>
                {subtitle && <p className="text-caption text-neutral-500">{subtitle}</p>}
            </div>
            {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
        {children}
    </section>
);

export const OmrStat = ({
    label,
    value,
    tone,
}: {
    label: string;
    value: number;
    tone?: string;
}) => (
    <div className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2">
        <div className="text-caption text-neutral-500">{label}</div>
        <div className={cn('text-lg font-semibold text-neutral-800', tone)}>{value}</div>
    </div>
);
