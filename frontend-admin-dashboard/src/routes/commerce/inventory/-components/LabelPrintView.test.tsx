/** Fix round: a label's own words follow the label's language, not the admin's screen (L1); SKU on the code line. */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string) => `ui:${key}`,
        i18n: { language: 'hi', getFixedT: (lng: string) => (key: string) => `${lng}:${key}` },
    }),
}));

import type { PrintLabel } from '../-shared/inventory-types';
import { LabelPrintView } from './LabelPrintView';

const label: PrintLabel = {
    request_id: 'r1',
    code: 'PABCDEFGH2',
    qr_value: 'https://shop.example/q/PABCDEFGH2',
    product_name: { en: 'Cotton dupatta', hi: 'सूती दुपट्टा' },
    variant_name: { en: null, hi: null },
    price: 1200,
    currency: 'INR',
    unit: 'KGS',
    sku: 'DUP-1',
    copies: 1,
};

describe('LabelPrintView', () => {
    it('an English label prints English words though the screen is in Hindi', () => {
        render(<LabelPrintView labels={[label]} template="STICKER_50X25" language="en" startPosition={1} />);
        const text = screen.getByTestId('label-print-view').textContent ?? '';
        expect(text).toContain('en:inventory.labels.mrp');
        expect(text).toContain('en:inventory.labels.inclTaxes');
        expect(text).not.toContain('ui:');
        expect(text).toContain(' / kg');
        expect(screen.getByTestId('label-code-line').textContent).toBe('PABCDEFGH2 · DUP-1');
    });

    it('a Hindi label (and the default both) prints the Hindi words', () => {
        render(<LabelPrintView labels={[label]} template="A4_65" language="both" startPosition={1} />);
        expect(screen.getByTestId('label-print-view').textContent).toContain('hi:inventory.labels.mrp');
    });
});
