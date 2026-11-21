/**
 * The one script tag an institute pastes into its own website (Site Assistant
 * SPEC §5): the loader on the learner portal, the publishable Catalogue API key
 * and the site whose settings and knowledge it uses.
 *
 * Saved keys are only ever shown by their prefix. Only a key created on this
 * page a moment ago is known in full; for any other key the snippet carries a
 * placeholder the admin replaces with the key they saved when they created it.
 */

export const KEY_PLACEHOLDER_SUFFIX = 'PASTE_YOUR_FULL_KEY';

const attr = (v: string) =>
    v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** "vak_pub_ab12" → "vak_pub_ab12…PASTE_YOUR_FULL_KEY": visibly not a working key. */
export const keyPlaceholder = (prefix: string | null | undefined) =>
    `${(prefix || 'vak_pub_').trim()}…${KEY_PLACEHOLDER_SUFFIX}`;

export function buildEmbedSnippet(input: {
    /** Learner portal origin, e.g. https://learning.example.org (no trailing slash needed). */
    portalOrigin: string;
    /** The full key (just created) or a placeholder from keyPlaceholder(). */
    key: string;
    siteTag: string;
}): string {
    const origin = input.portalOrigin.trim().replace(/\/+$/, '');
    return `<script src="${attr(`${origin}/site-assistant.js`)}" data-key="${attr(
        input.key.trim()
    )}" data-site="${attr(input.siteTag)}" async></script>`;
}

/** True when the snippet carries a real key rather than the placeholder. */
export const snippetHasFullKey = (key: string) => !key.endsWith(KEY_PLACEHOLDER_SUFFIX);
