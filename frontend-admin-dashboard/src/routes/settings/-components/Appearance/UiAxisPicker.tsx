import { cn } from '@/lib/utils';

/**
 * Segmented option picker with a live preview per option, used by the
 * Appearance tab's learner presentation axes (corners / density / gradient)
 * and the learner UI skin.
 *
 * The previews are pure markup driven by the option's own token values rather
 * than by the admin app's live CSS variables: these axes deliberately do NOT
 * apply to the admin dashboard's own chrome (an operator's tooling should not
 * reshape itself because a tenant picked "pill"), so the only way to show an
 * operator what they are choosing is to render a scale model of it.
 */

export interface AxisOption<T extends string> {
    value: T;
    label: string;
    description?: string;
    /** Rendered inside a fixed-height preview well above the label. */
    preview: React.ReactNode;
}

interface UiAxisPickerProps<T extends string> {
    options: ReadonlyArray<AxisOption<T>>;
    value: T;
    onChange: (value: T) => void;
    /** Accessible group label (the visible heading is rendered by the caller). */
    ariaLabel: string;
}

export function UiAxisPicker<T extends string>({
    options,
    value,
    onChange,
    ariaLabel,
}: UiAxisPickerProps<T>) {
    return (
        <div
            role="radiogroup"
            aria-label={ariaLabel}
            className="grid grid-cols-2 gap-3 sm:grid-cols-3"
        >
            {options.map((option) => {
                const selected = option.value === value;
                return (
                    <button
                        key={option.value}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => onChange(option.value)}
                        className={cn(
                            'flex flex-col gap-2 rounded-lg border-2 p-3 text-start transition-colors',
                            selected
                                ? 'border-primary-500 bg-primary-50'
                                : 'border-neutral-200 bg-white hover:border-neutral-300'
                        )}
                    >
                        <div className="flex h-14 items-center justify-center rounded-md bg-neutral-50 p-2">
                            {option.preview}
                        </div>
                        <div>
                            <div className="text-sm font-medium text-neutral-700">
                                {option.label}
                            </div>
                            {option.description ? (
                                <div className="text-xs text-neutral-500">{option.description}</div>
                            ) : null}
                        </div>
                    </button>
                );
            })}
        </div>
    );
}

/* ------------------------------------------------------------------ */
/* Preview primitives                                                  */
/* ------------------------------------------------------------------ */

/** Corner preview: a card-shaped swatch at the radius that option produces. */
export function CornerPreview({ radiusPx }: { radiusPx: number }) {
    return (
        <div
            className="size-10 border-2 border-primary-400 bg-primary-100"
            style={{ /* design-lint-ignore: swatch renders the axis value being previewed, not an app token */ borderRadius: `${radiusPx}px` }}
        />
    );
}

/**
 * Density preview: a mock card whose padding and internal row gap track the
 * option's own values, which is exactly what the axis moves.
 */
export function DensityPreview({ padPx, gapPx }: { padPx: number; gapPx: number }) {
    return (
        <div
            className="flex w-full flex-col rounded border border-neutral-300 bg-white"
            style={{ /* design-lint-ignore: preview renders the option's own spacing */ padding: `${padPx}px`, gap: `${gapPx}px` }}
        >
            <div className="h-1.5 w-3/4 rounded-full bg-primary-300" />
            <div className="h-1.5 w-full rounded-full bg-neutral-200" />
            <div className="h-1.5 w-2/3 rounded-full bg-neutral-200" />
        </div>
    );
}

/** Gradient preview: the two stops that option collapses to. */
export function GradientPreview({ from, to }: { from: string; to: string }) {
    return (
        <div
            className="size-10 rounded-md border border-neutral-300"
            style={{ /* design-lint-ignore: preview renders the institute's brand ramp stops */ backgroundImage: `linear-gradient(to bottom right, ${from}, ${to})` }}
        />
    );
}

/** Skin preview: a miniature of the skin's signature surface treatment. */
export function SkinPreview({
    radiusPx,
    accent,
    bold,
    elevated,
}: {
    radiusPx: number;
    accent: string;
    bold?: boolean;
    /** Raised white surface with a soft layered shadow and a quiet edge —
     *  the defining cue of the Corporate skin (layering, not outlines). */
    elevated?: boolean;
}) {
    return (
        <div className="flex w-full flex-col gap-1.5 px-1">
            <div
                className={cn(
                    'h-4 w-full border bg-white',
                    elevated ? 'border-neutral-200 shadow-sm' : 'border-neutral-300'
                )}
                style={{ /* design-lint-ignore: preview renders the skin's own radius */ borderRadius: `${radiusPx}px` }}
            />
            <div
                className="h-3 w-2/3"
                style={{ /* design-lint-ignore: preview renders the skin's own radius/accent */
                    borderRadius: `${radiusPx}px`,
                    backgroundColor: accent,
                    boxShadow: bold ? `0 2px 0 rgba(0,0,0,0.18)` : undefined,
                }}
            />
        </div>
    );
}
