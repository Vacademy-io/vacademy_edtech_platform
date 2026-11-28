import { describe, expect, it } from 'vitest';
import { outline, release } from '@/services/submission-review/test-fixtures';
import { canEditMarks, isImportedTotal } from './actions';

describe('canEditMarks', () => {
    it('follows can_edit before release and can_edit_after_release after', () => {
        expect(canEditMarks(outline())).toBe(true);
        const released = outline({ release: release({ status: 'RELEASED' }) });
        expect(canEditMarks(released)).toBe(true);
        expect(
            canEditMarks({
                ...released,
                permissions: { ...released.permissions, can_edit_after_release: false },
            })
        ).toBe(false);
    });

    it('an imported total (no question marks) is not edited one question at a time', () => {
        const imported = outline({ total_only: true, stored_total: 78, total: 78 });
        expect(isImportedTotal(imported)).toBe(true);
        expect(canEditMarks(imported)).toBe(false);
        // A copy with nothing marked yet (total 0) stays editable.
        expect(canEditMarks(outline({ total_only: true, stored_total: 0, total: 0 }))).toBe(true);
    });
});
