import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { FormFieldRow } from '@/components/common/custom-fields/FormFieldRow';

const renderRow = (props: Partial<React.ComponentProps<typeof FormFieldRow>> = {}) => {
    const onToggleRequired = vi.fn();
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    render(
        <FormFieldRow
            position={3}
            name="Phone Number"
            type="phone"
            isRequired={props.isRequired ?? true}
            onToggleRequired={onToggleRequired}
            onEdit={onEdit}
            onDelete={onDelete}
            dragHandle={<span />}
            {...props}
        />
    );
    return { onToggleRequired, onEdit, onDelete, toggle: screen.getByRole('switch') };
};

describe('FormFieldRow — Full Name / Email / Phone Number are ordinary fields', () => {
    it('lets a built-in field be made optional', () => {
        const { onToggleRequired, toggle } = renderRow();

        expect(toggle).not.toBeDisabled();
        fireEvent.click(toggle);
        expect(onToggleRequired).toHaveBeenCalledTimes(1);
    });

    it('shows the field as optional once it is, instead of forcing the switch on', () => {
        const { toggle } = renderRow({ isRequired: false });

        expect(toggle).toHaveAttribute('data-state', 'unchecked');
    });

    it('lets a built-in field be renamed and removed — nothing is locked', () => {
        const { onEdit, onDelete } = renderRow();

        const edit = screen.getByLabelText('Edit field');
        const remove = screen.getByLabelText('Delete field');
        expect(edit).not.toBeDisabled();
        expect(remove).not.toBeDisabled();

        fireEvent.click(edit);
        fireEvent.click(remove);
        expect(onEdit).toHaveBeenCalledTimes(1);
        expect(onDelete).toHaveBeenCalledTimes(1);
    });

    it('opens the inline editor on a built-in field', () => {
        renderRow({ isEditing: true, children: <p>Field settings</p> });

        expect(screen.getByText('Field settings')).toBeInTheDocument();
    });

    it('locks Required only for a stated reason, and says what it is', () => {
        const reason = 'The mobile number is verified with a WhatsApp OTP on this form.';
        const { onToggleRequired, toggle } = renderRow({ requiredLockReason: reason });

        expect(toggle).toBeDisabled();
        fireEvent.click(toggle);
        expect(onToggleRequired).not.toHaveBeenCalled();
        expect(toggle.closest('[title]')).toHaveAttribute('title', reason);
    });

    it('never locks an OPTIONAL field — that would be a dead end', () => {
        // Switching WhatsApp OTP on while the phone field is optional must not leave the admin
        // with a disabled Off switch and a save they cannot pass.
        const { onToggleRequired, toggle } = renderRow({
            isRequired: false,
            requiredLockReason: 'The mobile number is verified with a WhatsApp OTP on this form.',
        });

        expect(toggle).not.toBeDisabled();
        fireEvent.click(toggle);
        expect(onToggleRequired).toHaveBeenCalledTimes(1);
    });
});
