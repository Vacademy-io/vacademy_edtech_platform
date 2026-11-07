import { Link } from '@tanstack/react-router';
import { cn } from '@/lib/utils';
import type { ReportLinkTarget } from '../../-utils/report-links';

/** Dotted underline marks a number as a link without turning a whole table blue. */
const LINK_CLASS =
    'rounded-sm underline decoration-neutral-300 decoration-dotted underline-offset-4 hover:text-primary-600 hover:decoration-primary-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

interface ReportLinkProps {
    target: ReportLinkTarget;
    /** What a screen reader says, and the hover tooltip. Starts with the visible text. */
    label: string;
    className?: string;
    children: React.ReactNode;
}

/**
 * A figure on the report that opens the items behind it: the Task Inbox or the Leads &
 * outcomes page, on the same day and engine. A real link, so it works from the keyboard,
 * opens in a new tab on request and can be copied.
 */
export function ReportLink({ target, label, className, children }: ReportLinkProps) {
    return (
        <Link
            to={target.to as never}
            search={target.search as never}
            aria-label={label}
            title={label}
            className={cn(LINK_CLASS, className)}
        >
            {children}
        </Link>
    );
}
