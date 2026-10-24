import { useId, useState, type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash as Trash2 } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LinkPicker } from '../LinkPicker';
import {
    LookChoice,
    OptionalColorField,
    StringListField,
    TextField,
    obj,
    str,
    useSiteHasPalette,
} from './chrome-controls';

/** Hero props are hand- or AI-written JSON: read them as unknown and narrow. */
type Props = Record<string, unknown>;

export interface HeroEditorialFieldsProps {
    /** The heroSection props. */
    props: Props;
    /** Writes one prop, keeping every other prop. */
    updateProp: (key: string, value: unknown) => void;
    /** Writes several props in one edit, keeping every other prop. */
    patchProps: (next: Props) => void;
    /** Writes one field of props.left (title, titleAccent, checklist…), keeping the rest of it. */
    updateLeft: (field: string, value: unknown) => void;
}

/**
 * "Home / Learning Paths": earlier items with a route are links (picked with
 * LinkPicker), the last is the current page.
 */
const BreadcrumbField = ({
    items,
    onChange,
}: {
    items: unknown;
    onChange: (next: Props[]) => void;
}) => {
    const { t } = useTranslation('managePagesPropertyPanel');
    const list = Array.isArray(items) ? items.map(obj) : [];
    const setItem = (i: number, field: 'label' | 'route', value: string) =>
        onChange(
            list.map((item, j) => {
                if (j !== i) return item;
                const next: Props = { ...item, [field]: value };
                // An empty route makes the item plain text, as on the site.
                if (field === 'route' && !value.trim()) delete next.route;
                return next;
            })
        );

    return (
        <div className="space-y-1.5">
            <div className="flex items-center justify-between">
                <Label className="text-xs">{t('heroEditorial.breadcrumb')}</Label>
                <Button
                    size="sm"
                    variant="outline"
                    className="h-6 px-2 text-xs"
                    onClick={() => onChange([...list, { label: '' }])}
                >
                    <Plus className="me-1 size-3" /> {t('actions.add')}
                </Button>
            </div>
            <p className="text-caption text-neutral-500">{t('heroEditorial.breadcrumbHint')}</p>
            {list.map((item, i) => (
                <div key={i} className="space-y-1.5 rounded border bg-white p-2">
                    <div className="flex items-center gap-1.5">
                        <Input
                            className="h-7 text-xs"
                            aria-label={t('heroEditorial.crumbLabel')}
                            placeholder={t('heroEditorial.crumbLabel')}
                            value={str(item.label) ?? ''}
                            onChange={(e) => setItem(i, 'label', e.target.value)}
                        />
                        <Button
                            size="sm"
                            variant="ghost"
                            className="size-7 shrink-0 p-0 text-red-500"
                            title={t('actions.delete')}
                            aria-label={`${t('actions.delete')}: ${str(item.label) || i + 1}`}
                            onClick={() => onChange(list.filter((_, j) => j !== i))}
                        >
                            <Trash2 className="size-3" />
                        </Button>
                    </div>
                    {/* The last item is this page and never a link on the site. */}
                    {i < list.length - 1 && (
                        <LinkPicker
                            label={t('heroEditorial.crumbRoute')}
                            value={str(item.route) ?? ''}
                            onChange={(v) => setItem(i, 'route', v)}
                        />
                    )}
                </div>
            ))}
        </div>
    );
};

/** The learner's resolveMediaWidth: 200–800, anything else reads as 500. */
const MEDIA_WIDTH_MIN = 200;
const MEDIA_WIDTH_MAX = 800;
const MEDIA_WIDTH_DEFAULT = 500;

/**
 * Fields of the "editorial" hero (accent line, checklist, breadcrumb, media
 * width, outline colour). PropertyPanel mounts it for every heroSection: the
 * Classic/Editorial choice shows on a site with its own palette or a hero
 * that already has a variant (other sites see no change), the rest only when
 * props.variant is 'editorial'.
 */
export const HeroEditorialFields: FC<HeroEditorialFieldsProps> = ({
    props,
    updateProp,
    updateLeft,
}) => {
    const { t } = useTranslation('managePagesPropertyPanel');
    const widthId = useId();
    const hasPalette = useSiteHasPalette();
    const left = obj(props.left);
    const width =
        typeof props.mediaWidth === 'number' || typeof props.mediaWidth === 'string'
            ? String(props.mediaWidth)
            : '';
    const hintId = useId();
    // The site uses 500 for anything outside 200–800, so "150" would make the
    // picture bigger: such a value is pulled into range when the field is left.
    const widthNumber = width === '' ? null : Number(width);
    const widthOutOfRange =
        widthNumber !== null && (!Number.isFinite(widthNumber) || widthNumber < MEDIA_WIDTH_MIN || widthNumber > MEDIA_WIDTH_MAX);
    const [clampedTo, setClampedTo] = useState<number | null>(null);
    const clampWidth = () => {
        if (!widthOutOfRange || widthNumber === null) return;
        const next = Number.isFinite(widthNumber)
            ? Math.min(MEDIA_WIDTH_MAX, Math.max(MEDIA_WIDTH_MIN, Math.round(widthNumber)))
            : MEDIA_WIDTH_DEFAULT;
        updateProp('mediaWidth', next);
        setClampedTo(next);
    };

    return (
        <div className="space-y-4">
            {(hasPalette || props.variant !== undefined) && (
                <LookChoice
                    label={t('heroEditorial.style')}
                    hint={t('heroEditorial.styleHint')}
                    stored={props.variant}
                    fallback="default"
                    options={[
                        { value: 'default', label: t('heroEditorial.styleClassic') },
                        { value: 'editorial', label: t('heroEditorial.styleEditorial') },
                    ]}
                    onChange={(v) => updateProp('variant', v === 'default' ? undefined : v)}
                />
            )}
            {props.variant === 'editorial' && (
                <div className="space-y-3 rounded border bg-gray-50 p-3">
                    <h5 className="text-xs font-semibold">{t('heroEditorial.heading')}</h5>
                    <TextField
                        label={t('heroEditorial.titleAccent')}
                        value={left.titleAccent}
                        placeholder={t('heroEditorial.titleAccentPlaceholder')}
                        onChange={(v) => updateLeft('titleAccent', v)}
                    />
                    <StringListField
                        label={t('heroEditorial.checklist')}
                        items={left.checklist}
                        onChange={(next) => updateLeft('checklist', next)}
                    />
                    <BreadcrumbField
                        items={props.breadcrumb}
                        onChange={(next) => updateProp('breadcrumb', next)}
                    />
                    <div className="space-y-1">
                        <Label className="text-xs" htmlFor={widthId}>
                            {t('heroEditorial.mediaWidth')}
                        </Label>
                        <Input
                            id={widthId}
                            type="number"
                            min={200}
                            max={800}
                            step={10}
                            className="h-8 text-xs"
                            placeholder="500"
                            value={width}
                            aria-invalid={widthOutOfRange || undefined}
                            aria-describedby={hintId}
                            onChange={(e) => {
                                setClampedTo(null);
                                updateProp(
                                    'mediaWidth',
                                    e.target.value === '' ? undefined : Number(e.target.value)
                                );
                            }}
                            onBlur={clampWidth}
                        />
                        <p
                            id={hintId}
                            role={clampedTo !== null ? 'status' : undefined}
                            className={`text-caption ${widthOutOfRange ? 'text-danger-600' : 'text-neutral-500'}`}
                        >
                            {clampedTo !== null
                                ? t('heroEditorial.mediaWidthClamped', { value: clampedTo })
                                : t('heroEditorial.mediaWidthHint')}
                        </p>
                    </div>
                    <OptionalColorField
                        label={t('heroEditorial.outlineColor')}
                        value={props.outlineColor}
                        onChange={(c) => updateProp('outlineColor', c)}
                    />
                </div>
            )}
        </div>
    );
};
