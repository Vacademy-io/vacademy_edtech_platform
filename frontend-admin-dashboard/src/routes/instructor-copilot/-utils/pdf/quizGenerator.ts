import jsPDF from 'jspdf';
import type { TFunction } from 'i18next';
import type { QuizData, QuizPDFOptions } from './types';
import {
    stripHtmlTags,
    addHeader,
    addPageNumbers,
    wrapText,
    getCorrectOptionIds,
    PDF_CONSTANTS,
    getContentWidth,
} from './helpers';

export const generateQuizPDF = (content: string, options: QuizPDFOptions, t: TFunction): void => {
    let data: QuizData | null = null;

    try {
        data = JSON.parse(content);
    } catch (e) {
        console.error('Failed to parse quiz data:', e);
        return;
    }

    if (!data || !data.questions || data.questions.length === 0) {
        console.error('No quiz data available');
        return;
    }

    const doc = new jsPDF();
    const { showAnswers, showExplanations } = options;

    // Determine title based on mode
    let title = data.title || t('defaultTitle');
    if (!showAnswers) {
        title = t('assessmentPaperSuffix', { title });
    }

    addHeader(doc, title);

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const contentWidth = getContentWidth(doc);
    let yPosition: number = PDF_CONSTANTS.HEADER_START_Y;

    // Add quiz metadata
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.setFont('helvetica', 'normal');
    const metaInfo =
        t('totalQuestions', { count: data.questions.length }) +
        (data.difficulty ? t('difficultySuffix', { difficulty: data.difficulty }) : '');
    doc.text(metaInfo, PDF_CONSTANTS.MARGIN, yPosition);
    yPosition += 10;

    if (!showAnswers) {
        doc.setFontSize(9);
        doc.setTextColor(150);
        doc.text(t('assessmentInstructions'), PDF_CONSTANTS.MARGIN, yPosition);
        yPosition += 8;
    }

    yPosition += 5;

    // Add questions
    data.questions.forEach((question, qIndex) => {
        // Check if we need a new page for this question
        const estimatedHeight = 40 + (question.options?.length || 0) * 8;
        if (yPosition + estimatedHeight > pageHeight - 30) {
            doc.addPage();
            yPosition = 20;
        }

        // Question number and text
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(40);
        const questionHeader = t('questionNumber', { number: qIndex + 1 });
        doc.text(questionHeader, PDF_CONSTANTS.MARGIN, yPosition);
        yPosition += 7;

        // Question metadata (if showing answers)
        if (showAnswers && (question.level || question.question_type)) {
            doc.setFontSize(9);
            doc.setTextColor(100);
            doc.setFont('helvetica', 'italic');
            const meta = `[${question.level || ''}${question.level && question.question_type ? ' | ' : ''}${question.question_type || ''}]`;
            doc.text(meta, PDF_CONSTANTS.MARGIN, yPosition);
            yPosition += 6;
        }

        // Question text
        doc.setFontSize(11);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(60);
        const questionLines = wrapText(doc, stripHtmlTags(question.text.content), contentWidth);
        questionLines.forEach((line) => {
            if (yPosition > pageHeight - PDF_CONSTANTS.MIN_BOTTOM_MARGIN) {
                doc.addPage();
                yPosition = 20;
            }
            doc.text(line, PDF_CONSTANTS.MARGIN, yPosition);
            yPosition += 6;
        });
        yPosition += 5;

        // Options
        if (question.options && question.options.length > 0) {
            const correctIds = showAnswers ? getCorrectOptionIds(question.auto_evaluation_json) : [];

            question.options.forEach((option) => {
                const isCorrect = correctIds.includes(option.preview_id);

                if (yPosition > pageHeight - PDF_CONSTANTS.MIN_BOTTOM_MARGIN) {
                    doc.addPage();
                    yPosition = 20;
                }

                doc.setFontSize(10);

                // For assessment mode (no answers), use simple formatting
                if (!showAnswers) {
                    doc.setFont('helvetica', 'normal');
                    doc.setTextColor(60);
                    const optionLabel = `${option.preview_id}. `;
                    const optionText = stripHtmlTags(option.text.content);
                    const optionLines = wrapText(doc, optionLabel + optionText, contentWidth - 5);

                    optionLines.forEach((line, lineIndex) => {
                        if (yPosition > pageHeight - PDF_CONSTANTS.MIN_BOTTOM_MARGIN) {
                            doc.addPage();
                            yPosition = 20;
                        }
                        doc.text(line, PDF_CONSTANTS.MARGIN + 5, yPosition);
                        if (lineIndex < optionLines.length - 1) {
                            yPosition += 5;
                        }
                    });
                } else {
                    // For answer key mode, highlight correct answers
                    if (isCorrect) {
                        doc.setFont('helvetica', 'bold');
                        doc.setTextColor(46, 125, 50); // Green
                    } else {
                        doc.setFont('helvetica', 'normal');
                        doc.setTextColor(60);
                    }

                    const optionLabel = `${option.preview_id}. `;
                    const optionText = stripHtmlTags(option.text.content);
                    const fullText = isCorrect ? `✓ ${optionLabel}${optionText}` : optionLabel + optionText;
                    const optionLines = wrapText(doc, fullText, contentWidth - 5);

                    optionLines.forEach((line, lineIndex) => {
                        if (yPosition > pageHeight - PDF_CONSTANTS.MIN_BOTTOM_MARGIN) {
                            doc.addPage();
                            yPosition = 20;
                        }
                        doc.text(line, PDF_CONSTANTS.MARGIN + 5, yPosition);
                        if (lineIndex < optionLines.length - 1) {
                            yPosition += 5;
                        }
                    });
                }

                yPosition += 6;
            });
        }

        // If in assessment mode, add blank space for answer
        if (!showAnswers) {
            yPosition += 5;
            doc.setDrawColor(200);
            doc.setLineWidth(0.3);
            doc.line(PDF_CONSTANTS.MARGIN, yPosition, pageWidth - PDF_CONSTANTS.MARGIN, yPosition);
            doc.setFontSize(9);
            doc.setTextColor(150);
            doc.text(t('answerLabel'), PDF_CONSTANTS.MARGIN, yPosition + 5);
            yPosition += 15;
        }

        // Explanation (only if showExplanations is true and showAnswers is true)
        if (showAnswers && showExplanations && question.explanation_text) {
            yPosition += 3;

            if (yPosition > pageHeight - 30) {
                doc.addPage();
                yPosition = 20;
            }

            doc.setFontSize(10);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(33, 150, 243); // Blue
            doc.text(t('explanationLabel'), PDF_CONSTANTS.MARGIN + 5, yPosition);
            yPosition += 6;

            doc.setFont('helvetica', 'italic');
            doc.setFontSize(9);
            doc.setTextColor(70);
            const explanationLines = wrapText(
                doc,
                stripHtmlTags(question.explanation_text.content),
                contentWidth - 10
            );

            explanationLines.forEach((line) => {
                if (yPosition > pageHeight - PDF_CONSTANTS.MIN_BOTTOM_MARGIN) {
                    doc.addPage();
                    yPosition = 20;
                }
                doc.text(line, PDF_CONSTANTS.MARGIN + 10, yPosition);
                yPosition += 5;
            });
        }

        yPosition += 12; // Space between questions
    });

    addPageNumbers(doc);

    // Generate filename based on mode
    const filename = showAnswers
        ? 'quiz_answer_key.pdf'
        : 'quiz_assessment.pdf';

    doc.save(filename);
};
