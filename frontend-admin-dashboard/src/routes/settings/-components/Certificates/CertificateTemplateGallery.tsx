import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ImageSquare, Star } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import {
    BUILTIN_TEMPLATES,
    BuiltinCertificateTemplate,
    getBuiltinTemplateSvgDataUrl,
} from '../../-utils/builtin-certificate-templates';
import type { TemplateCustomizations } from '../../-utils/builtin-certificate-templates';

interface CertificateTemplateGalleryProps {
    /** id of the currently active template — built-in id or 'custom' */
    activeTemplateId?: string;
    /** True when the admin has uploaded a non-built-in image. */
    hasCustomUpload: boolean;
    /** Thumbnail URL of the custom upload, if any. */
    customThumbnailUrl?: string;
    /** Theme color used for SVG thumbnails so they match the institute brand. */
    themeColor: string;
    /** Fires when admin clicks a built-in card. */
    onSelectBuiltin: (template: BuiltinCertificateTemplate) => void;
    /** Optional: fires when admin clicks the custom card (after they've uploaded). */
    onSelectCustom?: () => void;
    /** Disables interaction while a template swap is in-flight. */
    disabled?: boolean;
}

export const CertificateTemplateGallery = ({
    activeTemplateId,
    hasCustomUpload,
    customThumbnailUrl,
    themeColor,
    onSelectBuiltin,
    onSelectCustom,
    disabled,
}: CertificateTemplateGalleryProps) => {
    const { t } = useTranslation('settingsCertificateTemplateGallery');
    // Thumbnails always render with each template's *default* customizations
    // so the gallery shows what the design looks like out-of-the-box, not the
    // admin's in-progress tweaks (which are reflected in the main editor canvas
    // and customization panel instead).
    const cards = useMemo(
        () =>
            BUILTIN_TEMPLATES.map((tpl) => {
                const defaults: TemplateCustomizations = tpl.defaultCustomizations(themeColor);
                return {
                    template: tpl,
                    thumbnail: getBuiltinTemplateSvgDataUrl(tpl, defaults),
                };
            }),
        [themeColor]
    );

    return (
        <div className="rounded-lg border bg-card p-4">
            <div className="mb-3 flex items-center justify-between">
                <div>
                    <h3 className="text-sm font-semibold text-neutral-800">
                        {t('header.title')}
                    </h3>
                    <p className="text-xs text-neutral-500">{t('header.subtitle')}</p>
                </div>
                {activeTemplateId && (
                    <span className="rounded-full bg-purple-50 px-2.5 py-1 text-2xs font-medium uppercase tracking-wide text-purple-700">
                        {hasCustomUpload && activeTemplateId === 'custom'
                            ? t('badge.customUpload')
                            : t('badge.builtin')}
                    </span>
                )}
            </div>

            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {cards.map(({ template, thumbnail }) => {
                    const isActive = activeTemplateId === template.id;
                    return (
                        <button
                            key={template.id}
                            type="button"
                            disabled={disabled}
                            onClick={() => onSelectBuiltin(template)}
                            className={cn(
                                'group relative flex flex-col overflow-hidden rounded-md border bg-white text-left transition-all',
                                isActive
                                    ? 'border-purple-500 ring-2 ring-purple-200'
                                    : 'border-neutral-200 hover:border-purple-300 hover:shadow-sm',
                                disabled && 'cursor-not-allowed opacity-50'
                            )}
                            title={template.description}
                        >
                            <div className="relative aspect-[1123/794] w-full bg-neutral-50">
                                <img
                                    src={thumbnail}
                                    alt={template.name}
                                    className="size-full object-contain"
                                    draggable={false}
                                />
                                {template.isDefault && !isActive && (
                                    <span className="absolute start-1.5 top-1.5 flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-2xs font-medium text-amber-700">
                                        <Star size={10} weight="fill" />
                                        {t('card.default')}
                                    </span>
                                )}
                                {isActive && (
                                    <span className="absolute end-1.5 top-1.5 flex items-center gap-1 rounded-full bg-purple-600 px-2 py-0.5 text-2xs font-medium text-white">
                                        <Check size={10} weight="bold" />
                                        {t('card.selected')}
                                    </span>
                                )}
                            </div>
                            <div className="border-t px-2.5 py-2">
                                <div className="text-xs font-semibold text-neutral-800">
                                    {template.name}
                                </div>
                                <div className="line-clamp-1 text-2xs text-neutral-500">
                                    {template.description}
                                </div>
                            </div>
                        </button>
                    );
                })}

                <button
                    type="button"
                    disabled={disabled || !hasCustomUpload}
                    onClick={() => onSelectCustom?.()}
                    className={cn(
                        'group relative flex flex-col overflow-hidden rounded-md border bg-white text-left transition-all',
                        activeTemplateId === 'custom'
                            ? 'border-purple-500 ring-2 ring-purple-200'
                            : hasCustomUpload
                              ? 'border-neutral-200 hover:border-purple-300 hover:shadow-sm'
                              : 'border-dashed border-neutral-300',
                        (disabled || !hasCustomUpload) && 'cursor-not-allowed opacity-60'
                    )}
                    title={
                        hasCustomUpload
                            ? t('customCard.tooltipUse')
                            : t('customCard.tooltipEnable')
                    }
                >
                    <div className="relative flex aspect-[1123/794] w-full items-center justify-center bg-neutral-50">
                        {hasCustomUpload && customThumbnailUrl ? (
                            <img
                                src={customThumbnailUrl}
                                alt={t('customCard.altText')}
                                className="size-full object-contain"
                                draggable={false}
                            />
                        ) : (
                            <div className="flex flex-col items-center gap-1.5 text-neutral-400">
                                <ImageSquare size={28} weight="thin" />
                                <span className="text-2xs">
                                    {t('customCard.uploadPlaceholder')}
                                </span>
                            </div>
                        )}
                        {activeTemplateId === 'custom' && (
                            <span className="absolute end-1.5 top-1.5 flex items-center gap-1 rounded-full bg-purple-600 px-2 py-0.5 text-2xs font-medium text-white">
                                <Check size={10} weight="bold" />
                                {t('card.selected')}
                            </span>
                        )}
                    </div>
                    <div className="border-t px-2.5 py-2">
                        <div className="text-xs font-semibold text-neutral-800">
                            {t('customCard.title')}
                        </div>
                        <div className="line-clamp-1 text-2xs text-neutral-500">
                            {hasCustomUpload
                                ? t('customCard.descriptionUploaded')
                                : t('customCard.descriptionEmpty')}
                        </div>
                    </div>
                </button>
            </div>
        </div>
    );
};
