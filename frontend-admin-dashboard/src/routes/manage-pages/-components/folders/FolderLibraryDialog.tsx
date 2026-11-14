import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useFolderLibraryStore } from '../../-stores/folder-library-store';
import { FolderLibrariesList } from './FolderLibrariesList';
import { FolderLibraryManager } from './FolderLibraryManager';

/**
 * The whole folder-library workflow inside the Website Builder. Mounted by
 * the sites list and by the site editor; opened from the toolbar Folders
 * button or from a Folder Browser section's property panel.
 */
export const FolderLibraryDialog = () => {
    const { isOpen, libraryId, folderId, onLibraryCreated, open, showList, close } = useFolderLibraryStore();

    return (
        <Dialog open={isOpen} onOpenChange={(o) => !o && close()}>
            <DialogContent
                className="flex h-dialog-tall w-dialog-xl flex-col gap-0 overflow-hidden p-0"
                onInteractOutside={(e) => e.preventDefault()}
                aria-describedby={undefined}
            >
                <DialogTitle className="sr-only">Folder libraries</DialogTitle>
                <div className="min-h-0 flex-1 overflow-y-auto bg-neutral-50">
                    {libraryId ? (
                        <FolderLibraryManager
                            key={libraryId}
                            libraryId={libraryId}
                            initialFolderId={folderId}
                            onBack={showList}
                        />
                    ) : (
                        <FolderLibrariesList
                            onOpenLibrary={(id) => open(id)}
                            onLibraryCreated={onLibraryCreated}
                        />
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
};
