import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HeaderChoice, HeaderToggle } from './HeaderEditorFields';
import { LinkPicker } from '../LinkPicker';

type LogoClick = 'home' | 'other' | 'none';

/** "" / unset = the site's home page, "none" = not a link, anything else = a page or URL. */
const logoClickOf = (value: unknown): LogoClick => {
    const v = typeof value === 'string' ? value.trim() : '';
    if (!v) return 'home';
    return v.toLowerCase() === 'none' ? 'none' : 'other';
};

/**
 * Header-wide options: how the current page's nav item is marked, the site
 * search icon, the language switch and where the logo leads. Each is off (or
 * the original look) until set, so existing headers look as they always have;
 * the logo leads to the home page unless the site points it elsewhere.
 */
export const HeaderDisplayOptions = ({
    props,
    onChange,
}: {
    props: Record<string, unknown>;
    onChange: (
        key: 'activeStyle' | 'showSearch' | 'showLanguageSwitcher' | 'logoLink',
        value: unknown
    ) => void;
}) => {
    const { t } = useTranslation('managePagesPropertyPanel');
    // "Another page or link" with nothing picked yet must stay selected.
    const [logoClick, setLogoClick] = useState<LogoClick>(() => logoClickOf(props.logoLink));
    const logoLink = typeof props.logoLink === 'string' ? props.logoLink : '';
    return (
        <div className="space-y-3 rounded border border-neutral-200 p-3">
            <p className="text-sm font-medium">{t('headerExtras.heading')}</p>
            <HeaderChoice
                label={t('headerExtras.currentPage')}
                value={props.activeStyle === 'underline' ? 'underline' : 'pill'}
                options={[
                    { value: 'pill', label: t('headerExtras.tintedPill') },
                    { value: 'underline', label: t('headerExtras.underline') },
                ]}
                onChange={(v) => onChange('activeStyle', v)}
            />
            <HeaderToggle
                label={t('headerExtras.search')}
                hint={t('headerExtras.searchHint')}
                checked={props.showSearch === true}
                onChange={(v) => onChange('showSearch', v)}
            />
            <HeaderToggle
                label={t('headerExtras.languageSwitch')}
                hint={t('headerExtras.languageSwitchHint')}
                checked={props.showLanguageSwitcher === true}
                onChange={(v) => onChange('showLanguageSwitcher', v)}
            />
            <HeaderChoice<LogoClick>
                label={t('headerExtras.logoClick')}
                hint={t('headerExtras.logoClickHint')}
                value={logoClick}
                options={[
                    { value: 'home', label: t('headerExtras.logoHome') },
                    { value: 'other', label: t('headerExtras.logoOther') },
                    { value: 'none', label: t('headerExtras.logoNone') },
                ]}
                onChange={(v) => {
                    setLogoClick(v);
                    if (v === 'home') onChange('logoLink', undefined);
                    else if (v === 'none') onChange('logoLink', 'none');
                    else if (logoClickOf(props.logoLink) !== 'other') onChange('logoLink', undefined);
                }}
            />
            {logoClick === 'other' && (
                <LinkPicker
                    label={t('headerExtras.logoTarget')}
                    value={logoClickOf(logoLink) === 'other' ? logoLink : ''}
                    onChange={(v) => onChange('logoLink', v.trim() ? v : undefined)}
                />
            )}
        </div>
    );
};

export default HeaderDisplayOptions;
