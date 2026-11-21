/**
 * Reads server JSON into the editor's typed shapes. Missing fields get their
 * defaults and unknown keys are dropped, so a later save never sends back a key
 * the server would reject (requests use ignoreUnknown=false, spec 3).
 */
import {
    BLOCK_TYPES,
    BUILTIN_WIDGETS,
    DESKTOP_PLACEMENTS,
    DEVICES,
    type Audience,
    type AudienceCondition,
    type BannerSlide,
    type BlockType,
    type BuiltinWidget,
    type Cta,
    type DraftResponse,
    type EventConfig,
    type HomeBlock,
    type ImageRef,
    type Layout,
    type LayoutSettings,
    type LayoutStatus,
    type NoticeConfig,
    type NoticeTone,
    type ShelfSource,
    type ShortcutTile,
    type TemplateKey,
} from '../-types/learner-home-types';
import { cleanBuiltinOptions } from './builtins';
import { DEFAULT_ACK_LABEL, DEFAULT_SETTINGS, defaultConfig } from './block-factory';
import { newKey } from './ids';
import { normalizeLinkTarget } from './link-target';

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec =>
    v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : {};
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
const num = (v: unknown, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : fallback;
const strArr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x) : [];
const oneOf = <T extends string>(v: unknown, list: readonly T[], fallback: T): T =>
    typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : fallback;

export function normalizeImageRef(raw: unknown): ImageRef | null {
    const r = rec(raw);
    const url = str(r.url);
    if (!url) return null;
    const renditions = rec(r.renditions);
    const out: ImageRef = {
        file_id: strOrNull(r.file_id),
        alt: str(r.alt),
        decorative: bool(r.decorative, false),
        url,
    };
    if (typeof r.width === 'number') out.width = r.width;
    if (typeof r.height === 'number') out.height = r.height;
    if (Object.keys(renditions).length > 0) {
        out.renditions = Object.fromEntries(
            Object.entries(renditions).filter(([, v]) => typeof v === 'string')
        ) as Record<string, string>;
    }
    return out;
}

export function normalizeCta(raw: unknown): Cta | null {
    const r = rec(raw);
    const link = normalizeLinkTarget(r.link);
    if (!link) return null;
    return { label: str(r.label), link };
}

export function normalizeAudience(raw: unknown): Audience {
    const r = rec(raw);
    if (r.mode !== 'RULES') return { mode: 'EVERYONE' };
    const all_of: AudienceCondition[] = [];
    for (const c of Array.isArray(r.all_of) ? r.all_of : []) {
        const cr = rec(c);
        switch (cr.kind) {
            case 'PACKAGE_SESSION':
                all_of.push({ kind: 'PACKAGE_SESSION', ids: strArr(cr.ids) });
                break;
            case 'ENROLLED_IN_COURSE':
            case 'NOT_ENROLLED_IN_COURSE':
                all_of.push({ kind: cr.kind, package_ids: strArr(cr.package_ids) });
                break;
            case 'USER_TAG':
                all_of.push({ kind: 'USER_TAG', tag_ids: strArr(cr.tag_ids) });
                break;
            default:
                break;
        }
    }
    return { mode: 'RULES', all_of };
}

export function normalizeSettings(raw: unknown): LayoutSettings {
    const r = rec(raw);
    return {
        phone_spacing: oneOf(r.phone_spacing, ['COMPACT', 'COMFORTABLE'] as const, 'COMPACT'),
        show_header: bool(r.show_header, DEFAULT_SETTINGS.show_header),
        carousel_autoplay_default: bool(
            r.carousel_autoplay_default,
            DEFAULT_SETTINGS.carousel_autoplay_default
        ),
    };
}

function normalizeSlide(raw: unknown): BannerSlide {
    const r = rec(raw);
    return {
        key: str(r.key) || newKey(),
        image: normalizeImageRef(r.image),
        desktop_image: normalizeImageRef(r.desktop_image),
        link: normalizeLinkTarget(r.link),
        starts_at: strOrNull(r.starts_at),
        ends_at: strOrNull(r.ends_at),
    };
}

function normalizeTile(raw: unknown): ShortcutTile {
    const r = rec(raw);
    const icon = rec(r.icon);
    return {
        key: str(r.key) || newKey(),
        label: str(r.label),
        icon:
            icon.kind === 'IMAGE'
                ? { kind: 'IMAGE', image: normalizeImageRef(icon.image) }
                : { kind: 'ICON', name: str(icon.name) || 'Star' },
        link: normalizeLinkTarget(r.link),
    };
}

function normalizeConfig(type: BlockType, widget: BuiltinWidget | null, raw: unknown) {
    const r = rec(raw);
    switch (type) {
        case 'BANNER_CAROUSEL':
            return {
                title: str(r.title),
                auto_rotate: bool(r.auto_rotate, true),
                slides: (Array.isArray(r.slides) ? r.slides : []).map(normalizeSlide),
            };
        case 'SHORTCUTS':
            return {
                title: str(r.title),
                tiles: (Array.isArray(r.tiles) ? r.tiles : []).map(normalizeTile),
            };
        case 'COURSE_SHELF': {
            const d = defaultConfig('COURSE_SHELF');
            return {
                title: str(r.title),
                source: oneOf<ShelfSource>(
                    r.source,
                    ['TAG', 'HAND_PICKED', 'NEWEST', 'FREE'],
                    'NEWEST'
                ),
                tags: strArr(r.tags),
                package_ids: strArr(r.package_ids),
                limit: num(r.limit, d.limit),
                hide_owned: bool(r.hide_owned, d.hide_owned),
                show_price: bool(r.show_price, d.show_price),
                see_all: normalizeLinkTarget(r.see_all),
            };
        }
        case 'NOTICE': {
            const out: NoticeConfig = {
                title: str(r.title),
                body: str(r.body),
                image: normalizeImageRef(r.image),
                button: normalizeCta(r.button),
                tone: oneOf<NoticeTone>(
                    r.tone,
                    ['NEUTRAL', 'INFO', 'SUCCESS', 'WARNING'],
                    'NEUTRAL'
                ),
                dismissible: bool(r.dismissible, true),
                require_ack: bool(r.require_ack, false),
                ack_label: str(r.ack_label) || DEFAULT_ACK_LABEL,
            };
            return out;
        }
        case 'EVENT': {
            const out: EventConfig = {
                title: str(r.title),
                subtitle: str(r.subtitle),
                image: normalizeImageRef(r.image),
                source: r.source === 'LIVE_SESSION' ? 'LIVE_SESSION' : 'CUSTOM',
                live_session_id: strOrNull(r.live_session_id),
                starts_at: strOrNull(r.starts_at),
                ends_at: strOrNull(r.ends_at),
                register_cta: normalizeCta(r.register_cta),
                join_cta: normalizeCta(r.join_cta),
                join_opens_minutes: num(r.join_opens_minutes, 15),
                show_countdown: bool(r.show_countdown, true),
            };
            return out;
        }
        case 'BUILTIN':
            return { options: cleanBuiltinOptions(widget ?? 'HERO', rec(r.options)) };
    }
}

/** One block from JSON, or null when its type or widget is unknown. */
export function normalizeBlock(raw: unknown): HomeBlock | null {
    const r = rec(raw);
    const type = oneOf<BlockType | ''>(r.type, BLOCK_TYPES, '');
    if (!type) return null;
    const widget =
        type === 'BUILTIN'
            ? oneOf<BuiltinWidget | ''>(r.builtin_widget, BUILTIN_WIDGETS, '')
            : null;
    if (type === 'BUILTIN' && !widget) return null;
    return {
        block_key: str(r.block_key) || str(r.key) || newKey(),
        type,
        builtin_widget: widget || null,
        desktop_placement: oneOf(r.desktop_placement ?? r.placement, DESKTOP_PLACEMENTS, 'MAIN'),
        devices: oneOf(r.devices, DEVICES, 'BOTH'),
        enabled: bool(r.enabled, true),
        admin_label: strOrNull(r.admin_label),
        starts_at: strOrNull(r.starts_at),
        ends_at: strOrNull(r.ends_at),
        audience: normalizeAudience(r.audience),
        config: normalizeConfig(type, widget || null, r.config),
    } as HomeBlock;
}

export function normalizeLayout(raw: unknown): Layout {
    const r = rec(raw);
    const blocks = (Array.isArray(r.blocks) ? r.blocks : [])
        .map(normalizeBlock)
        .filter((b): b is HomeBlock => b !== null);
    return {
        id: str(r.id),
        status: oneOf<LayoutStatus>(r.status, ['DRAFT', 'PUBLISHED', 'ARCHIVED'], 'DRAFT'),
        version: num(r.version, 0),
        base_version: typeof r.base_version === 'number' ? r.base_version : null,
        revision: num(r.revision, 1),
        template_key:
            oneOf<TemplateKey | ''>(
                r.template_key,
                ['COURSES_ONLY', 'CLASSROOM', 'STOREFRONT', 'CURRENT', 'BLANK'],
                ''
            ) || null,
        settings: normalizeSettings(r.settings ?? r.settings_json),
        blocks,
        updated_at: strOrNull(r.updated_at),
        updated_by: strOrNull(r.updated_by) ?? strOrNull(r.updated_by_user_id),
    };
}

export function normalizeDraftResponse(raw: unknown): DraftResponse {
    const r = rec(raw);
    const pub = rec(r.published);
    return {
        module_enabled: bool(r.module_enabled, true),
        holistic: bool(r.holistic, false),
        draft: r.draft ? normalizeLayout(r.draft) : null,
        published:
            typeof pub.version === 'number'
                ? {
                      version: pub.version,
                      published_at: strOrNull(pub.published_at),
                      published_by: strOrNull(pub.published_by),
                      block_count: typeof pub.block_count === 'number' ? pub.block_count : null,
                      blocks: Array.isArray(pub.blocks)
                          ? pub.blocks.map(normalizeBlock).filter((b): b is HomeBlock => b !== null)
                          : null,
                  }
                : null,
    };
}
