import { createLazyFileRoute } from '@tanstack/react-router';
import { SalesEnhancedHero } from './-components/SalesEnhancedHero';
import { SalesNeedsAttention } from './-components/SalesNeedsAttention';
import { useEffect, useState } from 'react';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { getInstituteId } from '@/constants/helper';
import { KpiBand } from './-components/KpiBand';
import { ConversionFunnelWidget } from './-components/ConversionFunnelWidget';
import { CounsellorLeaderboardWidget } from './-components/CounsellorLeaderboardWidget';
import { MissedFollowupsWidget, UpcomingFollowupsWidget } from './-components/FollowupsWidgets';
import {
    NewVsExistingLeadsWidget,
    ReassignmentVolumeWidget,
} from './-components/TimeSeriesWidgets';
import { CampaignCardsRow } from './-components/CampaignCardsRow';
import { TeamPicker } from '@/components/shared/crm/TeamPicker';
import { ConversionBySourceWidget } from './-components/ConversionBySourceWidget';
import { CallsPerDayWidget } from './-components/CallsPerDayWidget';
import { InsightsStrip } from './-components/InsightsStrip';
import { CallIntelligenceSummary } from '@/components/shared/leads';
// Reuse the disabled-notice from the counsellors route — same UX in both
// places, no need for a duplicate component.
import { FeatureDisabledNotice } from '@/routes/counsellors/-components/FeatureDisabledNotice';
import { getDisplaySettingsFromCache } from '@/services/display-settings';
import { getActiveRoleDisplaySettingsKey } from '@/lib/auth/instituteUtils';

export const Route = createLazyFileRoute('/sales-dashboard/')({
    component: RouteComponent,
});

type PresetKey = '7d' | '30d' | '90d' | 'custom';

// Typed by the exact literal union so `noUncheckedIndexedAccess` doesn't
// treat the lookup as possibly undefined. 'custom' isn't here — its window
// comes from the user-entered date inputs, not a preset formula.
const PRESETS: Record<Exclude<PresetKey, 'custom'>, () => { from: number; to: number }> = {
    '7d': () => ({ from: Date.now() - 7 * 86_400_000, to: Date.now() }),
    '30d': () => ({ from: Date.now() - 30 * 86_400_000, to: Date.now() }),
    '90d': () => ({ from: Date.now() - 90 * 86_400_000, to: Date.now() }),
};

const PRESET_LABEL: Record<PresetKey, string> = {
    '7d': '7d',
    '30d': '30d',
    '90d': '90d',
    custom: 'Custom',
};

// Parse a yyyy-mm-dd value from <input type="date"> into a UTC-midnight
// timestamp. Returns null for blanks so callers can fall back to a preset.
function parseDateInput(value: string, endOfDay: boolean): number | null {
    if (!value) return null;
    const parts = value.split('-');
    if (parts.length !== 3) return null;
    const [y, m, d] = parts.map((p) => Number(p));
    if (!y || !m || !d) return null;
    // End-date is end-of-day so the [from, to) window includes the picked day.
    return endOfDay ? Date.UTC(y, m - 1, d, 23, 59, 59, 999) : Date.UTC(y, m - 1, d, 0, 0, 0, 0);
}

/**
 * Read the display-settings gate. Pure-helper, called before any hooks fire
 * in RouteComponent — never call hooks here. Putting the gate between hooks
 * would violate Rules of Hooks (different render paths → different hook
 * counts → React crash).
 */
function isSalesDashboardEnabled(): boolean {
    // Must resolve through getActiveRoleDisplaySettingsKey so custom-role users
    // read the toggle from their own role's settings, not the teacher default.
    const ds = getDisplaySettingsFromCache(getActiveRoleDisplaySettingsKey());
    // Toggled from Display Settings → CRM → Leads sub-tabs (same place as
    // Lead List / Recent Leads / Follow-ups). Off by default per
    // SUB_ITEMS_HIDDEN_BY_DEFAULT in admin-defaults.
    const leadsTab = ds?.sidebar?.find((t) => t.id === 'leads');
    const sub = leadsTab?.subTabs?.find((s) => s.id === 'sales-dashboard');
    return sub?.visible === true;
}

function RouteComponent() {
    // Gate evaluated BEFORE any hooks. Each branch returns a different
    // component, so hooks belong to whichever subtree mounts — never the
    // same instance with a different hook count.
    if (!isSalesDashboardEnabled()) {
        return (
            <FeatureDisabledNotice
                title="Sales dashboard is not enabled"
                settingsLabel="Counsellor workbench"
            />
        );
    }
    return <SalesDashboardPage />;
}

function SalesDashboardPage() {
    const { setNavHeading } = useNavHeadingStore();
    const instituteId = getInstituteId();
    const [preset, setPreset] = useState<PresetKey>('30d');
    const [customStart, setCustomStart] = useState<string>('');
    const [customEnd, setCustomEnd] = useState<string>('');

    // Resolved window. Custom mode falls back to the 30d preset until BOTH
    // inputs are filled — partial entry shouldn't blank every widget out.
    const range = (() => {
        if (preset === 'custom') {
            const from = parseDateInput(customStart, false);
            const to = parseDateInput(customEnd, true);
            if (from != null && to != null && from < to) return { from, to };
            return PRESETS['30d']();
        }
        return PRESETS[preset]();
    })();
    const customReady =
        preset === 'custom' &&
        !!parseDateInput(customStart, false) &&
        !!parseDateInput(customEnd, true);

    // Team scope — fed to every widget. undefined = "All my teams" (backend
    // falls back to the caller's RBAC descendants / leads subtree). The
    // TeamPicker hides itself when the caller isn't in the leads team, so
    // this stays undefined for plain admins.
    const [teamId, setTeamId] = useState<string | undefined>(undefined);

    useEffect(() => {
        setNavHeading('Sales Dashboard');
    }, [setNavHeading]);

    if (!instituteId) return null;

    return (
        <LayoutContainer>
            <div className="space-y-4">
                {/* Header */}
                <div className="flex flex-wrap items-end justify-between gap-3">
                    <div>
                        <h2 className="text-h2 font-medium text-neutral-900">Sales</h2>
                        <p className="text-caption text-neutral-500">
                            Pipeline, followups, campaigns, and counsellor performance at a glance.
                        </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <TeamPicker instituteId={instituteId} value={teamId} onChange={setTeamId} />
                        <div className="flex items-center gap-1 rounded-md border border-neutral-200 bg-white p-1">
                            {(['7d', '30d', '90d', 'custom'] as const).map((p) => (
                                <button
                                    key={p}
                                    type="button"
                                    onClick={() => setPreset(p)}
                                    className={`rounded px-2.5 py-1 text-caption ${
                                        preset === p
                                            ? 'bg-primary-500 text-white'
                                            : 'text-neutral-600 hover:bg-neutral-50'
                                    }`}
                                >
                                    {PRESET_LABEL[p]}
                                </button>
                            ))}
                        </div>
                        {preset === 'custom' && (
                            <div className="flex flex-wrap items-center gap-2 rounded-md border border-neutral-200 bg-white px-2 py-1">
                                <input
                                    type="date"
                                    value={customStart}
                                    onChange={(e) => setCustomStart(e.target.value)}
                                    className="rounded border border-neutral-200 px-2 py-1 text-caption text-neutral-700"
                                    aria-label="Start date"
                                />
                                <span className="text-caption text-neutral-400">to</span>
                                <input
                                    type="date"
                                    value={customEnd}
                                    min={customStart || undefined}
                                    onChange={(e) => setCustomEnd(e.target.value)}
                                    className="rounded border border-neutral-200 px-2 py-1 text-caption text-neutral-700"
                                    aria-label="End date"
                                />
                                {!customReady && (
                                    <span className="text-caption text-warning-700">
                                        Pick both dates
                                    </span>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {/* trend hero, then insights. */}
                <SalesEnhancedHero teamId={teamId} />
                <InsightsStrip instituteId={instituteId} teamId={teamId} />

                {/* KPI band */}
                <KpiBand
                    instituteId={instituteId}
                    teamId={teamId}
                    from={range.from}
                    to={range.to}
                />

                {/* Row 2: Funnel + leaderboard */}
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    <ConversionFunnelWidget
                        instituteId={instituteId}
                        teamId={teamId}
                        from={range.from}
                        to={range.to}
                    />
                    <CounsellorLeaderboardWidget instituteId={instituteId} teamId={teamId} />
                </div>

                {/* Row 3: Followups */}
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    <UpcomingFollowupsWidget instituteId={instituteId} teamId={teamId} />
                    <MissedFollowupsWidget instituteId={instituteId} teamId={teamId} />
                </div>

                {/* Row 4: Time series */}
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    <NewVsExistingLeadsWidget
                        instituteId={instituteId}
                        teamId={teamId}
                        from={range.from}
                        to={range.to}
                    />
                    <ReassignmentVolumeWidget
                        instituteId={instituteId}
                        from={range.from}
                        to={range.to}
                    />
                </div>

                {/* Row 5: Source conversion + daily calls */}
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    <ConversionBySourceWidget
                        instituteId={instituteId}
                        teamId={teamId}
                        from={range.from}
                        to={range.to}
                    />
                    <CallsPerDayWidget
                        instituteId={instituteId}
                        teamId={teamId}
                        from={range.from}
                        to={range.to}
                    />
                </div>

                {/* Call Intelligence — team call-quality rollup (self-hides when the
                    feature is off or no calls analyzed). */}
                <CallIntelligenceSummary
                    mode="team"
                    instituteId={instituteId}
                    fromMillis={range.from}
                    toMillis={range.to}
                />

                {/* Bottom: campaigns + insights */}
                <CampaignCardsRow instituteId={instituteId} period="WEEK" />
                <SalesNeedsAttention teamId={teamId} />
            </div>
        </LayoutContainer>
    );
}
