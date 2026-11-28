// @vitest-environment jsdom
/**
 * The shop's content blocks (ContentSections.tsx) rendered through CommerceSectionView, as an
 * authored page places them: what each shows for good props, that bad props render nothing,
 * that links stay safe, the heritage preset class, and that the lead form validates and sends
 * through the site's lead pipeline.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const router = vi.hoisted(() => ({
    location: { pathname: '/', search: '', hash: '', searchStr: '' },
    navigate: [] as string[],
}));
const leads = vi.hoisted(() => ({ sent: [] as unknown[], phoneOnly: [] as unknown[], fail: false }));

vi.mock('@tanstack/react-router', () => ({
    useRouter: () => ({
        history: { location: router.location, replace: () => undefined },
        navigate: ({ href }: { href: string }) => {
            router.navigate.push(href);
            return Promise.resolve();
        },
        latestLocation: { search: {} },
    }),
    useNavigate: () => () => Promise.resolve(),
    useLocation: (opts?: { select?: (location: unknown) => unknown }) => (opts?.select ? opts.select(router.location) : router.location),
    useParams: () => ({}),
}));

vi.mock('../../../-utils/website-lead', () => ({
    submitWebsiteLead: async (payload: unknown) => {
        if (leads.fail) throw new Error('offline');
        leads.sent.push(payload);
        return { ok: true, duplicate: false };
    },
    isSpamSubmission: () => false,
}));

vi.mock('../api/lead', () => ({
    submitPhoneOnlyLead: async (payload: unknown) => {
        if (leads.fail) throw new Error('offline');
        leads.phoneOnly.push(payload);
    },
}));

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CommerceSectionView, COMMERCE_SECTION_TYPES } from './Sections';
import { CommerceSiteProvider } from './site';
import { en } from '../i18n/messages.en';
import { hi } from '../i18n/messages.hi';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const KEY = `vak_pub_${'a1'.repeat(24)}`;
const settings = (extra: Record<string, unknown> = {}) => ({
    commerce: { enabled: true, publishableKey: KEY, whatsappNumber: '+919876543210', ...extra },
});

let root: Root | null = null;

const render = async (type: string, props: Record<string, unknown>, globalSettings: unknown = settings()) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const container = document.createElement('div');
    container.setAttribute('data-catalogue-theme', 'default');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
        root!.render(
            <QueryClientProvider client={client}>
                <CommerceSiteProvider instituteId="inst-1" tagName="shop" globalSettings={globalSettings}>
                    <CommerceSectionView type={type} props={props} />
                </CommerceSiteProvider>
            </QueryClientProvider>
        );
    });
    return container;
};

const text = () => document.body.textContent || '';
const links = () => Array.from(document.querySelectorAll('a')).map((a) => a.getAttribute('href'));

const typeInto = async (input: Element | null, value: string) => {
    expect(input).toBeTruthy();
    await act(async () => {
        const el = input as HTMLInputElement;
        const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')!.set!;
        setter.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
    });
};
const submit = async (form: Element | null) => {
    await act(async () => {
        (form as HTMLFormElement).requestSubmit();
    });
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
    });
};

beforeEach(() => {
    router.navigate.length = 0;
    leads.sent.length = 0;
    leads.phoneOnly.length = 0;
    leads.fail = false;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
        const url = new URL(String(input));
        const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
        if (url.pathname.endsWith('/catalog/v1/categories')) {
            return json({
                data: [{ slug: 'sarees', kind: 'CATEGORY', name: 'साड़ियाँ', description: null, image_url: null, path: '/c/sarees', position: 0, product_count: 5, in_stock_count: 5, children: [] }],
                locale: 'hi',
            });
        }
        return new Response('{}', { status: 404 });
    });
});

afterEach(async () => {
    await act(async () => root?.unmount());
    root = null;
    document.body.innerHTML = '';
    document.head.innerHTML = '';
    vi.unstubAllGlobals();
});

describe('content blocks', () => {
    it('are registered as commerce section types', () => {
        for (const type of [
            'commerceAnnouncementBar',
            'commerceHero',
            'commerceImpactBand',
            'commerceStoryCards',
            'commerceLocationCards',
            'commerceRecognitionStrip',
            'commerceFeature',
            'commercePartnerTracks',
            'commerceSteps',
            'commerceReviews',
            'commerceFaq',
            'commerceTextBlock',
            'commerceContactPanel',
            'commerceLeadForm',
            'commerceWhatsAppButton',
            'commerceNotFound',
        ]) {
            expect(COMMERCE_SECTION_TYPES).toContain(type);
        }
    });

    it('hero: one H1, the photo loaded first, buttons and figures', async () => {
        await render('commerceHero', {
            eyebrow: 'Handloom',
            title: 'Handwoven at Workshop 1',
            text: 'Cotton sarees from Varanasi.',
            image: 'https://cdn.example/hero.webp',
            caption: 'Real photo',
            primary: { label: 'Shop now', route: 'shop' },
            secondary: { label: 'Our story', route: 'javascript:alert(1)' },
            stats: [{ value: '12', label: 'workshops' }, { value: '', label: 'ignored' }],
        });
        expect(document.querySelectorAll('h1')).toHaveLength(1);
        expect(document.querySelector('h1')?.textContent).toBe('Handwoven at Workshop 1');
        const img = document.querySelector('img');
        expect(img?.getAttribute('loading')).toBe('eager');
        expect(text()).toContain('Real photo');
        expect(text()).toContain('12workshops');
        expect(text()).not.toContain('ignored');
        // The script link is dropped, the site link kept.
        expect(links()).toEqual(['/shop/shop']);
    });

    it('hero without a title renders nothing', async () => {
        const container = await render('commerceHero', { image: 'https://cdn.example/hero.webp' });
        expect(container.querySelector('.cmx-hero')).toBeNull();
    });

    it('impact band: figures as written, with the date they were checked', async () => {
        await render('commerceImpactBand', {
            title: 'Our reach',
            items: [{ value: '120+', label: 'makers' }, { value: '40', label: 'looms' }],
            updatedNote: 'Figures as of Nov 2026',
        });
        expect(text()).toContain('120+makers');
        expect(text()).toContain('Figures as of Nov 2026');
        expect(document.querySelector('.cmx-impact--2')).toBeTruthy();
    });

    it('story cards: photo next to the name, links to the story and the shop', async () => {
        await render('commerceStoryCards', {
            title: 'Meet the makers',
            items: [
                { name: 'Asha', place: 'Varanasi', craft: 'Handloom', quote: 'I weave at home.', image: 'https://cdn.example/a.webp', route: 'makers#asha', routeLabel: 'Read more', shopRoute: 'c/sarees', shopLabel: 'Shop the range' },
                { place: 'no name, dropped' },
            ],
        });
        expect(document.querySelectorAll('article')).toHaveLength(1);
        expect(document.querySelector('img')?.getAttribute('alt')).toBe('Asha');
        expect(text()).toContain('Varanasi · Handloom');
        expect(text()).toContain('“I weave at home.”');
        expect(links()).toEqual(['/shop/makers#asha', '/shop/c/sarees']);
    });

    it('location cards: grouped by region, with WhatsApp, directions and call only where data exists', async () => {
        await render('commerceLocationCards', {
            title: 'Our workshops',
            layout: 'cards',
            items: [
                { name: 'Workshop 1', region: 'Uttar Pradesh', address: 'Workshop 1, Varanasi', phone: '+91 98765 43210' },
                { name: 'Workshop 2', region: 'Bihar', mapUrl: 'https://maps.example/w2', shopRoute: 'c/sarees' },
            ],
        });
        expect(document.querySelectorAll('details.cmx-region')).toHaveLength(2);
        expect(document.querySelector('details.cmx-region')?.hasAttribute('open')).toBe(true);
        const hrefs = links();
        expect(hrefs).toContain('tel:+919876543210');
        expect(hrefs).toContain('https://maps.example/w2');
        expect(hrefs).toContain('https://www.google.com/maps/search/?api=1&query=Workshop%201%2C%20Varanasi');
        expect(hrefs.filter((h) => h?.startsWith('https://wa.me/919876543210'))).toHaveLength(2);
        expect(hrefs.filter((h) => h?.startsWith('tel:'))).toHaveLength(1);
        expect(hrefs).toContain('/shop/c/sarees');
    });

    it('location chips: names only, with the link to the full page', async () => {
        await render('commerceLocationCards', {
            layout: 'chips',
            cta: { label: 'See all', route: 'workshops' },
            items: [{ name: 'Workshop 1' }, { name: 'Workshop 2' }],
        });
        expect(document.querySelectorAll('.cmx-chip')).toHaveLength(2);
        expect(links()).toEqual(['/shop/workshops']);
    });

    it('recognition strip: editorial items and outlets, no prices or buy buttons', async () => {
        await render('commerceRecognitionStrip', {
            title: 'Visits & press',
            items: [{ text: 'A visit by the district team', date: '2024' }],
            outlets: ['Daily Example', 'Example Times'],
        });
        expect(text()).toContain('2024A visit by the district team');
        expect(text()).toContain('Example Times');
        expect(document.querySelector('.cmx-btn, .cmx-price')).toBeNull();
    });

    it('feature: a video is only a link over the photo, nothing plays or loads first', async () => {
        await render('commerceFeature', {
            title: 'How it is made',
            text: 'Spun, sized, woven.',
            image: 'https://cdn.example/loom.webp',
            videoUrl: 'https://video.example/loom',
            videoLabel: 'At the loom',
            quote: 'Made slowly, by hand.',
            cta: { label: 'Read more', route: 'our-story' },
        });
        expect(document.querySelector('video, iframe')).toBeNull();
        const play = document.querySelector('a.cmx-play');
        expect(play?.getAttribute('href')).toBe('https://video.example/loom');
        expect(play?.getAttribute('target')).toBe('_blank');
        expect(play?.getAttribute('aria-label')).toContain('At the loom');
        expect(document.querySelector('blockquote')?.textContent).toBe('Made slowly, by hand.');
    });

    it('partner tracks: anchored cards with points and a button', async () => {
        await render('commercePartnerTracks', {
            items: [
                { anchor: 'bulk', title: 'Bulk orders', points: ['Events', 'Gifting'], ctaLabel: 'Get a quote', ctaRoute: '#apply' },
                { anchor: 'csr', title: 'Sponsor a workshop' },
            ],
        });
        expect(document.getElementById('bulk')).toBeTruthy();
        expect(document.getElementById('csr')).toBeTruthy();
        expect(document.querySelectorAll('.cmx-points li')).toHaveLength(2);
        expect(links()).toEqual(['#apply']);
    });

    it('steps, reviews and FAQ render their items and skip empty ones', async () => {
        await render('commerceSteps', { items: [{ title: 'Order' }, { text: 'no title' }, { title: 'Dispatch' }] });
        expect(document.querySelectorAll('ol > li')).toHaveLength(2);
        await act(async () => root?.unmount());
        document.body.innerHTML = '';

        await render('commerceReviews', { items: [{ quote: 'Lovely cloth.', name: 'R. K.', product: 'Dhoti', rating: 5 }, { name: 'no quote' }] });
        expect(document.querySelectorAll('figure')).toHaveLength(1);
        expect(document.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('5 में से 5 रेटिंग');
        await act(async () => root?.unmount());
        document.body.innerHTML = '';

        await render('commerceFaq', { items: [{ question: 'COD?', answer: 'Not yet.' }, { question: 'No answer' }] });
        expect(document.querySelectorAll('details')).toHaveLength(1);
        expect(text()).toContain('COD?Not yet.');
    });

    it('text block: a policy table and sections with anchors', async () => {
        await render('commerceTextBlock', {
            title: 'Shipping & returns',
            level: 1,
            table: { head: ['What', 'When'], rows: [['Dispatch', '3–5 days']] },
            sections: [{ anchor: 'returns', heading: 'Returns', items: ['Photo within 2 days'] }],
            updatedNote: 'Last changed: Nov 2026',
        });
        expect(document.querySelector('h1')?.textContent).toBe('Shipping & returns');
        expect(document.querySelectorAll('tbody tr')).toHaveLength(1);
        expect(document.getElementById('returns')).toBeTruthy();
        expect(text()).toContain('Last changed: Nov 2026');
    });

    it('contact panel: WhatsApp from the shop number, call, email and details', async () => {
        await render('commerceContactPanel', {
            title: 'Talk to us',
            level: 1,
            phone: '+91 98765 43210',
            email: 'care@example.org',
            whatsappMessage: 'Namaste',
            details: [{ label: 'GSTIN', value: '[to confirm]' }],
        });
        const hrefs = links();
        expect(hrefs[0]).toBe('https://wa.me/919876543210?text=Namaste');
        expect(hrefs).toContain('tel:+919876543210');
        expect(hrefs).toContain('mailto:care@example.org');
        expect(text()).toContain('GSTIN[to confirm]');
        // On a contact page it can be the page's heading.
        expect(document.querySelector('h1')?.textContent).toBe('Talk to us');
    });

    it('announcement bar and WhatsApp button have no section padding; the bar keeps to its dates', async () => {
        const bar = await render('commerceAnnouncementBar', { text: 'Free delivery above ₹999', route: 'policies' });
        expect(bar.querySelector('.cmx-section')).toBeNull();
        expect(text()).toContain('Free delivery above ₹999');
        await act(async () => root?.unmount());
        document.body.innerHTML = '';

        await render('commerceAnnouncementBar', { text: 'Old sale', endDate: '2020-01-01' });
        expect(text()).not.toContain('Old sale');
        await act(async () => root?.unmount());
        document.body.innerHTML = '';

        await render('commerceWhatsAppButton', { message: 'Hi' });
        expect(document.querySelector('a.cmx-fab')?.getAttribute('href')).toBe('https://wa.me/919876543210?text=Hi');
        await act(async () => root?.unmount());
        document.body.innerHTML = '';

        // Without a shop number there is no button at all.
        await render('commerceWhatsAppButton', {}, settings({ whatsappNumber: '' }));
        expect(document.querySelector('a.cmx-fab')).toBeNull();
    });

    it('wears the heritage preset class and an anchor id on its section', async () => {
        const container = await render('commerceFaq', { anchor: 'faq', items: [{ question: 'Q', answer: 'A' }] }, settings({ theme: { preset: 'heritage' } }));
        const section = container.querySelector('section');
        expect(section?.className).toContain('cmx-preset-heritage');
        expect(section?.id).toBe('faq');
    });

    it('renders nothing on a site without a shop', async () => {
        const container = await render('commerceHero', { title: 'Hello' }, { commerce: { enabled: false } });
        expect(container.innerHTML).toBe('');
    });

    it('not found: search goes to the shop search, chips name real categories', async () => {
        await render('commerceNotFound', { title: 'Page not found', collectionIds: ['sarees', 'missing'] });
        for (let i = 0; i < 20 && !document.querySelector('.cmx-chip'); i += 1) {
            await act(async () => {
                await new Promise((resolve) => setTimeout(resolve, 20));
            });
        }
        expect(document.querySelectorAll('.cmx-chip')).toHaveLength(1);
        expect(document.head.querySelector('meta[name="robots"]')?.getAttribute('content')).toContain('noindex');
        await typeInto(document.querySelector('input[type="search"]'), 'pooja');
        await submit(document.querySelector('form[role="search"]'));
        expect(router.navigate).toEqual(['/shop/search?q=pooja']);
    });
});

describe('lead form', () => {
    it('shows field errors and sends nothing until name and a valid mobile are given', async () => {
        await render('commerceLeadForm', { title: 'Reseller application', fields: ['city', 'message'], roles: ['Shop', 'Online'], audienceId: 'aud-1', sourceKey: 'reseller' });
        expect(document.querySelectorAll('input:not(.cmx-hp), textarea')).toHaveLength(4);
        await submit(document.querySelector('form'));
        expect(document.querySelectorAll('[role="alert"]')).toHaveLength(2);
        expect(document.querySelector('input[name="phone"]')?.getAttribute('aria-invalid')).toBe('true');
        expect(leads.sent).toHaveLength(0);
        expect(leads.phoneOnly).toHaveLength(0);
    });

    it('a phone-only lead goes to the named campaign: name and phone only, no e-mail asked', async () => {
        await render('commerceLeadForm', { fields: ['email', 'city'], audienceId: 'aud-1', sourceKey: 'Reseller form' });
        expect([hi['lead.email'], en['lead.email']].some((label) => text().includes(label))).toBe(true);
        await typeInto(document.querySelector('input[name="name"]'), 'Asha');
        await typeInto(document.querySelector('input[name="phone"]'), '98765 43210');
        await typeInto(document.querySelector('input[name="city"]'), 'Varanasi');
        await submit(document.querySelector('form'));
        expect(leads.sent).toHaveLength(0);
        expect(leads.phoneOnly).toEqual([
            { instituteId: 'inst-1', audienceId: 'aud-1', fullName: 'Asha', mobileNumber: '9876543210', sourceType: 'WEBSITE_FORM', sourceId: 'shop:reseller-form' },
        ]);
        expect(document.querySelector('.cmx-note--error')).toBeNull();
    });

    it('without a campaign the e-mail is asked for and required, and the lead goes through the site pipeline', async () => {
        await render('commerceLeadForm', { fields: ['city'], sourceKey: 'contact' });
        expect(document.querySelector('input[name="email"]')).toBeTruthy();
        expect(text()).not.toContain(hi['lead.email']);
        expect(text()).not.toContain(en['lead.email']);
        await typeInto(document.querySelector('input[name="name"]'), 'Asha');
        await typeInto(document.querySelector('input[name="phone"]'), '9876543210');
        await submit(document.querySelector('form'));
        expect(document.querySelector('input[name="email"]')?.getAttribute('aria-invalid')).toBe('true');
        expect(leads.sent).toHaveLength(0);
        await typeInto(document.querySelector('input[name="email"]'), 'asha@example.com');
        await submit(document.querySelector('form'));
        expect(leads.phoneOnly).toHaveLength(0);
        expect(leads.sent).toEqual([
            expect.objectContaining({ audienceId: undefined, email: 'asha@example.com', mobileNumber: '9876543210', sourceId: 'shop:contact' }),
        ]);
    });

    it('with an e-mail: the site lead pipeline, with the role and extra fields', async () => {
        await render('commerceLeadForm', { fields: ['email', 'city'], roles: ['Shop', 'Online'], audienceId: 'aud-1', sourceKey: 'Reseller form', successText: 'We will call you.' });
        await typeInto(document.querySelector('input[name="name"]'), 'Asha');
        await typeInto(document.querySelector('input[name="phone"]'), '+91 98765 43210');
        await typeInto(document.querySelector('input[name="email"]'), 'asha@example.com');
        await typeInto(document.querySelector('input[name="city"]'), 'Varanasi');
        await act(async () => {
            (document.querySelector('[role="radio"]') as HTMLElement).click();
        });
        await submit(document.querySelector('form'));
        expect(leads.sent).toEqual([
            {
                instituteId: 'inst-1',
                audienceId: 'aud-1',
                fullName: 'Asha',
                email: 'asha@example.com',
                mobileNumber: '9876543210',
                sourceType: 'WEBSITE_FORM',
                sourceId: 'shop:reseller-form',
                // CRM field names are the same whatever language the visitor reads.
                customFieldValues: { 'I am a': 'Shop', City: 'Varanasi' },
            },
        ]);
        expect(text()).toContain('We will call you.');
    });

    it('inline variant asks for the phone only, and says so when sending fails', async () => {
        leads.fail = true;
        await render('commerceLeadForm', { variant: 'inline', fields: ['message'], audienceId: 'aud-1', submitLabel: 'Join' });
        expect(document.querySelectorAll('input:not(.cmx-hp), textarea')).toHaveLength(1);
        await typeInto(document.querySelector('input[name="phone"]'), '9876543210');
        await submit(document.querySelector('form'));
        expect(document.querySelector('.cmx-note--error')).toBeTruthy();
    });
});
