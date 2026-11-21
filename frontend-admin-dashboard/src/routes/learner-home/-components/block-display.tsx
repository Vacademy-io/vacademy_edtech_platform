/** Names, icons and chips for blocks in the list, the editor and Results. */
import type { TFunction } from 'i18next';
import {
    Books,
    CalendarBlank,
    Images,
    Megaphone,
    PuzzlePiece,
    SquaresFour,
    type Icon,
} from '@phosphor-icons/react';
import type { BlockType, HomeBlock } from '../-types/learner-home-types';
import { summarizeAudience } from '../-utils/audience';
import { formatInZone, windowState } from '../-utils/schedule';

export const BLOCK_TYPE_ICON: Record<BlockType, Icon> = {
    BANNER_CAROUSEL: Images,
    SHORTCUTS: SquaresFour,
    COURSE_SHELF: Books,
    NOTICE: Megaphone,
    EVENT: CalendarBlank,
    BUILTIN: PuzzlePiece,
};

/** The admin label, else the block's own heading, else its type. */
export function blockName(block: HomeBlock, t: TFunction): string {
    if (block.admin_label?.trim()) return block.admin_label.trim();
    if (block.type === 'BUILTIN') return t(`builtins.${block.builtin_widget}.name`);
    return block.config.title.trim() || t(`blockTypes.${block.type}`);
}

/** "Everyone" or "3 batches + 1 tag". */
export function audienceChip(block: HomeBlock, t: TFunction): string {
    const s = summarizeAudience(block.audience);
    if (s.everyone) return t('chips.everyone');
    const parts = [
        s.batches ? t('chips.batches', { count: s.batches }) : null,
        s.courses ? t('chips.courses', { count: s.courses }) : null,
        s.notCourses ? t('chips.notCourses', { count: s.notCourses }) : null,
        s.tags ? t('chips.tags', { count: s.tags }) : null,
    ].filter(Boolean);
    return parts.join(' + ') || t('chips.everyone');
}

/** "From 1 Dec" / "Until 30 Nov" / "Ended", or null when always on. */
export function scheduleChip(
    block: HomeBlock,
    t: TFunction,
    zone: string,
    locale: string
): string | null {
    const state = windowState(block.starts_at, block.ends_at);
    if (state === 'always') return null;
    if (state === 'ended') return t('chips.ended');
    if (state === 'scheduled')
        return t('chips.starts', { date: formatInZone(block.starts_at, zone, locale, false) });
    return block.ends_at
        ? t('chips.until', { date: formatInZone(block.ends_at, zone, locale, false) })
        : null;
}
