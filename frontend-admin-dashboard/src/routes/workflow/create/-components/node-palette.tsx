import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { WORKFLOW_NODE_TYPES } from '@/types/workflow/workflow-types';
import { useWorkflowBuilderStore } from '../-stores/workflow-builder-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NodeHelpTooltip } from './node-help-tooltip';

const categories = [
    'Triggers',
    'Data',
    'Actions',
    'Notifications',
    'Integrations',
    'Logic',
] as const;

export function NodePalette() {
    const { t } = useTranslation('workflowNodePalette');
    const addNode = useWorkflowBuilderStore((s) => s.addNode);
    const workflowType = useWorkflowBuilderStore((s) => s.workflowType);
    const [search, setSearch] = useState('');

    const filteredNodeTypes = WORKFLOW_NODE_TYPES.filter((n) => {
        // Hide TRIGGER from palette — it's auto-managed by Workflow Settings
        if (n.type === 'TRIGGER') return false;
        // Hide ROUTER — internal use only
        if (n.type === 'ROUTER') return false;
        if (!search) return true;
        return (
            n.label.toLowerCase().includes(search.toLowerCase()) ||
            n.type.toLowerCase().includes(search.toLowerCase())
        );
    });

    return (
        <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
            <h3 className="text-sm font-semibold text-gray-700">{t('addNodes')}</h3>
            <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('searchPlaceholder')}
                className="h-8 text-xs"
            />
            {categories.map((category) => {
                const nodesInCategory = filteredNodeTypes.filter(
                    (n) => n.category === category
                );
                if (nodesInCategory.length === 0) return null;

                return (
                    <div key={category}>
                        <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-gray-500">
                            {t(`categories.${category}`)}
                        </p>
                        <div className="flex flex-col gap-1">
                            {nodesInCategory.map((nodeType) => (
                                <div key={nodeType.type} className="flex items-center gap-1">
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="flex-1 justify-start gap-2 text-left"
                                        onClick={() =>
                                            addNode(nodeType.type, nodeType.label)
                                        }
                                    >
                                        <span>{nodeType.icon}</span>
                                        <span className="text-xs">
                                            {nodeType.label}
                                        </span>
                                    </Button>
                                    <NodeHelpTooltip nodeType={nodeType.type} />
                                </div>
                            ))}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
