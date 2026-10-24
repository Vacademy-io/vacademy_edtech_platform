/**
 * "Copy to other roles" for the role display settings page.
 *
 * An institute with a Counsellor, a Front Desk and a Co-ordinator role usually
 * wants all three to see the same thing, and configuring them one at a time meant
 * reproducing every toggle by hand and living with the drift. This copies the role
 * currently open onto any set of the others — "All roles" for the common case, or
 * a specific few.
 *
 * The dialog is deliberately explicit about two things, because both are ways an
 * admin could otherwise overwrite work without meaning to:
 *
 *  - It names what will be OVERWRITTEN, and says so plainly. Every target role's
 *    existing display settings are replaced wholesale, not merged.
 *  - It refuses to run while the open panel has unsaved edits (enforced by the page
 *    header, which disables the trigger), rather than silently copying the last
 *    SAVED state — which is what a naive read would send, and is not what anyone
 *    pressing this button after making changes would expect.
 */

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { CircleNotch, Warning } from '@phosphor-icons/react';

import { MyDialog } from '@/components/design-system/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { MyButton } from '@/components/design-system/button';
import { getDisplaySettingsWithFallback } from '@/services/display-settings';
import {
    copyDisplaySettingsToRoles,
    type RoleCopyTarget,
} from '@/lib/display-settings/copy-to-roles';
import { cn } from '@/lib/utils';

export interface CopyToRolesDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Display-settings key of the role being copied FROM. */
    sourceSettingsKey: string;
    /** Human name of the source role, for the dialog copy. */
    sourceLabel: string;
    /** Every role that can be written to. The source is filtered out here. */
    targets: RoleCopyTarget[];
}

export default function CopyToRolesDialog({
    open,
    onOpenChange,
    sourceSettingsKey,
    sourceLabel,
    targets,
}: CopyToRolesDialogProps) {
    const { t } = useTranslation('settingsRoleDisplayMain');
    const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
    const [isCopying, setIsCopying] = useState(false);

    // Copying a role onto itself is a no-op that still costs a write and reads as a
    // mistake in the confirmation text, so it is never offered.
    const selectableTargets = useMemo(
        () => targets.filter((target) => target.settingsKey !== sourceSettingsKey),
        [targets, sourceSettingsKey]
    );

    const allSelected =
        selectableTargets.length > 0 && selectedKeys.length === selectableTargets.length;

    const toggleAll = (checked: boolean) => {
        setSelectedKeys(checked ? selectableTargets.map((target) => target.settingsKey) : []);
    };

    const toggleOne = (settingsKey: string, checked: boolean) => {
        setSelectedKeys((prev) =>
            checked ? [...prev, settingsKey] : prev.filter((key) => key !== settingsKey)
        );
    };

    const close = () => {
        // Reset rather than leave a stale selection behind — the next open is usually
        // a different intent, and a pre-ticked list is how someone overwrites a role
        // they had already handled.
        setSelectedKeys([]);
        onOpenChange(false);
    };

    const handleCopy = async () => {
        const chosen = selectableTargets.filter((target) =>
            selectedKeys.includes(target.settingsKey)
        );
        if (chosen.length === 0) return;

        setIsCopying(true);
        try {
            // Read the SAVED source settings. The trigger is disabled while the panel
            // is dirty, so this is what the admin is looking at.
            const settings = await getDisplaySettingsWithFallback(sourceSettingsKey);
            const result = await copyDisplaySettingsToRoles(settings, chosen);

            if (result.failed.length === 0) {
                toast.success(t('copyToRoles.toast.success', { count: result.succeeded.length }));
            } else if (result.succeeded.length === 0) {
                toast.error(
                    t('copyToRoles.toast.allFailed', { message: result.failed[0]?.message ?? '' })
                );
            } else {
                // Partial success is the outcome most worth naming precisely: some
                // roles now differ from the source and the admin has to know which.
                toast.warning(
                    t('copyToRoles.toast.partial', {
                        succeeded: result.succeeded.length,
                        failedRoles: result.failed.map((f) => f.label).join(', '),
                    })
                );
            }

            if (result.succeeded.length > 0) close();
        } catch (error) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const message = (error as any)?.message ?? '';
            toast.error(t('copyToRoles.toast.readFailed', { message }));
        } finally {
            setIsCopying(false);
        }
    };

    // MyDialog already wraps the footer in a right-aligned flex row.
    const footer = (
        <>
            <MyButton
                type="button"
                buttonType="secondary"
                scale="medium"
                onClick={close}
                disable={isCopying}
            >
                {t('copyToRoles.dialog.cancel')}
            </MyButton>
            <MyButton
                type="button"
                scale="medium"
                onClick={handleCopy}
                disable={selectedKeys.length === 0 || isCopying}
            >
                {isCopying ? (
                    <span className="flex items-center gap-2">
                        <CircleNotch className="size-4 animate-spin" />
                        {t('copyToRoles.dialog.copying')}
                    </span>
                ) : (
                    t('copyToRoles.dialog.confirm', { count: selectedKeys.length })
                )}
            </MyButton>
        </>
    );

    return (
        <MyDialog
            open={open}
            onOpenChange={(next) => (next ? onOpenChange(true) : close())}
            heading={t('copyToRoles.dialog.title')}
            dialogWidth="max-w-lg"
            footer={footer}
        >
            <div className="space-y-4">
                <p className="text-body text-neutral-600">
                    {t('copyToRoles.dialog.description', { role: sourceLabel })}
                </p>

                {selectableTargets.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-neutral-300 p-6 text-center text-body text-neutral-500">
                        {t('copyToRoles.dialog.noTargets')}
                    </div>
                ) : (
                    <div className="space-y-3">
                        <label
                            className={cn(
                                'flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors',
                                allSelected
                                    ? 'border-primary-300 bg-primary-50'
                                    : 'border-neutral-200 hover:bg-neutral-50'
                            )}
                        >
                            <Checkbox
                                checked={allSelected}
                                onCheckedChange={(checked) => toggleAll(checked === true)}
                                aria-label={t('copyToRoles.dialog.allRoles')}
                            />
                            <span className="text-body font-semibold text-neutral-800">
                                {t('copyToRoles.dialog.allRoles')}
                            </span>
                            <span className="ml-auto text-caption text-neutral-500">
                                {t('copyToRoles.dialog.roleCount', {
                                    count: selectableTargets.length,
                                })}
                            </span>
                        </label>

                        <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
                            {selectableTargets.map((target) => {
                                const checked = selectedKeys.includes(target.settingsKey);
                                return (
                                    <label
                                        key={target.settingsKey}
                                        className={cn(
                                            'flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-body transition-colors',
                                            checked
                                                ? 'bg-primary-50 text-neutral-900'
                                                : 'text-neutral-700 hover:bg-neutral-50'
                                        )}
                                    >
                                        <Checkbox
                                            checked={checked}
                                            onCheckedChange={(next) =>
                                                toggleOne(target.settingsKey, next === true)
                                            }
                                        />
                                        <span className="truncate">{target.label}</span>
                                    </label>
                                );
                            })}
                        </div>

                        {selectedKeys.length > 0 && (
                            <div className="flex items-start gap-2 rounded-lg border border-warning-200 bg-warning-50 p-3 text-caption text-neutral-700">
                                <Warning className="mt-0.5 size-4 shrink-0 text-warning-600" />
                                <span>
                                    {t('copyToRoles.dialog.overwriteWarning', {
                                        count: selectedKeys.length,
                                    })}
                                </span>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </MyDialog>
    );
}
