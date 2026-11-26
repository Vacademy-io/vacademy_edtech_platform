import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import Evaluation from './evaluation';

vi.mock('react-i18next', async (importOriginal) => ({
    ...(await importOriginal<typeof import('react-i18next')>()),
    useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

const totalShown = () => screen.getByText('totalAwarded').nextElementSibling?.textContent;

const question = (id: string, totalMark: number) => ({
    question_id: id,
    question_order: 1,
    marking_json: JSON.stringify({ data: { totalMark } }),
    section_id: 's1',
    question: { content: '' },
});

describe('grading panel total', () => {
    it('stand-alone tool (no questions): no total row, so never "0 / 0"', () => {
        render(<Evaluation totalPages={2} pagesVisited={[1]} />);
        expect(screen.queryByText('totalAwarded')).toBeNull();
    });

    it('with a marking scheme: totals the questions out of their max', () => {
        render(
            <Evaluation
                totalPages={2}
                pagesVisited={[1]}
                questionData={{ s1: [question('q1', 2), question('q2', 3)] }}
            />
        );
        expect(totalShown()).toBe('0 / 5');
    });

    it('questions without a max: shows the awarded figure alone', () => {
        render(
            <Evaluation
                totalPages={2}
                pagesVisited={[1]}
                questionData={{ s1: [question('q1', 0)] }}
            />
        );
        expect(totalShown()).toBe('0');
    });
});
