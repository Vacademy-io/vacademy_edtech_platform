import { useState, useCallback, useMemo } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { getProductPage, updateProductPage } from '../-services/product-pages-service';
import {
    DEFAULT_PRODUCT_PAGE_SETTINGS,
    DEFAULT_PAGE_JSON,
    ProductPageSettings,
    PageJson,
    MappingRow,
    ProductPageResponse,
} from '../-types/product-page-types';
import { mappingsToRows, moveRowInList } from '../-utils/mapping-rows';
import { useTheme } from '@/providers/theme/theme-provider';

function parseSafeJson<T>(jsonStr: string | null | undefined, fallback: T): T {
    if (!jsonStr) return fallback;
    try {
        return JSON.parse(jsonStr) as T;
    } catch {
        return fallback;
    }
}

export const useProductPageEditor = (productPageId: string) => {
    const { getPrimaryColorCode } = useTheme();
    const [isDirty, setIsDirty] = useState(false);
    const [activeTab, setActiveTab] = useState<'design' | 'courses' | 'settings' | 'coupons' | 'custom-fields' | 'preview'>(
        'design'
    );

    // Server state
    const {
        data: page,
        isLoading,
        refetch,
    } = useQuery({
        queryKey: ['productPage', productPageId],
        queryFn: () => getProductPage(productPageId),
        enabled: !!productPageId,
        staleTime: 60 * 1000,
    });

    // Default page JSON seeded with the institute's primary color
    const defaultPageJson = useMemo<PageJson>(() => {
        const color = getPrimaryColorCode();
        return {
            ...DEFAULT_PAGE_JSON,
            globalSettings: { ...DEFAULT_PAGE_JSON.globalSettings, primaryColor: color },
            components: DEFAULT_PAGE_JSON.components.map((c) =>
                c.type === 'header' ? { ...c, props: { ...c.props, backgroundColor: color } } : c
            ),
        };
    }, [getPrimaryColorCode]);

    // Local editor state — initialised from server when page loads
    const [name, setName] = useState('');
    const [status, setStatus] = useState<'DRAFT' | 'ACTIVE'>('ACTIVE');
    const [settings, setSettings] = useState<ProductPageSettings>(DEFAULT_PRODUCT_PAGE_SETTINGS);
    const [pageJson, setPageJson] = useState<PageJson>(() => defaultPageJson);
    const [mappingRows, setMappingRows] = useState<MappingRow[]>([]);
    const [initialized, setInitialized] = useState(false);

    // One-shot init from fetched data
    if (page && !initialized) {
        setName(page.name);
        setStatus((page.status as 'DRAFT' | 'ACTIVE') || 'DRAFT');
        setSettings({
            ...DEFAULT_PRODUCT_PAGE_SETTINGS,
            ...parseSafeJson(page.settings_json, DEFAULT_PRODUCT_PAGE_SETTINGS),
        });
        setPageJson(parseSafeJson(page.page_json, defaultPageJson));
        // In display order (= learning-path step order); see -utils/mapping-rows.
        setMappingRows(mappingsToRows(page.mappings));
        setInitialized(true);
    }

    const markDirty = useCallback(() => setIsDirty(true), []);

    const updateName = useCallback(
        (v: string) => {
            setName(v);
            markDirty();
        },
        [markDirty]
    );

    const updateStatus = useCallback(
        (v: 'DRAFT' | 'ACTIVE') => {
            setStatus(v);
            markDirty();
        },
        [markDirty]
    );

    const updateSettings = useCallback(
        (updated: ProductPageSettings) => {
            setSettings(updated);
            markDirty();
        },
        [markDirty]
    );

    const updatePageJson = useCallback(
        (updated: PageJson) => {
            setPageJson(updated);
            markDirty();
        },
        [markDirty]
    );

    const addRow = useCallback(() => {
        setMappingRows((prev) => [
            ...prev,
            {
                rowId: `new-${Date.now()}`,
                inviteId: '',
                inviteName: '',
                psInvitePaymentOptionId: '',
                packageSessionId: '',
                paymentPlanId: '',
                paymentPlanName: '',
                paymentPlanPrice: 0,
                currency: '',
                preselected: false,
                displayOrder: prev.length,
            },
        ]);
        markDirty();
    }, [markDirty]);

    /** A newly added course goes FIRST (position 1); the rest shift down one. */
    const addRowWithData = useCallback(
        (row: MappingRow) => {
            setMappingRows((prev) =>
                [row, ...prev].map((r, i) => (r.displayOrder === i ? r : { ...r, displayOrder: i }))
            );
            markDirty();
        },
        [markDirty]
    );

    const updateRow = useCallback(
        (rowId: string, updated: MappingRow) => {
            setMappingRows((prev) => prev.map((r) => (r.rowId === rowId ? updated : r)));
            markDirty();
        },
        [markDirty]
    );

    const removeRow = useCallback(
        (rowId: string) => {
            setMappingRows((prev) =>
                prev.filter((r) => r.rowId !== rowId).map((r, i) => ({ ...r, displayOrder: i }))
            );
            markDirty();
        },
        [markDirty]
    );

    /** One step up (-1) or down (+1). The row order is the saved order. */
    const moveRow = useCallback(
        (rowId: string, direction: -1 | 1) => {
            setMappingRows((prev) => moveRowInList(prev, rowId, direction));
            markDirty();
        },
        [markDirty]
    );

    /** Puts the rows in the given order; rows not listed keep their order at the end. */
    const reorderRows = useCallback(
        (orderedRowIds: string[]) => {
            setMappingRows((prev) => {
                const rank = new Map(orderedRowIds.map((id, i) => [id, i]));
                return [...prev]
                    .sort((a, b) => (rank.get(a.rowId) ?? Infinity) - (rank.get(b.rowId) ?? Infinity))
                    .map((r, i) => (r.displayOrder === i ? r : { ...r, displayOrder: i }));
            });
            markDirty();
        },
        [markDirty]
    );

    /**
     * Replace the course rows with the server's — after a catalogue sync, which
     * changes the mappings on the server directly. The one-shot seed above never
     * runs again, so without this the editor would keep showing (and on the next
     * Save write back) the rows from before the sync. Only call it with no
     * unsaved changes: anything else local is assumed to match the server. The
     * sync itself refreshes the ['productPage', id] cache entry (every place it
     * runs from), so this only resets the rows.
     */
    const reseedMappings = useCallback((fresh: ProductPageResponse) => {
        setMappingRows(mappingsToRows(fresh.mappings));
    }, []);

    const saveMutation = useMutation({
        mutationFn: () =>
            updateProductPage(productPageId, {
                name,
                status,
                page_json: JSON.stringify(pageJson),
                settings_json: JSON.stringify(settings),
                mappings: mappingRows
                    .filter((r) => r.psInvitePaymentOptionId && r.paymentPlanId)
                    .map((r, i) => ({
                        ps_invite_payment_option_id: r.psInvitePaymentOptionId,
                        payment_plan_id: r.paymentPlanId,
                        preselected: r.preselected,
                        display_order: i,
                    })),
            }),
        onSuccess: () => {
            setIsDirty(false);
            refetch();
        },
    });

    const totalPrice = mappingRows
        .filter((r) => r.paymentPlanPrice > 0)
        .reduce((sum, r) => sum + r.paymentPlanPrice, 0);

    return {
        page,
        isLoading,
        name,
        status,
        settings,
        pageJson,
        mappingRows,
        isDirty,
        activeTab,
        totalPrice,
        setActiveTab,
        updateName,
        updateStatus,
        updateSettings,
        updatePageJson,
        addRow,
        addRowWithData,
        updateRow,
        removeRow,
        moveRow,
        reorderRows,
        reseedMappings,
        save: saveMutation.mutate,
        isSaving: saveMutation.isPending,
        saveError: saveMutation.isError,
    };
};
