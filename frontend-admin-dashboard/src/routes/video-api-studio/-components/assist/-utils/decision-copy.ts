import type { TFunction } from 'i18next';
import type {
    GateType,
    DecisionAnswer,
    DecisionRequest,
    AssistTurn,
    VideoStatusResponse,
} from '../../../-services/video-generation';

/**
 * Per-gate display copy for the assist conversation — parallels the pipeline's
 * `stage-vocab.ts`. Keeps titles/blurbs consistent across the chat header, the
 * decision cards, and the resolved-turn transcript.
 *
 * Namespace for this module's translated display strings — see
 * src/locales/en/videoApiStudioDecisionCopy.json. The `buildXxx(t)` factories
 * below re-derive their English-source constants with translated text. `gate`
 * / `GateType` values are never translated — they're used for dispatch,
 * keying, and the request payload sent to the backend.
 */
const NS = 'videoApiStudioDecisionCopy';

export interface GateMeta {
    title: string;
    blurb: string;
}

/** Translated `title`/`blurb` per gate — same keys/order as the old GATE_META constant. */
export function buildGateMeta(t: TFunction): Record<GateType, GateMeta> {
    return {
        creative_concept: {
            title: t(`${NS}:gateMeta.creativeConcept.title`),
            blurb: t(`${NS}:gateMeta.creativeConcept.blurb`),
        },
        shot_plan: {
            title: t(`${NS}:gateMeta.shotPlan.title`),
            blurb: t(`${NS}:gateMeta.shotPlan.blurb`),
        },
        styleframe: {
            title: t(`${NS}:gateMeta.styleframe.title`),
            blurb: t(`${NS}:gateMeta.styleframe.blurb`),
        },
        narration: {
            title: t(`${NS}:gateMeta.narration.title`),
            blurb: t(`${NS}:gateMeta.narration.blurb`),
        },
        visual_casting: {
            title: t(`${NS}:gateMeta.visualCasting.title`),
            blurb: t(`${NS}:gateMeta.visualCasting.blurb`),
        },
        shot_look: {
            title: t(`${NS}:gateMeta.shotLook.title`),
            blurb: t(`${NS}:gateMeta.shotLook.blurb`),
        },
        contact_sheet: {
            title: t(`${NS}:gateMeta.contactSheet.title`),
            blurb: t(`${NS}:gateMeta.contactSheet.blurb`),
        },
        asset_request: {
            title: t(`${NS}:gateMeta.assetRequest.title`),
            blurb: t(`${NS}:gateMeta.assetRequest.blurb`),
        },
        cast: {
            title: t(`${NS}:gateMeta.cast.title`),
            blurb: t(`${NS}:gateMeta.cast.blurb`),
        },
        dailies: {
            title: t(`${NS}:gateMeta.dailies.title`),
            blurb: t(`${NS}:gateMeta.dailies.blurb`),
        },
        voice: {
            title: t(`${NS}:gateMeta.voice.title`),
            blurb: t(`${NS}:gateMeta.voice.blurb`),
        },
        music: {
            title: t(`${NS}:gateMeta.music.title`),
            blurb: t(`${NS}:gateMeta.music.blurb`),
        },
        avatar: {
            title: t(`${NS}:gateMeta.avatar.title`),
            blurb: t(`${NS}:gateMeta.avatar.blurb`),
        },
    };
}

export function gateTitle(gate: GateType, t: TFunction): string {
    return buildGateMeta(t)[gate]?.title ?? gate;
}

/** Canonical agent question per gate — used when reconstructing past turns. */
function buildGatePrompt(t: TFunction): Record<GateType, string> {
    return {
        creative_concept: t(`${NS}:gatePrompt.creativeConcept`),
        shot_plan: t(`${NS}:gatePrompt.shotPlan`),
        styleframe: t(`${NS}:gatePrompt.styleframe`),
        narration: t(`${NS}:gatePrompt.narration`),
        visual_casting: t(`${NS}:gatePrompt.visualCasting`),
        shot_look: t(`${NS}:gatePrompt.shotLook`),
        contact_sheet: t(`${NS}:gatePrompt.contactSheet`),
        asset_request: t(`${NS}:gatePrompt.assetRequest`),
        cast: t(`${NS}:gatePrompt.cast`),
        dailies: t(`${NS}:gatePrompt.dailies`),
        voice: t(`${NS}:gatePrompt.voice`),
        music: t(`${NS}:gatePrompt.music`),
        avatar: t(`${NS}:gatePrompt.avatar`),
    };
}

/** Summary of a recorded answer (from the backend ledger), for the transcript. */
function summarizeLedger(
    gate: GateType,
    mode: string,
    answer: Record<string, unknown> | undefined,
    t: TFunction
): string {
    const label = gateTitle(gate, t).toLowerCase();
    switch (mode) {
        case 'auto':
            return t(`${NS}:ledgerSummary.auto`, { label });
        case 'auto_all':
            return t(`${NS}:ledgerSummary.autoAll`, { label });
        case 'select':
            return t(`${NS}:ledgerSummary.select`, { label });
        case 'freeform':
            return t(`${NS}:ledgerSummary.freeform`, {
                text: String((answer as { text?: string })?.text ?? '').slice(0, 80),
            });
        case 'edit':
            if (gate === 'shot_plan') return t(`${NS}:ledgerSummary.editShotPlan`);
            if (gate === 'styleframe') return t(`${NS}:ledgerSummary.editStyleframe`);
            if (gate === 'narration') return t(`${NS}:ledgerSummary.editNarration`);
            if (gate === 'contact_sheet') {
                const n = ((answer as { regens?: unknown[] })?.regens ?? []).length;
                return t(`${NS}:ledgerSummary.editContactSheet`, { count: n });
            }
            if (gate === 'asset_request') {
                const rs = (answer as { responses?: Array<{ skipped?: boolean }> })?.responses ?? [];
                const n = rs.filter((r) => !r?.skipped).length;
                return n > 0
                    ? t(`${NS}:ledgerSummary.editAssetRequestProvided`, { count: n })
                    : t(`${NS}:ledgerSummary.editAssetRequestSkipped`);
            }
            if (gate === 'cast') {
                const n = ((answer as { characters?: unknown[] })?.characters ?? []).length;
                return n > 0
                    ? t(`${NS}:ledgerSummary.editCastUpdated`, { count: n })
                    : t(`${NS}:ledgerSummary.editCastApproved`);
            }
            if (gate === 'dailies') {
                const n = ((answer as { clips?: unknown[] })?.clips ?? []).length;
                return n > 0
                    ? t(`${NS}:ledgerSummary.editDailiesSent`, { count: n })
                    : t(`${NS}:ledgerSummary.editDailiesApproved`);
            }
            return t(`${NS}:ledgerSummary.editDefault`);
        default:
            return t(`${NS}:ledgerSummary.resolved`, { label });
    }
}

/**
 * Rebuild the conversation transcript from the backend's answered-decisions
 * ledger. Used when a finished video loads fresh (Recent / deep-link / reload)
 * and the in-memory transcript is gone.
 */
export function reconstructAssistTranscript(
    status: VideoStatusResponse | null | undefined,
    t: TFunction
): AssistTurn[] {
    const assist = (status?.metadata as { assist?: { answered_decisions?: unknown[] } } | null)
        ?.assist;
    const answered = (assist?.answered_decisions ?? []) as Array<{
        decision_id?: string;
        _key?: string;
        gate_type?: GateType;
        mode?: string;
        answer?: Record<string, unknown>;
        answered_at?: string;
    }>;
    const gatePrompt = buildGatePrompt(t);
    return answered
        .filter((r) => r && r.gate_type)
        .map((r) => ({
            decision_id: r.decision_id ?? `${r.gate_type}:${r._key ?? ''}`,
            gate_type: r.gate_type as GateType,
            prompt: gatePrompt[r.gate_type as GateType] ?? gateTitle(r.gate_type as GateType, t),
            answer_summary: summarizeLedger(r.gate_type as GateType, r.mode ?? 'select', r.answer, t),
            answered_at: r.answered_at ? Date.parse(r.answered_at) || 0 : 0,
        }));
}

/** Short human summary of what the user answered, for the transcript. */
export function buildTurnSummary(decision: DecisionRequest, answer: DecisionAnswer, t: TFunction): string {
    const label = gateTitle(decision.gate_type, t);
    const labelLower = label.toLowerCase();
    switch (answer.kind) {
        case 'accept_recommended':
            return t(`${NS}:turnSummary.acceptRecommended`, { label: labelLower });
        case 'choose_option':
            return t(`${NS}:turnSummary.chooseOption`, { label: labelLower });
        case 'freeform':
            return t(`${NS}:turnSummary.freeform`, { text: answer.text.slice(0, 80) });
        case 'auto':
            return t(`${NS}:turnSummary.auto`, { label: labelLower });
        case 'auto_all':
            return t(`${NS}:turnSummary.autoAll`, { label: labelLower });
        case 'edit':
            if (answer.gate_type === 'shot_plan')
                return t(`${NS}:turnSummary.editShotPlan`, { count: answer.shots.length });
            if (answer.gate_type === 'styleframe') return t(`${NS}:turnSummary.editStyleframe`);
            if (answer.gate_type === 'narration') return t(`${NS}:turnSummary.editNarration`);
            if (answer.gate_type === 'creative_concept') return t(`${NS}:turnSummary.editCreativeConcept`);
            if (answer.gate_type === 'contact_sheet')
                return t(`${NS}:turnSummary.editContactSheet`, { count: answer.regens.length });
            if (answer.gate_type === 'asset_request') {
                const n = answer.responses.filter((r) => !r.skipped).length;
                return n > 0
                    ? t(`${NS}:turnSummary.editAssetRequestProvided`, { count: n })
                    : t(`${NS}:turnSummary.editAssetRequestSkipped`);
            }
            if (answer.gate_type === 'cast')
                return t(`${NS}:turnSummary.editCast`, { count: answer.characters.length });
            if (answer.gate_type === 'dailies')
                return t(`${NS}:turnSummary.editDailies`, { count: answer.clips.length });
            return t(`${NS}:turnSummary.editDefault`, { count: answer.selections.length });
        default:
            return t(`${NS}:turnSummary.resolved`, { label: labelLower });
    }
}
