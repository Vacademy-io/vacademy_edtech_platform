import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectLabel,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    isManualTrigger,
    type BadgeDefinitionConfig,
} from '@/routes/settings/-constants/badge-config';
import { BadgeVisual } from '@/routes/settings/-constants/badge-icon-map';
import { CreateBadgeDialog } from './create-badge-dialog';

export interface BadgePickerProps {
    /** Catalogue entries to offer (callers pass the institute's enabled badges). */
    badges: BadgeDefinitionConfig[];
    /** Selected badge id; '' when nothing is picked. */
    value: string;
    onChange: (id: string) => void;
    /**
     * Badge ids the learner already holds as a staff award. Those items stay visible but
     * are disabled with an "Earned" suffix (awarding again would be a no-op).
     */
    earnedBadgeIds?: Set<string>;
    disabled?: boolean;
    /** Institute admins only — shows the "Create a new badge" affordance. */
    canCreate: boolean;
    /** Called with the server-persisted definition after a successful create. */
    onCreated?: (badge: BadgeDefinitionConfig) => void;
}

/**
 * Narrow-layout badge selector shared by the student side view and the bulk "Award badge"
 * dialog. Groups staff-awarded (manual) badges first, then achievement badges. Lives on the
 * `manageStudentsBadges` namespace.
 */
export function BadgePicker({
    badges,
    value,
    onChange,
    earnedBadgeIds,
    disabled,
    canCreate,
    onCreated,
}: BadgePickerProps) {
    const { t } = useTranslation('manageStudentsBadges');
    const [createOpen, setCreateOpen] = useState(false);

    const manual = badges.filter((b) => isManualTrigger(b.trigger));
    const auto = badges.filter((b) => !isManualTrigger(b.trigger));

    const renderItem = (badge: BadgeDefinitionConfig) => {
        const earned = earnedBadgeIds?.has(badge.id) ?? false;
        return (
            <SelectItem key={badge.id} value={badge.id} disabled={earned}>
                <span className="flex min-w-0 items-center gap-2">
                    <span className="flex size-5 shrink-0 items-center justify-center">
                        <BadgeVisual icon={badge.icon} size={16} className="text-primary-500" />
                    </span>
                    <span className="truncate">{badge.name}</span>
                    {earned && (
                        <span className="shrink-0 text-caption text-muted-foreground">
                            {t('picker.earned')}
                        </span>
                    )}
                </span>
            </SelectItem>
        );
    };

    return (
        <div className="flex flex-col gap-1.5">
            <Label className="text-caption font-semibold text-neutral-600">
                {t('picker.label')}
            </Label>
            {badges.length === 0 ? (
                <p className="text-caption italic text-muted-foreground">{t('picker.empty')}</p>
            ) : (
                <Select value={value} onValueChange={onChange} disabled={disabled}>
                    <SelectTrigger aria-label={t('picker.label')}>
                        <SelectValue placeholder={t('picker.placeholder')} />
                    </SelectTrigger>
                    <SelectContent>
                        {manual.length > 0 && (
                            <SelectGroup>
                                <SelectLabel className="text-caption text-muted-foreground">
                                    {t('picker.groupManual')}
                                </SelectLabel>
                                {manual.map(renderItem)}
                            </SelectGroup>
                        )}
                        {auto.length > 0 && (
                            <SelectGroup>
                                <SelectLabel className="text-caption text-muted-foreground">
                                    {t('picker.groupAuto')}
                                </SelectLabel>
                                {auto.map(renderItem)}
                            </SelectGroup>
                        )}
                    </SelectContent>
                </Select>
            )}
            {canCreate && (
                <div className="flex justify-start">
                    <MyButton
                        type="button"
                        buttonType="text"
                        scale="small"
                        disable={disabled}
                        onClick={() => setCreateOpen(true)}
                        className="gap-1 px-1"
                    >
                        <Plus className="size-3.5" />
                        {t('picker.create')}
                    </MyButton>
                    <CreateBadgeDialog
                        open={createOpen}
                        onOpenChange={setCreateOpen}
                        existingBadges={badges}
                        onCreated={(badge) => {
                            onCreated?.(badge);
                            onChange(badge.id);
                        }}
                    />
                </div>
            )}
        </div>
    );
}
