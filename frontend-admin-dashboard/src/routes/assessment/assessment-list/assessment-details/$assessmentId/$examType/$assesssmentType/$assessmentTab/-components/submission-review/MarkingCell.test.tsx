import { render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';
import { setupTestI18n } from '@/services/submission-review/test-i18n';
import { attemptMarking, counts } from '@/services/submission-review/test-fixtures';
import { MarkingChip } from './MarkingChip';

beforeAll(async () => {
    await setupTestI18n();
});

describe('MarkingChip (W1 Marking column)', () => {
    it('acceptance 1: an online test with one unmarked CBE answer reads "Needs marking (1)"', () => {
        render(<MarkingChip marking={attemptMarking({ marking: 'NEEDS_MARKING', counts: counts({ needs_marking: 1, marked: 1 }) })} />);
        expect(screen.getByText('Needs marking (1)')).toBeInTheDocument();
    });

    it('shows AI drafts as "Check AI marks (n)" and a finished submission as "Done"', () => {
        const { rerender } = render(
            <MarkingChip marking={attemptMarking({ marking: 'CHECK_AI', counts: counts({ ai_draft: 2 }) })} />
        );
        expect(screen.getByText('Check AI marks (2)')).toBeInTheDocument();
        rerender(<MarkingChip marking={attemptMarking({ marking: 'DONE' })} />);
        expect(screen.getByText('Done')).toBeInTheDocument();
    });
});
