import { ArrowDown, ArrowUp, Plus, Trash } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { HeaderNavChildValue } from './header-editor-utils';

/**
 * The links a "dropdown" nav item opens. Each link may carry one more level
 * of sub-links (Exams → SSC → CGL), which the live header opens beside it.
 * Routes are free text on purpose: a page route ("faqs"), an article
 * ("blog/ssc-cgl") or a full URL all work, and the page picker cannot list
 * blog articles.
 */
const ROUTE_HINT = 'Page route, blog/post-slug or https://… (leave empty for a group)';

const move = <T,>(list: T[], from: number, to: number): T[] => {
    if (to < 0 || to >= list.length) return list;
    const next = [...list];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item as T);
    return next;
};

const LinkRow = ({
    value,
    onChange,
    onRemove,
    onMove,
    index,
    count,
    routePlaceholder,
}: {
    value: HeaderNavChildValue;
    onChange: (next: HeaderNavChildValue) => void;
    onRemove: () => void;
    onMove: (to: number) => void;
    index: number;
    count: number;
    routePlaceholder: string;
}) => (
    <div className="flex items-start gap-1">
        <div className="flex-1 space-y-1">
            <Input
                value={value.label || ''}
                placeholder="Label"
                aria-label="Link label"
                onChange={(e) => onChange({ ...value, label: e.target.value })}
            />
            <Input
                value={value.route || ''}
                placeholder={routePlaceholder}
                aria-label="Link route"
                onChange={(e) => onChange({ ...value, route: e.target.value.trim() || undefined })}
            />
        </div>
        <div className="flex flex-col">
            <MyButton
                buttonType="text"
                scale="small"
                layoutVariant="icon"
                aria-label="Move up"
                disable={index === 0}
                onClick={() => onMove(index - 1)}
            >
                <ArrowUp size={12} />
            </MyButton>
            <MyButton
                buttonType="text"
                scale="small"
                layoutVariant="icon"
                aria-label="Move down"
                disable={index === count - 1}
                onClick={() => onMove(index + 1)}
            >
                <ArrowDown size={12} />
            </MyButton>
            <MyButton
                buttonType="text"
                scale="small"
                layoutVariant="icon"
                aria-label="Remove"
                onClick={onRemove}
            >
                <Trash size={12} className="text-danger-600" />
            </MyButton>
        </div>
    </div>
);

export const NavDropdownEditor = ({
    value,
    onChange,
}: {
    value: HeaderNavChildValue[];
    onChange: (next: HeaderNavChildValue[]) => void;
}) => {
    const list = Array.isArray(value) ? value : [];
    const setAt = (i: number, next: HeaderNavChildValue) =>
        onChange(list.map((c, j) => (j === i ? next : c)));
    return (
        <div className="space-y-2">
            <Label className="text-xs">Dropdown links</Label>
            <p className="text-caption text-neutral-500">
                A link with sub-links opens them beside it on desktop (e.g. SSC → CGL, CPO). Two
                levels at most.
            </p>
            {list.map((child, i) => {
                const subs = Array.isArray(child.children) ? child.children : [];
                return (
                    <div
                        key={i}
                        className="space-y-2 rounded border border-neutral-200 bg-white p-2"
                    >
                        <LinkRow
                            value={child}
                            index={i}
                            count={list.length}
                            routePlaceholder={ROUTE_HINT}
                            onChange={(next) => setAt(i, next)}
                            onRemove={() => onChange(list.filter((_, j) => j !== i))}
                            onMove={(to) => onChange(move(list, i, to))}
                        />
                        <div className="ms-3 space-y-2 border-s border-neutral-200 ps-2">
                            {subs.map((sub, k) => (
                                <LinkRow
                                    key={k}
                                    value={sub}
                                    index={k}
                                    count={subs.length}
                                    routePlaceholder="Page route, blog/post-slug or https://…"
                                    onChange={(next) =>
                                        setAt(i, {
                                            ...child,
                                            children: subs.map((s, m) => (m === k ? next : s)),
                                        })
                                    }
                                    onRemove={() =>
                                        setAt(i, {
                                            ...child,
                                            children: subs.filter((_, m) => m !== k),
                                        })
                                    }
                                    onMove={(to) =>
                                        setAt(i, { ...child, children: move(subs, k, to) })
                                    }
                                />
                            ))}
                            <MyButton
                                buttonType="secondary"
                                scale="small"
                                onClick={() =>
                                    setAt(i, {
                                        ...child,
                                        children: [...subs, { label: 'New link', route: '' }],
                                    })
                                }
                            >
                                <Plus size={12} /> Add sub-link
                            </MyButton>
                        </div>
                    </div>
                );
            })}
            <MyButton
                buttonType="secondary"
                scale="small"
                onClick={() => onChange([...list, { label: 'New link', route: '' }])}
            >
                <Plus size={12} /> Add link
            </MyButton>
        </div>
    );
};

export default NavDropdownEditor;
