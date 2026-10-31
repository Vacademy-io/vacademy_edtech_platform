import { describe, expect, it } from 'vitest';
import {
    findLiveRevision,
    getDraftStaleness,
    liveChangedSinceOpened,
    needsHistoryForStaleness,
    sameCatalogueJson,
} from './draft-staleness';
import type { CatalogueMeta, CatalogueRevision } from '../-services/catalogue-service';

const LIVE = '{"pages": [{"id": "home", "title": "होम"}], "globalSettings": {}}';
const SAME_AS_JS = JSON.stringify(JSON.parse(LIVE));
const OLD = '{"pages":[{"id":"home","title":"Old"}],"globalSettings":{}}';

const meta = (over: Partial<CatalogueMeta> = {}): CatalogueMeta => ({
    id: 'cat-1',
    catalogue_json: LIVE,
    status: 'ACTIVE',
    ...over,
});
const draft = (over: Partial<CatalogueRevision> = {}): CatalogueRevision => ({
    id: 'd',
    revision_no: 1,
    status: 'DRAFT',
    created_at: '2026-10-09T15:00:28Z',
    catalogue_json: OLD,
    ...over,
});
const published = (id: string, no: number, updatedAt: string): CatalogueRevision => ({
    id,
    revision_no: no,
    status: 'PUBLISHED',
    updated_at: updatedAt,
});

describe('sameCatalogueJson', () => {
    it('ignores formatting and key order', () => {
        expect(sameCatalogueJson(LIVE, SAME_AS_JS)).toBe(true);
        expect(sameCatalogueJson('{"a":1,"b":2}', '{"b": 2, "a": 1}')).toBe(true);
        expect(sameCatalogueJson(LIVE, OLD)).toBe(false);
    });
});

describe('findLiveRevision', () => {
    it('is the PUBLISHED revision published last, not the highest number', () => {
        // v1 was a draft promoted after v2–v5 were written directly.
        const live = findLiveRevision([
            published('r5', 5, '2026-10-09T18:00:00Z'),
            { ...draft(), id: 'r6' },
            published('r1', 1, '2026-10-10T09:00:00Z'),
        ]);
        expect(live?.id).toBe('r1');
        expect(findLiveRevision([])).toBeUndefined();
    });
});

describe('getDraftStaleness', () => {
    it('is not stale without a draft', () => {
        expect(getDraftStaleness(null, meta()).stale).toBe(false);
    });

    it('trusts the server flag', () => {
        const s = getDraftStaleness(
            draft({ live_changed_since_draft: true, live_revision_no: 5, live_updated_at: 'x' }),
            meta()
        );
        expect(s).toMatchObject({ stale: true, liveRevisionNo: 5, liveUpdatedAt: 'x' });
        expect(getDraftStaleness(draft({ live_changed_since_draft: false }), meta()).stale).toBe(
            false
        );
    });

    it('falls back to: differs from live AND started before live changed', () => {
        const history = [published('r5', 5, '2026-10-09T18:30:00Z')];
        expect(getDraftStaleness(draft(), meta(), history)).toMatchObject({
            stale: true,
            liveRevisionNo: 5,
        });
        // Started after the live site changed: a normal draft.
        expect(
            getDraftStaleness(draft({ created_at: '2026-10-10T00:00:00Z' }), meta(), history).stale
        ).toBe(false);
        // Same content as live (only formatting differs): nothing to lose.
        expect(
            getDraftStaleness(draft({ catalogue_json: SAME_AS_JS }), meta(), history).stale
        ).toBe(false);
        // meta.updated_at, when the API sends it, wins over history.
        expect(
            getDraftStaleness(draft(), meta({ updated_at: '2026-10-01T00:00:00Z' }), history).stale
        ).toBe(false);
    });

    it('is not stale while the live time is unknown', () => {
        expect(getDraftStaleness(draft(), meta(), undefined).stale).toBe(false);
    });
});

describe('needsHistoryForStaleness', () => {
    it('asks for history only when the client check needs it', () => {
        expect(needsHistoryForStaleness(draft(), meta())).toBe(true);
        expect(needsHistoryForStaleness(null, meta())).toBe(false);
        expect(needsHistoryForStaleness(draft({ live_changed_since_draft: true }), meta())).toBe(
            false
        );
        expect(
            needsHistoryForStaleness(draft(), meta({ updated_at: '2026-10-01T00:00:00Z' }))
        ).toBe(false);
        expect(needsHistoryForStaleness(draft({ catalogue_json: SAME_AS_JS }), meta())).toBe(false);
    });
});

describe('liveChangedSinceOpened', () => {
    const NEWER = '{"pages":[{"id":"home","title":"Newer"}],"globalSettings":{}}';

    it('is stale when the live JSON moved on and the editor is not showing it', () => {
        const result = liveChangedSinceOpened(LIVE, meta({ catalogue_json: NEWER }), OLD, [
            published('r6', 6, '2026-10-10T09:00:00Z'),
        ]);
        expect(result).toMatchObject({ stale: true, sinceOpened: true, liveRevisionNo: 6 });
    });

    it('ignores formatting-only re-publishes and an editor already showing the new live', () => {
        expect(liveChangedSinceOpened(LIVE, meta({ catalogue_json: SAME_AS_JS }), OLD).stale).toBe(
            false
        );
        expect(liveChangedSinceOpened(LIVE, meta({ catalogue_json: NEWER }), NEWER).stale).toBe(
            false
        );
        expect(liveChangedSinceOpened(undefined, meta({ catalogue_json: NEWER }), OLD).stale).toBe(
            false
        );
    });
});
