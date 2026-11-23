/**
 * Owner review: in "Products in <collection>" a collection of 184 showed raw
 * product ids with no status for every product past the first 100, because
 * names came from the first page of the product list only. Now every page is
 * read, and an id with no product behind it reads a sentence, never the id.
 */
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const http = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn() }));
vi.mock('@/lib/auth/axiosInstance', () => ({ default: http }));
vi.mock('@/constants/helper', () => ({ getInstituteId: () => 'inst-1' }));
vi.mock('react-i18next', async (importOriginal) => ({
    ...(await importOriginal<object>()),
    useTranslation: () => ({
        t: (key: string, options?: Record<string, unknown>) =>
            options && 'name' in options ? `${key}:${String(options.name)}` : key,
        i18n: { language: 'en' },
    }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { fetchAllProducts } from '@/routes/commerce/-shared/commerce-api';
import type { CommerceCollection, ProductSummary } from '@/routes/commerce/-shared/commerce-types';
import { CollectionProductsDialog, MEMBER_FILTER_FROM, memberLabel } from './CollectionProductsDialog';

const product = (n: number, extra: Partial<ProductSummary> = {}): ProductSummary => ({
    package_id: `pkg-${n}`,
    external_ref: null,
    slug: `slug-${n}`,
    status: 'ACTIVE',
    brand: null,
    names: { en: `Product ${n}` },
    variant_count: 1,
    min_price: null,
    max_price: null,
    currency: 'INR',
    updated_at: null,
    ...extra,
});

/** A Spring page of the 184 products, 100 a page. */
const ALL = Array.from({ length: 184 }, (_, i) => product(i + 1));
const page = (number: number, size: number) => {
    const content = ALL.slice(number * size, number * size + size);
    return { content, number, size, totalPages: Math.ceil(ALL.length / size), totalElements: ALL.length, last: (number + 1) * size >= ALL.length };
};

const collection = { id: 'col-1', slug: 'bags', name_i18n: { en: 'Bags' } } as unknown as CommerceCollection;

const wrap = (node: ReactNode) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
};

describe('fetchAllProducts', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('reads page after page until the last one', async () => {
        http.get.mockImplementation(async (_url: string, config: { params: { page: number; size: number } }) => ({
            data: page(config.params.page, config.params.size),
        }));
        const rows = await fetchAllProducts({ collectionId: 'col-1' });
        expect(rows).toHaveLength(184);
        expect(http.get).toHaveBeenCalledTimes(2);
        expect(http.get.mock.calls[1][1].params).toMatchObject({ collectionId: 'col-1', page: 1, size: 100 });
    });

    it('stops at the page cap', async () => {
        http.get.mockImplementation(async () => ({ data: { content: [product(1)], number: 0, size: 100, totalPages: 999, last: false } }));
        await fetchAllProducts({}, 3);
        expect(http.get).toHaveBeenCalledTimes(3);
    });
});

describe('memberLabel', () => {
    it('the name in the admin language, else the slug; a missing product reads the sentence', () => {
        expect(memberLabel(product(1), 'en', 'gone')).toBe('Product 1');
        expect(memberLabel(product(2, { names: null }), 'en', 'gone')).toBe('slug-2');
        expect(memberLabel(product(3, { names: null, slug: null }), 'en', 'gone')).toBe('gone');
        expect(memberLabel(undefined, 'en', 'gone')).toBe('gone');
    });
});

describe('CollectionProductsDialog', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        http.get.mockImplementation(async (url: string, config: { params: Record<string, number> }) => {
            if (url.includes('col-1')) {
                // The stored set: all 184, plus one whose product was deleted.
                return { data: [...ALL.map((p) => p.package_id), 'pkg-deleted'] };
            }
            return { data: page(config.params.page ?? 0, config.params.size ?? 100) };
        });
    });

    it('names every product of a 184-product collection with its status; never a raw id', async () => {
        wrap(<CollectionProductsDialog collection={collection} onClose={() => undefined} />);
        expect(await screen.findByText('Product 184')).toBeTruthy();
        expect(screen.getByText('Product 1')).toBeTruthy();
        expect(screen.getByText('Product 150')).toBeTruthy();
        expect(screen.queryByText(/^pkg-/)).toBeNull();
        expect(screen.getByText('collections.productsDialog.missing')).toBeTruthy();
        // One status chip per product that exists, none for the missing one.
        expect(screen.getAllByText('status.product.ACTIVE')).toHaveLength(184);
    });

    it(`a list longer than ${MEMBER_FILTER_FROM} gets a filter box that narrows it by name`, async () => {
        wrap(<CollectionProductsDialog collection={collection} onClose={() => undefined} />);
        await screen.findByText('Product 184');
        const filter = screen.getByLabelText('collections.productsDialog.filter');
        fireEvent.change(filter, { target: { value: 'product 18' } });
        expect(screen.getByText('Product 184')).toBeTruthy();
        expect(screen.getByText('Product 18')).toBeTruthy();
        expect(screen.queryByText('Product 150')).toBeNull();
        fireEvent.change(filter, { target: { value: 'zzz' } });
        expect(screen.getByText('collections.productsDialog.noFilterMatch')).toBeTruthy();
    });
});
