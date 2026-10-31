import { Translate } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { baseLocaleOf, type CatalogueI18nSettings } from '../../-utils/catalogue-i18n';
import {
    activeEditingLocale,
    editableLocalesOf,
    languageName,
} from '../../-hooks/use-localized-editing';

/**
 * "Editing: English | हिन्दी" — which language the canvas and the property
 * panel show and edit. Offered once the site has two or more languages (even
 * before the visitor switch goes live, so translations can be prepared).
 * Styled as the neighbouring Visual / JSON segmented control.
 */
export const EditingLanguageToggle = ({
    i18n,
    editingLocale,
    onChange,
}: {
    i18n: CatalogueI18nSettings | undefined;
    editingLocale: string | null;
    onChange: (locale: string | null) => void;
}) => {
    const locales = editableLocalesOf(i18n);
    if (locales.length < 2) return null;
    const base = baseLocaleOf(i18n);
    const active = activeEditingLocale(i18n, editingLocale) ?? base;

    return (
        <div className="flex items-center gap-1.5" role="group" aria-label="Language being edited">
            <Translate className="size-4 text-gray-500" aria-hidden />
            <span className="text-xs text-gray-500">Editing:</span>
            <div className="flex rounded-lg border bg-gray-100 p-0.5">
                {locales.map((locale) => (
                    <Button
                        key={locale.code}
                        variant={active === locale.code ? 'secondary' : 'ghost'}
                        size="sm"
                        aria-pressed={active === locale.code}
                        onClick={() => onChange(locale.code === base ? null : locale.code)}
                        title={
                            locale.code === base
                                ? 'Edit the site in its base language'
                                : `Translate the site into ${languageName(locale.code, locale.label)}: text edits become translations`
                        }
                    >
                        {languageName(locale.code, locale.label)}
                    </Button>
                ))}
            </div>
        </div>
    );
};
