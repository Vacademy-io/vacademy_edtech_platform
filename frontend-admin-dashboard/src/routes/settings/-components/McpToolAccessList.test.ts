import { describe, expect, it } from 'vitest';
import type { McpToolCatalogEntry } from '../-constants/mcp-server';
import { areaLevel, groupToolsByArea, presetKeys, withAreaLevel } from './McpToolAccessList';

const tool = (entry: Partial<McpToolCatalogEntry> & { key: string }): McpToolCatalogEntry => ({
    name: entry.key,
    label: entry.key,
    description: '',
    mode: entry.level === 'edit' ? 'WRITE' : 'READ',
    ...entry,
});

const catalogue = [
    tool({ key: 'website_builder', area: 'website', level: 'view', area_order: 0 }),
    tool({
        key: 'website_builder_edits',
        area: 'website',
        level: 'edit',
        risk: 'drafts',
        area_order: 0,
    }),
    tool({ key: 'design_import', area: 'website', level: 'edit', risk: 'drafts', area_order: 0 }),
    tool({
        key: 'website_publish',
        area: 'website',
        level: 'edit',
        risk: 'live',
        opt_in: true,
        area_order: 0,
    }),
    tool({ key: 'blog', area: 'blog', level: 'view', area_order: 1 }),
    tool({ key: 'blog_edits', area: 'blog', level: 'edit', risk: 'drafts', area_order: 1 }),
];
const areas = groupToolsByArea(catalogue);
const website = areas.find((a) => a.key === 'website')!;

describe('opt-in MCP capabilities (website publishing)', () => {
    it('moving an area up to Edit turns its edits on, but never an opt-in one', () => {
        const next = withAreaLevel(website, 'edit', ['website_builder']);
        expect(next).toEqual(
            expect.arrayContaining(['website_builder', 'website_builder_edits', 'design_import'])
        );
        expect(next).not.toContain('website_publish');
        expect(areaLevel(website, next)).toBe('edit');
    });

    it('an admin can still turn it on by itself, and View / Off turn it off', () => {
        const on = ['website_builder', 'website_builder_edits', 'website_publish'];
        expect(areaLevel(website, on)).toBe('edit');
        expect(withAreaLevel(website, 'view', on)).toEqual(['website_builder']);
        expect(withAreaLevel(website, 'off', on)).toEqual([]);
    });

    it('"Turn everything on" leaves it as it is; "View only" turns it off', () => {
        const off = presetKeys(areas, ['website_builder']);
        expect(off.everything).not.toContain('website_publish');
        expect(off.everything).toContain('blog_edits');
        expect(off.all).toContain('website_publish');
        const on = presetKeys(areas, ['website_builder', 'website_publish']);
        expect(on.everything).toContain('website_publish');
        expect(on.viewOnly).toEqual(['website_builder', 'blog']);
    });

    it('catalogues without the flag behave as before', () => {
        const legacy = groupToolsByArea(
            catalogue.map((entry) => ({ ...entry, opt_in: undefined }))
        );
        const next = withAreaLevel(legacy.find((a) => a.key === 'website')!, 'edit', []);
        expect(next).toContain('website_publish');
    });
});
