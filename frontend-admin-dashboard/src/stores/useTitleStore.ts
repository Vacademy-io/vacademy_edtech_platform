import { create } from 'zustand';
import { getCachedInstituteBranding } from '@/services/domain-routing';

interface TitleStore {
    globalTitle: string | null;
    globalFavicon: string | null;
    /** The sidebar section the user is on ("All Leads"), shown ahead of the
     *  institute's title so browser tabs on different lists can be told apart. */
    sectionTitle: string | null;
    setGlobalTitle: (title: string | null) => void;
    setSectionTitle: (title: string | null) => void;
    setGlobalFavicon: (faviconUrl: string | null) => void;
    updateTitleFromCache: () => void;
    ensureCorrectTitle: () => void;
    ensureCorrectFavicon: () => void;
}

export const useTitleStore = create<TitleStore>((set, get) => ({
    globalTitle: null,
    globalFavicon: null,
    sectionTitle: null,

    setGlobalTitle: (title: string | null) => {
        set({ globalTitle: title });
        get().ensureCorrectTitle();
    },

    setSectionTitle: (title: string | null) => {
        set({ sectionTitle: title });
        get().ensureCorrectTitle();
    },

    setGlobalFavicon: (faviconUrl: string | null) => {
        set({ globalFavicon: faviconUrl });
        get().ensureCorrectFavicon();
    },

    updateTitleFromCache: () => {
        try {
            const cached = getCachedInstituteBranding();
            const tabText = cached?.tabText;
            const title = tabText && tabText.trim() ? tabText.trim() : 'Admin Dashboard';
            set({ globalTitle: title });
            get().ensureCorrectTitle();

            // Also update favicon from cache
            const faviconUrl = cached?.tabIconUrl;
            if (faviconUrl) {
                set({ globalFavicon: faviconUrl });
                get().ensureCorrectFavicon();
            }
        } catch (error) {
            set({ globalTitle: 'Admin Dashboard' });
            document.title = 'Admin Dashboard';
        }
    },

    ensureCorrectTitle: () => {
        const { globalTitle, sectionTitle } = get();
        const baseTitle = globalTitle || 'Admin Dashboard';
        const finalTitle = sectionTitle ? `${sectionTitle} · ${baseTitle}` : baseTitle;
        if (document.title !== finalTitle) {
            document.title = finalTitle;
        }
    },

    ensureCorrectFavicon: () => {
        const { globalFavicon } = get();
        if (!globalFavicon) return;
        const link = document.querySelector("link[rel='icon']") as HTMLLinkElement | null;
        if (link && link.href !== globalFavicon) {
            link.href = globalFavicon;
        }
    },
}));

declare global {
    interface Window {
        __vacademyFaviconObserverInstalled?: boolean;
    }
}

// Single MutationObserver watches <head> for new favicon links and watches
// each link for href changes. WeakSet de-dupes observe() calls so the same
// <link> is never observed twice when head fires multiple childList mutations.
if (typeof window !== 'undefined' && !window.__vacademyFaviconObserverInstalled) {
    window.__vacademyFaviconObserverInstalled = true;

    const observedLinks = new WeakSet<Element>();

    const observeIfNew = (link: Element, observer: MutationObserver) => {
        if (observedLinks.has(link)) return;
        observedLinks.add(link);
        observer.observe(link, { attributes: true, attributeFilter: ['href'] });
    };

    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            if (mutation.type === 'attributes' && mutation.attributeName === 'href') {
                const target = mutation.target as HTMLLinkElement;
                if (target.rel === 'icon') {
                    useTitleStore.getState().ensureCorrectFavicon();
                }
                continue;
            }

            if (mutation.type === 'childList') {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType !== Node.ELEMENT_NODE) return;
                    const element = node as Element;
                    if (element.tagName === 'LINK' && element.getAttribute('rel') === 'icon') {
                        observeIfNew(element, observer);
                        useTitleStore.getState().ensureCorrectFavicon();
                    }
                });
            }
        }
    });

    observer.observe(document.head, { childList: true });

    document.querySelectorAll("link[rel='icon']").forEach((link) => {
        observeIfNew(link, observer);
    });
}
