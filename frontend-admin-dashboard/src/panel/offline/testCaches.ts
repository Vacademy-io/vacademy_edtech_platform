/** Test only: an in-memory Cache API with a switch to refuse writes. */
export interface FakeCaches {
    store: Map<string, Map<string, string>>;
    refusePuts: number;
    puts: number;
}

export function installFakeCaches(): FakeCaches {
    const state: FakeCaches = { store: new Map(), refusePuts: 0, puts: 0 };
    const keyOf = (request: string) => request;
    const open = async (name: string) => {
        let entries = state.store.get(name);
        if (!entries) {
            entries = new Map();
            state.store.set(name, entries);
        }
        const bucket = entries;
        return {
            match: async (request: string) => {
                const body = bucket.get(keyOf(request));
                return body === undefined ? undefined : new Response(body);
            },
            put: async (request: string, response: Response) => {
                state.puts += 1;
                if (state.refusePuts > 0) {
                    state.refusePuts -= 1;
                    const error = new Error('full');
                    error.name = 'QuotaExceededError';
                    throw error;
                }
                bucket.set(keyOf(request), await response.text());
            },
            delete: async (request: string | { url: string }) =>
                bucket.delete(
                    typeof request === 'string' ? request : new URL(request.url).pathname
                ),
            keys: async () =>
                Array.from(bucket.keys()).map((url) => ({ url: `http://localhost${url}` })),
        };
    };
    Object.defineProperty(window, 'caches', {
        configurable: true,
        value: {
            open,
            keys: async () => Array.from(state.store.keys()),
            delete: async (name: string) => state.store.delete(name),
        },
    });
    return state;
}
