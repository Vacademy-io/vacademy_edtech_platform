/**
 * A student name in a report list (Counsellors → converted leads, Conversions → converted
 * leads, Revenue → payments) that opens the lead side sheet. The sheet itself lives in
 * `report-lead-sheet.tsx`, mounted once by the Reports page; this file stays light so the
 * tabs don't pull the whole learner profile into their own imports.
 */
import { createContext, useContext } from 'react';
import { cn } from '@/lib/utils';

/** What a report row knows about the student. */
export interface ReportLeadRef {
    userId: string;
    name?: string | null;
    phone?: string | null;
    email?: string | null;
}

export type OpenReportLead = (lead: ReportLeadRef) => void;

export const ReportLeadSheetContext = createContext<OpenReportLead | null>(null);

/** Opens a student in the side sheet; null outside the Reports page (e.g. in tests). */
export const useOpenReportLead = (): OpenReportLead | null => useContext(ReportLeadSheetContext);

/**
 * A report row's student cell: the name (a link that opens the side sheet) and the contact
 * line under it. Without a sheet around it the name is plain text.
 */
export function ReportLeadName({
    lead,
    contact,
}: {
    lead: ReportLeadRef;
    contact?: string | null;
}) {
    const openLead = useOpenReportLead();
    const label = lead.name || lead.userId;
    return (
        <>
            {openLead && lead.userId ? (
                <button
                    type="button"
                    onClick={() => openLead(lead)}
                    className={cn(
                        'text-left font-medium text-primary-500 hover:underline',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300'
                    )}
                >
                    {label}
                </button>
            ) : (
                <div className="font-medium text-neutral-900">{label}</div>
            )}
            {contact && <div className="text-xs text-neutral-500">{contact}</div>}
        </>
    );
}
