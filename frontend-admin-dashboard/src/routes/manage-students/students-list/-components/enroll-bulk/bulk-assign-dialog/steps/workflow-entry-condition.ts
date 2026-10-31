import type { WorkflowRawNode } from '@/services/workflow-service';

/**
 * Course-level view of a global LEARNER_BATCH_ENROLLMENT workflow's entry condition.
 *
 * A global trigger fires for every batch, but a workflow can still gate itself on the course:
 * TRIGGER → CONDITION (no false branch) → actions. The engine starts a run for every enrollment
 * and the path simply ends at the condition, so nothing is sent for a non-matching course.
 * The enroll dialog uses this to say which selected courses actually pass the gate, instead of
 * listing the workflow as firing on every enrollment.
 */

export type ConditionVerdict = 'runs' | 'skips' | 'unknown';

export interface EnrollmentCourseFacts {
    packageName: string;
    packageSessionId: string;
}

interface Route {
    type?: string;
    targetNodeId?: string;
    trueNodeId?: string;
    falseNodeId?: string;
    condition?: string;
}

// Nodes that do nothing but route — the gate search may walk through them.
const PASS_THROUGH_NODE_TYPES = new Set(['TRIGGER', 'CONDITION']);

// Context keys the evaluator below reads. A TRIGGER node's outputDataPoints can overwrite any
// context key before the condition runs, so a gate behind such an overwrite is not trusted.
const EVALUATED_CONTEXT_KEYS = new Set([
    'packageName',
    'packageSessionIds',
    'eventId',
    'triggerEvents',
    'eventAppliedType',
    'isGlobalTrigger',
]);

interface NodeConfig {
    routing?: unknown;
    outputDataPoints?: { fieldName?: string }[] | null;
}

function configOf(node: WorkflowRawNode): NodeConfig | null {
    try {
        const config = JSON.parse(node.config_json) as NodeConfig;
        return config && typeof config === 'object' ? config : null;
    } catch {
        return null;
    }
}

/**
 * The SpEL expression every run must pass before any action node executes, or null when some
 * path reaches an action regardless. Mirrors WorkflowEngineService: the run starts at the first
 * is_start_node mapping (else the first by node_order), a `conditional` route with no
 * falseNodeId ends the path when false, and an `end` route ends it outright. Only TRIGGER and
 * CONDITION nodes are walked through — anything else does work before the gate is reached.
 */
export function findEntryCondition(nodes: WorkflowRawNode[]): string | null {
    const ordered = [...nodes].sort((a, b) => a.node_order - b.node_order);
    const byId = new Map(ordered.map((n) => [n.node_template_id, n]));
    let node: WorkflowRawNode | undefined = ordered.find((n) => n.is_start_node) ?? ordered[0];
    const visited = new Set<string>();

    while (node && !visited.has(node.node_template_id)) {
        if (!PASS_THROUGH_NODE_TYPES.has(node.node_type)) return null;
        visited.add(node.node_template_id);
        const config = configOf(node);
        if (!config) return null;
        const overwrites = (config.outputDataPoints ?? []).some(
            (p) => !!p?.fieldName && EVALUATED_CONTEXT_KEYS.has(p.fieldName)
        );
        if (overwrites) return null;
        const routes = Array.isArray(config.routing) ? (config.routing as Route[]) : [];
        const live = routes.filter((r) => (r.type ?? '').toLowerCase() !== 'end');

        // Single hop to another routing-only node (e.g. TRIGGER → CONDITION): keep walking.
        const only = live.length === 1 ? live[0] : undefined;
        if (only && (only.type ?? '').toLowerCase() === 'goto' && only.targetNodeId) {
            node = byId.get(only.targetNodeId);
            continue;
        }

        const gated =
            live.length > 0 &&
            live.every(
                (r) =>
                    (r.type ?? '').toLowerCase() === 'conditional' &&
                    !r.falseNodeId &&
                    !!r.condition?.trim()
            );
        if (!gated) return null;
        const conditions = live.map((r) => r.condition!.trim());
        return conditions.length === 1
            ? conditions[0]!
            : conditions.map((c) => `(${c})`).join(' || ');
    }
    return null;
}

// ─── Minimal SpEL evaluator ───
// Covers the shapes the workflow builder and hand-written gates use on course-level context
// keys. Anything else evaluates to null ("unknown") so the UI never claims a verdict it can't
// back — e.g. conditions on the learner, which only exist at enrollment time.

type Tri = boolean | null;

const STRING_LITERAL = `'((?:[^']|'')*)'`;
const unquote = (s: string) => s.replace(/''/g, "'");

function contextValue(key: string, facts: EnrollmentCourseFacts): string | boolean | undefined {
    switch (key) {
        case 'packageName':
            return facts.packageName;
        // LEARNER_BATCH_ENROLLMENT fires with eventId = packageSessionIds = the batch id.
        case 'packageSessionIds':
        case 'eventId':
            return facts.packageSessionId;
        case 'triggerEvents':
            return 'LEARNER_BATCH_ENROLLMENT';
        case 'eventAppliedType':
            return 'PACKAGE_SESSION';
        case 'isGlobalTrigger':
            return true;
        default:
            return undefined;
    }
}

/** Splits on a top-level operator, ignoring text inside quotes and parentheses. */
function splitTopLevel(expr: string, symbol: string, word: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let inQuote = false;
    let start = 0;
    for (let i = 0; i < expr.length; i++) {
        const ch = expr[i];
        if (ch === "'") inQuote = !inQuote;
        if (inQuote) continue;
        if (ch === '(') depth++;
        else if (ch === ')') depth--;
        if (depth !== 0) continue;
        if (expr.startsWith(symbol, i)) {
            parts.push(expr.slice(start, i));
            start = i + symbol.length;
            i = start - 1;
        } else if (
            /\s/.test(expr[i - 1] ?? '') &&
            expr.slice(i, i + word.length).toLowerCase() === word &&
            /\s/.test(expr[i + word.length] ?? '')
        ) {
            parts.push(expr.slice(start, i));
            start = i + word.length;
            i = start - 1;
        }
    }
    parts.push(expr.slice(start));
    return parts.map((p) => p.trim());
}

function stripOuterParens(expr: string): string {
    let e = expr.trim();
    while (e.startsWith('(') && e.endsWith(')')) {
        let depth = 0;
        let inQuote = false;
        let wrapsWhole = true;
        for (let i = 0; i < e.length; i++) {
            const ch = e[i];
            if (ch === "'") inQuote = !inQuote;
            if (inQuote) continue;
            if (ch === '(') depth++;
            else if (ch === ')') depth--;
            if (depth === 0 && i < e.length - 1) {
                wrapsWhole = false;
                break;
            }
        }
        if (!wrapsWhole) break;
        e = e.slice(1, -1).trim();
    }
    return e;
}

function evalAtom(expr: string, facts: EnrollmentCourseFacts): Tri {
    if (expr === 'true') return true;
    if (expr === 'false') return false;

    const keyMatch = expr.match(/^#ctx\s*\[\s*'([A-Za-z0-9_]+)'\s*\]/);
    if (!keyMatch) return null;
    let value = contextValue(keyMatch[1]!, facts);
    if (value === undefined) return null;
    let rest = expr.slice(keyMatch[0].length).trim();

    // Chained string transforms: .toLowerCase() / .toUpperCase() / .trim()
    for (;;) {
        const m = rest.match(/^\??\.(toLowerCase|toUpperCase|trim)\(\s*\)/);
        if (!m) break;
        if (typeof value !== 'string') return null;
        value =
            m[1] === 'toLowerCase'
                ? value.toLowerCase()
                : m[1] === 'toUpperCase'
                  ? value.toUpperCase()
                  : value.trim();
        rest = rest.slice(m[0].length).trim();
    }

    if (rest === '') return typeof value === 'boolean' ? value : null;

    const nullCheck = rest.match(/^(==|!=)\s*null$/);
    if (nullCheck) return nullCheck[1] === '!=';

    const boolCheck = rest.match(/^(==|!=)\s*(true|false)$/);
    if (boolCheck) {
        if (typeof value !== 'boolean') return null;
        return (value === (boolCheck[2] === 'true')) === (boolCheck[1] === '==');
    }

    if (typeof value !== 'string') return null;

    if (/^\??\.isEmpty\(\s*\)$/.test(rest)) return value.length === 0;

    const method = rest.match(
        new RegExp(
            `^\\??\\.(contains|startsWith|endsWith|equals|equalsIgnoreCase)\\(\\s*${STRING_LITERAL}\\s*\\)$`
        )
    );
    if (method) {
        const arg = unquote(method[2]!);
        switch (method[1]) {
            case 'contains':
                return value.includes(arg);
            case 'startsWith':
                return value.startsWith(arg);
            case 'endsWith':
                return value.endsWith(arg);
            case 'equals':
                return value === arg;
            default:
                return value.toLowerCase() === arg.toLowerCase();
        }
    }

    const compare = rest.match(new RegExp(`^(==|!=|eq|ne)\\s*${STRING_LITERAL}$`));
    if (compare) {
        const equal = value === unquote(compare[2]!);
        return compare[1] === '==' || compare[1] === 'eq' ? equal : !equal;
    }
    return null;
}

function evalExpr(expr: string, facts: EnrollmentCourseFacts): Tri {
    const e = stripOuterParens(expr);

    const ors = splitTopLevel(e, '||', 'or');
    if (ors.length > 1) {
        const values = ors.map((p) => evalExpr(p, facts));
        if (values.includes(true)) return true;
        return values.includes(null) ? null : false;
    }
    const ands = splitTopLevel(e, '&&', 'and');
    if (ands.length > 1) {
        const values = ands.map((p) => evalExpr(p, facts));
        if (values.includes(false)) return false;
        return values.includes(null) ? null : true;
    }
    const negated = e.match(/^(?:!(?!=)|not\s+)([\s\S]+)$/i);
    if (negated) {
        const operand = negated[1]!.trim();
        // `!` binds tighter than a comparison (`!a == b` is `(!a) == b`) — don't guess.
        if (!operand.startsWith('(') && /==|!=|\seq\s|\sne\s/.test(operand)) return null;
        const v = evalExpr(operand, facts);
        return v === null ? null : !v;
    }
    return evalAtom(e, facts);
}

export function evaluateEntryCondition(
    expression: string,
    facts: EnrollmentCourseFacts
): ConditionVerdict {
    const result = evalExpr(expression, facts);
    return result === null ? 'unknown' : result ? 'runs' : 'skips';
}
