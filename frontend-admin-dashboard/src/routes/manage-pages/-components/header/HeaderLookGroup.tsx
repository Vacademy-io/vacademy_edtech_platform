import type { FC } from 'react';
import { useTranslation } from 'react-i18next';
import { HeaderToggle } from './HeaderEditorFields';
import { LookChoice, useSiteHasPalette } from '../chrome/chrome-controls';

/** Header props are hand- or AI-written JSON: read them as unknown and narrow. */
type Props = Record<string, unknown>;

export interface HeaderLookGroupProps {
    /** The header props. */
    props: Props;
    /** Writes one header prop, keeping every other prop. */
    onChange: (key: string, value: unknown) => void;
}

/** The keys this group edits; any one of them set shows the group. */
const LOOK_KEYS = [
    'navStyle',
    'barSize',
    'contentWidth',
    'logoOnly',
    'languageSwitcherStyle',
    'cartDisplay',
    'megaMenuStyle',
] as const;

const hasMegaMenu = (navigation: unknown) =>
    Array.isArray(navigation) &&
    navigation.some((item) => (item as { type?: unknown } | null)?.type === 'megaMenu');

/**
 * The header's "Look" options (nav style, bar size, width, logo only,
 * language switch style, cart icon, mega-menu style). PropertyPanel mounts it
 * for every header, right after HeaderDisplayOptions; it shows only on a site
 * with its own palette or a header that already sets one of these keys, so
 * other institutes see no change. An unset option shows
 * the original look and nothing is written until the admin changes a
 * control. The language-switch and mega-menu styles appear only once the
 * header has a language switch or a mega menu.
 */
export const HeaderLookGroup: FC<HeaderLookGroupProps> = ({ props, onChange }) => {
    const { t } = useTranslation('managePagesPropertyPanel');
    const hasPalette = useSiteHasPalette();
    if (!hasPalette && LOOK_KEYS.every((k) => props[k] === undefined)) return null;
    const standard = t('headerLook.standard');
    const editorial = t('headerLook.editorial');
    const showSwitchStyle =
        props.showLanguageSwitcher === true || props.languageSwitcherStyle !== undefined;
    const showMegaStyle = hasMegaMenu(props.navigation) || props.megaMenuStyle !== undefined;

    return (
        <div className="space-y-3 rounded border border-neutral-200 p-3">
            <p className="text-sm font-medium">{t('headerLook.heading')}</p>
            <LookChoice
                label={t('headerLook.navStyle')}
                hint={t('headerLook.navStyleHint')}
                stored={props.navStyle}
                fallback="default"
                options={[
                    { value: 'default', label: standard },
                    { value: 'editorial', label: editorial },
                ]}
                onChange={(v) => onChange('navStyle', v)}
            />
            <LookChoice
                label={t('headerLook.barSize')}
                stored={props.barSize}
                fallback="default"
                options={[
                    { value: 'default', label: standard },
                    { value: 'compact', label: t('headerLook.barCompact') },
                ]}
                onChange={(v) => onChange('barSize', v)}
            />
            <LookChoice
                label={t('headerLook.contentWidth')}
                stored={props.contentWidth}
                fallback="full"
                options={[
                    { value: 'full', label: t('headerLook.widthFull') },
                    { value: 'contained', label: t('headerLook.widthContained') },
                ]}
                onChange={(v) => onChange('contentWidth', v)}
            />
            <HeaderToggle
                label={t('headerLook.logoOnly')}
                hint={t('headerLook.logoOnlyHint')}
                checked={props.logoOnly === true}
                onChange={(v) => onChange('logoOnly', v)}
            />
            {showSwitchStyle && (
                <LookChoice
                    label={t('headerLook.languageSwitcherStyle')}
                    stored={props.languageSwitcherStyle}
                    fallback="pill"
                    options={[
                        { value: 'pill', label: t('headerLook.switchPill') },
                        { value: 'segmented', label: t('headerLook.switchSegmented') },
                    ]}
                    onChange={(v) => onChange('languageSwitcherStyle', v)}
                />
            )}
            <LookChoice
                label={t('headerLook.cartDisplay')}
                stored={props.cartDisplay}
                fallback="always"
                options={[
                    { value: 'always', label: t('headerLook.cartAlways') },
                    { value: 'whenNotEmpty', label: t('headerLook.cartWhenNotEmpty') },
                ]}
                onChange={(v) => onChange('cartDisplay', v)}
            />
            {showMegaStyle && (
                <LookChoice
                    label={t('headerLook.megaMenuStyle')}
                    stored={props.megaMenuStyle}
                    fallback="default"
                    options={[
                        { value: 'default', label: standard },
                        { value: 'editorial', label: editorial },
                    ]}
                    onChange={(v) => onChange('megaMenuStyle', v)}
                />
            )}
        </div>
    );
};
