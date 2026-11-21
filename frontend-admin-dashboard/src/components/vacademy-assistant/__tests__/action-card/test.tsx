import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ActionCardLines } from '../../VacademyAssistant';
import { actionStatusFrom, cardLines } from '../../useVacademyAssistant';

describe('confirmation card lines', () => {
    it('keeps only non-empty strings, at most 20', () => {
        expect(cardLines(undefined)).toBeUndefined();
        expect(cardLines('one line')).toBeUndefined();
        expect(cardLines(['', '  ', 3, null])).toBeUndefined();
        expect(cardLines(['Priya (******3210): New → Contacted', 7, ''])).toEqual([
            'Priya (******3210): New → Contacted',
        ]);
        expect(cardLines(Array.from({ length: 30 }, (_, i) => `lead ${i}`))).toHaveLength(20);
    });

    it('shows what changes and the warnings under the summary', () => {
        render(
            <ActionCardLines
                details={['Priya (******3210): New → Converted', '… and 3 more']}
                warnings={['This person has no course or fee plan here yet.']}
            />
        );
        expect(screen.getByText('Priya (******3210): New → Converted')).toBeTruthy();
        expect(screen.getByText('… and 3 more')).toBeTruthy();
        const warning = screen.getByText('This person has no course or fee plan here yet.');
        expect(warning.closest('ul')?.getAttribute('aria-label')).toBe('Before you confirm');
    });

    it('renders nothing for a card without lines', () => {
        const { container } = render(<ActionCardLines />);
        expect(container.innerHTML).toBe('');
    });

    it('shows a second Confirm of a card being applied as in progress, not failed', () => {
        expect(actionStatusFrom('executing')).toBe('applying');
        expect(actionStatusFrom('executed')).toBe('executed');
        expect(actionStatusFrom('pending')).toBe('pending');
        expect(actionStatusFrom('expired')).toBe('expired');
        expect(actionStatusFrom('cancelled')).toBe('cancelled');
        expect(actionStatusFrom('failed')).toBe('failed');
        expect(actionStatusFrom('denied')).toBe('failed');
    });
});
