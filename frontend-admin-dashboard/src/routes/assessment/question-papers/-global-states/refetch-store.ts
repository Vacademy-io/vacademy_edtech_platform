import { create } from 'zustand';

interface RefetchStore {
    handleRefetchData: () => void;
    setHandleRefetchData: (fn: () => void) => void;
    /**
     * Question Papers page only: after a paper is added, jump the list to the
     * All tab, newest first, page 1, no filters — so the new paper is on screen.
     * A no-op until the page's list registers it.
     */
    handleShowNewest: () => void;
    setHandleShowNewest: (fn: () => void) => void;
    /** Id of the paper added most recently in this session, highlighted in the list. */
    justAddedId: string | null;
    setJustAddedId: (id: string | null) => void;
}

export const useRefetchStore = create<RefetchStore>((set) => ({
    handleRefetchData: () => {
        throw new Error('handleRefetchData has not been initialized.');
    },
    setHandleRefetchData: (fn) => set(() => ({ handleRefetchData: fn })),
    handleShowNewest: () => {},
    setHandleShowNewest: (fn) => set(() => ({ handleShowNewest: fn })),
    justAddedId: null,
    setJustAddedId: (id) => set(() => ({ justAddedId: id })),
}));
