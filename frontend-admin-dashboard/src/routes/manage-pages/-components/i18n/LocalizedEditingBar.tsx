import { useEffect } from 'react';
import { Translate, WarningCircle, X } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { baseLocaleOf, type CatalogueI18nSettings } from '../../-utils/catalogue-i18n';
import {
    languageName,
    localizedBlockMessage,
    useLocalizedEditNotice,
} from '../../-hooks/use-localized-editing';

/** How long a "that edit was not applied" notice stays up. */
const NOTICE_MS = 8000;

/**
 * Sits above the property panel while another language is being edited: says
 * what edits do in this mode, and explains any edit that was refused (empty
 * base text, shared values, several texts at once). Sticky, so a refusal is
 * visible even when the field that caused it is scrolled far down the panel.
 */
export const LocalizedEditingBar = ({
    i18n,
    locale,
    globalSettingsSelected,
}: {
    i18n: CatalogueI18nSettings | undefined;
    locale: string;
    globalSettingsSelected: boolean;
}) => {
    const notice = useLocalizedEditNotice((s) => s.notice);
    const clear = useLocalizedEditNotice((s) => s.clear);
    const baseName = languageName(baseLocaleOf(i18n));
    const name = languageName(locale, i18n?.locales?.find((l) => l.code === locale)?.label);

    useEffect(() => {
        if (!notice) return;
        const t = window.setTimeout(clear, NOTICE_MS);
        return () => window.clearTimeout(t);
    }, [notice, clear]);

    // A notice from an earlier session of this mode is stale.
    useEffect(() => () => clear(), [clear]);

    return (
        <div className="sticky top-0 z-10 space-y-2 border-b border-primary-100 bg-primary-50 px-4 py-2">
            <p className="flex items-start gap-1.5 text-caption text-primary-500">
                <Translate className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                <span>
                    {globalSettingsSelected
                        ? `Editing ${name}. Site settings are shared by every language.`
                        : `Editing ${name}: text you type is saved as the ${name} translation. Layout, links, images and settings stay shared with ${baseName}.`}
                </span>
            </p>
            {notice && (
                <div
                    role="alert"
                    className="flex items-start gap-1.5 rounded-md border border-warning-200 bg-warning-50 p-2 text-caption text-warning-700"
                >
                    <WarningCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                    <span className="flex-1">{localizedBlockMessage(notice.reason, baseName)}</span>
                    <MyButton
                        buttonType="text"
                        layoutVariant="icon"
                        scale="small"
                        className="shrink-0 text-warning-700"
                        onClick={clear}
                        aria-label="Dismiss"
                    >
                        <X className="size-3" />
                    </MyButton>
                </div>
            )}
        </div>
    );
};
