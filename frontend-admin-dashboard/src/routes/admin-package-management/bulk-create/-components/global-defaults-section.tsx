import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { X, Plus, Info } from '@phosphor-icons/react';
import { useState } from 'react';
import {
    GlobalDefaults,
    LevelOption,
    SessionOption,
    CourseType,
    PaymentType,
} from '../-types/bulk-create-types';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/components/ui/tooltip';
import { BatchSelectorDialog } from './batch-selector-dialog';
import { TagSelectorDialog } from './tag-selector-dialog';
import { formatTagForDisplay } from '@/lib/utils';
import { getTerminology, getTerminologyPlural } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

interface GlobalDefaultsSectionProps {
    globalDefaults: GlobalDefaults;
    levels: LevelOption[];
    sessions: SessionOption[];
    onUpdate: (updates: Partial<GlobalDefaults>) => void;
    onAddLevel: (name: string) => Promise<LevelOption>;
    onAddSession: (name: string) => Promise<SessionOption>;
}

const getCourseTypes = (): { value: CourseType; label: string }[] => [
    { value: 'COURSE', label: getTerminology(ContentTerms.Course, SystemTerms.Course) },
    { value: 'MEMBERSHIP', label: 'Membership' },
    { value: 'PRODUCT', label: 'Product' },
    { value: 'SERVICE', label: 'Service' },
];

const PAYMENT_TYPES: { value: PaymentType; label: string }[] = [
    { value: 'FREE', label: 'Free' },
    { value: 'ONE_TIME', label: 'One-Time Payment' },
    { value: 'SUBSCRIPTION', label: 'Subscription' },
    { value: 'DONATION', label: 'Donation' },
];

export function GlobalDefaultsSection({
    globalDefaults,
    levels,
    sessions,
    onUpdate,
    onAddLevel,
    onAddSession,
}: GlobalDefaultsSectionProps) {
    const [showBatchDialog, setShowBatchDialog] = useState(false);
    const [showTagDialog, setShowTagDialog] = useState(false);

    const handleRemoveTag = (tag: string) => {
        onUpdate({ tags: globalDefaults.tags.filter((t) => t !== tag) });
    };

    const handleRemoveBatch = (index: number) => {
        const newBatches = [...globalDefaults.batches];
        newBatches.splice(index, 1);
        onUpdate({ batches: newBatches });
    };

    return (
        <div className="rounded-lg border border-neutral-200 bg-gradient-to-br from-blue-50/50 to-white p-4">
            <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-neutral-800">Global Defaults</h3>
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger>
                                <Info className="size-4 text-neutral-400" />
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs">
                                <p className="text-xs">
                                    These defaults will be applied to all {getTerminologyPlural(ContentTerms.Course, SystemTerms.Course).toLowerCase()} unless overridden
                                    at the {getTerminology(ContentTerms.Course, SystemTerms.Course).toLowerCase()} level.
                                </p>
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                </div>
                <div className="flex items-center gap-2">
                    <Label htmlFor="global-enabled" className="text-xs text-neutral-600">
                        Apply to all
                    </Label>
                    <Switch
                        id="global-enabled"
                        checked={globalDefaults.enabled}
                        onCheckedChange={(checked) => onUpdate({ enabled: checked })}
                    />
                </div>
            </div>

            {globalDefaults.enabled && (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {/* Course Type */}
                    <div className="space-y-1.5">
                        <Label className="text-xs text-neutral-600">Default {getTerminology(ContentTerms.Course, SystemTerms.Course)} Type</Label>
                        <Select
                            value={globalDefaults.course_type}
                            onValueChange={(value: CourseType) => onUpdate({ course_type: value })}
                        >
                            <SelectTrigger className="h-8 text-xs">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {getCourseTypes().map((type) => (
                                    <SelectItem key={type.value} value={type.value}>
                                        {type.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Payment Type */}
                    <div className="space-y-1.5">
                        <Label className="text-xs text-neutral-600">Default Payment Type</Label>
                        <Select
                            value={globalDefaults.payment_config.payment_type}
                            onValueChange={(value: PaymentType) =>
                                onUpdate({
                                    payment_config: {
                                        ...globalDefaults.payment_config,
                                        payment_type: value,
                                    },
                                })
                            }
                        >
                            <SelectTrigger className="h-8 text-xs">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {PAYMENT_TYPES.map((type) => (
                                    <SelectItem key={type.value} value={type.value}>
                                        {type.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Price (if applicable) */}
                    {(globalDefaults.payment_config.payment_type === 'ONE_TIME' ||
                        globalDefaults.payment_config.payment_type === 'SUBSCRIPTION') && (
                        <div className="space-y-1.5">
                            <Label className="text-xs text-neutral-600">Default Price (INR)</Label>
                            <Input
                                type="number"
                                className="h-8 text-xs"
                                placeholder="0"
                                value={globalDefaults.payment_config.price || ''}
                                onChange={(e) =>
                                    onUpdate({
                                        payment_config: {
                                            ...globalDefaults.payment_config,
                                            price: e.target.value ? Number(e.target.value) : undefined,
                                            currency: 'INR',
                                        },
                                    })
                                }
                            />
                        </div>
                    )}

                    {/* Default Validity (Days) — hidden when ONE_TIME with toggle off */}
                    {(globalDefaults.payment_config.payment_type === 'SUBSCRIPTION' ||
                        (globalDefaults.payment_config.payment_type === 'ONE_TIME' &&
                            globalDefaults.payment_config.is_validity_applicable !== false)) && (
                        <div className="space-y-1.5">
                            <Label className="text-xs text-neutral-600">
                                Default Validity (Days)
                            </Label>
                            <Input
                                type="number"
                                className="h-8 text-xs"
                                placeholder="e.g., 365"
                                value={globalDefaults.payment_config.validity_in_days ?? ''}
                                onChange={(e) =>
                                    onUpdate({
                                        payment_config: {
                                            ...globalDefaults.payment_config,
                                            validity_in_days: e.target.value
                                                ? Number(e.target.value)
                                                : undefined,
                                        },
                                    })
                                }
                            />
                        </div>
                    )}

                    {/* Set Validity toggle (ONE_TIME only) */}
                    {globalDefaults.payment_config.payment_type === 'ONE_TIME' && (
                        <div className="flex items-center gap-2 pt-5">
                            <Switch
                                id="global-set-validity"
                                checked={globalDefaults.payment_config.is_validity_applicable !== false}
                                onCheckedChange={(checked) =>
                                    onUpdate({
                                        payment_config: {
                                            ...globalDefaults.payment_config,
                                            is_validity_applicable: checked,
                                            validity_in_days: checked
                                                ? globalDefaults.payment_config.validity_in_days
                                                : null,
                                        },
                                    })
                                }
                            />
                            <Label
                                htmlFor="global-set-validity"
                                className="text-xs text-neutral-600"
                                title="Turn off for one-time purchases that don't expire"
                            >
                                Set validity
                            </Label>
                        </div>
                    )}

                    {/* Max Slots */}
                    <div className="space-y-1.5">
                        <Label className="text-xs text-neutral-600">
                            Max Seats (empty = unlimited)
                        </Label>
                        <Input
                            type="number"
                            className="h-8 text-xs"
                            placeholder="Unlimited"
                            value={globalDefaults.inventory_config.max_slots || ''}
                            onChange={(e) =>
                                onUpdate({
                                    inventory_config: {
                                        max_slots: e.target.value ? Number(e.target.value) : null,
                                        available_slots: e.target.value
                                            ? Number(e.target.value)
                                            : null,
                                    },
                                })
                            }
                        />
                    </div>

                    {/* Publish to Catalogue */}
                    <div className="flex items-center gap-2 pt-5">
                        <Switch
                            id="publish-catalogue"
                            checked={globalDefaults.publish_to_catalogue}
                            onCheckedChange={(checked) =>
                                onUpdate({ publish_to_catalogue: checked })
                            }
                        />
                        <Label htmlFor="publish-catalogue" className="text-xs text-neutral-600">
                            Publish to Catalogue
                        </Label>
                    </div>

                    {/* Default Batches */}
                    <div className="space-y-1.5 md:col-span-2 lg:col-span-3">
                        <div className="flex items-center justify-between">
                            <Label className="text-xs text-neutral-600">Default {getTerminologyPlural(ContentTerms.Batch, SystemTerms.Batch)}</Label>
                            <Button
                                variant="outline"
                                size="sm"
                                className="h-7 text-xs"
                                onClick={() => setShowBatchDialog(true)}
                            >
                                <Plus className="mr-1 size-3" />
                                Add {getTerminology(ContentTerms.Batch, SystemTerms.Batch)}
                            </Button>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {globalDefaults.batches.length === 0 ? (
                                <span className="text-xs text-neutral-400">
                                    No default {getTerminologyPlural(ContentTerms.Batch, SystemTerms.Batch).toLowerCase()} (will use DEFAULT {getTerminology(ContentTerms.Level, SystemTerms.Level).toLowerCase()}/{getTerminology(ContentTerms.Session, SystemTerms.Session).toLowerCase()})
                                </span>
                            ) : (
                                globalDefaults.batches.map((batch, index) => (
                                    <Badge
                                        key={index}
                                        variant="secondary"
                                        className="flex items-center gap-1 text-xs"
                                    >
                                        {batch.level_name || 'DEFAULT'} / {batch.session_name || 'DEFAULT'}
                                        <button
                                            onClick={() => handleRemoveBatch(index)}
                                            className="ml-1 hover:text-red-500"
                                        >
                                            <X className="size-3" />
                                        </button>
                                    </Badge>
                                ))
                            )}
                        </div>
                    </div>

                    {/* Default Tags */}
                    <div className="space-y-1.5 md:col-span-2 lg:col-span-3">
                        <Label className="text-xs text-neutral-600">Default Tags</Label>
                        <div className="flex flex-wrap items-center gap-1.5">
                            {globalDefaults.tags.map((tag) => (
                                <Badge
                                    key={tag}
                                    variant="outline"
                                    className="flex items-center gap-1 rounded-full text-xs"
                                >
                                    {formatTagForDisplay(tag)}
                                    <button
                                        type="button"
                                        onClick={() => handleRemoveTag(tag)}
                                        className="hover:text-red-500"
                                        aria-label={`Remove ${formatTagForDisplay(tag)}`}
                                    >
                                        <X className="size-3" />
                                    </button>
                                </Badge>
                            ))}
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-7"
                                onClick={() => setShowTagDialog(true)}
                            >
                                <Plus className="mr-1 size-3.5" />
                                {globalDefaults.tags.length === 0 ? 'Add Tags' : 'Manage Tags'}
                            </Button>
                        </div>
                    </div>
                </div>
            )}

            <BatchSelectorDialog
                open={showBatchDialog}
                onOpenChange={setShowBatchDialog}
                levels={levels}
                sessions={sessions}
                onAddLevel={onAddLevel}
                onAddSession={onAddSession}
                onSelect={(batch) => {
                    onUpdate({ batches: [...globalDefaults.batches, batch] });
                    setShowBatchDialog(false);
                }}
            />

            <TagSelectorDialog
                open={showTagDialog}
                onOpenChange={setShowTagDialog}
                selectedTags={globalDefaults.tags}
                onConfirm={(tags) => onUpdate({ tags })}
                title="Default Tags"
                description={`These tags will be applied to every new ${getTerminology(ContentTerms.Course, SystemTerms.Course).toLocaleLowerCase()}/book by default.`}
            />
        </div>
    );
}
