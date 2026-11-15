import type { TFunction } from 'i18next';
import { z } from 'zod';
import type { CollectionRequest } from '@/routes/commerce/-shared/catalogue-types';
import type { CommerceCollection } from '@/routes/commerce/-shared/commerce-types';
import { SLUG_PATTERN } from '@/routes/commerce/-shared/product-form';

/** Form model of a collection: text as typed, converted once on save. */
export interface CollectionValues {
    name_hi: string;
    name_en: string;
    description_hi: string;
    description_en: string;
    /** File id of the picture; empty for none. */
    media_id: string;
    slug: string;
    kind: 'CATEGORY' | 'COLLECTION';
    parent_id: string;
    return_window_days: string;
    status: 'ACTIVE' | 'ARCHIVED';
}

export const COLLECTION_DESCRIPTION_MAX = 2000;

export const EMPTY_COLLECTION: CollectionValues = {
    name_hi: '',
    name_en: '',
    description_hi: '',
    description_en: '',
    media_id: '',
    slug: '',
    kind: 'CATEGORY',
    parent_id: '',
    return_window_days: '',
    status: 'ACTIVE',
};

export const buildCollectionSchema = (t: TFunction) =>
    z
        .object({
            name_hi: z.string().trim().max(255),
            name_en: z.string().trim().max(255),
            description_hi: z.string().trim().max(COLLECTION_DESCRIPTION_MAX),
            description_en: z.string().trim().max(COLLECTION_DESCRIPTION_MAX),
            media_id: z.string(),
            slug: z
                .string()
                .trim()
                .max(200, t('collections.validation.slug'))
                .refine((slug) => slug === '' || SLUG_PATTERN.test(slug), {
                    message: t('collections.validation.slug'),
                }),
            kind: z.enum(['CATEGORY', 'COLLECTION']),
            parent_id: z.string(),
            return_window_days: z
                .string()
                .trim()
                .regex(/^\d{0,3}$/, t('collections.validation.returnWindow')),
            status: z.enum(['ACTIVE', 'ARCHIVED']),
        })
        .superRefine((values, ctx) => {
            if (!values.name_hi && !values.name_en) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ['name_hi'],
                    message: t('collections.validation.name'),
                });
            }
        });

export function collectionToValues(collection: CommerceCollection): CollectionValues {
    return {
        name_hi: collection.name_i18n?.hi ?? '',
        name_en: collection.name_i18n?.en ?? '',
        description_hi: collection.description_i18n?.hi ?? '',
        description_en: collection.description_i18n?.en ?? '',
        media_id: collection.media_id ?? '',
        slug: collection.slug ?? '',
        kind: collection.kind === 'COLLECTION' ? 'COLLECTION' : 'CATEGORY',
        parent_id: collection.parent_id ?? '',
        return_window_days:
            collection.return_window_days === null ? '' : String(collection.return_window_days),
        status: collection.status === 'ARCHIVED' ? 'ARCHIVED' : 'ACTIVE',
    };
}

/**
 * The request body. A blank slug on a new collection lets the server make one
 * from the name; an empty parent moves the collection to the top level. The
 * descriptions are sent whole (an empty object clears them) and an empty
 * `media_id` removes the picture.
 */
export function valuesToCollectionRequest(values: CollectionValues): CollectionRequest {
    const names: Record<string, string> = {};
    if (values.name_hi.trim()) names.hi = values.name_hi.trim();
    if (values.name_en.trim()) names.en = values.name_en.trim();
    const descriptions: Record<string, string> = {};
    if (values.description_hi.trim()) descriptions.hi = values.description_hi.trim();
    if (values.description_en.trim()) descriptions.en = values.description_en.trim();
    return {
        name_i18n: names,
        description_i18n: descriptions,
        media_id: values.media_id.trim(),
        kind: values.kind,
        parent_id: values.parent_id,
        status: values.status,
        ...(values.slug.trim() ? { slug: values.slug.trim().toLowerCase() } : {}),
        ...(values.return_window_days.trim()
            ? { return_window_days: Number(values.return_window_days) }
            : {}),
    };
}
