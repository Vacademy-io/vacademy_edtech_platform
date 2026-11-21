import { create } from 'zustand';
import { CatalogueConfig, Page, Component, GlobalSettings } from '../-types/editor-types';
import { mergeTranslations } from '../-utils/catalogue-i18n';
import { renamePageInConfig } from '../-utils/rename-page';

const MAX_HISTORY_LENGTH = 50;

/**
 * One edit made while the builder is in another language (see
 * -hooks/use-localized-editing.ts): the change to the shared base config plus
 * the dictionary entries for `locale`, committed together so a single undo
 * reverts both.
 */
export interface LocalizedEditCommit {
    locale: string;
    /** source text → translation ('' removes the entry), merged with mergeTranslations. */
    translations?: Record<string, string>;
    /** A component's base change, applied exactly like updateComponent (shallow merge). */
    component?: { pageId: string; componentId: string; updates: Partial<Component> };
    /** Top-level globalSettings keys to replace (shallow merge), e.g. { layout }. */
    globalSettings?: Partial<GlobalSettings>;
    /** A page's full replacement seo. */
    pageSeo?: { pageId: string; seo: Page['seo'] };
}

interface EditorState {
    config: CatalogueConfig | null;
    originalConfig: CatalogueConfig | null;

    // History for undo/redo
    history: CatalogueConfig[];
    historyIndex: number;

    selectedPageId: string | null;
    selectedComponentId: string | null;
    selectedGlobalSettings: boolean;
    selectedGlobalLayout: 'header' | 'footer' | null;
    activeTab: 'visual' | 'json';
    previewViewport: 'desktop' | 'tablet' | 'mobile';
    clipboard: Component | null;
    /**
     * UI only: the site language being edited, null = the base language.
     * Deliberately outside `config`, so it is never saved, never part of the
     * undo history and never marks the site dirty.
     */
    editingLocale: string | null;

    // Actions
    setConfig: (config: CatalogueConfig) => void;
    selectPage: (pageId: string) => void;
    selectComponent: (componentId: string | null) => void;
    selectGlobalSettings: () => void;
    selectGlobalLayout: (section: 'header' | 'footer') => void;
    setViewport: (viewport: 'desktop' | 'tablet' | 'mobile') => void;
    setActiveTab: (tab: 'visual' | 'json') => void;
    setEditingLocale: (locale: string | null) => void;

    updateConfig: (newConfig: CatalogueConfig) => void;
    /** Base change + dictionary entries in ONE set and ONE history entry. */
    commitLocalizedEdit: (edit: LocalizedEditCommit) => void;
    /**
     * Replaces the config of the edit just made, without a new undo step: a
     * follow-up that belongs to it (e.g. copying it to a sibling section), so
     * one Undo reverts both.
     */
    amendLastEdit: (newConfig: CatalogueConfig) => void;
    updateComponent: (pageId: string, componentId: string, updates: Partial<Component>) => void;
    updateGlobalSettings: (updates: any) => void;
    reorderComponents: (pageId: string, newComponents: Component[]) => void;
    addComponent: (pageId: string, component: Component) => void;
    deleteComponent: (pageId: string, componentId: string) => void;
    duplicateComponent: (pageId: string, componentId: string) => void;
    addPage: (page: Page) => void;
    deletePage: (pageId: string) => void;
    duplicatePage: (pageId: string) => void;
    /** New title and slug; links to the old slug follow it. */
    renamePage: (pageId: string, title: string, route: string) => void;
    updatePageSeo: (pageId: string, seo: Page['seo']) => void;
    updatePageBackgroundColor: (pageId: string, color: string) => void;
    setPageHideSiteChrome: (pageId: string, hide: boolean) => void;

    // Clipboard
    copyComponent: (pageId: string, componentId: string) => void;
    pasteComponent: (pageId: string) => void;

    // Layout slot actions
    addToSlot: (pageId: string, layoutId: string, slotIndex: number, component: Component) => void;
    reorderSlot: (pageId: string, layoutId: string, slotIndex: number, newComponents: Component[]) => void;
    deleteFromSlot: (pageId: string, layoutId: string, slotIndex: number, componentId: string) => void;

    // Undo/Redo
    undo: () => void;
    redo: () => void;
    canUndo: () => boolean;
    canRedo: () => boolean;
}

// ── Recursive tree helpers ───────────────────────────────────────────────────
// These walk the full component tree including nested slots inside layout
// components, so that updateComponent / deleteComponent work at any depth.

/** Regenerate all component IDs inside a deep-cloned layout's slots so that
 *  a duplicate layout doesn't share IDs with the original. */
function regenerateSlotIds(component: Component): Component {
    if (!Array.isArray(component.props?.slots)) return component;
    return {
        ...component,
        props: {
            ...component.props,
            slots: (component.props.slots as Component[][]).map((slot) =>
                slot.map((child) => ({
                    ...regenerateSlotIds(child),
                    id: `${child.type}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                }))
            ),
        },
    };
}

function mapComponents(components: Component[], fn: (c: Component) => Component): Component[] {
    return components.map((comp) => {
        const updated = fn(comp);
        if (Array.isArray(updated.props?.slots)) {
            return {
                ...updated,
                props: {
                    ...updated.props,
                    slots: (updated.props.slots as Component[][]).map((slot) =>
                        mapComponents(slot, fn)
                    ),
                },
            };
        }
        return updated;
    });
}

function filterComponents(components: Component[], predicate: (c: Component) => boolean): Component[] {
    return components
        .filter(predicate)
        .map((comp) => {
            if (Array.isArray(comp.props?.slots)) {
                return {
                    ...comp,
                    props: {
                        ...comp.props,
                        slots: (comp.props.slots as Component[][]).map((slot) =>
                            filterComponents(slot, predicate)
                        ),
                    },
                };
            }
            return comp;
        });
}
// ─────────────────────────────────────────────────────────────────────────────

// Helper to push config to history
const pushToHistory = (state: EditorState, newConfig: CatalogueConfig): Partial<EditorState> => {
    // Slice history to current index (discard redo stack on new change)
    const newHistory = [
        ...state.history.slice(0, state.historyIndex + 1),
        JSON.parse(JSON.stringify(newConfig)),
    ];
    // Limit history length
    const trimmedHistory =
        newHistory.length > MAX_HISTORY_LENGTH
            ? newHistory.slice(newHistory.length - MAX_HISTORY_LENGTH)
            : newHistory;
    return {
        config: newConfig,
        history: trimmedHistory,
        historyIndex: trimmedHistory.length - 1,
    };
};

export const useEditorStore = create<EditorState>((set, get) => ({
    config: null,
    originalConfig: null,
    history: [],
    historyIndex: -1,
    selectedPageId: null,
    selectedComponentId: null,
    selectedGlobalSettings: false,
    selectedGlobalLayout: null,
    activeTab: 'visual',
    previewViewport: 'desktop',
    clipboard: null,
    editingLocale: null,

    setConfig: (config) =>
        set({
            config,
            originalConfig: JSON.parse(JSON.stringify(config)),
            history: [JSON.parse(JSON.stringify(config))],
            historyIndex: 0,
            selectedPageId: config.pages[0]?.id || null,
            selectedGlobalSettings: false,
            selectedGlobalLayout: null,
            // A freshly loaded site always opens in its base language.
            editingLocale: null,
        }),

    selectPage: (id) =>
        set({ selectedPageId: id, selectedComponentId: null, selectedGlobalSettings: false, selectedGlobalLayout: null }),
    selectComponent: (id) => set({ selectedComponentId: id, selectedGlobalSettings: false, selectedGlobalLayout: null }),
    selectGlobalSettings: () =>
        set({ selectedGlobalSettings: true, selectedPageId: null, selectedComponentId: null, selectedGlobalLayout: null }),
    selectGlobalLayout: (section) =>
        set((state) => ({ selectedGlobalSettings: false, selectedGlobalLayout: section, selectedPageId: state.selectedPageId, selectedComponentId: null })),
    setViewport: (v) => set({ previewViewport: v }),
    setActiveTab: (t) => set({ activeTab: t }),
    setEditingLocale: (locale) => set({ editingLocale: locale || null }),

    updateConfig: (newConfig) => set((state) => pushToHistory(state, newConfig)),

    amendLastEdit: (newConfig) =>
        set((state) => {
            if (state.historyIndex < 0) return pushToHistory(state, newConfig);
            const history = [...state.history.slice(0, state.historyIndex), JSON.parse(JSON.stringify(newConfig))];
            return { config: newConfig, history, historyIndex: history.length - 1 };
        }),

    commitLocalizedEdit: (edit) =>
        set((state) => {
            if (!state.config) return {};
            let next: CatalogueConfig = state.config;

            if (edit.component) {
                const { pageId, componentId, updates } = edit.component;
                next = {
                    ...next,
                    pages: next.pages.map((page) =>
                        page.id !== pageId
                            ? page
                            : {
                                  ...page,
                                  components: mapComponents(page.components, (comp) =>
                                      comp.id === componentId ? { ...comp, ...updates } : comp
                                  ),
                              }
                    ),
                };
            }

            if (edit.pageSeo) {
                const { pageId, seo } = edit.pageSeo;
                next = {
                    ...next,
                    pages: next.pages.map((p) => (p.id === pageId ? { ...p, seo } : p)),
                };
            }

            if (edit.globalSettings && Object.keys(edit.globalSettings).length > 0) {
                next = {
                    ...next,
                    globalSettings: { ...next.globalSettings, ...edit.globalSettings },
                };
            }

            const translations = edit.translations || {};
            if (edit.locale && Object.keys(translations).length > 0) {
                const i18n = next.globalSettings.i18n || {};
                const strings = i18n.strings || {};
                const dict = mergeTranslations(strings[edit.locale], translations);
                next = {
                    ...next,
                    globalSettings: {
                        ...next.globalSettings,
                        i18n: { ...i18n, strings: { ...strings, [edit.locale]: dict } },
                    },
                };
            }

            if (next === state.config) return {};
            return pushToHistory(state, next);
        }),

    updateComponent: (pageId, componentId, updates) =>
        set((state) => {
            if (!state.config) return {};
            const newPages = state.config.pages.map((page) => {
                if (page.id !== pageId) return page;
                return {
                    ...page,
                    components: mapComponents(page.components, (comp) =>
                        comp.id === componentId ? { ...comp, ...updates } : comp
                    ),
                };
            });
            const newConfig = { ...state.config, pages: newPages };
            return pushToHistory(state, newConfig);
        }),

    updateGlobalSettings: (updates) =>
        set((state) => {
            if (!state.config) return {};
            const newConfig = {
                ...state.config,
                globalSettings: {
                    ...state.config.globalSettings,
                    ...updates,
                },
            };
            return pushToHistory(state, newConfig);
        }),

    reorderComponents: (pageId, newComponents) =>
        set((state) => {
            if (!state.config) return {};
            const newPages = state.config.pages.map((page) => {
                if (page.id !== pageId) return page;
                return { ...page, components: newComponents };
            });
            const newConfig = { ...state.config, pages: newPages };
            return pushToHistory(state, newConfig);
        }),

    addComponent: (pageId, component) =>
        set((state) => {
            if (!state.config) return {};
            const newPages = state.config.pages.map((page) => {
                if (page.id !== pageId) return page;
                return { ...page, components: [...page.components, component] };
            });
            const newConfig = { ...state.config, pages: newPages };
            return pushToHistory(state, newConfig);
        }),

    deleteComponent: (pageId, componentId) =>
        set((state) => {
            if (!state.config) return {};
            const newPages = state.config.pages.map((page) => {
                if (page.id !== pageId) return page;
                return {
                    ...page,
                    components: filterComponents(page.components, (c) => c.id !== componentId),
                };
            });
            const newConfig = { ...state.config, pages: newPages };
            return { ...pushToHistory(state, newConfig), selectedComponentId: null };
        }),

    duplicateComponent: (pageId, componentId) =>
        set((state) => {
            if (!state.config) return {};
            const newPages = state.config.pages.map((page) => {
                if (page.id !== pageId) return page;
                const componentIndex = page.components.findIndex((c) => c.id === componentId);
                if (componentIndex === -1) return page;
                const original = page.components[componentIndex];
                if (!original) return page;
                // Deep-clone, give the top-level a new ID, and regenerate
                // IDs for any nested slot components so the duplicate is
                // fully independent of the original.
                const cloned = JSON.parse(JSON.stringify(original)) as Component;
                const duplicate = regenerateSlotIds({
                    ...cloned,
                    id: `${original.type}-${Date.now()}`,
                });
                const newComponents = [...page.components];
                newComponents.splice(componentIndex + 1, 0, duplicate);
                return { ...page, components: newComponents };
            });
            const newConfig = { ...state.config, pages: newPages };
            return pushToHistory(state, newConfig);
        }),

    addToSlot: (pageId, layoutId, slotIndex, component) =>
        set((state) => {
            if (!state.config) return {};
            const newPages = state.config.pages.map((page) => {
                if (page.id !== pageId) return page;
                return {
                    ...page,
                    components: mapComponents(page.components, (comp) => {
                        if (comp.id !== layoutId) return comp;
                        // Build the slots array defensively: if props.slots is missing
                        // (e.g. corrupted data), reconstruct empty slots from columns count
                        const existingSlots: Component[][] = Array.isArray(comp.props?.slots)
                            ? (comp.props.slots as Component[][])
                            : Array.from({ length: comp.props?.columns ?? 2 }, () => []);
                        const slots = existingSlots.map((s, i) =>
                            i === slotIndex ? [...s, component] : s
                        );
                        return { ...comp, props: { ...comp.props, slots } };
                    }),
                };
            });
            const newConfig = { ...state.config, pages: newPages };
            return { ...pushToHistory(state, newConfig), selectedComponentId: component.id };
        }),

    reorderSlot: (pageId, layoutId, slotIndex, newComponents) =>
        set((state) => {
            if (!state.config) return {};
            const newPages = state.config.pages.map((page) => {
                if (page.id !== pageId) return page;
                return {
                    ...page,
                    components: mapComponents(page.components, (comp) => {
                        if (comp.id !== layoutId) return comp;
                        const slots = (comp.props?.slots as Component[][] | undefined) ?? [];
                        const newSlots = slots.map((s, i) => (i === slotIndex ? newComponents : s));
                        return { ...comp, props: { ...comp.props, slots: newSlots } };
                    }),
                };
            });
            const newConfig = { ...state.config, pages: newPages };
            return pushToHistory(state, newConfig);
        }),

    deleteFromSlot: (pageId, layoutId, slotIndex, componentId) =>
        set((state) => {
            if (!state.config) return {};
            const newPages = state.config.pages.map((page) => {
                if (page.id !== pageId) return page;
                return {
                    ...page,
                    components: mapComponents(page.components, (comp) => {
                        if (comp.id !== layoutId) return comp;
                        const slots = (comp.props?.slots as Component[][] | undefined) ?? [];
                        const newSlots = slots.map((s, i) =>
                            i === slotIndex ? s.filter((c) => c.id !== componentId) : s
                        );
                        return { ...comp, props: { ...comp.props, slots: newSlots } };
                    }),
                };
            });
            const newConfig = { ...state.config, pages: newPages };
            return { ...pushToHistory(state, newConfig), selectedComponentId: null };
        }),

    addPage: (page) =>
        set((state) => {
            if (!state.config) return {};
            const newConfig = { ...state.config, pages: [...state.config.pages, page] };
            return {
                ...pushToHistory(state, newConfig),
                selectedPageId: page.id,
            };
        }),

    deletePage: (pageId) =>
        set((state) => {
            if (!state.config) return {};
            const newPages = state.config.pages.filter((p) => p.id !== pageId);
            const newSelectedPageId =
                state.selectedPageId === pageId ? newPages[0]?.id || null : state.selectedPageId;
            const newConfig = { ...state.config, pages: newPages };
            return {
                ...pushToHistory(state, newConfig),
                selectedPageId: newSelectedPageId,
                selectedComponentId: null,
            };
        }),

    renamePage: (pageId, title, route) =>
        set((state) => {
            if (!state.config) return {};
            const newConfig = renamePageInConfig(state.config, pageId, title, route);
            return newConfig === state.config ? {} : pushToHistory(state, newConfig);
        }),

    // togglePagePublished removed: page.published was never enforced on the
    // learner side — the site-level Draft/Publish revision flow is the gate.

    updatePageSeo: (pageId, seo) =>
        set((state) => {
            if (!state.config) return {};
            const newPages = state.config.pages.map((p) =>
                p.id === pageId ? { ...p, seo: { ...p.seo, ...seo } } : p
            );
            const newConfig = { ...state.config, pages: newPages };
            return pushToHistory(state, newConfig);
        }),

    setPageHideSiteChrome: (pageId, hide) =>
        set((state) => {
            if (!state.config) return {};
            const newPages = state.config.pages.map((p) =>
                p.id === pageId ? { ...p, hideSiteChrome: hide || undefined } : p
            );
            return pushToHistory(state, { ...state.config, pages: newPages });
        }),

    updatePageBackgroundColor: (pageId, color) =>
        set((state) => {
            if (!state.config) return {};
            const newPages = state.config.pages.map((p) =>
                p.id === pageId ? { ...p, backgroundColor: color || undefined } : p
            );
            const newConfig = { ...state.config, pages: newPages };
            return pushToHistory(state, newConfig);
        }),

    copyComponent: (pageId, componentId) =>
        set((state) => {
            if (!state.config) return {};
            const page = state.config.pages.find((p) => p.id === pageId);
            if (!page) return {};
            // Recursive find in top-level and slots
            const find = (comps: Component[]): Component | null => {
                for (const c of comps) {
                    if (c.id === componentId) return c;
                    if (Array.isArray(c.props?.slots)) {
                        for (const slot of c.props.slots as Component[][]) {
                            const found = find(slot);
                            if (found) return found;
                        }
                    }
                }
                return null;
            };
            const comp = find(page.components);
            if (!comp) return {};
            return { clipboard: JSON.parse(JSON.stringify(comp)) };
        }),

    pasteComponent: (pageId) =>
        set((state) => {
            if (!state.config || !state.clipboard) return {};
            const pasted: Component = {
                ...JSON.parse(JSON.stringify(state.clipboard)),
                id: `${state.clipboard.type}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            };
            // Regenerate IDs in nested slots
            if (Array.isArray(pasted.props?.slots)) {
                pasted.props.slots = (pasted.props.slots as Component[][]).map((slot: Component[]) =>
                    slot.map((child: Component) => ({
                        ...child,
                        id: `${child.type}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                    }))
                );
            }
            const newPages = state.config.pages.map((p) =>
                p.id === pageId ? { ...p, components: [...p.components, pasted] } : p
            );
            const newConfig = { ...state.config, pages: newPages };
            return pushToHistory(state, newConfig);
        }),

    duplicatePage: (pageId) =>
        set((state) => {
            if (!state.config) return {};
            const pageIndex = state.config.pages.findIndex((p) => p.id === pageId);
            if (pageIndex === -1) return {};
            const original = state.config.pages[pageIndex];
            if (!original) return {};
            const duplicate: Page = {
                ...JSON.parse(JSON.stringify(original)),
                id: `${original.id}-copy-${Date.now()}`,
                route: `${original.route}-copy`,
                title: original.title ? `${original.title} (Copy)` : undefined,
            };
            const newPages = [...state.config.pages];
            newPages.splice(pageIndex + 1, 0, duplicate);
            const newConfig = { ...state.config, pages: newPages };
            return {
                ...pushToHistory(state, newConfig),
                selectedPageId: duplicate.id,
            };
        }),

    // Undo/Redo implementations
    undo: () =>
        set((state) => {
            if (state.historyIndex <= 0) return {};
            const newIndex = state.historyIndex - 1;
            const previousConfig = state.history[newIndex];
            return {
                historyIndex: newIndex,
                config: previousConfig ? JSON.parse(JSON.stringify(previousConfig)) : state.config,
            };
        }),

    redo: () =>
        set((state) => {
            if (state.historyIndex >= state.history.length - 1) return {};
            const newIndex = state.historyIndex + 1;
            const nextConfig = state.history[newIndex];
            return {
                historyIndex: newIndex,
                config: nextConfig ? JSON.parse(JSON.stringify(nextConfig)) : state.config,
            };
        }),

    canUndo: () => {
        const state = get();
        return state.historyIndex > 0;
    },

    canRedo: () => {
        const state = get();
        return state.historyIndex < state.history.length - 1;
    },
}));
