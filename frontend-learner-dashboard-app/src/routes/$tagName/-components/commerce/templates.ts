/**
 * Built-in templates of the fixed shop routes (Phase 1): an ordered
 * section list per template, in code. A site switches a section off with
 * globalSettings.commerce.templates.<template>.<section> = false; reordering and per-section
 * editing are Phase 2.
 */
import { templateSections, type CommerceConfig } from './config';

export const BUILT_IN_TEMPLATES = {
    product: [
        'backLink',
        'gallery',
        'title',
        'badges',
        'provenance',
        'options',
        'length',
        'buyBox',
        'pincode',
        'reassurance',
        'accordions',
        'related',
        'stickyBar',
    ],
    collection: ['header', 'subCollections', 'grid', 'trustStrip'],
    search: ['header', 'grid'],
    cart: ['lines'],
} as const;

export type TemplateName = keyof typeof BUILT_IN_TEMPLATES;

/** The sections a template renders on this site, in the built-in order. */
export const sectionsOf = (config: Pick<CommerceConfig, 'templates'>, template: TemplateName): string[] =>
    templateSections(config, template, BUILT_IN_TEMPLATES[template]);
