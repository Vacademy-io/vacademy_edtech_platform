import { describe, expect, it } from 'vitest';
import type { McpToolCatalogEntry } from '../../../-constants/mcp-server';
import {
    autoEditKeys,
    groupToolsByArea,
    isNeverAutoOn,
    presetKeys,
    withAreaLevel,
} from '../../McpToolAccessList';
import en from '../../../../../../public/locales/en/settingsMcpServer.json';
import hi from '../../../../../../public/locales/hi/settingsMcpServer.json';
import ar from '../../../../../../public/locales/ar/settingsMcpServer.json';
import fr from '../../../../../../public/locales/fr/settingsMcpServer.json';

const tool = (over: Partial<McpToolCatalogEntry>): McpToolCatalogEntry => ({
    name: over.key ?? 'x',
    key: 'x',
    label: 'x',
    description: '',
    mode: 'WRITE',
    area: 'website',
    level: 'edit',
    risk: 'drafts',
    ...over,
});

/** The one area a catalogue groups into. */
const onlyArea = (tools: McpToolCatalogEntry[]) => {
    const [area] = groupToolsByArea(tools);
    if (!area) throw new Error('no area');
    return area;
};

const catalogue: McpToolCatalogEntry[] = [
    tool({ key: 'website_builder', mode: 'READ', level: 'view', risk: null }),
    tool({ key: 'website_builder_edits' }),
    tool({ key: 'design_import' }),
    tool({ key: 'website_data_edits', risk: 'live_additive' }),
];

describe('MCP access: live-additive edits are opt-in', () => {
    const website = onlyArea(catalogue);

    it('the Edit level turns on every edit except the live-additive one', () => {
        const next = withAreaLevel(website, 'edit', []);
        expect(next.sort()).toEqual(['design_import', 'website_builder', 'website_builder_edits']);
        expect(autoEditKeys(website)).not.toContain('website_data_edits');
    });

    it('keeps it when already on, and Off / View remove it', () => {
        const on = ['website_builder', 'website_data_edits'];
        expect(withAreaLevel(website, 'edit', on)).toContain('website_data_edits');
        expect(withAreaLevel(website, 'view', on)).toEqual(['website_builder']);
        expect(withAreaLevel(website, 'off', on)).toEqual([]);
    });

    it('an area with only opt-in edits still has something to turn on', () => {
        const only = onlyArea([
            tool({ key: 'v', mode: 'READ', level: 'view', risk: null, area: 'a' }),
            tool({ key: 'e', risk: 'live_additive', area: 'a' }),
        ]);
        expect(autoEditKeys(only)).toEqual(['e']);
    });

    it('every locale names the risk', () => {
        for (const locale of [en, hi, ar, fr]) {
            expect(typeof locale.tools.risk.live_additive).toBe('string');
            expect(locale.tools.risk.live_additive.length).toBeGreaterThan(0);
        }
    });
});

describe('MCP access: outbound edits (call or message leads) are always opt-in', () => {
    const calls = onlyArea([
        tool({ key: 'crm_calls', mode: 'READ', level: 'view', risk: null, area: 'crm_calls' }),
        tool({ key: 'crm_calling_outbound', risk: 'outbound', area: 'crm_calls' }),
        tool({ key: 'crm_ai_campaigns', risk: 'outbound', area: 'crm_calls' }),
    ]);
    // Even without the server's opt_in flag (an older catalogue), the risk alone keeps it off.
    const mixed = onlyArea([
        tool({ key: 'v', mode: 'READ', level: 'view', risk: null, area: 'm' }),
        tool({ key: 'notes', risk: 'live_additive', area: 'm' }),
        tool({ key: 'send', risk: 'outbound', area: 'm' }),
    ]);

    it("the Edit level never turns one on, even when it is the area's only kind of edit", () => {
        expect(autoEditKeys(calls)).toEqual([]);
        expect(withAreaLevel(calls, 'edit', [])).toEqual(['crm_calls']);
        expect(autoEditKeys(mixed)).toEqual(['notes']);
        expect(withAreaLevel(mixed, 'edit', []).sort()).toEqual(['notes', 'v']);
    });

    it('a single outbound edit is not turned on by the Edit level either', () => {
        const single = onlyArea([
            tool({ key: 'crm_messages', mode: 'READ', level: 'view', risk: null, area: 's' }),
            tool({ key: 'crm_messaging_outbound', risk: 'outbound', area: 's' }),
        ]);
        expect(autoEditKeys(single)).toEqual([]);
        expect(withAreaLevel(single, 'edit', [])).toEqual(['crm_messages']);
    });

    it('"Turn everything on" leaves it as it is; View / Off turn it off', () => {
        expect(presetKeys([calls], ['crm_calls']).everything).toEqual(['crm_calls']);
        const on = ['crm_calls', 'crm_calling_outbound'];
        expect(presetKeys([calls], on).everything).toContain('crm_calling_outbound');
        expect(presetKeys([calls], on).everything).not.toContain('crm_ai_campaigns');
        expect(withAreaLevel(calls, 'view', on)).toEqual(['crm_calls']);
        expect(withAreaLevel(calls, 'off', on)).toEqual([]);
    });

    it('is never seeded in bulk', () => {
        expect(isNeverAutoOn(tool({ key: 'x', risk: 'outbound' }))).toBe(true);
        expect(isNeverAutoOn(tool({ key: 'x', risk: 'live' }))).toBe(false);
        expect(isNeverAutoOn(tool({ key: 'x', risk: 'live', opt_in: true }))).toBe(true);
    });

    it('every locale names the risk and the per-switch hint', () => {
        for (const locale of [en, hi, ar, fr]) {
            expect(typeof locale.tools.risk.outbound).toBe('string');
            expect(locale.tools.risk.outbound.length).toBeGreaterThan(0);
            expect(typeof locale.tools.eachOnItsOwn).toBe('string');
            expect(locale.tools.eachOnItsOwn.length).toBeGreaterThan(0);
        }
    });
});
