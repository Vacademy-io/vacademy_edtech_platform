import {
    ExportSettingsProvider,
    useExportSettings,
} from '@/components/common/export-offline/contexts/export-settings-context';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Gear, Trash, Upload } from '@phosphor-icons/react';
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { ExportHandlerQuestionPaperAI } from './ExportHandlerQuestionPaperAI';
import { PaperSetQuestionsAI } from './PaperSetQuestionsAI';
import { convertQuestionsToExportSchema } from '@/routes/assessment/question-papers/-utils/helper';
import { MyButton } from '@/components/design-system/button';
import { ExportQuestionPaperSettingsDialogAI } from './export-question-paper-dialog-ai/export-question-paper-setting-dialog-ai';
import { useTranslation } from 'react-i18next';

const ExportQuestionPaperAI = ({ responseQuestionsData }: { responseQuestionsData: any }) => {
    const { t } = useTranslation('aiCenterExportQuestionPaperAI');
    return (
        <Dialog>
            <DialogTrigger>
                <MyButton
                    type="button"
                    scale="medium"
                    buttonType="secondary"
                    layoutVariant="default"
                    className="mr-4 text-sm"
                >
                    {t('exportPdf')}
                </MyButton>
            </DialogTrigger>
            <DialogContent className="no-scrollbar !m-0 h-full !w-full !max-w-full !gap-0 overflow-y-auto !rounded-none !p-0">
                <ExportSettingsProvider>
                    <PreviewWithSettings responseQuestionsData={responseQuestionsData} />
                </ExportSettingsProvider>
            </DialogContent>
        </Dialog>
    );
};

function PreviewWithSettings({ responseQuestionsData }: { responseQuestionsData: any }) {
    const { t } = useTranslation('aiCenterExportQuestionPaperAI');
    // @ts-expect-error : Object is possibly 'undefined'
    const convertedQuestions: Question[] = convertQuestionsToExportSchema(responseQuestionsData);
    const [showSettings, setShowSettings] = useState(false);
    const { settings, updateSettings } = useExportSettings();

    // Determine padding based on settings
    const getPadding = () => {
        switch (settings.pagePadding) {
            case 'low':
                return '10mm';
            case 'high':
                return '30mm';
            default:
                return '20mm'; // medium
        }
    };

    const handleLetterheadUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onloadend = () => {
                const imageDataUrl = reader.result as string;
                updateSettings({
                    customLetterheadImage: imageDataUrl,
                });
            };
            reader.readAsDataURL(file);
        }
    };

    const handleDeleteLetterhead = () => {
        updateSettings({
            customLetterheadImage: undefined,
        });
    };

    return (
        <div className="min-h-screen w-full bg-slate-50/50" style={{ boxSizing: 'border-box' }}>
            <div className="no-print sticky top-0 z-10 border-b bg-white">
                <div className="flex items-center justify-between p-4">
                    <Button
                        variant="outline"
                        onClick={() => setShowSettings(true)}
                        className="gap-2"
                    >
                        <Gear className="size-4" />
                        {t('exportSettings')}
                    </Button>
                    <div className="flex items-center gap-4">
                        <input
                            type="file"
                            id="letterhead-upload"
                            accept="image/*"
                            className="hidden"
                            onChange={handleLetterheadUpload}
                        />
                        {settings.showInstitutionLetterhead && (
                            <div className="flex items-center gap-2">
                                <DialogClose>
                                    <Button variant="outline" className="mr-2">
                                        {t('close')}
                                    </Button>
                                </DialogClose>
                                <Button
                                    variant="outline"
                                    onClick={() =>
                                        document.getElementById('letterhead-upload')?.click()
                                    }
                                >
                                    <Upload />
                                    {t('letterhead')}
                                </Button>
                                {settings.customLetterheadImage && (
                                    <Button
                                        variant="destructive"
                                        size="icon"
                                        onClick={handleDeleteLetterhead}
                                        title={t('deleteLetterhead')}
                                    >
                                        <Trash className="size-4" />
                                    </Button>
                                )}
                            </div>
                        )}
                        <ExportHandlerQuestionPaperAI
                            questionsData={convertedQuestions}
                            settings={settings}
                        />
                    </div>
                </div>
            </div>

            {showSettings && (
                <ExportQuestionPaperSettingsDialogAI
                    open={showSettings}
                    onOpenChange={setShowSettings}
                    questionsData={convertedQuestions}
                />
            )}

            <div className="container mx-auto py-4">
                <PaperSetQuestionsAI questionsData={convertedQuestions} settings={settings} />
            </div>
        </div>
    );
}

export default ExportQuestionPaperAI;
