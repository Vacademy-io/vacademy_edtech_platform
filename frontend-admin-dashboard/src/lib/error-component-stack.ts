/**
 * React component stacks for errors caught by the router's error boundaries.
 *
 * TanStack Router renders errorComponent with only `{ error, reset }`; React's
 * componentStack reaches `onCatch` alone. It is parked here, keyed by the error
 * object, so the "Report Issue" dialog on the error page can include it — the
 * JS stack says which line threw, the component stack says which component it
 * was rendering.
 */
const componentStacks = new WeakMap<object, string>();

export function rememberComponentStack(
    error: unknown,
    info: { componentStack?: string | null }
): void {
    // Runs inside React's componentDidCatch — it must never throw itself.
    if (error && typeof error === 'object' && info?.componentStack) {
        componentStacks.set(error, info.componentStack);
    }
}

export function getComponentStack(error: unknown): string | undefined {
    return error && typeof error === 'object' ? componentStacks.get(error) : undefined;
}
