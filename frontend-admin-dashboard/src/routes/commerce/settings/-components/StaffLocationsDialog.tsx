import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from '@tanstack/react-router';
import { toast } from 'sonner';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import {
    CommerceEmptyState,
    CommerceErrorState,
    CommerceLoadingRows,
} from '@/routes/commerce/-components/CommerceStates';
import { readCommerceError } from '@/routes/commerce/-shared/commerce-errors';
import {
    useLocations,
    useSaveStaffLocations,
    useStaffLocations,
} from '@/routes/commerce/-shared/commerce-hooks';
import type { CommerceStaffMember } from '@/routes/commerce/-shared/commerce-types';

interface StaffLocationsDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    member: CommerceStaffMember | null;
}

/**
 * Which locations a staff member may act at (`PUT /staff/locations` takes the
 * FULL set). Staff with a commerce role act only at their allowed locations;
 * an institute ADMIN is not limited by this list.
 */
export function StaffLocationsDialog({ open, onOpenChange, member }: StaffLocationsDialogProps) {
    const { t } = useTranslation('commerce');
    const userId = open ? member?.user_id : null;
    const locationsQuery = useLocations(open);
    const assignedQuery = useStaffLocations(userId, open);
    const mutation = useSaveStaffLocations();
    const [selected, setSelected] = useState<Set<string>>(new Set());

    useEffect(() => {
        if (open && assignedQuery.data) setSelected(new Set(assignedQuery.data.location_ids));
    }, [open, assignedQuery.data]);

    const loading = locationsQuery.isLoading || assignedQuery.isLoading;
    const failed = locationsQuery.isError || assignedQuery.isError;
    const locations = (locationsQuery.data ?? []).filter(
        (location) =>
            (location.status ?? 'ACTIVE').toUpperCase() !== 'INACTIVE' || selected.has(location.id)
    );
    const ready = !loading && !failed;

    const toggle = (locationId: string, checked: boolean) =>
        setSelected((previous) => {
            const next = new Set(previous);
            if (checked) next.add(locationId);
            else next.delete(locationId);
            return next;
        });

    const save = async () => {
        if (!member) return;
        try {
            await mutation.mutateAsync({
                user_id: member.user_id,
                location_ids: Array.from(selected),
            });
            toast.success(t('staff.locationsDialog.saved', { name: member.full_name }));
            onOpenChange(false);
        } catch (error) {
            toast.error(readCommerceError(error, t('staff.locationsDialog.saveFailed')).message);
        }
    };

    return (
        <MyDialog
            heading={t('staff.locationsDialog.heading', { name: member?.full_name ?? '' })}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-md"
            footer={
                <div className="flex justify-end gap-2">
                    <MyButton
                        buttonType="secondary"
                        scale="medium"
                        type="button"
                        onClick={() => onOpenChange(false)}
                    >
                        {t('common.cancel')}
                    </MyButton>
                    <MyButton
                        buttonType="primary"
                        scale="medium"
                        type="button"
                        disable={!ready || locations.length === 0}
                        onAsyncClick={save}
                        loadingText={t('common.saving')}
                    >
                        {t('common.save')}
                    </MyButton>
                </div>
            }
        >
            <div className="flex flex-col gap-4">
                <p className="text-body text-muted-foreground">
                    {member?.is_admin
                        ? t('staff.locationsDialog.adminNote')
                        : t('staff.locationsDialog.description')}
                </p>
                {loading && <CommerceLoadingRows rows={3} />}
                {failed && (
                    <CommerceErrorState
                        message={
                            readCommerceError(
                                locationsQuery.error ?? assignedQuery.error,
                                t('staff.locationsDialog.loadFailed')
                            ).message
                        }
                        onRetry={() => {
                            void locationsQuery.refetch();
                            void assignedQuery.refetch();
                        }}
                    />
                )}
                {ready && locations.length === 0 && (
                    <CommerceEmptyState
                        title={t('staff.locationsDialog.noLocations')}
                        description={
                            <Link
                                to="/commerce/settings/locations"
                                className="text-primary-500 hover:underline"
                            >
                                {t('staff.locationsDialog.addLocations')}
                            </Link>
                        }
                    />
                )}
                {ready && locations.length > 0 && (
                    <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
                        {locations.map((location) => {
                            const inputId = `staff-location-${location.id}`;
                            return (
                                <li key={location.id} className="flex items-center gap-3 p-3">
                                    <Checkbox
                                        id={inputId}
                                        checked={selected.has(location.id)}
                                        onCheckedChange={(checked) =>
                                            toggle(location.id, checked === true)
                                        }
                                    />
                                    <label htmlFor={inputId} className="flex flex-1 flex-col">
                                        <span className="text-body text-foreground">
                                            {location.name}
                                        </span>
                                        <span className="font-mono text-caption text-muted-foreground">
                                            {location.code}
                                        </span>
                                    </label>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>
        </MyDialog>
    );
}
