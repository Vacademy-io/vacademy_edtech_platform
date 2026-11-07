import { describe, expect, it } from 'vitest';
import { cartBackTarget } from './cart-back';

describe('cartBackTarget', () => {
    it('keeps every existing arrival exactly as before', () => {
        // A catalogue basket: back to that catalogue, Course Finder asked for.
        expect(cartBackTarget({ fromSiteCart: false, sawOwnCatalog: false, canGoBack: true, tagName: 'site' })).toBe(
            'siteFinder'
        );
        // No catalogue known, or the visitor browsed this page: its own catalogue.
        expect(cartBackTarget({ fromSiteCart: false, sawOwnCatalog: false, canGoBack: true })).toBe('ownCatalog');
        expect(cartBackTarget({ fromSiteCart: false, sawOwnCatalog: true, canGoBack: true, tagName: 'site' })).toBe(
            'ownCatalog'
        );
    });

    it('returns a site-cart checkout to the page the cart was opened on', () => {
        expect(cartBackTarget({ fromSiteCart: true, sawOwnCatalog: false, canGoBack: true, tagName: 'site' })).toBe(
            'history'
        );
        expect(cartBackTarget({ fromSiteCart: true, sawOwnCatalog: false, canGoBack: true })).toBe('history');
    });

    it("falls back to the site's home (no Course Finder) without in-app history", () => {
        expect(cartBackTarget({ fromSiteCart: true, sawOwnCatalog: false, canGoBack: false, tagName: 'site' })).toBe(
            'siteHome'
        );
        expect(cartBackTarget({ fromSiteCart: true, sawOwnCatalog: false, canGoBack: false })).toBe('ownCatalog');
    });

    it("prefers this page's own catalogue once the visitor has browsed it", () => {
        expect(cartBackTarget({ fromSiteCart: true, sawOwnCatalog: true, canGoBack: true, tagName: 'site' })).toBe(
            'ownCatalog'
        );
    });
});
