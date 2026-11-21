import { describe, expect, it } from 'vitest';
import {
    fromSitePath,
    isUsableHeaderLink,
    keepMegaMenuItems,
    navItemTypePatch,
    syncNavWithPages,
    toSitePath,
    unknownPatternTokens,
    type HeaderNavItemValue,
} from './header-editor-utils';

describe('toSitePath / fromSitePath', () => {
    it('stores a picked page as a site path and shows it back as the page', () => {
        expect(toSitePath('find-your-path')).toBe('/find-your-path');
        expect(toSitePath('homepage')).toBe('/');
        expect(toSitePath('/courses?stream=shiksha')).toBe('/courses?stream=shiksha');
        expect(fromSitePath('/find-your-path')).toBe('find-your-path');
        expect(fromSitePath('/')).toBe('homepage');
    });

    it('leaves URLs, queries and empty values alone', () => {
        expect(toSitePath('https://example.com/x')).toBe('https://example.com/x');
        expect(toSitePath('  ')).toBe('');
        expect(fromSitePath('/courses?stream=kala')).toBe('/courses?stream=kala');
        expect(fromSitePath('https://example.com')).toBe('https://example.com');
        expect(fromSitePath(undefined)).toBe('');
    });
});

describe('isUsableHeaderLink', () => {
    it('accepts what the live header follows', () => {
        for (const ok of ['', '/', '/courses?stream={stream}', 'https://example.com/a']) {
            expect(isUsableHeaderLink(ok)).toBe(true);
        }
    });

    it('flags what the live header would drop', () => {
        for (const bad of [
            'courses',
            '//evil.example',
            '/\\evil.example',
            'mailto:a@b.c',
            'javascript:x',
            'https://',
        ]) {
            expect(isUsableHeaderLink(bad)).toBe(false);
        }
    });
});

describe('unknownPatternTokens', () => {
    it('lists placeholders the pattern cannot fill', () => {
        expect(
            unknownPatternTokens('/courses?stream={stream}&c={category}', ['stream', 'category'])
        ).toEqual([]);
        expect(unknownPatternTokens('/s/{strem}/{stream}/{x}{x}', ['stream'])).toEqual([
            'strem',
            'x',
        ]);
        expect(unknownPatternTokens(undefined, ['stream'])).toEqual([]);
    });
});

describe('keepMegaMenuItems', () => {
    const page = (label: string): HeaderNavItemValue => ({ label, route: label.toLowerCase() });
    const mega = (label: string): HeaderNavItemValue => ({
        label,
        route: '',
        type: 'megaMenu',
        megaMenu: { libraryId: 'lib' },
    });

    it('keeps each mega-menu item at its old position in the synced list', () => {
        const streams = mega('Knowledge Streams');
        const synced = keepMegaMenuItems(
            [streams, page('Old'), page('About')],
            [page('Home'), page('Courses'), page('About')]
        );
        expect(synced.map((i) => i.label)).toEqual([
            'Knowledge Streams',
            'Home',
            'Courses',
            'About',
        ]);
        // The very same object: label, route and the whole menu config survive.
        expect(synced[0]).toBe(streams);
    });

    it('keeps several in their order, clamping positions past the end', () => {
        const a = mega('A');
        const b = mega('B');
        expect(
            keepMegaMenuItems([page('X'), a, page('Y'), page('Z'), b], [page('Home')]).map(
                (i) => i.label
            )
        ).toEqual(['Home', 'A', 'B']);
    });

    it('is the plain page list when there is no mega-menu item', () => {
        const fromPages = [page('Home'), page('About')];
        expect(
            keepMegaMenuItems([page('Old'), { ...page('Typed'), type: 'link' }], fromPages)
        ).toEqual(fromPages);
        expect(keepMegaMenuItems(undefined, fromPages)).toEqual(fromPages);
    });
});

describe('syncNavWithPages', () => {
    const pages = [
        { id: 'home', route: 'home', title: 'Home' },
        { id: 'courses', route: 'courses', title: 'Courses' },
        { id: 'learning-paths', route: 'learning-paths', title: 'Learning Paths' },
    ];
    const mega: HeaderNavItemValue = {
        label: 'Knowledge Streams',
        route: '/courses',
        type: 'megaMenu',
    };
    const courses: HeaderNavItemValue = {
        label: 'All courses',
        route: 'courses',
        openInSameTab: true,
    };
    const paths: HeaderNavItemValue = { label: 'Paths', route: '/learning-paths', enabled: false };
    const resources: HeaderNavItemValue = {
        label: 'Resources',
        route: 'https://example.org/blogs/',
    };
    const filtered: HeaderNavItemValue = { label: 'Shiksha', route: '/courses?stream=shiksha' };

    it('adds the missing page and keeps mega menus, external and filtered links in place', () => {
        const synced = syncNavWithPages([mega, courses, paths, resources, filtered], pages);
        expect(synced.map((i) => i.label)).toEqual([
            'Knowledge Streams',
            'Home',
            'All courses',
            'Paths',
            'Resources',
            'Shiksha',
        ]);
        // Existing page links are the same objects: custom label and hidden flag survive.
        expect(synced[2]).toBe(courses);
        expect(synced[3]).toBe(paths);
        expect(synced[0]).toBe(mega);
        expect(synced[4]).toBe(resources);
        expect(synced[1]).toEqual({ label: 'Home', route: 'homepage', openInSameTab: true });
    });

    it('drops a visible link to an unpublished page, and matches home by any of its routes', () => {
        const home: HeaderNavItemValue = { label: 'Start', route: '/' };
        const draft: HeaderNavItemValue = { label: 'Draft', route: 'learning-paths' };
        const synced = syncNavWithPages(
            [home, draft, resources],
            [...pages.slice(0, 2), { ...pages[2]!, published: false }]
        );
        expect(synced.map((i) => i.label)).toEqual(['Start', 'Courses', 'Resources']);
        expect(synced[0]).toBe(home);
    });

    it('keeps a link with an empty route where it is and still adds Home', () => {
        const contact: HeaderNavItemValue = { label: 'Contact', route: '' };
        const synced = syncNavWithPages([contact, courses], pages.slice(0, 2));
        expect(synced.map((i) => i.label)).toEqual(['Contact', 'Home', 'All courses']);
        expect(synced[0]).toBe(contact);
    });

    it('keeps internal links that are not pages (a blog post, a course)', () => {
        const post: HeaderNavItemValue = { label: 'Post', route: '/blog/my-post' };
        const course: HeaderNavItemValue = { label: 'NCLEX', route: 'course/abc' };
        const synced = syncNavWithPages([post, course, courses], pages.slice(0, 2));
        expect(synced.map((i) => i.label)).toEqual(['Post', 'NCLEX', 'Home', 'All courses']);
        expect(synced[0]).toBe(post);
        expect(synced[1]).toBe(course);
    });

    it('keeps a hidden link to an unpublished page as it is', () => {
        const synced = syncNavWithPages(
            [courses, paths],
            [...pages.slice(0, 2), { ...pages[2]!, published: false }]
        );
        expect(synced.map((i) => i.label)).toEqual(['Home', 'All courses', 'Paths']);
        expect(synced[2]).toBe(paths);
    });

    it('builds the plain page list for an empty nav and leaves unpublished pages out', () => {
        expect(
            syncNavWithPages(undefined, [
                ...pages,
                { id: 'draft', route: 'draft', published: false },
            ]).map((i) => i.route)
        ).toEqual(['homepage', 'courses', 'learning-paths']);
    });

    it('a renamed page: the old link (it would 404) gives way to the new route', () => {
        const about: HeaderNavItemValue = { label: 'About', route: 'about' };
        const synced = syncNavWithPages(
            [{ label: 'Home', route: 'homepage' }, about],
            [pages[0]!, { id: 'about', route: 'about-us', title: 'About' }]
        );
        expect(synced.map((i) => `${i.label}→${i.route}`)).toEqual(['Home→homepage', 'About→about-us']);
    });

    it('a deleted page: its link goes; app routes, hidden and deeper links stay', () => {
        const events: HeaderNavItemValue = { label: 'Events', route: '/events' };
        const login: HeaderNavItemValue = { label: 'Log in', route: '/login' };
        const allCourses: HeaderNavItemValue = { label: 'Catalogue', route: 'courses' };
        const hiddenOld: HeaderNavItemValue = { label: 'Old', route: 'old-page', enabled: false };
        const post: HeaderNavItemValue = { label: 'Post', route: 'blog/first-post' };
        const synced = syncNavWithPages(
            [{ label: 'Home', route: 'home' }, events, login, allCourses, hiddenOld, post],
            [pages[0]!]
        );
        expect(synced.map((i) => i.label)).toEqual(['Home', 'Log in', 'Catalogue', 'Old', 'Post']);
    });

    it('is unchanged when the nav already lists every page', () => {
        const nav = [mega, { label: 'Home', route: 'homepage' }, courses, paths, resources];
        expect(syncNavWithPages(nav, pages)).toEqual(nav);
    });
});

describe('navItemTypePatch', () => {
    it('starts a mega menu with the legend on, and keeps an earlier config', () => {
        expect(navItemTypePatch({ label: 'Streams', route: '' }, 'megaMenu')).toEqual({
            type: 'megaMenu',
            megaMenu: { showLegend: true },
        });
        const kept = { libraryId: 'lib', eyebrow: 'Six streams' };
        expect(
            navItemTypePatch({ label: 'Streams', route: '', megaMenu: kept }, 'megaMenu')
        ).toEqual({
            type: 'megaMenu',
            megaMenu: kept,
        });
        expect(navItemTypePatch({ label: 'Streams', route: '', megaMenu: kept }, 'link')).toEqual({
            type: 'link',
        });
    });
});
