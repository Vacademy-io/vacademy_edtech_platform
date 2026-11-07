import { GraduationCap } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

/**
 * LeadConversionBadge — a compact "Converted" pill shown against a lead that has
 * been enrolled into a course (user_lead_profile.conversion_status === 'CONVERTED').
 *
 * Enrolling a lead auto-marks it CONVERTED on the backend; the lead list defaults
 * to keeping those rows visible (rather than dropping them out of the pipeline),
 * so this badge lets a counsellor tell at a glance which leads are already
 * enrolled. Matches the emerald "Converted" accent used by LeadStageChip on the
 * board card, so the two surfaces read consistently. Renders nothing for
 * non-converted leads.
 */
export function LeadConversionBadge({
    conversionStatus,
    className,
}: {
    conversionStatus?: string | null;
    className?: string;
}) {
    if ((conversionStatus ?? '').toUpperCase() !== 'CONVERTED') return null;
    return (
        <span
            className={cn(
                'inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700',
                className
            )}
            title={`Enrolled into a ${getTerminology(ContentTerms.Course, SystemTerms.Course).toLocaleLowerCase()}`}
        >
            <GraduationCap weight="fill" className="size-3" />
            Converted
        </span>
    );
}
