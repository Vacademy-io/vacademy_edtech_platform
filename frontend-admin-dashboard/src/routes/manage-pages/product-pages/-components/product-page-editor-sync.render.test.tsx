import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { ProductPageEditor } from './ProductPageEditor';
import type { CatalogueSyncPanel } from './CatalogueSyncPanel';

/**
 * The Courses tab wiring of the catalogue sync: the panel learns the page code
 * (to find out whether it is a store page) and re-seeds the rows through the
 * editor hook, and the course rows are locked while a sync runs — the sync's
 * result replaces them, so an edit made meanwhile would be lost yet leave the
 * editor saying there are unsaved changes.
 */

type PanelProps = ComponentProps<typeof CatalogueSyncPanel>;
let panelProps: PanelProps | null = null;
const reseedMappings = vi.fn();

vi.mock('@tanstack/react-router', () => ({
    useParams: () => ({ productPageId: 'pp-1' }),
    useNavigate: () => vi.fn(),
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/lib/auth/instituteUtils', () => ({ getCurrentInstituteId: () => 'inst-1' }));
vi.mock('@/stores/students/students-list/useInstituteDetailsStore', () => ({
    useInstituteDetailsStore: () => ({ instituteDetails: null }),
}));
vi.mock('@/components/common/layout-container/sidebar/utils', () => ({ getTerminologyPlural: () => 'Courses' }));
vi.mock('@/routes/settings/-components/NamingSettings', () => ({
    ContentTerms: { Course: 'Course' },
    SystemTerms: { Course: 'Course' },
}));
vi.mock('../-hooks/use-product-page-editor', () => ({
    useProductPageEditor: () => ({
        page: { id: 'pp-1', code: 'store', name: 'Store', mappings: [] },
        isLoading: false,
        name: 'Store',
        status: 'ACTIVE',
        settings: {},
        pageJson: { suggestions: {} },
        mappingRows: [],
        isDirty: false,
        activeTab: 'courses',
        setActiveTab: vi.fn(),
        updateName: vi.fn(),
        updateStatus: vi.fn(),
        updateSettings: vi.fn(),
        updatePageJson: vi.fn(),
        addRow: vi.fn(),
        addRowWithData: vi.fn(),
        updateRow: vi.fn(),
        removeRow: vi.fn(),
        moveRow: vi.fn(),
        reseedMappings,
        save: vi.fn(),
        isSaving: false,
        saveError: false,
    }),
}));
vi.mock('./CatalogueSyncPanel', () => ({
    CatalogueSyncPanel: (props: PanelProps) => {
        panelProps = props;
        return null;
    },
}));
vi.mock('./CourseSessionSelector', () => ({
    CourseSessionSelector: () => (
        <div>
            <button type="button">Remove course</button>
            <input type="checkbox" aria-label="Preselected" />
        </div>
    ),
}));
vi.mock('./PageDesignEditor', () => ({ PageDesignEditor: () => null }));
vi.mock('./ProductPagePreview', () => ({ ProductPagePreview: () => null }));
vi.mock('./ProductPageSettingsCard', () => ({ ProductPageSettingsCard: () => null }));
vi.mock('./CouponManager', () => ({ CouponManager: () => null }));
vi.mock('./ProductPageCustomFieldsManager', () => ({ ProductPageCustomFieldsManager: () => null }));
vi.mock('./StorePageNotice', () => ({ StorePageNotice: () => null }));

beforeEach(() => {
    panelProps = null;
});

describe('ProductPageEditor → catalogue sync', () => {
    it('gives the panel the page code and the row re-seed', () => {
        render(<ProductPageEditor />);
        expect(panelProps).toMatchObject({
            productPageId: 'pp-1',
            instituteId: 'inst-1',
            productPageCode: 'store',
            isDirty: false,
            onSynced: reseedMappings,
        });
    });

    it('locks the course rows while a sync runs', () => {
        render(<ProductPageEditor />);
        const remove = screen.getByRole('button', { name: 'Remove course' });
        const preselect = screen.getByRole('checkbox', { name: 'Preselected' });
        expect(remove).toBeEnabled();

        act(() => panelProps!.onRunningChange!(true));
        expect(remove).toBeDisabled();
        expect(preselect).toBeDisabled();
        expect(remove.closest('fieldset')).toHaveAttribute('aria-busy', 'true');

        act(() => panelProps!.onRunningChange!(false));
        expect(remove).toBeEnabled();
        expect(preselect).toBeEnabled();
    });
});
