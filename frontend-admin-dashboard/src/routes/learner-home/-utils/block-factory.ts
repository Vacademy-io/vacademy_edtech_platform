/**
 * New blocks with their default config (spec 3.3). Used by the Add block
 * menu, the templates and the "current home" conversion.
 */
import type {
    BannerSlide,
    BlockConfigByType,
    BuiltinWidget,
    ContentBlockType,
    DesktopPlacement,
    HomeBlock,
    HomeBlockOf,
    LayoutSettings,
    ShortcutTile,
} from '../-types/learner-home-types';
import { BUILTIN_INFO, defaultBuiltinOptions } from './builtins';
import { newKey } from './ids';

export const DEFAULT_SETTINGS: LayoutSettings = {
    phone_spacing: 'COMPACT',
    show_header: true,
    carousel_autoplay_default: true,
};

export const DEFAULT_ACK_LABEL = 'I have read this';

/** Where a new block of each type lands on desktop. */
export const DEFAULT_PLACEMENT: Record<ContentBlockType, DesktopPlacement> = {
    BANNER_CAROUSEL: 'FULL',
    SHORTCUTS: 'MAIN',
    COURSE_SHELF: 'MAIN',
    NOTICE: 'MAIN',
    EVENT: 'RAIL',
};

export function emptySlide(): BannerSlide {
    return {
        key: newKey(),
        image: null,
        desktop_image: null,
        link: null,
        starts_at: null,
        ends_at: null,
    };
}

export function emptyTile(): ShortcutTile {
    return { key: newKey(), label: '', icon: { kind: 'ICON', name: 'Star' }, link: null };
}

export function defaultConfig<T extends ContentBlockType>(
    type: T,
    settings: LayoutSettings = DEFAULT_SETTINGS
): BlockConfigByType[T] {
    const configs: { [K in ContentBlockType]: BlockConfigByType[K] } = {
        BANNER_CAROUSEL: {
            title: '',
            auto_rotate: settings.carousel_autoplay_default,
            slides: [emptySlide()],
        },
        SHORTCUTS: { title: '', tiles: [emptyTile()] },
        COURSE_SHELF: {
            title: '',
            source: 'NEWEST',
            tags: [],
            package_ids: [],
            limit: 10,
            hide_owned: true,
            show_price: true,
            see_all: null,
        },
        NOTICE: {
            title: '',
            body: '',
            image: null,
            button: null,
            tone: 'NEUTRAL',
            dismissible: true,
            require_ack: false,
            ack_label: DEFAULT_ACK_LABEL,
        },
        EVENT: {
            title: '',
            subtitle: '',
            image: null,
            source: 'CUSTOM',
            live_session_id: null,
            starts_at: null,
            ends_at: null,
            register_cta: null,
            join_cta: null,
            join_opens_minutes: 15,
            show_countdown: true,
        },
    };
    return configs[type] as BlockConfigByType[T];
}

interface EnvelopeOverrides {
    desktop_placement?: DesktopPlacement;
    enabled?: boolean;
    admin_label?: string | null;
}

export function createContentBlock<T extends ContentBlockType>(
    type: T,
    config?: Partial<BlockConfigByType[T]>,
    overrides: EnvelopeOverrides = {},
    settings: LayoutSettings = DEFAULT_SETTINGS
): HomeBlockOf<T> {
    return {
        block_key: newKey(),
        type,
        builtin_widget: null,
        desktop_placement: overrides.desktop_placement ?? DEFAULT_PLACEMENT[type],
        devices: 'BOTH',
        enabled: overrides.enabled ?? true,
        admin_label: overrides.admin_label ?? null,
        starts_at: null,
        ends_at: null,
        audience: { mode: 'EVERYONE' },
        config: { ...defaultConfig(type, settings), ...(config ?? {}) },
    } as HomeBlockOf<T>;
}

export function createBuiltinBlock(
    widget: BuiltinWidget,
    overrides: EnvelopeOverrides & { options?: HomeBlockOf<'BUILTIN'>['config']['options'] } = {}
): HomeBlockOf<'BUILTIN'> {
    return {
        block_key: newKey(),
        type: 'BUILTIN',
        builtin_widget: widget,
        desktop_placement: overrides.desktop_placement ?? BUILTIN_INFO[widget].defaultPlacement,
        devices: 'BOTH',
        enabled: overrides.enabled ?? true,
        admin_label: overrides.admin_label ?? null,
        starts_at: null,
        ends_at: null,
        audience: { mode: 'EVERYONE' },
        config: { options: overrides.options ?? defaultBuiltinOptions(widget) },
    };
}

/** A copy with fresh keys for the block, its slides and its tiles (spec 2.5: a copy gets a new key). */
export function duplicateBlock(block: HomeBlock): HomeBlock {
    const copy = JSON.parse(JSON.stringify(block)) as HomeBlock;
    copy.block_key = newKey();
    if (copy.type === 'BANNER_CAROUSEL') {
        copy.config.slides = copy.config.slides.map((s) => ({ ...s, key: newKey() }));
    } else if (copy.type === 'SHORTCUTS') {
        copy.config.tiles = copy.config.tiles.map((tile) => ({ ...tile, key: newKey() }));
    }
    return copy;
}
