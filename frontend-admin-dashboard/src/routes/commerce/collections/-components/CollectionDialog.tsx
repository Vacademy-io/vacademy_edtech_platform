import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useQuery } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Image as ImageIcon } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { Form } from '@/components/ui/form';
import { useAdminLanguage } from '@/routes/commerce/-components/CatalogueBits';
import {
    CommerceSelectField,
    CommerceTextField,
} from '@/routes/commerce/-components/CommerceFormFields';
import { useSaveCollection } from '@/routes/commerce/-shared/catalogue-hooks';
import { i18nName, parentChoices } from '@/routes/commerce/-shared/collection-tree';
import { readCommerceError } from '@/routes/commerce/-shared/commerce-errors';
import type { CommerceCollection } from '@/routes/commerce/-shared/commerce-types';
import { getInstituteId } from '@/constants/helper';
import { UploadFileInS3, getPublicUrl } from '@/services/upload_file';
import { getUserId } from '@/utils/userDetails';
import {
    COLLECTION_DESCRIPTION_MAX,
    type CollectionValues,
    EMPTY_COLLECTION,
    buildCollectionSchema,
    collectionToValues,
    valuesToCollectionRequest,
} from './collection-form';

/** Value of "top level" in the parent select; Radix Select has no empty value. */
const TOP = '__top__';
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
/** The same upload source as product photos: a picture the shop shows in public. */
const UPLOAD_SOURCE = 'COMMERCE_PRODUCT_MEDIA';

/**
 * The picture of a collection (home page tiles, collection header): upload,
 * replace, remove. The file goes to the media service at once; the collection
 * keeps its id when the dialog is saved.
 */
function CollectionImageField({
    mediaId,
    onChange,
}: {
    mediaId: string;
    onChange: (mediaId: string) => void;
}) {
    const { t } = useTranslation('commerce');
    const fileInput = useRef<HTMLInputElement>(null);
    const [uploading, setUploading] = useState(false);
    const preview = useQuery({
        queryKey: ['commerce', 'media-url', mediaId],
        queryFn: () => getPublicUrl(mediaId),
        enabled: mediaId !== '',
        staleTime: 30 * 60 * 1000,
    });

    const upload = async (file: File | undefined) => {
        if (!file) return;
        if (!file.type.startsWith('image/') || file.size > MAX_IMAGE_BYTES) {
            toast.error(t('collections.errors.imageType'));
            return;
        }
        try {
            const uploaded = await UploadFileInS3(
                file,
                setUploading,
                getUserId(),
                UPLOAD_SOURCE,
                getInstituteId(),
                true
            );
            if (!uploaded) throw new Error('no file id');
            onChange(uploaded);
        } catch {
            toast.error(t('collections.errors.imageUpload'));
        } finally {
            setUploading(false);
        }
    };

    return (
        <div className="flex flex-col gap-1.5 sm:col-span-2">
            <span className="text-subtitle font-medium text-neutral-700">
                {t('collections.fields.image')}
            </span>
            <div className="flex items-center gap-3">
                <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
                    {mediaId && preview.data ? (
                        <img
                            src={preview.data}
                            alt={t('collections.fields.imageAlt')}
                            className="size-full object-cover"
                        />
                    ) : (
                        <ImageIcon size={24} className="text-neutral-400" aria-hidden />
                    )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <input
                        ref={fileInput}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(event) => {
                            void upload(event.target.files?.[0]);
                            event.target.value = '';
                        }}
                    />
                    <MyButton
                        buttonType="secondary"
                        scale="small"
                        type="button"
                        disable={uploading}
                        onClick={() => fileInput.current?.click()}
                    >
                        {uploading
                            ? t('collections.fields.imageUploading')
                            : mediaId
                              ? t('collections.fields.imageReplace')
                              : t('collections.fields.imageUpload')}
                    </MyButton>
                    {mediaId && !uploading && (
                        <MyButton
                            buttonType="text"
                            scale="small"
                            type="button"
                            onClick={() => onChange('')}
                        >
                            {t('collections.fields.imageRemove')}
                        </MyButton>
                    )}
                </div>
            </div>
            <p className="text-caption text-neutral-500">{t('collections.fields.imageHint')}</p>
        </div>
    );
}

interface CollectionDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** `null` to add; a collection to edit. */
    collection: CommerceCollection | null;
    /** Parent preselected for "add inside". */
    initialParentId: string;
    tree: CommerceCollection[];
}

/**
 * Add or edit a collection: its name and description in both languages, its
 * picture, where it sits in the tree, its kind, the return window for its
 * products, and its status.
 */
export function CollectionDialog({
    open,
    onOpenChange,
    collection,
    initialParentId,
    tree,
}: CollectionDialogProps) {
    const { t } = useTranslation('commerce');
    const language = useAdminLanguage();
    const mutation = useSaveCollection();
    const isEdit = !!collection;
    const schema = useMemo(() => buildCollectionSchema(t), [t]);
    const form = useForm<CollectionValues>({
        resolver: zodResolver(schema),
        defaultValues: EMPTY_COLLECTION,
        mode: 'onBlur',
    });

    useEffect(() => {
        if (!open) return;
        const values = collection
            ? collectionToValues(collection)
            : { ...EMPTY_COLLECTION, parent_id: initialParentId };
        form.reset({ ...values, parent_id: values.parent_id || TOP });
    }, [open, collection, initialParentId, form]);

    // A collection cannot sit under itself or its own descendants.
    const parents = useMemo(
        () => [
            { value: TOP, label: t('collections.fields.topLevel') },
            ...parentChoices(tree, collection).map((entry) => ({
                value: entry.collection.id,
                label: `${'— '.repeat(entry.depth)}${i18nName(
                    entry.collection.name_i18n,
                    language,
                    entry.collection.slug ?? ''
                )}`,
            })),
        ],
        [tree, collection, language, t]
    );

    const onSubmit = async (values: CollectionValues) => {
        try {
            await mutation.mutateAsync({
                id: collection?.id,
                body: valuesToCollectionRequest({
                    ...values,
                    parent_id: values.parent_id === TOP ? '' : values.parent_id,
                }),
            });
            toast.success(isEdit ? t('collections.toast.updated') : t('collections.toast.created'));
            onOpenChange(false);
        } catch (error) {
            const message = readCommerceError(error, t('collections.errors.save')).message;
            if (/slug/i.test(message)) form.setError('slug', { message });
            toast.error(message);
        }
    };

    return (
        <MyDialog
            heading={
                isEdit ? t('collections.dialog.editHeading') : t('collections.dialog.addHeading')
            }
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-2xl"
            footer={
                <div className="flex justify-end gap-2">
                    <MyButton
                        buttonType="secondary"
                        scale="medium"
                        type="button"
                        onClick={() => onOpenChange(false)}
                    >
                        {t('common.cancel')}
                    </MyButton>
                    <MyButton
                        buttonType="primary"
                        scale="medium"
                        type="button"
                        onAsyncClick={form.handleSubmit(onSubmit)}
                        loadingText={t('common.saving')}
                    >
                        {isEdit ? t('common.saveChanges') : t('collections.dialog.add')}
                    </MyButton>
                </div>
            }
        >
            <Form {...form}>
                <form className="grid grid-cols-1 gap-4 sm:grid-cols-2" noValidate>
                    <CommerceTextField
                        control={form.control}
                        name="name_hi"
                        label={t('collections.fields.nameHi')}
                        maxLength={255}
                        required
                    />
                    <CommerceTextField
                        control={form.control}
                        name="name_en"
                        label={t('collections.fields.nameEn')}
                        maxLength={255}
                    />
                    <CommerceTextField
                        control={form.control}
                        name="description_hi"
                        label={t('collections.fields.descriptionHi')}
                        description={t('collections.fields.descriptionHint')}
                        maxLength={COLLECTION_DESCRIPTION_MAX}
                    />
                    <CommerceTextField
                        control={form.control}
                        name="description_en"
                        label={t('collections.fields.descriptionEn')}
                        maxLength={COLLECTION_DESCRIPTION_MAX}
                    />
                    <CollectionImageField
                        mediaId={form.watch('media_id')}
                        onChange={(mediaId) =>
                            form.setValue('media_id', mediaId, { shouldDirty: true })
                        }
                    />
                    <CommerceSelectField
                        control={form.control}
                        name="parent_id"
                        label={t('collections.fields.parent')}
                        options={parents}
                    />
                    <CommerceSelectField
                        control={form.control}
                        name="kind"
                        label={t('collections.fields.kind')}
                        description={t('collections.fields.kindHint')}
                        options={(['CATEGORY', 'COLLECTION'] as const).map((value) => ({
                            value,
                            label: t(`collections.kinds.${value}`),
                        }))}
                    />
                    <CommerceTextField
                        control={form.control}
                        name="slug"
                        label={t('collections.fields.slug')}
                        description={t('collections.fields.slugHint')}
                        maxLength={200}
                        transform={(raw) => raw.toLowerCase().replace(/\s+/g, '-')}
                    />
                    <CommerceTextField
                        control={form.control}
                        name="return_window_days"
                        label={t('collections.fields.returnWindow')}
                        description={t('collections.fields.returnWindowHint')}
                        inputMode="numeric"
                        transform={(raw) => raw.replace(/\D/g, '').slice(0, 3)}
                    />
                    {isEdit && (
                        <CommerceSelectField
                            control={form.control}
                            name="status"
                            label={t('collections.fields.status')}
                            options={(['ACTIVE', 'ARCHIVED'] as const).map((value) => ({
                                value,
                                label: t(`status.collection.${value}`),
                            }))}
                        />
                    )}
                </form>
            </Form>
        </MyDialog>
    );
}
