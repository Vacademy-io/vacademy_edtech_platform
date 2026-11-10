import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
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
 * the cards (below them on a phone) with Home, Lesson and Quiz result views.
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

    const Selected = SKIN_MODELS[value] ?? SKIN_MODELS.default;
    const selectedLabel = t(`learnerUi.skin.${value}`);

    return (
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
            <div
                role="radiogroup"
                aria-label={t('learnerUi.skin.label')}
                className="grid min-w-0 flex-1 grid-cols-2 gap-3 sm:grid-cols-3"
            >
                {SKIN_ORDER.map((skin, index) => {
                    const Model = SKIN_MODELS[skin];
                    const selected = skin === value;
                    return (
                        <button
                            key={skin}
                            ref={(el) => {
                                radios.current[index] = el;
                            }}
                            type="button"
                            role="radio"
                            aria-checked={selected}
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
                            <span
                                className={cn(
                                    'px-1 text-sm text-neutral-800',
                                    selected ? 'font-semibold' : 'font-medium'
                                )}
                            >
                                {t(`learnerUi.skin.${skin}`)}
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
                className="flex flex-col gap-3 rounded-xl border border-neutral-200 bg-neutral-50 p-4 lg:sticky lg:top-4 lg:w-96 lg:shrink-0"
            >
                <div>
                    <h4 id={`${id}-title`} className="text-sm font-semibold text-neutral-800">
                        {t('learnerUi.skin.previewTitle', { skin: selectedLabel })}
                    </h4>
                    <p className="mt-1 text-sm text-neutral-600">
                        {t(`learnerUi.skin.blurb.${value}`)}
                    </p>
                    {value === 'fun' ? (
                        <p className="mt-2 flex items-start gap-1.5 text-xs text-neutral-500">
                            <Info size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                            {t('learnerUi.skin.funFallback')}
                        </p>
                    ) : null}
                </div>
                <div
                    role="tablist"
                    aria-label={t('learnerUi.skin.screensLabel')}
                    className="grid grid-cols-3 gap-1 rounded-lg border border-neutral-200 bg-white p-1"
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
                                    'min-h-11 rounded-md px-2 text-sm transition-colors',
                                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
                                    on
                                        ? 'bg-neutral-100 font-semibold text-neutral-900 shadow-sm'
                                        : 'font-medium text-neutral-600 hover:bg-neutral-50'
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
