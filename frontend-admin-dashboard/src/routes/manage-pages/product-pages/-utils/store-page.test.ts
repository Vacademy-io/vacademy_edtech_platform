import { describe, expect, it } from 'vitest';
import { distinctInviteCount, findStoreSites } from './store-page';

const site = (tagName: string, globalSettings: unknown) => ({
    tagName,
    catalogueJson: JSON.stringify({ globalSettings, pages: [] }),
});

describe('findStoreSites', () => {
    it('finds every site that checks out through this page', () => {
        const sites = findStoreSites(
            [
                site('main', { siteCart: { enabled: true, storeProductPageCode: 'store-1' } }),
                site('hindi', { siteCart: { enabled: false, storeProductPageCode: ' store-1 ' } }),
                site('other', { siteCart: { enabled: true, storeProductPageCode: 'store-2' } }),
                site('plain', {}),
            ],
            'store-1'
        );
        expect(sites).toEqual([
            { tagName: 'main', cartEnabled: true },
            { tagName: 'hindi', cartEnabled: false },
        ]);
    });

    it('ignores broken JSON, missing settings and an empty code', () => {
        const catalogues = [
            { tagName: 'broken', catalogueJson: '{nope' },
            { tagName: 'empty', catalogueJson: '' },
            { tagName: 'null', catalogueJson: 'null' },
            site('main', { siteCart: { enabled: true, storeProductPageCode: 'store-1' } }),
        ];
        expect(findStoreSites(catalogues, '')).toEqual([]);
        expect(findStoreSites(null, 'store-1')).toEqual([]);
        expect(findStoreSites(catalogues, 'store-1')).toEqual([{ tagName: 'main', cartEnabled: true }]);
    });
});

describe('distinctInviteCount', () => {
    it('counts each invite once and skips rows without one', () => {
        expect(distinctInviteCount([{ inviteId: 'a' }, { inviteId: 'a' }, { inviteId: 'b' }, { inviteId: '' }, {}])).toBe(2);
    });
});
