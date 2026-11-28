import React, { useEffect, useRef, useState } from 'react';
import { CaretDown, CaretUp, Check, MagnifyingGlass, Plus } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
    buildCampaignTypeFilterOptions,
    buildDefaultCampaignTypeOptions,
    type CampaignTypeOption,
} from '../../-utils/campaign-types';
import { handleFetchCampaignsList } from '../../-services/get-campaigns-list';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { useLeadTerminology } from '@/hooks/use-lead-terminology';

interface CampaignTypeDropdownProps {
    value?: string;
    onChange: (value: string) => void;
    error?: string;
    placeholder?: string;
    /** Overrides the "Enter <term>" hint — the enquiry form reuses this dropdown under its own name. */
    customInputPlaceholder?: string;
    initialOptions?: CampaignTypeOption[];
}

const CampaignTypeDropdown: React.FC<CampaignTypeDropdownProps> = ({
    value = '',
    onChange,
    error,
    placeholder,
    customInputPlaceholder,
    initialOptions,
}) => {
    const { t } = useTranslation('audienceManagerCampaignTypeDropdown');
    // What this institute calls the campaign type (Lead Settings → Terminology).
    // Skipped when the caller names both strings itself (the enquiry form does),
    // so reusing this dropdown there costs no settings fetch.
    const { campaignType: term } = useLeadTerminology({
        skip: Boolean(placeholder && customInputPlaceholder),
    });
    const resolvedPlaceholder = placeholder ?? t('placeholder', { term });
    const resolvedCustomPlaceholder =
        customInputPlaceholder ?? t('customInputPlaceholder', { term });
    const [isOpen, setIsOpen] = useState(false);
    const [options, setOptions] = useState<CampaignTypeOption[]>(
        () => initialOptions ?? buildDefaultCampaignTypeOptions(t)
    );
    // Institutes carry their own types — I2CAN has twenty-one — so the list is no
    // longer something you scan by eye.
    const [query, setQuery] = useState('');
    const visibleOptions = options.filter((o) =>
        `${o.label} ${o.value}`.toLowerCase().includes(query.trim().toLowerCase())
    );
    const [isAddingCustom, setIsAddingCustom] = useState(false);
    const [customValue, setCustomValue] = useState('');
    const dropdownRef = useRef<HTMLDivElement>(null);
    const customInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
                setIsAddingCustom(false);
                setCustomValue('');
                setQuery('');
            }
        }

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isOpen]);

    useEffect(() => {
        if (isAddingCustom && customInputRef.current) {
            customInputRef.current.focus();
        }
    }, [isAddingCustom]);

    useEffect(() => {
        if (
            value &&
            !options.some((option) => option.value.toLowerCase() === value.toLowerCase())
        ) {
            setOptions((prev) => [...prev, { value, label: value }]);
        }
    }, [value, options]);

    // The five built-in types are not what an institute actually uses. I2CAN's
    // leads carry nineteen of their own, every one already saved on an audience,
    // and this dropdown offered none of them — so creating a list meant retyping
    // a type that existed, and a typo made a twentieth.
    //
    // Skipped when the caller supplies its own list (the enquiry form does).
    const instituteId = getCurrentInstituteId();
    const { data: audiences } = useQuery({
        ...handleFetchCampaignsList({ institute_id: instituteId ?? '', page: 0, size: 200 }),
        enabled: !initialOptions && Boolean(instituteId),
    });
    useEffect(() => {
        if (initialOptions || !audiences?.content) return;
        const saved = audiences.content.map((c) => c.campaign_type);
        setOptions((prev) => buildCampaignTypeFilterOptions(prev, saved));
    }, [initialOptions, audiences]);

    const handleSelect = (optionValue: string) => {
        onChange(optionValue);
        setIsOpen(false);
        setIsAddingCustom(false);
        setCustomValue('');
        setQuery('');
    };

    const handleCustomSave = () => {
        const trimmed = customValue.trim();
        if (!trimmed) return;

        const exists = options.some(
            (option) => option.value.toLowerCase() === trimmed.toLowerCase()
        );

        if (!exists) {
            setOptions((prev) => [...prev, { value: trimmed, label: trimmed }]);
        }

        handleSelect(trimmed);
    };

    const displayLabel = (() => {
        if (value) {
            const found = options.find(
                (option) => option.value.toLowerCase() === value.toLowerCase()
            );
            return found?.label || value;
        }
        return resolvedPlaceholder;
    })();

    return (
        <div className="relative w-full" ref={dropdownRef}>
            <button
                type="button"
                onClick={() => {
                    setIsOpen((prev) => !prev);
                    setIsAddingCustom(false);
                    setCustomValue('');
                }}
                className={`flex w-full items-center justify-between rounded-lg border px-4 py-2.5 text-sm transition-all focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 ${
                    error ? 'border-danger-600' : 'border-neutral-300 hover:border-primary-200'
                } ${value ? 'text-neutral-600' : 'text-neutral-400'}`}
            >
                <span className="truncate text-left">{displayLabel}</span>
                <div className="ml-2 shrink-0">
                    {isOpen ? (
                        <CaretUp className="size-4 text-neutral-600" />
                    ) : (
                        <CaretDown className="size-4 text-neutral-600" />
                    )}
                </div>
            </button>

            {isOpen && (
                <div className="absolute z-30 mt-2 w-full rounded-lg border border-neutral-200 bg-white shadow-lg">
                    <div className="relative border-b border-neutral-100 p-2">
                        <MagnifyingGlass className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-neutral-400" />
                        <input
                            type="text"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder={t('searchPlaceholder')}
                            aria-label={t('searchPlaceholder')}
                            className="w-full rounded-md border border-neutral-200 py-1.5 pl-8 pr-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                        />
                    </div>
                    <div className="max-h-60 overflow-y-auto py-1">
                        {visibleOptions.length === 0 && (
                            <p className="p-3 text-center text-sm text-neutral-500">
                                {t('noMatches', { query: query.trim() })}
                            </p>
                        )}
                        {visibleOptions.map((option) => (
                            <button
                                key={option.value}
                                type="button"
                                onClick={() => handleSelect(option.value)}
                                className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-primary-50 ${
                                    value?.toLowerCase() === option.value.toLowerCase()
                                        ? 'bg-primary-50 text-primary-700'
                                        : 'text-neutral-700'
                                }`}
                            >
                                <span>{option.label}</span>
                                {value?.toLowerCase() === option.value.toLowerCase() && (
                                    <Check className="size-4 text-primary-500" />
                                )}
                            </button>
                        ))}

                        <div className="my-1 border-t border-neutral-100" />

                        {!isAddingCustom ? (
                            <button
                                type="button"
                                onClick={() => setIsAddingCustom(true)}
                                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-primary-600 transition-colors hover:bg-primary-50"
                            >
                                <Plus className="size-4" />
                                {t('addCustomType')}
                            </button>
                        ) : (
                            <div className="space-y-2 px-3 py-2">
                                <input
                                    ref={customInputRef}
                                    type="text"
                                    value={customValue}
                                    onChange={(e) => setCustomValue(e.target.value)}
                                    placeholder={resolvedCustomPlaceholder}
                                    className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                                />
                                <div className="flex justify-end gap-2">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setIsAddingCustom(false);
                                            setCustomValue('');
                                        }}
                                        className="text-sm text-neutral-500 hover:text-neutral-700"
                                    >
                                        {t('cancel')}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleCustomSave}
                                        className="text-sm font-semibold text-primary-600 hover:text-primary-700"
                                    >
                                        {t('save')}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {error && <span className="mt-1 block text-sm text-red-500">{error}</span>}
        </div>
    );
};

export default CampaignTypeDropdown;
