import { beforeEach, describe, expect, it, vi } from 'vitest';
import { publishDraftRevision, saveDraftRevision } from './catalogue-service';
import type { CatalogueConfig } from '../-types/editor-types';

const post = vi.fn();
vi.mock('@/lib/auth/axiosInstance', () => ({
    default: { post: (...args: unknown[]) => post(...args) },
}));

const CONFIG = { globalSettings: {}, pages: [] } as unknown as CatalogueConfig;

beforeEach(() => {
    post.mockReset();
    post.mockResolvedValue({ data: { id: 'rev-1' } });
});

describe('publishDraftRevision', () => {
    const url = () => post.mock.lastCall![0] as string;

    it('sends no extra parameters by default', async () => {
        await publishDraftRevision('cat-1');
        expect(url().endsWith('/revision/publish?catalogueId=cat-1')).toBe(true);
    });

    it('adds overrideStale and the live version the editor loaded', async () => {
        await publishDraftRevision('cat-1', { overrideStale: true, expectedLiveRevisionNo: 5 });
        expect(url()).toMatch(
            /\/revision\/publish\?catalogueId=cat-1&overrideStale=true&expectedLiveRevisionNo=5$/
        );
    });

    it('leaves out a live version that is not known', async () => {
        await publishDraftRevision('cat-1', { expectedLiveRevisionNo: null });
        expect(url()).not.toContain('expectedLiveRevisionNo');
        await publishDraftRevision('cat-1', { expectedLiveRevisionNo: 0 });
        expect(url()).toContain('&expectedLiveRevisionNo=0');
    });
});

describe('saveDraftRevision', () => {
    const body = () => post.mock.lastCall![1] as Record<string, unknown>;

    it('sends MANUAL by default', async () => {
        await saveDraftRevision('cat-1', CONFIG);
        expect(body()).toMatchObject({ catalogue_json: JSON.stringify(CONFIG), source: 'MANUAL' });
    });

    it('leaves source out when null, so the draft keeps its own', async () => {
        await saveDraftRevision('cat-1', CONFIG, null);
        expect(body()).not.toHaveProperty('source');
        expect(body().catalogue_json).toBe(JSON.stringify(CONFIG));
    });
});
