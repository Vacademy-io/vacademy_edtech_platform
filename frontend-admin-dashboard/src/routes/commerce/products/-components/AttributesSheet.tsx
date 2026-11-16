import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { PencilSimple, Plus, Trash } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from '@/components/ui/sheet';
import { PlainSelect, useAdminLanguage } from '@/routes/commerce/-components/CatalogueBits';
import {
    CommerceEmptyState,
    CommerceErrorState,
    CommerceLoadingRows,
} from '@/routes/commerce/-components/CommerceStates';
import {
    useAttributes,
    useDeleteAttribute,
    useDeleteAttributeValue,
    useSaveAttribute,
    useSaveAttributeValue,
} from '@/routes/commerce/-shared/catalogue-hooks';
import {
    type AttributeKind,
    type CommerceAttribute,
    type CommerceAttributeValue,
    PRODUCT_LOCALES,
} from '@/routes/commerce/-shared/catalogue-types';
import { i18nName } from '@/routes/commerce/-shared/collection-tree';
import { readCommerceError } from '@/routes/commerce/-shared/commerce-errors';

const KINDS: AttributeKind[] = ['TEXT', 'SWATCH', 'SIZE'];
/** The server's code rule: lower-case letters, digits, single underscores. */
const CODE = /^[a-z0-9]+(_[a-z0-9]+)*$/;
const SWATCH = /^#[0-9A-Fa-f]{6}$/;
const toCode = (raw: string) =>
    raw
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, '_')
        .replace(/^_+/, '')
        .slice(0, 64);

interface Draft {
    /** Empty for a new row. */
    id: string;
    code: string;
    hi: string;
    en: string;
    kind: AttributeKind;
    filterable: boolean;
    swatch: string;
}

const EMPTY_DRAFT: Draft = {
    id: '',
    code: '',
    hi: '',
    en: '',
    kind: 'TEXT',
    filterable: true,
    swatch: '',
};

/**
 * "Manage attributes": the shop's attributes (size, colour,
 * fabric, …) and their values, each with a Hindi and an English name. An
 * attribute is used either as an option that varies between variants or as a
 * facet of the whole product; that choice is made on the product.
 *
 * The code is fixed once created. Something in use cannot be deleted; the
 * server says so and the sentence is shown.
 */
export function AttributesSheet({
    open,
    onOpenChange,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const { t } = useTranslation('commerce');
    const language = useAdminLanguage();
    const query = useAttributes(open);
    const saveAttribute = useSaveAttribute();
    const deleteAttribute = useDeleteAttribute();
    const saveValue = useSaveAttributeValue();
    const deleteValue = useDeleteAttributeValue();
    /** `attribute` edits an attribute; `value:<attributeId>` edits one of its values. */
    const [editing, setEditing] = useState<{ scope: string; draft: Draft } | null>(null);
    const attributes = query.data ?? [];

    const names = (draft: Draft) =>
        PRODUCT_LOCALES.reduce<Record<string, string>>((out, locale) => {
            if (draft[locale].trim()) out[locale] = draft[locale].trim();
            return out;
        }, {});

    const problemOf = (draft: Draft, isValue: boolean, kind: string): string | null => {
        if (!draft.hi.trim() && !draft.en.trim()) return t('attributes.validation.name');
        if (!draft.id && !CODE.test(draft.code)) return t('attributes.validation.code');
        if (isValue && kind === 'SWATCH' && draft.swatch && !SWATCH.test(draft.swatch)) {
            return t('attributes.validation.swatch');
        }
        return null;
    };

    const submit = async () => {
        if (!editing) return;
        const { scope, draft } = editing;
        const attributeId = scope.startsWith('value:') ? scope.slice(6) : null;
        const parent = attributes.find((attribute) => attribute.id === attributeId);
        const problem = problemOf(draft, !!attributeId, parent?.kind ?? '');
        if (problem) {
            toast.error(problem);
            return;
        }
        try {
            if (attributeId) {
                await saveValue.mutateAsync({
                    attributeId,
                    valueId: draft.id || undefined,
                    body: {
                        ...(draft.id ? {} : { code: draft.code }),
                        label_i18n: names(draft),
                        ...(parent?.kind === 'SWATCH' ? { swatch_hex: draft.swatch } : {}),
                    },
                });
            } else {
                await saveAttribute.mutateAsync({
                    id: draft.id || undefined,
                    body: {
                        ...(draft.id ? {} : { code: draft.code }),
                        name_i18n: names(draft),
                        kind: draft.kind,
                        is_filterable: draft.filterable,
                    },
                });
            }
            toast.success(t('attributes.toast.saved'));
            setEditing(null);
        } catch (error) {
            toast.error(readCommerceError(error, t('attributes.errors.save')).message);
        }
    };

    const remove = async (attribute: CommerceAttribute, value?: CommerceAttributeValue) => {
        const name = value
            ? i18nName(value.label_i18n, language, value.code)
            : i18nName(attribute.name_i18n, language, attribute.code);
        if (!window.confirm(t('attributes.deleteConfirm', { name }))) return;
        try {
            if (value) {
                await deleteValue.mutateAsync({ attributeId: attribute.id, valueId: value.id });
            } else {
                await deleteAttribute.mutateAsync(attribute.id);
            }
            toast.success(t('attributes.toast.deleted'));
        } catch (error) {
            toast.error(readCommerceError(error, t('attributes.errors.delete')).message);
        }
    };

    const draftForm = (scope: string, kind: string) => {
        if (!editing || editing.scope !== scope) return null;
        const { draft } = editing;
        const isValue = scope.startsWith('value:');
        const set = (patch: Partial<Draft>) => setEditing({ scope, draft: { ...draft, ...patch } });
        return (
            <div className="flex flex-col gap-3 rounded-lg border border-primary-200 bg-primary-50 p-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {PRODUCT_LOCALES.map((locale) => (
                        <div key={locale} className="flex min-w-0 flex-col gap-1">
                            <label
                                htmlFor={`attribute-draft-${locale}`}
                                className="text-caption text-muted-foreground"
                            >
                                {t('attributes.fields.name', {
                                    language: t(`products.languages.${locale}`),
                                })}
                            </label>
                            <MyInput
                                id={`attribute-draft-${locale}`}
                                inputType="text"
                                lang={locale}
                                maxLength={120}
                                input={draft[locale]}
                                onChangeFunction={(event) => set({ [locale]: event.target.value })}
                                className="sm:w-full"
                            />
                        </div>
                    ))}
                    <div className="flex min-w-0 flex-col gap-1">
                        <label
                            htmlFor="attribute-draft-code"
                            className="text-caption text-muted-foreground"
                        >
                            {t('attributes.fields.code')}
                        </label>
                        <MyInput
                            id="attribute-draft-code"
                            inputType="text"
                            input={draft.code}
                            disabled={!!draft.id}
                            onChangeFunction={(event) => set({ code: toCode(event.target.value) })}
                            className="font-mono sm:w-full"
                        />
                        <span className="text-caption text-muted-foreground">
                            {t('attributes.fields.codeHint')}
                        </span>
                    </div>
                    {!isValue && (
                        <PlainSelect
                            label={t('attributes.fields.kind')}
                            value={draft.kind}
                            onChange={(next) => set({ kind: next as AttributeKind })}
                            options={KINDS.map((value) => ({
                                value,
                                label: t(`attributes.kinds.${value}`),
                            }))}
                        />
                    )}
                    {isValue && kind === 'SWATCH' && (
                        <div className="flex min-w-0 flex-col gap-1">
                            <label
                                htmlFor="attribute-draft-swatch"
                                className="text-caption text-muted-foreground"
                            >
                                {t('attributes.fields.swatch')}
                            </label>
                            <MyInput
                                id="attribute-draft-swatch"
                                inputType="text"
                                input={draft.swatch}
                                maxLength={7}
                                inputPlaceholder={t('attributes.fields.swatchPlaceholder')}
                                onChangeFunction={(event) =>
                                    set({ swatch: event.target.value.trim() })
                                }
                                className="font-mono sm:w-full"
                            />
                        </div>
                    )}
                </div>
                {!isValue && (
                    <label className="flex items-center gap-2 text-body text-foreground">
                        <Checkbox
                            checked={draft.filterable}
                            onCheckedChange={(checked) => set({ filterable: checked === true })}
                        />
                        {t('attributes.fields.filterable')}
                    </label>
                )}
                <div className="flex justify-end gap-2">
                    <MyButton
                        buttonType="secondary"
                        scale="small"
                        type="button"
                        onClick={() => setEditing(null)}
                    >
                        {t('common.cancel')}
                    </MyButton>
                    <MyButton
                        buttonType="primary"
                        scale="small"
                        type="button"
                        onAsyncClick={submit}
                        loadingText={t('common.saving')}
                    >
                        {t('common.save')}
                    </MyButton>
                </div>
            </div>
        );
    };

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent
                side="right"
                className="flex w-full flex-col gap-4 overflow-y-auto sm:max-w-xl"
            >
                <SheetHeader>
                    <SheetTitle>{t('attributes.title')}</SheetTitle>
                    <SheetDescription>{t('attributes.description')}</SheetDescription>
                </SheetHeader>

                {query.isLoading && <CommerceLoadingRows rows={3} />}
                {query.isError && (
                    <CommerceErrorState
                        message={
                            readCommerceError(query.error, t('attributes.errors.load')).message
                        }
                        onRetry={() => void query.refetch()}
                    />
                )}
                {query.isSuccess && attributes.length === 0 && !editing && (
                    <CommerceEmptyState
                        title={t('attributes.empty.title')}
                        description={t('attributes.empty.description')}
                    />
                )}

                <ul className="flex flex-col gap-3">
                    {attributes.map((attribute) => (
                        <li
                            key={attribute.id}
                            className="flex flex-col gap-3 rounded-lg border border-border p-3"
                        >
                            <div className="flex items-start justify-between gap-2">
                                <div className="flex min-w-0 flex-col">
                                    <span className="text-body font-medium text-foreground">
                                        {i18nName(attribute.name_i18n, language, attribute.code)}
                                    </span>
                                    <span className="text-caption text-muted-foreground">
                                        <span className="font-mono">{attribute.code}</span>
                                        {' · '}
                                        {t(`attributes.kinds.${attribute.kind}`, {
                                            defaultValue: attribute.kind,
                                        })}
                                    </span>
                                </div>
                                <div className="flex shrink-0 items-center gap-1">
                                    <MyButton
                                        buttonType="secondary"
                                        layoutVariant="icon"
                                        scale="small"
                                        type="button"
                                        aria-label={t('attributes.edit', {
                                            name: i18nName(
                                                attribute.name_i18n,
                                                language,
                                                attribute.code
                                            ),
                                        })}
                                        onClick={() =>
                                            setEditing({
                                                scope: `attribute:${attribute.id}`,
                                                draft: {
                                                    ...EMPTY_DRAFT,
                                                    id: attribute.id,
                                                    code: attribute.code,
                                                    hi: attribute.name_i18n.hi ?? '',
                                                    en: attribute.name_i18n.en ?? '',
                                                    kind: KINDS.includes(
                                                        attribute.kind as AttributeKind
                                                    )
                                                        ? (attribute.kind as AttributeKind)
                                                        : 'TEXT',
                                                    filterable: attribute.is_filterable,
                                                },
                                            })
                                        }
                                    >
                                        <PencilSimple size={14} />
                                    </MyButton>
                                    <MyButton
                                        buttonType="secondary"
                                        layoutVariant="icon"
                                        scale="small"
                                        type="button"
                                        aria-label={t('attributes.delete', {
                                            name: i18nName(
                                                attribute.name_i18n,
                                                language,
                                                attribute.code
                                            ),
                                        })}
                                        onClick={() => void remove(attribute)}
                                    >
                                        <Trash size={14} />
                                    </MyButton>
                                </div>
                            </div>
                            {draftForm(`attribute:${attribute.id}`, attribute.kind)}

                            <ul className="flex flex-wrap gap-2">
                                {attribute.values.map((value) => (
                                    <li
                                        key={value.id}
                                        className="flex items-center gap-1 rounded-md border border-border py-0.5 pe-1 ps-2"
                                    >
                                        {value.swatch_hex && (
                                            <span
                                                aria-hidden
                                                className="size-3 rounded-full border border-border"
                                                // The colour is the seller's own data, not a design token.
                                                style={{ backgroundColor: value.swatch_hex }}
                                            />
                                        )}
                                        <span className="text-caption text-foreground">
                                            {i18nName(value.label_i18n, language, value.code)}
                                        </span>
                                        <MyButton
                                            buttonType="text"
                                            layoutVariant="icon"
                                            scale="small"
                                            type="button"
                                            aria-label={t('attributes.edit', {
                                                name: i18nName(
                                                    value.label_i18n,
                                                    language,
                                                    value.code
                                                ),
                                            })}
                                            onClick={() =>
                                                setEditing({
                                                    scope: `value:${attribute.id}`,
                                                    draft: {
                                                        ...EMPTY_DRAFT,
                                                        id: value.id,
                                                        code: value.code,
                                                        hi: value.label_i18n.hi ?? '',
                                                        en: value.label_i18n.en ?? '',
                                                        swatch: value.swatch_hex ?? '',
                                                    },
                                                })
                                            }
                                        >
                                            <PencilSimple size={12} />
                                        </MyButton>
                                        <MyButton
                                            buttonType="text"
                                            layoutVariant="icon"
                                            scale="small"
                                            type="button"
                                            aria-label={t('attributes.delete', {
                                                name: i18nName(
                                                    value.label_i18n,
                                                    language,
                                                    value.code
                                                ),
                                            })}
                                            onClick={() => void remove(attribute, value)}
                                        >
                                            <Trash size={12} />
                                        </MyButton>
                                    </li>
                                ))}
                            </ul>
                            {draftForm(`value:${attribute.id}`, attribute.kind)}
                            {editing?.scope !== `value:${attribute.id}` && (
                                <div>
                                    <MyButton
                                        buttonType="text"
                                        scale="small"
                                        type="button"
                                        onClick={() =>
                                            setEditing({
                                                scope: `value:${attribute.id}`,
                                                draft: EMPTY_DRAFT,
                                            })
                                        }
                                    >
                                        <Plus size={14} />
                                        {t('attributes.addValue')}
                                    </MyButton>
                                </div>
                            )}
                        </li>
                    ))}
                </ul>

                {draftForm('attribute:new', 'TEXT')}
                {editing?.scope !== 'attribute:new' && (
                    <div>
                        <MyButton
                            buttonType="secondary"
                            scale="medium"
                            type="button"
                            onClick={() =>
                                setEditing({ scope: 'attribute:new', draft: EMPTY_DRAFT })
                            }
                        >
                            <Plus size={16} />
                            {t('attributes.add')}
                        </MyButton>
                    </div>
                )}
            </SheetContent>
        </Sheet>
    );
}
