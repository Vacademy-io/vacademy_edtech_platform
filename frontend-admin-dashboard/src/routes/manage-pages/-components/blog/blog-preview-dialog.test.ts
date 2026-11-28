import { describe, expect, it } from 'vitest';
import {
    buildBlogPreviewUrl,
    estimateReadingMinutes,
    pickPreviewPlacement,
} from './BlogPreviewDialog';

describe('blog preview address', () => {
    it('prefers a published site, then a dedicated blog page over the home page', () => {
        expect(
            pickPreviewPlacement([
                { tagName: 'draft-site', route: 'blog', status: 'DRAFT' },
                { tagName: 'site', route: '', status: 'ACTIVE' },
                { tagName: 'site', route: 'blog', status: 'ACTIVE' },
            ])
        ).toEqual({ tagName: 'site', route: 'blog', status: 'ACTIVE' });
        expect(pickPreviewPlacement([])).toBeNull();
    });

    it("frames the post's own address in blog preview mode", () => {
        const url = new URL(
            buildBlogPreviewUrl(
                'https://learn.example.com/site',
                { tagName: 'site', route: 'blog', status: 'ACTIVE' },
                'dpsp guide',
                null
            )!
        );
        expect(url.pathname).toBe('/site/blog/dpsp%20guide');
        expect(url.searchParams.get('preview')).toBe('true');
        expect(url.searchParams.get('blogPreview')).toBe('1');
        expect(url.searchParams.has('instituteId')).toBe(false);
    });

    it('uses ?post= on a home-page blog, names the institute on a shared host, and survives a bad base', () => {
        const url = new URL(
            buildBlogPreviewUrl(
                'https://learn.example.com/site',
                { tagName: 'site', route: 'home', status: 'ACTIVE' },
                '',
                'inst-1'
            )!
        );
        expect(url.pathname).toBe('/site');
        expect(url.searchParams.get('post')).toBe('preview');
        expect(url.searchParams.get('instituteId')).toBe('inst-1');
        expect(
            buildBlogPreviewUrl(
                'not a url',
                { tagName: 's', route: 'blog', status: 'ACTIVE' },
                'x',
                null
            )
        ).toBeNull();
    });

    it('estimates reading time from the words, not the markup or stylesheet', () => {
        const words = Array.from({ length: 600 }, () => 'word').join(' ');
        expect(estimateReadingMinutes(`<style>.a{color:red}</style><p>${words}</p>`)).toBe(3);
        expect(estimateReadingMinutes('')).toBe(1);
    });
});
