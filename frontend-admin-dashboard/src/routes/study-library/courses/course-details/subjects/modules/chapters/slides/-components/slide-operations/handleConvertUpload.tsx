import { toast } from 'sonner';
import type { TFunction } from 'i18next';
import i18n from '@/i18n';

import { convertHtmlToPdf } from '../../-helper/helper';

const NAMESPACE = 'studyLibraryHandleConvertUpload';

/**
 * This handler runs outside a React render tree (it's a plain exported async
 * function invoked from event handlers), so it can't use the `useTranslation`
 * hook. Fall back to the shared i18next singleton directly.
 */
const globalT: TFunction = ((key: string, options?: Record<string, unknown>) =>
    i18n.t(key, { ns: NAMESPACE, ...options })) as TFunction;

export const handleConvertAndUpload = async (htmlString: string | null): Promise<string | null> => {
    if (htmlString == null) return null;
    try {
        // Step 1: Convert HTML to PDF
        const { pdfBlob } = await convertHtmlToPdf(htmlString);

        // Step 2: Create a download link
        const url = window.URL.createObjectURL(pdfBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'document.pdf';
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);

        toast.success(globalT('downloadSuccess'));
        return null;
    } catch (error) {
        console.error('Download Failed:', error);
        toast.error(globalT('downloadError'));
    }
    return null;
};
