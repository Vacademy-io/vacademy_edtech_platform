import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import {
    GET_ALL_PRODUCT_PAGES,
    CREATE_PRODUCT_PAGE,
    UPDATE_PRODUCT_PAGE,
    GET_PRODUCT_PAGE,
    DELETE_PRODUCT_PAGE,
    CREATE_PRODUCT_PAGE_COUPON,
    DELETE_PRODUCT_PAGE_COUPON,
    ADD_PRODUCT_PAGE_CUSTOM_FIELD,
    REMOVE_PRODUCT_PAGE_CUSTOM_FIELD,
    CREATE_PRODUCT_PAGE_CUSTOM_FIELD,
    REORDER_PRODUCT_PAGE_CUSTOM_FIELDS,
    UPDATE_PRODUCT_PAGE_CUSTOM_FIELD,
    SYNC_PRODUCT_PAGE_CATALOGUE,
    PRODUCT_PAGE_BASE_URL,
} from '@/constants/urls';
import type {
    ProductPageResponse,
    ProductPageRequest,
    ProductPageCouponRequest,
    ProductPageListResponse,
    ProductPageListSort,
    ProductPageListStatus,
} from '../-types/product-page-types';
import type { CatalogueSyncResponse } from '../-utils/catalogue-sync';

export const getAllProductPages = async (
    instituteId: string
): Promise<ProductPageResponse[]> => {
    const response = await authenticatedAxiosInstance.get<ProductPageResponse[]>(
        GET_ALL_PRODUCT_PAGES(instituteId)
    );
    return response.data || [];
};

export interface ListProductPagesParams {
    search?: string;
    status: ProductPageListStatus;
    sort: ProductPageListSort;
    page: number;
    size: number;
}

/** One page of the admin list, filtered, sorted and paged on the server. */
export const listProductPages = async (
    instituteId: string,
    { search, status, sort, page, size }: ListProductPagesParams
): Promise<ProductPageListResponse> => {
    const response = await authenticatedAxiosInstance.get<ProductPageListResponse>(
        `${PRODUCT_PAGE_BASE_URL}/list`,
        {
            params: {
                instituteId,
                search: search?.trim() || undefined,
                status: status === 'ALL' ? undefined : status,
                sort,
                page,
                size,
            },
        }
    );
    const data = response.data;
    return {
        ...data,
        content: data?.content ?? [],
        total_elements: data?.total_elements ?? data?.content?.length ?? 0,
        total_pages: data?.total_pages ?? 0,
        active_count: data?.active_count ?? 0,
        draft_count: data?.draft_count ?? 0,
    };
};

export const createProductPage = async (
    instituteId: string,
    data: ProductPageRequest
): Promise<ProductPageResponse> => {
    const response = await authenticatedAxiosInstance.post<ProductPageResponse>(
        CREATE_PRODUCT_PAGE(instituteId),
        data
    );
    return response.data;
};

export const updateProductPage = async (
    coursePageId: string,
    data: ProductPageRequest
): Promise<ProductPageResponse> => {
    const response = await authenticatedAxiosInstance.put<ProductPageResponse>(
        UPDATE_PRODUCT_PAGE(coursePageId),
        data
    );
    return response.data;
};

export const getProductPage = async (coursePageId: string): Promise<ProductPageResponse> => {
    const response = await authenticatedAxiosInstance.get<ProductPageResponse>(
        GET_PRODUCT_PAGE(coursePageId)
    );
    return response.data;
};

export const deleteProductPage = async (coursePageId: string): Promise<string> => {
    const response = await authenticatedAxiosInstance.delete<string>(
        DELETE_PRODUCT_PAGE(coursePageId)
    );
    return response.data;
};

export const createProductPageCoupon = async (
    coursePageId: string,
    data: ProductPageCouponRequest
): Promise<string> => {
    const response = await authenticatedAxiosInstance.post<string>(
        CREATE_PRODUCT_PAGE_COUPON(coursePageId),
        data
    );
    return response.data;
};

export const deleteProductPageCoupon = async (couponCodeId: string): Promise<string> => {
    const response = await authenticatedAxiosInstance.delete<string>(
        DELETE_PRODUCT_PAGE_COUPON(couponCodeId)
    );
    return response.data;
};

export const addCustomFieldToProductPage = async (
    productPageId: string,
    customFieldId: string,
    instituteId: string
): Promise<ProductPageResponse> => {
    const response = await authenticatedAxiosInstance.post<ProductPageResponse>(
        ADD_PRODUCT_PAGE_CUSTOM_FIELD(productPageId),
        null,
        { params: { customFieldId, instituteId } }
    );
    return response.data;
};

export const removeCustomFieldFromProductPage = async (
    productPageId: string,
    customFieldId: string,
    instituteId: string
): Promise<ProductPageResponse> => {
    const response = await authenticatedAxiosInstance.delete<ProductPageResponse>(
        REMOVE_PRODUCT_PAGE_CUSTOM_FIELD(productPageId, customFieldId),
        { params: { instituteId } }
    );
    return response.data;
};

/** `orderedCustomFieldIds` is the exact order the checkout form should ask in. */
export const reorderProductPageCustomFields = async (
    productPageId: string,
    instituteId: string,
    orderedCustomFieldIds: string[]
): Promise<ProductPageResponse> => {
    const response = await authenticatedAxiosInstance.put<ProductPageResponse>(
        REORDER_PRODUCT_PAGE_CUSTOM_FIELDS(productPageId),
        orderedCustomFieldIds,
        { params: { instituteId } }
    );
    return response.data;
};

export interface ProductPageCustomFieldUpdate {
    field_name?: string;
    field_type?: string;
    is_mandatory?: boolean;
    config?: string;
}

/**
 * Edits a field on this page's form. Only the properties you pass are applied.
 * They live on the shared custom field, so the change reaches every form in the
 * institute that uses it.
 */
export const updateProductPageCustomField = async (
    productPageId: string,
    customFieldId: string,
    instituteId: string,
    update: ProductPageCustomFieldUpdate
): Promise<ProductPageResponse> => {
    const response = await authenticatedAxiosInstance.put<ProductPageResponse>(
        UPDATE_PRODUCT_PAGE_CUSTOM_FIELD(productPageId, customFieldId),
        update,
        { params: { instituteId } }
    );
    return response.data;
};

/**
 * Adds one mapping per catalogue-published course version that the page does
 * not sell yet (server side, saved at once — nothing waits for Save). By
 * default it also switches off mappings whose course left the catalogue;
 * pass `deactivateMissing: false` to keep them.
 */
export const syncProductPageCatalogue = async (
    productPageId: string,
    instituteId: string,
    opts: { deactivateMissing?: boolean } = {}
): Promise<CatalogueSyncResponse> => {
    const response = await authenticatedAxiosInstance.post<CatalogueSyncResponse>(
        SYNC_PRODUCT_PAGE_CATALOGUE(productPageId, instituteId),
        null,
        // The server default is true; only the opt-out travels.
        opts.deactivateMissing === false ? { params: { deactivateMissing: false } } : undefined
    );
    return response.data;
};

export const createAndLinkCustomField = async (
    productPageId: string,
    instituteId: string,
    data: { field_name: string; field_type: string; is_mandatory: boolean; config?: string }
): Promise<ProductPageResponse> => {
    const response = await authenticatedAxiosInstance.post<ProductPageResponse>(
        CREATE_PRODUCT_PAGE_CUSTOM_FIELD(productPageId),
        data,
        { params: { instituteId } }
    );
    return response.data;
};
