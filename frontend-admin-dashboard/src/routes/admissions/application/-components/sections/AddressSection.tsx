import React from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Registration, AddressInfo } from '../../../-types/registration-types';
import { MapPin } from '@phosphor-icons/react';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { MAX_LENGTH, INDIAN_STATES, COUNTRY_OPTIONS } from '@/utils/form-validation';

interface SectionProps {
    formData: Partial<Registration>;
    updateFormData: (data: Partial<Registration>) => void;
}

// Indian state names are stored/compared as these raw strings (from
// INDIAN_STATES in @/utils/form-validation) — the translated label is
// display-only, never the stored value.
const getStateLabel = (t: TFunction, state: string): string => {
    switch (state) {
        case 'Andhra Pradesh':
            return t('stateOptions.andhraPradesh');
        case 'Arunachal Pradesh':
            return t('stateOptions.arunachalPradesh');
        case 'Assam':
            return t('stateOptions.assam');
        case 'Bihar':
            return t('stateOptions.bihar');
        case 'Chhattisgarh':
            return t('stateOptions.chhattisgarh');
        case 'Goa':
            return t('stateOptions.goa');
        case 'Gujarat':
            return t('stateOptions.gujarat');
        case 'Haryana':
            return t('stateOptions.haryana');
        case 'Himachal Pradesh':
            return t('stateOptions.himachalPradesh');
        case 'Jharkhand':
            return t('stateOptions.jharkhand');
        case 'Karnataka':
            return t('stateOptions.karnataka');
        case 'Kerala':
            return t('stateOptions.kerala');
        case 'Madhya Pradesh':
            return t('stateOptions.madhyaPradesh');
        case 'Maharashtra':
            return t('stateOptions.maharashtra');
        case 'Manipur':
            return t('stateOptions.manipur');
        case 'Meghalaya':
            return t('stateOptions.meghalaya');
        case 'Mizoram':
            return t('stateOptions.mizoram');
        case 'Nagaland':
            return t('stateOptions.nagaland');
        case 'Odisha':
            return t('stateOptions.odisha');
        case 'Punjab':
            return t('stateOptions.punjab');
        case 'Rajasthan':
            return t('stateOptions.rajasthan');
        case 'Sikkim':
            return t('stateOptions.sikkim');
        case 'Tamil Nadu':
            return t('stateOptions.tamilNadu');
        case 'Telangana':
            return t('stateOptions.telangana');
        case 'Tripura':
            return t('stateOptions.tripura');
        case 'Uttar Pradesh':
            return t('stateOptions.uttarPradesh');
        case 'Uttarakhand':
            return t('stateOptions.uttarakhand');
        case 'West Bengal':
            return t('stateOptions.westBengal');
        case 'Andaman and Nicobar Islands':
            return t('stateOptions.andamanAndNicobarIslands');
        case 'Chandigarh':
            return t('stateOptions.chandigarh');
        case 'Dadra and Nagar Haveli and Daman and Diu':
            return t('stateOptions.dadraAndNagarHaveliAndDamanAndDiu');
        case 'Delhi':
            return t('stateOptions.delhi');
        case 'Jammu and Kashmir':
            return t('stateOptions.jammuAndKashmir');
        case 'Ladakh':
            return t('stateOptions.ladakh');
        case 'Lakshadweep':
            return t('stateOptions.lakshadweep');
        case 'Puducherry':
            return t('stateOptions.puducherry');
        default:
            return state;
    }
};

// Country values (India / Other) are stored/compared as these raw strings
// (from COUNTRY_OPTIONS in @/utils/form-validation) — the translated label
// is display-only, never the stored value.
const getCountryLabel = (t: TFunction, country: string): string => {
    switch (country) {
        case 'India':
            return t('countryOptions.india');
        case 'Other':
            return t('countryOptions.other');
        default:
            return country;
    }
};

export const AddressSection: React.FC<SectionProps> = ({ formData, updateFormData }) => {
    const { t } = useTranslation('admissionsAddressSection');
    const updateAddress = (
        type: 'currentAddress' | 'permanentAddress',
        field: keyof AddressInfo,
        value: string
    ) => {
        const currentAddress = formData[type] || {
            city: '',
            state: '',
            pinCode: '',
            country: 'India',
        };
        const updatedAddress = {
            ...currentAddress,
            [field]: value,
        } as AddressInfo;

        const updates: Partial<Registration> = {
            [type]: updatedAddress as AddressInfo,
        };

        updateFormData(updates);
    };

    const renderAddressForm = (
        type: 'currentAddress' | 'permanentAddress',
        title: string,
        disabled: boolean = false
    ) => {
        const data: Partial<AddressInfo> = formData[type] || {};
        const updateField = (field: keyof AddressInfo, value: string) =>
            updateAddress(type, field, value);

        return (
            <div className="space-y-4 pt-4">
                <h4 className="flex items-center gap-2 text-sm font-semibold uppercase text-neutral-500">
                    <MapPin className="size-4" />
                    {title}
                </h4>

                <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
                    <div>
                        <label className="mb-1 block text-sm font-medium text-neutral-700">
                            {t('fields.houseNo.label')}
                        </label>
                        <input
                            type="text"
                            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 disabled:bg-neutral-100 disabled:text-neutral-500"
                            placeholder={t('fields.houseNo.placeholder')}
                            value={data.houseNo || ''}
                            onChange={(e) => updateField('houseNo', e.target.value)}
                            disabled={disabled}
                            maxLength={MAX_LENGTH.GENERAL}
                        />
                    </div>
                    <div>
                        <label className="mb-1 block text-sm font-medium text-neutral-700">
                            {t('fields.street.label')} <span className="text-red-500">*</span>
                        </label>
                        <input
                            type="text"
                            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 disabled:bg-neutral-100 disabled:text-neutral-500"
                            placeholder={t('fields.street.placeholder')}
                            value={data.street || ''}
                            onChange={(e) => updateField('street', e.target.value)}
                            disabled={disabled}
                            maxLength={MAX_LENGTH.ADDRESS}
                        />
                    </div>
                    <div>
                        <label className="mb-1 block text-sm font-medium text-neutral-700">
                            {t('fields.area.label')} <span className="text-red-500">*</span>
                        </label>
                        <input
                            type="text"
                            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 disabled:bg-neutral-100 disabled:text-neutral-500"
                            placeholder={t('fields.area.placeholder')}
                            value={data.area || ''}
                            onChange={(e) => updateField('area', e.target.value)}
                            disabled={disabled}
                            maxLength={MAX_LENGTH.ADDRESS}
                        />
                    </div>
                </div>

                <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                    <div>
                        <label className="mb-1 block text-sm font-medium text-neutral-700">
                            {t('fields.landmark.label')}
                        </label>
                        <input
                            type="text"
                            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 disabled:bg-neutral-100 disabled:text-neutral-500"
                            placeholder={t('fields.landmark.placeholder')}
                            value={data.landmark || ''}
                            onChange={(e) => updateField('landmark', e.target.value)}
                            disabled={disabled}
                            maxLength={MAX_LENGTH.GENERAL}
                        />
                    </div>
                    <div className="grid grid-cols-2 gap-6">
                        <div>
                            <label className="mb-1 block text-sm font-medium text-neutral-700">
                                {t('fields.city.label')} <span className="text-red-500">*</span>
                            </label>
                            <input
                                type="text"
                                className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 disabled:bg-neutral-100 disabled:text-neutral-500"
                                placeholder={t('fields.city.placeholder')}
                                value={data.city || ''}
                                onChange={(e) => updateField('city', e.target.value)}
                                disabled={disabled}
                                maxLength={MAX_LENGTH.GENERAL}
                            />
                        </div>
                        <div>
                            <Label className="mb-1 block text-sm font-medium text-neutral-700">
                                {t('fields.state.label')} <span className="text-red-500">*</span>
                            </Label>
                            <Select
                                value={data.state || ''}
                                onValueChange={(value) => updateField('state', value)}
                                disabled={disabled}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder={t('fields.state.placeholder')} />
                                </SelectTrigger>
                                <SelectContent>
                                    {INDIAN_STATES.map((state) => (
                                        <SelectItem key={state} value={state}>
                                            {getStateLabel(t, state)}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                    <div>
                        <label className="mb-1 block text-sm font-medium text-neutral-700">
                            {t('fields.pincode.label')} <span className="text-red-500">*</span>
                        </label>
                        <input
                            type="text"
                            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 disabled:bg-neutral-100 disabled:text-neutral-500"
                            placeholder={t('fields.pincode.placeholder')}
                            value={data.pinCode || data.pincode || ''}
                            onChange={(e) => {
                                const digits = e.target.value.replace(/\D/g, '').slice(0, 6);
                                updateField('pinCode', digits);
                                updateField('pincode', digits);
                            }}
                            disabled={disabled}
                            maxLength={MAX_LENGTH.PINCODE}
                            inputMode="numeric"
                        />
                        <p className="mt-1 text-xs text-neutral-500">{t('fields.pincode.hint')}</p>
                    </div>
                    <div>
                        <Label className="mb-1 block text-sm font-medium text-neutral-700">
                            {t('fields.country.label')} <span className="text-red-500">*</span>
                        </Label>
                        <Select
                            value={data.country || 'India'}
                            onValueChange={(value) => updateField('country', value)}
                            disabled={disabled}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder={t('fields.country.placeholder')} />
                            </SelectTrigger>
                            <SelectContent>
                                {COUNTRY_OPTIONS.map((opt) => (
                                    <SelectItem key={opt} value={opt}>
                                        {getCountryLabel(t, opt)}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="space-y-6">
            <div className="space-y-6">
                {renderAddressForm('currentAddress', t('sections.residentialAddress'))}
            </div>
        </div>
    );
};
