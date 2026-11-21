import { useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDown, ArrowUp, Plus, Trash } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';

/**
 * Small form pieces shared by the courses-page design editors. Text fields
 * write on every keystroke (live preview), like the rest of the panel.
 */

/** One collapsible group ("Page header", "Course cards"…), closed by default so the panel stays short. */
export const DesignGroup = ({
    title,
    hint,
    children,
}: {
    title: string;
    hint?: ReactNode;
    children: ReactNode;
}) => (
    <details className="rounded border border-neutral-200">
        <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-neutral-700">
            {title}
        </summary>
        <div className="space-y-3 border-t border-neutral-100 p-3">
            {hint && <p className="text-caption text-neutral-500">{hint}</p>}
            {children}
        </div>
    </details>
);

/** A labelled sub-heading inside a group. */
export const SubHeading = ({ title, hint }: { title: string; hint?: ReactNode }) => (
    <div className="pt-1">
        <p className="text-xs font-semibold text-neutral-700">{title}</p>
        {hint && <p className="text-caption text-neutral-500">{hint}</p>}
    </div>
);

export const TextField = ({
    label,
    value,
    onChange,
    placeholder,
    hint,
    multiline,
    onBlur,
}: {
    label: string;
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
    hint?: ReactNode;
    multiline?: boolean;
    onBlur?: () => void;
}) => {
    const id = useId();
    const field = {
        id,
        value,
        placeholder,
        onBlur,
        'aria-describedby': hint ? `${id}-hint` : undefined,
    };
    return (
        <div>
            <Label htmlFor={id} className="text-xs">
                {label}
            </Label>
            {multiline ? (
                <Textarea
                    {...field}
                    className="mt-1 text-xs"
                    rows={3}
                    onChange={(e) => onChange(e.target.value)}
                />
            ) : (
                <Input
                    {...field}
                    className="mt-1 h-8 text-xs"
                    onChange={(e) => onChange(e.target.value)}
                />
            )}
            {hint && (
                <p id={`${id}-hint`} className="mt-1 text-caption text-neutral-500">
                    {hint}
                </p>
            )}
        </div>
    );
};

export const ToggleField = ({
    label,
    hint,
    checked,
    onChange,
}: {
    label: string;
    hint?: ReactNode;
    checked: boolean;
    onChange: (v: boolean) => void;
}) => (
    <div className="flex items-start justify-between gap-3">
        <div>
            <Label className="text-xs">{label}</Label>
            {hint && <p className="text-caption text-neutral-500">{hint}</p>}
        </div>
        <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </div>
);

/**
 * A native select. A stored value it does not offer stays selected, shown as
 * "Custom: value", so opening the panel never changes what the site does.
 */
export const SelectField = ({
    label,
    value,
    options,
    onChange,
    emptyLabel,
}: {
    label: string;
    value: string;
    options: { value: string; label: string }[];
    onChange: (v: string) => void;
    /** The first, empty choice ("Any category"); omit when a value is required. */
    emptyLabel?: string;
}) => {
    const { t } = useTranslation('managePagesPropertyPanel');
    const id = useId();
    const unknown = value !== '' && !options.some((o) => o.value === value);
    return (
        <div>
            <Label htmlFor={id} className="text-xs">
                {label}
            </Label>
            <select
                id={id}
                className="mt-1 w-full rounded border px-2 py-1.5 text-xs"
                value={value}
                onChange={(e) => onChange(e.target.value)}
            >
                {(emptyLabel !== undefined || value === '') && (
                    <option value="">{emptyLabel ?? ''}</option>
                )}
                {unknown && <option value={value}>{t('options.customValue', { value })}</option>}
                {options.map((o) => (
                    <option key={o.value} value={o.value}>
                        {o.label}
                    </option>
                ))}
            </select>
        </div>
    );
};

/** A bordered box around one list item, with its move / remove buttons in the corner. */
export const ItemBox = ({
    title,
    actions,
    children,
}: {
    title: string;
    actions?: ReactNode;
    children: ReactNode;
}) => (
    <div className="space-y-2 rounded border border-neutral-200 p-2">
        <div className="flex items-center justify-between gap-2">
            <p className="truncate text-caption font-medium text-neutral-600">{title}</p>
            {actions}
        </div>
        {children}
    </div>
);

/** Up / down / remove for item `index` of `count`; `item` names it for screen readers ("Chip 2"). */
export const RowActions = ({
    index,
    count,
    item,
    onMove,
    onRemove,
}: {
    index: number;
    count: number;
    item: string;
    onMove?: (delta: number) => void;
    onRemove?: () => void;
}) => {
    const { t } = useTranslation('managePagesPropertyPanel');
    return (
        <div className="flex shrink-0 items-center gap-0.5">
            {onMove && (
                <>
                    <MyButton
                        type="button"
                        buttonType="text"
                        layoutVariant="icon"
                        scale="small"
                        aria-label={t('catalogDesign.common.moveUp', { item })}
                        disabled={index === 0}
                        onClick={() => onMove(-1)}
                    >
                        <ArrowUp className="size-3.5" />
                    </MyButton>
                    <MyButton
                        type="button"
                        buttonType="text"
                        layoutVariant="icon"
                        scale="small"
                        aria-label={t('catalogDesign.common.moveDown', { item })}
                        disabled={index === count - 1}
                        onClick={() => onMove(1)}
                    >
                        <ArrowDown className="size-3.5" />
                    </MyButton>
                </>
            )}
            {onRemove && (
                <MyButton
                    type="button"
                    buttonType="text"
                    layoutVariant="icon"
                    scale="small"
                    aria-label={t('catalogDesign.common.remove', { item })}
                    onClick={onRemove}
                >
                    <Trash className="size-3.5 text-danger-600" />
                </MyButton>
            )}
        </div>
    );
};

export const AddButton = ({
    label,
    onClick,
    disabled,
}: {
    label: string;
    onClick: () => void;
    disabled?: boolean;
}) => (
    <MyButton
        type="button"
        buttonType="secondary"
        scale="small"
        onClick={onClick}
        disabled={disabled}
    >
        <Plus className="size-4" /> {label}
    </MyButton>
);
