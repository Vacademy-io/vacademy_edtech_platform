import React from 'react';
import { useTranslation } from 'react-i18next';
import { MyInput } from '@/components/design-system/input';
import { Link, BookOpen, Trash, Plus, Copy } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';

interface DefaultClassLinkInputProps {
    value: string | null | undefined;
    onChange: (value: string | null) => void;
    disabled?: boolean;
    classNameValue?: string | null | undefined;
    onClassNameChange?: (value: string | null) => void;
    onCopy?: () => void;
}

export function DefaultClassLinkInput({
    value,
    onChange,
    disabled,
    classNameValue,
    onClassNameChange,
    onCopy,
}: DefaultClassLinkInputProps) {
    const { t } = useTranslation('studyLibraryDefaultClassLinkInput');
    if (value === null || value === undefined) {
        return (
            <button
                type="button"
                onClick={() => onChange('')}
                disabled={disabled}
                className="group flex items-center gap-3 rounded-lg border border-dashed border-gray-300 bg-gray-50/60 px-4 py-3 text-left text-sm transition-all duration-200 hover:border-primary/50 hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-50"
            >
                <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary transition-transform duration-200 group-hover:scale-110">
                    <Plus size={16} weight="bold" />
                </div>
                <div>
                    <span className="font-semibold text-gray-700 group-hover:text-primary">
                        {t('addDefaultLinkForThisDay')}
                    </span>
                    <p className="mt-0.5 text-xs text-gray-400">
                        {t('shownToLearnersWhenNotLive')}
                    </p>
                </div>
            </button>
        );
    }

    return (
        <div className="overflow-hidden rounded-lg border border-blue-100 bg-gradient-to-b from-blue-50/40 to-white shadow-sm transition-all duration-200">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-blue-100/80 bg-gradient-to-r from-blue-50/80 to-indigo-50/40 px-4 py-2.5">
                <div className="flex items-center gap-2.5">
                    <div className="flex size-7 items-center justify-center rounded-md bg-blue-500/90 shadow-sm">
                        <Link size={14} className="text-white" weight="bold" />
                    </div>
                    <div>
                        <h4 className="text-sm font-semibold text-gray-800">
                            {t('defaultLink')}
                        </h4>
                        <p className="text-[11px] leading-tight text-gray-500">
                            {t('shownWhenNotLive')}
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-1">
                    {onCopy && (
                        <button
                            type="button"
                            onClick={onCopy}
                            disabled={disabled}
                            className="group/btn flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-blue-600 transition-all duration-150 hover:bg-blue-100/60 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            <Copy size={13} weight="bold" className="transition-transform duration-150 group-hover/btn:scale-110" />
                            <span>{t('copy')}</span>
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={() => {
                            onChange(null);
                            onClassNameChange?.(null);
                        }}
                        disabled={disabled}
                        className="group/btn flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-red-500 transition-all duration-150 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        <Trash size={13} weight="bold" className="transition-transform duration-150 group-hover/btn:scale-110" />
                        <span>{t('remove')}</span>
                    </button>
                </div>
            </div>

            {/* Form Fields */}
            <div className="grid grid-cols-1 gap-3 p-3 sm:grid-cols-2">
                {/* Class Name Field */}
                <div>
                    <label className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-gray-600">
                        <BookOpen size={13} className="text-blue-500" weight="duotone" />
                        {t('className')}
                    </label>
                    <MyInput
                        inputType="text"
                        inputPlaceholder={t('classNamePlaceholder')}
                        input={classNameValue || ''}
                        onChangeFunction={(e: React.ChangeEvent<HTMLInputElement>) => {
                            const newValue = e.target.value;
                            onClassNameChange?.(newValue || null);
                        }}
                        disabled={disabled}
                        className="w-full rounded-md border-gray-200 bg-white text-sm transition-all focus-within:border-blue-300 focus-within:ring-2 focus-within:ring-blue-500/15"
                    />
                </div>

                {/* Link URL Field */}
                <div>
                    <label className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-gray-600">
                        <Link size={13} className="text-blue-500" weight="duotone" />
                        {t('linkUrl')}
                        <span className="text-red-400">*</span>
                    </label>
                    <MyInput
                        inputType="url"
                        inputPlaceholder={t('linkUrlPlaceholder')}
                        input={value || ''}
                        onChangeFunction={(e: React.ChangeEvent<HTMLInputElement>) => {
                            const newValue = e.target.value.trim();
                            onChange(newValue);
                        }}
                        disabled={disabled}
                        className="w-full rounded-md border-gray-200 bg-white text-sm transition-all focus-within:border-blue-300 focus-within:ring-2 focus-within:ring-blue-500/15"
                    />
                </div>
            </div>
        </div>
    );
}
