import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MyButton } from '@/components/design-system/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Gamepad2, ExternalLink, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';

interface ScratchData {
    projectId?: string;
    projectName?: string;
    scratchUrl?: string;
    timestamp?: number;
}

interface ScratchProjectSlideProps {
    scratchData: ScratchData;
    slideId?: string;
    isEditable: boolean;
    onDataChange?: (newData: ScratchData) => void;
}

export const ScratchProjectSlide: React.FC<ScratchProjectSlideProps> = ({
    scratchData,
    isEditable,
    onDataChange,
}) => {
    const { t } = useTranslation('studyLibraryScratchProjectSlide');
    const [projectId, setProjectId] = useState(scratchData?.projectId || '');
    const [projectName, setProjectName] = useState(scratchData?.projectName || '');
    const [showForm, setShowForm] = useState(!scratchData?.projectId);
    const [embedError, setEmbedError] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);

    // Update local state when props change (for different slides)
    React.useEffect(() => {
        setProjectId(scratchData?.projectId || '');
        setProjectName(scratchData?.projectName || '');
        setShowForm(!scratchData?.projectId);
        setEmbedError(false);
        setIsLoading(true);
        setIsSaving(false);
    }, [scratchData]);

    const validateProjectId = (id: string): boolean => {
        // Scratch project IDs are typically numeric strings
        return /^\d+$/.test(id.trim()) && id.trim().length > 0;
    };

    const extractProjectIdFromUrl = (input: string): string => {
        // Handle full Scratch URLs like https://scratch.mit.edu/projects/123456789/
        const urlMatch = input.match(/scratch\.mit\.edu\/projects\/(\d+)/);
        if (urlMatch && urlMatch[1]) {
            return urlMatch[1];
        }

        // Handle direct project ID input
        return input.trim();
    };

    const handleSubmit = () => {
        const extractedId = extractProjectIdFromUrl(projectId);

        if (!extractedId) {
            toast.error(t('errorEnterIdOrUrl'));
            return;
        }

        if (!validateProjectId(extractedId)) {
            toast.error(t('errorInvalidId'));
            return;
        }

        // Set saving state and hide form immediately to prevent flickering
        setIsSaving(true);
        setShowForm(false);

        // Create properly structured data for backend
        const updatedData: ScratchData = {
            ...scratchData,
            projectId: extractedId,
            projectName: projectName || `Scratch Project ${extractedId}`,
            scratchUrl: `https://scratch.mit.edu/projects/${extractedId}/`,
            timestamp: Date.now(),
        };

        // Save to backend via onDataChange
        onDataChange?.(updatedData);
        toast.success(t('successSaved'));
    };

    const handleEdit = () => {
        setShowForm(true);
    };

    if (showForm && isEditable) {
        return (
            <div className="flex h-full items-center justify-center p-6">
                <Card className="w-full max-w-2xl">
                    <CardHeader className="text-center">
                        <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-orange-100">
                            <Gamepad2 className="size-8 text-primary-500" />
                        </div>
                        <CardTitle className="text-2xl">{t('configureTitle')}</CardTitle>
                        <CardDescription>{t('configureDescription')}</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        <div className="space-y-2">
                            <Label htmlFor="project-name">{t('projectNameLabel')}</Label>
                            <Input
                                id="project-name"
                                placeholder={t('projectNamePlaceholder')}
                                value={projectName}
                                onChange={(e) => setProjectName(e.target.value)}
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="project-id">{t('projectIdLabel')}</Label>
                            <Input
                                id="project-id"
                                placeholder={t('projectIdPlaceholder')}
                                value={projectId}
                                onChange={(e) => setProjectId(e.target.value)}
                                required
                            />
                            <p className="text-sm text-gray-500">{t('projectIdHint')}</p>
                        </div>

                        <div className="flex gap-3 pt-4">
                            <MyButton
                                buttonType="primary"
                                scale="medium"
                                onClick={handleSubmit}
                                disabled={!projectId.trim() || isSaving}
                                className="flex-1"
                            >
                                {isSaving ? t('loadingEllipsis') : t('loadProjectButton')}
                            </MyButton>
                        </div>
                    </CardContent>
                </Card>
            </div>
        );
    }

    if (!scratchData?.projectId && !isSaving) {
        return (
            <div className="flex h-full items-center justify-center p-6">
                <Card className="w-full max-w-md text-center">
                    <CardContent className="p-6">
                        <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-gray-100">
                            <AlertCircle className="size-8 text-gray-600" />
                        </div>
                        <h3 className="mb-2 text-lg font-semibold">{t('noProjectTitle')}</h3>
                        <p className="mb-4 text-gray-600">{t('noProjectSubtitle')}</p>
                        {isEditable && (
                            <MyButton
                                buttonType="primary"
                                scale="medium"
                                onClick={() => setShowForm(true)}
                            >
                                {t('configureProjectButton')}
                            </MyButton>
                        )}
                    </CardContent>
                </Card>
            </div>
        );
    }

    // Show loading state while saving
    if (isSaving) {
        return (
            <div className="flex h-full items-center justify-center p-6">
                <Card className="w-full max-w-md text-center">
                    <CardContent className="p-6">
                        <div className="mx-auto mb-4 size-8 animate-spin rounded-full border-4 border-orange-200 border-t-orange-600"></div>
                        <h3 className="mb-2 text-lg font-semibold">{t('loadingProjectTitle')}</h3>
                        <p className="text-gray-600">{t('loadingProjectSubtitle')}</p>
                    </CardContent>
                </Card>
            </div>
        );
    }

    const embedUrl = `https://scratch.mit.edu/projects/${scratchData?.projectId}/embed`;
    const editorUrl = `https://scratch.mit.edu/projects/${scratchData?.projectId}/editor/`;

    const handleIframeLoad = () => {
        setIsLoading(false);
    };

    const handleIframeError = () => {
        setIsLoading(false);
        setEmbedError(true);
        toast.error(t('errorEmbedFailed'));
    };

    return (
        <div className="flex h-full flex-col">
            {/* Header */}
            <div className="flex items-center justify-between border-b bg-white p-2 shadow-sm">
                <div className="flex items-center gap-3">
                    <div className="flex size-8 items-center justify-center rounded-lg bg-orange-100">
                        <Gamepad2 className="size-4 text-orange-600" />
                    </div>
                    <div>
                        <h3 className="font-semibold">
                            {scratchData?.projectName || t('scratchProjectFallback')}
                        </h3>
                        <p className="text-xs text-gray-500">{t('scratchLabel')}</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <a
                        href={embedUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800"
                    >
                        <ExternalLink className="size-4" />
                        {t('viewProject')}
                    </a>
                    <a
                        href={editorUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-sm text-green-600 hover:text-green-800"
                    >
                        <Gamepad2 className="size-4" />
                        {t('seeInside')}
                    </a>
                    {isEditable && (
                        <MyButton buttonType="secondary" scale="small" onClick={handleEdit}>
                            {t('edit')}
                        </MyButton>
                    )}
                </div>
            </div>

            {/* Embedded Scratch Project */}
            <div className="relative flex-1" style={{ minHeight: '400px' }}>
                {isLoading && (
                    <div className="absolute inset-0 flex items-center justify-center bg-gray-50">
                        <div className="text-center">
                            <div className="mx-auto mb-2 size-8 animate-spin rounded-full border-4 border-orange-200 border-t-orange-600"></div>
                            <p className="text-sm text-gray-600">{t('loadingProjectInline')}</p>
                        </div>
                    </div>
                )}

                {embedError ? (
                    <div className="flex h-full items-center justify-center bg-gray-50">
                        <Card className="mx-4 w-full max-w-md text-center">
                            <CardContent className="p-6">
                                <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-red-100">
                                    <AlertCircle className="size-8 text-red-600" />
                                </div>
                                <h3 className="mb-2 text-lg font-semibold text-red-900">
                                    {t('embedNotAvailableTitle')}
                                </h3>
                                <p className="mb-4 text-gray-600">
                                    {t('embedNotAvailableSubtitle')}
                                </p>
                                <div className="space-y-2">
                                    <div className="flex gap-2">
                                        <a
                                            href={embedUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-orange-600 px-4 py-2 text-white hover:bg-orange-700"
                                        >
                                            <ExternalLink className="size-4" />
                                            {t('viewProjectDash')}
                                        </a>
                                        <a
                                            href={editorUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-white hover:bg-green-700"
                                        >
                                            <Gamepad2 className="size-4" />
                                            {t('seeInside')}
                                        </a>
                                    </div>
                                    <p className="text-xs text-gray-500">
                                        {t('projectIdValue', {
                                            id: scratchData.projectId,
                                        })}
                                    </p>
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                ) : (
                    <iframe
                        src={embedUrl}
                        className="size-full border-0 bg-red-400"
                        title={scratchData.projectName || t('scratchProjectFallback')}
                        allowFullScreen
                        allow="autoplay"
                        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                        onLoad={handleIframeLoad}
                        onError={handleIframeError}
                        style={{ display: isLoading ? 'none' : 'block' }}
                    />
                )}
            </div>
        </div>
    );
};
