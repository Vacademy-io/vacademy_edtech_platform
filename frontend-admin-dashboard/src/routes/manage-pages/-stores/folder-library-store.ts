import { create } from 'zustand';

/**
 * Folder libraries are managed inside the Website Builder (a full-screen
 * dialog over the sites list or the site editor), like blog posts.
 * `libraryId` picks the face: null = the library list, else that library's
 * folder manager, opened at `folderId` (null = its top level).
 */
interface FolderLibraryState {
    isOpen: boolean;
    libraryId: string | null;
    folderId: string | null;
    /** Set when opened from a section, so a library created here is wired straight into it. */
    onLibraryCreated: ((libraryId: string, name: string) => void) | null;
    open: (libraryId?: string | null, folderId?: string | null) => void;
    openForSection: (libraryId: string | null, onLibraryCreated: (libraryId: string, name: string) => void) => void;
    showList: () => void;
    close: () => void;
}

export const useFolderLibraryStore = create<FolderLibraryState>((set) => ({
    isOpen: false,
    libraryId: null,
    folderId: null,
    onLibraryCreated: null,
    open: (libraryId = null, folderId = null) =>
        set({ isOpen: true, libraryId, folderId, onLibraryCreated: null }),
    openForSection: (libraryId, onLibraryCreated) =>
        set({ isOpen: true, libraryId, folderId: null, onLibraryCreated }),
    showList: () => set({ libraryId: null, folderId: null }),
    close: () => set({ isOpen: false, libraryId: null, folderId: null, onLibraryCreated: null }),
}));
