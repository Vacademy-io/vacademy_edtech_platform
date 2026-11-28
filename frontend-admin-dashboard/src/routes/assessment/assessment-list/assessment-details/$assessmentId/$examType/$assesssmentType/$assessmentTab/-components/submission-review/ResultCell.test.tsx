import { render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';
import { setupTestI18n } from '@/services/submission-review/test-i18n';
import { attemptMarking } from '@/services/submission-review/test-fixtures';
import { ResultView } from './ResultView';

beforeAll(async () => {
    await setupTestI18n();
});

describe('ResultView (W1 Result column)', () => {
    it('acceptance 2: released with an unmarked answer shows ⚠ with the count in its tooltip', () => {
        render(<ResultView marking={attemptMarking({ result: 'RELEASED', released_with_unmarked: 1 })} />);
        expect(screen.getByText('Released')).toBeInTheDocument();
        expect(screen.getByRole('img', { name: 'Released with 1 answer not marked' })).toHaveAttribute(
            'title',
            'Released with 1 answer not marked'
        );
    });

    it('acceptance 3: a change after release reads "Released, changed (update not sent)"', () => {
        render(<ResultView marking={attemptMarking({ result: 'RELEASED_CHANGED' })} />);
        expect(screen.getByText('Released, changed (update not sent)')).toBeInTheDocument();
        expect(screen.queryByRole('img')).not.toBeInTheDocument();
    });

    it('falls back to the row status while the marking status is unknown', () => {
        render(<ResultView marking={null} legacyStatus="RELEASED" />);
        expect(screen.getByText('Released')).toBeInTheDocument();
    });

    it('plural tooltip for several unmarked answers', () => {
        render(<ResultView marking={attemptMarking({ result: 'RELEASED', released_with_unmarked: 3 })} />);
        expect(screen.getByRole('img', { name: 'Released with 3 answers not marked' })).toBeInTheDocument();
    });
});
