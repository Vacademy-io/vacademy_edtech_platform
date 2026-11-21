import { describe, expect, it } from 'vitest';
import { displayStatus } from './lead-lookup-follow-ups';

const NOW = new Date(2026, 9, 29, 14, 30, 0);

describe('displayStatus', () => {
    const thisMorning = new Date(2026, 9, 29, 9, 0, 0).toISOString();
    const yesterday = new Date(2026, 9, 28, 9, 0, 0).toISOString();

    it('by default shows the stored status, as before', () => {
        expect(displayStatus('OVERDUE', thisMorning, false, NOW)).toBe('OVERDUE');
    });

    it('with overdue-by-date, an OVERDUE follow-up due today reads Ongoing', () => {
        expect(displayStatus('OVERDUE', thisMorning, true, NOW)).toBe('ONGOING');
    });

    it('with overdue-by-date, a past date stays Overdue', () => {
        expect(displayStatus('OVERDUE', yesterday, true, NOW)).toBe('OVERDUE');
    });

    it('treats a zone-less timestamp as UTC', () => {
        const zoneless = new Date(2026, 9, 29, 9, 0, 0).toISOString().replace('Z', '');
        expect(displayStatus('OVERDUE', zoneless, true, NOW)).toBe('ONGOING');
    });

    it('never touches other statuses', () => {
        expect(displayStatus('PENDING', yesterday, true, NOW)).toBe('PENDING');
        expect(displayStatus('COMPLETED', thisMorning, true, NOW)).toBe('COMPLETED');
    });
});
