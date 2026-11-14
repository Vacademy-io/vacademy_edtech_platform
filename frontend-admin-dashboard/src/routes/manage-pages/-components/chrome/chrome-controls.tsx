import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash as Trash2 } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useEditorStore } from '../../-stores/editor-store';
import { ColorPickerField } from '../ColorPickerField';
import { HeaderChoice } from '../header/HeaderEditorFields';

/**
 * Small controls shared by the header, footer, banner and hero "look" fields.
 * Each one shows the original look while its key is unset and writes only
 * when the admin picks something different.
 */

type Option = { value: string; label: string };

/** A string from hand- or AI-written JSON, or undefined. */
export const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/** A plain object from hand- or AI-written JSON, or an empty one. */
export const obj = (v: unknown): Record<string, unknown> =>
    v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/** The site shows a band banner button unless enabled is false (and it has text). */
export const bandButtonShown = (button: unknown) =>
    Object.keys(obj(button)).length > 0 && obj(button).enabled !== false;

/**
 * True when the site has its own colour palette (globalSettings.theme.palette).
 * The editorial looks (band banner, editorial hero, header look) are drawn
 * from that palette, so their design choices are offered only on such sites
 * or on a section that already uses them; other sites see no change.
 */
export const useSiteHasPalette = () =>
    useEditorStore((s) => {
        const theme = obj(s.config?.globalSettings?.theme);
        return Object.keys(obj(theme.palette)).length > 0;
    });

/**
 * A row of choice buttons. `stored` is the saved value (undefined = unset,
 * which shows `fallback`); a value no option knows is shown as "Custom: …"
 * and stays selected. Clicking the choice already shown writes nothing.
 */
export const LookChoice = ({
    label,
    hint,
    stored,
    fallback,
    options,
    onChange,
}: {
    label: string;
    hint?: string;
    stored: unknown;
    fallback: string;
    options: Option[];
    onChange: (value: string) => void;
}) => {
    const { t } = useTranslation('managePagesPropertyPanel');
    const value = str(stored) ?? fallback;
    const known = options.some((o) => o.value === value);
    const all = known
        ? options
        : [...options, { value, label: t('options.customValue', { value }) }];
    return (
        <HeaderChoice
            label={label}
            hint={hint}
            value={value}
            options={all}
            onChange={(v) => v !== value && onChange(v)}
        />
    );
};

/**
 * A colour that is optional: unset means the site's own colour (shown as a
 * note), and "Use site colour" removes the saved one again.
 */
export const OptionalColorField = ({
    label,
    value,
    onChange,
}: {
    label: string;
    value: unknown;
    onChange: (color: string | undefined) => void;
}) => {
    const { t } = useTranslation('managePagesPropertyPanel');
    const color = str(value);
    return (
        <div className="space-y-1">
            <ColorPickerField label={label} value={color || ''} onChange={(c) => onChange(c)} />
            {color ? (
                <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-caption"
                    onClick={() => onChange(undefined)}
                >
                    {t('chromeLook.useSiteColour')}
                </Button>
            ) : (
                <p className="text-caption text-neutral-500">{t('chromeLook.siteColourNote')}</p>
            )}
        </div>
    );
};

/** A labelled one-line text box. */
export const TextField = ({
    label,
    value,
    onChange,
    placeholder,
}: {
    label: string;
    value: unknown;
    onChange: (value: string) => void;
    placeholder?: string;
}) => {
    const id = useId();
    return (
        <div className="space-y-1">
            <Label htmlFor={id} className="text-xs">
                {label}
            </Label>
            <Input
                id={id}
                className="h-8 text-xs"
                value={str(value) ?? ''}
                placeholder={placeholder}
                onChange={(e) => onChange(e.target.value)}
            />
        </div>
    );
};

/** An editable list of short texts (checklist bullets and the like). */
export const StringListField = ({
    label,
    items,
    onChange,
    placeholder,
}: {
    label: string;
    items: unknown;
    onChange: (next: string[]) => void;
    placeholder?: string;
}) => {
    const { t } = useTranslation('managePagesPropertyPanel');
    const list = Array.isArray(items) ? items.map((s) => (typeof s === 'string' ? s : '')) : [];
    return (
        <div className="space-y-1.5">
            <div className="flex items-center justify-between">
                <Label className="text-xs">{label}</Label>
                <Button
                    size="sm"
                    variant="outline"
                    className="h-6 px-2 text-xs"
                    onClick={() => onChange([...list, ''])}
                >
                    <Plus className="me-1 size-3" /> {t('actions.add')}
                </Button>
            </div>
            {list.map((item, i) => (
                <div key={i} className="flex items-center gap-1.5">
                    <Input
                        className="h-7 text-xs"
                        aria-label={`${label} ${i + 1}`}
                        value={item}
                        placeholder={placeholder}
                        onChange={(e) =>
                            onChange(list.map((s, j) => (j === i ? e.target.value : s)))
                        }
                    />
                    <Button
                        size="sm"
                        variant="ghost"
                        className="size-7 shrink-0 p-0 text-red-500"
                        title={t('actions.delete')}
                        // Names the row: every row has a Delete button.
                        aria-label={`${t('actions.delete')}: ${label} ${i + 1}`}
                        onClick={() => onChange(list.filter((_, j) => j !== i))}
                    >
                        <Trash2 className="size-3" />
                    </Button>
                </div>
            ))}
        </div>
    );
};
