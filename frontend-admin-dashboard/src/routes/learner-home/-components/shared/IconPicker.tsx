import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { isShortcutIconName, SHORTCUT_ICON_NAMES } from '../../-utils/icons';
import { SHORTCUT_ICON_COMPONENTS } from './icon-map';

/** Grid of the 40 curated shortcut icons (spec 7.5). */
export function IconPicker({
    id,
    value,
    onChange,
}: {
    id: string;
    value: string;
    onChange: (name: string) => void;
}) {
    const { t } = useTranslation('learnerHome');
    const [open, setOpen] = useState(false);
    const Current = isShortcutIconName(value) ? SHORTCUT_ICON_COMPONENTS[value] : null;
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button
                    id={id}
                    type="button"
                    className="flex size-12 items-center justify-center rounded-full bg-primary-50 text-primary-500 ring-offset-2 hover:bg-primary-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={Current ? t('icons.current', { name: value }) : t('icons.pick')}
                >
                    {Current ? (
                        <Current className="size-6" weight="duotone" />
                    ) : (
                        <span aria-hidden>?</span>
                    )}
                </button>
            </PopoverTrigger>
            <PopoverContent className="w-72 p-2" align="start">
                <p className="px-1 pb-2 text-caption font-semibold text-neutral-600">
                    {t('icons.pick')}
                </p>
                <div role="listbox" aria-label={t('icons.pick')} className="grid grid-cols-6 gap-1">
                    {SHORTCUT_ICON_NAMES.map((name) => {
                        const Icon = SHORTCUT_ICON_COMPONENTS[name];
                        const selected = name === value;
                        return (
                            <button
                                key={name}
                                type="button"
                                role="option"
                                aria-selected={selected}
                                title={name}
                                aria-label={name}
                                onClick={() => {
                                    onChange(name);
                                    setOpen(false);
                                }}
                                className={cn(
                                    'flex size-10 items-center justify-center rounded-md text-neutral-700 hover:bg-primary-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                    selected && 'bg-primary-100 text-primary-500'
                                )}
                            >
                                <Icon className="size-5" weight="duotone" />
                            </button>
                        );
                    })}
                </div>
            </PopoverContent>
        </Popover>
    );
}
