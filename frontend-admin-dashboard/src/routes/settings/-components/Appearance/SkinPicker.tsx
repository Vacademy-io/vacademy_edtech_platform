import { useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Info } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import type { StudentUiType } from '@/types/theme-role-settings';
import {
    MODEL_SCREENS,
    PhoneFrame,
    SKIN_MODELS,
    SKIN_ORDER,
    brandPalette,
    type ModelCopy,
    type ModelScreen,
} from './skin-previews';

/**
 * The learner skin choice. Each option is a card holding a small phone with
 * the learner home drawn in that skin, so an admin can see what learners
 * will get before saving; a larger preview of the chosen skin sits beside
 * the cards (below them when the picker is narrow) with Home, Lesson and
 * Quiz result views. The layout follows the picker's own width, not the
 * window's, because the editor also sits in narrow columns (beside a live
 * preview, or next to the settings sidebar on a small laptop).
 *
 * Presentation only: the value goes straight back through onChange and the
 * editor saves it as before.
 */

interface SkinPickerProps {
    value: StudentUiType;
    onChange: (value: StudentUiType) => void;
    /** The brand colour the editor is previewing (may be an unsaved custom one). */
    brandHex: string;
}

/** Arrow keys move through a radio group or tab list; RTL swaps left and right. */
function stepFor(event: KeyboardEvent<HTMLElement>): number | 'first' | 'last' | null {
    const rtl = getComputedStyle(event.currentTarget).direction === 'rtl';
    switch (event.key) {
        case 'ArrowDown':
            return 1;
        case 'ArrowUp':
            return -1;
        case 'ArrowRight':
            return rtl ? -1 : 1;
        case 'ArrowLeft':
            return rtl ? 1 : -1;
        case 'Home':
            return 'first';
        case 'End':
            return 'last';
        default:
            return null;
    }
}

/** Side by side from this picker width; the preview is narrower below WIDE_AT. */
const SIDE_AT = 680;
const WIDE_AT = 880;
/** Preview panel width plus the gap, for each side-by-side size (w-72, w-96 + gap-6). */
const PREVIEW_SPACE = { narrow: 288 + 24, wide: 384 + 24 } as const;
/** Three cards a row once each can be about 136px wide; two below that. */
const THREE_COLUMNS_AT = 432;

export type SkinPickerLayout = 'stacked' | 'side' | 'side-wide';

/** Pick the layout and card columns from the picker's measured width. */
export function skinPickerLayout(width: number): { layout: SkinPickerLayout; columns: 2 | 3 } {
    const layout: SkinPickerLayout =
        width >= WIDE_AT ? 'side-wide' : width >= SIDE_AT ? 'side' : 'stacked';
    const grid =
        layout === 'side-wide'
            ? width - PREVIEW_SPACE.wide
            : layout === 'side'
              ? width - PREVIEW_SPACE.narrow
              : width;
    return { layout, columns: grid >= THREE_COLUMNS_AT ? 3 : 2 };
}

/** The element's width, kept current. 0 until measured, so the first paint is stacked. */
function useWidth<T extends HTMLElement>() {
    const ref = useRef<T>(null);
    const [width, setWidth] = useState(0);
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        const measure = () => setWidth(el.clientWidth);
        measure();
        if (typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver(measure);
        observer.observe(el);
        return () => observer.disconnect();
    }, []);
    return [ref, width] as const;
}

function nextIndex(step: number | 'first' | 'last', from: number, count: number) {
    if (step === 'first') return 0;
    if (step === 'last') return count - 1;
    return (from + step + count) % count;
}

export function SkinPicker({ value, onChange, brandHex }: SkinPickerProps) {
    const { t } = useTranslation('settingsThemeEditor');
    const brand = useMemo(() => brandPalette(brandHex), [brandHex]);
    const name = t('learnerUi.skin.model.name');
    const copy: ModelCopy = {
        greeting: t('learnerUi.skin.model.greeting'),
        greetingName: t('learnerUi.skin.model.greetingName', { name }),
        name,
        continueLabel: t('learnerUi.skin.model.continue'),
        nextLabel: t('learnerUi.skin.model.next'),
        passed: t('learnerUi.skin.model.passed'),
    };

    const [screen, setScreen] = useState<ModelScreen>('home');
    const radios = useRef<Array<HTMLButtonElement | null>>([]);
    const tabs = useRef<Array<HTMLButtonElement | null>>([]);
    const id = useId();

    // Exactly one option is in the Tab order: the chosen one, or the first.
    const tabStop = Math.max(0, SKIN_ORDER.indexOf(value));

    const onRadioKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
        const step = stepFor(event);
        if (step === null) return;
        event.preventDefault();
        const next = nextIndex(step, index, SKIN_ORDER.length);
        onChange(SKIN_ORDER[next]!);
        radios.current[next]?.focus();
    };

    const onTabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
        const step = stepFor(event);
        if (step === null) return;
        event.preventDefault();
        const next = nextIndex(step, index, MODEL_SCREENS.length);
        setScreen(MODEL_SCREENS[next]!);
        tabs.current[next]?.focus();
    };

    // A saved value this editor does not know is previewed as Default; the
    // value itself still goes back unchanged.
    const shown: StudentUiType = SKIN_ORDER.includes(value) ? value : 'default';
    const Selected = SKIN_MODELS[shown];
    const selectedLabel = t(`learnerUi.skin.${shown}`);

    const [rootRef, width] = useWidth<HTMLDivElement>();
    const { layout, columns } = skinPickerLayout(width);
    const side = layout !== 'stacked';

    return (
        <div
            ref={rootRef}
            data-layout={layout}
            className={cn('flex gap-6', side ? 'flex-row items-start' : 'flex-col')}
        >
            <div
                role="radiogroup"
                aria-label={t('learnerUi.skin.label')}
                data-columns={columns}
                className={cn(
                    'grid min-w-0 flex-1 gap-3',
                    columns === 3 ? 'grid-cols-3' : 'grid-cols-2'
                )}
            >
                {SKIN_ORDER.map((skin, index) => {
                    const Model = SKIN_MODELS[skin];
                    const selected = skin === value;
                    const cueId = `${id}-cue-${skin}`;
                    return (
                        <button
                            key={skin}
                            ref={(el) => {
                                radios.current[index] = el;
                            }}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            aria-describedby={cueId}
                            tabIndex={index === tabStop ? 0 : -1}
                            onClick={() => onChange(skin)}
                            onKeyDown={(event) => onRadioKey(event, index)}
                            className={cn(
                                'relative flex min-w-0 flex-col gap-2 rounded-xl border-2 p-2 text-start transition-colors',
                                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2',
                                selected
                                    ? 'border-primary-500 bg-primary-50'
                                    : 'border-neutral-200 bg-white hover:border-neutral-300'
                            )}
                        >
                            <PhoneFrame size="sm">
                                <Model screen="home" brand={brand} copy={copy} />
                            </PhoneFrame>
                            <span className="flex flex-col gap-0.5 px-1">
                                <span
                                    className={cn(
                                        'text-sm text-neutral-800',
                                        selected ? 'font-semibold' : 'font-medium'
                                    )}
                                >
                                    {t(`learnerUi.skin.${skin}`)}
                                </span>
                                {/* A short cue, read as the radio's description, not its name. */}
                                <span
                                    id={cueId}
                                    aria-hidden="true"
                                    className="text-xs leading-snug text-neutral-500"
                                >
                                    {t(`learnerUi.skin.cue.${skin}`)}
                                </span>
                            </span>
                            {selected ? (
                                <span
                                    aria-hidden="true"
                                    className="absolute end-1 top-1 flex size-7 items-center justify-center rounded-full bg-primary-500 text-white shadow-md ring-2 ring-white"
                                >
                                    <Check size={16} weight="bold" />
                                </span>
                            ) : null}
                        </button>
                    );
                })}
            </div>

            <section
                aria-labelledby={`${id}-title`}
                className={cn(
                    'flex flex-col gap-3 rounded-xl border border-neutral-200 bg-neutral-50 p-4',
                    layout === 'side-wide' && 'sticky top-4 w-96 shrink-0',
                    layout === 'side' && 'sticky top-4 w-72 shrink-0'
                )}
            >
                <div>
                    <h4 id={`${id}-title`} className="text-sm font-semibold text-neutral-800">
                        {t('learnerUi.skin.previewTitle', { skin: selectedLabel })}
                    </h4>
                    <p id={`${id}-blurb`} className="mt-1 text-sm text-neutral-600">
                        {t(`learnerUi.skin.blurb.${shown}`)}
                    </p>
                    {shown === 'fun' ? (
                        <p className="mt-2 flex items-start gap-1.5 text-xs text-neutral-500">
                            <Info size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                            {t('learnerUi.skin.funFallback')}
                        </p>
                    ) : null}
                </div>
                <div
                    role="tablist"
                    aria-label={t('learnerUi.skin.screensLabel')}
                    className="grid grid-cols-3 gap-1 rounded-lg bg-neutral-200/70 p-1"
                >
                    {MODEL_SCREENS.map((s, index) => {
                        const on = s === screen;
                        return (
                            <button
                                key={s}
                                ref={(el) => {
                                    tabs.current[index] = el;
                                }}
                                id={`${id}-tab-${s}`}
                                type="button"
                                role="tab"
                                aria-selected={on}
                                aria-controls={`${id}-panel`}
                                tabIndex={on ? 0 : -1}
                                onClick={() => setScreen(s)}
                                onKeyDown={(event) => onTabKey(event, index)}
                                className={cn(
                                    'min-h-11 rounded-md px-2 text-sm leading-tight transition-colors',
                                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
                                    on
                                        ? 'bg-white font-semibold text-primary-700 shadow-sm'
                                        : 'font-medium text-neutral-600 hover:bg-white/60 hover:text-neutral-800'
                                )}
                            >
                                {t(`learnerUi.skin.screens.${s}`)}
                            </button>
                        );
                    })}
                </div>
                <div
                    role="tabpanel"
                    id={`${id}-panel`}
                    aria-labelledby={`${id}-tab-${screen}`}
                    // The phone is drawn for the eye; the skin's description says it in words.
                    aria-describedby={`${id}-blurb`}
                    className="flex justify-center"
                >
                    <div className="w-full max-w-xs">
                        <PhoneFrame size="lg">
                            <Selected screen={screen} brand={brand} copy={copy} />
                        </PhoneFrame>
                    </div>
                </div>
            </section>
        </div>
    );
}
