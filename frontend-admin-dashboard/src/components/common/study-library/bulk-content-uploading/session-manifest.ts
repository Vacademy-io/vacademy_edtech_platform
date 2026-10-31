// Bulk Content Uploading — crash/close recovery manifest.
//
// Browser File handles don't survive a reload, so resume works by re-selecting
// the same zip: the (name|size|lastModified) fingerprint matches and completed
// items are pre-marked done from this manifest instead of being re-created.

interface ManifestEntry {
    slideId?: string;
    fileId?: string;
}

interface ManifestData {
    updatedAt: number;
    items: Record<string, ManifestEntry>;
    /**
     * Node id → the subject/module/chapter id auto-create made for it. Node ids
     * come from normalized folder paths, so they are stable across re-parses of
     * the same zip — without this a reload mid-run would create duplicates.
     */
    nodes?: Record<string, string>;
}

const KEY_PREFIX = 'bulk-content-uploading:manifest:';
const MAX_MANIFESTS = 3;
const FLUSH_DELAY_MS = 500;

const storageKey = (contextKey: string, fingerprint: string) =>
    `${KEY_PREFIX}${contextKey}|${fingerprint}`;

const pruneOldManifests = () => {
    try {
        const keys: { key: string; updatedAt: number }[] = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (!key?.startsWith(KEY_PREFIX)) continue;
            try {
                const data = JSON.parse(localStorage.getItem(key) || '{}') as ManifestData;
                keys.push({ key, updatedAt: data.updatedAt || 0 });
            } catch {
                keys.push({ key, updatedAt: 0 });
            }
        }
        keys.sort((a, b) => b.updatedAt - a.updatedAt)
            .slice(MAX_MANIFESTS)
            .forEach(({ key }) => localStorage.removeItem(key));
    } catch {
        // localStorage unavailable — resume just won't work; uploads still do.
    }
};

export interface SessionManifest {
    get: (itemKey: string) => ManifestEntry | undefined;
    set: (itemKey: string, entry: ManifestEntry) => void;
    /** Entity id auto-create already made for this node, if any. */
    getNode: (nodeId: string) => string | undefined;
    setNode: (nodeId: string, entityId: string) => void;
    flush: () => void;
    clear: () => void;
}

export const openManifest = (contextKey: string, fingerprint: string): SessionManifest => {
    const key = storageKey(contextKey, fingerprint);
    let data: ManifestData = { updatedAt: Date.now(), items: {} };
    try {
        const stored = localStorage.getItem(key);
        if (stored) data = JSON.parse(stored) as ManifestData;
    } catch {
        // start fresh
    }
    pruneOldManifests();

    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const writeNow = () => {
        flushTimer = null;
        try {
            data.updatedAt = Date.now();
            localStorage.setItem(key, JSON.stringify(data));
        } catch {
            // quota / private mode — non-fatal
        }
    };

    return {
        get: (itemKey) => data.items[itemKey],
        set: (itemKey, entry) => {
            data.items[itemKey] = { ...data.items[itemKey], ...entry };
            if (!flushTimer) flushTimer = setTimeout(writeNow, FLUSH_DELAY_MS);
        },
        // `nodes` is absent in manifests written before auto-create shipped.
        getNode: (nodeId) => data.nodes?.[nodeId],
        setNode: (nodeId, entityId) => {
            data.nodes = { ...data.nodes, [nodeId]: entityId };
            if (!flushTimer) flushTimer = setTimeout(writeNow, FLUSH_DELAY_MS);
        },
        flush: () => {
            if (flushTimer) clearTimeout(flushTimer);
            writeNow();
        },
        clear: () => {
            if (flushTimer) clearTimeout(flushTimer);
            try {
                localStorage.removeItem(key);
            } catch {
                // ignore
            }
        },
    };
};
