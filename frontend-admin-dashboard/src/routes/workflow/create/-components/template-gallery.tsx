import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { getWorkflowTemplatesQuery, WorkflowTemplateItem } from '@/services/workflow-service';
import { useWorkflowBuilderStore } from '../-stores/workflow-builder-store';
import { WorkflowBuilderDTO } from '@/types/workflow/workflow-types';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Lightning } from '@phosphor-icons/react';

interface TemplateGalleryProps {
    instituteId: string;
}

export function TemplateGallery({ instituteId }: TemplateGalleryProps) {
    const { t } = useTranslation('workflowTemplateGallery');
    const [open, setOpen] = useState(false);
    const { data: templates, isLoading } = useQuery(getWorkflowTemplatesQuery(instituteId));
    const {
        setNodes, setEdges, setWorkflowName, setWorkflowDescription, setWorkflowType,
        setEditingWorkflowId, setEditingWorkflowStatus,
    } = useWorkflowBuilderStore();

    const handleApplyTemplate = (template: WorkflowTemplateItem) => {
        try {
            const parsed: WorkflowBuilderDTO = JSON.parse(template.template_json);

            // Convert template nodes to ReactFlow nodes
            const rfNodes = (parsed.nodes ?? []).map((n, i) => ({
                id: n.id,
                type: 'workflowNode' as const,
                position: { x: 250 + (i % 3) * 300, y: 100 + Math.floor(i / 3) * 200 },
                data: {
                    name: n.name,
                    nodeType: n.node_type,
                    config: n.config ?? {},
                    isStartNode: n.is_start_node ?? false,
                    isEndNode: n.is_end_node ?? false,
                },
            }));

            // Convert template edges to ReactFlow edges
            const rfEdges = (parsed.edges ?? []).map((e) => ({
                id: e.id,
                source: e.source_node_id,
                target: e.target_node_id,
                type: 'smoothstep' as const,
                animated: true,
                label: e.label ?? '',
            }));

            // Applying a template starts a fresh workflow — drop any edit context so Save creates a
            // new workflow instead of overwriting the one currently being edited.
            setEditingWorkflowId(null);
            setEditingWorkflowStatus(null);
            setNodes(rfNodes);
            setEdges(rfEdges);
            setWorkflowName(template.name);
            setWorkflowDescription(template.description ?? '');
            if (parsed.workflow_type) {
                setWorkflowType(parsed.workflow_type as 'SCHEDULED' | 'EVENT_DRIVEN');
            }
            setOpen(false);
        } catch (err) {
            console.error('Failed to parse template:', err);
        }
    };

    // Group templates by category
    const grouped = (templates ?? []).reduce<Record<string, WorkflowTemplateItem[]>>((acc, t) => {
        const cat = t.category ?? 'Other';
        if (!acc[cat]) acc[cat] = [];
        acc[cat]!.push(t);
        return acc;
    }, {});

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5">
                    <Lightning size={14} />
                    {t('templatesButton')}
                </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[70vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{t('dialogTitle')}</DialogTitle>
                </DialogHeader>

                {isLoading ? (
                    <div className="py-8 text-center text-sm text-gray-500">{t('loadingTemplates')}</div>
                ) : Object.keys(grouped).length === 0 ? (
                    <div className="py-8 text-center text-sm text-gray-500">{t('noTemplatesAvailable')}</div>
                ) : (
                    <div className="flex flex-col gap-6">
                        {Object.entries(grouped).map(([category, items]) => (
                            <div key={category}>
                                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                                    {category}
                                </h4>
                                <div className="grid grid-cols-2 gap-3">
                                    {items.map((template) => (
                                        <button
                                            key={template.id}
                                            onClick={() => handleApplyTemplate(template)}
                                            className="rounded-lg border bg-white p-3 text-start transition-colors hover:border-blue-300 hover:bg-blue-50"
                                        >
                                            <div className="flex items-center gap-2 mb-1">
                                                <span className="font-medium text-sm">{template.name}</span>
                                                {template.is_system && (
                                                    <Badge variant="secondary" className="text-[10px]">{t('systemBadge')}</Badge>
                                                )}
                                            </div>
                                            <p className="text-xs text-gray-500 line-clamp-2">
                                                {template.description}
                                            </p>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
