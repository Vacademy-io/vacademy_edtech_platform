/**
 * The lead side sheet for the Reports Center: the same StudentSidebar that Recent Leads,
 * Lead List and the Students List open. `ReportLeadName` (report-lead-name.tsx) opens it.
 *
 * Opening it calls nothing new on the server. The sheet is seeded from the row the report
 * already holds (user id, name, phone, email), and it is only mounted once a student is
 * opened, so the Reports page makes no profile requests until then. After that it loads
 * what its open tab needs, the same requests it makes on All Leads. No `_response_id` key
 * is set, so the Lead Profile tab loads the student's own saved enquiries, as it does for
 * an admitted learner.
 *
 * StudentSidebarProvider is mounted app-wide by the layout; this only owns open/close.
 */
import { useCallback, useState, type ReactNode } from 'react';
import { SidebarProvider } from '@/components/ui/sidebar';
import { StudentSidebar } from '@/routes/manage-students/students-list/-components/students-list/student-side-view/student-side-view';
import { useStudentSidebar } from '@/routes/manage-students/students-list/-context/selected-student-sidebar-context';
import type { StudentTable } from '@/types/student-table-types';
import {
    ReportLeadSheetContext,
    type OpenReportLead,
    type ReportLeadRef,
} from './report-lead-name';

/** Same width the lead lists give the sheet. */
const SHEET_STYLE = { ['--sidebar-width' as string]: '565px' };

/**
 * No `status`: the report doesn't know the enrolment's, and the sheet header would show it
 * as a chip (a converted student wrongly marked "Inactive"). No `package_session_id` either,
 * so the plan cards don't tag a batch.
 */
const seedStudent = (lead: ReportLeadRef): StudentTable => {
    const seed: Record<string, unknown> = {
        id: lead.userId,
        user_id: lead.userId,
        full_name: lead.name ?? '',
        email: lead.email ?? '',
        mobile_number: lead.phone ?? '',
    };
    return seed as unknown as StudentTable;
};

export function ReportLeadSheetProvider({ children }: { children: ReactNode }) {
    const { setSelectedStudent } = useStudentSidebar();
    const [open, setOpen] = useState(false);

    const openLead = useCallback<OpenReportLead>(
        (lead) => {
            if (!lead.userId) return;
            setSelectedStudent(seedStudent(lead), { openOverlay: false });
            setOpen(true);
        },
        [setSelectedStudent]
    );

    // Only a student name opens the sheet. SidebarProvider also toggles on Cmd/Ctrl+B, which
    // would open it on whichever student another page selected last, so ignore opens from it.
    const onOpenChange = useCallback((next: boolean) => {
        if (!next) setOpen(false);
    }, []);

    return (
        <ReportLeadSheetContext.Provider value={openLead}>
            <SidebarProvider
                style={SHEET_STYLE}
                defaultOpen={false}
                open={open}
                onOpenChange={onOpenChange}
            >
                <div className="min-w-0 flex-1">{children}</div>
                {open && (
                    <StudentSidebar
                        selectedTab="overview"
                        examType="EXAM"
                        isStudentList={false}
                        defaultLeadProfile
                    />
                )}
            </SidebarProvider>
        </ReportLeadSheetContext.Provider>
    );
}
