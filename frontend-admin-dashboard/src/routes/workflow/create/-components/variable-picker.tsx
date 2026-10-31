import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { fetchContextSchema, ContextVariableDTO } from '@/services/workflow-service';
import { useWorkflowBuilderStore } from '../-stores/workflow-builder-store';
import { Code, MagicWand } from '@phosphor-icons/react';

interface Props {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    nodeId: string;
}

export function VariablePicker({ value, onChange, placeholder, nodeId }: Props) {
    const { t } = useTranslation('workflowVariablePicker');
    const [advanced, setAdvanced] = useState(false);
    const [variables, setVariables] = useState<ContextVariableDTO[]>([]);
    const [showDropdown, setShowDropdown] = useState(false);
    const [search, setSearch] = useState('');

    const nodes = useWorkflowBuilderStore((s) => s.nodes);
    const edges = useWorkflowBuilderStore((s) => s.edges);

    // Compute upstream nodes by walking edges backward from nodeId
    useEffect(() => {
        const upstreamIds = new Set<string>();
        const queue = [nodeId];
        const visited = new Set<string>();

        while (queue.length > 0) {
            const current = queue.shift()!;
            if (visited.has(current)) continue;
            visited.add(current);

            for (const edge of edges) {
                if (edge.target === current && !visited.has(edge.source)) {
                    upstreamIds.add(edge.source);
                    queue.push(edge.source);
                }
            }
        }

        const upstreamNodes = nodes
            .filter((n) => upstreamIds.has(n.id))
            .map((n) => ({
                node_id: n.id,
                node_name: n.data?.name ?? n.id,
                node_type: n.data?.nodeType ?? 'UNKNOWN',
                config: (n.data?.config ?? {}) as Record<string, unknown>,
            }));

        if (upstreamNodes.length > 0) {
            fetchContextSchema({ target_node_id: nodeId, upstream_nodes: upstreamNodes })
                .then(setVariables)
                .catch(() => setVariables([]));
        }
    }, [nodeId, nodes, edges]);

    // Group variables by source node
    const grouped = variables.reduce<Record<string, ContextVariableDTO[]>>((acc, v) => {
        const key = v.source_node_name ?? v.source_node_id;
        if (!acc[key]) acc[key] = [];
        acc[key]!.push(v);
        return acc;
    }, {});

    const filteredGroups = Object.entries(grouped).map(([group, vars]) => ({
        group,
        vars: vars.filter(
            (v) =>
                !search ||
                v.key.toLowerCase().includes(search.toLowerCase()) ||
                v.description.toLowerCase().includes(search.toLowerCase())
        ),
    })).filter((g) => g.vars.length > 0);

    if (advanced) {
        return (
            <div className="space-y-1">
                <div className="flex items-center gap-1">
                    <Input
                        value={value}
                        onChange={(e) => onChange(e.target.value)}
                        placeholder={placeholder ?? t('advancedPlaceholder')}
                        className="font-mono text-xs"
                    />
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setAdvanced(false)}
                        title={t('switchToVisualPicker')}
                        className="h-8 w-8 p-0"
                    >
                        <MagicWand size={14} />
                    </Button>
                </div>
            </div>
        );
    }

    return (
        <div className="relative space-y-1">
            <div className="flex items-center gap-1">
                <div className="relative flex-1">
                    <Input
                        value={value}
                        onChange={(e) => onChange(e.target.value)}
                        onFocus={() => setShowDropdown(true)}
                        placeholder={placeholder ?? t('visualPlaceholder')}
                        className="text-xs pr-8"
                        readOnly
                    />
                    {value && (
                        <Badge variant="outline" className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px]">
                            {t('spelBadge')}
                        </Badge>
                    )}
                </div>
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setAdvanced(true)}
                    title={t('switchToRawSpelInput')}
                    className="h-8 w-8 p-0"
                >
                    <Code size={14} />
                </Button>
            </div>

            {showDropdown && (
                <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowDropdown(false)} />
                    <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border rounded-lg shadow-lg max-h-64 overflow-y-auto">
                        <div className="p-2 border-b">
                            <Input
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder={t('searchPlaceholder')}
                                className="h-7 text-xs"
                                autoFocus
                            />
                        </div>
                        {filteredGroups.length === 0 ? (
                            <div className="p-4 text-center space-y-1.5">
                                <p className="text-xs font-medium text-gray-500">{t('noVariablesAvailable')}</p>
                                <p className="text-[10px] text-gray-400">
                                    {t('noVariablesHint')}
                                </p>
                                <button
                                    className="mt-1 text-[10px] text-primary hover:underline"
                                    onClick={() => { setShowDropdown(false); setAdvanced(true); }}
                                >
                                    {t('switchToAdvancedHint')}
                                </button>
                            </div>
                        ) : (
                            filteredGroups.map(({ group, vars }) => (
                                <div key={group}>
                                    <div className="px-3 py-1.5 text-[10px] font-semibold text-muted-foreground bg-muted/50 uppercase">
                                        {t('fromGroup', { group })}
                                    </div>
                                    {vars.map((v) => (
                                        <button
                                            key={v.key + v.source_node_id}
                                            className="w-full text-left px-3 py-2 hover:bg-muted/50 transition-colors border-b last:border-0"
                                            onClick={() => {
                                                onChange(v.spel_expression);
                                                setShowDropdown(false);
                                                setSearch('');
                                            }}
                                        >
                                            <div className="flex items-center gap-2">
                                                <span className="text-xs font-medium">{v.key}</span>
                                                <Badge variant="outline" className="text-[9px]">{v.type}</Badge>
                                            </div>
                                            <div className="text-[10px] text-muted-foreground">{v.description}</div>
                                        </button>
                                    ))}
                                </div>
                            ))
                        )}
                    </div>
                </>
            )}
        </div>
    );
}
