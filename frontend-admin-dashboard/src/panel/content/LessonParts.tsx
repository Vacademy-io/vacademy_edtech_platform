/**
 * Small shared pieces of the Lessons screen: the big choice card and its grid. 10-foot sizing: cards are ≥ min-h-28 real <button>s
 * with an `active:` pressed state (no hover-only affordance), spacing via
 * space-x-* / grid gap (flex `gap` needs Chrome 84).
 */
import type { ReactNode } from 'react';
import { Books, type Icon } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';

export interface LessonCardProps {
    icon?: Icon;
    title: string;
    meta?: ReactNode;
    /** Right-aligned extra (a draft badge). */
    aside?: ReactNode;
    onClick: () => void;
    /** Unsupported slide types are dimmed but stay tappable (they open the explainer card). */
    muted?: boolean;
    className?: string;
}

/** A big tappable choice card for the picker grids. */
export function LessonCard({
    icon,
    title,
    meta,
    aside,
    onClick,
    muted,
    className,
}: LessonCardProps) {
    const IconComponent = icon ?? Books;
    return (
        <button
            type="button"
            onClick={onClick}
            className={cn(
                'flex min-h-28 w-full items-start space-x-4 rounded-lg border border-border bg-card p-5 text-left shadow-sm transition-colors',
                'active:border-primary-500 active:bg-primary-50',
                'focus:outline-none focus:ring-2 focus:ring-primary-300',
                className
            )}
        >
            <IconComponent
                size={48}
                weight="duotone"
                className={cn('shrink-0', muted ? 'text-neutral-400' : 'text-primary-500')}
                aria-hidden
            />
            <span className="block min-w-0 flex-1 space-y-1">
                <span
                    className={cn(
                        'line-clamp-2 block break-words text-h3 font-semibold',
                        muted ? 'text-neutral-500' : 'text-neutral-800'
                    )}
                >
                    {title}
                </span>
                {meta && <span className="block text-subtitle text-neutral-500">{meta}</span>}
            </span>
            {aside && <span className="shrink-0">{aside}</span>}
        </button>
    );
}

/** Grid for LessonCards: 1 column on phones, 2 from md (Android TV is 960 px), 3 from 2xl. */
export function LessonGrid({ children }: { children: ReactNode }) {
    return <div className="grid grid-cols-1 gap-5 md:grid-cols-2 2xl:grid-cols-3">{children}</div>;
}
