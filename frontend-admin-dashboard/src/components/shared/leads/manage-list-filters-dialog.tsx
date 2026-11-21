import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { ListCustomFieldControlsCard } from '@/routes/settings/-components/RoleDisplay/ListCustomFieldControlsCard';
import { getDisplaySettingsWithFallback, saveDisplaySettings } from '@/services/display-settings';
import {
    ADMIN_DISPLAY_SETTINGS_KEY,
    type DisplaySettingsData,
    type ListCustomFieldControls,
    type ListCustomFieldSurface,
    type ListUtmFilterControls,
    type ListBuiltInFilterControls,
} from '@/types/display-settings';

interface ManageListFiltersDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Which list surface to open the tabs on (Leads / Contacts / Students). */
    surface: ListCustomFieldSurface;
}

/**
 * Focused popup for the "Manage filters" button on the admin list pages. Edits
 * ONLY the `listCustomFieldControls` field of the ADMIN display-settings blob —
 * the exact key the list pages read from (useListCustomFieldControls) — so a
 * save shows up on their filter bars without navigating to the full Display
 * Settings screen. Load/save mirrors AdminDisplaySettings; after save it
 * invalidates the display-settings query so an already-open list refreshes in
 * place.
 */
export function ManageListFiltersDialog({
    open,
    onOpenChange,
    surface,
}: ManageListFiltersDialogProps) {
    const queryClient = useQueryClient();
    const [settings, setSettings] = useState<DisplaySettingsData | null>(null);
    const [controls, setControls] = useState<ListCustomFieldControls | undefined>(undefined);
    const [utmControls, setUtmControls] = useState<ListUtmFilterControls | undefined>(undefined);
    const [builtInControls, setBuiltInControls] = useState<ListBuiltInFilterControls | undefined>(
        undefined
    );
    const [dirty, setDirty] = useState(false);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);

    // Reload the ADMIN blob each time the dialog opens so it reflects the latest
    // saved config, and reset local edit state.
    useEffect(() => {
        if (!open) return;
        let cancelled = false;
        setLoading(true);
        setDirty(false);
        getDisplaySettingsWithFallback(ADMIN_DISPLAY_SETTINGS_KEY)
            .then((s) => {
                if (cancelled) return;
                setSettings(s);
                setControls(s.listCustomFieldControls);
                setUtmControls(s.listUtmFilterControls);
                setBuiltInControls(s.listBuiltInFilterControls);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [open]);

    const save = async () => {
        if (!settings) return;
        setSaving(true);
        try {
            await saveDisplaySettings(ADMIN_DISPLAY_SETTINGS_KEY, {
                ...settings,
                listCustomFieldControls: controls,
                listUtmFilterControls: utmControls,
                listBuiltInFilterControls: builtInControls,
            });
            // Refresh any currently-open list page's filter bar in place.
            await queryClient.invalidateQueries({
                queryKey: ['display-settings', ADMIN_DISPLAY_SETTINGS_KEY],
            });
            toast.success('List filters updated');
            onOpenChange(false);
        } catch {
            toast.error('Failed to save list filters');
        } finally {
            setSaving(false);
        }
    };

    return (
        <MyDialog
            heading="Manage list filters"
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-2xl"
            footer={
                <>
                    <MyButton
                        buttonType="secondary"
                        scale="medium"
                        onClick={() => onOpenChange(false)}
                        disable={saving}
                    >
                        Cancel
                    </MyButton>
                    <MyButton
                        buttonType="primary"
                        scale="medium"
                        onClick={save}
                        disable={!dirty || saving || loading}
                    >
                        {saving ? 'Saving…' : 'Save'}
                    </MyButton>
                </>
            }
        >
            {loading || !settings ? (
                <p className="py-8 text-center text-sm text-neutral-500">Loading…</p>
            ) : (
                <ListCustomFieldControlsCard
                    value={controls}
                    legacyLeadsFields={settings.leadsFilterCustomFields ?? []}
                    initialSurface={surface}
                    hideHeading
                    onChange={(next) => {
                        setControls(next);
                        setDirty(true);
                    }}
                    builtInValue={builtInControls}
                    onBuiltInChange={(next) => {
                        setBuiltInControls(next);
                        setDirty(true);
                    }}
                    utmValue={utmControls}
                    onUtmChange={(next) => {
                        setUtmControls(next);
                        setDirty(true);
                    }}
                />
            )}
        </MyDialog>
    );
}
