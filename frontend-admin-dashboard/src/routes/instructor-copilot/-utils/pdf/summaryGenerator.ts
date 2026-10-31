import jsPDF from 'jspdf';
import type { TFunction } from 'i18next';
import type { SummaryData } from './types';
import {
    stripHtmlTags,
    addHeader,
    addPageNumbers,
    wrapText,
    PDF_CONSTANTS,
    getContentWidth,
} from './helpers';

export const generateSummaryPDF = (content: string, t: TFunction): void => {
    let data: SummaryData | null = null;

    try {
        data = JSON.parse(content);
    } catch (e) {
        console.error('Failed to parse summary data:', e);
        return;
    }

    if (!data) {
        console.error('No summary data available');
        return;
    }

    const doc = new jsPDF();
    addHeader(doc, t('instructorCopilotSummaryGenerator:title'));

    const pageHeight = doc.internal.pageSize.getHeight();
    const contentWidth = getContentWidth(doc);
    let yPosition: number = PDF_CONSTANTS.HEADER_START_Y;

    // Overview section
    if (data.overview) {
        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(41, 128, 185);
        doc.text(t('instructorCopilotSummaryGenerator:overview'), PDF_CONSTANTS.MARGIN, yPosition);
        yPosition += 8;

        doc.setFontSize(11);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(60);
        const overviewLines = wrapText(doc, stripHtmlTags(data.overview), contentWidth);

        overviewLines.forEach((line) => {
            if (yPosition > pageHeight - PDF_CONSTANTS.MIN_BOTTOM_MARGIN) {
                doc.addPage();
                yPosition = 20;
            }
            doc.text(line, PDF_CONSTANTS.MARGIN, yPosition);
            yPosition += 6;
        });

        yPosition += 15;
    }

    // Key Points section
    if (data.key_points && data.key_points.length > 0) {
        if (yPosition > pageHeight - 40) {
            doc.addPage();
            yPosition = 20;
        }

        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(41, 128, 185);
        doc.text(
            t('instructorCopilotSummaryGenerator:keyTakeaways'),
            PDF_CONSTANTS.MARGIN,
            yPosition
        );
        yPosition += 10;

        data.key_points.forEach((point, index) => {
            if (yPosition > pageHeight - 30) {
                doc.addPage();
                yPosition = 20;
            }

            doc.setFontSize(11);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(52, 152, 219);
            doc.text(`${index + 1}.`, PDF_CONSTANTS.MARGIN, yPosition);

            doc.setFont('helvetica', 'normal');
            doc.setTextColor(60);
            const pointLines = wrapText(doc, stripHtmlTags(point), contentWidth - 10);

            pointLines.forEach((line, lineIndex) => {
                if (yPosition > pageHeight - PDF_CONSTANTS.MIN_BOTTOM_MARGIN) {
                    doc.addPage();
                    yPosition = 20;
                }
                doc.text(line, PDF_CONSTANTS.MARGIN + 10, yPosition);
                if (lineIndex < pointLines.length - 1) {
                    yPosition += 6;
                }
            });

            yPosition += 10;
        });
    }

    addPageNumbers(doc);
    doc.save('summary.pdf');
};
