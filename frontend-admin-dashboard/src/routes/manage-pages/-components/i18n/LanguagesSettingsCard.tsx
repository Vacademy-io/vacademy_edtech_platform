import { useMemo, useState } from 'react';
import { Plus, Trash as Trash2, Translate } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import {
    SearchableSelect,
    type SearchableSelectOption,
} from '@/components/design-system/searchable-select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import { SUPPORTED_LOCALES } from '@/i18n/locales';
import {
    baseLocaleOf,
    localesOf,
    type CatalogueI18nSettings,
    type CatalogueLocale,
} from '../../-utils/catalogue-i18n';
import type { CatalogueConfig } from '../../-types/editor-types';
import { languageName } from '../../-hooks/use-localized-editing';
import { siteCoverage } from './site-strings';
import { TranslationsPanel } from './TranslationsPanel';

/** What the visitor's switch shows by default ("हिन्दी | EN"). */
export const defaultSwitchLabel = (code: string): string =>
    code === 'en' ? 'EN' : languageName(code);

const languageOptions = (codes: readonly string[]): SearchableSelectOption[] =>
    codes.map((code) => ({ label: `${languageName(code)} (${code})`, value: code }));

/**
 * Global Settings → Languages: which languages the site offers, its base
 * language and how far each translation has got. It edits only enabled /
 * defaultLocale / locales — the translations themselves (`strings`) are never
 * rewritten from here, not even when a language is removed.
 */
export const LanguagesSettingsCard = ({
    config,
    i18n,
    onChange,
}: {
    config: CatalogueConfig;
    i18n: CatalogueI18nSettings | undefined;
    onChange: (next: CatalogueI18nSettings) => void;
}) => {
    const [panelLocale, setPanelLocale] = useState<string | null>(null);
    const base = baseLocaleOf(i18n);
    // The label exactly as stored — untrimmed, possibly empty — for a language
    // in the stored list (undefined when it is not stored). localesOf trims it
    // and falls back to the code; that happens only where visitors see it.
    const storedLabel = (code: string): string | undefined => {
        const entry = i18n?.locales?.find(
            (l) => typeof l?.code === 'string' && l.code.trim().toLowerCase() === code
        );
        if (!entry) return undefined;
        return typeof entry.label === 'string' ? entry.label : '';
    };
    // The stored list, or just the base language until a second one is added
    // (localesOf would otherwise invent the en/hi default). Codes normalized,
    // labels kept as stored, so saving one change never rewrites another label.
    const offered: CatalogueLocale[] = i18n?.locales?.length
        ? localesOf(i18n).map((l) => ({ ...l, label: storedLabel(l.code) ?? l.label }))
        : [{ code: base, label: defaultSwitchLabel(base) }];
    const enabled = !!i18n?.enabled;
    const coverage = useMemo(
        () => (offered.length > 1 ? siteCoverage(config) : []),
        [config, offered.length]
    );

    const commit = (patch: Partial<CatalogueI18nSettings>) =>
        onChange({ ...(i18n || {}), ...patch });

    const setLocales = (locales: CatalogueLocale[]) => commit({ defaultLocale: base, locales });

    const changeBase = (code: string) => {
        if (!code || code === base) return;
        const rest = offered.filter((l) => l.code !== code);
        const entry = offered.find((l) => l.code === code) || {
            code,
            label: defaultSwitchLabel(code),
        };
        commit({ defaultLocale: code, locales: [entry, ...rest] });
    };

    const addLanguage = (code: string) => {
        if (!code || offered.some((l) => l.code === code)) return;
        setLocales([...offered, { code, label: defaultSwitchLabel(code) }]);
    };

    // Stored as typed ('Hindi (हिन्दी)' needs its spaces mid-typing).
    const setLabel = (code: string, label: string) =>
        setLocales(offered.map((l) => (l.code === code ? { ...l, label } : l)));

    const removeLanguage = (code: string) => {
        const locales = offered.filter((l) => l.code !== code);
        // A single language leaves nothing to switch between: the visitor
        // switch goes off too. Translations are kept for when one is re-added.
        commit({
            defaultLocale: base,
            locales,
            ...(enabled && locales.length < 2 ? { enabled: false } : {}),
        });
    };

    const addable = SUPPORTED_LOCALES.filter((code) => !offered.some((l) => l.code === code));

    return (
        <div className="space-y-3 rounded-lg border bg-gray-50 p-4">
            <h4 className="font-medium text-gray-700">Languages</h4>
            <p className="text-caption text-gray-500">
                Offer the site in more than one language. Pages stay written in the base language;
                every other language is a translation of their texts.
            </p>

            <div className="flex items-center justify-between gap-2">
                <Label htmlFor="site-languages-enabled">Show the language switch to visitors</Label>
                <Switch
                    id="site-languages-enabled"
                    checked={enabled}
                    disabled={!enabled && offered.length < 2}
                    onCheckedChange={(c) =>
                        commit({ enabled: c, defaultLocale: base, locales: offered })
                    }
                />
            </div>
            {!enabled && offered.length < 2 && (
                <p className="text-caption text-gray-400">
                    Add a second language below to switch this on.
                </p>
            )}

            <div className="space-y-1">
                <Label className="text-xs">Base language</Label>
                <SearchableSelect
                    options={languageOptions(SUPPORTED_LOCALES)}
                    value={base}
                    onChange={changeBase}
                    placeholder="Choose the base language"
                    searchPlaceholder="Search languages…"
                    emptyText="No language found."
                />
                <p className="text-caption text-gray-400">
                    The language the page texts are written in. Changing it does not translate
                    anything.
                </p>
            </div>

            <div className="space-y-2">
                <Label className="text-xs">Languages offered</Label>
                {offered.map((locale) => {
                    const isBase = locale.code === base;
                    const cov = coverage.find((c) => c.code === locale.code);
                    return (
                        <div
                            key={locale.code}
                            className="space-y-2 rounded-md border border-neutral-200 bg-white p-2"
                        >
                            <div className="flex items-center gap-2">
                                <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-700">
                                    {languageName(locale.code, locale.label)}
                                    {isBase && (
                                        <span className="ms-1 text-caption font-normal text-gray-400">
                                            (base)
                                        </span>
                                    )}
                                </span>
                                {!isBase && (
                                    <MyButton
                                        buttonType="text"
                                        layoutVariant="icon"
                                        scale="small"
                                        className="shrink-0 text-danger-600"
                                        onClick={() => removeLanguage(locale.code)}
                                        aria-label={`Stop offering ${languageName(locale.code)}`}
                                        title="Stop offering this language (its translations are kept)"
                                    >
                                        <Trash2 className="size-4" />
                                    </MyButton>
                                )}
                            </div>
                            <div className="flex items-center gap-2">
                                <Label
                                    className="shrink-0 text-caption text-gray-500"
                                    htmlFor={`switch-label-${locale.code}`}
                                >
                                    Switch label
                                </Label>
                                <Input
                                    id={`switch-label-${locale.code}`}
                                    className="h-7 text-xs"
                                    value={locale.label}
                                    onChange={(e) => setLabel(locale.code, e.target.value)}
                                    placeholder={defaultSwitchLabel(locale.code)}
                                />
                            </div>
                            {cov && (
                                <div className="space-y-1">
                                    <div className="flex items-center justify-between text-caption text-gray-500">
                                        <span>
                                            {cov.total === 0
                                                ? 'No texts to translate yet'
                                                : `${cov.translated} of ${cov.total} texts translated`}
                                        </span>
                                        {cov.total > 0 && <span>{cov.percent}%</span>}
                                    </div>
                                    {cov.total > 0 && (
                                        <Progress value={cov.percent} className="h-1.5" />
                                    )}
                                    <MyButton
                                        buttonType="secondary"
                                        scale="small"
                                        className="w-full gap-1"
                                        onClick={() => setPanelLocale(locale.code)}
                                    >
                                        <Translate className="size-4" /> Translations
                                    </MyButton>
                                </div>
                            )}
                        </div>
                    );
                })}
                {addable.length > 0 && (
                    <SearchableSelect
                        options={languageOptions(addable)}
                        value=""
                        onChange={addLanguage}
                        placeholder="Add a language"
                        searchPlaceholder="Search languages…"
                        emptyText="No language found."
                    />
                )}
                {offered.length < 2 && (
                    <p className="flex items-center gap-1 text-caption text-gray-400">
                        <Plus className="size-3" /> Add हिन्दी (or any language) to start
                        translating.
                    </p>
                )}
            </div>

            {offered.length > 1 && (
                <p className="text-caption text-gray-400">
                    Tip: switch &ldquo;Editing&rdquo; at the top of the editor to a language to
                    translate each page right on the canvas.
                </p>
            )}

            {panelLocale && (
                <TranslationsPanel
                    open
                    initialLocale={panelLocale}
                    onOpenChange={(open) => !open && setPanelLocale(null)}
                />
            )}
        </div>
    );
};
