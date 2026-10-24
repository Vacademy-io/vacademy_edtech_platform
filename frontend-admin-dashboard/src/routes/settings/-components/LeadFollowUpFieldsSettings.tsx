/**
 * LeadFollowUpFieldsSettings — the "Follow-up fields" card on Settings → Lead
 * settings → Configuration.
 *
 * Turns on extra dropdowns wherever a counsellor logs a follow-up: Interest
 * level, Student response, Follow-up mode and Next follow-up action. Each one is the
 * institute's own list of answers, so the wording matches whatever script its
 * counsellors actually run. A list left empty hides that one dropdown — an
 * institute can enable just the field it cares about.
 *
 * Persisted at LEAD_SETTING.data.followUpFields. The save path
 * READ-MODIFY-WRITES the whole LEAD_SETTING data object — fetch current, merge
 * only this subtree, save — so sibling keys (enabled, scoringWeights, dedup,
 * reports, …) are never clobbered. Same contract as LeadDedupSettings.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ChatText, X } from '@phosphor-icons/react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { MyButton } from '@/components/design-system/button';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { GET_INSITITUTE_SETTINGS } from '@/constants/urls';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { fetchLeadSettingRawData } from '@/hooks/use-lead-report-settings';
import {
    LEAD_SETTINGS_DEFAULTS,
    normaliseFollowUpFields,
    type FollowUpFieldsConfig,
} from '@/hooks/use-lead-settings';

const SETTING_KEY = 'LEAD_SETTING';
const SAVE_URL = GET_INSITITUTE_SETTINGS.replace('/get', '/save-setting');
const QUERY_KEY = ['lead-followup-fields-settings'];

/** Max options per list — past this the dropdown stops being faster than typing. */
const MAX_OPTIONS = 60;

type ListKey = 'interestLevels' | 'studentResponses' | 'followUpModes' | 'nextActions';

const LISTS: { key: ListKey; title: string; hint: string }[] = [
    {
        key: 'interestLevels',
        title: 'Interest level',
        hint: 'How interested the lead sounded on this follow-up, e.g. Very Hot to Very Cold.',
    },
    {
        key: 'studentResponses',
        title: 'Student response',
        hint: 'What the student said on this follow-up.',
    },
    {
        key: 'followUpModes',
        title: 'Follow-up mode',
        hint: 'How the follow-up happened.',
    },
    {
        key: 'nextActions',
        title: 'Next follow-up action',
        hint: 'What the counsellor does next.',
    },
];

type BehaviourKey = 'keepPopupsOpen' | 'showHistory' | 'allowEditing' | 'reportExports';

const BEHAVIOUR_SWITCHES: { key: BehaviourKey; label: string; hint: string }[] = [
    {
        key: 'keepPopupsOpen',
        label: 'Close follow-up pop-ups only with ✕',
        hint: 'Follow-up pop-ups stay open on a click outside or Escape, so typed text is not lost by accident. They close with ✕ or Cancel.',
    },
    {
        key: 'showHistory',
        label: 'Show follow-up history',
        hint: 'A Follow-up history section in the Lead Profile (created date, next follow-up, comment, interest level), plus created dates in reminders, the Completed tab and Check Lead.',
    },
    {
        key: 'allowEditing',
        label: 'Allow editing past follow-ups',
        hint: 'Counsellors can correct a follow-up’s comment, closing note and interest level, including completed ones. The earlier text stays in the activity log.',
    },
    {
        key: 'reportExports',
        label: 'Per-lead report exports',
        hint: 'Reports gets per-lead CSV exports: TAT (response time and met / breached per enquiry), SLA (where each lead sits on the SLA clock) and Overdue follow-ups.',
    },
];

async function fetchFollowUpFields(): Promise<FollowUpFieldsConfig> {
    try {
        const raw = await fetchLeadSettingRawData();
        // Same coercion the readers use — this editor is exactly where a
        // hand-written setting_json gets opened, so it must not choke on one.
        return normaliseFollowUpFields(
            raw['followUpFields'] as Partial<FollowUpFieldsConfig> | undefined
        );
    } catch {
        return LEAD_SETTINGS_DEFAULTS.followUpFields;
    }
}

async function saveFollowUpFields(next: FollowUpFieldsConfig): Promise<void> {
    const instituteId = getCurrentInstituteId();
    // Read-modify-write: pull the CURRENT full data object right before saving so a
    // concurrent edit to a sibling subtree isn't lost.
    const current = await fetchLeadSettingRawData();
    const merged = { ...current, followUpFields: next };
    await authenticatedAxiosInstance.post(
        SAVE_URL,
        { setting_name: 'Lead Settings', setting_data: merged },
        { params: { instituteId, settingKey: SETTING_KEY } }
    );
}

/** Trim, drop blanks, drop case-insensitive duplicates, keep the given order. */
function normalise(values: string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of values) {
        const value = raw.trim();
        if (!value) continue;
        const key = value.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(value);
    }
    return out.slice(0, MAX_OPTIONS);
}

/**
 * One editable option list: chips to remove, a box to add, and a paste area —
 * 25 options one at a time is a chore, so a pasted block (one per line, or
 * comma-separated) is accepted too.
 */
function OptionListEditor({
    title,
    hint,
    options,
    onChange,
}: {
    title: string;
    hint: string;
    options: string[];
    onChange: (next: string[]) => void;
}) {
    const [draft, setDraft] = useState('');
    const [pasting, setPasting] = useState(false);
    const [pasteText, setPasteText] = useState('');

    const add = () => {
        const next = normalise([...options, draft]);
        if (next.length === options.length) {
            if (draft.trim()) toast.error(`"${draft.trim()}" is already in ${title}`);
            return;
        }
        onChange(next);
        setDraft('');
    };

    const applyPaste = () => {
        const parsed = pasteText.split(/[\n,]/);
        const next = normalise([...options, ...parsed]);
        const added = next.length - options.length;
        onChange(next);
        setPasteText('');
        setPasting(false);
        if (next.length >= MAX_OPTIONS) {
            // normalise() caps the list; say so rather than letting the tail vanish.
            toast.warning(`${title} is capped at ${MAX_OPTIONS} options — the rest were dropped`);
        } else {
            toast.success(
                added > 0 ? `Added ${added} option${added === 1 ? '' : 's'}` : 'Nothing new to add'
            );
        }
    };

    return (
        <div className="space-y-2">
            <div className="flex items-baseline justify-between gap-3">
                <div>
                    <p className="text-sm font-medium">{title}</p>
                    <p className="text-xs text-muted-foreground">{hint}</p>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">
                    {options.length === 0 ? 'Hidden — no options' : `${options.length} options`}
                </span>
            </div>

            {options.length > 0 && (
                <div className="flex flex-wrap gap-2">
                    {options.map((option) => (
                        <span
                            key={option}
                            className="inline-flex items-center gap-1 rounded-full bg-primary-100 px-2.5 py-1 text-xs font-medium text-primary-600"
                        >
                            {option}
                            <button
                                type="button"
                                aria-label={`Remove ${option}`}
                                onClick={() => onChange(options.filter((o) => o !== option))}
                                className="rounded-full p-0.5 hover:bg-primary-200"
                            >
                                <X size={12} />
                            </button>
                        </span>
                    ))}
                </div>
            )}

            <div className="flex max-w-md items-center gap-2">
                <Input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            add();
                        }
                    }}
                    placeholder={`Add an option to ${title.toLowerCase()}`}
                    maxLength={120}
                />
                <MyButton
                    buttonType="secondary"
                    scale="medium"
                    onClick={add}
                    disable={!draft.trim() || options.length >= MAX_OPTIONS}
                >
                    Add
                </MyButton>
            </div>

            {pasting ? (
                <div className="max-w-md space-y-2">
                    <Textarea
                        value={pasteText}
                        onChange={(e) => setPasteText(e.target.value)}
                        rows={5}
                        placeholder={'One option per line, or comma-separated'}
                    />
                    <div className="flex gap-2">
                        <MyButton
                            buttonType="primary"
                            scale="medium"
                            onClick={applyPaste}
                            disable={!pasteText.trim()}
                        >
                            Add these
                        </MyButton>
                        <MyButton
                            buttonType="secondary"
                            scale="medium"
                            onClick={() => {
                                setPasteText('');
                                setPasting(false);
                            }}
                        >
                            Cancel
                        </MyButton>
                    </div>
                </div>
            ) : (
                <button
                    type="button"
                    onClick={() => setPasting(true)}
                    className="text-xs text-primary-500 hover:underline"
                >
                    Paste a list
                </button>
            )}
        </div>
    );
}

export default function LeadFollowUpFieldsSettings() {
    const queryClient = useQueryClient();
    const { data, isLoading } = useQuery({
        queryKey: QUERY_KEY,
        queryFn: fetchFollowUpFields,
        staleTime: 5 * 60 * 1000,
    });

    const [draft, setDraft] = useState<FollowUpFieldsConfig>(LEAD_SETTINGS_DEFAULTS.followUpFields);
    const [hasChanges, setHasChanges] = useState(false);

    useEffect(() => {
        if (data) {
            setDraft(data);
            setHasChanges(false);
        }
    }, [data]);

    const { mutate: save, isPending: saving } = useMutation({
        mutationFn: saveFollowUpFields,
        onSuccess: () => {
            toast.success('Follow-up fields saved');
            setHasChanges(false);
            queryClient.invalidateQueries({ queryKey: QUERY_KEY });
            // The follow-up forms read these through useLeadSettings.
            queryClient.invalidateQueries({ queryKey: ['lead-settings-config'] });
            queryClient.invalidateQueries({ queryKey: ['lead-settings'] });
        },
        onError: () => toast.error('Could not save follow-up fields'),
    });

    const update = (patch: Partial<FollowUpFieldsConfig>) => {
        setDraft((prev) => ({ ...prev, ...patch }));
        setHasChanges(true);
    };

    const noOptions =
        draft.interestLevels.length === 0 &&
        draft.studentResponses.length === 0 &&
        draft.followUpModes.length === 0 &&
        draft.nextActions.length === 0;

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <ChatText size={18} className="text-primary-500" />
                    Follow-up fields
                </CardTitle>
                <CardDescription>
                    What a counsellor has to fill in wherever a follow-up is logged — the lead
                    profile, the add-activity dialog, the post-call sheet and &ldquo;Schedule
                    next&rdquo;. Everything here is off unless you turn it on.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
                {isLoading ? (
                    <p className="text-sm text-muted-foreground">Loading…</p>
                ) : (
                    <>
                        {/* Independent of the dropdowns below: an institute can insist on a
                            written note without adopting any of them. */}
                        <div className="space-y-1.5">
                            <div className="flex items-center gap-3">
                                <Switch
                                    id="followup-notes-required"
                                    checked={draft.notesRequired}
                                    onCheckedChange={(v) => update({ notesRequired: v })}
                                />
                                <Label htmlFor="followup-notes-required" className="cursor-pointer">
                                    Require a note on every follow-up
                                </Label>
                            </div>
                            <p className="text-xs text-muted-foreground">
                                A follow-up cannot be saved with an empty note. Off by default — the
                                note has always been optional.
                            </p>
                        </div>

                        <Separator />

                        {/* Behaviour switches — each off by default, and off keeps a
                            follow-up working exactly as it always has. */}
                        {BEHAVIOUR_SWITCHES.map(({ key, label, hint }) => (
                            <div key={key} className="space-y-1.5">
                                <div className="flex items-center gap-3">
                                    <Switch
                                        id={`followup-${key}`}
                                        checked={draft[key]}
                                        onCheckedChange={(v) => update({ [key]: v })}
                                    />
                                    <Label htmlFor={`followup-${key}`} className="cursor-pointer">
                                        {label}
                                    </Label>
                                </div>
                                <p className="text-xs text-muted-foreground">{hint}</p>
                            </div>
                        ))}

                        <Separator />

                        <div className="space-y-1.5">
                            <div className="flex items-center gap-3">
                                <Switch
                                    id="followup-fields-enabled"
                                    checked={draft.enabled}
                                    onCheckedChange={(v) => update({ enabled: v })}
                                />
                                <Label htmlFor="followup-fields-enabled" className="cursor-pointer">
                                    Extra dropdowns
                                </Label>
                            </div>
                            <p className="text-xs text-muted-foreground">
                                Interest level, student response, follow-up mode and next action,
                                each from a list you write below.
                            </p>
                        </div>

                        {draft.enabled && (
                            <div className="space-y-1.5 pl-12">
                                <div className="flex items-center gap-3">
                                    <Switch
                                        id="followup-fields-required"
                                        checked={draft.fieldsRequired}
                                        onCheckedChange={(v) => update({ fieldsRequired: v })}
                                    />
                                    <Label
                                        htmlFor="followup-fields-required"
                                        className="cursor-pointer"
                                    >
                                        Make them mandatory
                                    </Label>
                                </div>
                                <p className="text-xs text-muted-foreground">
                                    Each dropdown gets a red * and a follow-up can&rsquo;t be saved
                                    until they&rsquo;re answered. Only the dropdowns you actually
                                    configured are required.
                                </p>
                            </div>
                        )}

                        {draft.enabled && (
                            <>
                                {noOptions && (
                                    <p className="rounded-md bg-warning-50 px-3 py-2 text-xs text-warning-700">
                                        No options configured yet — nothing will show on the
                                        follow-up forms until you add some below.
                                    </p>
                                )}
                                {LISTS.map(({ key, title, hint }, index) => (
                                    <div key={key} className="space-y-5">
                                        {index > 0 && <Separator />}
                                        <OptionListEditor
                                            title={title}
                                            hint={hint}
                                            options={draft[key]}
                                            onChange={(next) => update({ [key]: next })}
                                        />
                                    </div>
                                ))}
                            </>
                        )}

                        <div className="flex justify-end">
                            <MyButton
                                buttonType="primary"
                                scale="medium"
                                onClick={() => save(draft)}
                                disable={saving || !hasChanges}
                            >
                                {saving ? 'Saving…' : 'Save'}
                            </MyButton>
                        </div>
                    </>
                )}
            </CardContent>
        </Card>
    );
}
