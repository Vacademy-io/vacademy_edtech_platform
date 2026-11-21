import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash } from '@phosphor-icons/react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { MyButton } from '@/components/design-system/button';
import type { CheckIssue, Cta, LinkTarget } from '../../-types/learner-home-types';
import { LIMITS } from '../../-utils/publish-checks';
import { FieldIssues } from './FieldIssues';
import { exact } from './issues';
import { LinkTargetPicker } from './LinkTargetPicker';

/** A labelled text input with a hard max length and its check issues. */
export function TextField({
    id,
    label,
    value,
    onChange,
    max,
    issues,
    path,
    hint,
    multiline = false,
    rows = 4,
}: {
    id: string;
    label: string;
    value: string;
    onChange: (v: string) => void;
    max: number;
    issues: CheckIssue[];
    path: string;
    hint?: string;
    multiline?: boolean;
    rows?: number;
}) {
    const { t } = useTranslation('learnerHome');
    const fieldIssues = exact(issues, path);
    const describedBy = `${id}-hint`;
    return (
        <div className="space-y-1">
            <div className="flex items-baseline justify-between gap-2">
                <Label htmlFor={id}>{label}</Label>
                <span className="text-caption text-neutral-500" aria-hidden>
                    {t('notice.counter', { count: value.length, max })}
                </span>
            </div>
            {multiline ? (
                <Textarea
                    id={id}
                    value={value}
                    rows={rows}
                    maxLength={max}
                    onChange={(e) => onChange(e.target.value)}
                    aria-describedby={hint ? describedBy : undefined}
                    aria-invalid={fieldIssues.some((i) => i.severity !== 'warning')}
                />
            ) : (
                <Input
                    id={id}
                    value={value}
                    maxLength={max}
                    onChange={(e) => onChange(e.target.value)}
                    aria-describedby={hint ? describedBy : undefined}
                    aria-invalid={fieldIssues.some((i) => i.severity !== 'warning')}
                />
            )}
            {hint && (
                <p id={describedBy} className="text-caption text-neutral-500">
                    {hint}
                </p>
            )}
            <FieldIssues issues={fieldIssues} />
        </div>
    );
}

/** A switch with its label on the right. */
export function SwitchField({
    id,
    label,
    checked,
    onChange,
    hint,
}: {
    id: string;
    label: string;
    checked: boolean;
    onChange: (v: boolean) => void;
    hint?: string;
}) {
    return (
        <div className="flex items-start gap-3">
            <Switch id={id} checked={checked} onCheckedChange={onChange} className="mt-0.5" />
            <div className="space-y-0.5">
                <Label htmlFor={id} className="font-normal leading-snug">
                    {label}
                </Label>
                {hint && <p className="text-caption text-neutral-500">{hint}</p>}
            </div>
        </div>
    );
}

/** A section of the block editor with a heading. */
export function EditorSection({ title, children }: { title: string; children: ReactNode }) {
    return (
        <section className="space-y-4 border-t border-neutral-200 pt-4 first:border-t-0 first:pt-0">
            <h3 className="text-subtitle font-semibold text-neutral-800">{title}</h3>
            {children}
        </section>
    );
}

/** An optional button: label + link, added and removed as a whole. */
export function CtaEditor({
    id,
    label,
    value,
    onChange,
    issues,
    path,
    addLabel,
    removeLabel,
    defaultLink,
}: {
    id: string;
    label: string;
    value: Cta | null;
    onChange: (next: Cta | null) => void;
    issues: CheckIssue[];
    path: string;
    addLabel: string;
    removeLabel: string;
    defaultLink?: LinkTarget;
}) {
    const { t } = useTranslation('learnerHome');
    if (!value) {
        return (
            <div className="space-y-1">
                <p className="text-body font-semibold text-neutral-700">{label}</p>
                <MyButton
                    type="button"
                    buttonType="secondary"
                    scale="small"
                    onClick={() =>
                        onChange({ label: '', link: defaultLink ?? { kind: 'COURSE_LIST' } })
                    }
                >
                    <Plus className="me-1 size-3.5" aria-hidden />
                    {addLabel}
                </MyButton>
            </div>
        );
    }
    return (
        <fieldset className="space-y-3 rounded-md border border-neutral-200 p-3">
            <legend className="px-1 text-body font-semibold text-neutral-700">{label}</legend>
            <TextField
                id={`${id}-label`}
                label={t('notice.buttonLabel')}
                value={value.label}
                onChange={(v) => onChange({ ...value, label: v })}
                max={LIMITS.ctaLabel}
                issues={issues}
                path={`${path}.label`}
            />
            <LinkTargetPicker
                id={`${id}-link`}
                label={t('banner.link')}
                value={value.link}
                allowNone={false}
                // A button without a complete link keeps its last complete one;
                // the picker shows what is still missing.
                onChange={(link) => link && onChange({ ...value, link })}
                issues={issues}
                path={`${path}.link`}
            />
            <MyButton type="button" buttonType="text" scale="small" onClick={() => onChange(null)}>
                <Trash className="me-1 size-3.5" aria-hidden />
                {removeLabel}
            </MyButton>
            <FieldIssues issues={exact(issues, path)} />
        </fieldset>
    );
}

/**
 * A whole number kept within [min, max]. Typing is free; the value is stored
 * as soon as it is in range and clamped when the field loses focus, because the
 * server refuses a draft with an out-of-range number.
 */
export function NumberField({
    id,
    label,
    value,
    min,
    max,
    onChange,
    hint,
    issues,
    path,
}: {
    id: string;
    label: string;
    value: number;
    min: number;
    max: number;
    onChange: (v: number) => void;
    hint?: string;
    issues: CheckIssue[];
    path: string;
}) {
    const [text, setText] = useState(String(value));
    useEffect(() => setText(String(value)), [value]);
    const inRange = (n: number) => Number.isInteger(n) && n >= min && n <= max;
    const commit = () => {
        const n = Math.round(Number(text));
        const next =
            text.trim() !== '' && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : value;
        setText(String(next));
        if (next !== value) onChange(next);
    };
    return (
        <div className="space-y-1">
            <Label htmlFor={id}>{label}</Label>
            <Input
                id={id}
                type="number"
                inputMode="numeric"
                min={min}
                max={max}
                className="w-24"
                value={text}
                onChange={(e) => {
                    setText(e.target.value);
                    const n = Number(e.target.value);
                    if (e.target.value.trim() !== '' && inRange(n) && n !== value) onChange(n);
                }}
                onBlur={commit}
                aria-describedby={hint ? `${id}-hint` : undefined}
            />
            {hint && (
                <p id={`${id}-hint`} className="text-caption text-neutral-500">
                    {hint}
                </p>
            )}
            <FieldIssues issues={exact(issues, path)} />
        </div>
    );
}
