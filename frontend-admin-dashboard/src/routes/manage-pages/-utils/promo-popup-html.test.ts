import { describe, expect, it } from 'vitest';
import {
    PROMO_STARTERS,
    buildPromoStarter,
    buttonMarkup,
    escapeHtml,
    hookSnippets,
    splitHtmlAndCss,
} from './promo-popup-html';

const labels = { useCode: 'Use code', copy: 'Copy', endsIn: 'Ends in' };
const source = {
    badge: 'Limited <time>',
    heading: 'Flash "sale"',
    highlight: '50% OFF',
    body: 'Save & learn',
    couponCode: 'SAVE50',
    endDate: '2030-01-01T00:00',
    dismissText: 'No thanks',
    footnote: '*T&C',
    button: { text: 'Grab it', action: 'link', url: 'courses' },
};

describe('promo popup starters', () => {
    it('escapes text and attributes', () => {
        expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
    });

    it.each(PROMO_STARTERS)('%s starter carries the content and the hooks', (kind) => {
        const out = buildPromoStarter(kind, source, labels);
        const { html, css } = splitHtmlAndCss(out);
        expect(css).toContain('.pp-cta');
        expect(html).toContain('Flash &quot;sale&quot;');
        expect(html).toContain('Limited &lt;time&gt;');
        expect(html).toContain('data-vacademy="copy" data-target="SAVE50"');
        expect(html).toContain('data-vacademy="countdown"');
        expect(html).toContain('data-vacademy="route" data-route="courses"');
        expect(html).toContain('data-vacademy="close"');
        expect(html).not.toContain('<style');
    });

    it('leaves out the parts that are empty', () => {
        const out = buildPromoStarter('simple', { heading: 'Hi' }, labels);
        expect(out).not.toContain('pp-code"');
        expect(out).not.toContain('data-vacademy="countdown"');
        expect(out).not.toContain('pp-cta"');
        expect(out).not.toContain('data-vacademy="close"');
    });

    it('maps each button action to its hook', () => {
        expect(buttonMarkup({ text: 'Go', action: 'openForm', audienceId: 'a1' }, 'b')).toContain('data-vacademy="lead-form" data-audience="a1"');
        expect(buttonMarkup({ text: 'Go', action: 'whatsapp', whatsappPhone: '+91 98765', whatsappMessage: 'hi there' }, 'b')).toContain(
            'href="https://wa.me/9198765?text=hi%20there"'
        );
        expect(buttonMarkup({ text: 'Go', url: 'https://x.com' }, 'b')).toContain('data-vacademy="link" data-href="https://x.com"');
        expect(buttonMarkup({ text: 'Go', url: '/about' }, 'b')).toContain('data-route="about"');
        expect(buttonMarkup({ text: '' }, 'b')).toBe('');
    });

    it('fills the form snippet with the picked campaign', () => {
        expect(hookSnippets({ audienceId: 'c9' }).form).toContain('data-audience="c9"');
        expect(hookSnippets({}).copy).toContain('data-target="SAVE50"');
    });
});
