/**
 * The lead's own status and tier, offered right where a counsellor logs an
 * activity or books a follow-up — so "spoke to them, now Hot, send the fee
 * structure" is one save instead of a note plus two trips to the lead table.
 *
 * Shown under the institute's own words for them (e.g. "Action Label" /
 * "Interest Level"). Not the same thing as the follow-up's Interest level
 * dropdown in follow-up-fields.tsx: that one is recorded on the follow-up, this
 * one moves the LEAD, exactly like the inline selects in the lead tables.
 *
 * Off for every institute until Settings → Lead settings → Follow-up fields →
 * "Lead status and tier in the activity pop-up" is switched on. Both start as
 * "Keep current" and nothing is posted unless the counsellor picks something.
 */
import { useRef, useState } from 'react';
import { useQuery, type QueryClient } from '@tanstack/react-query';
import { Label } from '@/components/ui/label';
import { SearchableSelect } from '@/components/design-system/searchable-select';
import { useLeadSettings } from '@/hooks/use-lead-settings';
import { useLeadTerminology } from '@/hooks/use-lead-terminology';
import { useLeadStatuses, setLeadStatusForLead } from '@/hooks/use-lead-statuses';
import { useLeadTiers } from '@/hooks/use-lead-tiers';
import { invalidateLeadCaches } from '@/hooks/use-invalidate-lead-caches';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { cn } from '@/lib/utils';
import { updateLeadTier } from './services/update-lead-tier';
import { CONVERTED_STATUS_KEY, checkAdmission } from './services/admission-check';

export type LeadAttributeKey = 'status' | 'tier';

interface UseLeadAttributeFieldsArgs {
    /** Needed for the tier — it lives on the person's lead profile. */
    userId?: string | null;
    /** Needed for the status — it lives on the lead (audience response). */
    audienceResponseId?: string | null;
}

/**
 * Local picks plus the catalogs. `apply()` posts whatever was picked and is
 * safe to call again after a later step fails: a change that already went
 * through is not sent twice.
 */
export function useLeadAttributeFields({ userId, audienceResponseId }: UseLeadAttributeFieldsArgs) {
    const { followUpFields } = useLeadSettings();
    const enabled = followUpFields.leadStatusAndTier;
    const { statuses } = useLeadStatuses({ skip: !enabled });
    const { tiers } = useLeadTiers({ skip: !enabled });
    const [statusId, setStatusId] = useState('');
    const [tierKey, setTierKey] = useState('');
    const doneRef = useRef({ status: false, tier: false });

    const activeStatuses = statuses.filter((s) => s.is_active !== false);
    const showStatus = enabled && !!audienceResponseId && activeStatuses.length > 0;
    const showTier = enabled && !!userId && tiers.length > 0;
    const tierRequired = showTier && followUpFields.leadTierRequired;

    // Picking the admission status (CONVERTED) for someone with no course or fee plan yet:
    // the institute may ask for a warning or refuse it (Settings → Lead Statuses). Shown
    // inline here; the server refuses a BLOCK case on save, which stops the whole save.
    const pickedStatus = activeStatuses.find((s) => s.id === statusId);
    const instituteId = getCurrentInstituteId() ?? '';
    const checkConversion =
        showStatus && pickedStatus?.status_key === CONVERTED_STATUS_KEY && !!instituteId;
    const { data: admission } = useQuery({
        queryKey: ['admission-check', instituteId, audienceResponseId],
        queryFn: () => checkAdmission(instituteId, [audienceResponseId as string]),
        enabled: checkConversion,
        staleTime: 30 * 1000,
    });
    const statusLabel = pickedStatus?.label ?? 'Converted';
    const admissionNotice: { tone: 'warn' | 'block'; text: string } | null =
        checkConversion &&
        admission &&
        admission.mode !== 'OFF' &&
        admission.without_course_count > 0
            ? admission.mode === 'BLOCK'
                ? {
                      tone: 'block',
                      text: `This person has no course or fee plan yet, so they can’t be moved to ${statusLabel}. Add the course or fee plan first.`,
                  }
                : {
                      tone: 'warn',
                      text: `This person has no course or fee plan yet. If you save, the admission won’t show a course or fees in your reports until one is added.`,
                  }
            : null;

    const reset = () => {
        setStatusId('');
        setTierKey('');
        doneRef.current = { status: false, tier: false };
    };

    /** True when something was posted — the caller then refreshes lead caches. */
    const apply = async (): Promise<boolean> => {
        let changed = false;
        if (showStatus && statusId && !doneRef.current.status) {
            await setLeadStatusForLead(audienceResponseId as string, statusId, 'MANUAL');
            doneRef.current.status = true;
            changed = true;
        }
        if (showTier && tierKey && !doneRef.current.tier) {
            await updateLeadTier(userId as string, getCurrentInstituteId() ?? '', tierKey);
            doneRef.current.tier = true;
            changed = true;
        }
        return changed;
    };

    return {
        statusId,
        setStatusId,
        tierKey,
        setTierKey,
        /** status_key of the picked status ('' = keep current) — e.g. to spot LOST. */
        statusKey: pickedStatus?.status_key ?? '',
        /** A warning or refusal for moving someone with no course or fee plan to CONVERTED. */
        admissionNotice,
        statusOptions: activeStatuses.map((s) => ({ label: s.label, value: s.id })),
        tierOptions: tiers.map((t) => ({ label: t.label, value: t.tier_key })),
        showStatus,
        showTier,
        /** Institute requires a tier on follow-ups — callers apply it only there. */
        tierRequired,
        tierMissing: tierRequired && !tierKey,
        visible: showStatus || showTier,
        reset,
        apply,
    };
}

export type LeadAttributeFieldsState = ReturnType<typeof useLeadAttributeFields>;

/** Refresh every list / profile that shows a lead's status or tier. */
export function invalidateLeadAttributeCaches(queryClient: QueryClient, userId?: string | null) {
    if (userId) invalidateLeadCaches(queryClient, userId);
    queryClient.invalidateQueries({ queryKey: ['lead-profiles-batch'] });
    queryClient.invalidateQueries({ queryKey: ['recent-leads'] });
    queryClient.invalidateQueries({ queryKey: ['campaign-users'] });
    queryClient.invalidateQueries({ queryKey: ['follow-ups'] });
    queryClient.invalidateQueries({ queryKey: ['lead-board'] });
}

interface LeadAttributeFieldsProps {
    fields: LeadAttributeFieldsState;
    /** Render only these — the post-call sheet already has its own status picker. */
    only?: LeadAttributeKey[];
    /** Pass false inside a Dialog/Sheet — a portalled list can't be scrolled there. */
    portal?: boolean;
    /** This form books a follow-up — mark the tier * when the institute requires it. */
    followUp?: boolean;
    disabled?: boolean;
    className?: string;
}

export function LeadAttributeFields({
    fields,
    only,
    portal = true,
    followUp = false,
    disabled = false,
    className,
}: LeadAttributeFieldsProps) {
    const terminology = useLeadTerminology();
    const rows: {
        key: LeadAttributeKey;
        label: string;
        value: string;
        options: { label: string; value: string }[];
        onChange: (v: string) => void;
        required?: boolean;
    }[] = [];
    if (fields.showStatus && (!only || only.includes('status'))) {
        rows.push({
            key: 'status',
            label: terminology.leadStatus,
            value: fields.statusId,
            options: fields.statusOptions,
            onChange: fields.setStatusId,
        });
    }
    if (fields.showTier && (!only || only.includes('tier'))) {
        rows.push({
            key: 'tier',
            label: terminology.tier,
            value: fields.tierKey,
            options: fields.tierOptions,
            onChange: fields.setTierKey,
            required: followUp && fields.tierRequired,
        });
    }
    if (rows.length === 0) return null;
    const notice = rows.some((r) => r.key === 'status') ? fields.admissionNotice : null;

    return (
        <div className={cn('grid gap-3 sm:grid-cols-2', className)}>
            {rows.map(({ key, label, value, options, onChange, required }) => (
                <div key={key} className="min-w-0 space-y-1.5">
                    <Label className="text-sm font-medium">
                        {label}
                        {required && <span className="text-danger-500"> *</span>}
                    </Label>
                    <SearchableSelect
                        options={options}
                        value={value}
                        // Picking the chosen option again goes back to "Keep current".
                        onChange={(v) => onChange(v === value ? '' : v)}
                        placeholder={required ? `Select ${label}` : 'Keep current'}
                        searchPlaceholder="Search…"
                        portal={portal}
                        disabled={disabled}
                        triggerClassName="h-9"
                    />
                </div>
            ))}
            {notice && (
                <p
                    role={notice.tone === 'block' ? 'alert' : 'status'}
                    className={cn(
                        'rounded-md border p-2 text-caption sm:col-span-2',
                        notice.tone === 'block'
                            ? 'border-danger-200 bg-danger-50 text-danger-700'
                            : 'border-warning-200 bg-warning-50 text-warning-700'
                    )}
                >
                    {notice.text}
                </p>
            )}
        </div>
    );
}
