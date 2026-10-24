import { MyButton } from '@/components/design-system/button';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import type { Icon } from '@phosphor-icons/react';
import {
    Buildings,
    CalendarBlank,
    CheckSquare,
    CopySimple,
    DotsNine,
    Envelope,
    File as FileIcon,
    Hash,
    Link as LinkIcon,
    Phone,
    PencilSimple,
    RadioButton,
    TextAlignLeft,
    TextT,
    TrashSimple,
    User,
} from '@phosphor-icons/react';

/** Human label + icon + tint per field type, keyed by the stored type string. */
const TYPE_META: Record<
    string,
    { label: string; Icon: Icon; tint: string }
> = {
    textfield: { label: 'Short Text', Icon: TextT, tint: 'bg-info-50 text-info-600' },
    text: { label: 'Short Text', Icon: TextT, tint: 'bg-info-50 text-info-600' },
    textarea: { label: 'Paragraph', Icon: TextAlignLeft, tint: 'bg-info-50 text-info-600' },
    number: { label: 'Number', Icon: Hash, tint: 'bg-info-50 text-info-600' },
    email: { label: 'Email', Icon: Envelope, tint: 'bg-success-50 text-success-600' },
    phone: { label: 'Phone Number', Icon: Phone, tint: 'bg-success-50 text-success-600' },
    url: { label: 'URL', Icon: LinkIcon, tint: 'bg-info-50 text-info-600' },
    date: { label: 'Date', Icon: CalendarBlank, tint: 'bg-primary-50 text-primary-600' },
    dropdown: { label: 'Dropdown', Icon: DotsNine, tint: 'bg-warning-50 text-warning-600' },
    radio: { label: 'Radio', Icon: RadioButton, tint: 'bg-warning-50 text-warning-600' },
    multi_select: { label: 'Multi-Select', Icon: CheckSquare, tint: 'bg-warning-50 text-warning-600' },
    checkbox: { label: 'Checkbox', Icon: CheckSquare, tint: 'bg-warning-50 text-warning-600' },
    file: { label: 'File Upload', Icon: FileIcon, tint: 'bg-neutral-100 text-neutral-600' },
};

/** Field names that read better with a specific icon than their bare type. */
const NAME_ICON_OVERRIDES: { match: RegExp; Icon: Icon }[] = [
    { match: /full ?name|^name$/i, Icon: User },
    { match: /gender/i, Icon: User },
    { match: /college|school|institute/i, Icon: Buildings },
    { match: /city|state|address/i, Icon: Buildings },
];

const resolveTypeMeta = (type: string, name: string) => {
    const base = TYPE_META[(type ?? '').toLowerCase()] ?? {
        label: type || 'Short Text',
        Icon: TextT,
        tint: 'bg-neutral-100 text-neutral-600',
    };
    const override = NAME_ICON_OVERRIDES.find((o) => o.match.test(name));
    return override ? { ...base, Icon: override.Icon } : base;
};

interface FormFieldRowProps {
    /** 1-based position shown in the leading badge. */
    position: number;
    name: string;
    type: string;
    isRequired: boolean;
    /**
     * Reason the Required switch cannot be turned OFF right now (e.g. the form verifies this
     * contact channel with an OTP). Set only for a genuine dependency — being a built-in field is
     * NOT one: an institute that does not collect phone numbers has to be able to make Phone
     * Number optional.
     *
     * It only ever locks a field that is already required. Locking an optional one would be a
     * dead end: the admin could not switch it on, and could not save either.
     */
    requiredLockReason?: string;
    isEditing?: boolean;
    onToggleRequired: () => void;
    onEdit: () => void;
    onDuplicate?: () => void;
    onDelete: () => void;
    dragHandle: React.ReactNode;
    /** Inline editor panel, rendered under the row while editing. */
    children?: React.ReactNode;
}

export const FormFieldRow = ({
    position,
    name,
    type,
    isRequired,
    requiredLockReason,
    isEditing = false,
    onToggleRequired,
    onEdit,
    onDuplicate,
    onDelete,
    dragHandle,
    children,
}: FormFieldRowProps) => {
    const { label, Icon, tint } = resolveTypeMeta(type, name);
    // A stated dependency keeps a required field required; it never blocks turning one ON.
    const lockedOn = !!requiredLockReason && isRequired;

    return (
        <div className="flex flex-col gap-2">
            <div
                className={cn(
                    'flex flex-wrap items-center gap-3 rounded-lg border bg-card px-3 py-3 transition-colors sm:flex-nowrap sm:gap-4',
                    isEditing ? 'border-primary-300' : 'border-neutral-200'
                )}
            >
                <span className="shrink-0 text-neutral-400">{dragHandle}</span>

                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-info-50 text-caption font-semibold text-info-600">
                    {position}
                </span>

                <span
                    className={cn(
                        'flex size-9 shrink-0 items-center justify-center rounded-lg',
                        tint
                    )}
                >
                    <Icon size={18} />
                </span>

                <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-body font-semibold text-neutral-800">
                        {name || <span className="text-neutral-400">Untitled field</span>}
                    </span>
                    <span className="truncate text-caption text-neutral-500">{label}</span>
                </span>

                {/* Required stays the admin's call on EVERY field, built-ins
                    included: a form that does not collect phone numbers has to
                    be able to make Phone Number optional. Only a real
                    dependency (an OTP verified on that channel) locks it, and
                    then the reason is spelled out on hover. */}
                <span
                    className="flex w-24 shrink-0 justify-center"
                    title={requiredLockReason || undefined}
                >
                    <Switch
                        checked={isRequired}
                        disabled={lockedOn}
                        onCheckedChange={lockedOn ? undefined : onToggleRequired}
                        aria-label={`${name || 'Field'} is required`}
                    />
                </span>

                {/* Nothing is locked here any more. Full Name / Email / Phone Number used to
                    be un-renamable and un-removable built-ins; institutes that word them
                    differently, or do not collect one of them, need them to be ordinary fields. */}
                <span className="flex w-32 shrink-0 items-center justify-center gap-2">
                    <MyButton
                        type="button"
                        scale="medium"
                        buttonType="secondary"
                        layoutVariant="icon"
                        aria-label={isEditing ? 'Close editor' : 'Edit field'}
                        onClick={onEdit}
                    >
                        <PencilSimple className="!size-4" />
                    </MyButton>
                    <MyButton
                        type="button"
                        scale="medium"
                        buttonType="secondary"
                        layoutVariant="icon"
                        disable={!onDuplicate}
                        aria-label="Duplicate field"
                        onClick={onDuplicate}
                    >
                        <CopySimple className="!size-4" />
                    </MyButton>
                    <MyButton
                        type="button"
                        scale="medium"
                        buttonType="secondary"
                        layoutVariant="icon"
                        aria-label="Delete field"
                        onClick={onDelete}
                    >
                        <TrashSimple className="!size-4 text-danger-500" />
                    </MyButton>
                </span>
            </div>
            {isEditing && children}
        </div>
    );
};

/** Column headings for a FormFieldRow list — keeps widths in sync with the row. */
export const FormFieldRowHeader = () => (
    <div className="flex items-center gap-3 px-3 pb-1 sm:gap-4">
        <span className="flex-1 text-caption font-semibold text-neutral-500">Field</span>
        <span className="w-24 shrink-0 text-center text-caption font-semibold text-neutral-500">
            Required
        </span>
        <span className="w-32 shrink-0 text-center text-caption font-semibold text-neutral-500">
            Actions
        </span>
    </div>
);
