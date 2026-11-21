import type { FC } from 'react';
import { useTranslation } from 'react-i18next';
import { CampaignPicker } from '../CampaignPicker';
import { ImageUploadField } from '../ImageUploadField';
import { HeaderToggle } from '../header/HeaderEditorFields';
import { OptionalColorField, TextField, obj } from './chrome-controls';

/** Footer props are hand- or AI-written JSON: read them as unknown and narrow. */
type Props = Record<string, unknown>;

export interface FooterBrandFieldsProps {
    /** The footer props (variant is 'brand'). */
    props: Props;
    /** Writes one prop, keeping every other prop. */
    updateProp: (key: string, value: unknown) => void;
    /** Writes several props in one edit, keeping every other prop. */
    patchProps: (next: Props) => void;
}

const NEWSLETTER_TEXTS = [
    'heading',
    'subheading',
    'placeholder',
    'buttonText',
    'note',
    'successMessage',
] as const;

/**
 * Extra fields of the "brand" footer: logo and tagline (column 1), the
 * newsletter card, the bottom-bar tagline and language switch, and the
 * background. PropertyPanel mounts it only when props.variant is 'brand';
 * every write spreads the object it changes.
 */
export const FooterBrandFields: FC<FooterBrandFieldsProps> = ({ props, updateProp }) => {
    const { t } = useTranslation('managePagesPropertyPanel');
    const left = obj(props.leftSection);
    const newsletter = obj(props.newsletter);
    const newsletterOn = props.newsletter !== undefined && newsletter.enabled !== false;
    const setLeft = (field: string, value: unknown) =>
        updateProp('leftSection', { ...left, [field]: value });
    const setNewsletter = (next: Props) => updateProp('newsletter', { ...newsletter, ...next });

    return (
        <div className="space-y-4">
            <div className="space-y-3 rounded border bg-gray-50 p-3">
                <h5 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    {t('footerBrand.brandHeading')}
                </h5>
                <ImageUploadField slot="square"
                    label={t('footerBrand.logo')}
                    value={typeof left.logo === 'string' ? left.logo : ''}
                    onChange={(url) => setLeft('logo', url)}
                />
                <TextField
                    label={t('footerBrand.tagline')}
                    value={left.tagline}
                    placeholder={t('footerBrand.taglinePlaceholder')}
                    onChange={(v) => setLeft('tagline', v)}
                />
            </div>

            <div className="space-y-3 rounded border bg-gray-50 p-3">
                <h5 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    {t('footerBrand.newsletterHeading')}
                </h5>
                <HeaderToggle
                    label={t('footerBrand.newsletterShow')}
                    checked={newsletterOn}
                    onChange={(on) => setNewsletter({ enabled: on })}
                />
                {newsletterOn && (
                    <>
                        {NEWSLETTER_TEXTS.map((key) => (
                            <TextField
                                key={key}
                                label={t(`footerBrand.newsletter.${key}`)}
                                value={newsletter[key]}
                                onChange={(v) => setNewsletter({ [key]: v })}
                            />
                        ))}
                        <CampaignPicker
                            label={t('footerBrand.newsletterList')}
                            value={
                                typeof newsletter.audienceId === 'string'
                                    ? newsletter.audienceId
                                    : ''
                            }
                            onChange={(id, name) =>
                                setNewsletter({ audienceId: id, audienceName: name })
                            }
                        />
                    </>
                )}
            </div>

            <div className="space-y-3 rounded border bg-gray-50 p-3">
                <h5 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    {t('footerBrand.bottomBarHeading')}
                </h5>
                <TextField
                    label={t('footerBrand.bottomTagline')}
                    value={props.bottomTagline}
                    placeholder={t('footerBrand.bottomTaglinePlaceholder')}
                    onChange={(v) => updateProp('bottomTagline', v)}
                />
                <HeaderToggle
                    label={t('footerBrand.languageSwitch')}
                    hint={t('footerBrand.languageSwitchHint')}
                    checked={props.showLanguageSwitcher === true}
                    onChange={(v) => updateProp('showLanguageSwitcher', v)}
                />
            </div>

            <OptionalColorField
                label={t('footerBrand.backgroundColor')}
                value={props.backgroundColor}
                onChange={(c) => updateProp('backgroundColor', c)}
            />
        </div>
    );
};
