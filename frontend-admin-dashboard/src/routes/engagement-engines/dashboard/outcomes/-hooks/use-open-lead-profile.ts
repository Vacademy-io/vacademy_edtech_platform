import { useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { mapRecentLeadToStudent } from '@/components/shared/leads/lead-view-model';
import {
    audienceLeadKey,
    fetchAudienceLeadByResponseId,
} from '@/routes/audience-manager/list/-services/get-recent-leads';
import { useStudentSidebar } from '@/routes/manage-students/students-list/-context/selected-student-sidebar-context';
import { fetchStudentDetailsOnce } from '@/services/get-student-details';
import type { ReportItemRow } from '@/services/engagement-daily-report';
import type { StudentTable } from '@/types/student-table-types';

/** A row can open a profile when it has either handle on the lead. */
export const canOpenLead = (row: ReportItemRow): boolean =>
    !!(row.userId || row.audienceResponseId);

/** What the side sheet can show before the lead itself has loaded, from the row alone. */
const seedStudent = (row: ReportItemRow): StudentTable => {
    const userId = row.userId ?? '';
    const seed: Record<string, unknown> = {
        id: userId,
        user_id: userId,
        full_name: row.leadName ?? '',
        email: row.email ?? '',
        mobile_number: row.phone ?? '',
        status: 'INACTIVE',
        _response_id: row.audienceResponseId ?? null,
    };
    return seed as unknown as StudentTable;
};

/**
 * Opens a lead in the same side sheet Recent Leads, Follow-ups and the Call Log use (there is
 * no page of its own for a lead). The sheet is seeded from the row so it opens at once, then
 * replaced by the real lead, because its header, Communications tab and form answers read the
 * selected object whole:
 *   1. a lead with an audience-response id is fetched and mapped the way the leads lists map it;
 *   2. one with only a user id falls back to the user record, for name, email and phone.
 * If both fail the row's own details stay.
 *
 * Must be used inside the student sidebar provider (the page layout mounts it) and next to a
 * `SidebarProvider` + `StudentSidebar` that `onOpened` opens.
 */
export function useOpenLeadProfile(onOpened: () => void) {
    const { t } = useTranslation('engagementDailyReport');
    const { setSelectedStudent } = useStudentSidebar();
    const queryClient = useQueryClient();
    const latest = useRef(0);

    return useCallback(
        async (row: ReportItemRow) => {
            if (!canOpenLead(row)) return;
            const token = ++latest.current;
            setSelectedStudent(seedStudent(row), { openOverlay: false });
            onOpened();

            const apply = (student: StudentTable) => {
                // Another row was opened while this one loaded: its selection wins.
                if (latest.current !== token) return;
                // The lead's own record may lack a name; never take away the one the row had.
                const named = student.full_name
                    ? student
                    : { ...student, full_name: row.leadName ?? '' };
                setSelectedStudent(named, { openOverlay: false });
            };

            if (row.audienceResponseId) {
                const responseId = row.audienceResponseId;
                try {
                    const lead = await queryClient.fetchQuery({
                        queryKey: audienceLeadKey(responseId),
                        queryFn: () => fetchAudienceLeadByResponseId(responseId),
                        staleTime: 2 * 60 * 1000,
                    });
                    apply(mapRecentLeadToStudent(lead));
                    return;
                } catch {
                    // A deleted response: fall through to the user record.
                }
            }

            if (row.userId) {
                try {
                    const details = await fetchStudentDetailsOnce(queryClient, row.userId);
                    apply({
                        ...seedStudent(row),
                        full_name: details?.full_name || row.leadName || '',
                        email: details?.email || row.email || '',
                        mobile_number: details?.mobile_number || row.phone || '',
                    } as StudentTable);
                    return;
                } catch {
                    // Keep the row's own details.
                }
            }
            if (latest.current === token && !row.userId) {
                toast.error(t('outcomesPage.openFailed'));
            }
        },
        [onOpened, queryClient, setSelectedStudent, t]
    );
}
