/**
 * Translates a Settings recipe + the user's plain-language answers into a
 * `WorkflowBuilderDTO` ready to POST via `createWorkflow`.
 *
 * Reuses the existing `generateWorkflow` functions from
 * `use-case-templates.ts` — this file only synthesises the answers map and
 * lifts the result into the wire shape, so the engine sees the same
 * workflow JSON it would from the full wizard.
 */

import { getUseCaseTemplates } from '@/routes/workflow/create/-components/use-case-templates';
import type { WorkflowBuilderDTO, WorkflowBuilderNode, WorkflowBuilderEdge } from '@/types/workflow/workflow-types';
import { buildRecipeMarker, type AutomationRecipe } from './automation-recipes';

export type ScheduleFrequency = 'daily' | 'weekly' | 'monthly';

export interface ScheduleAnswers {
    frequency: ScheduleFrequency;
    /** HH:MM in 24-hour format, e.g. "09:00". */
    timeOfDay: string;
    /** Quartz day-of-week token (MON, TUE, ...). Only used when frequency === 'weekly'. */
    dayOfWeek?: string;
    /** 1–28. Only used when frequency === 'monthly'. */
    dayOfMonth?: number;
}

export interface RecipeFormAnswers {
    /** Primary email template name (used when the recipe has a single template_select). */
    templateName?: string;
    /** When the recipe declares `templateSlots`, one entry per slot's answerKey. */
    templateSlotAnswers?: Record<string, string>;
    /** Only when recipe.mode === 'scheduled'. */
    schedule?: ScheduleAnswers;
    /** Only when extraQuestions includes 'days_after_submission'. */
    daysAfterSubmission?: number;
    /** Only when extraQuestions includes 'days_before_expiry'. */
    daysBeforeExpiry?: number;
    /** Only when recipe.target is set. Single batch id for 'batch_single', list for 'batch_multi'. */
    batchIds?: string[];
}

const DEFAULT_TIMEZONE = 'Asia/Kolkata';

export function buildCron(answers: ScheduleAnswers): string {
    const [hStr, mStr] = answers.timeOfDay.split(':');
    const h = Number(hStr ?? '9');
    const m = Number(mStr ?? '0');
    if (answers.frequency === 'daily') return `0 ${m} ${h} * * ?`;
    if (answers.frequency === 'weekly') return `0 ${m} ${h} ? * ${answers.dayOfWeek ?? 'MON'}`;
    return `0 ${m} ${h} ${answers.dayOfMonth ?? 1} * ?`;
}

/**
 * Map a recipe + form answers onto the answer-shape expected by the
 * underlying `UseCaseTemplate.generateWorkflow`. This is where we honour the
 * "no target picker — apply to all" decision: any `batchId` / `audienceId`
 * answer is intentionally left unset so the generator falls back to the
 * institute-wide query mode.
 */
function synthesiseWizardAnswers(
    recipe: AutomationRecipe,
    form: RecipeFormAnswers,
): Record<string, string | number | string[]> {
    const out: Record<string, string | number | string[]> = {};

    if (recipe.templateSlots && recipe.templateSlots.length > 0) {
        for (const slot of recipe.templateSlots) {
            const value = form.templateSlotAnswers?.[slot.answerKey] ?? '';
            out[slot.answerKey] = value;
        }
    } else if (form.templateName) {
        out.templateName = form.templateName;
    }

    if (recipe.extraQuestions?.includes('days_after_submission')) {
        out.daysAgo = form.daysAfterSubmission ?? 3;
    }
    if (recipe.extraQuestions?.includes('days_before_expiry')) {
        out.daysUntilExpiry = form.daysBeforeExpiry ?? 7;
    }

    // Threading the user's batch selection into the wizard's `batchId` answer.
    // For batch_single → single string. For batch_multi → string[] (the
    // generators that accept multi convert to CSV themselves).
    if (recipe.target === 'batch_single') {
        out.batchId = form.batchIds?.[0] ?? '';
    } else if (recipe.target === 'batch_multi') {
        out.batchId = form.batchIds ?? [];
    }

    return out;
}

/**
 * Lift ReactFlow nodes + edges into the wire-shape `WorkflowBuilderNode[]` /
 * `WorkflowBuilderEdge[]`, AND push routing entries onto each node's config
 * (the engine reads node.config.routing[] at runtime — edges in the DTO are
 * informational only).
 *
 * Mirrors the logic in `use-case-wizard-step.tsx:394-420` and
 * `workflow-builder.tsx:881-900`.
 */
function liftToBuilderShape(
    nodes: import('reactflow').Node[],
    edges: import('reactflow').Edge[],
): { builderNodes: WorkflowBuilderNode[]; builderEdges: WorkflowBuilderEdge[] } {
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    for (const edge of edges) {
        const source = nodeMap.get(edge.source);
        if (!source) continue;
        const config = source.data.config as Record<string, unknown>;
        const routing = (config.routing as Array<Record<string, string>> | undefined) ?? [];
        routing.push({ label: (edge.label as string) ?? '', type: 'goto', targetNodeId: edge.target });
        config.routing = routing;
    }

    const sourcesSet = new Set(edges.map((e) => e.source));
    for (const n of nodes) {
        if (!sourcesSet.has(n.id)) {
            const config = n.data.config as Record<string, unknown>;
            const routing = (config.routing as Array<Record<string, string>> | undefined) ?? [];
            if (!routing.some((r) => r.type === 'end')) routing.push({ type: 'end' });
            config.routing = routing;
            n.data.isEndNode = true;
        }
    }

    const builderNodes: WorkflowBuilderNode[] = nodes.map((n, i) => {
        const hasOutgoing = edges.some((e) => e.source === n.id);
        return {
            id: n.id,
            name: (n.data.name as string) ?? (n.data.label as string) ?? '',
            node_type: n.data.nodeType as string,
            config: (n.data.config as Record<string, unknown>) ?? {},
            position_x: n.position.x,
            position_y: n.position.y,
            is_start_node: n.data.isStartNode === true || i === 0,
            is_end_node: (n.data.isEndNode as boolean | undefined) ?? !hasOutgoing,
        };
    });

    const builderEdges: WorkflowBuilderEdge[] = edges.map((e) => ({
        id: e.id,
        source_node_id: e.source,
        target_node_id: e.target,
        label: (e.label as string) ?? '',
    }));

    return { builderNodes, builderEdges };
}

export function buildRecipeWorkflow(
    recipe: AutomationRecipe,
    form: RecipeFormAnswers,
    instituteId: string,
): WorkflowBuilderDTO {
    // Recipes can either delegate to a wizard template OR provide their own
    // inline generator (used for splits / one-off shapes that don't match any
    // existing template).
    let generatedNodes: import('reactflow').Node[];
    let generatedEdges: import('reactflow').Edge[];
    if (recipe.customGenerator) {
        const generated = recipe.customGenerator(form);
        generatedNodes = generated.nodes;
        generatedEdges = generated.edges;
    } else {
        const template = getUseCaseTemplates().find((t) => t.id === recipe.useCaseTemplateId);
        if (!template) {
            throw new Error(`Unknown use-case template: ${recipe.useCaseTemplateId}`);
        }
        const wizardAnswers = synthesiseWizardAnswers(recipe, form);
        const generated = template.generateWorkflow(wizardAnswers, recipe.triggerEvent);
        generatedNodes = generated.nodes;
        generatedEdges = generated.edges;
    }

    const { builderNodes, builderEdges } = liftToBuilderShape(generatedNodes, generatedEdges);

    const dto: WorkflowBuilderDTO = {
        name: recipe.label,
        description: buildRecipeMarker(recipe.id, recipe.whatHappens),
        status: 'ACTIVE',
        workflow_type: recipe.mode === 'scheduled' ? 'SCHEDULED' : 'EVENT_DRIVEN',
        institute_id: instituteId,
        nodes: builderNodes,
        edges: builderEdges,
    };

    if (recipe.mode === 'scheduled') {
        if (!form.schedule) throw new Error('Schedule is required for a scheduled recipe.');
        dto.schedule = {
            schedule_type: 'CRON',
            cron_expression: buildCron(form.schedule),
            timezone: DEFAULT_TIMEZONE,
        };
    } else {
        if (!recipe.triggerEvent) {
            throw new Error(`Event-driven recipe ${recipe.id} is missing triggerEvent`);
        }
        dto.trigger = {
            trigger_event_name: recipe.triggerEvent,
            description: recipe.whatHappens,
        };
    }

    return dto;
}
