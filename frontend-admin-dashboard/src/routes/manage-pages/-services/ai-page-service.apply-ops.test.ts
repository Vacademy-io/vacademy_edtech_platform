import { describe, expect, it, vi } from 'vitest';
import { applyOps, type EditOp } from './ai-page-service';
import type { CatalogueConfig } from '../-types/editor-types';

vi.mock('@/lib/auth/axiosInstance', () => ({ default: { post: vi.fn(), get: vi.fn() } }));

// applyOps never inspects colour values, so opaque stand-ins keep raw hex out of the source.
const config = (theme: Record<string, unknown>) =>
    ({
        globalSettings: { mode: 'light', theme },
        pages: [{ id: 'p1', route: 'home', components: [] }],
    }) as unknown as CatalogueConfig;

const themeAfter = (base: CatalogueConfig, ops: EditOp[]) =>
    (applyOps(base, 'p1', ops).globalSettings as Record<string, any>).theme;

describe('applyOps updateGlobalSettings', () => {
    it('merges a theme patch one level, as before, when it carries no palette', () => {
        const base = config({ preset: 'ocean', primaryColor: 'brand-blue', borderRadius: 'rounded' });
        expect(themeAfter(base, [{ op: 'updateGlobalSettings', patch: { theme: { preset: 'rose' } } }])).toEqual({
            preset: 'rose',
            primaryColor: 'brand-blue',
            borderRadius: 'rounded',
        });
    });

    it('merges theme.palette key by key so one colour never drops the others', () => {
        const base = config({
            preset: 'default',
            palette: { text: 'ink-1', primary: 'ink-2', applyToTokens: true },
            contentMaxWidth: 1152,
        });
        const theme = themeAfter(base, [
            { op: 'updateGlobalSettings', patch: { theme: { palette: { primary: 'ink-3', text: null } } } },
            { op: 'updateGlobalSettings', patch: { theme: { palette: { sand: 'sand-1' } } } },
        ]);
        expect(theme).toEqual({
            preset: 'default',
            palette: { primary: 'ink-3', applyToTokens: true, sand: 'sand-1' },
            contentMaxWidth: 1152,
        });
    });

    it('drops a palette left with no colour, like the MCP apply_ops', () => {
        const base = config({ preset: 'default' });
        expect(
            themeAfter(base, [{ op: 'updateGlobalSettings', patch: { theme: { palette: { applyToTokens: true } } } }])
        ).toEqual({ preset: 'default' });
        const coloured = config({ palette: { text: 'ink-1', applyToTokens: true } });
        expect(
            themeAfter(coloured, [{ op: 'updateGlobalSettings', patch: { theme: { palette: { text: null } } } }])
        ).toEqual({});
    });

    it('does not change the config it was given', () => {
        const base = config({ palette: { text: 'ink-1' } });
        themeAfter(base, [{ op: 'updateGlobalSettings', patch: { theme: { palette: { text: 'ink-0' } } } }]);
        expect((base.globalSettings as Record<string, any>).theme.palette).toEqual({ text: 'ink-1' });
    });
});
