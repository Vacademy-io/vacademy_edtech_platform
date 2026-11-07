/**
 * Bulk Email Service
 *
 * This service handles bulk email sending with enriched student data
 * and template variable mapping for all pages
 */

import axios from 'axios';
import {
    studentDataEnrichmentService,
    type EnrichedStudentData,
    type DataEnrichmentOptions,
} from './studentDataEnrichmentService';
import { mapTemplateVariables } from '@/utils/template-variable-mapper';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { getTokenFromCookie } from '@/lib/auth/sessionUtility';
import { TokenKey } from '@/constants/auth/tokens';
import {
    sendNotification,
    waitForBatchCompletion,
    type UnifiedSendResponse,
} from './unified-send-service';
import { validateTemplateVariables, type ValidationResult } from '@/utils/template-validation';
import { VariableContext } from './template-variables/types';
import type { PageContext } from './page-context-resolver';
import { detectCurrentPageContext } from '@/utils/page-context-detector';

export interface BulkEmailPayload {
    body: string;
    notification_type: 'EMAIL' | 'WHATSAPP';
    source: string;
    source_id: string;
    subject: string;
    users: Array<{
        user_id: string;
        channel_id: string;
        placeholders: Record<string, string>;
    }>;
    institute_id?: string; // Optional institute ID
}

export interface BulkEmailOptions {
    template: string;
    subject: string;
    students: any[];
    context: 'student-management' | 'announcements' | 'attendance-report' | 'referral-settings';
    pageContext?: PageContext;
    notificationType: 'EMAIL' | 'WHATSAPP';
    source: string;
    sourceId: string;
    enrichmentOptions?: DataEnrichmentOptions;
}

export interface BulkEmailResult {
    success: boolean;
    totalStudents: number;
    processedStudents: number;
    failedStudents: number;
    errors: Array<{
        studentId: string;
        studentName: string;
        error: string;
    }>;
    payload?: BulkEmailPayload;
    /** Still sending in the background. Counts are not final yet. */
    inProgress?: boolean;
    batchId?: string;
}

export class BulkEmailService {
    private baseURL: string;
    private authToken: string;

    constructor(baseURL: string = '/api') {
        this.baseURL = baseURL;
        this.authToken = this.getAuthToken();
    }

    /**
     * Refresh the authentication token
     */
    private refreshToken(): void {
        this.authToken = getTokenFromCookie(TokenKey.accessToken) || '';
    }

    private getAuthToken(): string {
        return getTokenFromCookie(TokenKey.accessToken) || '';
    }

    private getInstituteId(): string {
        // Use the existing utility function
        try {
            return getCurrentInstituteId() || '';
        } catch {
            return '';
        }
    }

    /**
     * Detect page context from current URL
     */
    private detectPageContext(): PageContext {
        return detectCurrentPageContext();
    }

    /**
     * Get session ID from attendance context
     * This should be implemented based on how the attendance page stores session information
     */
    private getSessionIdFromAttendanceContext(): string | null {
        // Try to get from URL parameters
        const urlParams = new URLSearchParams(window.location.search);
        const sessionId = urlParams.get('sessionId');
        if (sessionId) return sessionId;

        // Try to get from localStorage
        const storedSessionId = localStorage.getItem('currentSessionId');
        if (storedSessionId) return storedSessionId;

        // Try to get from sessionStorage
        const sessionStorageId = sessionStorage.getItem('currentSessionId');
        if (sessionStorageId) return sessionStorageId;

        // Try to get from global window object
        const globalSessionId = (window as any).currentSessionId;
        if (globalSessionId) return globalSessionId;

        // Try to extract from URL path
        const pathMatch = window.location.pathname.match(/\/live-session\/([a-f0-9-]+)/);
        if (pathMatch) return pathMatch[1] ?? null;

        return null;
    }

    /**
     * Get schedule ID from attendance context
     */
    private getScheduleIdFromAttendanceContext(): string | null {
        // Try to get from URL parameters
        const urlParams = new URLSearchParams(window.location.search);
        const scheduleId = urlParams.get('scheduleId');
        if (scheduleId) return scheduleId;

        // Try to get from localStorage
        const storedScheduleId = localStorage.getItem('currentScheduleId');
        if (storedScheduleId) return storedScheduleId;

        // Try to get from sessionStorage
        const sessionStorageId = sessionStorage.getItem('currentScheduleId');
        if (sessionStorageId) return sessionStorageId;

        return null;
    }

    /**
     * Create placeholders object for a student
     */
    private createStudentPlaceholders(student: any): Record<string, string> {
        const placeholders: Record<string, string> = {};

        // Add all student properties as placeholders
        Object.keys(student).forEach((key) => {
            const value = student[key];
            if (value !== undefined && value !== null) {
                const apiKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
                placeholders[apiKey] = String(value);
            }
        });

        // Add specific mappings for common variables
        this.addCommonPlaceholders(placeholders, student);
        this.addInstitutePlaceholders(placeholders, student);
        this.addCoursePlaceholders(placeholders, student);
        this.addAttendancePlaceholders(placeholders, student);
        this.addLiveClassPlaceholders(placeholders, student);
        this.addReferralPlaceholders(placeholders, student);
        this.addTimePlaceholders(placeholders);
        this.addSupportPlaceholders(placeholders, student);

        return placeholders;
    }

    /**
     * Add common placeholders
     */
    private addCommonPlaceholders(placeholders: Record<string, string>, student: any): void {
        const fullName = student.full_name || '';
        placeholders.name = fullName;
        placeholders.student_name = fullName;
        const [firstName, ...rest] = fullName.split(' ');
        placeholders.first_name = firstName || '';
        placeholders.last_name = rest.join(' ');
        placeholders.email = student.email || '';
        placeholders.student_email = student.email || '';
        placeholders.mobile_number = student.mobile_number || '';
        placeholders.student_phone = student.mobile_number || '';
        placeholders.student_id = student.user_id || '';
        placeholders.enrollment_number = student.enrollment_number || student.user_id || '';
        placeholders.username = student.username || student.email || '';
        placeholders.registration_date = student.created_at
            ? new Date(student.created_at).toLocaleDateString()
            : '';
        placeholders.student_unique_link = student.student_unique_link || '';
    }

    /**
     * Add institute placeholders
     */
    private addInstitutePlaceholders(placeholders: Record<string, string>, student: any): void {
        placeholders.institute_name = student.institute_name || '';
        placeholders.institute_address = student.institute_address || '';
        placeholders.institute_phone = student.institute_phone || '';
        placeholders.institute_email = student.institute_email || '';
        placeholders.institute_website = student.institute_website || '';
        placeholders.institute_logo = student.institute_logo || '';
    }

    /**
     * Add course placeholders
     */
    private addCoursePlaceholders(placeholders: Record<string, string>, student: any): void {
        placeholders.course_name = student.course_name || '';
        placeholders.course_description = student.course_description || '';
        placeholders.course_price = student.course_price || '';
        placeholders.batch_name = student.batch_name || '';
        placeholders.batch_id = student.batch_id || '';
        placeholders.batch_start_date = student.batch_start_date
            ? new Date(student.batch_start_date).toLocaleDateString()
            : '';
        placeholders.batch_end_date = student.batch_end_date
            ? new Date(student.batch_end_date).toLocaleDateString()
            : '';
    }

    /**
     * Add attendance placeholders
     */
    private addAttendancePlaceholders(placeholders: Record<string, string>, student: any): void {
        // Use the dynamically calculated attendance data from enrichment service
        placeholders.attendance_status = student.attendance_status || '';
        placeholders.attendance_date = student.attendance_date || new Date().toLocaleDateString();
        placeholders.attendance_percentage = student.attendance_percentage || '0';
        placeholders.attendance_total_classes = student.attendance_total_classes || '0';
        placeholders.attendance_attended_classes = student.attendance_attended_classes || '0';
        placeholders.attendance_last_class_date = student.attendance_last_class_date || '';
    }

    /**
     * Add live class placeholders
     */
    private addLiveClassPlaceholders(placeholders: Record<string, string>, student: any): void {
        placeholders.live_class_title = student.live_class_title || '';
        placeholders.live_class_name = student.live_class_title || '';
        placeholders.live_class_date = student.live_class_date
            ? new Date(student.live_class_date).toLocaleDateString()
            : '';
        placeholders.live_class_time = student.live_class_time || '';
        placeholders.live_class_start_time = student.live_class_time || '';
        placeholders.live_class_end_time = student.live_class_time || '';
        placeholders.live_class_duration = student.live_class_duration || '';
        placeholders.live_class_link = student.live_class_meeting_link || '';
        placeholders.live_class_meeting_link = student.live_class_meeting_link || '';
        placeholders.live_class_description = student.live_class_notes || '';
        placeholders.live_class_batch = student.batch_name || '';
        placeholders.live_class_platform = student.live_class_platform || '';
        placeholders.live_class_status = student.live_class_status || '';
        placeholders.next_live_class_date = student.next_live_class_date
            ? new Date(student.next_live_class_date).toLocaleDateString()
            : '';
        placeholders.next_live_class_time = student.next_live_class_time || '';
    }

    /**
     * Add referral placeholders
     */
    private addReferralPlaceholders(placeholders: Record<string, string>, student: any): void {
        placeholders.student_referral_code = student.referral_code || '';
        placeholders.referral_count = student.referral_count || '0';
        placeholders.referral_rewards = student.referral_rewards || '0';
        placeholders.referral_bonus = student.referral_bonus || '0';
        placeholders.referral_status = student.referral_status || '';
        placeholders.referral_date = student.referral_program_start
            ? new Date(student.referral_program_start).toLocaleDateString()
            : '';
        placeholders.referral_benefits = student.referral_benefits || '';
        placeholders.referral_custom_content = student.referral_custom_content || '';
    }

    /**
     * Add time placeholders
     */
    private addTimePlaceholders(placeholders: Record<string, string>): void {
        const now = new Date();
        placeholders.current_date = now.toLocaleDateString();
        placeholders.current_time = now.toLocaleTimeString();
        placeholders.year = now.getFullYear().toString();
        placeholders.month = (now.getMonth() + 1).toString();
        placeholders.day = now.getDate().toString();
    }

    /**
     * Add support placeholders
     */
    private addSupportPlaceholders(placeholders: Record<string, string>, student: any): void {
        placeholders.custom_message_text = student.custom_message_text || '';
        placeholders.custom_field_1 = student.custom_field_1 || '';
        placeholders.custom_field_2 = student.custom_field_2 || '';
        // Use institute email and website for support
        placeholders.support_email = student.institute_email || '';
        placeholders.support_link = student.institute_website || '';
    }

    private async makeRequest(endpoint: string, options: RequestInit = {}): Promise<any> {
        const url = `${this.baseURL}${endpoint}`;
        const config: RequestInit = {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${this.authToken}`,
                ...options.headers,
            },
        };

        try {
            const response = await fetch(url, config);
            if (!response.ok) {
                throw new Error(`API request failed: ${response.status} ${response.statusText}`);
            }
            return await response.json();
        } catch (error) {
            throw error;
        }
    }

    /**
     * Validate template variables before sending
     */
    async validateTemplate(options: BulkEmailOptions): Promise<ValidationResult> {
        const { template, subject, students, pageContext } = options;

        // Get context from first student if available
        const context: VariableContext = {
            studentId: students.length > 0 ? students[0].user_id || students[0].id : undefined,
            courseId: students.length > 0 ? students[0].course_id : undefined,
            batchId: students.length > 0 ? students[0].batch_id : undefined,
            instituteId: this.getInstituteId(),
            pageContext: pageContext,
            studentData: students.length > 0 ? students[0] : null, // Always pass student data
            // Add session information for attendance context
            ...(pageContext === 'attendance-report' && {
                sessionId: this.getSessionIdFromAttendanceContext(),
                scheduleId: this.getScheduleIdFromAttendanceContext(),
            }),
        };

        // Validate the template content
        const templateContent = `${template} ${subject}`;
        return await validateTemplateVariables(templateContent, context);
    }

    /**
     * Send bulk email with enriched data and template variable mapping
     */
    async sendBulkEmail(options: BulkEmailOptions): Promise<BulkEmailResult> {
        const {
            template,
            subject,
            students,
            context,
            notificationType,
            source,
            sourceId,
            enrichmentOptions = {},
        } = options;

        // Auto-detect page context if not provided
        const detectedContext = this.detectPageContext();
        const pageContext = detectedContext || context || 'student-management';

        // Step 0: Validate template variables before proceeding
        const validationResult = await this.validateTemplate({
            ...options,
            pageContext: pageContext,
        });

        if (!validationResult.canSend) {
            // Create a user-friendly error message
            const missingCount = validationResult.missingVariables.length;
            const availableCount = Object.keys(validationResult.availableVariables).length;

            let errorMessage = '';
            if (missingCount > 0) {
                const missingList = validationResult.missingVariables.slice(0, 3).join(', ');
                const moreCount = missingCount > 3 ? ` and ${missingCount - 3} more` : '';
                errorMessage = `Template cannot be sent because ${missingCount} required variable${missingCount > 1 ? 's' : ''} ${missingCount > 1 ? 'are' : 'is'} missing: ${missingList}${moreCount}.`;
            } else {
                errorMessage =
                    'Template validation failed. Please check your template and try again.';
            }

            if (validationResult.warnings.length > 0) {
                errorMessage += ` Warnings: ${validationResult.warnings.join(', ')}`;
            }

            return {
                success: false,
                totalStudents: students.length,
                processedStudents: 0,
                failedStudents: students.length,
                errors: [
                    {
                        studentId: 'validation',
                        studentName: 'Template Validation',
                        error: errorMessage,
                    },
                ],
            };
        }

        // Step 1: Parse template variables to check if enrichment is needed
        const usedVariables = this.parseTemplateVariables(template + ' ' + subject);

        // Step 2: Only enrich student data if template has variables
        let enrichedStudents = students;
        if (usedVariables.length > 0) {
            enrichedStudents = await studentDataEnrichmentService.enrichStudentData(
                students,
                enrichmentOptions,
                usedVariables
            );
        }

        try {
            // Step 3: Create payload for each student
            const users: Array<{
                user_id: string;
                channel_id: string;
                placeholders: Record<string, string>;
            }> = [];

            const errors: Array<{
                studentId: string;
                studentName: string;
                error: string;
            }> = [];

            for (const student of enrichedStudents) {
                try {
                    // Create placeholders object for API
                    let placeholders: Record<string, string> = {};

                    if (usedVariables.length > 0) {
                        // Map template variables for this student only if template has variables
                        const mappedSubject = mapTemplateVariables(subject, { context, student });
                        const mappedBody = mapTemplateVariables(template, { context, student });
                        placeholders = this.createStudentPlaceholders(student);
                    } else {
                        // No variables, create minimal placeholders
                        placeholders = {
                            name: student.full_name || student.name || 'Student',
                            student_name: student.full_name || student.name || 'Student',
                            email: student.email || '',
                            student_email: student.email || '',
                        };
                    }

                    users.push({
                        user_id: student.user_id,
                        channel_id:
                            notificationType === 'EMAIL' ? student.email : student.mobile_number,
                        placeholders,
                    });
                } catch (error) {
                    errors.push({
                        studentId: student.user_id,
                        studentName: student.full_name || 'Unknown',
                        error: error instanceof Error ? error.message : 'Unknown error',
                    });
                }
            }

            // Step 4: Create bulk payload
            const instituteId = this.getInstituteId();
            const payload: BulkEmailPayload = {
                body: template, // Original template (variables will be replaced by API)
                notification_type: notificationType,
                source,
                source_id: sourceId,
                subject,
                users,
                // Only include institute_id if template has variables that might need institute data
                ...(usedVariables.length > 0 && instituteId ? { institute_id: instituteId } : {}),
            };

            // Step 5: Send bulk email via unified send API
            const recipients = users.map((u) => ({
                email: u.channel_id,
                userId: u.user_id,
                variables: u.placeholders,
            }));

            // Multi-recipient sends go through the durable batch queue (forceAsync):
            // the sync path sends each email inside the HTTP request and times out
            // on larger selections even though delivery continues server-side.
            // A multi-recipient mail is a commercial blast, so it asks for the unsubscribe footer.
            // The server adds it only when that keeps the same sender.
            let unifiedResponse: UnifiedSendResponse = await sendNotification({
                instituteId: instituteId || '',
                channel: 'EMAIL',
                recipients,
                forceAsync: recipients.length > 1,
                options: {
                    emailSubject: subject,
                    emailBody: template,
                    emailType: 'UTILITY_EMAIL',
                    commercialBulk: recipients.length > 1,
                    source: source,
                    sourceId: sourceId,
                },
            });

            // Async batch: poll so short sends get real counts. Large sends are paced and run
            // far longer than this poll, so running out of attempts is not a failure.
            let inProgress = false;
            if (unifiedResponse.batchId && unifiedResponse.status === 'PROCESSING') {
                try {
                    unifiedResponse = await waitForBatchCompletion(unifiedResponse.batchId);
                } catch {
                    inProgress = true;
                }
            }

            if (unifiedResponse.status === 'STOPPED') {
                errors.push({
                    studentId: 'all',
                    studentName: 'All Students',
                    error: `Sending stopped automatically because too many recent emails bounced. ${unifiedResponse.accepted} were sent before it stopped.`,
                });
            }

            const result: BulkEmailResult = {
                success: unifiedResponse.status !== 'FAILED' && unifiedResponse.status !== 'STOPPED',
                totalStudents: students.length,
                processedStudents: inProgress
                    ? recipients.length
                    : unifiedResponse.accepted + unifiedResponse.failed,
                failedStudents: inProgress ? errors.length : unifiedResponse.failed + errors.length,
                errors,
                payload,
                inProgress,
                batchId: unifiedResponse.batchId,
            };

            return result;
        } catch (error) {
            // Never resend from here. A lost response does not mean the batch was not queued, so
            // sending again one by one could email everyone twice.
            const rejected =
                axios.isAxiosError(error) &&
                (error.response?.status ?? 500) >= 400 &&
                (error.response?.status ?? 500) < 500;
            const reason = error instanceof Error ? error.message : 'Unknown error';
            return {
                success: false,
                totalStudents: students.length,
                processedStudents: 0,
                failedStudents: students.length,
                errors: [
                    {
                        studentId: 'all',
                        studentName: 'All Students',
                        error: rejected
                            ? reason
                            : `We could not confirm this send, so it may still be going out. Check before sending again. (${reason})`,
                    },
                ],
            };
        }
    }

    /**
     * Parse template to extract used variables
     */
    private parseTemplateVariables(template: string): string[] {
        const variableRegex = /\{\{([^}]+)\}\}/g;
        const variables: string[] = [];
        let match;

        while ((match = variableRegex.exec(template)) !== null) {
            if (match[1]) {
                variables.push(match[1].trim());
            }
        }

        return [...new Set(variables)]; // Remove duplicates
    }

    /**
     * Get available variables for a specific context
     */
    getAvailableVariables(context: string): string[] {
        return studentDataEnrichmentService.getAvailableVariablesForContext(context);
    }

    /**
     * Validate template for a specific context (legacy method)
     */
    validateTemplateLegacy(
        template: string,
        context: string
    ): {
        isValid: boolean;
        usedVariables: string[];
        availableVariables: string[];
        missingVariables: string[];
    } {
        const usedVariables = this.parseTemplateVariables(template);
        const availableVariables = this.getAvailableVariables(context);
        const missingVariables = usedVariables.filter(
            (variable) => !availableVariables.includes(`{{${variable}}}`)
        );

        return {
            isValid: missingVariables.length === 0,
            usedVariables,
            availableVariables,
            missingVariables,
        };
    }

    /**
     * Preview template with sample data
     */
    async previewTemplate(
        template: string,
        subject: string,
        context: string,
        sampleStudent?: any
    ): Promise<{
        mappedSubject: string;
        mappedBody: string;
        usedVariables: string[];
        availableVariables: string[];
    }> {
        const usedVariables = this.parseTemplateVariables(template + ' ' + subject);
        const availableVariables = this.getAvailableVariables(context);

        let mappedSubject = subject;
        let mappedBody = template;

        if (sampleStudent) {
            // Use sample student data for preview
            const enrichedStudent = await studentDataEnrichmentService.enrichStudentData(
                [sampleStudent],
                { includeCourse: true, includeBatch: true, includeInstitute: true }
            );

            if (enrichedStudent.length > 0) {
                mappedSubject = mapTemplateVariables(subject, {
                    context: context as any,
                    student: enrichedStudent[0],
                });

                mappedBody = mapTemplateVariables(template, {
                    context: context as any,
                    student: enrichedStudent[0],
                });
            }
        }

        return {
            mappedSubject,
            mappedBody,
            usedVariables,
            availableVariables,
        };
    }
}

// Export singleton instance
export const bulkEmailService = new BulkEmailService();
