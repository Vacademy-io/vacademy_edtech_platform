import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FormProvider, useForm } from 'react-hook-form';
import type { BasicSectionFormType } from '@/types/assessments/assessment-steps';
import {
    DEFAULT_EXAM_INTERFACE_FORM,
    type ExamInterfaceForm,
} from '@/types/assessments/exam-interface';
import { ExamInterfaceSettingsCard } from './ExamInterfaceSettingsCard';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key }),
}));

const Harness = ({
    examInterface,
    omrMode = false,
    manualEvaluation = false,
}: {
    examInterface: ExamInterfaceForm;
    omrMode?: boolean;
    manualEvaluation?: boolean;
}) => {
    const form = useForm<BasicSectionFormType>({
        defaultValues: { examInterface } as Partial<BasicSectionFormType>,
    });
    return (
        <FormProvider {...form}>
            <ExamInterfaceSettingsCard
                control={form.control}
                omrMode={omrMode}
                manualEvaluation={manualEvaluation}
            />
        </FormProvider>
    );
};

describe('ExamInterfaceSettingsCard', () => {
    it('shows the standard option and no strict switch by default', () => {
        render(<Harness examInterface={DEFAULT_EXAM_INTERFACE_FORM} />);
        expect(screen.getByText('examInterface.title')).toBeTruthy();
        expect(screen.getByRole('combobox').textContent).toContain(
            'examInterface.options.standard'
        );
        expect(screen.queryByText('examInterface.strict.label')).toBeNull();
        expect(screen.queryByText('examInterface.disclaimer')).toBeNull();
        expect(screen.queryByText('examInterface.previewHint')).toBeNull();
    });

    it('shows the strict switch (on) and the disclaimer once a preset is chosen', () => {
        render(<Harness examInterface={{ choice: 'jee-main-nta', strict: true, stored: null }} />);
        expect(screen.getByRole('combobox').textContent).toContain(
            'examInterface.options.jeeMainNta'
        );
        expect(screen.getByText('examInterface.strict.label')).toBeTruthy();
        expect(screen.getByText('examInterface.strict.description')).toBeTruthy();
        expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true');
        expect(screen.getByText('examInterface.disclaimer')).toBeTruthy();
        expect(screen.getByText('examInterface.previewHint')).toBeTruthy();
    });

    it('turns the strict switch off when the stored value says so', () => {
        render(<Harness examInterface={{ choice: 'rrb-je', strict: false, stored: null }} />);
        expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false');
    });

    it('disables the picker with a reason in OMR sheet mode', () => {
        render(<Harness examInterface={{ choice: 'gate', strict: true, stored: null }} omrMode />);
        expect((screen.getByRole('combobox') as HTMLButtonElement).disabled).toBe(true);
        expect(screen.getByText('examInterface.omrDisabled')).toBeTruthy();
        expect(screen.queryByText('examInterface.strict.label')).toBeNull();
    });

    it('disables the picker with a reason for a teacher-checked (MANUAL) paper', () => {
        render(
            <Harness
                examInterface={{ choice: 'jee-advanced', strict: true, stored: null }}
                manualEvaluation
            />
        );
        expect((screen.getByRole('combobox') as HTMLButtonElement).disabled).toBe(true);
        expect(screen.getByText('examInterface.manualDisabled')).toBeTruthy();
        expect(screen.queryByText('examInterface.strict.label')).toBeNull();
    });
});
