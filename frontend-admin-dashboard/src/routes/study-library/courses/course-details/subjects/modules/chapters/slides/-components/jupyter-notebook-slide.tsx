import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MyButton } from '@/components/design-system/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { BookOpen, ExternalLink, AlertCircle } from 'lucide-react';

import { toast } from 'sonner';

interface NotebookData {
    contentUrl?: string;
    projectName?: string;
    contentBranch?: string;
    notebookLocation?: string;
    activeTab?: string;
    editorType?: string;
    timestamp?: number;
}

interface JupyterNotebookSlideProps {
    notebookData?: NotebookData;
    isEditable: boolean;
    onDataChange?: (newData: NotebookData) => void;
}

export const JupyterNotebookSlide: React.FC<JupyterNotebookSlideProps> = ({
    notebookData = {},
    isEditable,
    onDataChange,
}) => {
    const { t } = useTranslation('studyLibraryJupyterNotebookSlide');
    // Use data from props, not local state
    const [notebookUrl, setNotebookUrl] = useState(notebookData?.contentUrl || '');
    const [projectName, setProjectName] = useState(notebookData?.projectName || '');
    const [showForm, setShowForm] = useState(!notebookData?.contentUrl);

    // Update local state when props change (for different slides)
    React.useEffect(() => {
        setNotebookUrl(notebookData?.contentUrl || '');
        setProjectName(notebookData?.projectName || '');
        setShowForm(!notebookData?.contentUrl);
    }, [notebookData]);

    const validateNotebookUrl = (url: string): boolean => {
        // Basic URL validation
        try {
            new URL(url);
            return true;
        } catch {
            return false;
        }
    };

    const handleSubmit = () => {
        if (!notebookUrl.trim()) {
            toast.error(t('errors.urlRequired'));
            return;
        }

        if (!validateNotebookUrl(notebookUrl)) {
            toast.error(t('errors.urlInvalid'));
            return;
        }

        // Create properly structured data for backend
        const updatedData = {
            ...(notebookData || {}),
            contentUrl: notebookUrl,
            projectName: projectName || 'Jupyter Notebook',
            contentBranch: 'main',
            notebookLocation: 'root',
            activeTab: 'notebook',
            editorType: 'jupyterEditor',
            timestamp: Date.now(),
        };

        // Save to backend via onDataChange
        onDataChange?.(updatedData);
        setShowForm(false);
        toast.success(t('toast.saveSuccess'));
    };

    const handleEdit = () => {
        setShowForm(true);
    };

    if (showForm && isEditable) {
        return (
            <div className="flex h-full items-center justify-center p-6">
                <Card className="w-full max-w-2xl">
                    <CardHeader className="text-center">
                        <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-violet-100">
                            <BookOpen className="size-8 text-violet-600" />
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
                            <Label htmlFor="notebook-url">{t('notebookUrlLabel')}</Label>
                            <Input
                                id="notebook-url"
                                placeholder="https://github.com/user/repo/blob/main/notebook.ipynb"
                                value={notebookUrl}
                                onChange={(e) => setNotebookUrl(e.target.value)}
                                required
                            />
                        </div>

                        <div className="flex gap-3 pt-4">
                            <MyButton
                                buttonType="primary"
                                scale="medium"
                                onClick={handleSubmit}
                                disabled={!notebookUrl.trim()}
                                className="flex-1"
                            >
                                {t('previewNotebook')}
                            </MyButton>
                        </div>
                    </CardContent>
                </Card>
            </div>
        );
    }

    if (!notebookUrl) {
        return (
            <div className="flex h-full items-center justify-center p-6">
                <Card className="w-full max-w-md text-center">
                    <CardContent className="p-6">
                        <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-gray-100">
                            <AlertCircle className="size-8 text-gray-600" />
                        </div>
                        <h3 className="mb-2 text-lg font-semibold">{t('notConfiguredTitle')}</h3>
                        <p className="mb-4 text-gray-600">{t('notConfiguredDescription')}</p>
                        {isEditable && (
                            <MyButton
                                buttonType="primary"
                                scale="medium"
                                onClick={() => setShowForm(true)}
                            >
                                {t('configureNotebook')}
                            </MyButton>
                        )}
                    </CardContent>
                </Card>
            </div>
        );
    }

    return (
        <div className="flex h-full flex-col">
            {/* Header */}
            <div className="flex items-center justify-between border-b bg-white p-2 shadow-sm">
                <div className="flex items-center gap-3">
                    <div className="flex size-8 items-center justify-center rounded-lg bg-violet-100">
                        <BookOpen className="size-4 text-violet-600" />
                    </div>
                    <div>
                        <h3 className="font-semibold">{projectName || t('defaultProjectName')}</h3>
                        <p className="text-xs text-gray-500">{t('notebookLabel')}</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <a
                        href={notebookUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800"
                    >
                        <ExternalLink className="size-4" />
                        {t('open')}
                    </a>
                    {isEditable && (
                        <MyButton buttonType="secondary" scale="small" onClick={handleEdit}>
                            {t('edit')}
                        </MyButton>
                    )}
                </div>
            </div>

            {/* Iframe Content */}
            <div className="relative" style={{ height: '90vh' }}>
                <iframe
                    src={notebookUrl}
                    className="size-full border-0"
                    title={projectName || t('defaultProjectName')}
                    sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                    loading="lazy"
                    onError={() => {
                        toast.error(t('errors.loadFailed'));
                    }}
                />
            </div>
        </div>
    );
};
