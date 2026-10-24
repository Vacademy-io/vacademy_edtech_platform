import React, { useEffect, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
    CircleNotch,
    Plus,
    Trash,
    PencilSimple,
    Eye,
    FileText,
    EnvelopeSimple,
    CaretLeft,
    CaretRight,
    Sparkle,
    Star,
} from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { MessageTemplate } from '@/types/message-template-types';
import {
    getMessageTemplatesByType,
    getMessageTemplate,
    deleteMessageTemplate,
    createMessageTemplate,
} from '@/services/message-template-service';
import { TemplatePreview } from '@/components/templates/shared/TemplatePreview';
import { toast } from 'sonner';
import { fetchDefaultInvoiceTemplateIds, setDefaultInvoiceTemplate } from './invoice-settings-service';

/** Separate from the settings form's ['invoice-settings'] query so refreshing it never resets unsaved form edits. */
const DEFAULT_TEMPLATES_QUERY_KEY = ['invoice-default-template-ids'];

interface InvoiceTemplatesSectionProps {
    /** DB template type: INVOICE = PDF layout, INVOICE_EMAIL = email body. */
    type: 'INVOICE' | 'INVOICE_EMAIL';
}

const buildTypeMeta = (
    t: TFunction
): Record<InvoiceTemplatesSectionProps['type'], { title: string; description: string; icon: typeof FileText }> => ({
    INVOICE: {
        title: t('types.invoice.title'),
        description: t('types.invoice.description'),
        icon: FileText,
    },
    INVOICE_EMAIL: {
        title: t('types.invoiceEmail.title'),
        description: t('types.invoiceEmail.description'),
        icon: EnvelopeSimple,
    },
});

const PAGE_SIZE = 5;

export const InvoiceTemplatesSection: React.FC<InvoiceTemplatesSectionProps> = ({ type }) => {
    const { t } = useTranslation('settingsInvoiceTemplates');
    const navigate = useNavigate();
    const meta = buildTypeMeta(t)[type];
    const Icon = meta.icon;

    const [allTemplates, setAllTemplates] = useState<MessageTemplate[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [page, setPage] = useState(0);

    const [showPreview, setShowPreview] = useState(false);
    const [previewTemplate, setPreviewTemplate] = useState<MessageTemplate | null>(null);
    const [deleteId, setDeleteId] = useState<string | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);

    const queryClient = useQueryClient();
    const { data: defaultIds } = useQuery({
        queryKey: DEFAULT_TEMPLATES_QUERY_KEY,
        queryFn: fetchDefaultInvoiceTemplateIds,
    });
    const { mutate: makeDefault, isPending: isSettingDefault } = useMutation({
        mutationFn: (templateId: string) => setDefaultInvoiceTemplate(type, templateId),
        onSuccess: () => {
            toast.success(t('toasts.defaultSet'));
            queryClient.invalidateQueries({ queryKey: DEFAULT_TEMPLATES_QUERY_KEY });
        },
        onError: () => toast.error(t('toasts.defaultSetFailed')),
    });

    const loadTemplates = async () => {
        setIsLoading(true);
        try {
            // Type-filtered endpoint so this list only ever shows `type` templates
            // (the paginated all-templates endpoint ignores the type filter).
            const list = await getMessageTemplatesByType(type);
            setAllTemplates(list);
            setPage(0);
        } catch (error) {
            console.error(`Error loading ${type} templates:`, error);
            toast.error(t('toasts.loadFailed'));
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        loadTemplates();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [type]);

    const totalElements = allTemplates.length;
    const totalPages = Math.max(1, Math.ceil(totalElements / PAGE_SIZE));
    const templates = allTemplates.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

    // Mirrors the backend (InvoiceDefaultTemplatePicker): the chosen default while it
    // still exists, otherwise the newest template — the list arrives newest first.
    const storedDefaultId = defaultIds?.[type] ?? null;
    const inUseId =
        storedDefaultId &&
        allTemplates.some((tpl) => tpl.id === storedDefaultId && !!tpl.content?.trim())
            ? storedDefaultId
            : allTemplates[0]?.id;

    const handleCreate = () => {
        navigate({ to: '/templates/create', search: { type } });
    };

    // Sparkle: generate a ready-made sample template (MJML + HTML, saved exactly like
    // the easy-email editor does) with all invoice variables pre-placed, then open it.
    const handleGenerateSample = async () => {
        setIsGenerating(true);
        try {
            const { buildSampleInvoiceTemplate } = await import('./sample-invoice-templates');
            const sample = buildSampleInvoiceTemplate(type);
            const created = await createMessageTemplate({
                name: sample.name,
                type,
                subject: sample.subject,
                content: sample.content,
                variables: sample.variables,
                templateType: type,
                mjml: sample.mjml,
                previewText: sample.previewText,
            });
            toast.success(t('toasts.sampleCreated'));
            navigate({ to: '/templates/edit/$templateId', params: { templateId: created.id } });
        } catch (error) {
            console.error(`Error generating sample ${type} template:`, error);
            toast.error(t('toasts.generateSampleFailed'));
        } finally {
            setIsGenerating(false);
        }
    };

    const handleEdit = (template: MessageTemplate) => {
        navigate({ to: '/templates/edit/$templateId', params: { templateId: template.id } });
    };

    const handlePreview = async (template: MessageTemplate) => {
        try {
            const full = await getMessageTemplate(template.id);
            setPreviewTemplate(full);
        } catch (error) {
            console.error('Error loading template:', error);
            setPreviewTemplate(template);
        }
        setShowPreview(true);
    };

    const handleDelete = async (templateId: string) => {
        setIsDeleting(true);
        try {
            await deleteMessageTemplate(templateId);
            toast.success(t('toasts.deleteSuccess'));
            setDeleteId(null);
            await loadTemplates();
        } catch (error) {
            console.error('Error deleting template:', error);
            toast.error(t('toasts.deleteFailed'));
        } finally {
            setIsDeleting(false);
        }
    };

    const goToPage = (next: number) => {
        if (next >= 0 && next < totalPages) {
            setPage(next);
        }
    };

    const formatDate = (dateString: string) =>
        new Date(dateString).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
        });

    return (
        <Card>
            <CardHeader>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="space-y-1">
                        <CardTitle className="flex items-center gap-2 text-base">
                            <Icon className="size-5" />
                            {meta.title}
                        </CardTitle>
                        <CardDescription>{meta.description}</CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={handleGenerateSample}
                            disabled={isGenerating}
                            title={t('actions.generateSampleTitle')}
                        >
                            {isGenerating ? (
                                <CircleNotch className="me-2 size-4 animate-spin" />
                            ) : (
                                <Sparkle className="me-2 size-4 text-amber-500" />
                            )}
                            {isGenerating ? t('actions.generating') : t('actions.generateSample')}
                        </Button>
                        <MyButton buttonType="primary" scale="medium" onClick={handleCreate}>
                            <Plus className="mr-2 size-4" />
                            {t('actions.createTemplate')}
                        </MyButton>
                    </div>
                </div>
            </CardHeader>
            <CardContent>
                {isLoading ? (
                    <div className="flex items-center justify-center py-8">
                        <CircleNotch className="size-5 animate-spin" />
                        <span className="ms-2 text-sm">{t('loading')}</span>
                    </div>
                ) : templates.length === 0 ? (
                    <div className="rounded-lg border border-dashed py-8 text-center">
                        <Icon className="mx-auto mb-3 size-8 text-muted-foreground" />
                        <p className="mb-3 text-sm text-muted-foreground">
                            {type === 'INVOICE'
                                ? t('emptyState.messagePdf')
                                : t('emptyState.messageEmail')}
                        </p>
                        <MyButton buttonType="secondary" scale="medium" onClick={handleCreate}>
                            <Plus className="mr-2 size-4" />
                            {t('emptyState.createFirst')}
                        </MyButton>
                    </div>
                ) : (
                    <div className="overflow-x-auto rounded-lg border">
                        <Table className="min-w-96">
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="text-xs sm:text-sm">{t('table.columns.name')}</TableHead>
                                    <TableHead className="hidden text-xs sm:table-cell sm:text-sm">
                                        {t('table.columns.subject')}
                                    </TableHead>
                                    <TableHead className="hidden text-xs md:table-cell sm:text-sm">
                                        {t('table.columns.created')}
                                    </TableHead>
                                    <TableHead className="text-end text-xs sm:text-sm">
                                        {t('table.columns.actions')}
                                    </TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {templates.map((template) => (
                                    <TableRow key={template.id}>
                                        <TableCell className="font-medium text-xs sm:text-sm">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span>{template.name}</span>
                                                {template.id === inUseId && (
                                                    <Badge
                                                        variant="secondary"
                                                        title={t('table.defaultBadgeTitle')}
                                                    >
                                                        {t('table.defaultBadge')}
                                                    </Badge>
                                                )}
                                            </div>
                                        </TableCell>
                                        <TableCell className="hidden sm:table-cell">
                                            <div className="max-w-xs truncate text-xs sm:text-sm text-muted-foreground">
                                                {template.subject || (
                                                    <span className="italic">{t('table.noSubject')}</span>
                                                )}
                                            </div>
                                        </TableCell>
                                        <TableCell className="hidden text-xs md:table-cell sm:text-sm">
                                            {formatDate(template.createdAt)}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <div className="flex items-center justify-end gap-1">
                                                {template.id !== inUseId && (
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() => makeDefault(template.id)}
                                                        disabled={isSettingDefault}
                                                        className="p-1 sm:p-2"
                                                        title={t('table.actions.setDefault')}
                                                    >
                                                        <Star className="size-4" />
                                                    </Button>
                                                )}
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => handlePreview(template)}
                                                    className="p-1 sm:p-2"
                                                    title={t('table.actions.preview')}
                                                >
                                                    <Eye className="size-4" />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => handleEdit(template)}
                                                    className="p-1 sm:p-2"
                                                    title={t('table.actions.edit')}
                                                >
                                                    <PencilSimple className="size-4" />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => setDeleteId(template.id)}
                                                    className="p-1 text-destructive hover:text-destructive sm:p-2"
                                                    title={t('table.actions.delete')}
                                                >
                                                    <Trash className="size-4" />
                                                </Button>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                )}

                {!isLoading && totalPages > 1 && (
                    <div className="mt-4 flex items-center justify-between">
                        <span className="text-xs text-muted-foreground">
                            {t('pagination.templateCount', { count: totalElements })}
                        </span>
                        <div className="flex items-center gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                className="h-8 w-8 p-0"
                                disabled={page === 0}
                                onClick={() => goToPage(page - 1)}
                            >
                                <CaretLeft className="size-4" />
                            </Button>
                            <span className="text-xs">
                                {t('pagination.pageOf', { page: page + 1, total: totalPages })}
                            </span>
                            <Button
                                variant="outline"
                                size="sm"
                                className="h-8 w-8 p-0"
                                disabled={page >= totalPages - 1}
                                onClick={() => goToPage(page + 1)}
                            >
                                <CaretRight className="size-4" />
                            </Button>
                        </div>
                    </div>
                )}
            </CardContent>

            {showPreview && previewTemplate && (
                <TemplatePreview
                    template={previewTemplate}
                    isOpen={showPreview}
                    onClose={() => {
                        setShowPreview(false);
                        setPreviewTemplate(null);
                    }}
                />
            )}

            <Dialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>{t('deleteDialog.title')}</DialogTitle>
                        <DialogDescription>{t('deleteDialog.description')}</DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="gap-2">
                        <Button
                            variant="outline"
                            onClick={() => setDeleteId(null)}
                            disabled={isDeleting}
                        >
                            {t('deleteDialog.cancel')}
                        </Button>
                        <Button
                            variant="destructive"
                            onClick={() => deleteId && handleDelete(deleteId)}
                            disabled={isDeleting}
                        >
                            {isDeleting ? (
                                <>
                                    <CircleNotch className="me-2 size-4 animate-spin" />
                                    {t('deleteDialog.deleting')}
                                </>
                            ) : (
                                t('deleteDialog.delete')
                            )}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </Card>
    );
};

export default InvoiceTemplatesSection;
