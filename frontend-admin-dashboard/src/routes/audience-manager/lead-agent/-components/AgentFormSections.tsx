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
import { dedupe, type AgentFormValues } from '../-utils/agent-form';
import {
    EXCLUDE_PRESETS,
    GATE_PRESETS,
    MIN_CONTACT_OPTIONS,
    MODE_OPTIONS,
    PRODUCT_OPTIONS,
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

// ─── Step 1: list + product ──────────────────────────────────────────────────

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
            dedupe([...v.buyer_roles, ...flat('buyer_roles')]).slice(0, 30),
            opts
        );
        form.setValue(
            'hiring_roles',
            dedupe([...v.hiring_roles, ...flat('hiring_phrases')]).slice(0, 30),
            opts
        );
        form.setValue(
            'keywords',
            dedupe([...v.keywords, ...res.keywords, ...flat('need_phrases')]).slice(0, 30),
            opts
        );
        setSummary(
            res.summary ||
                `Suggested ${res.industries.length} industries. Check them in the next step.`
        );
    };

    const runSuggest = async () => {
        const ok = await form.trigger(['products', 'description', 'product_url']);
        if (!ok) return;
        const v = form.getValues();
        const res = await suggest
            .mutateAsync({
                products: v.products,
                description: v.description.trim() || undefined,
                url: v.product_url.trim() || undefined,
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
                                inputPlaceholder="e.g. Coaching institutes in Rajasthan"
                                className="sm:w-full"
                            />
                        </FormControl>
                        <FormMessage />
                    </FormItem>
                )}
            />
            <FormField
                control={form.control}
                name="products"
                render={({ field }) => (
                    <FormItem>
                        <FormLabel>
                            What you sell <span className="text-danger-600">*</span>
                        </FormLabel>
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                            {PRODUCT_OPTIONS.map((p) => {
                                const checked = field.value.includes(p.value);
                                return (
                                    <label
                                        key={p.value}
                                        className={cn(
                                            'flex cursor-pointer items-center gap-2 rounded-md border p-3 text-body',
                                            checked
                                                ? 'border-primary-300 bg-primary-50'
                                                : 'border-neutral-200'
                                        )}
                                    >
                                        <Checkbox
                                            checked={checked}
                                            onCheckedChange={(on) =>
                                                field.onChange(
                                                    on
                                                        ? [...field.value, p.value]
                                                        : field.value.filter((x) => x !== p.value)
                                                )
                                            }
                                        />
                                        {p.label}
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
                                placeholder="What you sell and to whom. e.g. An all-in-one platform for coaching institutes: online classes, test series, admissions CRM and AI calling."
                            />
                        </FormControl>
                        <FormMessage />
                    </FormItem>
                )}
            />
            <FormField
                control={form.control}
                name="product_url"
                render={({ field }) => (
                    <FormItem>
                        <FormLabel>Product page (optional)</FormLabel>
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
                        <FormDescription>Only used for the AI suggestion below.</FormDescription>
                        <FormMessage />
                    </FormItem>
                )}
            />
            <div className="flex flex-col gap-2 rounded-lg border border-neutral-200 bg-neutral-50 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-body text-neutral-600">
                        Let AI suggest industries, buyer roles, hiring roles and keywords from your
                        description.
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
                                        inputPlaceholder="Online coaching institutes"
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
                                        inputPlaceholder="online coaching institute"
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
                    />
                    <FormMessage />
                </FormItem>
            )}
        />
    );
}

export function AudienceSection({ form }: { form: Form }) {
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
                hint="Jobs that show they need you, e.g. telecaller, admission counsellor."
                placeholder="Type a role and press Enter"
            />
            <ChipField
                form={form}
                name="keywords"
                label="Keywords"
                hint="Phrases people use when they need what you sell."
                placeholder="e.g. looking for LMS for coaching"
            />
            <ChipField
                form={form}
                name="must_have"
                label="Must-haves"
                hint="What a good lead must have, e.g. offers online courses."
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
                presets={EXCLUDE_PRESETS}
            />
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
                                            telecallers or asking for software.
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
