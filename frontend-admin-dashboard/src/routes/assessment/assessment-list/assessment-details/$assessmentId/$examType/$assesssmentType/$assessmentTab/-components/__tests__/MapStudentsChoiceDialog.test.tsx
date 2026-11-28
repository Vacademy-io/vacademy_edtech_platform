import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MapStudentsChoiceDialog } from '../copy-intake/MapStudentsChoiceDialog';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key }),
}));

const confirmButton = () =>
    screen.getByRole('button', { name: /mapChoice\.confirm(Map|CheckOnly)/ });

const renderDialog = (props: Partial<Parameters<typeof MapStudentsChoiceDialog>[0]> = {}) => {
    const onConfirm = vi.fn();
    render(
        <MapStudentsChoiceDialog
            open
            onOpenChange={vi.fn()}
            copies={3}
            onConfirm={onConfirm}
            {...props}
        />
    );
    return onConfirm;
};

describe('MapStudentsChoiceDialog', () => {
    it('preselects "map" by default and confirms with mapStudents=true', () => {
        const onConfirm = renderDialog();
        expect(confirmButton().textContent).toBe('mapChoice.confirmMap');
        fireEvent.click(confirmButton());
        expect(onConfirm).toHaveBeenCalledWith(true);
    });

    it('preselects the Settings default (only check) but both options stay offered', () => {
        const onConfirm = renderDialog({ defaultChoice: 'CHECK_ONLY' });
        expect(confirmButton().textContent).toBe('mapChoice.confirmCheckOnly');
        const radios = screen.getAllByRole('radio');
        expect(radios).toHaveLength(2);
        expect(radios.every((r) => !r.hasAttribute('disabled'))).toBe(true);
        fireEvent.click(confirmButton());
        expect(onConfirm).toHaveBeenCalledWith(false);
    });

    it('lets the teacher switch from the default to "map"', () => {
        const onConfirm = renderDialog({ defaultChoice: 'CHECK_ONLY' });
        fireEvent.click(screen.getByText('mapChoice.MAP.title'));
        expect(confirmButton().textContent).toBe('mapChoice.confirmMap');
        fireEvent.click(confirmButton());
        expect(onConfirm).toHaveBeenCalledWith(true);
    });

    it('forces "only check" when there are no students, whatever the default', () => {
        const onConfirm = renderDialog({ canMap: false, defaultChoice: 'MAP' });
        fireEvent.click(confirmButton());
        expect(onConfirm).toHaveBeenCalledWith(false);
    });

    it('starts only once on a double tap', () => {
        const onConfirm = renderDialog();
        fireEvent.click(confirmButton());
        fireEvent.click(confirmButton());
        expect(onConfirm).toHaveBeenCalledTimes(1);
    });
});
