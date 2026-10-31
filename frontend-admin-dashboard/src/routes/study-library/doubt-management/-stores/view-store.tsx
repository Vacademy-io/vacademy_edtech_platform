import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type DoubtView = 'inbox' | 'board';
export type DoubtBoardGroupBy = 'assignee' | 'status';

interface DoubtViewStore {
    view: DoubtView;
    setView: (view: DoubtView) => void;
    /** Board columns: one per teacher, or one per workflow status. */
    boardGroupBy: DoubtBoardGroupBy;
    setBoardGroupBy: (groupBy: DoubtBoardGroupBy) => void;
}

/**
 * Inbox (split-pane conversation list) vs Board (assignee Kanban) for Doubt Management.
 * Persisted so an admin who works from the board lands on it next time.
 */
export const useDoubtView = create<DoubtViewStore>()(
    persist(
        (set) => ({
            view: 'inbox',
            setView: (view) => set({ view }),
            boardGroupBy: 'assignee',
            setBoardGroupBy: (boardGroupBy) => set({ boardGroupBy }),
        }),
        { name: 'doubt-management-view' }
    )
);
