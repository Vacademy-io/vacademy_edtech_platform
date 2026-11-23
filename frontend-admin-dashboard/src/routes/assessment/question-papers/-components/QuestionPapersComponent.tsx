import { Helmet } from 'react-helmet';
import { QuestionPapersPageHeader } from './QuestionPapersPageHeader';
import { AddQuestionPaperFlow } from './AddQuestionPaperFlow';
import { QuestionPapersTabs } from './QuestionPapersTabs';
import { useEffect, useState } from 'react';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { useTranslation } from 'react-i18next';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { useQuestionPaperFoldersEnabled } from '@/services/question-paper-folders';
import { PaperFolderWorkspace } from './folders/PaperFolderWorkspace';
import { usePendingPaperFolderPrompt } from '../-global-states/pending-paper-folder-prompt';

export function QuestionPapersComponent({ folderKey = 'all' }: { folderKey?: string }) {
    const { t } = useTranslation('assessmentQuestionPapersComponent');
    const { setNavHeading } = useNavHeadingStore();
    const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
    // Settings → Assessment Settings → Question paper folders (off by default).
    const foldersEnabled = useQuestionPaperFoldersEnabled();

    useEffect(() => {
        setNavHeading(<h1 className="text-lg">{t('heading')}</h1>);
    }, []);

    // Folders off: drop the "pick a folder" request a new paper leaves behind.
    const pendingPrompt = usePendingPaperFolderPrompt((st) => st.pending);
    useEffect(() => {
        if (foldersEnabled === false && pendingPrompt) {
            usePendingPaperFolderPrompt.getState().setPending(null);
        }
    }, [foldersEnabled, pendingPrompt]);

    return (
        <>
            <Helmet>
                <title>{t('pageTitle')}</title>
                <meta name="description" content={t('pageDescription')} />
            </Helmet>
            <div className="flex flex-col gap-6">
                <QuestionPapersPageHeader />
                {foldersEnabled === undefined ? (
                    // Wait for the setting, or the list would mount flat and then remount.
                    <DashboardLoader />
                ) : foldersEnabled ? (
                    <PaperFolderWorkspace
                        folderKey={folderKey}
                        renderList={({ key, folderFilter }) => (
                            <QuestionPapersTabs
                                key={key}
                                isAssessment={false}
                                currentQuestionIndex={currentQuestionIndex}
                                setCurrentQuestionIndex={setCurrentQuestionIndex}
                                folderFilter={folderFilter}
                            />
                        )}
                    />
                ) : (
                    <QuestionPapersTabs
                        isAssessment={false}
                        currentQuestionIndex={currentQuestionIndex}
                        setCurrentQuestionIndex={setCurrentQuestionIndex}
                    />
                )}
            </div>
            <AddQuestionPaperFlow
                currentQuestionIndex={currentQuestionIndex}
                setCurrentQuestionIndex={setCurrentQuestionIndex}
            />
        </>
    );
}
