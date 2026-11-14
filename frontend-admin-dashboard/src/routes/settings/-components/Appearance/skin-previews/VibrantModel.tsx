import { ClassicHome, ClassicLesson, ClassicResult, type ClassicLook } from './classic';
import { bg, edge, merge } from './palette';
import type { SkinModelProps } from './types';

/**
 * Vibrant: Default's layout with colour. Cards are washed with the brand's
 * lightest tint under a thicker brand-tinted top edge, and the top bar's
 * icons take the brand colour.
 */
export function VibrantModel({ screen, brand, copy }: SkinModelProps) {
    const tinted = {
        className: 'rounded-xl border border-t-4',
        style: merge(bg(brand.tint50), edge(brand.tint100), { borderTopColor: brand.tint300 }),
    };
    const look: ClassicLook = {
        hero: tinted,
        card: tinted,
        button: bg(brand.solid),
        avatar: true,
        toolColor: brand.solid,
    };
    if (screen === 'lesson') return <ClassicLesson brand={brand} copy={copy} look={look} />;
    if (screen === 'result') return <ClassicResult brand={brand} copy={copy} look={look} />;
    return <ClassicHome brand={brand} copy={copy} look={look} />;
}
