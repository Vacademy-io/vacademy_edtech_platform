import { useState } from 'react';
import { useForm, type UseFormReturn } from 'react-hook-form';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

import { Form } from '@/components/ui/form';
import {
    buildCoursePageJson,
    emptyCoursePageContent,
    parseCoursePageJson,
    type CoursePageContent,
} from '../-utils/course-page-content';
import type { Step1Data } from './add-course-step1';
import { CoursePageSection } from './course-page-section';

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
vi.mock('@/hooks/use-file-upload', () => ({
    useFileUpload: () => ({ uploadFile: vi.fn(async () => 'file-1') }),
}));
vi.mock('@/services/upload_file', () => ({
    getPublicUrl: vi.fn(async (id: string) => `https://cdn.example/${id}.png`),
}));
vi.mock('@/lib/auth/instituteUtils', () => ({ getCurrentInstituteId: () => 'inst-1' }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

let formApi: UseFormReturn<Step1Data>;

const Harness = ({ coursePage }: { coursePage?: CoursePageContent }) => {
    const form = useForm<Step1Data>({
        defaultValues: {
            course: 'Touch Typing',
            courseMedia: { type: '', id: '' },
            tags: [],
            coursePage: coursePage ?? emptyCoursePageContent(),
        },
    });
    formApi = form;
    const [open, setOpen] = useState(true);
    return (
        <QueryClientProvider client={new QueryClient()}>
            <Form {...form}>
                <CoursePageSection form={form} courseTerm="Course" open={open} onOpenChange={setOpen} />
            </Form>
        </QueryClientProvider>
    );
};

const openTemplate = () =>
    fireEvent.click(screen.getByRole('button', { name: /page template content/i }));
const payload = () =>
    buildCoursePageJson(formApi.getValues('coursePage'), { isEdit: true, storedValueLoaded: true });

describe('Page template content', () => {
    it('is collapsed by default and adds nothing to the saved value when untouched', () => {
        render(
            <Harness
                coursePage={{
                    ...emptyCoursePageContent(),
                    mode: 'LIVE',
                    faqs: [{ q: 'Q', a: '<p>A</p>' }],
                }}
            />
        );
        expect(screen.queryByLabelText('Tagline')).toBeNull();
        // Same JSON the form saved before template content existed.
        expect(JSON.parse(payload() as string)).toEqual({
            v: 1,
            mode: 'LIVE',
            faqs: [{ q: 'Q', a: '<p>A</p>' }],
        });
    });

    it('saves typed content next to the existing mode and FAQs', () => {
        render(
            <Harness coursePage={{ ...emptyCoursePageContent(), faqs: [{ q: 'Q', a: '<p>A</p>' }] }} />
        );
        openTemplate();
        fireEvent.change(screen.getByLabelText('Tagline'), { target: { value: 'A calm start' } });
        fireEvent.click(screen.getAllByRole('button', { name: /add card/i })[0]!);
        fireEvent.change(screen.getByLabelText('Card title'), { target: { value: 'Observe' } });
        fireEvent.change(screen.getByLabelText('Points'), { target: { value: 'See\nNote' } });
        fireEvent.click(screen.getByRole('button', { name: /add review/i }));
        fireEvent.change(screen.getByLabelText('Quote'), { target: { value: 'Loved it' } });
        fireEvent.change(screen.getByLabelText('Reviewer name'), { target: { value: 'A. Learner' } });
        fireEvent.change(screen.getByLabelText('Inclusions'), { target: { value: 'Videos\nWorksheets' } });

        const saved = JSON.parse(payload() as string);
        expect(saved.faqs).toEqual([{ q: 'Q', a: '<p>A</p>' }]);
        expect(saved.template).toEqual({
            tagline: 'A calm start',
            framework: { cards: [{ title: 'Observe', points: ['See', 'Note'] }] },
            testimonials: [{ quote: 'Loved it', name: 'A. Learner' }],
            inclusions: { items: ['Videos', 'Worksheets'] },
        });
        expect(parseCoursePageJson(payload()).template.tagline).toBe('A calm start');
        expect(screen.getByText('1 FAQ · Template content')).toBeTruthy();
    });

    it('shows stored template content and removes a card', () => {
        const stored = parseCoursePageJson(
            JSON.stringify({
                v: 1,
                faqs: [],
                template: { framework: { cards: [{ title: 'One' }, { title: 'Two' }] } },
            })
        );
        render(<Harness coursePage={stored} />);
        openTemplate();
        expect(screen.getAllByLabelText('Card title')).toHaveLength(2);
        fireEvent.click(screen.getByRole('button', { name: 'Remove card 1' }));
        expect(formApi.getValues('coursePage.template.framework.cards').map((c) => c.title)).toEqual([
            'Two',
        ]);
    });
});
