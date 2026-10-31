import { useState } from 'react';
import { useForm, type UseFormReturn } from 'react-hook-form';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Form } from '@/components/ui/form';
import { generateCourseFieldText } from '@/services/ai-course-assist';
import type { CoursePageContent } from '../-utils/course-page-content';
import type { Step1Data } from './add-course-step1';
import { CoursePageSection, type CoursePageStatus } from './course-page-section';

// TipTap needs a real layout engine; a textarea stands in for the answer editor.
vi.mock('@/components/editor/RichTextEditor', () => ({
    RichTextEditor: ({
        value,
        onChange,
        placeholder,
    }: {
        value: string;
        onChange: (html: string) => void;
        placeholder?: string;
    }) => (
        <textarea
            aria-label={placeholder}
            value={value ?? ''}
            onChange={(e) => onChange(e.target.value)}
        />
    ),
}));

vi.mock('@/services/ai-course-assist', () => ({
    AI_TEXT_CREDIT_COST: 1,
    generateCourseFieldText: vi.fn(),
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

let formApi: UseFormReturn<Step1Data>;

const Harness = ({
    coursePage,
    status,
}: {
    coursePage?: CoursePageContent;
    status?: CoursePageStatus;
}) => {
    const form = useForm<Step1Data>({
        defaultValues: {
            course: 'Touch Typing',
            description: '<p>Learn to type fast.</p>',
            courseMedia: { type: '', id: '' },
            tags: [],
            coursePage: coursePage ?? { mode: null, faqs: [] },
        },
    });
    formApi = form;
    const [open, setOpen] = useState(false);
    return (
        <Form {...form}>
            <CoursePageSection
                form={form}
                courseTerm="Course"
                status={status}
                open={open}
                onOpenChange={setOpen}
            />
        </Form>
    );
};

const openSection = () => fireEvent.click(screen.getByRole('button', { name: /course page/i }));
const rows = () => screen.queryAllByTestId('course-page-faq-row');
const questions = () => formApi.getValues('coursePage.faqs')?.map((faq) => faq.q);

describe('CoursePageSection', () => {
    beforeEach(() => {
        vi.mocked(generateCourseFieldText).mockReset();
    });

    it('starts collapsed and summarises stored content in the header', () => {
        render(
            <Harness
                coursePage={{
                    mode: 'LIVE',
                    faqs: [
                        { q: 'A?', a: '<p>a</p>' },
                        { q: 'B?', a: '<p>b</p>' },
                    ],
                }}
            />
        );
        expect(screen.getByText('Live · 2 FAQs')).toBeInTheDocument();
        expect(rows()).toHaveLength(0);
        openSection();
        expect(rows()).toHaveLength(2);
        expect(screen.getByText('FAQs · 2')).toBeInTheDocument();
        expect(screen.getByRole('radio', { name: 'Live' })).toHaveAttribute('aria-checked', 'true');
    });

    it('stays read-only while an edit is still loading the stored content', () => {
        render(<Harness status="loading" />);
        expect(screen.getByText('Loading…')).toBeInTheDocument();
        openSection();
        expect(screen.getByText(/Loading the saved course page content/)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /add faq/i })).not.toBeInTheDocument();
    });

    it('explains that nothing will change when the stored content could not be loaded', () => {
        render(<Harness status="unavailable" />);
        openSection();
        expect(screen.getByText(/saving leaves it unchanged/)).toBeInTheDocument();
        expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    });

    it('sets and clears the mode', () => {
        render(<Harness />);
        openSection();
        fireEvent.click(screen.getByRole('radio', { name: 'Self-paced' }));
        expect(formApi.getValues('coursePage.mode')).toBe('SELF_PACED');
        fireEvent.click(screen.getByRole('radio', { name: 'Not set' }));
        expect(formApi.getValues('coursePage.mode')).toBeNull();
    });

    it('adds, edits, reorders and removes FAQs', () => {
        render(<Harness />);
        openSection();
        expect(screen.getByText(/No FAQs yet/)).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /add faq/i }));
        fireEvent.click(screen.getByRole('button', { name: /add faq/i }));
        expect(rows()).toHaveLength(2);

        fireEvent.change(screen.getByLabelText('Question 1'), { target: { value: 'First?' } });
        fireEvent.change(screen.getByLabelText('Question 2'), { target: { value: 'Second?' } });
        fireEvent.change(within(rows()[1]!).getByLabelText('Answer'), {
            target: { value: '<p>Two</p>' },
        });
        expect(questions()).toEqual(['First?', 'Second?']);
        expect(screen.getByText('FAQs · 2')).toBeInTheDocument();

        expect(screen.getByRole('button', { name: 'Move question 1 up' })).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: 'Move question 2 up' }));
        expect(questions()).toEqual(['Second?', 'First?']);
        expect(formApi.getValues('coursePage.faqs.0.a')).toBe('<p>Two</p>');

        fireEvent.click(screen.getByRole('button', { name: 'Move question 1 down' }));
        expect(questions()).toEqual(['First?', 'Second?']);

        fireEvent.click(screen.getByRole('button', { name: 'Remove question 1' }));
        expect(questions()).toEqual(['Second?']);
        expect(rows()).toHaveLength(1);
    });

    it('stops adding at 30 FAQs', () => {
        render(
            <Harness
                coursePage={{
                    mode: null,
                    faqs: Array.from({ length: 30 }, (_, i) => ({ q: `Q${i}`, a: 'a' })),
                }}
            />
        );
        openSection();
        expect(screen.getByRole('button', { name: /add faq/i })).toBeDisabled();
        expect(screen.getByText(/Maximum of 30 FAQs reached/)).toBeInTheDocument();
    });

    it('drafts FAQs with AI into the list, replacing untouched blank rows', async () => {
        vi.mocked(generateCourseFieldText).mockResolvedValue({
            html: '<h3>Who is it for?</h3><p>Beginners.</p><h3>How long?</h3><p>Self-paced.</p>',
            model: 'test',
            credits_charged: 1,
        });
        render(<Harness coursePage={{ mode: null, faqs: [{ q: 'Mine?', a: '<p>Yes</p>' }] }} />);
        openSection();
        fireEvent.click(screen.getByRole('button', { name: /add faq/i }));
        expect(rows()).toHaveLength(2);

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /suggest faqs with ai/i }));
        });

        await waitFor(() => expect(questions()).toEqual(['Mine?', 'Who is it for?', 'How long?']));
        const payload = vi.mocked(generateCourseFieldText).mock.calls[0]![0];
        expect(payload.course_name).toBe('Touch Typing');
        expect(payload.prompt).toContain('Learn to type fast.');
    });
});
