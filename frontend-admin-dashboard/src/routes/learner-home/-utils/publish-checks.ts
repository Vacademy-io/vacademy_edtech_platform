/**
 * The publish checks (spec 6.6) and limits (spec 3.2-3.4), mirrored in the
 * editor so problems show next to the field while the admin edits. The server
 * runs the same checks on publish and is the authority: its 422 errors are
 * shown the same way (see LearnerHomeApiError.issues).
 *
 * Errors block publish; warnings are shown and publish is allowed.
 */
import type {
    Audience,
    BannerSlide,
    CheckIssue,
    CheckSeverity,
    Cta,
    HomeBlock,
    ImageRef,
    LayoutSettings,
    LinkTarget,
} from '../-types/learner-home-types';
import { BUILTIN_INFO } from './builtins';
import { isShortcutIconName } from './icons';
import { isConditionalFeature, normalizeUrl } from './link-target';
import { buildSavePayload, MAX_PAYLOAD_BYTES, payloadBytes } from './payload';
import { isWindowInverted } from './schedule';

export const LIMITS = {
    blocks: 30,
    contentBlocks: 20,
    perType: { BANNER_CAROUSEL: 3, EVENT: 3, COURSE_SHELF: 6 } as Record<string, number>,
    adminLabel: 120,
    audienceConditions: 5,
    audienceIds: 200,
    banner: { title: 60, slidesMin: 1, slidesMax: 5, slidesWarn: 3 },
    alt: 140,
    shortcuts: { title: 40, tilesMin: 1, tilesMax: 16, label: 20 },
    shelf: {
        title: 60,
        tagsMin: 1,
        tagsMax: 5,
        pickedMin: 1,
        pickedMax: 20,
        limitMin: 4,
        limitMax: 20,
    },
    notice: { title: 80, body: 600, ackLabel: 40 },
    event: { title: 80, subtitle: 140, joinOpensMax: 120 },
    ctaLabel: 24,
    /** Contract: URL at most 2000 characters. */
    url: 2000,
    /** Contract: an imported APP_PATH is at most 500 characters. */
    appPath: 500,
} as const;

/** Minimum widths before an image looks soft where it is shown (spec 9). */
export const IMAGE_MIN_WIDTH = {
    bannerPhone: 800,
    bannerDesktop: 1600,
    tile: 128,
    card: 640,
} as const;

export interface CheckContext {
    now?: number;
    /** Course ids the institute has; when given, links to other ids are errors. */
    courseIds?: ReadonlySet<string>;
    /** Batch / learner-tag ids known to the institute; unknown ids are warnings. */
    batchIds?: ReadonlySet<string>;
    tagIds?: ReadonlySet<string>;
    /** The institute uses the Fun look: warn about built-ins it leaves out. */
    funSkin?: boolean;
    settings?: LayoutSettings;
}

class Collector {
    readonly issues: CheckIssue[] = [];
    add(
        severity: CheckSeverity,
        block_key: string | null,
        path: string | null,
        code: string,
        params?: Record<string, string | number>
    ) {
        this.issues.push({ block_key, path, code, severity, ...(params ? { params } : {}) });
    }
    error(
        key: string | null,
        path: string | null,
        code: string,
        params?: Record<string, string | number>
    ) {
        this.add('error', key, path, code, params);
    }
    warn(
        key: string | null,
        path: string | null,
        code: string,
        params?: Record<string, string | number>
    ) {
        this.add('warning', key, path, code, params);
    }
}

function checkLength(
    c: Collector,
    key: string,
    path: string,
    value: string,
    max: number,
    required = false
) {
    const v = value.trim();
    if (required && !v) c.error(key, path, 'REQUIRED');
    else if (v.length > max) c.error(key, path, 'TOO_LONG', { max });
}

function checkImage(
    c: Collector,
    key: string,
    path: string,
    image: ImageRef | null,
    minWidth: number,
    required: boolean
) {
    if (!image) {
        if (required) c.error(key, path, 'IMAGE_REQUIRED');
        return;
    }
    if (!image.decorative) {
        if (!image.alt.trim()) c.error(key, `${path}.alt`, 'ALT_REQUIRED');
        else if (image.alt.trim().length > LIMITS.alt) {
            c.error(key, `${path}.alt`, 'TOO_LONG', { max: LIMITS.alt });
        }
    }
    if (image.width && image.width < minWidth) {
        c.warn(key, path, 'IMAGE_LOW_RES', { width: image.width, min: minWidth });
    }
}

function checkLink(
    c: Collector,
    key: string,
    path: string,
    link: LinkTarget | null,
    required: boolean,
    ctx: CheckContext
) {
    if (!link) {
        if (required) c.error(key, path, 'LINK_REQUIRED');
        return;
    }
    if (link.kind === 'URL' && !('url' in normalizeUrl(link.url))) {
        c.error(key, path, 'URL_INVALID');
    } else if (link.kind === 'URL' && link.url.length > LIMITS.url) {
        c.error(key, path, 'TOO_LONG', { max: LIMITS.url });
    }
    if (link.kind === 'COURSE' && ctx.courseIds && !ctx.courseIds.has(link.package_id)) {
        c.error(key, path, 'LINK_TARGET_MISSING');
    }
    if (link.kind === 'APP_PATH') c.warn(key, path, 'IMPORTED_LINK');
    if (isConditionalFeature(link)) c.warn(key, path, 'FEATURE_CONDITIONAL');
}

function checkCta(c: Collector, key: string, path: string, cta: Cta | null, ctx: CheckContext) {
    if (!cta) return;
    checkLength(c, key, `${path}.label`, cta.label, LIMITS.ctaLabel, true);
    checkLink(c, key, `${path}.link`, cta.link, true, ctx);
}

function checkAudience(c: Collector, key: string, audience: Audience, ctx: CheckContext) {
    if (audience.mode !== 'RULES') return;
    if (audience.all_of.length === 0) {
        c.error(key, 'audience', 'AUDIENCE_EMPTY');
        return;
    }
    if (audience.all_of.length > LIMITS.audienceConditions) {
        c.error(key, 'audience', 'AUDIENCE_TOO_MANY', { max: LIMITS.audienceConditions });
    }
    audience.all_of.forEach((cond, i) => {
        const path = `audience.all_of[${i}]`;
        const ids =
            cond.kind === 'PACKAGE_SESSION'
                ? cond.ids
                : cond.kind === 'USER_TAG'
                  ? cond.tag_ids
                  : cond.package_ids;
        if (ids.length === 0) c.error(key, path, 'AUDIENCE_CONDITION_EMPTY');
        if (ids.length > LIMITS.audienceIds) {
            c.error(key, path, 'AUDIENCE_TOO_MANY_IDS', { max: LIMITS.audienceIds });
        }
        const known =
            cond.kind === 'PACKAGE_SESSION'
                ? ctx.batchIds
                : cond.kind === 'USER_TAG'
                  ? ctx.tagIds
                  : ctx.courseIds;
        const missing = known ? ids.filter((id) => !known.has(id)).length : 0;
        if (missing > 0) c.warn(key, path, 'AUDIENCE_ID_MISSING', { count: missing });
    });
}

function slideEnded(slide: BannerSlide, now: number): boolean {
    return !!slide.ends_at && Date.parse(slide.ends_at) <= now;
}

function checkBlock(c: Collector, block: HomeBlock, ctx: CheckContext) {
    const key = block.block_key;
    const now = ctx.now ?? Date.now();
    if (block.admin_label && block.admin_label.trim().length > LIMITS.adminLabel) {
        c.error(key, 'admin_label', 'TOO_LONG', { max: LIMITS.adminLabel });
    }
    if (isWindowInverted(block.starts_at, block.ends_at)) {
        c.error(key, 'ends_at', 'WINDOW_INVERTED');
    } else if (block.ends_at && Date.parse(block.ends_at) <= now) {
        c.warn(key, 'ends_at', 'ENDED');
    }
    checkAudience(c, key, block.audience, ctx);

    switch (block.type) {
        case 'BANNER_CAROUSEL': {
            const { title, slides } = block.config;
            checkLength(c, key, 'config.title', title, LIMITS.banner.title);
            if (slides.length < LIMITS.banner.slidesMin) {
                c.error(key, 'config.slides', 'TOO_FEW', { min: LIMITS.banner.slidesMin });
            }
            if (slides.length > LIMITS.banner.slidesMax) {
                c.error(key, 'config.slides', 'TOO_MANY', { max: LIMITS.banner.slidesMax });
            } else if (slides.length > LIMITS.banner.slidesWarn) {
                c.warn(key, 'config.slides', 'MANY_SLIDES', { count: slides.length });
            }
            slides.forEach((s, i) => {
                const p = `config.slides[${i}]`;
                checkImage(c, key, `${p}.image`, s.image, IMAGE_MIN_WIDTH.bannerPhone, true);
                checkImage(
                    c,
                    key,
                    `${p}.desktop_image`,
                    s.desktop_image,
                    IMAGE_MIN_WIDTH.bannerDesktop,
                    false
                );
                checkLink(c, key, `${p}.link`, s.link, false, ctx);
                if (isWindowInverted(s.starts_at, s.ends_at)) {
                    c.error(key, `${p}.ends_at`, 'WINDOW_INVERTED');
                }
            });
            if (slides.length > 0 && slides.every((s) => slideEnded(s, now))) {
                c.error(key, 'config.slides', 'ALL_SLIDES_ENDED');
            }
            break;
        }
        case 'SHORTCUTS': {
            const { title, tiles } = block.config;
            checkLength(c, key, 'config.title', title, LIMITS.shortcuts.title);
            if (tiles.length < LIMITS.shortcuts.tilesMin) {
                c.error(key, 'config.tiles', 'TOO_FEW', { min: LIMITS.shortcuts.tilesMin });
            }
            if (tiles.length > LIMITS.shortcuts.tilesMax) {
                c.error(key, 'config.tiles', 'TOO_MANY', { max: LIMITS.shortcuts.tilesMax });
            }
            tiles.forEach((tile, i) => {
                const p = `config.tiles[${i}]`;
                checkLength(c, key, `${p}.label`, tile.label, LIMITS.shortcuts.label, true);
                if (tile.icon.kind === 'ICON' && !isShortcutIconName(tile.icon.name)) {
                    c.error(key, `${p}.icon`, 'ICON_UNKNOWN');
                }
                if (tile.icon.kind === 'IMAGE') {
                    checkImage(
                        c,
                        key,
                        `${p}.icon.image`,
                        tile.icon.image,
                        IMAGE_MIN_WIDTH.tile,
                        true
                    );
                }
                checkLink(c, key, `${p}.link`, tile.link, true, ctx);
            });
            break;
        }
        case 'COURSE_SHELF': {
            const s = block.config;
            checkLength(c, key, 'config.title', s.title, LIMITS.shelf.title, true);
            if (s.source === 'TAG') {
                if (s.tags.length < LIMITS.shelf.tagsMin)
                    c.error(key, 'config.tags', 'TOO_FEW', { min: LIMITS.shelf.tagsMin });
                if (s.tags.length > LIMITS.shelf.tagsMax)
                    c.error(key, 'config.tags', 'TOO_MANY', { max: LIMITS.shelf.tagsMax });
            }
            if (s.source === 'HAND_PICKED') {
                if (s.package_ids.length < LIMITS.shelf.pickedMin) {
                    c.error(key, 'config.package_ids', 'TOO_FEW', { min: LIMITS.shelf.pickedMin });
                }
                if (s.package_ids.length > LIMITS.shelf.pickedMax) {
                    c.error(key, 'config.package_ids', 'TOO_MANY', { max: LIMITS.shelf.pickedMax });
                }
                if (ctx.courseIds) {
                    const missing = s.package_ids.filter((id) => !ctx.courseIds!.has(id)).length;
                    if (missing > 0)
                        c.error(key, 'config.package_ids', 'LINK_TARGET_MISSING', {
                            count: missing,
                        });
                }
            }
            if (
                !Number.isInteger(s.limit) ||
                s.limit < LIMITS.shelf.limitMin ||
                s.limit > LIMITS.shelf.limitMax
            ) {
                c.error(key, 'config.limit', 'OUT_OF_RANGE', {
                    min: LIMITS.shelf.limitMin,
                    max: LIMITS.shelf.limitMax,
                });
            }
            checkLink(c, key, 'config.see_all', s.see_all, false, ctx);
            break;
        }
        case 'NOTICE': {
            const n = block.config;
            checkLength(c, key, 'config.title', n.title, LIMITS.notice.title, true);
            if (n.body.length > LIMITS.notice.body) {
                c.error(key, 'config.body', 'TOO_LONG', { max: LIMITS.notice.body });
            }
            checkImage(c, key, 'config.image', n.image, IMAGE_MIN_WIDTH.card, false);
            checkCta(c, key, 'config.button', n.button, ctx);
            if (n.require_ack) {
                checkLength(c, key, 'config.ack_label', n.ack_label, LIMITS.notice.ackLabel, true);
            }
            break;
        }
        case 'EVENT': {
            const e = block.config;
            // A live-session event may leave the title empty: the session's title is used.
            checkLength(c, key, 'config.title', e.title, LIMITS.event.title, e.source === 'CUSTOM');
            checkLength(c, key, 'config.subtitle', e.subtitle, LIMITS.event.subtitle);
            checkImage(c, key, 'config.image', e.image, IMAGE_MIN_WIDTH.card, false);
            if (e.source === 'CUSTOM') {
                if (!e.starts_at || !e.ends_at) {
                    c.error(key, 'config.starts_at', 'EVENT_TIMES_REQUIRED');
                } else if (isWindowInverted(e.starts_at, e.ends_at)) {
                    c.error(key, 'config.ends_at', 'WINDOW_INVERTED');
                } else if (Date.parse(e.ends_at) <= now) {
                    c.warn(key, 'config.ends_at', 'ENDED');
                }
            } else if (!e.live_session_id) {
                c.error(key, 'config.live_session_id', 'REQUIRED');
            }
            if (
                !Number.isInteger(e.join_opens_minutes) ||
                e.join_opens_minutes < 0 ||
                e.join_opens_minutes > LIMITS.event.joinOpensMax
            ) {
                c.error(key, 'config.join_opens_minutes', 'OUT_OF_RANGE', {
                    min: 0,
                    max: LIMITS.event.joinOpensMax,
                });
            }
            checkCta(c, key, 'config.register_cta', e.register_cta, ctx);
            checkCta(c, key, 'config.join_cta', e.join_cta, ctx);
            break;
        }
        case 'BUILTIN': {
            const info = BUILTIN_INFO[block.builtin_widget];
            if (
                block.builtin_widget === 'STATS_ROW' &&
                (block.config.options.cards ?? []).length === 0
            ) {
                c.warn(key, 'config.options.cards', 'STATS_NO_CARDS');
            }
            if (ctx.funSkin && info.hiddenInFun && block.enabled) {
                c.warn(key, null, 'FUN_HIDDEN');
            }
            break;
        }
    }
}

/** Every check over the whole draft, in list order. */
export function runPublishChecks(blocks: HomeBlock[], ctx: CheckContext = {}): CheckIssue[] {
    const c = new Collector();
    if (blocks.length > LIMITS.blocks)
        c.error(null, 'blocks', 'LIMIT_BLOCKS', { max: LIMITS.blocks });
    const content = blocks.filter((b) => b.type !== 'BUILTIN');
    if (content.length > LIMITS.contentBlocks) {
        c.error(null, 'blocks', 'LIMIT_CONTENT_BLOCKS', { max: LIMITS.contentBlocks });
    }
    for (const [type, max] of Object.entries(LIMITS.perType)) {
        const count = blocks.filter((b) => b.type === type).length;
        if (count > max) c.error(null, 'blocks', 'LIMIT_TYPE', { type, max });
    }
    const seen = new Set<string>();
    for (const b of blocks) {
        if (b.type !== 'BUILTIN') continue;
        if (seen.has(b.builtin_widget)) {
            c.error(b.block_key, 'builtin_widget', 'DUPLICATE_BUILTIN', {
                widget: b.builtin_widget,
            });
        }
        seen.add(b.builtin_widget);
    }
    if (!seen.has('HERO')) c.error(null, 'blocks', 'HERO_REQUIRED');
    if (blocks.length > 0 && blocks.every((b) => !b.enabled))
        c.warn(null, 'blocks', 'ALL_DISABLED');

    blocks.forEach((b) => checkBlock(c, b, ctx));

    const size = payloadBytes(
        buildSavePayload(
            0,
            ctx.settings ?? {
                phone_spacing: 'COMPACT',
                show_header: true,
                carousel_autoplay_default: true,
            },
            blocks
        )
    );
    if (size > MAX_PAYLOAD_BYTES) {
        c.error(null, 'blocks', 'PAYLOAD_TOO_LARGE', {
            kb: Math.ceil(size / 1024),
            max: MAX_PAYLOAD_BYTES / 1024,
        });
    }
    return c.issues;
}

export const errorsOf = (issues: CheckIssue[]) => issues.filter((i) => i.severity !== 'warning');
export const warningsOf = (issues: CheckIssue[]) => issues.filter((i) => i.severity === 'warning');

export function issuesForBlock(issues: CheckIssue[], blockKey: string): CheckIssue[] {
    return issues.filter((i) => i.block_key === blockKey);
}

/** Issues for one field: exact path, or anything under it ("config.slides[0]" covers its image). */
export function issuesAt(issues: CheckIssue[], blockKey: string, pathPrefix: string): CheckIssue[] {
    return issues.filter(
        (i) =>
            i.block_key === blockKey &&
            !!i.path &&
            (i.path === pathPrefix ||
                i.path.startsWith(`${pathPrefix}.`) ||
                i.path.startsWith(`${pathPrefix}[`))
    );
}

/**
 * The editor's issues plus the server's (save 422, publish dry run, publish
 * 422). A server error at a field the editor already flags is the same
 * problem under another code, so only the editor's sentence is kept.
 */
export function mergeIssues(client: CheckIssue[], server: CheckIssue[]): CheckIssue[] {
    const at = (i: CheckIssue) => `${i.block_key}|${i.path}`;
    const clientErrorAt = new Set(client.filter((i) => i.severity !== 'warning').map(at));
    const seen = new Set(client.map((i) => `${at(i)}|${i.code}`));
    return [
        ...client,
        ...server.filter(
            (i) =>
                !seen.has(`${at(i)}|${i.code}`) &&
                !(i.severity !== 'warning' && i.path && clientErrorAt.has(at(i)))
        ),
    ];
}
