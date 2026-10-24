import type { VisibleWhenRule } from '../../-types/editor-types';

/**
 * component.visibleWhen — "show this section only for these addresses". The
 * learner evaluates it with evaluateVisibleWhen() (catalogue-url-state.ts):
 * every rule must hold; a rule with no parameter is ignored. These helpers
 * keep the builder's copy of that contract.
 */

export type VisibleWhenOp = VisibleWhenRule['op'];

export const VISIBLE_WHEN_OPS: { value: VisibleWhenOp; label: string }[] = [
    { value: 'empty', label: 'is empty' },
    { value: 'notEmpty', label: 'has any value' },
    { value: 'equals', label: 'is' },
    { value: 'notEquals', label: 'is not' },
];

/**
 * Address parameters the catalogue sections use — offered as suggestions, any
 * name is allowed. `lang` is deliberately not offered (see paramCaveat).
 */
export const VISIBLE_WHEN_PARAMS: { param: string; hint: string }[] = [
    { param: 'stream', hint: 'Courses page stream tab' },
    { param: 'category', hint: 'Category inside a stream' },
    { param: 'language', hint: 'Language filter' },
    { param: 'price', hint: 'Price filter' },
    { param: 'badge', hint: 'Badge filter' },
    { param: 'sort', hint: 'Sort order' },
    { param: 'q', hint: 'Search text' },
    { param: 'path', hint: 'Open learning path' },
];

/**
 * Why a rule on this parameter will misbehave, or null. The site language is
 * remembered in the visitor's browser and usually not in the address, so a
 * rule such as "?lang is hi" hides the section from Hindi visitors who did not
 * arrive through a ?lang= link.
 */
export const paramCaveat = (param: string): string | null =>
    param.trim() === 'lang'
        ? 'The site language is remembered in the visitor’s browser and is usually not in the address, so ?lang only reflects a link that carries it. A rule on it hides this section from visitors who picked their language earlier.'
        : null;

/**
 * "Only on the All courses tab": the Courses page with no stream tab chosen.
 * It reads ?stream only, so the section stays while a visitor filters or
 * searches inside All courses (?language, ?price, ?badge, ?q) — add rules on
 * those parameters for a stricter "nothing filtered".
 */
export const UNFILTERED_VIEW_PRESET: VisibleWhenRule[] = [{ param: 'stream', op: 'empty' }];

const OPS = new Set<VisibleWhenOp>(['empty', 'notEmpty', 'equals', 'notEquals']);

export const opNeedsValue = (op: VisibleWhenOp): boolean => op === 'equals' || op === 'notEquals';

/** Whatever is stored (possibly hand-edited JSON) → a clean editable list. */
export const normalizeVisibleWhen = (rules: unknown): VisibleWhenRule[] =>
    (Array.isArray(rules) ? rules : [])
        .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object' && !Array.isArray(r))
        .map((r) => {
            const op = OPS.has(r.op as VisibleWhenOp) ? (r.op as VisibleWhenOp) : 'empty';
            const rule: VisibleWhenRule = { param: typeof r.param === 'string' ? r.param : '', op };
            if (opNeedsValue(op)) rule.value = typeof r.value === 'string' ? r.value : r.value == null ? '' : String(r.value);
            return rule;
        });

/** What gets written to component.visibleWhen: undefined (always shown) for an empty list. */
export const visibleWhenForSave = (rules: VisibleWhenRule[]): VisibleWhenRule[] | undefined =>
    rules.length ? rules.map((r) => (opNeedsValue(r.op) ? { ...r, value: r.value ?? '' } : { param: r.param, op: r.op })) : undefined;

/** Changing the operator drops a value that no longer applies (and starts one that does). */
export const withOp = (rule: VisibleWhenRule, op: VisibleWhenOp): VisibleWhenRule =>
    opNeedsValue(op) ? { param: rule.param, op, value: rule.value ?? '' } : { param: rule.param, op };

export const isUnfilteredPreset = (rules: VisibleWhenRule[]): boolean =>
    rules.length === 1 && rules[0]!.param.trim() === 'stream' && rules[0]!.op === 'empty';

/** True when some rule has no parameter — the live site ignores that rule. */
export const hasRuleWithoutParam = (rules: unknown): boolean =>
    Array.isArray(rules) &&
    rules.some((r) => !r || typeof r !== 'object' || typeof (r as VisibleWhenRule).param !== 'string' || !(r as VisibleWhenRule).param.trim());

export const describeRule = (rule: VisibleWhenRule): string => {
    const param = rule.param.trim() || '(no parameter)';
    switch (rule.op) {
        case 'empty':
            return `?${param} is empty`;
        case 'notEmpty':
            return `?${param} has a value`;
        case 'equals':
            return `?${param} is “${(rule.value || '').trim()}”`;
        case 'notEquals':
            return `?${param} is not “${(rule.value || '').trim()}”`;
        default:
            return `?${param}`;
    }
};

/** One line for the collapsed control. */
export const describeVisibleWhen = (rules: VisibleWhenRule[]): string => {
    if (!rules.length) return 'Always shown';
    if (isUnfilteredPreset(rules)) return 'Only on the All courses tab';
    return `Only when ${rules.map(describeRule).join(' and ')}`;
};
