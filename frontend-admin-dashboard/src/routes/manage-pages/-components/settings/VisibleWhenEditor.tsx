import { useState } from 'react';
import { CaretDown, CaretRight, Eye, Plus, X } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import type { VisibleWhenRule } from '../../-types/editor-types';
import {
    UNFILTERED_VIEW_PRESET,
    VISIBLE_WHEN_OPS,
    VISIBLE_WHEN_PARAMS,
    describeVisibleWhen,
    hasRuleWithoutParam,
    isUnfilteredPreset,
    normalizeVisibleWhen,
    opNeedsValue,
    paramCaveat,
    visibleWhenForSave,
    withOp,
    type VisibleWhenOp,
} from './visible-when';

/**
 * Section visibility by address (component.visibleWhen): "show this section
 * only when ?stream is empty", for example — the Courses page shows its
 * "Start free" block only on the All courses tab. Every rule must hold. No
 * rules = always shown, which is how every existing section stays.
 */

interface VisibleWhenEditorProps {
    /** component.visibleWhen as stored (anything — hand-edited JSON is cleaned up for display). */
    rules: unknown;
    /** undefined = no rules (the key is dropped from the component). */
    onChange: (rules: VisibleWhenRule[] | undefined) => void;
    /** Unique per section, for the parameter suggestions list. */
    idPrefix: string;
}

export const VisibleWhenEditor = ({ rules: stored, onChange, idPrefix }: VisibleWhenEditorProps) => {
    const rules = normalizeVisibleWhen(stored);
    const [open, setOpen] = useState(false);
    // Section ids come from saved JSON; keep the datalist id a plain token.
    const listId = `${idPrefix.replace(/[^\w-]/g, '_')}-visible-when-params`;
    const write = (next: VisibleWhenRule[]) => onChange(visibleWhenForSave(next));
    const update = (i: number, rule: VisibleWhenRule) => write(rules.map((r, j) => (j === i ? rule : r)));

    return (
        <div className="space-y-2 rounded border border-neutral-200 p-2">
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
                className="flex w-full items-center justify-between gap-2 text-start"
            >
                <span className="flex min-w-0 items-center gap-1.5">
                    <Eye className="size-3.5 shrink-0 text-neutral-500" />
                    <span className="text-xs font-medium text-neutral-700">Show on</span>
                    <span
                        className={cn(
                            'truncate text-caption',
                            rules.length ? 'font-medium text-primary-500' : 'text-neutral-500'
                        )}
                    >
                        {describeVisibleWhen(rules)}
                    </span>
                </span>
                {open ? (
                    <CaretDown className="size-3.5 shrink-0 text-neutral-500" />
                ) : (
                    <CaretRight className="size-3.5 shrink-0 text-neutral-500" />
                )}
            </button>

            {open && (
                <div className="space-y-2">
                    <p className="text-caption text-neutral-500">
                        Show this section only when the page address matches — every rule must hold. Handy on the
                        Courses page: keep &ldquo;Start free&rdquo; on the All courses tab and hide it once a stream
                        tab is picked.
                    </p>
                    <div className="flex flex-wrap gap-1">
                        <button
                            type="button"
                            onClick={() => write(UNFILTERED_VIEW_PRESET.map((r) => ({ ...r })))}
                            className={cn(
                                'rounded px-2.5 py-1 text-caption font-medium',
                                isUnfilteredPreset(rules)
                                    ? 'bg-primary-100 text-primary-500'
                                    : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
                            )}
                        >
                            Only on the All courses tab
                        </button>
                        <button
                            type="button"
                            onClick={() => write([])}
                            className={cn(
                                'rounded px-2.5 py-1 text-caption font-medium',
                                !rules.length
                                    ? 'bg-primary-100 text-primary-500'
                                    : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
                            )}
                        >
                            Always
                        </button>
                    </div>

                    {rules.map((rule, i) => (
                        <div key={i} className="space-y-1.5 rounded border border-neutral-100 bg-neutral-50 p-2">
                            <div className="flex items-center justify-between">
                                <Label className="text-caption text-neutral-500">
                                    {i === 0 ? 'When' : 'and when'}
                                </Label>
                                <button
                                    type="button"
                                    aria-label="Remove rule"
                                    onClick={() => write(rules.filter((_, j) => j !== i))}
                                    className="rounded p-0.5 text-neutral-400 hover:bg-danger-50 hover:text-danger-600"
                                >
                                    <X className="size-3" />
                                </button>
                            </div>
                            <div className="flex items-center gap-1.5">
                                <span className="text-caption text-neutral-500">?</span>
                                <Input
                                    aria-label="Address parameter"
                                    list={listId}
                                    value={rule.param}
                                    onChange={(e) =>
                                        update(i, { ...rule, param: e.target.value.replace(/[^\w.-]/g, '') })
                                    }
                                    placeholder="stream"
                                    className="h-7 font-mono text-xs"
                                />
                                <select
                                    aria-label="Condition"
                                    className="h-7 shrink-0 rounded border border-neutral-300 bg-white px-1.5 text-xs"
                                    value={rule.op}
                                    onChange={(e) => update(i, withOp(rule, e.target.value as VisibleWhenOp))}
                                >
                                    {VISIBLE_WHEN_OPS.map((o) => (
                                        <option key={o.value} value={o.value}>
                                            {o.label}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            {opNeedsValue(rule.op) && (
                                <Input
                                    aria-label="Value"
                                    value={rule.value || ''}
                                    onChange={(e) => update(i, { ...rule, value: e.target.value })}
                                    placeholder="e.g. shiksha"
                                    className="h-7 text-xs"
                                />
                            )}
                            {paramCaveat(rule.param) && (
                                <p className="text-caption text-warning-600">{paramCaveat(rule.param)}</p>
                            )}
                        </div>
                    ))}
                    <datalist id={listId}>
                        {VISIBLE_WHEN_PARAMS.map((p) => (
                            <option key={p.param} value={p.param}>
                                {p.hint}
                            </option>
                        ))}
                    </datalist>

                    {hasRuleWithoutParam(rules) && (
                        <p className="text-caption text-warning-600">
                            A rule without a parameter is ignored on the live site. Fill it in or remove it.
                        </p>
                    )}

                    <MyButton
                        buttonType="text"
                        scale="small"
                        onClick={() => write([...rules, { param: '', op: 'empty' }])}
                    >
                        <Plus className="size-3" /> Add rule
                    </MyButton>
                </div>
            )}
        </div>
    );
};
