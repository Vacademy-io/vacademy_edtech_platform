import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { TONE_CHIP_CLASSES, type LabelTone } from '@/services/submission-review/labels';

/** The small rounded label every marking / result state uses (tokens only). */
export const StatusPill = ({
    tone,
    children,
    icon,
    className,
}: {
    tone: LabelTone;
    children: ReactNode;
    icon?: ReactNode;
    className?: string;
}) => (
    <span
        className={cn(
            'inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-full border px-2 text-caption font-semibold',
            TONE_CHIP_CLASSES[tone],
            className
        )}
    >
        {icon}
        {children}
    </span>
);
