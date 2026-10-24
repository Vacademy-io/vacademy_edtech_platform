/**
 * "Create new session" in the Create Batch popup.
 *
 * The name/date inputs used to collapse into the saved-session row the moment
 * both held a value, without "+" being pressed — pick the date first and the
 * first letter typed into the name became the session. Going Back from a later
 * step also wiped the session the user had added.
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { FormProvider, useForm } from 'react-hook-form';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/stores/students/students-list/useInstituteDetailsStore', () => ({
    useInstituteDetailsStore: () => ({
        getSessionFromPackage: () => [],
        instituteDetails: null,
    }),
}));

vi.mock('@/components/common/layout-container/sidebar/utils', () => ({
    getTerminology: () => 'Session',
}));

import { CreateSessionStep } from '../create-session-step';

type Values = Record<string, unknown>;
let formValues: () => Values = () => ({});

const Harness = ({ defaults }: { defaults?: Values }) => {
    const methods = useForm({
        defaultValues: {
            selectedCourse: { id: 'c1', name: 'Course' },
            sessionCreationType: 'existing',
            selectedSession: null,
            selectedStartDate: null,
            ...defaults,
        },
    });
    formValues = methods.getValues;
    return (
        <FormProvider {...methods}>
            <CreateSessionStep />
        </FormProvider>
    );
};

const openInputs = () => fireEvent.click(screen.getByText(/Add/));
const nameInput = () => screen.getByPlaceholderText('Eg. 2024-2025');
const dateInput = () => screen.getByPlaceholderText('DD/MM/YYYY');

describe('CreateSessionStep — new session', () => {
    it('keeps the inputs open when the date is picked before the name is finished', () => {
        render(<Harness />);
        openInputs();
        fireEvent.change(dateInput(), { target: { value: '2026-10-11' } });
        fireEvent.change(nameInput(), { target: { value: 'T' } });
        fireEvent.change(nameInput(), { target: { value: 'TEST 2026' } });

        expect(nameInput()).toHaveValue('TEST 2026');
        expect(formValues().selectedSession).toEqual({ id: '', name: 'TEST 2026' });
        expect(formValues().selectedStartDate).toBe('2026-10-11');
    });

    it('saves the session only when "+" is pressed', () => {
        render(<Harness />);
        openInputs();
        fireEvent.change(nameInput(), { target: { value: 'TEST 2026' } });
        fireEvent.change(dateInput(), { target: { value: '2026-10-11' } });
        expect(screen.queryByText('TEST 2026')).toBeNull();

        // The "+" icon button next to the inputs (the radio cards are buttons too).
        fireEvent.click(nameInput().closest('.items-end')!.querySelector('button')!);

        expect(screen.getByText('TEST 2026')).toBeInTheDocument();
        expect(screen.queryByPlaceholderText('Eg. 2024-2025')).toBeNull();
        expect(formValues().selectedSession).toEqual({ id: '', name: 'TEST 2026' });
        expect(formValues().selectedStartDate).toBe('2026-10-11');
    });

    it('keeps an added session after Back from a later step', () => {
        render(
            <Harness
                defaults={{
                    sessionCreationType: 'new',
                    selectedSession: { id: '', name: 'TEST 2026' },
                    selectedStartDate: '2026-10-11',
                }}
            />
        );

        expect(screen.getByText('TEST 2026')).toBeInTheDocument();
        expect(formValues().selectedSession).toEqual({ id: '', name: 'TEST 2026' });
    });
});
