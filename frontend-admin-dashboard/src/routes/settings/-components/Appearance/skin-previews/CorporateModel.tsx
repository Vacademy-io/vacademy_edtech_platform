import { ClassicHome, ClassicLesson, ClassicResult, type ClassicLook } from './classic';
import { CORPORATE, edge } from './palette';
import type { SkinModelProps } from './types';

/**
 * Corporate: calm and layered. A cool grey page under a white panel, white
 * cards raised by a soft shadow and a quiet edge, modest 8-10px corners, a
 * solid brand button with a light top, and a plain greeting with no avatar.
 */
export function CorporateModel({ screen, brand, copy }: SkinModelProps) {
    const raised = {
        className: 'rounded-xl border bg-white shadow-md',
        style: edge(CORPORATE.line),
    };
    const look: ClassicLook = {
        canvas: CORPORATE.canvas,
        hero: raised,
        card: raised,
        button: {
            backgroundImage: `linear-gradient(to bottom, ${brand.tint400}, ${brand.solid} 60%)`,
        },
        avatar: false,
    };
    if (screen === 'lesson') return <ClassicLesson brand={brand} copy={copy} look={look} />;
    if (screen === 'result') return <ClassicResult brand={brand} copy={copy} look={look} />;
    return <ClassicHome brand={brand} copy={copy} look={look} />;
}
