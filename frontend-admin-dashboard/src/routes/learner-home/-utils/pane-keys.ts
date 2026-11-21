/** Roving keyboard order for the List / Edit / Preview tabs (WAI-ARIA tabs pattern). */
export const PANES = ['list', 'edit', 'preview'] as const;
export type Pane = (typeof PANES)[number];

/** The pane a key moves to from `current`, or null when the key is not a tab key. */
export function paneForKey(current: Pane, key: string): Pane | null {
    const i = PANES.indexOf(current);
    switch (key) {
        case 'ArrowRight':
            return PANES[(i + 1) % PANES.length]!;
        case 'ArrowLeft':
            return PANES[(i - 1 + PANES.length) % PANES.length]!;
        case 'Home':
            return PANES[0];
        case 'End':
            return PANES[PANES.length - 1]!;
        default:
            return null;
    }
}
