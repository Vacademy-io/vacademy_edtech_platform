import { ArrowCounterClockwise, Palette, TextT } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { cn } from '@/lib/utils';
import type {
    BuiltinCertificateTemplate,
    TemplateCustomizations,
} from '../../-utils/builtin-certificate-templates';

interface TemplateCustomizationPanelProps {
    template: BuiltinCertificateTemplate;
    customizations: TemplateCustomizations;
    onChange: (next: TemplateCustomizations) => void;
    onResetToDefaults: () => void;
    disabled?: boolean;
}

interface FieldDef {
    key: keyof TemplateCustomizations;
    label: string;
    type: 'color' | 'text' | 'number';
    hint?: string;
    min?: number;
    max?: number;
    group: 'colors' | 'text' | 'layout';
}

const buildFields = (t: TFunction): FieldDef[] => [
    { key: 'primaryColor', label: t('fields.primaryColor'), type: 'color', group: 'colors' },
    { key: 'secondaryColor', label: t('fields.secondaryColor'), type: 'color', group: 'colors' },
    { key: 'backgroundColor', label: t('fields.backgroundColor'), type: 'color', group: 'colors' },
    { key: 'titleText', label: t('fields.titleText'), type: 'text', group: 'text' },
    { key: 'subtitleText', label: t('fields.subtitleText'), type: 'text', group: 'text' },
    { key: 'presentedText', label: t('fields.presentedText'), type: 'text', group: 'text' },
    {
        key: 'forCompletionText',
        label: t('fields.forCompletionText'),
        type: 'text',
        group: 'text',
    },
    {
        key: 'borderWidth',
        label: t('fields.borderWidth.label'),
        type: 'number',
        min: 0,
        max: 30,
        group: 'layout',
        hint: t('fields.borderWidth.hint'),
    },
];

export const TemplateCustomizationPanel = ({
    template,
    customizations,
    onChange,
    onResetToDefaults,
    disabled,
}: TemplateCustomizationPanelProps) => {
    const { t } = useTranslation('settingsTemplateCustomizationPanel');
    const FIELDS = buildFields(t);
    const hiddenKeys = new Set(template.hiddenCustomizationKeys ?? []);
    const visibleFields = FIELDS.filter((fld) => !hiddenKeys.has(fld.key));

    const setField = <K extends keyof TemplateCustomizations>(
        key: K,
        value: TemplateCustomizations[K]
    ) => {
        onChange({ ...customizations, [key]: value });
    };

    const groups: { id: FieldDef['group']; label: string; icon: JSX.Element }[] = [
        { id: 'colors', label: t('groups.colors'), icon: <Palette size={14} /> },
        { id: 'text', label: t('groups.text'), icon: <TextT size={14} /> },
        { id: 'layout', label: t('groups.layout'), icon: <Palette size={14} /> },
    ];

    return (
        <div className="rounded-lg border bg-card p-4">
            <div className="mb-3 flex items-center justify-between">
                <div>
                    <h3 className="text-sm font-semibold text-neutral-800">
                        {t('header.title', { name: template.name })}
                    </h3>
                    <p className="text-xs text-neutral-500">{t('header.subtitle')}</p>
                </div>
                <button
                    type="button"
                    onClick={onResetToDefaults}
                    disabled={disabled}
                    className={cn(
                        'flex items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50',
                        disabled && 'cursor-not-allowed opacity-50'
                    )}
                    title={t('header.resetTooltip')}
                >
                    <ArrowCounterClockwise size={12} />
                    {t('header.resetButton')}
                </button>
            </div>

            <div className="space-y-4">
                {groups.map((group) => {
                    const fieldsInGroup = visibleFields.filter((fld) => fld.group === group.id);
                    if (fieldsInGroup.length === 0) return null;
                    return (
                        <div key={group.id}>
                            <div className="mb-2 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-neutral-500">
                                {group.icon}
                                {group.label}
                            </div>
                            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                                {fieldsInGroup.map((field) => (
                                    <div key={field.key}>
                                        <label className="mb-1 block text-xs font-medium text-neutral-700">
                                            {field.label}
                                        </label>
                                        {field.type === 'color' && (
                                            <div className="flex items-center gap-2">
                                                <input
                                                    type="color"
                                                    value={
                                                        (customizations[field.key] as string) ||
                                                        '#000000' // design-lint-ignore: native <input type="color"> value must be a literal #rrggbb hex string, no CSS token/rgb() is accepted here
                                                    }
                                                    onChange={(e) =>
                                                        setField(field.key, e.target.value as never)
                                                    }
                                                    disabled={disabled}
                                                    className="h-8 w-12 cursor-pointer rounded border border-neutral-200 bg-white p-0.5"
                                                />
                                                <input
                                                    type="text"
                                                    value={customizations[field.key] as string}
                                                    onChange={(e) =>
                                                        setField(field.key, e.target.value as never)
                                                    }
                                                    disabled={disabled}
                                                    placeholder={t('fields.hexPlaceholder')}
                                                    className="flex-1 rounded border border-neutral-200 bg-white px-2 py-1 font-mono text-xs"
                                                />
                                            </div>
                                        )}
                                        {field.type === 'text' && (
                                            <input
                                                type="text"
                                                value={customizations[field.key] as string}
                                                onChange={(e) =>
                                                    setField(field.key, e.target.value as never)
                                                }
                                                disabled={disabled}
                                                className="w-full rounded border border-neutral-200 bg-white px-2 py-1.5 text-xs"
                                            />
                                        )}
                                        {field.type === 'number' && (
                                            <input
                                                type="number"
                                                min={field.min}
                                                max={field.max}
                                                value={customizations[field.key] as number}
                                                onChange={(e) =>
                                                    setField(
                                                        field.key,
                                                        Math.max(
                                                            field.min ?? 0,
                                                            Math.min(
                                                                field.max ?? 999,
                                                                Number(e.target.value) || 0
                                                            )
                                                        ) as never
                                                    )
                                                }
                                                disabled={disabled}
                                                className="w-full rounded border border-neutral-200 bg-white px-2 py-1.5 text-xs"
                                            />
                                        )}
                                        {field.hint && (
                                            <p className="mt-1 text-2xs text-neutral-400">
                                                {field.hint}
                                            </p>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
