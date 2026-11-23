/** Audience helpers for the editor (spec 3.2). */
import type {
    Audience,
    AudienceCondition,
    AudienceConditionKind,
} from '../-types/learner-home-types';

export const AUDIENCE_CONDITION_KINDS: readonly AudienceConditionKind[] = [
    'PACKAGE_SESSION',
    'ENROLLED_IN_COURSE',
    'NOT_ENROLLED_IN_COURSE',
    'USER_TAG',
];

export function emptyCondition(kind: AudienceConditionKind): AudienceCondition {
    switch (kind) {
        case 'PACKAGE_SESSION':
            return { kind, ids: [] };
        case 'USER_TAG':
            return { kind, tag_ids: [] };
        default:
            return { kind, package_ids: [] };
    }
}

export function conditionIds(c: AudienceCondition): string[] {
    switch (c.kind) {
        case 'PACKAGE_SESSION':
            return c.ids;
        case 'USER_TAG':
            return c.tag_ids;
        default:
            return c.package_ids;
    }
}

export function withConditionIds(c: AudienceCondition, ids: string[]): AudienceCondition {
    switch (c.kind) {
        case 'PACKAGE_SESSION':
            return { ...c, ids };
        case 'USER_TAG':
            return { ...c, tag_ids: ids };
        default:
            return { ...c, package_ids: ids };
    }
}

export interface AudienceSummary {
    everyone: boolean;
    batches: number;
    courses: number;
    notCourses: number;
    tags: number;
}

/** Counts for the list chip: "Everyone" or "3 batches + 1 tag". */
export function summarizeAudience(audience: Audience): AudienceSummary {
    const out: AudienceSummary = {
        everyone: audience.mode === 'EVERYONE',
        batches: 0,
        courses: 0,
        notCourses: 0,
        tags: 0,
    };
    if (audience.mode === 'RULES') {
        for (const c of audience.all_of) {
            const n = conditionIds(c).length;
            if (c.kind === 'PACKAGE_SESSION') out.batches += n;
            else if (c.kind === 'ENROLLED_IN_COURSE') out.courses += n;
            else if (c.kind === 'NOT_ENROLLED_IN_COURSE') out.notCourses += n;
            else out.tags += n;
        }
    }
    return out;
}
