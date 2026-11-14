import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('react-i18next', async (orig) => ({
    ...(await orig<Record<string, unknown>>()),
    useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/lib/auth/instituteUtils', () => ({ getCurrentInstituteId: () => 'inst-1' }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('../-hooks/use-catalogue-permissions', () => ({
    useCataloguePermissions: () => ({ canWrite: true, canPublish: true, canDelete: true }),
}));
vi.mock('@tanstack/react-query', async (orig) => ({
    ...(await orig<Record<string, unknown>>()),
    useQuery: () => ({
        data: {
            content: [
                {
                    id: 'r1',
                    rating: 5,
                    reviewer_name: 'Asha',
                    status: 'PENDING',
                    answers: [{ key: 'f_exam', label: 'Exam you are preparing for', value: 'SSC CGL' }],
                },
            ],
            total_pages: 1,
            total_elements: 1,
            counts: { PENDING: 1 },
        },
        isLoading: false,
        isError: false,
    }),
    useMutation: () => ({ mutate: vi.fn(), isPending: false }),
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

import { ReviewFormFieldsEditor } from './ReviewFormFieldsEditor';
import { ReviewsList } from './reviews/ReviewsList';
import {
    addField,
    addableKinds,
    moveField,
    patchField,
    readFormFields,
    removeField,
    withFormFields,
    type ReviewFormField,
} from '../-utils/review-form-fields';

/**
 * The review form builder: an older block's fields become an editable list
 * (same order and labels the site showed), stars and name cannot be removed
 * or made optional, built-ins appear once, and saving drops the older
 * per-field settings so there is one source. Custom answers show to admins.
 */

const legacy = {
    heading: 'Rate us',
    fields: { reviewText: 'required', course: 'optional', city: 'optional', designation: 'off' },
    courseLabel: 'eBook',
    courseOptions: ['SSC'],
    textPlaceholder: 'Tell us',
};

describe('review form fields (pure)', () => {
    it('reads an older block in the order and with the labels the site showed', () => {
        const f = readFormFields(legacy);
        expect(f.map((x) => x.kind)).toEqual(['rating', 'reviewText', 'reviewerName', 'courseName', 'city']);
        expect(f[1]).toMatchObject({ required: true, placeholder: 'Tell us' });
        expect(f[3]).toMatchObject({ label: 'eBook', options: ['SSC'], width: 'half' });
    });

    it('saving keeps other props and drops the older per-field ones', () => {
        const next = withFormFields(legacy, readFormFields(legacy));
        expect(next.heading).toBe('Rate us');
        expect(next.formFields).toHaveLength(5);
        ['fields', 'courseLabel', 'courseOptions', 'textPlaceholder'].forEach((k) => expect(next).not.toHaveProperty(k));
    });

    it('stars and name stay and stay required; built-ins once; custom capped at 10', () => {
        let f: ReviewFormField[] = readFormFields(legacy);
        expect(removeField(f, 0)).toBe(f);
        expect(patchField(f, 2, { required: false })[2]!.required).toBe(true);
        expect(addField(f, 'city')).toBe(f);
        expect(addableKinds(f).builtin).toEqual(['designation']);
        for (let i = 0; i < 12; i++) f = addField(f, 'text');
        expect(f.filter((x) => x.kind === 'text')).toHaveLength(12); // addField itself does not cap…
        expect(addableKinds(f.slice(0, 15)).custom).toEqual([]); // …the Add menu stops offering at 10
    });

    it('moves within bounds and never makes a long field half width', () => {
        const f = readFormFields(legacy);
        expect(moveField(f, 0, -1)).toBe(f);
        expect(moveField(f, 0, 1).map((x) => x.kind).slice(0, 2)).toEqual(['reviewText', 'rating']);
        expect(patchField(f, 1, { width: 'half' })[1]!.width).toBe('full');
    });
});

describe('ReviewFormFieldsEditor', () => {
    it('lists the fields, locks delete for stars and name, and saves moves as formFields', () => {
        const update = vi.fn();
        render(<ReviewFormFieldsEditor props={legacy} update={update} />);
        expect(screen.getByText('eBook')).toBeTruthy();
        const deletes = screen.getAllByRole('button', { name: 'editor.formFields.delete' }) as HTMLButtonElement[];
        expect(deletes.map((b) => b.disabled)).toEqual([true, false, true, false, false]);

        fireEvent.click(screen.getAllByRole('button', { name: 'editor.formFields.moveDown' })[0]!);
        const saved = update.mock.calls[0]![0];
        expect(saved.formFields.map((x: ReviewFormField) => x.kind)).toEqual(['reviewText', 'rating', 'reviewerName', 'courseName', 'city']);
        expect(saved).not.toHaveProperty('fields');
    });

    it('edits a field label in place', () => {
        const update = vi.fn();
        render(<ReviewFormFieldsEditor props={legacy} update={update} />);
        fireEvent.click(screen.getAllByRole('button', { name: 'editor.formFields.edit' })[4]!);
        fireEvent.change(screen.getByPlaceholderText('editor.defaults.cityLabel'), { target: { value: 'Your city' } });
        const saved = update.mock.calls.at(-1)![0];
        expect(saved.formFields[4]).toMatchObject({ kind: 'city', label: 'Your city' });
    });
});

describe('ReviewsList', () => {
    it('shows the answers to custom questions under the review', () => {
        render(<ReviewsList />);
        expect(screen.getByText('Exam you are preparing for')).toBeTruthy();
        expect(screen.getByText('SSC CGL')).toBeTruthy();
    });
});
