import { useEffect, useMemo, useRef, useState } from 'react';
import { type FieldPath, FormProvider, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useBlocker, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { WarningCircle } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { COMMERCE_FEATURE } from '@/lib/commerce/commerce-access';
import { useCommerceAccess } from '@/lib/commerce/use-commerce-access';
import { useAdminLanguage } from '@/routes/commerce/-components/CatalogueBits';
import { CommercePage } from '@/routes/commerce/-components/CommercePage';
import {
    CommerceErrorState,
    CommerceLoadingRows,
    CommerceStatusChip,
} from '@/routes/commerce/-components/CommerceStates';
import {
    useAttributes,
    useChangeProductStatus,
    useCollectionTree,
    useProduct,
    useSaveProduct,
} from '@/routes/commerce/-shared/catalogue-hooks';
import type { ProductDetail, ProductLocale } from '@/routes/commerce/-shared/catalogue-types';
import { readCommerceError } from '@/routes/commerce/-shared/commerce-errors';
import {
    useLocations,
    useTaxClasses,
    useTaxSettings,
} from '@/routes/commerce/-shared/commerce-hooks';
import type { ProductStatus } from '@/routes/commerce/-shared/commerce-types';
import {
    firstErrorPath,
    localeOfField,
    mapProductError,
    sectionDomId,
    sectionOfField,
} from '@/routes/commerce/-shared/product-errors';
import {
    BLOCKER_FIELD,
    type ProductFormValues,
    type PublishBlocker,
    buildProductSchema,
    emptyProductValues,
    productToValues,
    publishBlockers,
    valuesToProductRequest,
} from '@/routes/commerce/-shared/product-form';
import { AttributesSheet } from './AttributesSheet';
import { ProductDetailsSection } from './ProductDetailsSection';
import { ProductMediaSection } from './ProductMediaSection';
import {
    ProductOrganiseSection,
    ProductSellingSection,
    ProductTaxSection,
} from './ProductSideSections';
import { ProductVariantsSection } from './ProductVariantsSection';

const PRODUCTS_ROUTE = '/commerce/products';

/**
 * Product editor. `productId` is the package id, or `new`.
 * The whole editor saves in one call; publish, back-to-draft and archive are
 * a second call on the saved product, so a refusal to publish never loses the
 * draft.
 */
export function ProductEditorPage({ productId }: { productId: string }) {
    const { t } = useTranslation('commerce');
    const language = useAdminLanguage();
    const isNew = productId === 'new';
    const query = useProduct(isNew ? null : productId);
    const product = query.data ?? null;
    // A product created on this screen moves the address from `new` to its id.
    // The form must not be rebuilt for that: it may be showing why the publish
    // that followed the save was refused.
    const [createdId, setCreatedId] = useState<string | null>(null);
    const formKey = createdId && createdId === productId ? 'new' : productId;
    const name =
        product?.translations.find((entry) => entry.locale === language)?.name ||
        product?.translations[0]?.name;

    return (
        <CommercePage
            navId="commerce-products"
            title={isNew ? t('products.editor.newTitle') : name || t('products.editor.title')}
            backTo={{ to: PRODUCTS_ROUTE, label: t('products.editor.back') }}
            actions={product ? <CommerceStatusChip kind="product" value={product.status} /> : null}
        >
            {!isNew && query.isLoading && <CommerceLoadingRows rows={5} />}
            {!isNew && query.isError && (
                <CommerceErrorState
                    message={readCommerceError(query.error, t('products.errors.loadOne')).message}
                    onRetry={() => void query.refetch()}
                />
            )}
            {(isNew || product) && (
                <ProductEditorForm key={formKey} product={product} onCreated={setCreatedId} />
            )}
        </CommercePage>
    );
}

function ProductEditorForm({
    product,
    onCreated,
}: {
    product: ProductDetail | null;
    onCreated: (packageId: string) => void;
}) {
    const { t } = useTranslation('commerce');
    const navigate = useNavigate();
    const access = useCommerceAccess();
    const stockOn = access.isFeatureOn(COMMERCE_FEATURE.STOCK);

    // Tax setup reads open on any commerce feature (CommerceSetupAccess); locations need stock.
    const taxSettings = useTaxSettings();
    const taxClasses = useTaxClasses();
    const locations = useLocations(stockOn);
    const attributes = useAttributes();
    const collections = useCollectionTree();

    const saveMutation = useSaveProduct();
    const statusMutation = useChangeProductStatus();

    // The measure rules read what is stored, so an old row stays editable (WP-44 W3).
    const storedScale = product?.qty_scale;
    const storedUnit = product?.unit;
    const storedMode = product?.stock_mode;
    const schema = useMemo(
        () =>
            buildProductSchema(
                t,
                storedMode === undefined ? null : { qty_scale: storedScale ?? 1, unit: storedUnit ?? null, stock_mode: storedMode }
            ),
        [t, storedScale, storedUnit, storedMode]
    );
    const form = useForm<ProductFormValues>({
        resolver: zodResolver(schema),
        defaultValues: product ? productToValues(product) : emptyProductValues(),
        mode: 'onBlur',
    });
    const [activeLocale, setActiveLocale] = useState<ProductLocale>('hi');
    const [formError, setFormError] = useState<string | null>(null);
    const [blockers, setBlockers] = useState<PublishBlocker[]>([]);
    const [attributesOpen, setAttributesOpen] = useState(false);
    const [busy, setBusy] = useState<'save' | 'status' | null>(null);

    const status = (product?.status ?? 'DRAFT') as ProductStatus;
    const taxMode = taxSettings.data?.tax_mode ?? null;
    const dirty = form.formState.isDirty;

    // Leaving with unsaved changes asks first; a save that navigates does not.
    const leaving = useRef(false);
    useBlocker({
        shouldBlockFn: () => {
            if (!dirty || leaving.current) return false;
            return !window.confirm(t('products.editor.leaveConfirm'));
        },
        enableBeforeUnload: () => dirty && !leaving.current,
    });

    // The last state the server confirmed: what an update is compared with, and
    // the id a second save must go to even before the address has changed.
    const stored = useRef<ProductDetail | null>(product);

    // A server result replaces what the form holds (ids of new variants, scan
    // codes). Messages stay: a refused publish is shown on the saved draft.
    useEffect(() => {
        if (!product) return;
        stored.current = product;
        form.reset(productToValues(product), { keepErrors: true });
    }, [product, form]);

    const goToField = (field: string) => {
        const locale = localeOfField(field);
        if (locale) setActiveLocale(locale);
        // The tab switch renders first; then the card is scrolled into view.
        requestAnimationFrame(() => {
            document
                .getElementById(sectionDomId(sectionOfField(field)))
                ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
    };

    /** Puts a refusal on its field (when it names one) and says it once. */
    const showServerError = (error: unknown, fallback: string) => {
        const read = readCommerceError(error, fallback);
        const mapped = mapProductError(read.message, form.getValues('variants'), read.code);
        const text = mapped.key
            ? t(`products.serverErrors.${mapped.key}`, mapped.params)
            : mapped.message;
        if (mapped.field) {
            form.setError(mapped.field as FieldPath<ProductFormValues>, {
                type: 'server',
                message: text,
            });
            goToField(mapped.field);
        }
        setFormError(text);
        toast.error(text);
    };

    const onInvalid = (errors: unknown) => {
        const first = firstErrorPath(errors);
        if (first) goToField(first);
        setFormError(t('products.editor.fixFields'));
        toast.error(t('products.editor.fixFields'));
    };

    /** Saves the editor. Answers the saved product, or null when it was refused. */
    const save = async (values: ProductFormValues): Promise<ProductDetail | null> => {
        setFormError(null);
        try {
            const saved = await saveMutation.mutateAsync({
                id: stored.current?.package_id,
                body: valuesToProductRequest(values, stored.current),
            });
            stored.current = saved;
            form.reset(productToValues(saved));
            return saved;
        } catch (error) {
            showServerError(error, t('products.errors.save'));
            return null;
        }
    };

    const openSaved = (saved: ProductDetail) => {
        if (product) return;
        leaving.current = true;
        onCreated(saved.package_id);
        void navigate({
            to: '/commerce/products/$productId',
            params: { productId: saved.package_id },
            replace: true,
        }).finally(() => {
            leaving.current = false;
        });
    };

    const submitSave = form.handleSubmit(async (values) => {
        setBusy('save');
        setBlockers([]);
        const saved = await save(values);
        setBusy(null);
        if (!saved) return;
        toast.success(t('products.toast.saved'));
        openSaved(saved);
    }, onInvalid);

    const submitPublish = form.handleSubmit(async (values) => {
        const found = publishBlockers(values, taxMode);
        setBlockers(found);
        if (found.length > 0) {
            const first = found[0];
            if (first) goToField(BLOCKER_FIELD[first]);
            if (found.includes('taxClassMissing')) {
                form.setError('tax_class_id', {
                    type: 'publish',
                    message: t('products.blockers.taxClassMissing'),
                });
            }
            toast.error(t('products.editor.publishBlocked'));
            return;
        }
        setBusy('status');
        const saved = await save(values);
        if (saved) {
            try {
                await statusMutation.mutateAsync({ id: saved.package_id, status: 'ACTIVE' });
                toast.success(t('products.toast.published'));
            } catch (error) {
                // The draft is saved; only the publish was refused.
                showServerError(error, t('products.errors.publish'));
            }
            openSaved(saved);
        }
        setBusy(null);
    }, onInvalid);

    const changeStatus = async (next: ProductStatus) => {
        if (!product) return;
        if (dirty && !window.confirm(t('products.editor.statusWithUnsaved'))) return;
        setBusy('status');
        setFormError(null);
        try {
            await statusMutation.mutateAsync({ id: product.package_id, status: next });
            toast.success(t(`products.toast.statusChanged.${next}`));
        } catch (error) {
            showServerError(error, t('products.errors.status'));
        }
        setBusy(null);
    };

    const isDraft = status === 'DRAFT';

    return (
        <FormProvider {...form}>
            <form
                className="flex flex-col gap-4 pb-24"
                noValidate
                onSubmit={(e) => e.preventDefault()}
            >
                {blockers.length > 0 && (
                    <div
                        role="alert"
                        className="flex flex-col gap-2 rounded-lg border border-warning-200 bg-warning-50 p-4"
                    >
                        <p className="text-body font-medium text-foreground">
                            {t('products.blockers.title')}
                        </p>
                        <ul className="flex flex-col gap-1">
                            {blockers.map((blocker) => (
                                <li key={blocker} className="flex flex-wrap items-center gap-2">
                                    <span className="text-body text-foreground">
                                        {t(`products.blockers.${blocker}`)}
                                    </span>
                                    <MyButton
                                        buttonType="text"
                                        scale="small"
                                        type="button"
                                        onClick={() => goToField(BLOCKER_FIELD[blocker])}
                                    >
                                        {t('products.blockers.goToField')}
                                    </MyButton>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}

                <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                    <div className="flex min-w-0 flex-col gap-4 lg:col-span-2">
                        <ProductDetailsSection
                            activeLocale={activeLocale}
                            onLocaleChange={setActiveLocale}
                        />
                        <ProductMediaSection product={product} />
                        <ProductSellingSection locked={!!product?.published_at} />
                        <ProductVariantsSection
                            attributes={attributes.data ?? []}
                            attributesLoading={attributes.isLoading}
                            onManageAttributes={() => setAttributesOpen(true)}
                        />
                    </div>
                    <div className="flex min-w-0 flex-col gap-4">
                        <ProductTaxSection taxMode={taxMode} taxClasses={taxClasses.data ?? []} />
                        <ProductOrganiseSection
                            locations={locations.data ?? []}
                            stockFeatureOn={stockOn}
                            collections={collections.data ?? []}
                            attributes={attributes.data ?? []}
                            onManageAttributes={() => setAttributesOpen(true)}
                        />
                        {product && (
                            <section className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
                                <h3 className="text-subtitle font-medium text-foreground">
                                    {t('products.editor.statusTitle')}
                                </h3>
                                <div className="flex items-center gap-2">
                                    <CommerceStatusChip kind="product" value={status} />
                                    <span className="text-caption text-muted-foreground">
                                        {t(`products.editor.statusHelp.${status}`)}
                                    </span>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    {!isDraft && (
                                        <MyButton
                                            buttonType="secondary"
                                            scale="small"
                                            type="button"
                                            disable={busy !== null}
                                            onClick={() => void changeStatus('DRAFT')}
                                        >
                                            {t('products.setStatus.DRAFT')}
                                        </MyButton>
                                    )}
                                    {status !== 'ARCHIVED' && (
                                        <MyButton
                                            buttonType="secondary"
                                            scale="small"
                                            type="button"
                                            disable={busy !== null}
                                            onClick={() => void changeStatus('ARCHIVED')}
                                        >
                                            {t('products.setStatus.ARCHIVED')}
                                        </MyButton>
                                    )}
                                </div>
                            </section>
                        )}
                    </div>
                </div>

                <div data-assistant-fab="avoid-phone" className="sticky bottom-0 z-10 -mx-4 flex flex-col gap-2 border-t border-border bg-background p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-start gap-2" aria-live="polite">
                        {formError ? (
                            <>
                                <WarningCircle
                                    size={16}
                                    weight="fill"
                                    className="mt-0.5 shrink-0 text-danger-600"
                                />
                                <p role="alert" className="text-caption text-danger-600">
                                    {formError}
                                </p>
                            </>
                        ) : (
                            <p className="text-caption text-muted-foreground">
                                {dirty
                                    ? t('products.editor.unsaved')
                                    : t('products.editor.allSaved')}
                            </p>
                        )}
                    </div>
                    <div className="flex flex-wrap justify-end gap-2">
                        {isDraft ? (
                            <>
                                <MyButton
                                    buttonType="secondary"
                                    scale="medium"
                                    type="button"
                                    disable={busy !== null}
                                    onClick={() => void submitSave()}
                                >
                                    {busy === 'save'
                                        ? t('common.saving')
                                        : t('products.editor.saveDraft')}
                                </MyButton>
                                <MyButton
                                    buttonType="primary"
                                    scale="medium"
                                    type="button"
                                    disable={busy !== null}
                                    onClick={() => void submitPublish()}
                                >
                                    {busy === 'status'
                                        ? t('products.editor.publishing')
                                        : t('products.editor.publish')}
                                </MyButton>
                            </>
                        ) : (
                            <MyButton
                                buttonType="primary"
                                scale="medium"
                                type="button"
                                disable={busy !== null}
                                onClick={() => void submitSave()}
                            >
                                {busy === 'save' ? t('common.saving') : t('common.saveChanges')}
                            </MyButton>
                        )}
                    </div>
                </div>
            </form>
            <AttributesSheet open={attributesOpen} onOpenChange={setAttributesOpen} />
        </FormProvider>
    );
}
