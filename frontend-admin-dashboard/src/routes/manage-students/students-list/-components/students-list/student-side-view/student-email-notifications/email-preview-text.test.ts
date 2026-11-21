import { describe, expect, it } from 'vitest';

import { decodeEntities, htmlToPreviewText } from './email-preview-text';

// The head of a real MJML email, as VetEd templates are stored: an Outlook-only settings block
// in a conditional comment, a style block, and a hidden preheader padded with invisible chars.
const MJML_EMAIL = `<!doctype html><html lang="und" dir="auto"><head><title></title>
<!--[if !mso]><!--><meta http-equiv="X-UA-Compatible" content="IE=edge"><!--<![endif]-->
<style type="text/css">#outlook a { padding:0; } body { margin:0; }</style>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:AllowPNG/><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
</head><body><div style="display:none">&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;</div>
<p>Dear Ariana,</p><p>Greencross and Vet Education are delighted &ndash; we&rsquo;re excited.</p></body></html>`;

describe('htmlToPreviewText', () => {
    it('drops the Outlook settings block instead of leaving its "96" behind', () => {
        const text = htmlToPreviewText(MJML_EMAIL);
        expect(text.startsWith('96')).toBe(false);
        expect(text).not.toContain('96');
        expect(text.startsWith('Dear Ariana,')).toBe(true);
    });

    it('decodes curly quotes and dashes', () => {
        expect(htmlToPreviewText(MJML_EMAIL)).toContain('delighted \u2013 we\u2019re excited.');
    });

    it('strips the invisible preheader padding', () => {
        expect(htmlToPreviewText(MJML_EMAIL)).not.toMatch(/[\u034F\u200C]/);
    });

    it('still truncates with an ellipsis', () => {
        expect(htmlToPreviewText(MJML_EMAIL, 11)).toBe('Dear Ariana…');
    });

    it('handles HTML cut off mid-tag', () => {
        expect(htmlToPreviewText("<p>Hello</p><table align='center' style='mar")).toBe('Hello');
    });
});

describe('decodeEntities', () => {
    it('decodes named, decimal and hex entities and leaves unknown ones alone', () => {
        expect(decodeEntities('a&amp;b &#39;x&#39; &#x2019; &hellip; &madeup;')).toBe(
            "a&b 'x' \u2019 \u2026 &madeup;"
        );
    });
});
