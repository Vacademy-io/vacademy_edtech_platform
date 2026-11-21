/**
 * Test setup only. Newer Node versions define their own localStorage global, which
 * hides the one from the DOM environment; give every test file a plain in-memory one.
 */
const items = new Map<string, string>();

const memoryStorage: Storage = {
    get length() {
        return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => Array.from(items.keys())[index] ?? null,
    removeItem: (key) => {
        items.delete(key);
    },
    setItem: (key, value) => {
        items.set(key, String(value));
    },
};

Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage, configurable: true });
if (typeof window !== 'undefined' && window.localStorage !== memoryStorage) {
    Object.defineProperty(window, 'localStorage', { value: memoryStorage, configurable: true });
}
