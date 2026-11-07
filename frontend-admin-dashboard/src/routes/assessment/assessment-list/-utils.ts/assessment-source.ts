/**
 * Where an assessment came from. `assessment.source` is 'API' for exams created
 * through the public AI Evaluation API (spec §12); dashboard-made ones carry
 * NULL (or an internal value such as 'AI_RECORDING'), so everything that is not
 * 'API' counts as Dashboard.
 */
export const ASSESSMENT_SOURCE_API = 'API';

export type AssessmentSourceFilter = 'DASHBOARD' | 'API';

export const ASSESSMENT_SOURCE_FILTERS: AssessmentSourceFilter[] = ['DASHBOARD', 'API'];

export const isApiSourced = (source: string | null | undefined): boolean =>
    (source ?? '').trim().toUpperCase() === ASSESSMENT_SOURCE_API;

/**
 * Client-side Source filter over one loaded page. The list endpoint has no
 * `sources` parameter yet, so this narrows the rows the server returned;
 * nothing selected, or both selected, means All.
 */
export function filterBySource<T extends { source?: string | null }>(
    items: T[],
    selected: readonly string[]
): T[] {
    const wantApi = selected.includes('API');
    const wantDashboard = selected.includes('DASHBOARD');
    if (wantApi === wantDashboard) return items;
    return items.filter((item) => isApiSourced(item.source) === wantApi);
}
