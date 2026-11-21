/**
 * Request bodies for the draft endpoints (spec 5.2). The list order IS the
 * position, so blocks are sent as an ordered array with no `position` field.
 * Text is trimmed here, not in the editor state, so typing is never fought.
 */
import type {
    Audience,
    BannerSlide,
    CreateDraftRequest,
    Cta,
    HomeBlock,
    ImageRef,
    LayoutSettings,
    SaveDraftRequest,
    ShortcutTile,
    TemplateKey,
} from '../-types/learner-home-types';
import { cleanBuiltinOptions } from './builtins';

/** Spec 3.4: the whole draft payload is at most 256 KB. */
export const MAX_PAYLOAD_BYTES = 256 * 1024;

function imagePayload(image: ImageRef | null): ImageRef | null {
    if (!image) return null;
    const out: ImageRef = {
        file_id: image.file_id,
        alt: image.decorative ? '' : image.alt.trim(),
        decorative: image.decorative,
        url: image.url,
    };
    if (image.width) out.width = image.width;
    if (image.height) out.height = image.height;
    if (image.renditions && Object.keys(image.renditions).length > 0) {
        out.renditions = image.renditions;
    }
    return out;
}

const ctaPayload = (cta: Cta | null): Cta | null =>
    cta ? { label: cta.label.trim(), link: cta.link } : null;

function audiencePayload(audience: Audience): Audience {
    if (audience.mode === 'EVERYONE') return { mode: 'EVERYONE' };
    return {
        mode: 'RULES',
        all_of: audience.all_of.map((c) => {
            switch (c.kind) {
                case 'PACKAGE_SESSION':
                    return { kind: c.kind, ids: [...new Set(c.ids)] };
                case 'USER_TAG':
                    return { kind: c.kind, tag_ids: [...new Set(c.tag_ids)] };
                default:
                    return { kind: c.kind, package_ids: [...new Set(c.package_ids)] };
            }
        }),
    };
}

const slidePayload = (s: BannerSlide): BannerSlide => ({
    key: s.key,
    image: imagePayload(s.image),
    desktop_image: imagePayload(s.desktop_image),
    link: s.link,
    starts_at: s.starts_at,
    ends_at: s.ends_at,
});

const tilePayload = (tile: ShortcutTile): ShortcutTile => ({
    key: tile.key,
    label: tile.label.trim(),
    icon:
        tile.icon.kind === 'IMAGE'
            ? { kind: 'IMAGE', image: imagePayload(tile.icon.image) }
            : { kind: 'ICON', name: tile.icon.name },
    link: tile.link,
});

/** One block as the API takes it (spec 5.2 `Block`). */
export function blockPayload(block: HomeBlock): HomeBlock {
    const envelope = {
        block_key: block.block_key,
        desktop_placement: block.desktop_placement,
        devices: block.devices,
        enabled: block.enabled,
        admin_label: block.admin_label?.trim() ? block.admin_label.trim() : null,
        starts_at: block.starts_at,
        ends_at: block.ends_at,
        audience: audiencePayload(block.audience),
    };
    switch (block.type) {
        case 'BANNER_CAROUSEL':
            return {
                ...envelope,
                type: block.type,
                builtin_widget: null,
                config: {
                    title: block.config.title.trim(),
                    auto_rotate: block.config.auto_rotate,
                    slides: block.config.slides.map(slidePayload),
                },
            };
        case 'SHORTCUTS':
            return {
                ...envelope,
                type: block.type,
                builtin_widget: null,
                config: {
                    title: block.config.title.trim(),
                    tiles: block.config.tiles.map(tilePayload),
                },
            };
        case 'COURSE_SHELF': {
            const c = block.config;
            return {
                ...envelope,
                type: block.type,
                builtin_widget: null,
                config: {
                    title: c.title.trim(),
                    source: c.source,
                    // Only the list the source uses is kept, so a switch of source
                    // does not carry stale ids into the saved row.
                    tags: c.source === 'TAG' ? c.tags : [],
                    package_ids: c.source === 'HAND_PICKED' ? c.package_ids : [],
                    limit: c.limit,
                    hide_owned: c.hide_owned,
                    show_price: c.show_price,
                    see_all: c.see_all,
                },
            };
        }
        case 'NOTICE': {
            const c = block.config;
            return {
                ...envelope,
                type: block.type,
                builtin_widget: null,
                config: {
                    title: c.title.trim(),
                    body: c.body.replace(/\s+$/, ''),
                    image: imagePayload(c.image),
                    button: ctaPayload(c.button),
                    tone: c.tone,
                    dismissible: c.dismissible,
                    require_ack: c.require_ack,
                    ack_label: c.ack_label.trim(),
                },
            };
        }
        case 'EVENT': {
            const c = block.config;
            const live = c.source === 'LIVE_SESSION';
            return {
                ...envelope,
                type: block.type,
                builtin_widget: null,
                config: {
                    title: c.title.trim(),
                    subtitle: c.subtitle.trim(),
                    image: imagePayload(c.image),
                    source: c.source,
                    live_session_id: live ? c.live_session_id : null,
                    // A live-session event takes its times from the session.
                    starts_at: live ? null : c.starts_at,
                    ends_at: live ? null : c.ends_at,
                    register_cta: ctaPayload(c.register_cta),
                    join_cta: ctaPayload(c.join_cta),
                    join_opens_minutes: c.join_opens_minutes,
                    show_countdown: c.show_countdown,
                },
            };
        }
        case 'BUILTIN':
            return {
                ...envelope,
                type: block.type,
                builtin_widget: block.builtin_widget,
                config: {
                    options: cleanBuiltinOptions(block.builtin_widget, block.config.options),
                },
            };
    }
}

const settingsPayload = (s: LayoutSettings): LayoutSettings => ({
    phone_spacing: s.phone_spacing,
    show_header: s.show_header,
    carousel_autoplay_default: s.carousel_autoplay_default,
});

export function buildSavePayload(
    revision: number,
    settings: LayoutSettings,
    blocks: HomeBlock[]
): SaveDraftRequest {
    return { revision, settings: settingsPayload(settings), blocks: blocks.map(blockPayload) };
}

export function buildCreatePayload(
    templateKey: TemplateKey,
    settings: LayoutSettings,
    blocks: HomeBlock[]
): CreateDraftRequest {
    return {
        template_key: templateKey,
        settings: settingsPayload(settings),
        blocks: blocks.map(blockPayload),
    };
}

/** UTF-8 size of the JSON body. */
export function payloadBytes(body: unknown): number {
    return new TextEncoder().encode(JSON.stringify(body)).length;
}
