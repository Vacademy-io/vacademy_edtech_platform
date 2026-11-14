/**
 * LeadLookupSettings — the "Check Lead" card on Settings → Lead settings →
 * Configuration.
 *
 * A counsellor only sees their own leads, so searching a number a colleague
 * already owns finds nothing and they call it as a fresh lead. Check Lead
 * answers for one exact phone or email instead of widening the lead list.
 *
 * Off for every institute, and still blank once switched on until someone ticks
 * the fields they are willing to share. Admins are never masked by this — they
 * are not scoped out of lead data anywhere else, so the backend gives them every
 * field regardless of what is ticked here.
 *
 * Persisted at LEAD_SETTING.data.leadLookup, read-modify-writing the whole
 * LEAD_SETTING data object — the same contract LeadDedupSettings uses — so
 * sibling subtrees are never clobbered.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { MagnifyingGlass } from '@phosphor-icons/react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { MyButton } from '@/components/design-system/button';
import { SearchableSelect } from '@/components/design-system/searchable-select';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { GET_INSITITUTE_SETTINGS } from '@/constants/urls';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { fetchLeadSettingRawData } from '@/hooks/use-lead-report-settings';
import {
    LEAD_SETTINGS_DEFAULTS,
    normaliseLeadLookup,
    type LeadLookupConfig,
    type LeadLookupFields,
} from '@/hooks/use-lead-settings';
import { getCustomFieldSettings } from '@/services/custom-field-settings';

const SETTING_KEY = 'LEAD_SETTING';
const SAVE_URL = GET_INSITITUTE_SETTINGS.replace('/get', '/save-setting');
const QUERY_KEY = ['lead-lookup-settings'];

const FIELD_ROWS: { key: keyof LeadLookupFields; label: string; hint?: string }[] = [
    { key: 'name', label: "The lead's name" },
    {
        key: 'phone',
        label: 'Phone number',
        hint: 'Hands over a number the searcher may not have had — only useful if they searched by email.',
    },
    {
        key: 'email',
        label: 'Email address',
        hint: 'Same the other way round: reveals an email to someone who searched by number.',
    },
    { key: 'counsellor', label: 'Which counsellor it is assigned to' },
    { key: 'source', label: 'Source' },
    { key: 'campaign', label: 'Campaign' },
    { key: 'status', label: 'Current status' },
    { key: 'course', label: 'Course' },
    { key: 'branch', label: 'Branch' },
    {
        key: 'enquiredBy',
        label: 'Enquired by',
        hint: 'The staff member who added the lead by hand. Form and ad leads have none.',
    },
];

async function fetchLeadLookup(): Promise<LeadLookupConfig> {
    try {
        const raw = await fetchLeadSettingRawData();
        return normaliseLeadLookup(raw['leadLookup'] as Partial<LeadLookupConfig> | undefined);
    } catch {
        return LEAD_SETTINGS_DEFAULTS.leadLookup;
    }
}

async function saveLeadLookup(next: LeadLookupConfig): Promise<void> {
    const instituteId = getCurrentInstituteId();
    // Read-modify-write: pull the CURRENT full data object right before saving so a
    // concurrent edit to a sibling subtree isn't lost.
    const current = await fetchLeadSettingRawData();
    const merged = { ...current, leadLookup: next };
    await authenticatedAxiosInstance.post(
        SAVE_URL,
        { setting_name: 'Lead Settings', setting_data: merged },
        { params: { instituteId, settingKey: SETTING_KEY } }
    );
}

export default function LeadLookupSettings() {
    const queryClient = useQueryClient();
    const { data, isLoading } = useQuery({
        queryKey: QUERY_KEY,
        queryFn: fetchLeadLookup,
        staleTime: 5 * 60 * 1000,
    });
    const [draft, setDraft] = useState<LeadLookupConfig>(LEAD_SETTINGS_DEFAULTS.leadLookup);
    const [hasChanges, setHasChanges] = useState(false);

    // Only fetched once the course or branch toggle is on — most institutes never
    // open this. CustomField.id is the API's customFieldId, which the backend matches on.
    const { data: customFieldOptions = [] } = useQuery({
        queryKey: ['lead-lookup-course-field-options'],
        queryFn: async () => {
            const settings = await getCustomFieldSettings();
            return [...settings.instituteFields, ...settings.customFields]
                .filter((f, i, all) => all.findIndex((o) => o.id === f.id) === i)
                .map((f) => ({ label: f.name, value: f.id }));
        },
        staleTime: 5 * 60 * 1000,
        enabled: draft.fields.course || draft.fields.branch,
    });

    useEffect(() => {
        if (data) {
            setDraft(data);
            setHasChanges(false);
        }
    }, [data]);

    const { mutate: save, isPending: saving } = useMutation({
        mutationFn: saveLeadLookup,
        onSuccess: () => {
            toast.success('Check Lead settings saved');
            setHasChanges(false);
            queryClient.invalidateQueries({ queryKey: QUERY_KEY });
            // The page and the sidebar entry both read this through useLeadSettings.
            queryClient.invalidateQueries({ queryKey: ['lead-settings-config'] });
            queryClient.invalidateQueries({ queryKey: ['lead-settings'] });
        },
        onError: () => toast.error('Could not save Check Lead settings'),
    });

    const update = (patch: Partial<LeadLookupConfig>) => {
        setDraft((prev) => ({ ...prev, ...patch }));
        setHasChanges(true);
    };

    const toggleField = (key: keyof LeadLookupFields, value: boolean) =>
        update({ fields: { ...draft.fields, [key]: value } });

    const nothingShared = Object.values(draft.fields).every((v) => !v);

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <MagnifyingGlass size={18} className="text-primary-500" />
                    Check Lead
                </CardTitle>
                <CardDescription>
                    Lets a counsellor check a phone number or email against the whole institute
                    before calling, so they don&rsquo;t work a lead a colleague already owns. It
                    answers for one exact match only — the lead list stays scoped as it is, and
                    searching by name is never possible. Admins always see every field.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
                {isLoading ? (
                    <p className="text-sm text-muted-foreground">Loading…</p>
                ) : (
                    <>
                        <div className="flex items-center gap-3">
                            <Switch
                                id="lead-lookup-enabled"
                                checked={draft.enabled}
                                onCheckedChange={(v) => update({ enabled: v })}
                            />
                            <Label htmlFor="lead-lookup-enabled" className="cursor-pointer">
                                {draft.enabled ? 'Enabled' : 'Disabled'}
                            </Label>
                        </div>

                        {draft.enabled && (
                            <>
                                <Separator />
                                <div className="space-y-1">
                                    <p className="text-sm font-medium">What they can search by</p>
                                    <p className="text-xs text-muted-foreground">
                                        Phone number and email are always available. A counsellor
                                        about to dial someone already has those in front of them.
                                    </p>
                                </div>
                                <div className="space-y-1">
                                    <div className="flex items-center gap-3">
                                        <Switch
                                            id="lead-lookup-search-by-name"
                                            checked={draft.searchByName}
                                            onCheckedChange={(v) => update({ searchByName: v })}
                                        />
                                        <Label
                                            htmlFor="lead-lookup-search-by-name"
                                            className="cursor-pointer"
                                        >
                                            Also allow searching by full name
                                        </Label>
                                    </div>
                                    <p className="pl-12 text-xs text-muted-foreground">
                                        A name is something a counsellor can guess, so this is the
                                        one search that could be used to probe colleagues&rsquo;
                                        leads. The whole name has to match exactly — a first name on
                                        its own finds nobody — so it cannot be walked one letter at
                                        a time.
                                    </p>
                                </div>

                                <Separator />
                                <div className="space-y-1">
                                    <p className="text-sm font-medium">
                                        What a counsellor sees about someone else&rsquo;s lead
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                        Everything is hidden until you tick it. Anything left
                                        unticked is not sent to the browser at all. Follow-up
                                        history is never shown here — only admins and the
                                        lead&rsquo;s own counsellor see it.
                                    </p>
                                </div>

                                {nothingShared && (
                                    <p className="rounded-md bg-warning-50 px-3 py-2 text-xs text-warning-700">
                                        Nothing ticked — a counsellor would get an empty card.
                                    </p>
                                )}

                                <div className="space-y-3">
                                    {FIELD_ROWS.map(({ key, label, hint }) => (
                                        <div key={key} className="space-y-1">
                                            <div className="flex items-center gap-3">
                                                <Switch
                                                    id={`lead-lookup-${key}`}
                                                    checked={draft.fields[key]}
                                                    onCheckedChange={(v) => toggleField(key, v)}
                                                />
                                                <Label
                                                    htmlFor={`lead-lookup-${key}`}
                                                    className="cursor-pointer"
                                                >
                                                    {label}
                                                </Label>
                                            </div>
                                            {hint && draft.fields[key] && (
                                                <p className="pl-12 text-xs text-muted-foreground">
                                                    {hint}
                                                </p>
                                            )}
                                        </div>
                                    ))}
                                </div>

                                {draft.fields.course && (
                                    <>
                                        <Separator />
                                        <div className="max-w-md space-y-1.5">
                                            <Label>Which field holds the course</Label>
                                            <p className="text-xs text-muted-foreground">
                                                The course is a form answer, not a batch — pick the
                                                custom field your enquiry form collects it in.
                                                Without this the course line is simply not shown.
                                            </p>
                                            <SearchableSelect
                                                options={customFieldOptions}
                                                value={draft.courseFieldId}
                                                onChange={(v) => update({ courseFieldId: v })}
                                                placeholder="Select a custom field"
                                                searchPlaceholder="Search fields…"
                                            />
                                        </div>
                                    </>
                                )}

                                {draft.fields.branch && (
                                    <>
                                        <Separator />
                                        <div className="max-w-md space-y-1.5">
                                            <Label>Which field holds the branch</Label>
                                            <p className="text-xs text-muted-foreground">
                                                Pick the custom field your enquiry form collects the
                                                branch in. Without this the branch line is simply
                                                not shown.
                                            </p>
                                            <SearchableSelect
                                                options={customFieldOptions}
                                                value={draft.branchFieldId}
                                                onChange={(v) => update({ branchFieldId: v })}
                                                placeholder="Select a custom field"
                                                searchPlaceholder="Search fields…"
                                            />
                                        </div>
                                    </>
                                )}
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
