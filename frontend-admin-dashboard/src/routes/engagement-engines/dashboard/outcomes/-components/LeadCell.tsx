import type { ReportItemRow } from '@/services/engagement-daily-report';
import { canOpenLead } from '../-hooks/use-open-lead-profile';

interface LeadCellProps {
    row: ReportItemRow;
    /** The name shown. */
    label: string;
    /** What a screen reader says for the button, e.g. "Open the profile of Asha Rao". */
    openLabel: string;
    onOpen: (row: ReportItemRow) => void;
}

/**
 * The lead's name in a row. With a user id or an audience-response id it is a button that opens
 * the profile side sheet, so the whole row is reachable from the keyboard; without either there
 * is nothing to open and it is plain text.
 */
export function LeadCell({ row, label, openLabel, onOpen }: LeadCellProps) {
    if (!canOpenLead(row)) {
        return <span className="font-semibold text-neutral-900">{label}</span>;
    }
    return (
        <button
            type="button"
            aria-label={openLabel}
            onClick={(event) => {
                // The row opens the profile too; one click must not open it twice.
                event.stopPropagation();
                onOpen(row);
            }}
            className="rounded-sm text-start font-semibold text-neutral-900 hover:text-primary-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
            {label}
        </button>
    );
}
