/** Web storage can throw or be empty in private modes. Nothing here is allowed to break the page. */
const memory = new Map<string, string>();

function read(store: () => Storage, key: string): string | null {
    try {
        const value = store().getItem(key);
        if (value !== null) return value;
    } catch {
        // Falls through to memory.
    }
    return memory.get(key) ?? null;
}

function write(store: () => Storage, key: string, value: string): void {
    memory.set(key, value);
    try {
        store().setItem(key, value);
    } catch {
        // Memory holds it for this page load.
    }
}

function remove(store: () => Storage, key: string): void {
    memory.delete(key);
    try {
        store().removeItem(key);
    } catch {
        // Nothing to do.
    }
}

const session = () => window.sessionStorage;
const local = () => window.localStorage;

function parse<T>(raw: string | null): T | null {
    if (!raw) return null;
    try {
        return JSON.parse(raw) as T;
    } catch {
        return null;
    }
}

export const readSessionJson = <T>(key: string): T | null => parse<T>(read(session, key));
export const writeSessionJson = (key: string, value: unknown): void =>
    write(session, key, JSON.stringify(value));
export const removeSession = (key: string): void => remove(session, key);

export const readLocalJson = <T>(key: string): T | null => parse<T>(read(local, key));
export const writeLocalJson = (key: string, value: unknown): void =>
    write(local, key, JSON.stringify(value));
export const removeLocal = (key: string): void => remove(local, key);
export const readLocalString = (key: string): string | null => read(local, key);
export const writeLocalString = (key: string, value: string): void => write(local, key, value);
