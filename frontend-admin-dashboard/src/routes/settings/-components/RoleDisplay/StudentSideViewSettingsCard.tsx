import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { ArrowUp, ArrowDown } from '@phosphor-icons/react';
import type {
    StudentSideViewSettings,
    StudentSideViewVisibilityKey,
    StudentSideViewTabId,
} from '@/types/display-settings';
import {
    VISIBILITY_KEY_TO_TAB_ID,
    STUDENT_SIDE_VIEW_TAB_LABELS,
} from '@/constants/display-settings/student-side-view-tabs';

interface SideViewOption {
    key: StudentSideViewVisibilityKey;
    label: string;
}

interface StudentSideViewSettingsCardProps {
    options: SideViewOption[];
    settings: StudentSideViewSettings;
    defaults: StudentSideViewSettings;
    onChange: (next: StudentSideViewSettings) => void;
    /**
     * Rows the institute's plan includes (MANAGED; plan-rows.ts). Rows outside it
     * are not rendered and keep their stored visibility and position.
     */
    isShown?: (key: StudentSideViewVisibilityKey) => boolean;
}

// Render a tab's order index. Tabs without an explicit order land at the
// end of the list (Number.MAX_SAFE_INTEGER) but keep relative input order.
const orderOf = (tabId: StudentSideViewTabId, orders?: StudentSideViewSettings['tabOrders']) =>
    orders?.[tabId] ?? Number.MAX_SAFE_INTEGER;

// Sort options by current `tabOrders` so the UI reflects the saved order.
function sortOptionsByOrder(
    opts: SideViewOption[],
    orders?: StudentSideViewSettings['tabOrders']
): SideViewOption[] {
    return [...opts].sort((a, b) => {
        const oa = orderOf(VISIBILITY_KEY_TO_TAB_ID[a.key], orders);
        const ob = orderOf(VISIBILITY_KEY_TO_TAB_ID[b.key], orders);
        return oa - ob;
    });
}

// Rebuild a tabOrders map from a sorted array so order numbers stay
// contiguous after a swap.
function buildOrdersFromSorted(opts: SideViewOption[]): StudentSideViewSettings['tabOrders'] {
    const next: StudentSideViewSettings['tabOrders'] = {};
    opts.forEach((opt, idx) => {
        next[VISIBILITY_KEY_TO_TAB_ID[opt.key]] = idx + 1;
    });
    return next;
}

export const StudentSideViewSettingsCard = ({
    options,
    settings,
    defaults,
    onChange,
    isShown,
}: StudentSideViewSettingsCardProps) => {
    const { t } = useTranslation('settingsStudentSideViewSettingsCard');
    // Every row, in saved order — orders are rebuilt from this full list.
    const allSortedOptions = useMemo(
        () => sortOptionsByOrder(options, settings.tabOrders),
        [options, settings.tabOrders]
    );
    const sortedOptions = useMemo(
        () => (isShown ? allSortedOptions.filter((o) => isShown(o.key)) : allSortedOptions),
        [allSortedOptions, isShown]
    );

    // Swaps two SHOWN rows in place inside the full list, so rows outside the
    // plan keep their slots (and order numbers).
    const move = (index: number, direction: -1 | 1) => {
        const target = index + direction;
        if (target < 0 || target >= sortedOptions.length) return;
        const from = allSortedOptions.indexOf(sortedOptions[index]!);
        const to = allSortedOptions.indexOf(sortedOptions[target]!);
        const next = [...allSortedOptions];
        [next[from], next[to]] = [next[to]!, next[from]!];
        onChange({
            ...settings,
            tabOrders: buildOrdersFromSorted(next),
        });
    };

    const setVisibility = (key: StudentSideViewVisibilityKey, visible: boolean) => {
        onChange({
            ...settings,
            [key]: visible,
        });
    };

    const setDefaultTab = (tabId: StudentSideViewTabId) => {
        onChange({
            ...settings,
            defaultTab: tabId,
        });
    };

    // Only tabs that are visible can be the default. Fall back to first
    // visible tab if the saved default is now hidden.
    const visibleTabs = sortedOptions.filter((opt) => {
        const v = settings[opt.key];
        return typeof v === 'boolean' ? v : (defaults[opt.key] as boolean);
    });

    // The Notifications tab's own visibility, resolved the same way the rows above resolve theirs.
    const notificationTabVisible =
        typeof settings.notificationTab === 'boolean'
            ? settings.notificationTab
            : !!defaults.notificationTab;
    // Undefined means "never chosen" — fall through to the role's default rather than to a
    // literal, which would give every role the same answer.
    const resendAllowed = settings.allowResendMessage ?? defaults.allowResendMessage ?? true;

    const currentDefault: StudentSideViewTabId | undefined =
        settings.defaultTab &&
        visibleTabs.some((o) => VISIBILITY_KEY_TO_TAB_ID[o.key] === settings.defaultTab)
            ? settings.defaultTab
            : visibleTabs.length > 0
              ? VISIBILITY_KEY_TO_TAB_ID[visibleTabs[0]!.key]
              : undefined;

    return (
        <Card>
            <CardHeader>
                <CardTitle>{t('title')}</CardTitle>
                <CardDescription>{t('description')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
                {sortedOptions.map(({ key, label }, idx) => {
                    const visible = settings[key];
                    const checked =
                        typeof visible === 'boolean' ? visible : (defaults[key] as boolean);
                    return (
                        <div
                            key={key}
                            className="flex items-center justify-between gap-3 rounded border p-3"
                        >
                            <div className="flex items-center gap-1">
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="size-6"
                                    onClick={() => move(idx, -1)}
                                    disabled={idx === 0}
                                    aria-label={t('ariaLabel.moveUp', { label })}
                                >
                                    <ArrowUp className="size-3.5" />
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="size-6"
                                    onClick={() => move(idx, 1)}
                                    disabled={idx === sortedOptions.length - 1}
                                    aria-label={t('ariaLabel.moveDown', { label })}
                                >
                                    <ArrowDown className="size-3.5" />
                                </Button>
                                <span className="ml-2 text-sm">{label}</span>
                            </div>
                            <Switch
                                checked={checked}
                                onCheckedChange={(v) => setVisibility(key, v)}
                            />
                        </div>
                    );
                })}

                {/* Not a tab — a control INSIDE the Notifications tab, so it is shown only
                    when that tab is on. Hiding it with the tab keeps the card from offering a
                    switch for something the role cannot reach. */}
                {notificationTabVisible && (
                    <div className="mt-4 flex items-center justify-between gap-3 rounded border bg-neutral-50/50 p-3">
                        <div>
                            <Label className="text-sm font-medium">
                                {t('resendMessage.label')}
                            </Label>
                            <p className="text-xs text-muted-foreground">
                                {t('resendMessage.hint')}
                            </p>
                        </div>
                        <Switch
                            checked={resendAllowed}
                            onCheckedChange={(v) =>
                                onChange({ ...settings, allowResendMessage: v })
                            }
                        />
                    </div>
                )}

                <div className="mt-4 flex items-center justify-between gap-3 rounded border bg-neutral-50/50 p-3">
                    <div>
                        <Label className="text-sm font-medium">{t('defaultTab.label')}</Label>
                        <p className="text-xs text-muted-foreground">{t('defaultTab.hint')}</p>
                    </div>
                    <Select
                        value={currentDefault ?? ''}
                        onValueChange={(v) => setDefaultTab(v as StudentSideViewTabId)}
                        disabled={visibleTabs.length === 0}
                    >
                        <SelectTrigger className="w-56">
                            <SelectValue placeholder={t('defaultTab.placeholder')} />
                        </SelectTrigger>
                        <SelectContent>
                            {visibleTabs.map((opt) => {
                                const tabId = VISIBILITY_KEY_TO_TAB_ID[opt.key];
                                return (
                                    <SelectItem key={tabId} value={tabId}>
                                        {STUDENT_SIDE_VIEW_TAB_LABELS[tabId] ?? opt.label}
                                    </SelectItem>
                                );
                            })}
                        </SelectContent>
                    </Select>
                </div>
            </CardContent>
        </Card>
    );
};
