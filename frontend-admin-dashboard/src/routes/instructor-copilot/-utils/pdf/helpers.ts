import jsPDF from 'jspdf';
import i18n from '@/i18n';

// Extend jsPDF type to include autoTable
declare module 'jspdf' {
    interface jsPDF {
        autoTable: (options: any) => jsPDF;
    }
}

/**
 * Strip HTML tags from a string
 */
export const stripHtmlTags = (html: string): string => {
    return html.replace(/<!--.*?-->/g, '').replace(/<[^>]*>/g, '').trim();
};

/**
 * Get correct option IDs from auto evaluation JSON
 */
export const getCorrectOptionIds = (autoEvalJson: string): string[] => {
    try {
        const parsed = JSON.parse(autoEvalJson);
        return parsed.data?.correctOptionIds || [];
    } catch {
        return [];
    }
};

/**
 * Add page numbers to all pages in the document
 */
export const addPageNumbers = (doc: jsPDF): void => {
    const pageCount = doc.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(9);
        doc.setTextColor(150);
        doc.text(
            i18n.t('instructorCopilotPdfHelpers:pageOf', { current: i, total: pageCount }),
            doc.internal.pageSize.getWidth() / 2,
            doc.internal.pageSize.getHeight() - 10,
            { align: 'center' }
        );
    }
};

/**
 * Add a header to the current page
 */
export const addHeader = (doc: jsPDF, title: string): void => {
    doc.setFontSize(20);
    doc.setTextColor(40);
    doc.setFont('helvetica', 'bold');
    doc.text(title, 20, 25);

    // Add a line below the header
    doc.setDrawColor(200);
    doc.setLineWidth(0.5);
    doc.line(20, 30, doc.internal.pageSize.getWidth() - 20, 30);
};

/**
 * Wrap text to fit within a maximum width
 */
export const wrapText = (doc: jsPDF, text: string, maxWidth: number): string[] => {
    return doc.splitTextToSize(text, maxWidth);
};

/**
 * PDF page dimensions and margins
 */
export const PDF_CONSTANTS = {
    MARGIN: 20,
    HEADER_START_Y: 45,
    MIN_BOTTOM_MARGIN: 20,
} as const;

/**
 * Get content width based on page width and margins
 */
export const getContentWidth = (doc: jsPDF): number => {
    return doc.internal.pageSize.getWidth() - 2 * PDF_CONSTANTS.MARGIN;
};

/**
 * Check if we need a new page and add one if necessary
 */
export const checkAndAddPage = (
    doc: jsPDF,
    currentY: number,
    requiredSpace: number
): number => {
    const pageHeight = doc.internal.pageSize.getHeight();
    if (currentY + requiredSpace > pageHeight - PDF_CONSTANTS.MIN_BOTTOM_MARGIN) {
        doc.addPage();
        return 20; // Reset to top of new page
    }
    return currentY;
};
