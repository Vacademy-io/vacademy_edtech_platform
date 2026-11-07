import { useTranslation } from 'react-i18next';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    DEFAULT_PHONE_COUNTRY_GEO_MODE,
    PHONE_COUNTRY_GEO_MODES,
    resolvePhoneCountries,
    type PhoneCountryGeoMode,
} from '@/services/domain-routing';
import { detectVisitorCountry } from '@/utils/geo-country';
import { countryCodeToFlag, parsePreferredCountriesString } from '../-utils/countries';

interface PhoneCountryGeoModeFieldProps {
    /** The portal's currently edited mode. Undefined means it was never set. */
    value: string | undefined;
    /**
     * The preferred countries as currently edited (the raw comma-separated
     * string). Only used to make the preview reflect unsaved edits.
     */
    preferredCountriesValue: string | undefined;
    onChange: (mode: PhoneCountryGeoMode) => void;
}

const flagged = (code: string): string => `${countryCodeToFlag(code)} ${code.toUpperCase()}`;

/**
 * Picks how a phone field on this portal chooses its country code, and shows
 * the operator what that choice resolves to right now.
 *
 * The preview matters more than it looks. "Preferred countries" and "how the
 * visitor's own region is treated" only mean something in combination, and the
 * combination is not obvious — GEO_FIRST with a configured list behaves
 * differently from GEO_FIRST without one. Rather than describe that in prose,
 * this runs the real resolver ({@link resolvePhoneCountries} — the same
 * function every phone field on the platform calls) against the config as
 * currently edited, and states the answer for the operator's own location.
 */
const PhoneCountryGeoModeField = ({
    value,
    preferredCountriesValue,
    onChange,
}: PhoneCountryGeoModeFieldProps) => {
    const { t } = useTranslation('settingsWhiteLabel');

    const mode: PhoneCountryGeoMode = PHONE_COUNTRY_GEO_MODES.includes(
        (value ?? '') as PhoneCountryGeoMode
    )
        ? (value as PhoneCountryGeoMode)
        : DEFAULT_PHONE_COUNTRY_GEO_MODE;

    // The operator's own detected country stands in for "a visitor". It is the
    // only visitor location we can honestly demonstrate; `?phoneCountry=xx` on a
    // form URL previews the others.
    const detected = detectVisitorCountry();
    const preview = resolvePhoneCountries(
        mode,
        parsePreferredCountriesString(preferredCountriesValue),
        detected
    );

    return (
        <div className="space-y-1.5">
            <Label className="text-xs text-slate-500">{t('configForm.phone.geoModeLabel')}</Label>
            <Select value={mode} onValueChange={(next) => onChange(next as PhoneCountryGeoMode)}>
                <SelectTrigger className="h-9">
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    {PHONE_COUNTRY_GEO_MODES.map((option) => (
                        <SelectItem key={option} value={option}>
                            {t(`configForm.phone.geoModes.${option}.label`)}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
            <p className="text-2xs text-slate-400">
                {t(`configForm.phone.geoModes.${mode}.hint`)}
            </p>
            <p className="text-2xs text-slate-500">
                {detected
                    ? t('configForm.phone.geoModePreview', {
                          detected: flagged(detected),
                          resolved: flagged(preview.defaultCountry),
                      })
                    : t('configForm.phone.geoModePreviewUnknown', {
                          resolved: flagged(preview.defaultCountry),
                      })}
            </p>
        </div>
    );
};

export default PhoneCountryGeoModeField;
