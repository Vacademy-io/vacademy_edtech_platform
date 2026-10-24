/**
 * The optional dropdowns a counsellor fills when logging a follow-up: how
 * interested the lead sounded, what the student said, how the follow-up
 * happened, and what happens next.
 *
 * Off for every institute until one turns it on in Settings → Lead settings →
 * Follow-up fields and supplies its own option lists, so nothing changes for
 * anyone who hasn't asked for it. The values are free text end to end (the
 * column is VARCHAR, not an enum) because renaming an option has to stay a
 * settings change, not a migration.
 *
 * Rendered by all four places a follow-up can be created:
 *   - add-lead-note-dialog (Follow Up tab)
 *   - complete-followup-popover ("Schedule next")
 *   - post-call-disposition-sheet
 *   - student-lead-profile
 */
import { useState } from 'react';
import { Label } from '@/components/ui/label';
import { SearchableSelect } from '@/components/design-system/searchable-select';
import { useLeadSettings } from '@/hooks/use-lead-settings';
import { cn } from '@/lib/utils';

/** What the counsellor recorded. Empty strings mean "not answered" — all are optional. */
export interface FollowUpFieldValues {
    interestLevel: string;
    studentResponse: string;
    followUpMode: string;
    nextAction: string;
}

export const EMPTY_FOLLOW_UP_FIELDS: FollowUpFieldValues = {
    interestLevel: '',
    studentResponse: '',
    followUpMode: '',
    nextAction: '',
};

/** snake_case payload keys for CREATE_LEAD_FOLLOWUP. Omits anything left blank. */
export function followUpFieldsPayload(values: FollowUpFieldValues): Record<string, string> {
    const payload: Record<string, string> = {};
    if (values.interestLevel) payload.interest_level = values.interestLevel;
    if (values.studentResponse) payload.student_response = values.studentResponse;
    if (values.followUpMode) payload.follow_up_mode = values.followUpMode;
    if (values.nextAction) payload.next_action = values.nextAction;
    return payload;
}

/**
 * Local state for the fields plus the institute's option lists.
 *
 * `visible` is false when the institute has the block switched off, so a call
 * site can skip rendering without reaching into settings itself.
 */
export function useFollowUpFields() {
    const { followUpFields } = useLeadSettings();
    const [values, setValues] = useState<FollowUpFieldValues>(EMPTY_FOLLOW_UP_FIELDS);
    const reset = () => setValues(EMPTY_FOLLOW_UP_FIELDS);
    const hasAnyList =
        followUpFields.interestLevels.length > 0 ||
        followUpFields.studentResponses.length > 0 ||
        followUpFields.followUpModes.length > 0 ||
        followUpFields.nextActions.length > 0;
    const visible = followUpFields.enabled && hasAnyList;
    // Only a dropdown that is actually rendered can be required — an institute
    // that configured two lists must not be blocked on a third it never shows.
    const missingRequired =
        visible &&
        followUpFields.fieldsRequired &&
        ((followUpFields.interestLevels.length > 0 && !values.interestLevel) ||
            (followUpFields.studentResponses.length > 0 && !values.studentResponse) ||
            (followUpFields.followUpModes.length > 0 && !values.followUpMode) ||
            (followUpFields.nextActions.length > 0 && !values.nextAction));
    return {
        values,
        setValues,
        reset,
        visible,
        /** True while a required dropdown is still unanswered — gate submit on this. */
        missingRequired,
        /** Spread into the CREATE_LEAD_FOLLOWUP body. Empty when the block is off. */
        payload: followUpFields.enabled ? followUpFieldsPayload(values) : {},
        /**
         * Is the student-response dropdown worth showing outside a follow-up?
         * Notes are timeline events, so only this one field travels with them.
         */
        studentResponseVisible:
            followUpFields.enabled && followUpFields.studentResponses.length > 0,
        /**
         * Merge into a timeline event's `metadata`. The column is free-form jsonb,
         * so the student's response rides along with a note without a schema change.
         */
        noteMetadata: () =>
            followUpFields.enabled && values.studentResponse
                ? { student_response: values.studentResponse }
                : undefined,
    };
}

/**
 * Whether this institute refuses a follow-up with an empty note.
 *
 * Deliberately separate from {@link useFollowUpFields}: the note box already
 * exists on every follow-up form and is nothing to do with the three dropdowns,
 * so a call site can require a note without rendering any of them.
 */
export function useFollowUpNotesRequired(): boolean {
    const { followUpFields } = useLeadSettings();
    return followUpFields.notesRequired;
}

/**
 * The institute's follow-up behaviour switches (Settings → Lead settings →
 * Follow-up fields). All off by default, and off means the old behaviour.
 */
export function useFollowUpFeatures(): {
    keepPopupsOpen: boolean;
    showHistory: boolean;
    allowEditing: boolean;
    reportExports: boolean;
} {
    const { followUpFields } = useLeadSettings();
    return {
        keepPopupsOpen: followUpFields.keepPopupsOpen,
        showHistory: followUpFields.showHistory,
        allowEditing: followUpFields.allowEditing,
        reportExports: followUpFields.reportExports,
    };
}

interface FollowUpFieldsProps {
    values: FollowUpFieldValues;
    onChange: (next: FollowUpFieldValues) => void;
    /**
     * Render only these, in this order. Used by the Note tab, which asks for the
     * student's response alone — mode and next action describe a follow-up, and
     * a note isn't one.
     */
    only?: (keyof FollowUpFieldValues)[];
    /**
     * Override the institute's mandatory setting. The Note tab passes false: that
     * setting is about not letting a follow-up through without its answers, and
     * applying it to notes would block every quick jotting.
     */
    required?: boolean;
    /** Pass false inside a Dialog/Sheet — a portalled list can't be scrolled there. */
    portal?: boolean;
    className?: string;
    disabled?: boolean;
}

/**
 * Renders only the dropdowns the institute has options for: an institute that
 * cares about Student response but not Mode configures just the one list and
 * sees just the one control.
 */
export function FollowUpFields({
    values,
    onChange,
    only,
    required: requiredOverride,
    portal = true,
    className,
    disabled = false,
}: FollowUpFieldsProps) {
    const { followUpFields } = useLeadSettings();
    const required = requiredOverride ?? followUpFields.fieldsRequired;
    if (!followUpFields.enabled) return null;

    const fields: { key: keyof FollowUpFieldValues; label: string; options: string[] }[] = [
        {
            key: 'interestLevel',
            label: 'Interest level',
            options: followUpFields.interestLevels,
        },
        {
            key: 'studentResponse',
            label: 'Student response',
            options: followUpFields.studentResponses,
        },
        { key: 'followUpMode', label: 'Follow-up mode', options: followUpFields.followUpModes },
        { key: 'nextAction', label: 'Next follow-up action', options: followUpFields.nextActions },
    ];
    const shown = fields
        .filter((f) => f.options.length > 0)
        .filter((f) => !only || only.includes(f.key));
    if (shown.length === 0) return null;

    return (
        <div className={cn('space-y-3', className)}>
            {shown.map(({ key, label, options }) => (
                <div key={key} className="space-y-1.5">
                    {/* No htmlFor: SearchableSelect's trigger is a combobox button,
                        not a form control with an id to point at. */}
                    <Label className="text-sm font-medium">
                        {label}
                        {required && <span className="ml-0.5 text-danger-500">*</span>}
                    </Label>
                    <SearchableSelect
                        options={options.map((o) => ({ label: o, value: o }))}
                        value={values[key]}
                        // These are optional, and SearchableSelect has no clear row —
                        // picking the chosen option again unsets it.
                        onChange={(v) => onChange({ ...values, [key]: v === values[key] ? '' : v })}
                        placeholder={`Select ${label.toLowerCase()}`}
                        searchPlaceholder="Search…"
                        portal={portal}
                        disabled={disabled}
                        triggerClassName="h-9"
                    />
                </div>
            ))}
        </div>
    );
}
