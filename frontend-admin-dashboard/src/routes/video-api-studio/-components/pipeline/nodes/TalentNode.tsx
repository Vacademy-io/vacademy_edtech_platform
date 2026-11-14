import { memo } from 'react';
import { NodeProps } from 'reactflow';
import { useTranslation } from 'react-i18next';
import { CircleNotch, UserSquare } from '@phosphor-icons/react';
import { BaseNodeShell } from './BaseNodeShell';
import { buildActiveSubStatus } from '../-utils/stage-vocab';
import type { PipelineNodeData } from '../-utils/build-pipeline-graph';

const PREVIEW_TAKES = 4;

function TalentNodeInner({ data }: NodeProps<PipelineNodeData>) {
    const { t } = useTranslation('videoApiStudioStageVocab');
    const slot = data.state.talent;
    if (!slot) return null;

    if (slot.state === 'scheduled') {
        return (
            <BaseNodeShell kind="talent" state={slot.state}>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <UserSquare className="size-3.5 text-muted-foreground/60" />
                    Talent on call sheet
                </div>
            </BaseNodeShell>
        );
    }

    if (slot.state === 'cut' || slot.state === 'reshoot') {
        return (
            <BaseNodeShell kind="talent" state={slot.state}>
                <p className="text-2xs text-red-700">{slot.error}</p>
            </BaseNodeShell>
        );
    }

    if (slot.state === 'in_production') {
        const completed = slot.partialData?.completed ?? 0;
        const total = slot.partialData?.total ?? 0;
        return (
            <BaseNodeShell
                kind="talent"
                state={slot.state}
                headerMeta={total > 0 ? `${completed} / ${total}` : undefined}
            >
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <CircleNotch className="size-3.5 animate-spin text-blue-600" />
                    {total > 0
                        ? `Recording take ${Math.min(completed + 1, total)} of ${total}`
                        : buildActiveSubStatus(t).talent}
                </div>
            </BaseNodeShell>
        );
    }

    if (slot.state !== 'wrapped') return null;

    const takes = slot.data.takes ?? [];
    const total = slot.data.total || takes.length;
    const visibleTakes = takes
        .filter((t) => t.hostImageUrl || t.avatarVideoUrl)
        .slice(0, PREVIEW_TAKES);

    return (
        <BaseNodeShell
            kind="talent"
            state={slot.state}
            headerMeta={total > 0 ? `${total} take${total === 1 ? '' : 's'}` : undefined}
        >
            {visibleTakes.length > 0 ? (
                <div className="flex items-center gap-1.5">
                    {visibleTakes.map((t) => (
                        <div
                            key={t.shotIndex}
                            className="size-9 shrink-0 overflow-hidden rounded-md border bg-gray-100"
                            title={`Take ${t.shotIndex + 1}`}
                        >
                            {t.hostImageUrl ? (
                                <img
                                    src={t.hostImageUrl}
                                    alt={`Take ${t.shotIndex + 1}`}
                                    className="size-full object-cover"
                                    loading="lazy"
                                />
                            ) : (
                                <div className="flex size-full items-center justify-center">
                                    <UserSquare className="size-4 text-muted-foreground/60" />
                                </div>
                            )}
                        </div>
                    ))}
                    {takes.length > visibleTakes.length && (
                        <span className="text-2xs text-muted-foreground">
                            +{takes.length - visibleTakes.length}
                        </span>
                    )}
                </div>
            ) : (
                <p className="text-2xs text-muted-foreground">Performance in the can</p>
            )}
        </BaseNodeShell>
    );
}

export const TalentNode = memo(TalentNodeInner);
