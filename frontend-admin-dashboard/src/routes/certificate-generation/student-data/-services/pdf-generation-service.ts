import { jsPDF } from 'jspdf';
import i18n from '@/i18n';
import {
    ImageTemplate,
    FieldMapping,
    CertificateStudentData,
    CertificateGenerationResult,
    GeneratedCertificate,
    CertificateGenerationError,
    CanvasRenderingContext,
} from '@/types/certificate/certificate-types';

const NS = 'certificateGenerationPdfGenerationService';

export class ImageCertificateGenerationService {
    // Create canvas rendering context
    private createCanvas(width: number, height: number): CanvasRenderingContext {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        if (!ctx) {
            throw new Error(i18n.t(`${NS}:errors.canvasContextFailed`));
        }

        canvas.width = width;
        canvas.height = height;

        return { canvas, ctx, width, height };
    }

    // Load image from data URL
    private loadImage(dataUrl: string): Promise<HTMLImageElement> {
        return new Promise((resolve, reject) => {
            const img = document.createElement('img');
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error(i18n.t(`${NS}:errors.imageLoadFailed`)));
            img.src = dataUrl;
        });
    }

    // Apply text styling to canvas context
    private applyTextStyle(
        ctx: CanvasRenderingContext2D,
        fieldStyle: FieldMapping['style'],
        scale: number = 1
    ) {
        const fontSize = fieldStyle.fontSize * scale;
        const fontWeight = fieldStyle.fontWeight || 'normal';
        const fontFamily = fieldStyle.fontFamily || 'Arial, sans-serif';

        ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
        ctx.fillStyle = fieldStyle.fontColor || '#000000';
        ctx.textAlign =
            fieldStyle.alignment === 'center'
                ? 'center'
                : fieldStyle.alignment === 'right'
                  ? 'right'
                  : 'left';
        ctx.textBaseline = 'top';

        // Add background if specified
        if (fieldStyle.backgroundColor && fieldStyle.backgroundColor !== 'transparent') {
            ctx.globalCompositeOperation = 'source-over';
        }
    }

    // Draw text field on canvas
    private drawTextField(
        ctx: CanvasRenderingContext2D,
        text: string,
        mapping: FieldMapping,
        scale: number = 1
    ) {
        const x = mapping.position.x * scale;
        const y = mapping.position.y * scale;
        const width = mapping.position.width * scale;
        const height = mapping.position.height * scale;
        const padding = (mapping.style.padding || 0) * scale;

        // Draw background if specified
        if (mapping.style.backgroundColor && mapping.style.backgroundColor !== 'transparent') {
            ctx.fillStyle = mapping.style.backgroundColor;
            ctx.fillRect(x - padding, y - padding, width + padding * 2, height + padding * 2);
        }

        // Draw border if specified
        if (mapping.style.borderColor) {
            ctx.strokeStyle = mapping.style.borderColor;
            ctx.lineWidth = 1;
            ctx.strokeRect(x - padding, y - padding, width + padding * 2, height + padding * 2);
        }

        // Apply text styling
        this.applyTextStyle(ctx, mapping.style, scale);

        // Calculate text position based on alignment
        let textX = x;
        if (mapping.style.alignment === 'center') {
            textX = x + width / 2;
        } else if (mapping.style.alignment === 'right') {
            textX = x + width;
        }

        // Handle text wrapping if needed
        const maxWidth = width - padding * 2;
        const lines = this.wrapText(ctx, text, maxWidth);
        const lineHeight = mapping.style.fontSize * scale * 1.2;

        // Draw each line
        lines.forEach((line, index) => {
            const textY = y + index * lineHeight + padding;
            ctx.fillText(line, textX, textY);
        });
    }

    // Wrap text to fit within specified width
    private wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
        const words = text.split(' ');
        const lines: string[] = [];
        let currentLine = '';

        for (const word of words) {
            const testLine = currentLine ? `${currentLine} ${word}` : word;
            const metrics = ctx.measureText(testLine);

            if (metrics.width > maxWidth && currentLine) {
                lines.push(currentLine);
                currentLine = word;
            } else {
                currentLine = testLine;
            }
        }

        if (currentLine) {
            lines.push(currentLine);
        }

        return lines.length > 0 ? lines : [text];
    }

    // Generate input data for a student
    private generateInputData(
        student: CertificateStudentData,
        fieldMappings: FieldMapping[],
        csvRow?: Record<string, string | number>
    ): Record<string, string> {
        const inputs: Record<string, string> = {};

        fieldMappings.forEach((mapping) => {
            let value = '';

            // Try to get value from various sources
            switch (mapping.fieldName) {
                case 'user_id':
                    value = student.user_id || '';
                    break;
                case 'enrollment_number':
                    value = student.institute_enrollment_id || '';
                    break;
                case 'student_name':
                case 'full_name':
                    value = student.full_name || '';
                    break;
                case 'email':
                    value = student.email || '';
                    break;
                case 'mobile_number':
                    value = student.mobile_number || '';
                    break;
                case 'institute_name':
                    value =
                        student.linked_institute_name || i18n.t(`${NS}:defaults.instituteName`);
                    break;
                case 'completion_date':
                    value = new Date().toLocaleDateString();
                    break;
                default:
                    // Try CSV data first, then student dynamic fields
                    if (csvRow && csvRow[mapping.fieldName] !== undefined) {
                        value = csvRow[mapping.fieldName]!.toString();
                    } else if (
                        student.dynamicFields &&
                        student.dynamicFields[mapping.fieldName] !== undefined
                    ) {
                        value = student.dynamicFields[mapping.fieldName]!.toString();
                    } else {
                        // Fallback to a default value
                        value = i18n.t(`${NS}:defaults.sampleValue`, {
                            field: mapping.displayName,
                        });
                    }
            }

            inputs[mapping.id] = value;
        });

        return inputs;
    }

    // Generate a single certificate
    async generateSingleCertificate(
        imageTemplate: ImageTemplate,
        fieldMappings: FieldMapping[],
        student: CertificateStudentData,
        csvRow?: Record<string, string | number>
    ): Promise<{ pdfBlob: Blob; imageBlob: Blob }> {
        try {
            // Load the template image
            const templateImage = await this.loadImage(imageTemplate.imageDataUrl);

            // Create canvas with template dimensions
            const { canvas, ctx } = this.createCanvas(imageTemplate.width, imageTemplate.height);

            // Draw the template image
            ctx.drawImage(templateImage, 0, 0, imageTemplate.width, imageTemplate.height);

            // Generate input data for the student
            const inputs = this.generateInputData(student, fieldMappings, csvRow);

            // Draw each field on the canvas
            fieldMappings.forEach((mapping) => {
                const value = inputs[mapping.id] || '';
                this.drawTextField(ctx, value, mapping, 1);
            });

            // Convert canvas to image blob
            const imageBlob = await new Promise<Blob>((resolve, reject) => {
                canvas.toBlob(
                    (blob) => {
                        if (blob) {
                            resolve(blob);
                        } else {
                            reject(new Error('Failed to convert canvas to blob'));
                        }
                    },
                    'image/png',
                    1.0
                );
            });

            // Convert canvas to PDF
            const pdf = new jsPDF({
                orientation: imageTemplate.width > imageTemplate.height ? 'landscape' : 'portrait',
                unit: 'px',
                format: [imageTemplate.width, imageTemplate.height],
            });

            // Add image to PDF
            const imageDataUrl = canvas.toDataURL('image/png', 1.0);
            pdf.addImage(imageDataUrl, 'PNG', 0, 0, imageTemplate.width, imageTemplate.height);

            // Convert PDF to blob
            const pdfBlob = pdf.output('blob');

            return { pdfBlob, imageBlob };
        } catch (error) {
            console.error('Error generating single certificate:', error);
            throw new Error(
                i18n.t(`${NS}:errors.certificateGenerationFailed`, {
                    name: student.full_name,
                    message:
                        error instanceof Error
                            ? error.message
                            : i18n.t(`${NS}:errors.unknownError`),
                })
            );
        }
    }

    // Generate certificates for multiple students
    async generateBulkCertificates(
        imageTemplate: ImageTemplate,
        fieldMappings: FieldMapping[],
        students: CertificateStudentData[],
        csvData?: Record<string, string | number>[],
        onProgress?: (completed: number, total: number) => void
    ): Promise<CertificateGenerationResult> {
        const certificates: GeneratedCertificate[] = [];
        const errors: CertificateGenerationError[] = [];
        let completedCount = 0;

        console.log(`Starting bulk certificate generation for ${students.length} students`);

        // Process students in batches to avoid memory issues
        const batchSize = 3; // Smaller batch size for image processing
        for (let i = 0; i < students.length; i += batchSize) {
            const batch = students.slice(i, i + batchSize);

            // Process batch in parallel
            const batchPromises = batch.map(async (student) => {
                try {
                    // Find corresponding CSV row
                    const csvRow = csvData?.find(
                        (row) =>
                            row.user_id === student.user_id ||
                            row.enrollment_number === student.institute_enrollment_id
                    );

                    // Generate certificate
                    const { pdfBlob, imageBlob } = await this.generateSingleCertificate(
                        imageTemplate,
                        fieldMappings,
                        student,
                        csvRow
                    );

                    const fileName = `certificate_${student.user_id || student.institute_enrollment_id || 'unknown'}_${student.full_name?.replace(/[^a-zA-Z0-9]/g, '_') || 'unnamed'}.pdf`;

                    certificates.push({
                        studentId: student.user_id || '',
                        studentName: student.full_name || 'Unknown',
                        pdfBlob,
                        imageBlob,
                        fileName,
                    });

                    completedCount++;
                    onProgress?.(completedCount, students.length);

                    console.log(
                        `Generated certificate ${completedCount}/${students.length}: ${student.full_name}`
                    );
                } catch (error) {
                    console.error(
                        `Failed to generate certificate for ${student.full_name}:`,
                        error
                    );

                    errors.push({
                        studentId: student.user_id || '',
                        studentName: student.full_name || 'Unknown',
                        error: error instanceof Error ? error.message : 'Unknown error',
                    });

                    completedCount++;
                    onProgress?.(completedCount, students.length);
                }
            });

            // Wait for batch to complete
            await Promise.all(batchPromises);

            // Small delay between batches to prevent overwhelming the browser
            if (i + batchSize < students.length) {
                await new Promise((resolve) => setTimeout(resolve, 200));
            }
        }

        console.log(
            `Bulk generation completed: ${certificates.length} successful, ${errors.length} errors`
        );

        return {
            success: errors.length === 0,
            certificates,
            errors,
            totalCount: students.length,
            successCount: certificates.length,
            errorCount: errors.length,
        };
    }

    // Generate preview certificate (for preview purposes)
    async generatePreviewCertificate(
        imageTemplate: ImageTemplate,
        fieldMappings: FieldMapping[],
        sampleData: Record<string, string> = {}
    ): Promise<string> {
        try {
            // Load the template image
            const templateImage = await this.loadImage(imageTemplate.imageDataUrl);

            // Create canvas with template dimensions
            const { canvas, ctx } = this.createCanvas(imageTemplate.width, imageTemplate.height);

            // Draw the template image
            ctx.drawImage(templateImage, 0, 0, imageTemplate.width, imageTemplate.height);

            // Draw each field with sample data
            fieldMappings.forEach((mapping) => {
                const value =
                    sampleData[mapping.id] ||
                    mapping.displayName ||
                    i18n.t(`${NS}:defaults.sampleText`);
                this.drawTextField(ctx, value, mapping, 1);
            });

            // Return as data URL for preview
            return canvas.toDataURL('image/png', 1.0);
        } catch (error) {
            console.error('Error generating preview certificate:', error);
            throw new Error(
                i18n.t(`${NS}:errors.previewGenerationFailed`, {
                    message:
                        error instanceof Error
                            ? error.message
                            : i18n.t(`${NS}:errors.unknownError`),
                })
            );
        }
    }
}

// Create singleton instance
export const certificateGenerationService = new ImageCertificateGenerationService();

// Legacy export for backward compatibility
export const pdfGenerationService = certificateGenerationService;
