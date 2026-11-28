import { ClassicHome, ClassicLesson, ClassicResult, type ClassicLook } from './classic';
import { bg } from './palette';
import type { SkinModelProps } from './types';

/**
 * Default: neutral product UI. White page, a soft grey "continue" card,
 * outlined white cards, 8px corners and one solid brand button; a letter
 * avatar beside the greeting; no tab bar on a phone.
 */
export function DefaultModel({ screen, brand, copy }: SkinModelProps) {
    const look: ClassicLook = {
        hero: { className: 'rounded-xl bg-neutral-50' },
        card: { className: 'rounded-xl border border-neutral-200 bg-white' },
        button: bg(brand.solid),
        avatar: true,
    };
    if (screen === 'lesson') return <ClassicLesson brand={brand} copy={copy} look={look} />;
    if (screen === 'result') return <ClassicResult brand={brand} copy={copy} look={look} />;
    return <ClassicHome brand={brand} copy={copy} look={look} />;
}
