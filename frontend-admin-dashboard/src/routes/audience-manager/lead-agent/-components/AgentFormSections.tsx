/**
 * The sections of the Lead Agent form. The create dialog shows them one step at a
 * time; the Settings tab shows them stacked. All take the same react-hook-form.
 */
import { useMemo, useState } from 'react';
import { useFieldArray, type UseFormReturn } from 'react-hook-form';
import {
    CaretDown,
    CaretUp,
    CircleNotch,
    Plus,
    Sparkle,
    Trash,
    Warning,
} from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import SelectField from '@/components/design-system/select-field';
import {
    SearchableSelect,
    prefixFirstFilter,
    type SearchableSelectOption,
} from '@/components/design-system/searchable-select';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from '@/components/ui/form';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { COUNTRY_CODES, countryKeywords, countryName } from '@/constants/countries';
import { getActiveLocale } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { COMMON_TIMEZONES } from '@/routes/meetings/-utils/meetings-utils';
import { getBrowserTimezone } from '@/utils/timezone';
import type { SuggestResponse } from '../-types';
import { dedupe, formatCompetitor, type AgentFormValues } from '../-utils/agent-form';
import {
    COMPETITOR_KIND_OPTIONS,
    EXCLUDE_PRESETS,
    FIT_WEIGHT_OPTIONS,
    LIST_LIMITS,
    GATE_PRESETS,
    MAX_COMPETITORS,
    MAX_FIT_SIGNALS,
    MIN_CONTACT_OPTIONS,
    MODE_OPTIONS,
    SOURCE_OPTIONS,
    WEEKDAYS,
    presetFor,
} from '../-utils/lead-agent-options';
import { useSuggestBrief } from '../-hooks/use-lead-agent';
import { ChipListInput } from './ChipListInput';

type Form = UseFormReturn<AgentFormValues>;

const SectionHeading = ({ title, hint }: { title: string; hint?: string }) => (
    <div className="flex flex-col gap-1">
        <h3 className="text-subtitle font-semibold text-neutral-800">{title}</h3>
        {hint && <p className="text-caption text-neutral-500">{hint}</p>}
    </div>
);

/** The list-automation warning shown before an agent is saved or turned on. */
export const AutomationWarning = () => (
    <div
        role="note"
        className="flex gap-3 rounded-lg border border-warning-300 bg-warning-50 p-4 text-body text-neutral-700"
    >
        <Warning className="mt-0.5 size-5 shrink-0 text-warning-600" weight="fill" />
        <p>
            Leads delivered into this list immediately run the list’s automations (WhatsApp, AI
            calls, emails). These leads did not ask to hear from you: for WhatsApp use a separate
            number; check your workflows before turning the agent on.
        </p>
    </div>
);

// ─── Step 1: list + what you sell ──────────────────────────────────────────────────

export interface LeadListOption {
    id: string;
    name: string;
}

export function BasicsSection({
    form,
    leadLists,
    leadListsLoading,
}: {
    form: Form;
    leadLists: LeadListOption[];
    leadListsLoading: boolean;
}) {
    const suggest = useSuggestBrief();
    const [summary, setSummary] = useState<string | null>(null);
    const listOptions: SearchableSelectOption[] = leadLists.map((l) => ({
        label: l.name,
        value: l.id,
    }));

    const applySuggestion = (res: SuggestResponse) => {
        const v = form.getValues();
        const industries = [
            ...v.industries,
            ...res.industries
                .filter(
                    (i) => !v.industries.some((x) => x.name.toLowerCase() === i.name.toLowerCase())
                )
                .map((i) => ({ name: i.name, search_term: i.search_term || i.name })),
        ].slice(0, 6);
        const flat = (key: 'buyer_roles' | 'hiring_phrases' | 'need_phrases') =>
            res.industries.flatMap((i) => i[key] ?? []);
        const opts = { shouldDirty: true, shouldValidate: false } as const;
        form.setValue('industries', industries, opts);
        form.setValue(
            'buyer_roles',
            dedupe([...v.buyer_roles, ...flat('buyer_roles')]).slice(0, LIST_LIMITS.buyer_roles),
            opts
        );
        form.setValue(
            'hiring_roles',
            dedupe([...v.hiring_roles, ...flat('hiring_phrases')]).slice(
                0,
                LIST_LIMITS.hiring_roles
            ),
            opts
        );
        form.setValue(
            'keywords',
            dedupe([...v.keywords, ...res.keywords, ...flat('need_phrases')]).slice(
                0,
                LIST_LIMITS.keywords
            ),
            opts
        );
        // The offer fields are only filled where the admin has not written anything yet.
        const o = res.offer;
        if (o) {
            if (!v.offer_name.trim() && o.name) {
                form.setValue('offer_name', o.name.slice(0, 80), opts);
            }
            if (v.fit_signals.length === 0 && o.fit_signals.length > 0) {
                form.setValue(
                    'fit_signals',
                    o.fit_signals.slice(0, MAX_FIT_SIGNALS).map((f) => ({
                        key: '',
                        label: f.label.slice(0, 60),
                        description: f.description.slice(0, 200),
                        weight: String(f.weight) as '1' | '2' | '3',
                    })),
                    opts
                );
            }
            if (v.competitors.length === 0 && o.competitors.length > 0) {
                form.setValue(
                    'competitors',
                    dedupe(o.competitors.map(formatCompetitor)).slice(0, MAX_COMPETITORS),
                    opts
                );
            }
            if (v.competitor_kinds.length === 0 && o.competitor_kinds.length > 0) {
                form.setValue('competitor_kinds', o.competitor_kinds, opts);
            }
            // A checkbox is never "empty": only turn it on, and only if nobody touched it.
            if (o.education && !v.education && !form.getFieldState('education').isDirty) {
                form.setValue('education', true, opts);
            }
            if (!v.discovery_question.trim() && o.discovery_question) {
                form.setValue('discovery_question', o.discovery_question.slice(0, 200), opts);
            }
        }
        setSummary(
            res.summary ||
                `Suggested ${res.industries.length} industries. Check them in the next step.`
        );
    };

    const runSuggest = async () => {
        const v = form.getValues();
        const name = v.offer_name.trim();
        const description = v.description.trim();
        const url = v.website.trim();
        if (!name && !description && !url) {
            form.setError('offer_name', {
                type: 'manual',
                message: 'Say what you sell, describe it or add a website first',
            });
            return;
        }
        if (form.formState.errors.offer_name?.type === 'manual') form.clearErrors('offer_name');
        if (url && !(await form.trigger('website'))) return;
        const res = await suggest
            .mutateAsync({
                name: name || undefined,
                seller: v.offer_seller.trim() || undefined,
                description: description || undefined,
                url: url || undefined,
            })
            .catch(() => null);
        if (res) applySuggestion(res);
    };

    return (
        <div className="flex flex-col gap-4">
            <FormField
                control={form.control}
                name="audience_id"
                render={({ field }) => (
                    <FormItem>
                        <FormLabel>
                            Lead list <span className="text-danger-600">*</span>
                        </FormLabel>
                        <FormControl>
                            <SearchableSelect
                                options={listOptions}
                                value={field.value}
                                onChange={field.onChange}
                                placeholder={
                                    leadListsLoading ? 'Loading lists…' : 'Pick a lead list'
                                }
                                searchPlaceholder="Search lists"
                                emptyText="No lead list without an agent. Create a list first."
                                portal={false}
                                disabled={leadListsLoading}
                                className="w-full"
                            />
                        </FormControl>
                        <FormDescription>
                            Good leads go into this list. One agent per list.
                        </FormDescription>
                        <FormMessage />
                    </FormItem>
                )}
            />
            <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                    <FormItem>
                        <FormLabel>
                            Name <span className="text-danger-600">*</span>
                        </FormLabel>
                        <FormControl>
                            <MyInput
                                input={field.value}
                                onChangeFunction={field.onChange}
                                onBlur={field.onBlur}
                                inputPlaceholder="e.g. Factories in Gujarat"
                                className="sm:w-full"
                            />
                        </FormControl>
                        <FormMessage />
                    </FormItem>
                )}
            />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField
                    control={form.control}
                    name="offer_name"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>
                                What you sell <span className="text-danger-600">*</span>
                            </FormLabel>
                            <FormControl>
                                <MyInput
                                    input={field.value}
                                    onChangeFunction={field.onChange}
                                    onBlur={field.onBlur}
                                    inputPlaceholder="e.g. Rooftop solar installation"
                                    className="sm:w-full"
                                />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />
                <FormField
                    control={form.control}
                    name="offer_seller"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Your company (optional)</FormLabel>
                            <FormControl>
                                <MyInput
                                    input={field.value}
                                    onChangeFunction={field.onChange}
                                    onBlur={field.onBlur}
                                    inputPlaceholder="e.g. Sunrise Energy"
                                    className="sm:w-full"
                                />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />
            </div>
            <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                    <FormItem>
                        <FormLabel>
                            Product description <span className="text-danger-600">*</span>
                        </FormLabel>
                        <FormControl>
                            <Textarea
                                {...field}
                                rows={4}
                                placeholder="What you sell and to whom. e.g. Rooftop solar installation for factories and warehouses that want to cut power bills."
                            />
                        </FormControl>
                        <FormMessage />
                    </FormItem>
                )}
            />
            <FormField
                control={form.control}
                name="website"
                render={({ field }) => (
                    <FormItem>
                        <FormLabel>Website or product page (optional)</FormLabel>
                        <FormControl>
                            <MyInput
                                input={field.value}
                                onChangeFunction={field.onChange}
                                onBlur={field.onBlur}
                                inputType="url"
                                inputPlaceholder="https://…"
                                className="sm:w-full"
                            />
                        </FormControl>
                        <FormDescription>
                            The AI suggestion and the agent read it to learn what you sell.
                        </FormDescription>
                        <FormMessage />
                    </FormItem>
                )}
            />
            <div className="flex flex-col gap-2 rounded-lg border border-neutral-200 bg-neutral-50 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-body text-neutral-600">
                        Let AI suggest industries, buyer roles, keywords and what a good fit looks
                        like from what you sell, your description or your website.
                    </p>
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="medium"
                        disable={suggest.isPending}
                        onClick={() => void runSuggest()}
                        className="shrink-0"
                    >
                        {suggest.isPending ? (
                            <CircleNotch className="size-4 animate-spin" />
                        ) : (
                            <Sparkle className="size-4 text-primary-500" weight="fill" />
                        )}
                        {suggest.isPending ? 'Thinking…' : 'Suggest with AI'}
                    </MyButton>
                </div>
                {suggest.isPending && (
                    <p className="text-caption text-neutral-500" aria-live="polite">
                        Reading your product. This can take up to a minute.
                    </p>
                )}
                {!suggest.isPending && summary && (
                    <p className="text-caption text-success-700" aria-live="polite">
                        {summary}
                    </p>
                )}
            </div>
        </div>
    );
}

// ─── Step 2: who to find ─────────────────────────────────────────────────────

function IndustriesField({ form }: { form: Form }) {
    const { fields, append, remove } = useFieldArray({ control: form.control, name: 'industries' });
    const rootError =
        form.formState.errors.industries?.root?.message ??
        form.formState.errors.industries?.message;
    return (
        <div className="flex flex-col gap-2">
            <Label className="text-body font-semibold text-neutral-700">
                Industries <span className="text-danger-600">*</span>
            </Label>
            <p className="text-caption text-neutral-500">
                Kinds of organisations to look for, and the words to search for them with (1 to 6).
            </p>
            {fields.length === 0 && (
                <p className="rounded-md border border-dashed border-neutral-300 p-3 text-caption text-neutral-500">
                    No industries yet. Use “Suggest with AI” in step 1, or add one.
                </p>
            )}
            {fields.map((f, idx) => (
                <div
                    key={f.id}
                    className="flex flex-col gap-2 rounded-md border border-neutral-200 p-3 sm:flex-row sm:items-start"
                >
                    <FormField
                        control={form.control}
                        name={`industries.${idx}.name`}
                        render={({ field }) => (
                            <FormItem className="flex-1">
                                <FormLabel className="text-caption">Industry</FormLabel>
                                <FormControl>
                                    <MyInput
                                        input={field.value}
                                        onChangeFunction={field.onChange}
                                        onBlur={field.onBlur}
                                        inputPlaceholder="Manufacturing companies"
                                        className="sm:w-full"
                                    />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <FormField
                        control={form.control}
                        name={`industries.${idx}.search_term`}
                        render={({ field }) => (
                            <FormItem className="flex-1">
                                <FormLabel className="text-caption">Search term</FormLabel>
                                <FormControl>
                                    <MyInput
                                        input={field.value}
                                        onChangeFunction={field.onChange}
                                        onBlur={field.onBlur}
                                        inputPlaceholder="manufacturing company"
                                        className="sm:w-full"
                                    />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <MyButton
                        type="button"
                        buttonType="text"
                        layoutVariant="icon"
                        scale="medium"
                        onClick={() => remove(idx)}
                        aria-label="Remove industry"
                        className="self-end sm:mt-6 sm:self-start"
                    >
                        <Trash className="size-4 text-danger-600" />
                    </MyButton>
                </div>
            ))}
            {rootError && <p className="text-caption text-danger-600">{rootError}</p>}
            {fields.length < 6 && (
                <MyButton
                    type="button"
                    buttonType="text"
                    scale="medium"
                    onClick={() => append({ name: '', search_term: '' })}
                    className="self-start"
                >
                    <Plus className="size-4" /> Add industry
                </MyButton>
            )}
        </div>
    );
}

function MarketsField({ form }: { form: Form }) {
    const { fields, append, remove } = useFieldArray({ control: form.control, name: 'markets' });
    const countryOptions = useMemo<SearchableSelectOption[]>(() => {
        const locale = getActiveLocale();
        return COUNTRY_CODES.map((code) => ({
            // The engine searches with the English name, so that is the stored value.
            value: countryName(code, 'en'),
            label: countryName(code, locale),
            keywords: countryKeywords(code),
        })).sort((a, b) => a.label.localeCompare(b.label, locale));
    }, []);
    const rootError =
        form.formState.errors.markets?.root?.message ?? form.formState.errors.markets?.message;

    return (
        <div className="flex flex-col gap-2">
            <Label className="text-body font-semibold text-neutral-700">
                Markets <span className="text-danger-600">*</span>
            </Label>
            <p className="text-caption text-neutral-500">
                Where to look, 1 to 5 places. State and city are optional.
            </p>
            {fields.map((f, idx) => (
                <div
                    key={f.id}
                    className="grid grid-cols-1 gap-2 rounded-md border border-neutral-200 p-3 sm:grid-cols-4 sm:items-start"
                >
                    <FormField
                        control={form.control}
                        name={`markets.${idx}.country`}
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel className="text-caption">
                                    Country <span className="text-danger-600">*</span>
                                </FormLabel>
                                <FormControl>
                                    <SearchableSelect
                                        options={countryOptions}
                                        value={field.value}
                                        onChange={field.onChange}
                                        placeholder="Country"
                                        searchPlaceholder="Search countries"
                                        emptyText="No country found"
                                        filter={prefixFirstFilter}
                                        portal={false}
                                        className="w-full"
                                    />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <FormField
                        control={form.control}
                        name={`markets.${idx}.state`}
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel className="text-caption">State</FormLabel>
                                <FormControl>
                                    <MyInput
                                        input={field.value}
                                        onChangeFunction={field.onChange}
                                        onBlur={field.onBlur}
                                        inputPlaceholder="Any"
                                        className="sm:w-full"
                                    />
                                </FormControl>
                            </FormItem>
                        )}
                    />
                    <FormField
                        control={form.control}
                        name={`markets.${idx}.city`}
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel className="text-caption">City</FormLabel>
                                <FormControl>
                                    <MyInput
                                        input={field.value}
                                        onChangeFunction={field.onChange}
                                        onBlur={field.onBlur}
                                        inputPlaceholder="Any"
                                        className="sm:w-full"
                                    />
                                </FormControl>
                            </FormItem>
                        )}
                    />
                    <MyButton
                        type="button"
                        buttonType="text"
                        layoutVariant="icon"
                        scale="medium"
                        disable={fields.length <= 1}
                        onClick={() => remove(idx)}
                        aria-label="Remove market"
                        className="self-end sm:mt-6 sm:self-start"
                    >
                        <Trash className="size-4 text-danger-600" />
                    </MyButton>
                </div>
            ))}
            {rootError && <p className="text-caption text-danger-600">{rootError}</p>}
            {fields.length < 5 && (
                <MyButton
                    type="button"
                    buttonType="text"
                    scale="medium"
                    onClick={() => append({ country: '', state: '', city: '' })}
                    className="self-start"
                >
                    <Plus className="size-4" /> Add market
                </MyButton>
            )}
        </div>
    );
}

type ListField =
    | 'buyer_roles'
    | 'hiring_roles'
    | 'keywords'
    | 'must_have'
    | 'deal_breakers'
    | 'exclude';

function ChipField({
    form,
    name,
    label,
    hint,
    placeholder,
    presets,
}: {
    form: Form;
    name: ListField;
    label: string;
    hint: string;
    placeholder: string;
    presets?: string[];
}) {
    return (
        <FormField
            control={form.control}
            name={name}
            render={({ field }) => (
                <FormItem>
                    <FormLabel>{label}</FormLabel>
                    <FormDescription>{hint}</FormDescription>
                    <ChipListInput
                        value={field.value}
                        onChange={field.onChange}
                        placeholder={placeholder}
                        presets={presets}
                        ariaLabel={label}
                        max={LIST_LIMITS[name]}
                    />
                    <FormMessage />
                </FormItem>
            )}
        />
    );
}

function FitSignalsField({ form }: { form: Form }) {
    const { fields, append, remove } = useFieldArray({
        control: form.control,
        name: 'fit_signals',
    });
    const rootError =
        form.formState.errors.fit_signals?.root?.message ??
        form.formState.errors.fit_signals?.message;
    const weightOptions = FIT_WEIGHT_OPTIONS.map((w) => ({
        _id: w.value,
        value: String(w.value),
        label: w.label,
    }));
    return (
        <div className="flex flex-col gap-2">
            <Label className="text-body font-semibold text-neutral-700">Fit signals</Label>
            <p className="text-caption text-neutral-500">
                What on a prospect’s website shows they would buy, and how much it counts (up to{' '}
                {MAX_FIT_SIGNALS}).
            </p>
            {fields.length === 0 && (
                <p className="rounded-md border border-dashed border-neutral-300 p-3 text-caption text-neutral-500">
                    No fit signals yet. Use “Suggest with AI” in step 1, or add one.
                </p>
            )}
            {fields.map((f, idx) => (
                <div
                    key={f.id}
                    className="grid grid-cols-1 gap-2 rounded-md border border-neutral-200 p-3 sm:grid-cols-12 sm:items-start"
                >
                    <FormField
                        control={form.control}
                        name={`fit_signals.${idx}.label`}
                        render={({ field }) => (
                            <FormItem className="sm:col-span-4">
                                <FormLabel className="text-caption">Signal</FormLabel>
                                <FormControl>
                                    <MyInput
                                        input={field.value}
                                        onChangeFunction={field.onChange}
                                        onBlur={field.onBlur}
                                        inputPlaceholder="Large flat roof"
                                        className="sm:w-full"
                                    />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <FormField
                        control={form.control}
                        name={`fit_signals.${idx}.description`}
                        render={({ field }) => (
                            <FormItem className="sm:col-span-5">
                                <FormLabel className="text-caption">What to look for</FormLabel>
                                <FormControl>
                                    <MyInput
                                        input={field.value}
                                        onChangeFunction={field.onChange}
                                        onBlur={field.onBlur}
                                        inputPlaceholder="Photos or mentions of a factory shed or warehouse"
                                        className="sm:w-full"
                                    />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <div className="sm:col-span-2">
                        <SelectField
                            label="Weight"
                            labelStyle="text-caption"
                            name={`fit_signals.${idx}.weight`}
                            options={weightOptions}
                            control={form.control}
                            className="w-full sm:w-full"
                        />
                    </div>
                    <MyButton
                        type="button"
                        buttonType="text"
                        layoutVariant="icon"
                        scale="medium"
                        onClick={() => remove(idx)}
                        aria-label="Remove fit signal"
                        className="self-end sm:col-span-1 sm:mt-6 sm:self-start"
                    >
                        <Trash className="size-4 text-danger-600" />
                    </MyButton>
                </div>
            ))}
            {rootError && <p className="text-caption text-danger-600">{rootError}</p>}
            {fields.length < MAX_FIT_SIGNALS && (
                <MyButton
                    type="button"
                    buttonType="text"
                    scale="medium"
                    onClick={() => append({ key: '', label: '', description: '', weight: '2' })}
                    className="self-start"
                >
                    <Plus className="size-4" /> Add fit signal
                </MyButton>
            )}
        </div>
    );
}

/** What a good prospect looks like for the offer: fit signals, competitors, education. */
function FitSection({ form }: { form: Form }) {
    return (
        <div className="flex flex-col gap-6 border-y border-neutral-200 py-6">
            <SectionHeading
                title="What a good fit looks like"
                hint="The agent scores each prospect against these. All optional; “Suggest with AI” can fill them."
            />
            <FitSignalsField form={form} />
            <FormField
                control={form.control}
                name="competitors"
                render={({ field }) => (
                    <FormItem>
                        <FormLabel>Competitors</FormLabel>
                        <FormDescription>
                            Who else sells what you sell. Type a name, a website, or both, e.g.
                            “Acme (acme.com)”.
                        </FormDescription>
                        <ChipListInput
                            value={field.value}
                            onChange={field.onChange}
                            placeholder="Type a competitor and press Enter"
                            max={MAX_COMPETITORS}
                            ariaLabel="Competitors"
                        />
                        <FormMessage />
                    </FormItem>
                )}
            />
            <FormField
                control={form.control}
                name="competitor_kinds"
                render={({ field }) => (
                    <FormItem>
                        <FormLabel>Software that competes with you</FormLabel>
                        <FormDescription>
                            A prospect already using one of these needs a reason to switch.
                        </FormDescription>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                            {COMPETITOR_KIND_OPTIONS.map((k) => {
                                const on = field.value.includes(k.value);
                                return (
                                    <label
                                        key={k.value}
                                        className={cn(
                                            'flex cursor-pointer items-center gap-2 rounded-md border p-3 text-body',
                                            on
                                                ? 'border-primary-300 bg-primary-50'
                                                : 'border-neutral-200'
                                        )}
                                    >
                                        <Checkbox
                                            checked={on}
                                            onCheckedChange={(next) =>
                                                field.onChange(
                                                    next
                                                        ? [...field.value, k.value]
                                                        : field.value.filter((x) => x !== k.value)
                                                )
                                            }
                                        />
                                        {k.label}
                                    </label>
                                );
                            })}
                        </div>
                        <FormMessage />
                    </FormItem>
                )}
            />
            <FormField
                control={form.control}
                name="education"
                render={({ field }) => (
                    <FormItem className="flex items-start gap-3 rounded-md border border-neutral-200 p-3">
                        <FormControl>
                            <Checkbox
                                checked={field.value}
                                onCheckedChange={(next) => field.onChange(next === true)}
                                className="mt-0.5"
                            />
                        </FormControl>
                        <div className="flex flex-col gap-1">
                            <FormLabel>Our buyers are in education</FormLabel>
                            <FormDescription>
                                Turns on checks for coaching chains and home tutors.
                            </FormDescription>
                        </div>
                    </FormItem>
                )}
            />
            <FormField
                control={form.control}
                name="discovery_question"
                render={({ field }) => (
                    <FormItem>
                        <FormLabel>First question to ask (optional)</FormLabel>
                        <FormControl>
                            <MyInput
                                input={field.value}
                                onChangeFunction={field.onChange}
                                onBlur={field.onBlur}
                                inputPlaceholder="e.g. How much do you spend on electricity each month?"
                                className="sm:w-full"
                            />
                        </FormControl>
                        <FormDescription>
                            What your salesperson asks first when they call a lead.
                        </FormDescription>
                        <FormMessage />
                    </FormItem>
                )}
            />
        </div>
    );
}

export function AudienceSection({ form }: { form: Form }) {
    const education = form.watch('education');
    return (
        <div className="flex flex-col gap-6">
            <IndustriesField form={form} />
            <ChipField
                form={form}
                name="buyer_roles"
                label="Buyer roles"
                hint="Who decides to buy, e.g. founder, director."
                placeholder="Type a role and press Enter"
            />
            <ChipField
                form={form}
                name="hiring_roles"
                label="Hiring roles"
                hint="Jobs that show they need you, e.g. facilities manager, sales executive."
                placeholder="Type a role and press Enter"
            />
            <ChipField
                form={form}
                name="keywords"
                label="Keywords"
                hint="Phrases people use when they need what you sell."
                placeholder="e.g. looking for a solar installer"
            />
            <ChipField
                form={form}
                name="must_have"
                label="Must-haves"
                hint="What a good lead must have, e.g. owns its premises."
                placeholder="Type and press Enter"
            />
            <ChipField
                form={form}
                name="deal_breakers"
                label="Deal-breakers"
                hint="What rules a lead out, e.g. government institutions."
                placeholder="Type and press Enter"
            />
            <ChipField
                form={form}
                name="exclude"
                label="Leave out"
                hint="Kinds of organisations never to look at."
                placeholder="Type a kind and press Enter"
                presets={education ? EXCLUDE_PRESETS : undefined}
            />
            <FitSection form={form} />
            <MarketsField form={form} />
            <FormField
                control={form.control}
                name="sources"
                render={({ field }) => (
                    <FormItem>
                        <FormLabel>
                            Where to look <span className="text-danger-600">*</span>
                        </FormLabel>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            {SOURCE_OPTIONS.map((s) => {
                                const on = field.value.includes(s.value);
                                const id = `la-source-${s.value}`;
                                return (
                                    <div
                                        key={s.value}
                                        className="flex items-start justify-between gap-3 rounded-md border border-neutral-200 p-3"
                                    >
                                        <div className="flex flex-col">
                                            <Label
                                                htmlFor={id}
                                                className="text-body text-neutral-700"
                                            >
                                                {s.label}
                                            </Label>
                                            <span className="text-caption text-neutral-500">
                                                {s.hint}
                                            </span>
                                        </div>
                                        <Switch
                                            id={id}
                                            checked={on}
                                            onCheckedChange={(next) =>
                                                field.onChange(
                                                    next
                                                        ? [...field.value, s.value]
                                                        : field.value.filter((x) => x !== s.value)
                                                )
                                            }
                                        />
                                    </div>
                                );
                            })}
                        </div>
                        <FormMessage />
                    </FormItem>
                )}
            />
        </div>
    );
}

// ─── Step 3: pace, mode, quality ─────────────────────────────────────────────

function NumberField({
    form,
    name,
    label,
    hint,
    min,
    max,
    required,
}: {
    form: Form;
    name: 'daily_quota' | 'auto_score' | 'review_score';
    label: string;
    hint?: string;
    min: number;
    max: number;
    required?: boolean;
}) {
    return (
        <FormField
            control={form.control}
            name={name}
            render={({ field }) => (
                <FormItem>
                    <FormLabel>
                        {label} {required && <span className="text-danger-600">*</span>}
                    </FormLabel>
                    <FormControl>
                        <MyInput
                            inputType="number"
                            min={min}
                            max={max}
                            input={Number.isFinite(field.value) ? String(field.value) : ''}
                            onChangeFunction={(e) =>
                                field.onChange(
                                    e.target.value === '' ? Number.NaN : Number(e.target.value)
                                )
                            }
                            onBlur={field.onBlur}
                            className="sm:w-full"
                        />
                    </FormControl>
                    {hint && <FormDescription>{hint}</FormDescription>}
                    <FormMessage />
                </FormItem>
            )}
        />
    );
}

export function PacingSection({ form }: { form: Form }) {
    const [advancedOpen, setAdvancedOpen] = useState(false);
    const tz = form.watch('tz');
    const auto = form.watch('auto_score');
    const review = form.watch('review_score');
    const preset = presetFor(auto, review);

    const tzOptions = useMemo(() => {
        const zones = new Set<string>(COMMON_TIMEZONES);
        zones.add(getBrowserTimezone());
        if (tz) zones.add(tz);
        return [...zones].map((z) => ({ _id: z, value: z, label: z }));
    }, [tz]);

    return (
        <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-4">
                <SectionHeading
                    title="Pace"
                    hint="The agent delivers up to this many leads a day, only inside the delivery window, so calls and messages go out in working hours."
                />
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <NumberField
                        form={form}
                        name="daily_quota"
                        label="Leads per day"
                        hint="1 to 200"
                        min={1}
                        max={200}
                        required
                    />
                    <FormField
                        control={form.control}
                        name="monthly_credit_cap"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Monthly credit cap (optional)</FormLabel>
                                <FormControl>
                                    <MyInput
                                        inputType="number"
                                        min={1}
                                        input={field.value}
                                        onChangeFunction={field.onChange}
                                        onBlur={field.onBlur}
                                        inputPlaceholder="No cap"
                                        className="sm:w-full"
                                    />
                                </FormControl>
                                <FormDescription>
                                    The agent stops for the month at this many credits.
                                </FormDescription>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <SelectField
                        label="Time zone"
                        name="tz"
                        options={tzOptions}
                        control={form.control}
                        required
                        className="w-full sm:w-full"
                    />
                    <FormField
                        control={form.control}
                        name="start"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>From</FormLabel>
                                <FormControl>
                                    <MyInput
                                        inputType="time"
                                        input={field.value}
                                        onChangeFunction={field.onChange}
                                        onBlur={field.onBlur}
                                        className="sm:w-full"
                                    />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <FormField
                        control={form.control}
                        name="end"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>To</FormLabel>
                                <FormControl>
                                    <MyInput
                                        inputType="time"
                                        input={field.value}
                                        onChangeFunction={field.onChange}
                                        onBlur={field.onBlur}
                                        className="sm:w-full"
                                    />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                </div>
                <FormField
                    control={form.control}
                    name="days"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Days</FormLabel>
                            <div className="flex flex-wrap gap-2">
                                {WEEKDAYS.map((d) => {
                                    const on = field.value.includes(d.value);
                                    return (
                                        <label
                                            key={d.value}
                                            className={cn(
                                                'flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-body',
                                                on
                                                    ? 'border-primary-300 bg-primary-50'
                                                    : 'border-neutral-200'
                                            )}
                                        >
                                            <Checkbox
                                                checked={on}
                                                onCheckedChange={(next) =>
                                                    field.onChange(
                                                        next
                                                            ? [...field.value, d.value]
                                                            : field.value.filter(
                                                                  (x) => x !== d.value
                                                              )
                                                    )
                                                }
                                            />
                                            {d.label}
                                        </label>
                                    );
                                })}
                            </div>
                            <FormMessage />
                        </FormItem>
                    )}
                />
            </div>

            <FormField
                control={form.control}
                name="mode"
                render={({ field }) => (
                    <FormItem className="flex flex-col gap-2">
                        <SectionHeading
                            title="Where it runs"
                            hint="Both read the same websites the same way; only who reads them and the price change."
                        />
                        <FormControl>
                            <RadioGroup
                                value={field.value}
                                onValueChange={field.onChange}
                                className="grid grid-cols-1 gap-2 sm:grid-cols-3"
                            >
                                {MODE_OPTIONS.map((m) => {
                                    const id = `la-mode-${m.value}`;
                                    return (
                                        <label
                                            key={m.value}
                                            htmlFor={id}
                                            className={cn(
                                                'flex cursor-pointer items-start gap-3 rounded-md border p-3',
                                                field.value === m.value
                                                    ? 'border-primary-300 bg-primary-50'
                                                    : 'border-neutral-200'
                                            )}
                                        >
                                            <RadioGroupItem
                                                id={id}
                                                value={m.value}
                                                className="mt-0.5"
                                            />
                                            <span className="flex flex-col gap-1">
                                                <span className="text-body font-semibold text-neutral-800">
                                                    {m.label}
                                                </span>
                                                <span className="text-caption text-neutral-500">
                                                    {m.note}
                                                </span>
                                            </span>
                                        </label>
                                    );
                                })}
                            </RadioGroup>
                        </FormControl>
                        <FormMessage />
                    </FormItem>
                )}
            />

            <div className="flex flex-col gap-3">
                <SectionHeading
                    title="Quality"
                    hint="Leads at or above the auto score go straight into the list. Leads between the two scores wait for your review. The rest are kept but never delivered."
                />
                <RadioGroup
                    value={preset}
                    onValueChange={(v) => {
                        const p = GATE_PRESETS.find((x) => x.value === v);
                        if (!p) return;
                        form.setValue('auto_score', p.auto, {
                            shouldDirty: true,
                            shouldValidate: true,
                        });
                        form.setValue('review_score', p.review, {
                            shouldDirty: true,
                            shouldValidate: true,
                        });
                    }}
                    className="grid grid-cols-1 gap-2 sm:grid-cols-3"
                    aria-label="Quality preset"
                >
                    {GATE_PRESETS.map((p) => {
                        const id = `la-gate-${p.value}`;
                        return (
                            <label
                                key={p.value}
                                htmlFor={id}
                                className={cn(
                                    'flex cursor-pointer items-center gap-3 rounded-md border p-3',
                                    preset === p.value
                                        ? 'border-primary-300 bg-primary-50'
                                        : 'border-neutral-200'
                                )}
                            >
                                <RadioGroupItem id={id} value={p.value} />
                                <span className="flex flex-col">
                                    <span className="text-body font-semibold text-neutral-800">
                                        {p.label}
                                        {p.value === 'balanced' ? ' (default)' : ''}
                                    </span>
                                    <span className="text-caption text-neutral-500">
                                        Auto {p.auto} · review {p.review}
                                    </span>
                                </span>
                            </label>
                        );
                    })}
                </RadioGroup>
                {preset === 'custom' && (
                    <p className="text-caption text-neutral-500">
                        Custom: auto {Number.isFinite(auto) ? auto : '–'} · review{' '}
                        {Number.isFinite(review) ? review : '–'}
                    </p>
                )}
                <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
                    <CollapsibleTrigger asChild>
                        <MyButton type="button" buttonType="text" scale="small" className="px-0">
                            {advancedOpen ? (
                                <CaretUp className="size-4" />
                            ) : (
                                <CaretDown className="size-4" />
                            )}
                            Advanced
                        </MyButton>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="flex flex-col gap-4 pt-3">
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <NumberField
                                form={form}
                                name="auto_score"
                                label="Auto-deliver score"
                                min={1}
                                max={100}
                            />
                            <NumberField
                                form={form}
                                name="review_score"
                                label="Review score"
                                min={0}
                                max={100}
                            />
                        </div>
                        <SelectField
                            label="Lowest contact to deliver"
                            name="min_contact"
                            options={MIN_CONTACT_OPTIONS.map((o) => ({
                                _id: o.value,
                                value: o.value,
                                label: `${o.label}: ${o.hint}`,
                            }))}
                            control={form.control}
                            className="w-full sm:w-full"
                        />
                        <FormField
                            control={form.control}
                            name="require_intent"
                            render={({ field }) => (
                                <FormItem className="flex items-start justify-between gap-3 rounded-md border border-neutral-200 p-3">
                                    <div className="flex flex-col gap-1">
                                        <FormLabel>Require a buying signal</FormLabel>
                                        <FormDescription>
                                            Only auto-deliver leads that are acting now, e.g. hiring
                                            the roles you list or asking for what you sell.
                                        </FormDescription>
                                    </div>
                                    <FormControl>
                                        <Switch
                                            checked={field.value}
                                            onCheckedChange={field.onChange}
                                        />
                                    </FormControl>
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={form.control}
                            name="auto_competitor_users"
                            render={({ field }) => (
                                <FormItem className="flex items-start justify-between gap-3 rounded-md border border-neutral-200 p-3">
                                    <div className="flex flex-col gap-1">
                                        <FormLabel>Auto-deliver competitor users</FormLabel>
                                        <FormDescription>
                                            Leads already using a competitor&apos;s product wait for
                                            your review by default. Turn this on to score them like
                                            any other lead. Very large organisations still wait.
                                        </FormDescription>
                                    </div>
                                    <FormControl>
                                        <Switch
                                            checked={field.value}
                                            onCheckedChange={field.onChange}
                                        />
                                    </FormControl>
                                </FormItem>
                            )}
                        />
                    </CollapsibleContent>
                </Collapsible>
            </div>
        </div>
    );
}
