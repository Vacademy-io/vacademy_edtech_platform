import { useState } from 'react';
import { Controller, useFieldArray, useFormContext, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Copy, Plus, Trash } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { TipTapEditor } from '@/components/tiptap/TipTapEditor';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { FieldError, SectionCard } from '@/routes/commerce/-components/CatalogueBits';
import { CommerceTextField } from '@/routes/commerce/-components/CommerceFormFields';
import { PRODUCT_LOCALES, type ProductLocale } from '@/routes/commerce/-shared/catalogue-types';
import { sectionDomId } from '@/routes/commerce/-shared/product-errors';
import {
    BLOCK_CODE,
    type ProductFormValues,
    isBlankHtml,
    translationHasText,
    translationIsComplete,
} from '@/routes/commerce/-shared/product-form';

const toBlockCode = (raw: string) =>
    raw
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, '_')
        .replace(/^_+/, '')
        .slice(0, 64);

/**
 * Details: the product's text in two languages, Hindi first.
 * Each tab has the name, short description, description, the content blocks
 * (care, story, …) and the search-result text. A dot on the tab says whether
 * the language is complete. The address (slug) and brand are not per language.
 */
export function ProductDetailsSection({
    activeLocale,
    onLocaleChange,
}: {
    activeLocale: ProductLocale;
    onLocaleChange: (locale: ProductLocale) => void;
}) {
    const { t } = useTranslation('commerce');
    const form = useFormContext<ProductFormValues>();
    const translations = useWatch({ control: form.control, name: 'translations' });
    const errors = form.formState.errors.translations;

    return (
        <SectionCard
            id={sectionDomId('details')}
            title={t('products.details.title')}
            description={t('products.details.description')}
        >
            <Tabs
                value={activeLocale}
                onValueChange={(value) => onLocaleChange(value as ProductLocale)}
            >
                <TabsList>
                    {PRODUCT_LOCALES.map((locale) => {
                        const complete = translationIsComplete(translations[locale]);
                        const invalid = !!errors?.[locale];
                        return (
                            <TabsTrigger key={locale} value={locale} className="gap-2">
                                {t(`products.languages.${locale}`)}
                                <span
                                    role="img"
                                    aria-label={
                                        invalid
                                            ? t('products.details.languageInvalid')
                                            : complete
                                              ? t('products.details.languageComplete')
                                              : t('products.details.languageIncomplete')
                                    }
                                    className={cn(
                                        'size-2 rounded-full',
                                        invalid
                                            ? 'bg-danger-600'
                                            : complete
                                              ? 'bg-success-600'
                                              : 'bg-neutral-300'
                                    )}
                                />
                            </TabsTrigger>
                        );
                    })}
                </TabsList>
                {PRODUCT_LOCALES.map((locale) => (
                    <TabsContent key={locale} value={locale} className="mt-4">
                        <LanguageFields locale={locale} />
                    </TabsContent>
                ))}
            </Tabs>

            <div className="grid grid-cols-1 gap-4 border-t border-border pt-4 sm:grid-cols-2">
                <CommerceTextField
                    control={form.control}
                    name="slug"
                    label={t('products.details.slug')}
                    description={t('products.details.slugHint')}
                    maxLength={200}
                    transform={(raw) => raw.toLowerCase().replace(/\s+/g, '-')}
                />
                <CommerceTextField
                    control={form.control}
                    name="brand"
                    label={t('products.details.brand')}
                    maxLength={255}
                />
            </div>
        </SectionCard>
    );
}

function LanguageFields({ locale }: { locale: ProductLocale }) {
    const { t } = useTranslation('commerce');
    const form = useFormContext<ProductFormValues>();
    const other: ProductLocale = locale === 'hi' ? 'en' : 'hi';
    const base = `translations.${locale}` as const;
    const blocks = useFieldArray({ control: form.control, name: `${base}.content_blocks` });
    const [newCode, setNewCode] = useState('');
    const fieldErrors = form.formState.errors.translations?.[locale];

    /** Fills what is still empty here from the other language; never overwrites. */
    const copyFromOther = () => {
        const source = form.getValues(`translations.${other}`);
        const target = form.getValues(base);
        if (!translationHasText(source)) {
            toast.info(t('products.details.copyNothing'));
            return;
        }
        const fill = (mine: string, theirs: string) => (mine.trim() ? mine : theirs);
        const codes = new Set(target.content_blocks.map((block) => block.code));
        form.setValue(
            base,
            {
                name: fill(target.name, source.name),
                short_description: fill(target.short_description, source.short_description),
                description_html: isBlankHtml(target.description_html)
                    ? source.description_html
                    : target.description_html,
                seo_title: fill(target.seo_title, source.seo_title),
                seo_description: fill(target.seo_description, source.seo_description),
                content_blocks: [
                    ...target.content_blocks,
                    ...source.content_blocks
                        .filter((block) => !codes.has(block.code))
                        .map((block) => ({ ...block })),
                ],
            },
            { shouldDirty: true, shouldValidate: true }
        );
        toast.success(t('products.details.copied'));
    };

    const addBlock = () => {
        const code = newCode.trim();
        const taken = form.getValues(`${base}.content_blocks`).some((block) => block.code === code);
        if (!BLOCK_CODE.test(code) || taken) {
            toast.error(t('products.validation.blockCode'));
            return;
        }
        blocks.append({ code, html: '' });
        setNewCode('');
    };

    return (
        <div className="flex flex-col gap-4" lang={locale}>
            <div className="flex justify-end">
                <MyButton buttonType="text" scale="small" type="button" onClick={copyFromOther}>
                    <Copy size={14} />
                    {t('products.details.copyFrom', { language: t(`products.languages.${other}`) })}
                </MyButton>
            </div>
            <CommerceTextField
                control={form.control}
                name={`${base}.name`}
                label={t('products.details.name')}
                maxLength={255}
                required={locale === 'hi'}
            />
            <div className="flex flex-col gap-1.5">
                <label
                    htmlFor={`${base}.short_description`}
                    className="text-body font-regular text-foreground"
                >
                    {t('products.details.shortDescription')}
                </label>
                <Textarea
                    id={`${base}.short_description`}
                    rows={2}
                    maxLength={500}
                    {...form.register(`${base}.short_description`)}
                />
            </div>
            <div className="flex flex-col gap-1.5">
                <span className="text-body font-regular text-foreground">
                    {t('products.details.descriptionField')}
                </span>
                <Controller
                    control={form.control}
                    name={`${base}.description_html`}
                    render={({ field }) => (
                        <TipTapEditor
                            value={field.value}
                            onChange={field.onChange}
                            onBlur={field.onBlur}
                            minimalToolbar
                            minHeight={140}
                        />
                    )}
                />
            </div>

            <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                    <p className="text-body font-medium text-foreground">
                        {t('products.details.blocksTitle')}
                    </p>
                    <p className="text-caption text-muted-foreground">
                        {t('products.details.blocksHint')}
                    </p>
                </div>
                {blocks.fields.map((field, index) => (
                    <div
                        key={field.id}
                        className="flex flex-col gap-2 rounded-lg border border-border p-3"
                    >
                        <div className="flex items-center justify-between gap-2">
                            <span className="font-mono text-caption text-foreground">
                                {form.getValues(`${base}.content_blocks.${index}.code`)}
                            </span>
                            <MyButton
                                buttonType="text"
                                scale="small"
                                type="button"
                                onClick={() => blocks.remove(index)}
                            >
                                <Trash size={14} />
                                {t('products.details.removeBlock')}
                            </MyButton>
                        </div>
                        <Controller
                            control={form.control}
                            name={`${base}.content_blocks.${index}.html`}
                            render={({ field: blockField }) => (
                                <TipTapEditor
                                    value={blockField.value}
                                    onChange={blockField.onChange}
                                    onBlur={blockField.onBlur}
                                    minimalToolbar
                                    minHeight={100}
                                />
                            )}
                        />
                        <FieldError message={fieldErrors?.content_blocks?.[index]?.code?.message} />
                    </div>
                ))}
                <div className="flex flex-wrap items-end gap-2">
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5 sm:max-w-xs">
                        <label
                            htmlFor={`${base}.new_block`}
                            className="text-caption text-muted-foreground"
                        >
                            {t('products.details.blockCode')}
                        </label>
                        <MyInput
                            id={`${base}.new_block`}
                            inputType="text"
                            input={newCode}
                            onChangeFunction={(event) =>
                                setNewCode(toBlockCode(event.target.value))
                            }
                            inputPlaceholder={t('products.details.blockCodePlaceholder')}
                            className="sm:w-full"
                        />
                    </div>
                    <MyButton
                        buttonType="secondary"
                        scale="small"
                        type="button"
                        disable={!newCode}
                        onClick={addBlock}
                    >
                        <Plus size={14} />
                        {t('products.details.addBlock')}
                    </MyButton>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-4 border-t border-border pt-4">
                <CommerceTextField
                    control={form.control}
                    name={`${base}.seo_title`}
                    label={t('products.details.seoTitle')}
                    description={t('products.details.seoHint')}
                    maxLength={120}
                />
                <div className="flex flex-col gap-1.5">
                    <label
                        htmlFor={`${base}.seo_description`}
                        className="text-body font-regular text-foreground"
                    >
                        {t('products.details.seoDescription')}
                    </label>
                    <Textarea
                        id={`${base}.seo_description`}
                        rows={2}
                        maxLength={320}
                        {...form.register(`${base}.seo_description`)}
                    />
                </div>
            </div>
        </div>
    );
}
