import { describe, expect, it } from 'vitest';
import { prepareEmail } from './email-html-frame';

describe('prepareEmail', () => {
    it('removes everything that could run or navigate', () => {
        const { html } = prepareEmail(
            '<html><head><meta http-equiv="refresh" content="0;url=https://evil.example">' +
                // Inert script body: happy-dom's DOMParser (unlike a browser's) executes scripts.
                '<base href="https://evil.example/"></head><body><p>Hi</p><script>var x = 1;</script>' +
                '<iframe src="https://evil.example"></iframe><object data="x"></object></body></html>'
        );
        expect(html).toContain('<p>Hi</p>');
        expect(html).not.toMatch(/<script|<iframe|<object|http-equiv|<base/i);
    });

    it('offers trimming only when something is left above the quoted chain', () => {
        const reply = prepareEmail(
            '<div>Thanks, see below.</div>' +
                '<div class="gmail_quote">On Mon, A wrote:<blockquote>old</blockquote></div>'
        );
        expect(reply.canTrim).toBe(true);

        const onlyQuote = prepareEmail(
            '<div class="gmail_quote">---------- Forwarded message ---------<br>Body</div>'
        );
        expect(onlyQuote.canTrim).toBe(false);

        expect(prepareEmail('<p>No quote here</p>').canTrim).toBe(false);
    });

    it('marks links noopener so a new tab cannot reach back into the inbox', () => {
        const { html } = prepareEmail('<a href="https://example.com">x</a>');
        expect(html).toContain('rel="noopener noreferrer"');
    });
});
