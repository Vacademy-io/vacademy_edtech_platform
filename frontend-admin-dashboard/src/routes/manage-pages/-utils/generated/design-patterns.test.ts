import { describe, expect, it } from 'vitest';
import generated from './design-patterns.json';
import { buildComponentTemplates } from '../component-templates';

/**
 * design-patterns.json is generated from the learner registry
 * (frontend-learner-dashboard-app/src/routes/$tagName/-ai/design-patterns.ts)
 * by scripts/export-catalogue-schema-catalog.mjs. These pin that the admin
 * copy only names blocks this editor can insert, so a template library or
 * variant label built on it never offers a look the editor cannot place.
 */

interface GeneratedPattern {
    id: string;
    component: string;
    minimal: Record<string, unknown>;
    full?: unknown;
    fullSource?: string;
}

const patterns = generated.patterns as GeneratedPattern[];
const templates = buildComponentTemplates(((key: string, opts?: { defaultValue?: string }) =>
    opts?.defaultValue ?? key) as never);
const templateTypes = new Set(Object.values(templates).map((tpl) => tpl.type));

describe('generated design patterns (admin copy)', () => {
    it('has unique ids', () => {
        const ids = patterns.map((p) => p.id);
        expect(ids.length).toBeGreaterThanOrEqual(30);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('names only blocks the editor has a template for, or site settings', () => {
        const unknown = patterns
            .filter((p) => p.component !== 'globalSettings' && !templateTypes.has(p.component))
            .map((p) => `${p.id} → ${p.component}`);
        expect(unknown).toEqual([]);
    });

    it('takes every full example from the Brahm Varchas fixture', () => {
        for (const p of patterns.filter((x) => x.full !== undefined)) {
            expect(p.fullSource, p.id).toMatch(/^brahm-varchas-site#\//);
        }
    });

    it('recipes reference existing patterns', () => {
        const ids = new Set(patterns.map((p) => p.id));
        for (const recipe of generated.recipes) {
            const named = [...recipe.site, ...recipe.pages.flatMap((page) => page.sections.flatMap((s) => s.patterns))];
            expect(named.filter((id) => !ids.has(id))).toEqual([]);
        }
    });
});
