import React, { useState, useEffect, Suspense } from 'react';
import { useNavigate } from '@tanstack/react-router';
// import EmailBuilder from './EmailBuilder'; // Lazy load this instead
import {
    MessageTemplate,
    CreateTemplateRequest,
    UpdateTemplateRequest,
} from '@/types/message-template-types';
import {
    createMessageTemplate,
    updateMessageTemplate,
    getMessageTemplate,
} from '@/services/message-template-service';
import { templateCacheService } from '@/services/template-cache-service';
import { EmailBrandSettings, getEmailBrandSettings } from '@/services/email-brand-settings';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import './email-editor.css';

const EmailBuilder = React.lazy(() => import('./EmailBuilder'));

interface TemplateEditorEmailProps {
    templateId: string | null; // null for create, string for edit
    // Preselects the template category when creating (e.g. INVOICE / INVOICE_EMAIL
    // when launched from Invoice Settings). Ignored when editing an existing template.
    initialType?: MessageTemplate['type'];
}

export const TemplateEditorEmail: React.FC<TemplateEditorEmailProps> = ({ templateId, initialType }) => {
    const navigate = useNavigate();
    const [template, setTemplate] = useState<MessageTemplate | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    // Brand kit must be in hand before the builder mounts — its initial page data is built once.
    const [brand, setBrand] = useState<EmailBrandSettings | null>(null);

    useEffect(() => {
        getEmailBrandSettings().then(setBrand);
    }, []);

    // Load template if editing
    useEffect(() => {
        if (templateId) {
            loadTemplate();
        }
    }, [templateId]);

    const loadTemplate = async () => {
        if (!templateId) return;

        setIsLoading(true);
        try {
            const loadedTemplate = await getMessageTemplate(templateId);
            setTemplate(loadedTemplate);
        } catch (error) {
            console.error('Error loading template:', error);
            toast.error('Failed to load template. Please try again.');
            navigate({ to: '/settings', search: { selectedTab: 'templates' } });
        } finally {
            setIsLoading(false);
        }
    };

    const handleSave = async (savedTemplate: MessageTemplate): Promise<void> => {
        setIsSaving(true);
        try {
            if (templateId) {
                // Update existing template
                const updateRequest: UpdateTemplateRequest = {
                    id: templateId,
                    name: savedTemplate.name,
                    type: savedTemplate.type,
                    subject: savedTemplate.subject,
                    content: savedTemplate.content,
                    variables: savedTemplate.variables,
                    isDefault: savedTemplate.isDefault,
                    templateType: savedTemplate.templateType,
                    mjml: savedTemplate.mjml,
                    previewText: savedTemplate.previewText,
                };

                await updateMessageTemplate(updateRequest);
                templateCacheService.clearCache('EMAIL');
                toast.success('Template updated successfully!');
            } else {
                // Create new template
                const createRequest: CreateTemplateRequest = {
                    name: savedTemplate.name,
                    type: savedTemplate.type,
                    subject: savedTemplate.subject,
                    content: savedTemplate.content,
                    variables: savedTemplate.variables,
                    isDefault: savedTemplate.isDefault,
                    templateType: savedTemplate.templateType,
                    mjml: savedTemplate.mjml,
                    previewText: savedTemplate.previewText,
                };

                const createdTemplate = await createMessageTemplate(createRequest);
                templateCacheService.clearCache('EMAIL');
                toast.success('Template created successfully!');

                // Update the template state with the new ID so EmailBuilder can store MJML JSON
                setTemplate(createdTemplate);

                // Navigate to edit mode with the new template ID
                navigate({
                    to: '/templates/edit/$templateId',
                    params: { templateId: createdTemplate.id },
                });
            }
        } catch (error) {
            console.error('Error saving template:', error);
            const errorMessage = error instanceof Error ? error.message : 'Failed to save template';
            toast.error(errorMessage);
            throw error; // Re-throw to let EmailBuilder handle it
        } finally {
            setIsSaving(false);
        }
    };

    const handleBack = () => {
        navigate({ to: '/settings', search: { selectedTab: 'templates' } });
    };

    if (isLoading || !brand) {
        return (
            <div className="flex h-screen w-screen items-center justify-center bg-background">
                <Loader2 className="size-6 animate-spin" />
                <span className="ml-2">Loading template...</span>
            </div>
        );
    }

    return (
        <div
            className="app-container"
            style={{ height: '100vh', width: '100vw', overflow: 'hidden' }}
        >
            <Suspense
                fallback={
                    <div className="flex h-screen w-screen items-center justify-center bg-background">
                        <Loader2 className="size-6 animate-spin" />
                        <span className="ml-2">Loading editor...</span>
                    </div>
                }
            >
                <EmailBuilder
                    template={template}
                    onBack={handleBack}
                    onSave={handleSave}
                    isSaving={isSaving}
                    brand={brand}
                    initialTemplateType={
                        initialType === 'INVOICE' ||
                        initialType === 'INVOICE_EMAIL' ||
                        initialType === 'PAYMENT_CONFIRMATION'
                            ? initialType
                            : undefined
                    }
                />
            </Suspense>
        </div>
    );
};
