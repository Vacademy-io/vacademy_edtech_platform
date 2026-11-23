import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { FolderThumb } from '@/components/common/assessment-folders/FolderThumb';
import { getInstituteId } from '@/constants/helper';
import {
    PAPER_FOLDERS_QUERY_KEY,
    type PaperFolderFilter,
    type QuestionPaperFolder,
    usePaperFolders,
} from '@/services/question-paper-folders';
import { getQuestionPaperDataWithFilters } from '../../-utils/question-paper-services';
import { statusesForTab } from '../../-utils/question-paper-list';
import { PaperFolderViewSwitch, type PaperFolderViewMode } from './PaperFolderBrowser';

const VIEW_STORAGE_KEY = 'questionPaperPickerFolderView';

const readView = (): PaperFolderViewMode => {
    try {
        return localStorage.getItem(VIEW_STORAGE_KEY) === 'list' ? 'list' : 'folders';
    } catch {
        return 'folders';
    }
};

/**
 * "Choose saved paper" dialogs (assessment, homework, assignment, quiz) with folders on:
 * the folder cards first, open one to pick from its papers. Read-only: folders are made
 * and filled on the Questions Banks and Papers page. State is local (the dialog sits on
 * another route), and the list remounts per scope so its tabs, counts and pages reload.
 *
 * No folders yet, or the folders fail to load: the plain list, exactly as before.
 */
export const PaperFolderPicker = ({
    renderList,
}: {
    /** folderFilter undefined = every paper (the list as it was before folders). */
    renderList: (props: { key: string; folderFilter?: PaperFolderFilter }) => React.ReactNode;
}) => {
    const { t } = useTranslation('questionPaperFolders');
    const { data: folders = [], isLoading, isError } = usePaperFolders();
    const [openFolderId, setOpenFolderId] = useState<string | null>(null);
    const [view, setViewState] = useState<PaperFolderViewMode>(readView);
    const setView = (mode: PaperFolderViewMode) => {
        setViewState(mode);
        try {
            localStorage.setItem(VIEW_STORAGE_KEY, mode);
        } catch {
            // Private mode: the choice just isn't remembered.
        }
    };

    const hasFolders = !isError && folders.length > 0;
    const openFolder = openFolderId
        ? folders.find((folder) => folder.id === openFolderId)
        : undefined;
    const foldersView = hasFolders && !openFolder && view === 'folders';

    // Same count (and cache entry) as the page: papers in no folder, All tab.
    const instituteId = getInstituteId();
    const { data: unfiledCount, isError: unfiledCountFailed } = useQuery({
        queryKey: [...PAPER_FOLDERS_QUERY_KEY, 'unfiled-count', instituteId],
        queryFn: async () => {
            const page = await getQuestionPaperDataWithFilters(
                0,
                1,
                instituteId ?? undefined,
                { statuses: statusesForTab('ACTIVE') },
                undefined,
                { unfiled_only: true }
            );
            return (page?.total_elements as number | undefined) ?? 0;
        },
        enabled: foldersView,
        staleTime: 0,
    });
    // Every paper is in a folder: show the folders only. Still loading counts as none, so
    // the list never flashes; a failed count shows it (fail open).
    const showUnfiled = unfiledCountFailed || (unfiledCount ?? 0) > 0;

    // Wait for the folders, or the list would mount flat and then remount.
    if (isLoading) return <DashboardLoader />;
    if (!hasFolders) return renderList({ key: 'all' });

    if (openFolder) {
        return (
            <div className="flex flex-col gap-4">
                <PickerFolderHeader folder={openFolder} onBack={() => setOpenFolderId(null)} />
                {renderList({
                    key: `folder:${openFolder.id}`,
                    folderFilter: { folder_id: openFolder.id },
                })}
            </div>
        );
    }

    if (!foldersView) {
        return (
            <div className="flex flex-col gap-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-caption text-neutral-500">{t('picker.listHint')}</p>
                    <PaperFolderViewSwitch value={view} onChange={setView} />
                </div>
                {renderList({ key: 'list' })}
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-4">
            <section aria-label={t('grid.title')}>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-base font-semibold text-neutral-800">{t('grid.title')}</h2>
                    <PaperFolderViewSwitch value={view} onChange={setView} />
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {folders.map((folder) => (
                        <PickerFolderTile
                            key={folder.id}
                            folder={folder}
                            onOpen={() => setOpenFolderId(folder.id)}
                        />
                    ))}
                </div>
                {showUnfiled ? (
                    <div className="mt-6 flex flex-wrap items-baseline gap-x-2">
                        <h2 className="text-base font-semibold text-neutral-800">
                            {t('grid.unfiledTitle')}
                        </h2>
                        <p className="text-caption text-neutral-500">{t('banner.unfiledHint')}</p>
                    </div>
                ) : null}
            </section>
            {showUnfiled
                ? renderList({ key: 'unfiled', folderFilter: { unfiled_only: true } })
                : null}
        </div>
    );
};

const PickerFolderTile = ({
    folder,
    onOpen,
}: {
    folder: QuestionPaperFolder;
    onOpen: () => void;
}) => {
    const { t } = useTranslation('questionPaperFolders');
    return (
        <button
            type="button"
            onClick={onOpen}
            className="flex min-h-16 items-center gap-3 rounded-xl border border-neutral-200 bg-white p-3 text-start transition-colors hover:border-primary-300 focus-visible:border-primary-400"
        >
            <FolderThumb imageUrl={folder.image_url} className="size-10 rounded-lg" iconSize={20} />
            <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-neutral-800">
                    {folder.name}
                </span>
                <span className="block text-caption text-neutral-500">
                    {t('grid.count', { count: folder.paper_count })}
                </span>
            </span>
        </button>
    );
};

const PickerFolderHeader = ({
    folder,
    onBack,
}: {
    folder: QuestionPaperFolder;
    onBack: () => void;
}) => {
    const { t } = useTranslation('questionPaperFolders');
    return (
        <section className="flex flex-col gap-3 rounded-xl border border-neutral-200 bg-white p-3 sm:flex-row sm:items-center">
            <MyButton
                type="button"
                buttonType="secondary"
                scale="small"
                className="shrink-0 gap-1 self-start sm:self-center"
                onClick={onBack}
            >
                <ArrowLeft size={14} />
                {t('grid.allFolders')}
            </MyButton>
            <div className="flex min-w-0 flex-1 items-center gap-3">
                <FolderThumb
                    imageUrl={folder.image_url}
                    className="size-10 rounded-lg"
                    iconSize={20}
                />
                <div className="min-w-0">
                    <h2 className="truncate text-base font-semibold text-neutral-900">
                        {folder.name}
                    </h2>
                    <p className="truncate text-caption text-neutral-500">
                        {[t('grid.count', { count: folder.paper_count }), folder.description]
                            .filter(Boolean)
                            .join(' · ')}
                    </p>
                </div>
            </div>
        </section>
    );
};
