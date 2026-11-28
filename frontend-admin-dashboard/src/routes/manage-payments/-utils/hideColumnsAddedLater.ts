/**
 * Keeps a newly shipped, off-by-default column off for admins who already saved a column layout.
 *
 * The saved hidden set replaces the defaults outright, so a column added later would otherwise
 * appear switched ON for anyone who had ever touched Manage Column. This adds the new ids to the
 * saved hidden set once, marks it done under `flagKey`, and from then on leaves the choice to the
 * admin. With nothing saved yet it only sets the flag; the defaults already hide the columns.
 *
 * Call it before the prefs hook reads storage (e.g. a `useState` initialiser above it).
 */
export const hideColumnsAddedLater = (
    prefsKey: string,
    addedIds: string[],
    flagKey: string,
    storage: Storage = localStorage
): true => {
    try {
        if (storage.getItem(flagKey)) return true;
        const raw = storage.getItem(prefsKey);
        const saved: unknown = raw ? JSON.parse(raw) : null;
        if (Array.isArray(saved)) {
            const next = new Set(saved.filter((x): x is string => typeof x === 'string'));
            addedIds.forEach((id) => next.add(id));
            storage.setItem(prefsKey, JSON.stringify([...next]));
        }
        storage.setItem(flagKey, '1');
    } catch {
        /* storage blocked or corrupt — the prefs hook falls back to its defaults */
    }
    return true;
};
