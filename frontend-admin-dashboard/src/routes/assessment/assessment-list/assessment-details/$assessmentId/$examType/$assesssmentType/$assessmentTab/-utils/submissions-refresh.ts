/**
 * The submissions table is loaded by a mutation inside AssessmentSubmissionsTab and its
 * row menus are rendered from static column definitions, so a row dialog cannot reach
 * its refresh. A changed mark asks for a refresh through this window event instead.
 */
export const SUBMISSIONS_REFRESH_EVENT = 'vacademy:assessment-submissions-refresh';

export const requestSubmissionsRefresh = () => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent(SUBMISSIONS_REFRESH_EVENT));
};
