import { memo } from 'react';
import { NodeProps } from 'reactflow';
import { useTranslation } from 'react-i18next';
import { Globe as Globe2, CircleNotch as Loader2, MagnifyingGlass as Search } from '@phosphor-icons/react';
import { BaseNodeShell } from './BaseNodeShell';
import { buildActiveSubStatus } from '../-utils/stage-vocab';
import type { PipelineNodeData } from '../-utils/build-pipeline-graph';

const PREVIEW_SOURCES = 3;

function ResearchNodeInner({ data }: NodeProps<PipelineNodeData>) {
    const { t } = useTranslation('videoApiStudioStageVocab');
    const slot = data.state.research;
    if (!slot) return null;

    if (slot.state === 'scheduled') {
        return (
            <BaseNodeShell kind="research" state={slot.state}>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Globe2 className="size-3.5 text-muted-foreground/60" />
                    Research desk on standby
                </div>
            </BaseNodeShell>
        );
    }

    if (slot.state === 'cut' || slot.state === 'reshoot') {
        return (
            <BaseNodeShell kind="research" state={slot.state}>
                <p className="text-2xs text-red-700">{slot.error}</p>
            </BaseNodeShell>
        );
    }

    if (slot.state === 'in_production') {
        return (
            <BaseNodeShell kind="research" state={slot.state}>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin text-blue-600" />
                    {buildActiveSubStatus(t).research}
                </div>
            </BaseNodeShell>
        );
    }

    if (slot.state !== 'wrapped') return null;

    const { scrapedAny, searchedAny, screenshots, sources, urlsAttempted, searchQuery } = slot.data;
    const urlCount = urlsAttempted?.length ?? 0;
    const sourceCount = sources?.length ?? 0;
    const screenshotCount = screenshots?.length ?? 0;
    const headerMeta = (() => {
        if (sourceCount > 0 && screenshotCount > 0) {
            return `${sourceCount} src · ${screenshotCount} 📸`;
        }
        if (sourceCount > 0) return `${sourceCount} source${sourceCount === 1 ? '' : 's'}`;
        if (screenshotCount > 0)
            return `${screenshotCount} capture${screenshotCount === 1 ? '' : 's'}`;
        if (urlCount > 0) return `${urlCount} URL${urlCount === 1 ? '' : 's'}`;
        return undefined;
    })();

    return (
        <BaseNodeShell kind="research" state={slot.state} headerMeta={headerMeta}>
            <div className="space-y-1.5">
                {scrapedAny && (urlsAttempted?.length ?? 0) > 0 && (
                    <ul className="space-y-0.5">
                        {urlsAttempted!.slice(0, PREVIEW_SOURCES).map((u, i) => (
                            <li
                                key={i}
                                className="flex items-center gap-1 truncate text-2xs text-muted-foreground"
                            >
                                <Globe2 className="size-3 shrink-0 text-muted-foreground/70" />
                                <span className="truncate">{tryHostname(u)}</span>
                            </li>
                        ))}
                        {(urlsAttempted!.length ?? 0) > PREVIEW_SOURCES && (
                            <li className="text-2xs text-muted-foreground">
                                +{urlsAttempted!.length - PREVIEW_SOURCES} more
                            </li>
                        )}
                    </ul>
                )}
                {searchedAny && (
                    <div className="flex items-center gap-1 text-2xs text-muted-foreground">
                        <Search className="size-3 shrink-0 text-muted-foreground/70" />
                        <span className="truncate italic">
                            {searchQuery ? `“${searchQuery}”` : 'Web search results gathered'}
                        </span>
                    </div>
                )}
                {!scrapedAny && !searchedAny && (
                    <p className="truncate text-2xs text-muted-foreground">
                        Research notes filed
                    </p>
                )}
            </div>
        </BaseNodeShell>
    );
}

/** Best-effort hostname extraction; falls back to the raw URL on parse failure. */
function tryHostname(url: string): string {
    try {
        return new URL(url).hostname;
    } catch {
        return url;
    }
}

export const ResearchNode = memo(ResearchNodeInner);
