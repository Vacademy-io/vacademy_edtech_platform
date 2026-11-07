import React, { useEffect, useRef, useState } from 'react';
import { CaretDown, CaretUp, Check } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

interface StatusOption {
    value: string;
    label: string;
}

interface StatusDropdownProps {
    value?: string;
    onChange: (value: string) => void;
    error?: string;
    placeholder?: string;
    initialOptions?: StatusOption[];
}

// NOTE: `value` is the stable, internal status key that gets sent to the
// backend / stored in form state — it must never change with locale. Only
// `label` (the displayed text) is translated.
const buildDefaultOptions = (t: TFunction): StatusOption[] => [
    { value: 'ACTIVE', label: t('optionActive') },
    { value: 'INACTIVE', label: t('optionInactive') },
    { value: 'DRAFT', label: t('optionDraft') },
];

const StatusDropdown: React.FC<StatusDropdownProps> = ({
    value = '',
    onChange,
    error,
    placeholder,
    initialOptions,
}) => {
    const { t } = useTranslation('audienceManagerStatusDropdown');
    const resolvedPlaceholder = placeholder ?? t('placeholder');
    const resolvedOptions = initialOptions ?? buildDefaultOptions(t);
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        }

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isOpen]);

    const handleSelect = (optionValue: string) => {
        onChange(optionValue);
        setIsOpen(false);
    };

    const displayLabel = (() => {
        if (value) {
            const found = resolvedOptions.find(
                (option) => option.value.toLowerCase() === value.toLowerCase()
            );
            return found?.label || value;
        }
        return resolvedPlaceholder;
    })();

    return (
        <div className="relative min-w-5" ref={dropdownRef}>
            <button
                type="button"
                onClick={() => {
                    setIsOpen((prev) => !prev);
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
                    <div className="max-h-60 overflow-y-auto py-1">
                        {resolvedOptions.map((option) => (
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
                    </div>
                </div>
            )}

            {error && (
                <span className="mt-1 block text-sm text-red-500">{error}</span>
            )}
        </div>
    );
};

export default StatusDropdown;

