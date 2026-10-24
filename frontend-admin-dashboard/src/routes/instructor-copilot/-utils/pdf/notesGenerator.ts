import jsPDF from 'jspdf';
import type { NoteData } from './types';
import i18n from '@/i18n';
import {
    stripHtmlTags,
    addHeader,
    addPageNumbers,
    wrapText,
    PDF_CONSTANTS,
    getContentWidth,
} from './helpers';

export const generateNotesPDF = (content: string): void => {
    let data: NoteData[] | null = null;

    try {
        data = JSON.parse(content);
        if (!Array.isArray(data)) {
            data = null;
        }
    } catch (e) {
        console.error('Failed to parse notes data:', e);
        return;
    }

    if (!data || data.length === 0) {
        console.error('No notes data available');
        return;
    }

    const doc = new jsPDF();
    addHeader(doc, i18n.t('instructorCopilotNotesGenerator:pdfHeaderTitle'));

    let yPosition: number = PDF_CONSTANTS.HEADER_START_Y;
    const pageHeight = doc.internal.pageSize.getHeight();
    const contentWidth = getContentWidth(doc);

    data.forEach((note, index) => {
        // Check if we need a new page
        if (yPosition > pageHeight - 40) {
            doc.addPage();
            yPosition = 20;
        }

        // Topic heading
        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(41, 128, 185); // Blue color
        const topicText = `${index + 1}. ${note.topic}`;
        doc.text(topicText, PDF_CONSTANTS.MARGIN, yPosition);
        yPosition += 8;

        // Content
        doc.setFontSize(11);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(60);
        const contentLines = wrapText(doc, stripHtmlTags(note.content), contentWidth);

        contentLines.forEach((line) => {
            if (yPosition > pageHeight - PDF_CONSTANTS.MIN_BOTTOM_MARGIN) {
                doc.addPage();
                yPosition = 20;
            }
            doc.text(line, PDF_CONSTANTS.MARGIN, yPosition);
            yPosition += 6;
        });

        yPosition += 10; // Space between notes
    });

    addPageNumbers(doc);
    doc.save(i18n.t('instructorCopilotNotesGenerator:pdfFilename'));
};
