import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { formatMoney } from '@/components/design-system/money-cell';
import { fetchChallanPdf } from '../-shared/inventory-api';
import type { TransferView } from '../-shared/inventory-types';
import { openPdf, safeFileName } from '../-shared/label-print';

/** Print challan: the tab opens inside the click, then the PDF fills it. */
export function useChallanPrint() {
    const { t } = useTranslation('commerce');
    const [error, setError] = useState<unknown>(null);
    const print = async (view: TransferView) => {
        setError(null);
        try {
            const how = await openPdf(
                () => fetchChallanPdf(view.id),
                `${safeFileName(view.document_number ?? view.transfer_number ?? 'challan')}.pdf`
            );
            if (how === 'downloaded') toast.info(t('inventory.pdf.downloaded'));
        } catch (e) {
            setError(e);
        }
    };
    return { print, error };
}

/** Value above which the dispatch dialog mentions an e-way bill (₹50,000). */
export const EWAY_HINT_ABOVE = 50_000;
export const valueText = (value: number | null) => (value === null ? '—' : formatMoney(value, 'INR'));
