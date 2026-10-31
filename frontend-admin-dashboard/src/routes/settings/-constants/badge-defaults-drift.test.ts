/**
 * Drift guard for the six built-in badges.
 *
 * The same list lives in THREE places that never import each other:
 *  - admin:   DEFAULT_BADGE_CONFIG (this folder)
 *  - backend: admin_core_service/src/main/resources/badges/default-badges.json
 *             (accepted ids on /learner/v1/sync-unlocks, materialised before the first
 *             catalogue append)
 *  - learner: frontend-learner-dashboard-app/src/services/badge-config.ts
 *
 * If they diverge, the backend rejects unlocks the learner app legitimately computed, or the
 * first custom badge hides a default. This test reads the other two copies off disk and skips
 * (rather than fails) when a sibling checkout is missing.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_BADGE_CONFIG, type BadgeDefinitionConfig } from './badge-config';

const COMPARED_FIELDS = [
    'id',
    'name',
    'description',
    'icon',
    'trigger',
    'threshold',
    'enabled',
] as const satisfies ReadonlyArray<keyof BadgeDefinitionConfig>;

type ComparedBadge = Pick<BadgeDefinitionConfig, (typeof COMPARED_FIELDS)[number]>;

const MONOREPO_ROOT = path.resolve(__dirname, '../../../../..');
const BACKEND_DEFAULTS = path.join(
    MONOREPO_ROOT,
    'admin_core_service/src/main/resources/badges/default-badges.json'
);
const LEARNER_CONFIG = path.join(
    MONOREPO_ROOT,
    'frontend-learner-dashboard-app/src/services/badge-config.ts'
);

const pickCompared = (b: Record<string, unknown>): ComparedBadge =>
    Object.fromEntries(COMPARED_FIELDS.map((k) => [k, b[k]])) as ComparedBadge;

const adminBadges = DEFAULT_BADGE_CONFIG.badges.map((b) =>
    pickCompared(b as unknown as Record<string, unknown>)
);

/**
 * Pull the object literals out of the learner's `DEFAULT_BADGE_CONFIG.badges` array without
 * importing the file (it sits outside this app's vite root and pulls learner-only deps).
 * Handles the prettier-formatted shape: one `key: value,` per line, double quotes.
 */
function parseLearnerDefaults(source: string): Record<string, unknown>[] {
    const start = source.indexOf('export const DEFAULT_BADGE_CONFIG');
    expect(start, 'learner badge-config.ts no longer exports DEFAULT_BADGE_CONFIG').toBeGreaterThan(
        -1
    );
    const end = source.indexOf('\n};', start);
    const block = source.slice(start, end);
    const badgesAt = block.indexOf('badges: [');
    expect(badgesAt, 'learner DEFAULT_BADGE_CONFIG has no badges array').toBeGreaterThan(-1);
    const list = block.slice(badgesAt);

    const objects: Record<string, unknown>[] = [];
    const objectRe = /\{([^{}]*)\}/g;
    let m: RegExpExecArray | null;
    while ((m = objectRe.exec(list)) !== null) {
        const body = m[1] ?? '';
        const obj: Record<string, unknown> = {};
        const fieldRe =
            /([A-Za-z_][A-Za-z0-9_]*)\s*:\s*("((?:[^"\\]|\\.)*)"|\d+(?:\.\d+)?|true|false)/g;
        let f: RegExpExecArray | null;
        while ((f = fieldRe.exec(body)) !== null) {
            const key = f[1] as string;
            const raw = f[2] as string;
            if (f[3] !== undefined) obj[key] = f[3];
            else if (raw === 'true' || raw === 'false') obj[key] = raw === 'true';
            else obj[key] = Number(raw);
        }
        if (typeof obj.id === 'string') objects.push(obj);
    }
    return objects;
}

describe('default badge catalogue stays in lock-step across apps', () => {
    it('admin defaults are the six known ids, in order', () => {
        expect(adminBadges.map((b) => b.id)).toEqual([
            'first_course',
            'streak_7',
            'streak_30',
            'perfect_score',
            'completionist',
            'dedicated_learner',
        ]);
    });

    it.skipIf(!fs.existsSync(BACKEND_DEFAULTS))(
        'backend default-badges.json matches the admin DEFAULT_BADGE_CONFIG field-for-field',
        () => {
            const parsed = JSON.parse(fs.readFileSync(BACKEND_DEFAULTS, 'utf8')) as {
                badges: Record<string, unknown>[];
            };
            expect(Array.isArray(parsed.badges)).toBe(true);
            const backendBadges = parsed.badges.map(pickCompared);
            expect(backendBadges).toEqual(adminBadges);
        }
    );

    it.skipIf(!fs.existsSync(LEARNER_CONFIG))(
        'learner badge-config.ts carries the same defaults (parsed from source)',
        () => {
            const learnerBadges = parseLearnerDefaults(fs.readFileSync(LEARNER_CONFIG, 'utf8'));
            expect(learnerBadges.map((b) => b.id)).toEqual(adminBadges.map((b) => b.id));
            expect(learnerBadges.map(pickCompared)).toEqual(adminBadges);
        }
    );
});
