import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import type { FolderImageShape, FolderLayout, FolderView } from '../../-services/folder-library-service';

/**
 * How a folder lays out its children — the same controls set the section's
 * default (property panel) and a single folder's override (folder manager),
 * so an admin learns them once.
 */

export const FOLDER_VIEW_DEFAULTS: Required<FolderView> = {
    layout: 'cards',
    imageShape: 'landscape',
    columns: 3,
    showDescription: true,
    showCounts: true,
};

const LAYOUTS: { value: FolderLayout; label: string; hint: string }[] = [
    { value: 'cards', label: 'Cards', hint: 'Image on top, text below' },
    { value: 'tiles', label: 'Tiles', hint: 'Title over a full image' },
    { value: 'list', label: 'List', hint: 'Compact rows with a thumbnail' },
];

const SHAPES: { value: FolderImageShape; label: string }[] = [
    { value: 'landscape', label: 'Wide' },
    { value: 'square', label: 'Square' },
    { value: 'portrait', label: 'Tall' },
    { value: 'none', label: 'No image' },
];

const COLUMNS = [2, 3, 4, 5];

const Segment = <T extends string | number>({
    options,
    value,
    onChange,
    disabled,
}: {
    options: { value: T; label: string; hint?: string }[];
    value: T;
    onChange: (v: T) => void;
    disabled?: boolean;
}) => (
    <div className="mt-1 flex flex-wrap gap-1">
        {options.map((o) => (
            <button
                key={String(o.value)}
                type="button"
                title={o.hint}
                disabled={disabled}
                onClick={() => onChange(o.value)}
                className={cn(
                    'rounded px-2.5 py-1 text-caption font-medium transition-colors disabled:opacity-50',
                    value === o.value ? 'bg-primary-100 text-primary-500' : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
                )}
            >
                {o.label}
            </button>
        ))}
    </div>
);

interface FolderViewFieldsProps {
    value: FolderView;
    onChange: (next: FolderView) => void;
    disabled?: boolean;
}

export const FolderViewFields = ({ value, onChange, disabled }: FolderViewFieldsProps) => {
    // Shown with defaults filled in, but only the keys the admin actually sets
    // are handed back — a folder override must not freeze the section's other
    // settings, and the section editor merges the result into its props.
    const v = { ...FOLDER_VIEW_DEFAULTS, ...value };
    const set = <K extends keyof FolderView>(key: K, next: FolderView[K]) => onChange({ ...value, [key]: next });
    // Tiles ARE the image; "No image" would leave an empty coloured box.
    const shapes = v.layout === 'tiles' ? SHAPES.filter((s) => s.value !== 'none') : SHAPES;

    return (
        <div className="space-y-3">
            <div>
                <Label className="text-xs">Layout</Label>
                <Segment
                    options={LAYOUTS}
                    value={v.layout}
                    disabled={disabled}
                    onChange={(layout) =>
                        onChange({
                            ...value,
                            layout,
                            ...(layout === 'tiles' && v.imageShape === 'none' ? { imageShape: 'landscape' as const } : {}),
                        })
                    }
                />
            </div>
            <div>
                <Label className="text-xs">Image shape</Label>
                <Segment options={shapes} value={v.imageShape} disabled={disabled} onChange={(s) => set('imageShape', s)} />
            </div>
            {v.layout !== 'list' && (
                <div>
                    <Label className="text-xs">Columns on desktop</Label>
                    <Segment
                        options={COLUMNS.map((c) => ({ value: c, label: String(c) }))}
                        value={v.columns}
                        disabled={disabled}
                        onChange={(c) => set('columns', c)}
                    />
                </div>
            )}
            <div className="flex items-center justify-between gap-3">
                <Label className="text-xs">Show descriptions</Label>
                <Switch
                    checked={v.showDescription}
                    disabled={disabled}
                    onCheckedChange={(c) => set('showDescription', c)}
                />
            </div>
            <div className="flex items-center justify-between gap-3">
                <Label className="text-xs">Show item counts</Label>
                <Switch checked={v.showCounts} disabled={disabled} onCheckedChange={(c) => set('showCounts', c)} />
            </div>
        </div>
    );
};
