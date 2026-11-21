import type { TFunction } from 'i18next';
import type { PipelineState, NodeState } from '../../pipeline/-utils/derive-pipeline-state';
import { buildNodeLabels, type PipelineNodeId } from '../../pipeline/-utils/stage-vocab';

export interface StageRow {
    id: string;
    label: string;
    state: NodeState;
    /** Optional inline counter, e.g. "3/8" for Filming. */
    detail?: string;
}

/**
 * Flatten a PipelineState into the same ordered stage list the diagram's
 * "Production schedule" shows (mirrors PipelinePanel.stagesList), so the chat's
 * live status stays consistent with the diagram. v2/v3-aware; hides optional
 * stages that aren't present on this run.
 *
 * `t` is the caller's own bound `TFunction` (any namespace) — labels are
 * resolved against `stage-vocab`'s `videoApiStudioStageVocab` namespace
 * explicitly via `buildNodeLabels`, so the caller doesn't need a second
 * `useTranslation` call.
 */
export function buildStageRows(state: PipelineState, t: TFunction): StageRow[] {
    const nodeLabels = buildNodeLabels(t);
    const isV3 = state.pipelineVersion === 'v3';
    const order: PipelineNodeId[] = [
        ...(state.research ? (['research'] as PipelineNodeId[]) : []),
        ...(isV3
            ? ([
                  ...(state.shotPlanner ? ['shotPlanner'] : []),
                  ...(state.narrationWriter ? ['narrationWriter'] : []),
              ] as PipelineNodeId[])
            : ([
                  ...(state.beats ? ['beats'] : []),
                  'screenplay',
                  'narration',
                  'storyboard',
              ] as PipelineNodeId[])),
        'filming',
        ...(state.talent ? (['talent'] as PipelineNodeId[]) : []),
        ...(state.score ? (['score'] as PipelineNodeId[]) : []),
        'finalCut',
    ];

    return order.map((id) => {
        const slot = (state as unknown as Record<string, { state?: NodeState } | undefined>)[id];
        const slotState: NodeState = slot?.state ?? 'scheduled';
        let detail: string | undefined;
        if (id === 'filming' && state.scenes.length > 0) {
            const wrapped = state.scenes.filter((s) => s.state === 'wrapped').length;
            const total = state.scenes.length;
            if (!(state.filming.state === 'wrapped' && wrapped === total)) {
                detail = `${wrapped}/${total}`;
            }
        }
        return { id, label: nodeLabels[id], state: slotState, detail };
    });
}
