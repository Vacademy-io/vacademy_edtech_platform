/** WP-44 W1: the product editor warns (never blocks) when a cloth's tax class is quoted per piece or per kg. */
import type { ReactNode } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', async () => {
    const { localeT } = await import('@/routes/commerce/-shared/en-t');
    const t = localeT('en');
    return { useTranslation: () => ({ t, i18n: { language: 'en' } }) };
});
vi.mock('@tanstack/react-router', () => ({ Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a> }));

import type { TaxClass } from '@/routes/commerce/-shared/commerce-types';
import { emptyProductValues, type ProductFormValues } from '@/routes/commerce/-shared/product-form';
import { ProductTaxSection } from './ProductSideSections';

const taxClass = (unit: string | null): TaxClass => ({ id: 'tc-1', code: 'TEX', name: 'Textiles', hsn_code: null, unit, status: 'ACTIVE', rules: [] });

function Harness({ values, unit }: { values: Partial<ProductFormValues>; unit: string | null }) {
    const form = useForm<ProductFormValues>({ defaultValues: { ...emptyProductValues(), tax_class_id: 'tc-1', ...values } });
    return (
        <FormProvider {...form}>
            <ProductTaxSection taxMode="REGULAR" taxClasses={[taxClass(unit)]} />
        </FormProvider>
    );
}

describe('ProductTaxSection unit warning', () => {
    it('a cloth on a PCS tax class gets the warning', () => {
        render(<Harness values={{ sold_as: 'MEASURED', unit: 'MTR' }} unit="PCS" />);
        expect(screen.getByTestId('tax-unit-warning').textContent).toBe(
            'This tax class is quoted per piece, but this item is sold per m. Check that its rates and limits are meant for one m.'
        );
    });

    it('a cloth on a KGS tax class names both units', () => {
        render(<Harness values={{ sold_as: 'MEASURED', unit: 'MTR' }} unit="KGS" />);
        expect(screen.getByTestId('tax-unit-warning').textContent).toContain('quoted per kg');
    });

    it('a cloth on an MTR tax class, or a counted item, gets none', () => {
        render(<Harness values={{ sold_as: 'MEASURED', unit: 'MTR' }} unit="MTR" />);
        render(<Harness values={{ sold_as: 'QUANTITY', unit: 'PCS' }} unit="KGS" />);
        expect(screen.queryByTestId('tax-unit-warning')).toBeNull();
    });
});
