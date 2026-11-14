import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { MessageTemplate } from '@/types/message-template-types';
import { getMessageTemplates, getMessageTemplate } from '@/services/message-template-service';
import { toast } from 'sonner';
import { v4 as uuidv4 } from 'uuid';
import { getInstituteId } from '@/constants/helper';
import {
    Plus,
    FileText,
    Eye,
    CircleNotch,
    Spinner,
    MagnifyingGlass,
    CaretLeft,
    CaretRight,
} from '@phosphor-icons/react';
import { useNavigate } from '@tanstack/react-router';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface StudentEmailStatus {
    userId: string;
    name: string;
    email: string;
    status: 'pending' | 'sending' | 'sent' | 'failed';
    error?: string;
}

interface TemplateSelectionDialogProps {
    isOpen: boolean;
    onClose: () => void;
    onSelectTemplate: (template: MessageTemplate) => void;
    onCreateNew: () => void;
    studentEmailStatuses: StudentEmailStatus[];
    isBulkEmailSending: boolean;
    onSendEmail: (template: MessageTemplate) => Promise<void>;
}

export const TemplateSelectionDialog: React.FC<TemplateSelectionDialogProps> = ({
    isOpen,
    onClose,
    onSelectTemplate,
    onCreateNew,
    studentEmailStatuses,
    isBulkEmailSending,
    onSendEmail,
}) => {
    const { t } = useTranslation('manageStudentsTemplateSelectionDialog');
    const navigate = useNavigate();
    const [templates, setTemplates] = useState<MessageTemplate[]>([]);
    const [isLoadingTemplates, setIsLoadingTemplates] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [filteredTemplates, setFilteredTemplates] = useState<MessageTemplate[]>([]);
    
    // Pagination state
    const [currentPage, setCurrentPage] = useState(0);
    const [pageSize, setPageSize] = useState(10);
    const [totalElements, setTotalElements] = useState(0);
    const [totalPages, setTotalPages] = useState(1);
    const [isLast, setIsLast] = useState(true);
    const [isFirst, setIsFirst] = useState(true);

    const loadTemplates = async (page: number = currentPage, size: number = pageSize) => {
        setIsLoadingTemplates(true);
        try {
            const response = await getMessageTemplates('EMAIL', page, size);
            setTemplates(response.templates);
            setFilteredTemplates(response.templates);
            setTotalElements(response.total);
            setTotalPages(response.totalPages || 1);
            setIsLast(response.isLast ?? true);
            setIsFirst(response.isFirst ?? true);
            setCurrentPage(response.page);
        } catch (error) {
            console.error('Error loading templates:', error);
            toast.error(t('errors.loadTemplatesFailed'));
        } finally {
            setIsLoadingTemplates(false);
        }
    };

    // Filter templates based on search query (client-side filtering on current page)
    useEffect(() => {
        if (!searchQuery.trim()) {
            setFilteredTemplates(templates);
        } else {
            const filtered = templates.filter((template) =>
                template.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                template.subject?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                (template.content && template.content.toLowerCase().includes(searchQuery.toLowerCase()))
            );
            setFilteredTemplates(filtered);
        }
    }, [searchQuery, templates]);

    useEffect(() => {
        if (isOpen) {
            loadTemplates(0, pageSize);
        }
    }, [isOpen]);

    // Reload when page or page size changes
    useEffect(() => {
        if (isOpen) {
            loadTemplates(currentPage, pageSize);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentPage, pageSize]);

    const handlePageChange = (newPage: number) => {
        if (newPage >= 0 && newPage < totalPages) {
            setCurrentPage(newPage);
        }
    };

    const handlePageSizeChange = (newSize: number) => {
        setPageSize(newSize);
        setCurrentPage(0); // Reset to first page when changing page size
    };

        const handleSelectTemplate = async (template: MessageTemplate) => {
            try {
                // Fetch full template content from API
                const fullTemplate = await getMessageTemplate(template.id);
                onSelectTemplate(fullTemplate);
                // Don't close immediately - let parent handle preview dialog
            } catch (error) {
                console.error('Error loading template:', error);
                toast.error(t('errors.loadTemplateContentFailed'));
                // Fallback to cached template if API fails
                onSelectTemplate(template);
            }
        };

    const handleSendEmail = async (template: MessageTemplate) => {
        try {
            await onSendEmail(template);
            onClose();
        } catch (error) {
            // Error is already handled by toast.error
        }
    };

    const handleCreateNew = () => {
        // Redirect to the create template route
        navigate({ to: '/templates/create' });
        onClose();
    };

    return (
        <MyDialog
            heading={t('dialog.heading')}
            open={isOpen}
            onOpenChange={onClose}
            dialogWidth="w-dialog-xl"
            footer={
                <div className="flex items-center justify-end">
                    <MyButton
                        buttonType="secondary"
                        scale="medium"
                        onClick={onClose}
                        disabled={isBulkEmailSending}
                    >
                        {t('dialog.cancel')}
                    </MyButton>
                </div>
            }
        >
            <div className="space-y-4">
                {/* Header with Search and Create New Button */}
                <div className="flex items-center justify-between gap-4">
                    <div className="flex-1 max-w-md">
                        <MyInput
                            inputType="text"
                            input={searchQuery}
                            onChangeFunction={(e) => setSearchQuery(e.target.value)}
                            inputPlaceholder={t('search.placeholder')}
                            className="w-full"
                        />
                    </div>
                    <MyButton
                        buttonType="primary"
                        scale="medium"
                        onClick={handleCreateNew}
                        disabled={isBulkEmailSending}
                    >
                        <Plus className="mr-2 size-4" />
                        {t('actions.createNewTemplate')}
                    </MyButton>
                </div>

                {isLoadingTemplates ? (
                    <div className="flex items-center justify-center py-8">
                        <CircleNotch className="size-6 animate-spin text-blue-600" />
                        <span className="ms-2 text-sm text-neutral-600">{t('loading.templates')}</span>
                    </div>
                ) : filteredTemplates.length === 0 ? (
                    <div className="text-center py-8">
                        <FileText className="mx-auto size-12 text-neutral-400 mb-4" />
                        <p className="text-neutral-600 mb-4">
                            {searchQuery ? t('empty.noSearchResults') : t('empty.noTemplates')}
                        </p>
                        <p className="text-sm text-neutral-500">{t('empty.getStarted')}</p>
                    </div>
                ) : (
                    <>
                        <div className="border border-neutral-200 rounded-lg overflow-hidden">
                            <table className="w-full">
                                <thead className="bg-neutral-50 border-b border-neutral-200">
                                        <tr>
                                            <th className="px-4 py-3 text-start text-sm font-medium text-neutral-700">{t('table.templateName')}</th>
                                            <th className="px-4 py-3 text-start text-sm font-medium text-neutral-700">{t('table.subject')}</th>
                                            <th className="px-4 py-3 text-start text-sm font-medium text-neutral-700">{t('table.contentPreview')}</th>
                                        </tr>
                                </thead>
                                <tbody className="divide-y divide-neutral-200">
                                    {filteredTemplates.map((template) => (
                                        <tr
                                            key={template.id}
                                            className="hover:bg-neutral-50 cursor-pointer transition-colors"
                                            onClick={() => handleSelectTemplate(template)}
                                        >
                                            <td className="px-4 py-3">
                                                <div className="flex items-center gap-2">
                                                    <FileText className="size-4 text-blue-600" />
                                                    <span className="text-sm font-medium text-neutral-800">
                                                        {template.name}
                                                    </span>
                                                </div>
                                            </td>
                                            <td className="px-4 py-3">
                                                <div className="text-sm text-neutral-700 max-w-xs truncate">
                                                    {template.subject || t('table.noSubject')}
                                                </div>
                                            </td>
                                            <td className="px-4 py-3">
                                                <div
                                                    className="text-sm text-neutral-600 max-w-xs truncate"
                                                    dangerouslySetInnerHTML={{
                                                        __html: template.content?.substring(0, 80) + (template.content?.length > 80 ? '...' : '') || t('table.noContent')
                                                    }}
                                                />
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        {/* Pagination Controls */}
                        {templates.length > 0 && (
                            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 py-4 border-t border-neutral-200">
                                <div className="flex items-center gap-2 text-sm text-neutral-600">
                                    <span>
                                        {t('pagination.showingRange', {
                                            start: currentPage * pageSize + 1,
                                            end: Math.min((currentPage + 1) * pageSize, totalElements),
                                            total: totalElements,
                                        })}
                                    </span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm text-neutral-600">{t('pagination.rowsPerPage')}</span>
                                        <Select value={pageSize.toString()} onValueChange={(value) => handlePageSizeChange(Number(value))}>
                                            <SelectTrigger className="w-16 h-8">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="10">10</SelectItem>
                                                <SelectItem value="20">20</SelectItem>
                                                <SelectItem value="50">50</SelectItem>
                                                <SelectItem value="100">100</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <button
                                            onClick={() => handlePageChange(currentPage - 1)}
                                            disabled={isFirst || currentPage === 0}
                                            className="h-8 w-8 flex items-center justify-center rounded border border-neutral-300 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-neutral-50"
                                        >
                                            <CaretLeft className="size-4" />
                                        </button>
                                        <div className="flex items-center gap-1 px-2">
                                            <span className="text-sm text-neutral-600">
                                                {t('pagination.pageOf', { current: currentPage + 1, total: totalPages })}
                                            </span>
                                        </div>
                                        <button
                                            onClick={() => handlePageChange(currentPage + 1)}
                                            disabled={isLast || currentPage >= totalPages - 1}
                                            className="h-8 w-8 flex items-center justify-center rounded border border-neutral-300 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-neutral-50"
                                        >
                                            <CaretRight className="size-4" />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>
        </MyDialog>
    );
};
