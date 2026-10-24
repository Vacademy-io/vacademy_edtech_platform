/**
 * Starter markup for the promo popup's "custom" template: one string of HTML
 * with its own <style>, built from the popup's current text so an admin who
 * switches to Custom HTML starts from their own offer, not a blank box.
 *
 * Colours read the site theme (var(--primary-500) etc. are inherited into the
 * popup's shadow root), so a starter matches every institute without edits.
 * The learner renders it through catalogue-html (no scripts / forms / iframes)
 * and wires the data-vacademy hooks — see PromoPopup.tsx (CustomView).
 */

export const PROMO_STARTERS = ['offer', 'banner', 'simple'] as const;
export type PromoStarter = (typeof PROMO_STARTERS)[number];

/** Split the one box into markup and CSS — mirror of the learner's splitHtmlAndCss. */
export const splitHtmlAndCss = (source: unknown): { html: string; css: string } => {
    if (typeof source !== 'string' || !source.trim()) return { html: '', css: '' };
    const css: string[] = [];
    const html = source.replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, (_m, rules: string) => {
        css.push(rules);
        return '';
    });
    return { html: html.trim(), css: css.join('\n').trim() };
};

/** Same cap as the learner's section sanitizer (catalogue-html MAX_HTML). */
export const CUSTOM_HTML_LIMIT = 30000;

export interface StarterLabels {
    useCode: string;
    copy: string;
    endsIn: string;
}

interface StarterButton {
    text?: string;
    action?: string;
    url?: string;
    audienceId?: string;
    whatsappPhone?: string;
    whatsappMessage?: string;
}

export interface StarterSource {
    badge?: string;
    heading?: string;
    highlight?: string;
    body?: string;
    image?: string;
    imageAlt?: string;
    couponCode?: string;
    endDate?: string;
    dismissText?: string;
    footnote?: string;
    button?: StarterButton;
}

const ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (value: unknown): string =>
    String(value ?? '').replace(/[&<>"']/g, (c) => ENTITIES[c] ?? c);

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const ACCENT = 'hsl(var(--palette-primary, var(--primary-500)))';
const DEEP = `color-mix(in srgb, ${ACCENT} 62%, black)`;

/** The popup's button as markup with the matching hook. */
export const buttonMarkup = (button: StarterButton | undefined, className: string): string => {
    const label = escapeHtml(text(button?.text));
    if (!label) return '';
    const action = button?.action || 'link';
    if (action === 'openForm' && text(button?.audienceId)) {
        return `<button class="${className}" data-vacademy="lead-form" data-audience="${escapeHtml(text(button?.audienceId))}">${label}</button>`;
    }
    if (action === 'whatsapp') {
        const digits = String(button?.whatsappPhone ?? '').replace(/\D/g, '');
        const msg = text(button?.whatsappMessage);
        const href = `https://wa.me/${digits}${msg ? `?text=${encodeURIComponent(msg)}` : ''}`;
        return `<a class="${className}" href="${escapeHtml(href)}" target="_blank" rel="noopener">${label}</a>`;
    }
    const url = text(button?.url);
    if (/^https:\/\//i.test(url)) {
        return `<a class="${className}" data-vacademy="link" data-href="${escapeHtml(url)}">${label}</a>`;
    }
    if (/^http:\/\//i.test(url)) {
        return `<a class="${className}" href="${escapeHtml(url)}" target="_blank" rel="noopener">${label}</a>`;
    }
    return `<a class="${className}" data-vacademy="route" data-route="${escapeHtml(url.replace(/^\/+/, ''))}">${label}</a>`;
};

/** Shared rules every starter uses: button, coupon, timer, close link. */
const COMMON_CSS = `
  .pp { font-family: inherit; color: hsl(var(--catalogue-text-primary)); }
  .pp * { box-sizing: border-box; }
  .pp-cta { display: block; width: 100%; padding: 14px 20px; border: 0; border-radius: 16px;
    background: linear-gradient(135deg, ${ACCENT}, ${DEEP}); color: #fff; font: inherit;
    font-size: 16px; font-weight: 700; text-align: center; text-decoration: none; cursor: pointer;
    box-shadow: 0 10px 24px -8px ${DEEP}; }
  .pp-cta:hover { filter: brightness(1.08); }
  .pp-code { display: flex; align-items: center; justify-content: space-between; gap: 12px;
    margin: 0 0 16px; padding: 12px 16px; border: 2px dashed ${ACCENT}; border-radius: 16px;
    background: color-mix(in srgb, ${ACCENT} 10%, transparent); text-align: start; }
  .pp-code small { display: block; font-size: 11px; letter-spacing: .1em; text-transform: uppercase; opacity: .7; }
  .pp-code b { font-family: ui-monospace, monospace; font-size: 20px; letter-spacing: .15em; color: ${ACCENT}; }
  .pp-copy { flex-shrink: 0; padding: 8px 14px; border: 0; border-radius: 10px; background: ${ACCENT};
    color: #fff; font: inherit; font-size: 14px; font-weight: 600; cursor: pointer; }
  .pp-timer { display: inline-block; margin: 0 0 16px; padding: 8px 14px; border-radius: 12px;
    background: hsl(var(--catalogue-bg-muted)); font-size: 14px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .pp-skip { display: block; margin: 12px auto 0; border: 0; background: none; font: inherit; font-size: 14px;
    color: hsl(var(--catalogue-text-muted)); cursor: pointer; }
  .pp-small { margin: 10px 0 0; font-size: 12px; text-align: center; color: hsl(var(--catalogue-text-muted)); }`;

/** Coupon, countdown, button, close link and small print — in that order. */
const actionsMarkup = (src: StarterSource, labels: StarterLabels, indent: string): string => {
    const lines: string[] = [];
    if (text(src.endDate)) {
        lines.push(`<div class="pp-timer">⏰ ${escapeHtml(labels.endsIn)} <span data-vacademy="countdown"></span></div>`);
    }
    const code = text(src.couponCode);
    if (code) {
        lines.push(
            `<div class="pp-code">`,
            `  <div><small>${escapeHtml(labels.useCode)}</small><b>${escapeHtml(code)}</b></div>`,
            `  <button class="pp-copy" data-vacademy="copy" data-target="${escapeHtml(code)}">${escapeHtml(labels.copy)}</button>`,
            `</div>`
        );
    }
    const cta = buttonMarkup(src.button, 'pp-cta');
    if (cta) lines.push(cta);
    if (text(src.dismissText)) lines.push(`<button class="pp-skip" data-vacademy="close">${escapeHtml(text(src.dismissText))}</button>`);
    if (text(src.footnote)) lines.push(`<p class="pp-small">${escapeHtml(text(src.footnote))}</p>`);
    return lines.map((l) => indent + l).join('\n');
};

const opt = (value: unknown, render: (v: string) => string): string => {
    const v = text(value);
    return v ? render(escapeHtml(v)) : '';
};

const offer = (src: StarterSource, labels: StarterLabels): string => `<style>${COMMON_CSS}
  .pp { text-align: center; }
  .pp-top { padding: 44px 28px 52px; color: #fff; background: linear-gradient(135deg, ${ACCENT}, ${DEEP}); }
  .pp-badge { display: inline-block; padding: 4px 12px; border-radius: 999px; background: rgba(255,255,255,.2);
    font-size: 12px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
  .pp-big { margin: 14px 0 6px; font-size: 56px; font-weight: 900; line-height: 1; letter-spacing: -.02em; }
  .pp-title { margin: 8px 0 0; font-size: 22px; font-weight: 700; }
  .pp-body { position: relative; margin-top: -22px; padding: 28px 24px 24px; border-radius: 24px 24px 0 0;
    background: hsl(var(--catalogue-bg-elevated)); }
  .pp-text { margin: 0 0 16px; font-size: 15px; line-height: 1.6; opacity: .8; }
  @media (max-width: 480px) { .pp-big { font-size: 44px; } }
</style>

<div class="pp">
  <div class="pp-top">
${[
    opt(src.badge, (v) => `    <span class="pp-badge">${v}</span>`),
    opt(src.highlight, (v) => `    <p class="pp-big">${v}</p>`),
    opt(src.heading, (v) => `    <h2 class="pp-title">${v}</h2>`),
]
    .filter(Boolean)
    .join('\n')}
  </div>
  <div class="pp-body">
${[opt(src.body, (v) => `    <p class="pp-text">${v}</p>`), actionsMarkup(src, labels, '    ')].filter(Boolean).join('\n')}
  </div>
</div>
`;

const banner = (src: StarterSource, labels: StarterLabels): string => `<style>${COMMON_CSS}
  .pp-media { position: relative; height: 200px; background: linear-gradient(135deg, ${ACCENT}, ${DEEP}); }
  .pp-media img { display: block; width: 100%; height: 100%; object-fit: cover; }
  .pp-tag { position: absolute; bottom: 14px; inset-inline-start: 14px; padding: 6px 14px; border-radius: 14px;
    background: #fff; color: ${ACCENT}; font-size: 22px; font-weight: 900; box-shadow: 0 8px 20px rgba(0,0,0,.2); }
  .pp-content { padding: 24px; }
  .pp-badge { display: inline-block; padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 700;
    letter-spacing: .06em; text-transform: uppercase; color: ${ACCENT}; background: color-mix(in srgb, ${ACCENT} 12%, transparent); }
  .pp-title { margin: 12px 0 8px; font-size: 26px; font-weight: 800; line-height: 1.2; }
  .pp-text { margin: 0 0 16px; font-size: 15px; line-height: 1.6; opacity: .8; }
</style>

<div class="pp">
  <div class="pp-media">
${[
    opt(src.image, (v) => `    <img src="${v}" alt="${escapeHtml(text(src.imageAlt))}">`),
    opt(src.highlight, (v) => `    <span class="pp-tag">${v}</span>`),
]
    .filter(Boolean)
    .join('\n')}
  </div>
  <div class="pp-content">
${[
    opt(src.badge, (v) => `    <span class="pp-badge">${v}</span>`),
    opt(src.heading, (v) => `    <h2 class="pp-title">${v}</h2>`),
    opt(src.body, (v) => `    <p class="pp-text">${v}</p>`),
    actionsMarkup(src, labels, '    '),
]
    .filter(Boolean)
    .join('\n')}
  </div>
</div>
`;

const simple = (src: StarterSource, labels: StarterLabels): string => `<style>${COMMON_CSS}
  .pp { padding: 40px 28px 28px; text-align: center; }
  .pp-badge { margin: 0; font-size: 13px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: ${ACCENT}; }
  .pp-big { margin: 10px 0 4px; font-size: 44px; font-weight: 900; line-height: 1.05; color: ${ACCENT}; }
  .pp-title { margin: 8px 0 10px; font-size: 22px; font-weight: 700; }
  .pp-text { margin: 0 auto 20px; max-width: 36ch; font-size: 15px; line-height: 1.6; opacity: .8; }
</style>

<div class="pp">
${[
    opt(src.badge, (v) => `  <p class="pp-badge">${v}</p>`),
    opt(src.highlight, (v) => `  <p class="pp-big">${v}</p>`),
    opt(src.heading, (v) => `  <h2 class="pp-title">${v}</h2>`),
    opt(src.body, (v) => `  <p class="pp-text">${v}</p>`),
    actionsMarkup(src, labels, '  '),
]
    .filter(Boolean)
    .join('\n')}
</div>
`;

const BUILDERS: Record<PromoStarter, (src: StarterSource, labels: StarterLabels) => string> = { offer, banner, simple };

export const buildPromoStarter = (kind: PromoStarter, src: StarterSource, labels: StarterLabels): string =>
    BUILDERS[kind](src, labels);

/** Ready-to-paste hook snippets for the editor's cheat sheet. */
export const hookSnippets = (opts: { audienceId?: string; couponCode?: string }) => ({
    close: '<button data-vacademy="close">No thanks</button>',
    copy: `<button data-vacademy="copy" data-target="${escapeHtml(text(opts.couponCode) || 'SAVE50')}">Copy code</button>`,
    countdown: '<span data-vacademy="countdown"></span>',
    route: '<a data-vacademy="route" data-route="courses">View courses</a>',
    form: `<button data-vacademy="lead-form" data-audience="${escapeHtml(text(opts.audienceId) || 'CAMPAIGN_ID')}">Enquire now</button>`,
    link: '<a data-vacademy="link" data-href="https://example.com">Learn more</a>',
    whatsapp: '<a href="https://wa.me/919876543210" target="_blank" rel="noopener">Chat on WhatsApp</a>',
});
