import type { StudentTable } from '@/types/student-table-types';

/**
 * The shared bulk WhatsApp / email dialogs take StudentTable rows. The dashboard
 * only knows a learner's id, name and contact, and the dialogs re-read the rest
 * by user_id — same minimal shape the feedback page and attendance tracker pass.
 */
export const toStudentTable = (learner: {
    userId: string;
    name: string | null;
    email: string | null;
    mobile: string | null;
    packageSessionId: string | null;
}): StudentTable => ({
    id: learner.userId,
    user_id: learner.userId,
    username: null,
    email: learner.email ?? '',
    full_name: learner.name ?? '',
    mobile_number: learner.mobile ?? '',
    institute_enrollment_id: '',
    institute_enrollment_number: '',
    package_session_id: learner.packageSessionId ?? '',
    status: 'ACTIVE',
    face_file_id: null,
    address_line: '',
    attendance_percent: 0,
    referral_count: 0,
    region: null,
    city: '',
    pin_code: '',
    date_of_birth: '',
    gender: '',
    fathers_name: '',
    mothers_name: '',
    father_mobile_number: '',
    father_email: '',
    mother_mobile_number: '',
    mother_email: '',
    linked_institute_name: null,
    created_at: '',
    updated_at: '',
    session_expiry_days: 0,
    institute_id: '',
    expiry_date: 0,
    parents_email: '',
    parents_mobile_number: '',
    parents_to_mother_email: '',
    parents_to_mother_mobile_number: '',
    destination_package_session_id: '',
    enroll_invite_id: '',
    payment_status: '',
    custom_fields: {},
});

/** "live-classes_2026-09-21_to_2026-09-27.csv" — safe for every OS. */
export const exportFileName = (kind: string, start: string, end: string, ext = 'csv') =>
    `${kind}_${start}_to_${end}.${ext}`.replace(/[^a-zA-Z0-9._-]/g, '-');

/** Marks elements that must not appear in the printed / PDF report. */
export const PRINT_HIDE_ATTR = 'data-print-hide';

/**
 * Prints just the dashboard (not the admin shell around it) through a hidden
 * iframe, so the browser's "Save as PDF" gives a clean report. Charts are SVG
 * and the app's stylesheets are copied across, so it looks like the screen.
 */
export const printElement = (element: HTMLElement, title: string): void => {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);

    const doc = iframe.contentDocument;
    const win = iframe.contentWindow;
    if (!doc || !win) {
        iframe.remove();
        return;
    }
    const styles = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'))
        .map((node) => node.outerHTML)
        .join('\n');
    const printCss = `
        @page { size: A4 landscape; margin: 12mm; }
        html, body { background: white !important; }
        body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        [${PRINT_HIDE_ATTR}] { display: none !important; }
        section, .break-inside-avoid { break-inside: avoid; }
    `;
    doc.open();
    doc.write(
        `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>` +
            `${styles}<style>${printCss}</style></head><body>${element.outerHTML}</body></html>`
    );
    doc.close();

    const cleanup = () => setTimeout(() => iframe.remove(), 1000);
    // Give linked stylesheets and fonts a moment before opening the print dialog.
    setTimeout(() => {
        win.focus();
        win.print();
        cleanup();
    }, 600);
};

const escapeHtml = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ─── Shareable view (URL search params) ────────────────────────────────────

export interface DashboardUrlState {
    from?: string;
    to?: string;
    batches?: string;
    teachers?: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Reads URL filters back into state; anything malformed is ignored. */
export const parseDashboardUrl = (search: DashboardUrlState) => {
    const list = (v?: string) =>
        (v ?? '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
    const from = search.from && ISO_DATE.test(search.from) ? search.from : null;
    const to = search.to && ISO_DATE.test(search.to) ? search.to : null;
    return {
        range: from && to && from <= to ? { start: from, end: to } : null,
        batchIds: list(search.batches),
        teacherIds: list(search.teachers),
    };
};

export const toDashboardUrl = (state: {
    startDate: string;
    endDate: string;
    batchIds: string[];
    teacherIds: string[];
}): DashboardUrlState => ({
    from: state.startDate,
    to: state.endDate,
    batches: state.batchIds.length ? state.batchIds.join(',') : undefined,
    teachers: state.teacherIds.length ? state.teacherIds.join(',') : undefined,
});
