import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
    Warning,
    CheckCircle,
    CircleNotch,
    ArrowsClockwise,
    GearSix,
    MagnifyingGlass,
    ArrowSquareOut,
} from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
    MetaWhatsAppTemplate,
    WhatsAppTemplateMapping
} from '@/types/message-template-types';
import { whatsappTemplateService } from '@/services/whatsapp-template-service';
import { WhatsAppTemplateMappingModal } from './WhatsAppTemplateMappingModal';

export const WhatsAppTemplatesTab: React.FC = () => {
    const { t } = useTranslation('settingsWhatsAppTemplatesTab');
    const [templates, setTemplates] = useState<MetaWhatsAppTemplate[]>([]);
    const [filteredTemplates, setFilteredTemplates] = useState<MetaWhatsAppTemplate[]>([]);
    const [mappings, setMappings] = useState<WhatsAppTemplateMapping[]>([]);
    const [loading, setLoading] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedTemplate, setSelectedTemplate] = useState<MetaWhatsAppTemplate | null>(null);
    const [showMappingModal, setShowMappingModal] = useState(false);
    const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);

    useEffect(() => {
        loadTemplates();
        loadMappings();
    }, []);

    useEffect(() => {
        // Filter templates based on search query
        if (searchQuery.trim() === '') {
            setFilteredTemplates(templates);
        } else {
            const filtered = templates.filter(template =>
                template.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                template.language.toLowerCase().includes(searchQuery.toLowerCase()) ||
                template.category.toLowerCase().includes(searchQuery.toLowerCase())
            );
            setFilteredTemplates(filtered);
        }
    }, [templates, searchQuery]);

    const loadTemplates = async () => {
        setLoading(true);
        setError(null);
        try {
            const metaTemplates = await whatsappTemplateService.getMetaTemplates();
            setTemplates(metaTemplates);
            setLastSyncTime(whatsappTemplateService.getLastSyncTime());
        } catch (err) {
            console.error('Error loading WhatsApp templates:', err);
            // Quote the reason the service gives us — "the Meta access token is expired" tells the
            // admin what to fix; "please try again" sends them round the same loop.
            setError(err instanceof Error ? err.message : t('errors.loadFailed'));
        } finally {
            setLoading(false);
        }
    };

    const loadMappings = async () => {
        try {
            const templateMappings = await whatsappTemplateService.getAllMappings();
            setMappings(templateMappings);
        } catch (err) {
            console.error('Error loading template mappings:', err);
            // Don't show error for mappings - it's not critical for the main view
        }
    };

    const handleSyncTemplates = async () => {
        setSyncing(true);
        setError(null);
        try {
            const metaTemplates = await whatsappTemplateService.syncMetaTemplates();
            setTemplates(metaTemplates);
            setLastSyncTime(whatsappTemplateService.getLastSyncTime());
            setSuccess(t('success.synced'));
        } catch (err) {
            console.error('Error syncing templates:', err);
            setError(err instanceof Error ? err.message : t('errors.syncFailed'));
        } finally {
            setSyncing(false);
        }
    };

    const handleMapDynamicValues = (template: MetaWhatsAppTemplate) => {
        setSelectedTemplate(template);
        setShowMappingModal(true);
    };

    const handleMappingSaved = (mapping: WhatsAppTemplateMapping) => {
        setMappings(prev => {
            const existingIndex = prev.findIndex(m => m.templateId === mapping.templateId);
            if (existingIndex >= 0) {
                const updated = [...prev];
                updated[existingIndex] = mapping;
                return updated;
            } else {
                return [...prev, mapping];
            }
        });
        setSuccess(t('success.mappingSaved'));
    };

    const handleCloseMappingModal = () => {
        setShowMappingModal(false);
        setSelectedTemplate(null);
    };

    const getTemplateMapping = (templateId: string) => {
        return mappings.find(m => m.templateId === templateId);
    };

    const getStatusBadge = (status: string) => {
        const statusConfig = {
            APPROVED: 'bg-green-100 text-green-800 border-green-200',
            PENDING: 'bg-yellow-100 text-yellow-800 border-yellow-200',
            REJECTED: 'bg-red-100 text-red-800 border-red-200',
            DISABLED: 'bg-gray-100 text-gray-600 border-gray-200',
        } as const;

        const className = statusConfig[status as keyof typeof statusConfig] || statusConfig.PENDING;

        return (
            <Badge className={className}>
                {status}
            </Badge>
        );
    };

    const getMappingStatus = (templateId: string) => {
        const mapping = getTemplateMapping(templateId);
        if (mapping && mapping.mappings.length > 0) {
            return (
                <Badge className="bg-blue-100 text-blue-800 border-blue-200">
                    {t('mappingStatus.configured')}
                </Badge>
            );
        }
        return (
            <Badge className="bg-gray-100 text-gray-600 border-gray-200">
                {t('mappingStatus.notConfigured')}
            </Badge>
        );
    };

    const getCategoryBadge = (category: string) => {
        const categoryConfig = {
            TRANSACTIONAL: 'bg-purple-100 text-purple-800 border-purple-200',
            MARKETING: 'bg-blue-100 text-blue-800 border-blue-200',
            UTILITY: 'bg-orange-100 text-orange-800 border-orange-200',
        } as const;

        const className = categoryConfig[category as keyof typeof categoryConfig] || 'bg-gray-100 text-gray-600 border-gray-200';

        return (
            <Badge className={className}>
                {category}
            </Badge>
        );
    };

    const formatDate = (dateString: string) => {
        const date = new Date(dateString);
        return date.toLocaleDateString('en-GB', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        });
    };

    // Clear success/error messages after timeout
    useEffect(() => {
        if (success) {
            const timer = setTimeout(() => setSuccess(null), 3000);
            return () => clearTimeout(timer);
        }
        return undefined;
    }, [success]);

    useEffect(() => {
        if (error) {
            const timer = setTimeout(() => setError(null), 5000);
            return () => clearTimeout(timer);
        }
        return undefined;
    }, [error]);

    const approvedTemplates = filteredTemplates.filter(tpl => tpl.status === 'APPROVED');

    return (
        <div className="space-y-4 sm:space-y-6">
            {/* Error Alert */}
            {error && (
                <Alert variant="destructive" className="p-3 sm:p-4">
                    <Warning className="size-4" />
                    <AlertDescription className="text-xs sm:text-sm break-words">{error}</AlertDescription>
                </Alert>
            )}

            {/* Success Alert */}
            {success && (
                <Alert variant="default" className="border-green-200 bg-green-50 text-green-800 p-3 sm:p-4">
                    <CheckCircle className="size-4" />
                    <AlertDescription className="text-xs sm:text-sm break-words">{success}</AlertDescription>
                </Alert>
            )}

            {/* Header */}
            <div className="space-y-1">
                <h2 className="text-lg sm:text-xl font-semibold">{t('header.title')}</h2>
                <p className="text-xs sm:text-sm text-muted-foreground">
                    {t('header.subtitle')}
                </p>
            </div>

            {/* WhatsApp Template Management Info */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 sm:p-4">
                <h3 className="text-xs sm:text-sm font-medium text-blue-900 mb-2">{t('infoBox.title')}</h3>
                <p className="text-xs sm:text-sm text-blue-700 break-words">
                    {t('infoBox.description')}
                </p>
            </div>

            {/* Search and Actions */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
                <div className="relative w-full sm:w-80">
                    <MagnifyingGlass className="absolute start-3 top-1/2 transform -translate-y-1/2 text-gray-400 size-3 sm:size-4" />
                    <Input
                        placeholder={t('search.placeholder')}
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-8 sm:pl-10 text-xs sm:text-sm"
                    />
                </div>
                <MyButton
                    onClick={handleSyncTemplates}
                    disabled={syncing || loading}
                    className="flex items-center gap-2 w-full sm:w-auto text-xs sm:text-sm"
                >
                    <ArrowsClockwise className={`size-3 sm:size-4 ${syncing ? 'animate-spin' : ''}`} />
                    {syncing ? t('actions.syncing') : t('actions.syncTemplates')}
                </MyButton>
            </div>

            {/* Template Count */}
            <div className="text-xs sm:text-sm text-gray-600">
                {t('templateCount', { count: approvedTemplates.length })}
            </div>

            {/* Templates Table */}
            {loading ? (
                <div className="flex flex-col items-center justify-center py-8 sm:py-12">
                    <CircleNotch className="size-8 sm:size-10 animate-spin text-primary-500" />
                    <p className="mt-4 text-xs sm:text-sm text-gray-600">{t('loading.templates')}</p>
                </div>
            ) : approvedTemplates.length === 0 ? (
                <div className="text-center py-8 sm:py-12">
                    <div className="mx-auto w-16 h-16 sm:w-24 sm:h-24 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                        <ArrowSquareOut className="size-6 sm:size-8 text-gray-400" />
                    </div>
                    <h3 className="text-base sm:text-lg font-medium text-gray-900 mb-2">{t('emptyState.title')}</h3>
                    <p className="text-xs sm:text-sm text-gray-600 mb-4 break-words">
                        {t('emptyState.description')}
                    </p>
                    <MyButton onClick={handleSyncTemplates} disabled={syncing} className="w-full sm:w-auto text-xs sm:text-sm">
                        <ArrowsClockwise className={`size-3 sm:size-4 me-2 ${syncing ? 'animate-spin' : ''}`} />
                        {t('actions.syncTemplates')}
                    </MyButton>
                </div>
            ) : (
                <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
                    <div className="overflow-x-auto">
                        <Table>
                            <TableHeader className="bg-gray-50/50">
                                <TableRow className="border-b border-gray-200">
                                    <TableHead className="font-semibold text-gray-900 py-3 sm:py-4 px-3 sm:px-6 text-xs sm:text-sm">{t('table.headers.templateName')}</TableHead>
                                    <TableHead className="font-semibold text-gray-900 py-3 sm:py-4 px-3 sm:px-6 text-xs sm:text-sm hidden sm:table-cell">{t('table.headers.language')}</TableHead>
                                    <TableHead className="font-semibold text-gray-900 py-3 sm:py-4 px-3 sm:px-6 text-xs sm:text-sm hidden md:table-cell">{t('table.headers.category')}</TableHead>
                                    <TableHead className="font-semibold text-gray-900 py-3 sm:py-4 px-3 sm:px-6 text-xs sm:text-sm hidden lg:table-cell">{t('table.headers.status')}</TableHead>
                                    <TableHead className="font-semibold text-gray-900 py-3 sm:py-4 px-3 sm:px-6 text-xs sm:text-sm">{t('table.headers.mappings')}</TableHead>
                                    <TableHead className="font-semibold text-gray-900 py-3 sm:py-4 px-3 sm:px-6 text-xs sm:text-sm hidden xl:table-cell">{t('table.headers.lastSynced')}</TableHead>
                                    <TableHead className="font-semibold text-gray-900 py-3 sm:py-4 px-3 sm:px-6 text-center text-xs sm:text-sm">{t('table.headers.actions')}</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {approvedTemplates.map((template, index) => {
                                    const mapping = getTemplateMapping(template.id);
                                    return (
                                        <TableRow
                                            key={template.id}
                                            className={`border-b border-gray-100 hover:bg-gray-50/50 transition-colors ${
                                                index === approvedTemplates.length - 1 ? 'border-b-0' : ''
                                            }`}
                                        >
                                            <TableCell className="py-3 sm:py-4 px-3 sm:px-6">
                                                <div className="font-medium text-gray-900 text-xs sm:text-sm break-words">{template.name}</div>
                                            </TableCell>
                                            <TableCell className="py-3 sm:py-4 px-3 sm:px-6 hidden sm:table-cell">
                                                <Badge variant="outline" className="bg-gray-100 text-gray-700 border-gray-200 text-xs">
                                                    {template.language.toUpperCase()}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="py-3 sm:py-4 px-3 sm:px-6 hidden md:table-cell">
                                                {getCategoryBadge(template.category)}
                                            </TableCell>
                                            <TableCell className="py-3 sm:py-4 px-3 sm:px-6 hidden lg:table-cell">
                                                {getStatusBadge(template.status)}
                                            </TableCell>
                                            <TableCell className="py-3 sm:py-4 px-3 sm:px-6">
                                                {getMappingStatus(template.id)}
                                            </TableCell>
                                            <TableCell className="py-3 sm:py-4 px-3 sm:px-6 hidden xl:table-cell">
                                                <div className="text-xs sm:text-sm text-gray-600">
                                                    {lastSyncTime ? formatDate(lastSyncTime.toISOString()) : t('table.never')}
                                                </div>
                                            </TableCell>
                                            <TableCell className="py-3 sm:py-4 px-3 sm:px-6">
                                                <div className="flex items-center justify-center">
                                                    <Button
                                                        size="sm"
                                                        variant="outline"
                                                        onClick={() => handleMapDynamicValues(template)}
                                                        className="flex items-center gap-1 sm:gap-2 px-2 sm:px-4 py-1 sm:py-2 hover:bg-blue-50 hover:border-blue-200 text-xs sm:text-sm"
                                                    >
                                                        <GearSix className="size-3 sm:size-4" />
                                                        <span className="hidden xs:inline text-xs sm:text-sm font-medium">
                                                            {mapping ? t('table.editMappings') : t('table.mapValues')}
                                                        </span>
                                                        <span className="xs:hidden text-xs">
                                                            {mapping ? t('table.editShort') : t('table.mapShort')}
                                                        </span>
                                                    </Button>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>
                    </div>
                </div>
            )}

            {/* Mapping Modal */}
            {selectedTemplate && (
                <WhatsAppTemplateMappingModal
                    isOpen={showMappingModal}
                    onClose={handleCloseMappingModal}
                    template={selectedTemplate}
                    onMappingSaved={handleMappingSaved}
                />
            )}
        </div>
    );
};
