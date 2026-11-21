import type { CheckIssue } from '../../-types/learner-home-types';

/** Issues of one block at `path` or under it ("config.slides[0]" covers its image). */
export function under(issues: CheckIssue[], path: string): CheckIssue[] {
    return issues.filter(
        (i) =>
            !!i.path &&
            (i.path === path || i.path.startsWith(`${path}.`) || i.path.startsWith(`${path}[`))
    );
}

/** Issues at exactly `path`. */
export function exact(issues: CheckIssue[], path: string): CheckIssue[] {
    return issues.filter((i) => i.path === path);
}

export const hasError = (issues: CheckIssue[]) => issues.some((i) => i.severity !== 'warning');
