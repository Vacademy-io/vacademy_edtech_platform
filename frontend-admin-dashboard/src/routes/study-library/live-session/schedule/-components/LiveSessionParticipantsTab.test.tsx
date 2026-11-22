// @vitest-environment jsdom
// happy-dom 12 submits a form on a submit-button click even when the click was
// cancelled (it never checks defaultPrevented); jsdom follows the browser here.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { createPortal } from 'react-dom';
import type { UseFormReturn } from 'react-hook-form';

// jsdom has no layout APIs; Radix Popover / cmdk only use this to measure.
globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
} as unknown as typeof ResizeObserver;

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key }),
}));

// Stand-in for the shared learner list: the real FilterChips (typeless <button>
// nested in the Radix trigger), a typeless MyButton like "Export Data", a plain
// input like pagination "Go to", a textarea, and a portaled dialog with its own form.
const exportClick = vi.fn();
const dialogSubmit = vi.fn((e: { preventDefault: () => void }) => e.preventDefault());
vi.mock('./LiveSessionStudentListTab', async () => {
    const { FilterChips } = await import('@/components/design-system/chips');
    const { MyButton } = await import('@/components/design-system/button');
    return {
        LiveSessionStudentListTab: () => (
            <div>
                <FilterChips
                    label="Gender"
                    filterList={[{ id: 'm', label: 'Male' }]}
                    selectedFilters={[]}
                    clearFilters={false}
                    handleSelect={() => {}}
                    handleClearFilters={() => {}}
                />
                <MyButton onClick={exportClick}>Export Data</MyButton>
                <input aria-label="go-to" />
                <textarea aria-label="notes" />
                {createPortal(
                    <form onSubmit={dialogSubmit}>
                        <input aria-label="dialog-input" />
                        <button>Dialog save</button>
                    </form>,
                    document.body
                )}
            </div>
        ),
    };
});

import { LiveSessionParticipantsTab } from './LiveSessionParticipantsTab';

const makeForm = (mode: 'batch' | 'individual') =>
    ({
        getValues: () => mode,
        setValue: vi.fn(),
        watch: () => [],
    }) as unknown as UseFormReturn<never>;

const setup = (mode: 'batch' | 'individual' = 'individual') => {
    const outerSubmit = vi.fn((e: { preventDefault: () => void }) => e.preventDefault());
    const form = makeForm(mode);
    render(
        <form onSubmit={outerSubmit}>
            <input aria-label="outside-input" />
            <LiveSessionParticipantsTab
                form={form as never}
                courses={[]}
                currentSession={undefined}
            />
            <button>Outside typeless</button>
        </form>
    );
    return { outerSubmit, form };
};

describe('LiveSessionParticipantsTab inside the step-2 form', () => {
    it('control: a typeless button outside the tab still submits the form', () => {
        const { outerSubmit } = setup();
        fireEvent.click(screen.getByText('Outside typeless'));
        expect(outerSubmit).toHaveBeenCalledTimes(1);
    });

    it('filter chip opens its popover without submitting the form', () => {
        const { outerSubmit } = setup();
        const chip = screen.getByText('Gender').closest('button')!;
        expect(chip.type).toBe('submit');
        fireEvent.click(chip);
        expect(outerSubmit).not.toHaveBeenCalled();
        expect(screen.getByPlaceholderText('Search')).toBeInTheDocument();
    });

    it('typeless MyButton keeps its own onClick but no longer submits', () => {
        const { outerSubmit } = setup();
        exportClick.mockClear();
        fireEvent.click(screen.getByText('Export Data'));
        expect(exportClick).toHaveBeenCalledTimes(1);
        expect(outerSubmit).not.toHaveBeenCalled();
    });

    it('Enter in an input inside the tab is cancelled; textarea and IME Enter are not', () => {
        setup();
        expect(fireEvent.keyDown(screen.getByLabelText('go-to'), { key: 'Enter' })).toBe(false);
        expect(fireEvent.keyDown(screen.getByLabelText('go-to'), { key: 'a' })).toBe(true);
        expect(fireEvent.keyDown(screen.getByLabelText('notes'), { key: 'Enter' })).toBe(true);
        expect(
            fireEvent.keyDown(screen.getByLabelText('go-to'), { key: 'Enter', isComposing: true })
        ).toBe(true);
    });

    it('Enter in an input outside the tab is untouched', () => {
        setup();
        expect(fireEvent.keyDown(screen.getByLabelText('outside-input'), { key: 'Enter' })).toBe(
            true
        );
    });

    it('a portaled dialog with its own form still submits', () => {
        setup();
        dialogSubmit.mockClear();
        expect(fireEvent.click(screen.getByText('Dialog save'))).toBe(true);
        expect(dialogSubmit).toHaveBeenCalledTimes(1);
        expect(fireEvent.keyDown(screen.getByLabelText('dialog-input'), { key: 'Enter' })).toBe(
            true
        );
    });

    it('tab switching still works and still syncs batchSelectionType', () => {
        const { form } = setup('individual');
        expect(form.setValue).toHaveBeenLastCalledWith('batchSelectionType', 'individual');
        fireEvent.mouseDown(screen.getByText('tabs.selectBatch'), { button: 0 });
        expect(form.setValue).toHaveBeenLastCalledWith('batchSelectionType', 'batch');
        expect(screen.queryByText('Export Data')).not.toBeInTheDocument();
    });

    it('does nothing when rendered outside any form', () => {
        render(
            <LiveSessionParticipantsTab
                form={makeForm('individual') as never}
                courses={[]}
                currentSession={undefined}
            />
        );
        expect(fireEvent.click(screen.getByText('Export Data'))).toBe(true);
        expect(fireEvent.keyDown(screen.getByLabelText('go-to'), { key: 'Enter' })).toBe(true);
    });
});
