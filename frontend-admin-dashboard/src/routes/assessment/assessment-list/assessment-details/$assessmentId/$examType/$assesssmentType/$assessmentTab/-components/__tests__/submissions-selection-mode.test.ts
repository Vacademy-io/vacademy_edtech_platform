import { describe, expect, it } from 'vitest';
import {
    createLatestRequestGuard,
    initialSelectionMode,
    registrationSourceForMode,
    selectionModeCorrection,
} from '../submissions-selection-mode';

describe('initialSelectionMode', () => {
    it('opens an individual-only assessment (e.g. API candidates) on Individual', () => {
        expect(initialSelectionMode(false, true)).toBe('individual');
        expect(registrationSourceForMode(initialSelectionMode(false, true))).toBe(
            'ADMIN_PRE_REGISTRATION'
        );
    });

    it('keeps the Batch default for batch-only, mixed and empty assessments', () => {
        expect(initialSelectionMode(true, false)).toBe('batch');
        expect(initialSelectionMode(true, true)).toBe('batch');
        expect(initialSelectionMode(false, false)).toBe('batch');
        expect(registrationSourceForMode('batch')).toBe('BATCH_PREVIEW_REGISTRATION');
    });

    it('needs no correction on mount, so the mount fetch is the only request', () => {
        for (const hasBatch of [true, false]) {
            for (const hasIndividual of [true, false]) {
                const mode = initialSelectionMode(hasBatch, hasIndividual);
                expect(selectionModeCorrection(mode, hasBatch, hasIndividual)).toBeNull();
            }
        }
    });
});

describe('selectionModeCorrection', () => {
    it('snaps to the mode that has learners', () => {
        expect(selectionModeCorrection('batch', false, true)).toBe('individual');
        expect(selectionModeCorrection('individual', true, false)).toBe('batch');
    });

    it('stays put when the current mode has learners or neither has any', () => {
        expect(selectionModeCorrection('batch', true, true)).toBeNull();
        expect(selectionModeCorrection('individual', true, true)).toBeNull();
        expect(selectionModeCorrection('batch', false, false)).toBeNull();
        expect(selectionModeCorrection('individual', false, false)).toBeNull();
    });
});

describe('createLatestRequestGuard', () => {
    it('lets only the newest request replace the table, whatever order responses land in', () => {
        const guard = createLatestRequestGuard();
        const mountFetch = guard.begin();
        const individualSwitch = guard.begin();
        // The newer response lands first, then the stale one: the stale one is dropped.
        expect(guard.isLatest(individualSwitch)).toBe(true);
        expect(guard.isLatest(mountFetch)).toBe(false);
    });

    it('is independent per guard', () => {
        const a = createLatestRequestGuard();
        const b = createLatestRequestGuard();
        const ta = a.begin();
        b.begin();
        b.begin();
        expect(a.isLatest(ta)).toBe(true);
    });
});
