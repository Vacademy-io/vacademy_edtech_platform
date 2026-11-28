/**
 * Proctoring tiers and the per-assessment config (assessment_service V48).
 *
 * The catalogue is the one place that says which tiers exist, what each one
 * does and whether it can be picked yet. The backend enum
 * (ProctoringTier.java) is the source of truth for what is *storable*; this
 * list is what the wizard *offers*, so a tier can be announced here as
 * "coming soon" before its runtime ships.
 */
export type ProctoringTier = 'NONE' | 'BASIC' | 'PRO' | 'ULTRA';

/** Wire shape — snake_case, as stored and as the learner runtime reads it. */
export interface ProctoringConfigWire {
    tier: ProctoringTier | string;
    camera_required?: boolean | null;
    snapshot_interval_sec?: number | null;
    face_check?: boolean | null;
    max_violations?: number | null;
    show_self_view?: boolean | null;
}

/** Form shape — what the Step 1 form holds. */
export interface ProctoringConfigForm {
    tier: ProctoringTier;
    cameraRequired: boolean;
    snapshotIntervalSec: number;
    faceCheck: boolean;
    maxViolations: number;
    showSelfView: boolean;
}

export interface ProctoringTierOption {
    tier: ProctoringTier;
    /** Selectable today. Others render as "coming soon". */
    available: boolean;
}

export const PROCTORING_TIERS: ProctoringTierOption[] = [
    { tier: 'NONE', available: true },
    { tier: 'BASIC', available: true },
    { tier: 'PRO', available: false },
    { tier: 'ULTRA', available: false },
];

export const PROCTORING_SNAPSHOT_INTERVALS = [15, 30, 60, 120] as const;

export const DEFAULT_PROCTORING_FORM: ProctoringConfigForm = {
    tier: 'NONE',
    cameraRequired: true,
    snapshotIntervalSec: 30,
    faceCheck: true,
    maxViolations: 0,
    showSelfView: true,
};

export const proctoringFormFromWire = (
    wire: ProctoringConfigWire | null | undefined
): ProctoringConfigForm => {
    const tier = (String(wire?.tier ?? 'NONE').toUpperCase() as ProctoringTier) || 'NONE';
    const known = PROCTORING_TIERS.some((t) => t.tier === tier);
    return {
        tier: known ? tier : 'NONE',
        cameraRequired: wire?.camera_required ?? DEFAULT_PROCTORING_FORM.cameraRequired,
        snapshotIntervalSec:
            wire?.snapshot_interval_sec ?? DEFAULT_PROCTORING_FORM.snapshotIntervalSec,
        faceCheck: wire?.face_check ?? DEFAULT_PROCTORING_FORM.faceCheck,
        maxViolations: wire?.max_violations ?? DEFAULT_PROCTORING_FORM.maxViolations,
        showSelfView: wire?.show_self_view ?? DEFAULT_PROCTORING_FORM.showSelfView,
    };
};

export const proctoringWireFromForm = (form: ProctoringConfigForm): ProctoringConfigWire => ({
    tier: form.tier,
    camera_required: form.cameraRequired,
    snapshot_interval_sec: form.snapshotIntervalSec,
    face_check: form.faceCheck,
    max_violations: form.maxViolations,
    show_self_view: form.showSelfView,
});
