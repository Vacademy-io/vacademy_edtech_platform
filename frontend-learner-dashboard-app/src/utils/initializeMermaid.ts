// mermaid is ~1.3 MB compressed. A static import made it a preloaded
// dependency of the app entry, so every page (ad landing pages included)
// downloaded it before first paint. Load it only when a diagram renders.
type Mermaid = typeof import('mermaid').default;

let mermaidReady: Promise<Mermaid> | null = null;

/** Loads mermaid once, initializes it once, and resolves with the instance. */
export const initializeMermaid = (): Promise<Mermaid> => {
    if (mermaidReady) return mermaidReady;
    mermaidReady = import('mermaid').then(({ default: mermaid }) => {
        mermaid.initialize({
            startOnLoad: false,
            theme: 'default',
            securityLevel: 'loose',
            suppressErrorRendering: true,
            fontFamily: 'inherit',
            flowchart: {
                useMaxWidth: true,
                htmlLabels: true,
                curve: 'basis',
            },
            sequence: {
                useMaxWidth: true,
                actorMargin: 50,
                boxMargin: 10,
                boxTextMargin: 5,
                noteMargin: 10,
                messageMargin: 35,
            },
            gantt: {
                useMaxWidth: true,
                barHeight: 20,
                barGap: 4,
                topPadding: 50,
                leftPadding: 75,
                gridLineStartPadding: 35,
                fontSize: 11,
            },
        });
        return mermaid;
    });
    // A failed chunk fetch must not stick: let the next diagram retry.
    mermaidReady.catch(() => {
        mermaidReady = null;
    });
    return mermaidReady;
};

