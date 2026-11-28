import jsPDF from 'jspdf';
import type { TFunction } from 'i18next';
import {
    stripHtmlTags,
    addHeader,
    addPageNumbers,
    wrapText,
    PDF_CONSTANTS,
    getContentWidth,
} from './helpers';

export const generateClassworkPDF = (content: string, t: TFunction): void => {
    let data: string[] | null = null;

    try {
        data = JSON.parse(content);
        if (!Array.isArray(data)) {
            data = null;
        }
    } catch (e) {
        console.error('Failed to parse classwork data:', e);
        return;
    }

    if (!data || data.length === 0) {
        console.error('No classwork data available');
        return;
    }

    // Check if it's the fallback message
    if (data.length === 1 && data[0] === "No classwork given") {
        console.warn('No classwork to generate PDF for');
        return;
    }

    const doc = new jsPDF();
    addHeader(doc, t('instructorCopilotClassworkHomeworkGenerator:classwork.title'));

    let yPosition: number = PDF_CONSTANTS.HEADER_START_Y;
    const pageHeight = doc.internal.pageSize.getHeight();
    const contentWidth = getContentWidth(doc);

    // Add subtitle
    doc.setFontSize(12);
    doc.setTextColor(100);
    doc.setFont('helvetica', 'italic');
    doc.text(
        t('instructorCopilotClassworkHomeworkGenerator:classwork.subtitle'),
        PDF_CONSTANTS.MARGIN,
        yPosition
    );
    yPosition += 15;

    data.forEach((task, index) => {
        // Check if we need a new page
        if (yPosition > pageHeight - 60) {
            doc.addPage();
            yPosition = 20;
        }

        // Task number
        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(59, 130, 246); // Blue color
        const taskNumber = t('instructorCopilotClassworkHomeworkGenerator:classwork.taskNumber', {
            number: index + 1,
        });
        doc.text(taskNumber, PDF_CONSTANTS.MARGIN, yPosition);
        yPosition += 8;

        // Task content
        doc.setFontSize(11);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(60);
        const taskLines = wrapText(doc, stripHtmlTags(task), contentWidth);

        taskLines.forEach((line) => {
            if (yPosition > pageHeight - PDF_CONSTANTS.MIN_BOTTOM_MARGIN) {
                doc.addPage();
                yPosition = 20;
            }
            doc.text(line, PDF_CONSTANTS.MARGIN, yPosition);
            yPosition += 6;
        });

        // Add spacing and a checkbox
        yPosition += 5;

        // Draw checkbox
        doc.setDrawColor(200);
        doc.setLineWidth(0.5);
        doc.rect(PDF_CONSTANTS.MARGIN, yPosition, 6, 6);
        doc.setFontSize(9);
        doc.setTextColor(150);
        doc.text(
            t('instructorCopilotClassworkHomeworkGenerator:classwork.completed'),
            PDF_CONSTANTS.MARGIN + 10,
            yPosition + 5
        );

        yPosition += 15; // Space between tasks
    });

    addPageNumbers(doc);
    doc.save('classwork.pdf');
};

export const generateHomeworkPDF = (content: string, t: TFunction): void => {
    let data: string[] | null = null;

    try {
        data = JSON.parse(content);
        if (!Array.isArray(data)) {
            data = null;
        }
    } catch (e) {
        console.error('Failed to parse homework data:', e);
        return;
    }

    if (!data || data.length === 0) {
        console.error('No homework data available');
        return;
    }

    // Check if it's the fallback message
    if (data.length === 1 && data[0] === "No homework given") {
        console.warn('No homework to generate PDF for');
        return;
    }

    const doc = new jsPDF();
    addHeader(doc, t('instructorCopilotClassworkHomeworkGenerator:homework.title'));

    let yPosition: number = PDF_CONSTANTS.HEADER_START_Y;
    const pageHeight = doc.internal.pageSize.getHeight();
    const contentWidth = getContentWidth(doc);

    // Add subtitle
    doc.setFontSize(12);
    doc.setTextColor(100);
    doc.setFont('helvetica', 'italic');
    doc.text(
        t('instructorCopilotClassworkHomeworkGenerator:homework.subtitle'),
        PDF_CONSTANTS.MARGIN,
        yPosition
    );
    yPosition += 10;

    // Add due date section
    doc.setFontSize(10);
    doc.setTextColor(150);
    doc.text(
        t('instructorCopilotClassworkHomeworkGenerator:homework.dueDate'),
        PDF_CONSTANTS.MARGIN,
        yPosition
    );
    yPosition += 15;

    data.forEach((assignment, index) => {
        // Check if we need a new page
        if (yPosition > pageHeight - 60) {
            doc.addPage();
            yPosition = 20;
        }

        // Assignment number
        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(245, 158, 11); // Orange color
        const assignmentNumber = t(
            'instructorCopilotClassworkHomeworkGenerator:homework.assignmentNumber',
            { number: index + 1 }
        );
        doc.text(assignmentNumber, PDF_CONSTANTS.MARGIN, yPosition);
        yPosition += 8;

        // Assignment content
        doc.setFontSize(11);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(60);
        const assignmentLines = wrapText(doc, stripHtmlTags(assignment), contentWidth);

        assignmentLines.forEach((line) => {
            if (yPosition > pageHeight - PDF_CONSTANTS.MIN_BOTTOM_MARGIN) {
                doc.addPage();
                yPosition = 20;
            }
            doc.text(line, PDF_CONSTANTS.MARGIN, yPosition);
            yPosition += 6;
        });

        // Add spacing and a checkbox
        yPosition += 5;

        // Draw checkbox
        doc.setDrawColor(200);
        doc.setLineWidth(0.5);
        doc.rect(PDF_CONSTANTS.MARGIN, yPosition, 6, 6);
        doc.setFontSize(9);
        doc.setTextColor(150);
        doc.text(
            t('instructorCopilotClassworkHomeworkGenerator:homework.completed'),
            PDF_CONSTANTS.MARGIN + 10,
            yPosition + 5
        );

        yPosition += 15; // Space between assignments
    });

    addPageNumbers(doc);
    doc.save('homework.pdf');
};
