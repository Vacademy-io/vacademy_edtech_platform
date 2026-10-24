import DOMPurify from 'dompurify';

/**
 * Sanitiser for stored rich-text HTML (question text and options, assessment
 * instructions, section descriptions, announcements) before it reaches
 * `dangerouslySetInnerHTML`.
 *
 * This content is authored in TipTap, but it is also written by imports, AI
 * generation and other services, so it cannot be trusted as markup: an unsanitised
 * `<img onerror>` runs in the admin session, where the access token sits in a
 * JS-readable cookie.
 *
 * DOMPurify's defaults already keep what the editor emits: tables, lists, images,
 * audio/video, inline `style`, `class`, `data-*` (the `data-latex` the KaTeX
 * renderers read) and MathML. Adjustments:
 *
 *  - `target` is kept so editor links still open in a new tab instead of
 *    navigating the admin away from the app; any link with a `target` gets
 *    `rel="noopener noreferrer"`.
 *  - Pre-rendered KaTeX wraps its MathML in `<semantics>` + `<annotation>`, which
 *    DOMPurify removes. Removing `<semantics>` keeps its children (fine), but a
 *    removed `<annotation>` would leave its raw LaTeX source behind as a text
 *    node, so its content is dropped with it.
 *  - Form controls and `position: fixed` are removed, so stored content cannot draw
 *    a fake login overlay that posts the admin's password elsewhere. Neither editor
 *    emits them.
 *
 * A dedicated instance keeps the hook off the global DOMPurify used elsewhere.
 */
const purifier = DOMPurify(window);

purifier.addHook('afterSanitizeAttributes', (node) => {
    if (!(node instanceof Element)) return;
    if (node.hasAttribute('target')) node.setAttribute('rel', 'noopener noreferrer');
    const style = (node as HTMLElement).style;
    if (style?.position === 'fixed') style.removeProperty('position');
});

export const sanitizeRichHtml = (html: string | null | undefined): string =>
    html
        ? purifier.sanitize(html, {
              ADD_ATTR: ['target'],
              ADD_FORBID_CONTENTS: ['annotation'],
              FORBID_TAGS: ['form', 'input', 'button', 'textarea', 'select', 'option'],
          })
        : '';
