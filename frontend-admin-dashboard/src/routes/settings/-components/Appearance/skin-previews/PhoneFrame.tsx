import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Every skin model is drawn at a real phone's size, in the learner app's own
 * pixels, so its type, corners and spacing are the learner app's numbers.
 * PhoneFrame shrinks it to whatever width the frame gets with CSS zoom, which
 * also scales the layout box (a transform would not), so the frame needs no
 * left/right origin and works the same in RTL.
 */
export const MODEL_WIDTH = 390;
export const MODEL_HEIGHT = 720;

interface PhoneFrameProps {
    children: ReactNode;
    /** 'sm' for a picker card, 'lg' for the big preview. */
    size: 'sm' | 'lg';
    className?: string;
}

/** Width used before the frame is measured (and in tests, where nothing is). */
const FALLBACK_WIDTH = { sm: 150, lg: 300 } as const;

export function PhoneFrame({ children, size, className }: PhoneFrameProps) {
    const screenRef = useRef<HTMLDivElement>(null);
    const [width, setWidth] = useState<number>(FALLBACK_WIDTH[size]);

    useLayoutEffect(() => {
        const el = screenRef.current;
        if (!el) return;
        const measure = () => {
            if (el.clientWidth > 0) setWidth(el.clientWidth);
        };
        measure();
        if (typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver(measure);
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    // The model's real size, zoomed to the measured width: the one dynamic value here.
    const modelBox: CSSProperties = {
        width: MODEL_WIDTH,
        height: MODEL_HEIGHT,
        zoom: width / MODEL_WIDTH,
    };

    return (
        <div
            aria-hidden="true"
            className={cn(
                'w-full bg-neutral-800 shadow-sm',
                size === 'lg' ? 'rounded-3xl p-2' : 'rounded-2xl p-1',
                className
            )}
        >
            <div
                ref={screenRef}
                className={cn(
                    'aspect-[390/720] w-full overflow-hidden bg-white',
                    size === 'lg' ? 'rounded-2xl' : 'rounded-xl'
                )}
            >
                <div className="relative overflow-hidden" style={modelBox}>
                    {children}
                </div>
            </div>
        </div>
    );
}
