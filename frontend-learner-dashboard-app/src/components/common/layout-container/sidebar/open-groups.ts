/**
 * The app frame remounts on every route, so which sidebar groups are open has to
 * live outside it. Not persisted: a reload starts again from the active route.
 */
export const createOpenGroups = () => {
    const open = new Set<string>();
    return {
        /** State for a group as it mounts. A group holding the active route opens. */
        resolve(title: string, hasActiveChild: boolean): boolean {
            if (hasActiveChild) open.add(title);
            return open.has(title);
        },
        set(title: string, isOpen: boolean): void {
            if (isOpen) open.add(title);
            else open.delete(title);
        },
    };
};

export const sidebarOpenGroups = createOpenGroups();
