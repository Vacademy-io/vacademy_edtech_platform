import { memo } from 'react';
import { NodeProps } from 'reactflow';
import { Paperclip } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { BaseNodeShell } from './BaseNodeShell';
import type { PipelineNodeData } from '../-utils/build-pipeline-graph';

function PitchNodeInner({ data }: NodeProps<PipelineNodeData>) {
    const { t } = useTranslation('videoApiStudioPitchNode');
    const slot = data.state.pitch;
    const prompt = data.state.prompt || '';
    const refCount = slot.state === 'wrapped' ? slot.data.referenceCount : 0;

    return (
        <BaseNodeShell
            kind="pitch"
            state={slot.state}
            headerMeta={refCount > 0 ? t('headerRefs', { count: refCount }) : undefined}
        >
            <div className="space-y-1.5">
                <div className="text-2xs uppercase tracking-wider text-muted-foreground">
                    {t('briefLabel')}
                </div>
                {/* break-words guards against long unbroken URLs / fashion brand
                    names from forcing the node wider than NODE_SIZES allows. */}
                <p className="line-clamp-3 break-words text-xs leading-relaxed text-foreground">
                    {prompt}
                </p>
                {refCount > 0 && (
                    <div className="flex items-center gap-1 pt-1 text-2xs text-muted-foreground">
                        <Paperclip className="size-3" />
                        {t('referencesAttached', { count: refCount })}
                    </div>
                )}
            </div>
        </BaseNodeShell>
    );
}

export const PitchNode = memo(PitchNodeInner);
