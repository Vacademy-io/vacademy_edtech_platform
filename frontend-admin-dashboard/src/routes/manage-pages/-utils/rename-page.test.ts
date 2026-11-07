import { describe, expect, it } from 'vitest';
import { renamePageInConfig } from './rename-page';

type Nav = { layout: { header: { props: { navigation: Array<{ route: string }> } } } };
type Hero = {
    title: string;
    button: { target: string };
    slots: Array<Array<{ props: { url: string } }>>;
};

const config = () =>
    ({
        globalSettings: {
            layout: {
                header: {
                    props: {
                        navigation: [
                            { label: 'Courses', route: 'books-copy' },
                            { label: 'Books', route: 'books' },
                        ],
                    },
                },
            },
        },
        pages: [
            { id: 'home', route: 'home', title: 'Home', components: [] },
            { id: 'books', route: 'books', title: 'Books', components: [] },
            {
                id: 'copy',
                route: 'books-copy',
                title: 'Books & Kits (Copy)',
                components: [
                    {
                        id: 'hero',
                        type: 'hero',
                        props: {
                            title: 'books-copy',
                            button: { target: '/books-copy#plans' },
                            slots: [
                                [
                                    {
                                        id: 'b',
                                        type: 'button',
                                        props: { url: 'books-copy?stream=a' },
                                    },
                                ],
                            ],
                        },
                    },
                ],
            },
        ],
    }) as never;

describe('renamePageInConfig', () => {
    it('renames the title and moves links that pointed at the old slug', () => {
        const out = renamePageInConfig(config(), 'copy', 'Courses', 'courses');
        const page = out.pages.find((p) => p.id === 'copy')!;
        expect(page.title).toBe('Courses');
        expect(page.route).toBe('courses');
        const nav = (out.globalSettings as Nav).layout.header.props.navigation;
        expect(nav.map((n) => n.route)).toEqual(['courses', 'books']);
        const hero = page.components[0]!.props as Hero;
        expect(hero.button.target).toBe('/courses#plans');
        expect(hero.slots[0]?.[0]?.props.url).toBe('courses?stream=a');
        // Text that merely equals the slug is not a link.
        expect(hero.title).toBe('books-copy');
    });

    it('keeps the home slug and refuses a taken one', () => {
        const home = renamePageInConfig(config(), 'home', 'Welcome', 'start');
        expect(home.pages[0]).toMatchObject({ title: 'Welcome', route: 'home' });
        const c = config();
        expect(renamePageInConfig(c, 'copy', 'X', 'books')).toBe(c);
    });
});
