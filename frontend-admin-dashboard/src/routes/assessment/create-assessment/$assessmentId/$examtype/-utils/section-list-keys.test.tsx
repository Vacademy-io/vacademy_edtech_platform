/**
 * Why Step 2 keys its section cards by react-hook-form's field id and deletes
 * through the parent's field array (Step2AddingQuestions). A controlled field
 * (useController) only follows changes addressed to its exact name, so a card
 * that stays mounted while the section under its index changes keeps showing
 * the old section — "Section 1" after the paper's sections replaced it, and
 * the deleted section after a delete above it. Stable ids make React remount
 * the card for the section that is actually there.
 */
import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useController, useFieldArray, useForm, UseFormReturn } from 'react-hook-form';

type F = { section: { sectionName: string }[] };
const sec = (sectionName: string) => ({ sectionName });

const Card = ({
    form,
    index,
    onDelete,
}: {
    form: UseFormReturn<F>;
    index: number;
    onDelete: (i: number) => void;
}) => {
    const { field } = useController({
        control: form.control,
        name: `section.${index}.sectionName`,
    });
    return (
        <div>
            <input data-testid={`name-${index}`} value={field.value} onChange={field.onChange} />
            <button type="button" data-testid={`del-${index}`} onClick={() => onDelete(index)} />
        </div>
    );
};

let formRef: UseFormReturn<F> | null = null;
const List = ({ keyBy }: { keyBy: 'id' | 'index' }) => {
    const form = useForm<F>({ defaultValues: { section: [sec('Section 1')] } });
    formRef = form;
    const { fields, remove } = useFieldArray({ control: form.control, name: 'section' });
    return (
        <div>
            {fields.map((f, index) => (
                <Card
                    key={keyBy === 'id' ? f.id : index}
                    form={form}
                    index={index}
                    onDelete={remove}
                />
            ))}
        </div>
    );
};

const names = () => screen.getAllByTestId(/^name-/).map((e) => (e as HTMLInputElement).value);

describe('section cards keyed by field id', () => {
    it('show the sections that replaced the blank one, and shift correctly on delete', () => {
        render(<List keyBy="id" />);
        act(() => {
            formRef!.setValue('section', [sec('English'), sec('Reasoning'), sec('Quant')]);
        });
        expect(names()).toEqual(['English', 'Reasoning', 'Quant']);
        fireEvent.click(screen.getByTestId('del-0'));
        expect(formRef!.getValues('section').map((s) => s.sectionName)).toEqual([
            'Reasoning',
            'Quant',
        ]);
        expect(names()).toEqual(['Reasoning', 'Quant']);
    });

    it('keyed by index, the first card kept showing "Section 1" — the bug this guards', () => {
        render(<List keyBy="index" />);
        act(() => {
            formRef!.setValue('section', [sec('English'), sec('Reasoning'), sec('Quant')]);
        });
        expect(names()[0]).toBe('Section 1');
    });
});
