import type { FolderNode } from '../../-services/folder-library-service';

/**
 * Pure helpers for the `learningPath` section's canvas preview.
 *
 * A learning path IS a product page: its steps are the page's courses in
 * display order, one step per course with that course's language versions
 * folded in. In list mode the section lists the product pages of a folder
 * library (each one a path). The rules mirror the live section so the canvas
 * does not promise something the site will not show.
 */

/** The by-code mapping fields the preview reads (learner product-page response). */
export interface PathMapping {
    id?: string;
    package_id?: string | null;
    package_name?: string | null;
    level_name?: string | null;
    package_session_id?: string | null;
    display_order?: number | null;
    status?: string | null;
    payment_plan?: { actual_price?: number | null; elevated_price?: number | null; currency?: string | null } | null;
}

export interface PathStep {
    /** package_id (one step per course). */
    courseId: string;
    title: string;
    /** Language / level versions of the course, in display order. */
    versions: PathMapping[];
    /** Price of the first version — what the step shows before a language is picked. */
    price: number | null;
    currency: string | null;
}

const orderOf = (m: PathMapping) =>
    typeof m.display_order === 'number' && Number.isFinite(m.display_order) ? m.display_order : Number.MAX_SAFE_INTEGER;

/** Active mappings → ordered steps, one per course (a course sits where its first version sits). */
export const pathSteps = (mappings: PathMapping[] | null | undefined): PathStep[] => {
    const active = (mappings || [])
        .filter((m) => !m.status || m.status === 'ACTIVE')
        .map((m, index) => ({ m, index }))
        .sort((a, b) => orderOf(a.m) - orderOf(b.m) || a.index - b.index)
        .map(({ m }) => m);
    const steps: PathStep[] = [];
    const byCourse = new Map<string, PathStep>();
    active.forEach((m, i) => {
        const key = String(m.package_id || m.package_session_id || m.id || `step-${i}`);
        let step = byCourse.get(key);
        if (!step) {
            step = { courseId: key, title: (m.package_name || '').trim(), versions: [], price: null, currency: null };
            byCourse.set(key, step);
            steps.push(step);
        }
        step.versions.push(m);
    });
    for (const step of steps) {
        const plan = step.versions[0]?.payment_plan;
        step.price = typeof plan?.actual_price === 'number' ? plan.actual_price : null;
        step.currency = plan?.currency ? String(plan.currency) : null;
    }
    return steps;
};

/** Sum of the steps' prices; null when there is no price at all or the currencies differ. */
export const pathTotal = (steps: PathStep[]): { total: number; currency: string | null } | null => {
    const priced = steps.filter((s) => typeof s.price === 'number');
    if (!priced.length) return null;
    const currencies = new Set(priced.map((s) => (s.currency || '').toUpperCase()));
    if (currencies.size > 1) return null;
    return { total: priced.reduce((sum, s) => sum + (s.price || 0), 0), currency: priced[0]!.currency };
};

/** Level names worth showing as version chips ("Hindi", "English"); placeholder names are dropped. */
export const versionLabels = (step: PathStep): string[] => {
    const SENTINELS = new Set(['default', 'none', 'null', 'undefined', '']);
    const out: string[] = [];
    for (const v of step.versions) {
        const name = (v.level_name || '').trim();
        if (!SENTINELS.has(name.toLowerCase()) && !out.includes(name)) out.push(name);
    }
    return out;
};

export interface PathLeaf {
    node: FolderNode;
    /** Top-level folder the path sits under (its stream), or null for a top-level product page. */
    stream: FolderNode | null;
}

/** Visitor rules: hidden branches and product pages that are not live never show. */
const visibleChildren = (nodes: FolderNode[] | undefined) => (nodes || []).filter((n) => n.status !== 'HIDDEN');

/**
 * Product pages (paths) under a folder — or the whole library — in tree order,
 * each with the stream it belongs to and each product page once. Like the live
 * section (learner collectPathEntries / pathsInScope): a coming-soon folder is
 * not opened — what is inside has not launched — and a `startFolderId` that is
 * missing, hidden or coming soon yields nothing.
 */
export const collectPathLeaves = (roots: FolderNode[] | null | undefined, startFolderId?: string | null): PathLeaf[] => {
    const out: PathLeaf[] = [];
    if (!Array.isArray(roots)) return out;
    const seenCodes = new Set<string>();
    const walk = (nodes: FolderNode[], stream: FolderNode | null) => {
        for (const n of visibleChildren(nodes)) {
            if (n.node_type === 'PRODUCT_PAGE') {
                const code = (n.product_page_code || '').trim();
                if (n.product_page_status === 'ACTIVE' && code && !seenCodes.has(code)) {
                    seenCodes.add(code);
                    out.push({ node: n, stream });
                }
            } else if (!n.coming_soon) {
                walk(n.children || [], stream ?? n);
            }
        }
    };
    if (!startFolderId) {
        walk(roots, null);
        return out;
    }
    // Find the start folder through visible branches only, remembering its stream.
    const find = (nodes: FolderNode[], stream: FolderNode | null): boolean => {
        for (const n of visibleChildren(nodes)) {
            if (n.node_type !== 'FOLDER') continue;
            const nStream = stream ?? n;
            if (n.id === startFolderId) {
                if (!n.coming_soon) walk(n.children || [], nStream);
                return true;
            }
            if (find(n.children || [], nStream)) return true;
        }
        return false;
    };
    find(roots, null);
    return out;
};
