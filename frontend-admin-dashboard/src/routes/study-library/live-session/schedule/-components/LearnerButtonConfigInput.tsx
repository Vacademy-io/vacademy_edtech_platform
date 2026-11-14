import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { MyInput } from '@/components/design-system/input';
import { MyButton } from '@/components/design-system/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { LearnerButtonConfig } from '../../-constants/helper';
import { Sparkle, Trash, Plus, Eye, Palette, TextT, Link } from '@phosphor-icons/react';
import type { TFunction } from 'i18next';

interface LearnerButtonConfigInputProps {
    value: LearnerButtonConfig | null | undefined;
    onChange: (value: LearnerButtonConfig | null) => void;
    disabled?: boolean;
}

function getDefaultButtonConfig(t: TFunction): LearnerButtonConfig {
    return {
        text: t('defaultButtonText'),
        url: '',
        background_color: '#1976D2',
        text_color: '#FFFFFF',
        visible: true,
    };
}

export function LearnerButtonConfigInput({
    value,
    onChange,
    disabled,
}: LearnerButtonConfigInputProps) {
    const { t } = useTranslation('studyLibraryLearnerButtonConfigInput');
    const [config, setConfig] = useState<LearnerButtonConfig | null>(value || null);

    useEffect(() => {
        setConfig(value || null);
    }, [value]);

    const handleChange = (field: keyof LearnerButtonConfig, newValue: string | boolean) => {
        if (!config) return;

        const updated = { ...config, [field]: newValue };
        setConfig(updated);
        onChange(updated);
    };

    const handleAdd = () => {
        const newConfig = getDefaultButtonConfig(t);
        setConfig(newConfig);
        onChange(newConfig);
    };

    const handleRemove = () => {
        setConfig(null);
        onChange(null);
    };

    if (!config) {
        return (
            <div className="group">
                <button
                    type="button"
                    onClick={handleAdd}
                    disabled={disabled}
                    className="flex items-center gap-2 rounded-lg border-2 border-dashed border-gray-300 bg-gray-50/50 px-4 py-3 text-sm font-medium text-gray-600 transition-all hover:border-primary hover:bg-primary/5 hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
                >
                    <Plus size={18} weight="bold" className="transition-transform group-hover:scale-110" />
                    <span>{t('addCustomButton')}</span>
                </button>
            </div>
        );
    }

    return (
        <div className="rounded-xl border border-gray-200 bg-gradient-to-br from-white to-gray-50/30 shadow-sm transition-all hover:shadow-md">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2.5">
                <div className="flex items-center gap-3">
                    {/* <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-purple-500 to-purple-600 shadow-sm">
                        <Sparkle size={18} className="text-white" weight="bold" />
                    </div> */}
                    <div>
                        <h4 className="text-sm font-semibold text-gray-900">
                            {t('customButtonConfiguration')}
                        </h4>
                        <p className="text-xs text-gray-600">
                            {t('addCustomActionButtonNote')}
                        </p>
                    </div>
                </div>
                <button
                    type="button"
                    onClick={handleRemove}
                    disabled={disabled}
                    className="group flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-red-600 transition-all hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                    <Trash size={14} weight="bold" className="transition-transform group-hover:scale-110" />
                    <span>{t('remove')}</span>
                </button>
            </div>

            {/* Visibility Toggle */}
            {/* <div className="border-b border-gray-100 bg-gradient-to-r from-purple-50/30 to-transparent p-3">
                <div className="flex items-center gap-2.5">
                    <Switch
                        id="button-visible"
                        checked={config.visible}
                        onCheckedChange={(checked) => handleChange('visible', checked)}
                        disabled={disabled}
                    />
                    <div className="flex items-center gap-2">
                        <Eye size={16} className="text-purple-600" weight="duotone" />
                        <Label htmlFor="button-visible" className="cursor-pointer text-sm font-medium text-gray-700">
                            Show this button to learners
                        </Label>
                    </div>
                </div>
            </div> */}

            {/* Form Fields - Grid Layout */}
            <div className="space-y-3 p-3">
                {/* Button Text and URL - Two Column */}
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    {/* Button Text */}
                    <div className="group">
                        <div className="mb-2 flex items-center gap-2">
                            <TextT size={14} className="text-gray-500" weight="duotone" />
                            <label className="text-xs font-semibold text-gray-700">
                                {t('buttonText')}
                                <span className="ms-1 text-red-500">*</span>
                            </label>
                        </div>
                        <MyInput
                            inputType="text"
                            inputPlaceholder={t('buttonTextPlaceholder')}
                            input={config.text}
                            onChangeFunction={(e: React.ChangeEvent<HTMLInputElement>) => handleChange('text', e.target.value)}
                            disabled={disabled}
                            className="w-full transition-all focus-within:ring-2 focus-within:ring-purple-500/20"
                        />
                        <p className="mt-1 text-xs text-gray-500">
                            {t('charactersCount', { count: config.text.length, max: 50 })}
                        </p>
                    </div>

                    {/* Button URL */}
                    <div className="group">
                        <div className="mb-2 flex items-center gap-2">
                            <Link size={14} className="text-gray-500" weight="duotone" />
                            <label className="text-xs font-semibold text-gray-700">
                                {t('buttonUrl')}
                                <span className="ms-1 text-red-500">*</span>
                            </label>
                        </div>
                        <MyInput
                            inputType="url"
                            inputPlaceholder={t('buttonUrlPlaceholder')}
                            input={config.url}
                            onChangeFunction={(e: React.ChangeEvent<HTMLInputElement>) => handleChange('url', e.target.value)}
                            disabled={disabled}
                            className="w-full transition-all focus-within:ring-2 focus-within:ring-purple-500/20"
                        />
                    </div>
                </div>

                {/* Color Pickers - Two Column */}
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    {/* Background Color */}
                    <div className="group">
                        <div className="mb-2 flex items-center gap-2">
                            <Palette size={14} className="text-gray-500" weight="duotone" />
                            <label className="text-xs font-semibold text-gray-700">{t('backgroundColor')}</label>
                        </div>
                        <div className="flex gap-2">
                            <div className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md border-2 border-gray-200 shadow-sm transition-transform hover:scale-105 active:scale-95">
                                <input
                                    type="color"
                                    value={config.background_color}
                                    onChange={(e) => handleChange('background_color', e.target.value)}
                                    className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                                    disabled={disabled}
                                />
                                <div
                                    className="h-full w-full"
                                    style={{ backgroundColor: config.background_color }}
                                />
                            </div>
                            <MyInput
                                inputType="text"
                                input={config.background_color}
                                onChangeFunction={(e: React.ChangeEvent<HTMLInputElement>) => {
                                    const value = e.target.value;
                                    if (/^#[0-9A-F]{0,6}$/i.test(value) || value === '') {
                                        handleChange('background_color', value);
                                    }
                                }}
                                inputPlaceholder="#1976D2"
                                disabled={disabled}
                                className="transition-all focus-within:ring-2 focus-within:ring-purple-500/20"
                            />
                        </div>
                    </div>

                    {/* Text Color */}
                    <div className="group">
                        <div className="mb-2 flex items-center gap-2">
                            <Palette size={14} className="text-gray-500" weight="duotone" />
                            <label className="text-xs font-semibold text-gray-700">{t('textColor')}</label>
                        </div>
                        <div className="flex gap-2">
                            <div className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md border-2 border-gray-200 shadow-sm transition-transform hover:scale-105 active:scale-95">
                                <input
                                    type="color"
                                    value={config.text_color}
                                    onChange={(e) => handleChange('text_color', e.target.value)}
                                    className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                                    disabled={disabled}
                                />
                                <div
                                    className="h-full w-full"
                                    style={{ backgroundColor: config.text_color }}
                                />
                            </div>
                            <MyInput
                                inputType="text"
                                input={config.text_color}
                                onChangeFunction={(e: React.ChangeEvent<HTMLInputElement>) => {
                                    const value = e.target.value;
                                    if (/^#[0-9A-F]{0,6}$/i.test(value) || value === '') {
                                        handleChange('text_color', value);
                                    }
                                }}
                                inputPlaceholder="#FFFFFF"
                                disabled={disabled}
                                className="transition-all focus-within:ring-2 focus-within:ring-purple-500/20"
                            />
                        </div>
                    </div>
                </div>

                {/* Preview */}
                <div className="rounded-lg border border-purple-100 bg-gradient-to-br from-purple-50/30 to-white p-3">
                    <div className="mb-2 flex items-center gap-2">
                        <Eye size={14} className="text-purple-600" weight="duotone" />
                        <label className="text-xs font-semibold text-gray-700">{t('preview')}:</label>
                    </div>
                    <button
                        type="button"
                        style={{
                            backgroundColor: config.background_color,
                            color: config.text_color,
                        }}
                        className="rounded-lg px-4 py-2 text-sm font-semibold shadow-md transition-transform hover:scale-105"
                        disabled
                    >
                        {config.text || t('buttonText')}
                    </button>
                </div>
            </div>
        </div>
    );
}


