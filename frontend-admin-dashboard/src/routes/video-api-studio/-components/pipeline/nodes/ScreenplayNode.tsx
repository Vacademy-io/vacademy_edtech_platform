import { memo, useEffect, useState } from 'react';
import { NodeProps } from 'reactflow';
import { useTranslation } from 'react-i18next';
import { ArrowSquareOut, FileText, CircleNotch } from '@phosphor-icons/react';
import { BaseNodeShell } from './BaseNodeShell';
import { buildActiveSubStatus } from '../-utils/stage-vocab';
import { fetchScriptText } from '../../../-services/video-generation';
import type { PipelineNodeData } from '../-utils/build-pipeline-graph';

const PREVIEW_LEN = 220;

function ScreenplayNodeInner({ data }: NodeProps<PipelineNodeData>) {
    const { t } = useTranslation('videoApiStudioStageVocab');
    const slot = data.state.screenplay;
    const scriptUrl = slot.state === 'wrapped' ? slot.data.scriptUrl : undefined;

    const [text, setText] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    useEffect(() => {
        if (!scriptUrl || text != null) return;
        setLoading(true);
        fetchScriptText(scriptUrl)
            .then((raw) => {
                // Script files can be JSON or plain text — extract narration field if present.
                let display = raw;
                try {
                    const parsed = JSON.parse(raw);
                    display =
                        parsed.script ||
                        parsed.narration ||
                        parsed.narration_script ||
                        parsed.text ||
                        raw;
                } catch {
                    /* leave as raw text */
                }
                setText(display);
            })
            .catch(() => setText(null))
            .finally(() => setLoading(false));
    }, [scriptUrl, text]);

    if (slot.state !== 'wrapped') {
        return (
            <BaseNodeShell kind="screenplay" state={slot.state}>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {slot.state === 'in_production' ? (
                        <>
                            <CircleNotch className="size-3.5 animate-spin text-blue-600" />
                            {buildActiveSubStatus(t).screenplay}
                        </>
                    ) : (
                        <>
                            <FileText className="size-3.5 text-muted-foreground/60" />
                            Awaiting brief approval…
                        </>
                    )}
                </div>
            </BaseNodeShell>
        );
    }

    const display = text ? text.slice(0, PREVIEW_LEN) : '';

    return (
        <BaseNodeShell kind="screenplay" state={slot.state}>
            {loading && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <CircleNotch className="size-3 animate-spin" /> Loading screenplay…
                </div>
            )}
            {!loading && text && (
                <div className="space-y-2">
                    <p className="line-clamp-3 whitespace-pre-wrap break-words text-xs leading-relaxed text-foreground/90">
                        {display}
                        {text.length > PREVIEW_LEN ? '…' : ''}
                    </p>
                    {scriptUrl && (
                        <a
                            href={scriptUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-2xs font-medium text-blue-600 hover:text-blue-700"
                        >
                            Open full screenplay
                            <ArrowSquareOut className="size-3" />
                        </a>
                    )}
                </div>
            )}
            {!loading && !text && scriptUrl && (
                <a
                    href={scriptUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-2xs font-medium text-blue-600 hover:text-blue-700"
                >
                    Open screenplay <ArrowSquareOut className="size-3" />
                </a>
            )}
        </BaseNodeShell>
    );
}

export const ScreenplayNode = memo(ScreenplayNodeInner);
