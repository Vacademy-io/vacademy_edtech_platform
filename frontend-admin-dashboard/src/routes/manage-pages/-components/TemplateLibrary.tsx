import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useEditorStore } from '../-stores/editor-store';
import { PAGE_TEMPLATES, PageTemplate, applyPageTemplate, applySectionTemplate } from '../-utils/page-templates';
import { Button } from '@/components/ui/button';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { FileText, Stack } from '@phosphor-icons/react';

type TemplateCategory = 'page' | 'section';

export const TemplateLibrary = () => {
    const { t: tTemplates } = useTranslation('managePagesComponentTemplates');
    const { config, selectedPageId, updateConfig } = useEditorStore();
    const [activeCategory, setActiveCategory] = useState<TemplateCategory>('page');
    const [pendingTemplate, setPendingTemplate] = useState<PageTemplate | null>(null);

    const filteredTemplates = PAGE_TEMPLATES.filter((t) => t.category === activeCategory);

    const applyTemplate = (template: PageTemplate) => {
        if (!config || !selectedPageId) return;

        if (template.applyLayout) {
            // Site chrome (header / footer): merged onto the current layout, pages untouched.
            const layout = template.applyLayout(config.globalSettings?.layout, tTemplates);
            updateConfig({ ...config, globalSettings: { ...config.globalSettings, layout } });
            setPendingTemplate(null);
            return;
        }

        const newPages = config.pages.map((page) => {
            if (page.id !== selectedPageId) return page;
            return template.category === 'page'
                ? applyPageTemplate(page, template, tTemplates)
                : applySectionTemplate(page, template, tTemplates);
        });

        updateConfig({ ...config, pages: newPages });
        setPendingTemplate(null);
    };

    const handleTemplateClick = (template: PageTemplate) => {
        if (!selectedPageId) return;
        if (template.category === 'page' || template.applyLayout) {
            // Warn before replacing all components, or the header / footer of every page
            setPendingTemplate(template);
        } else {
            // Sections just insert — no warning needed
            applyTemplate(template);
        }
    };

    return (
        <div className="flex h-full flex-col">
            {/* Category tabs */}
            <div className="flex border-b">
                <button
                    onClick={() => setActiveCategory('page')}
                    className={`flex flex-1 items-center justify-center gap-1.5 py-2 text-xs font-medium transition-colors ${
                        activeCategory === 'page'
                            ? 'border-b-2 border-blue-500 text-blue-600'
                            : 'text-gray-500 hover:text-gray-700'
                    }`}
                >
                    <FileText className="size-3.5" />
                    Pages
                </button>
                <button
                    onClick={() => setActiveCategory('section')}
                    className={`flex flex-1 items-center justify-center gap-1.5 py-2 text-xs font-medium transition-colors ${
                        activeCategory === 'section'
                            ? 'border-b-2 border-blue-500 text-blue-600'
                            : 'text-gray-500 hover:text-gray-700'
                    }`}
                >
                    <Stack className="size-3.5" />
                    Sections
                </button>
            </div>

            {/* Template list */}
            <div className="flex flex-col gap-2 overflow-y-auto p-3">
                {!selectedPageId && (
                    <p className="text-center text-xs text-gray-400 py-4">
                        Select a page first to apply templates
                    </p>
                )}

                {selectedPageId && filteredTemplates.map((template) => (
                    <button
                        key={template.id}
                        onClick={() => handleTemplateClick(template)}
                        className="flex flex-col items-start gap-1 rounded border border-gray-200 bg-white p-3 text-left transition-colors hover:border-blue-300 hover:bg-blue-50"
                    >
                        <span className="text-sm font-medium text-gray-800">{template.name}</span>
                        <span className="text-xs text-gray-500">{template.description}</span>
                        <span className="mt-1 rounded bg-gray-100 px-2 py-0.5 text-2xs font-medium text-gray-500 uppercase tracking-wide">
                            {template.applyLayout
                                ? 'Sets header & footer'
                                : template.category === 'page'
                                  ? 'Replaces page'
                                  : 'Inserts section'}
                        </span>
                    </button>
                ))}
            </div>

            {/* Confirmation dialog for page templates (they replace all components) and site-chrome ones */}
            <AlertDialog open={!!pendingTemplate} onOpenChange={() => setPendingTemplate(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Apply "{pendingTemplate?.name}" template?</AlertDialogTitle>
                        <AlertDialogDescription>
                            {pendingTemplate?.applyLayout
                                ? 'This changes the header and footer on every page of the site. Your own text, links and logo are kept. This action can be undone with Ctrl+Z.'
                                : 'This will replace ALL existing components on the current page with the template components. This action can be undone with Ctrl+Z.'}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => pendingTemplate && applyTemplate(pendingTemplate)}>
                            Apply Template
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};
