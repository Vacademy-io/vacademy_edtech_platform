import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
    BookOpen,
    Buildings,
    CheckCircle,
    CurrencyCircleDollar,
    ImageSquare,
    Info,
    MagnifyingGlass,
    Plus,
    ShieldCheck,
    Sparkle,
    Storefront,
    Ticket,
    Trash,
    UploadSimple,
    Warning,
} from '@phosphor-icons/react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { TagInput } from '@/components/ui/tag-input';
import { cn } from '@/lib/utils';
import {
    handleGetPaymentDetails,
    PAYMENT_OPTIONS_PAGE_SIZE,
} from '@/routes/manage-students/invite/-components/create-invite/-services/get-payments';
import { UploadFileInS3, getPublicUrl } from '@/services/upload_file';
import { getUserId } from '@/utils/userDetails';
import {
    createAccessPass,
    updateAccessPass,
    type AccessPass,
    type AccessPassAudience,
    type AccessPassCourseScope,
    type AccessPassRequest,
    type ItemRemovalPolicy,
} from '@/services/access-pass';
import { useBatchOptions } from '../-hooks/use-batch-options';
import { CreatePassPricingDialog, type CreatedPricing } from './CreatePassPricingDialog';

interface PaymentPlanLite {
    actual_price?: number;
    currency?: string;
    validity_in_days?: number;
    status?: string;
}

interface PaymentOptionLite {
    id: string;
    name: string;
    type?: string;
    status?: string;
    payment_plans?: PaymentPlanLite[];
}

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Edit when given; create otherwise. */
    pass?: AccessPass;
    onSaved: (pass: AccessPass) => void;
}

/** Colour per payment option type, so a list of options reads at a glance. */
const TYPE_STYLE: Record<string, string> = {
    FREE: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    ONE_TIME: 'bg-sky-50 text-sky-700 ring-sky-200',
    SUBSCRIPTION: 'bg-violet-50 text-violet-700 ring-violet-200',
    DONATION: 'bg-pink-50 text-pink-700 ring-pink-200',
    CPO: 'bg-amber-50 text-amber-800 ring-amber-200',
};

const formatMoney = (value?: number, currency?: string) => {
    if (value == null) return null;
    if (!currency) return String(value);
    try {
        return new Intl.NumberFormat(undefined, {
            style: 'currency',
            currency,
            maximumFractionDigits: 0,
        }).format(value);
    } catch {
        return `${currency} ${value}`;
    }
};

/** "From ₹999 · 365 days" for an option, from its active plans. */
const optionSummary = (o: PaymentOptionLite): string | null => {
    const plans = (o.payment_plans ?? []).filter((p) => (p.status ?? 'ACTIVE').toUpperCase() !== 'DELETED');
    if (o.type === 'FREE') return 'Free';
    if (plans.length === 0) return null;
    const cheapest = plans.reduce((a, b) => ((a.actual_price ?? Infinity) <= (b.actual_price ?? Infinity) ? a : b));
    const price = formatMoney(cheapest.actual_price, cheapest.currency);
    const days = cheapest.validity_in_days ? ` · ${cheapest.validity_in_days} days` : '';
    return price ? `${plans.length > 1 ? 'From ' : ''}${price}${days}` : null;
};

/** A numbered, colour-accented section of the form. */
function Section({
    step,
    icon,
    title,
    subtitle,
    accent,
    children,
}: {
    step: number;
    icon: ReactNode;
    title: string;
    subtitle?: string;
    accent: string;
    children: ReactNode;
}) {
    return (
        <section className="rounded-xl border border-neutral-200 bg-white shadow-sm">
            <header className="flex items-start gap-3 border-b border-neutral-100 px-4 py-3 sm:px-5">
                <span
                    className={cn(
                        'flex size-8 shrink-0 items-center justify-center rounded-lg text-sm font-semibold',
                        accent
                    )}
                >
                    {icon}
                </span>
                <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-neutral-900">
                        <span className="mr-1.5 text-neutral-400">{step}.</span>
                        {title}
                    </h3>
                    {subtitle && <p className="mt-0.5 text-xs text-neutral-500">{subtitle}</p>}
                </div>
            </header>
            <div className="flex flex-col gap-4 p-4 sm:p-5">{children}</div>
        </section>
    );
}

/** A large selectable card (radio behaviour). */
function ChoiceCard({
    selected,
    disabled,
    onSelect,
    icon,
    title,
    description,
    tone,
}: {
    selected: boolean;
    disabled?: boolean;
    onSelect: () => void;
    icon: ReactNode;
    title: string;
    description: string;
    tone: 'primary' | 'emerald' | 'amber' | 'violet';
}) {
    const tones = {
        primary: { ring: 'border-primary-500 bg-primary-50 ring-2 ring-primary-200', icon: 'bg-primary-100 text-primary-600' },
        emerald: { ring: 'border-emerald-500 bg-emerald-50 ring-2 ring-emerald-200', icon: 'bg-emerald-100 text-emerald-700' },
        amber: { ring: 'border-amber-500 bg-amber-50 ring-2 ring-amber-200', icon: 'bg-amber-100 text-amber-700' },
        violet: { ring: 'border-violet-500 bg-violet-50 ring-2 ring-violet-200', icon: 'bg-violet-100 text-violet-700' },
    }[tone];
    return (
        <button
            type="button"
            disabled={disabled}
            onClick={onSelect}
            aria-pressed={selected}
            className={cn(
                'relative flex w-full items-start gap-3 rounded-xl border p-4 text-left transition-all',
                selected ? tones.ring : 'border-neutral-200 bg-white hover:border-neutral-300 hover:bg-neutral-50',
                disabled && !selected && 'cursor-not-allowed opacity-50',
                disabled && selected && 'cursor-default'
            )}
        >
            <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-lg', tones.icon)}>
                {icon}
            </span>
            <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-neutral-900">{title}</span>
                <span className="mt-0.5 block text-xs leading-relaxed text-neutral-600">{description}</span>
            </span>
            {selected && <CheckCircle weight="fill" className="size-5 shrink-0 text-primary-500" />}
        </button>
    );
}

/**
 * Create / edit an access pass. Courses are picked here only on create; after that
 * they change through the detail panel, so each change triggers its own holder sync.
 */
export function AccessPassEditorDialog({ open, onOpenChange, pass, onSaved }: Props) {
    const { t } = useTranslation('manageAccessPasses');
    const isEdit = !!pass;
    const { options: batchOptions } = useBatchOptions();
    const fileInput = useRef<HTMLInputElement>(null);

    const [name, setName] = useState('');
    const [slug, setSlug] = useState('');
    const [shortDescription, setShortDescription] = useState('');
    const [description, setDescription] = useState('');
    const [coverImageUrl, setCoverImageUrl] = useState('');
    const [tags, setTags] = useState<string[]>([]);
    const [paymentOptionId, setPaymentOptionId] = useState('');
    const [policy, setPolicy] = useState<ItemRemovalPolicy>('KEEP_FOR_EXISTING');
    const [audience, setAudience] = useState<AccessPassAudience>('B2C');
    const [scope, setScope] = useState<AccessPassCourseScope>('SELECTED');
    const [pricingOpen, setPricingOpen] = useState(false);
    // Options created from this dialog, shown before the list refetch brings them in.
    const [createdOptions, setCreatedOptions] = useState<CreatedPricing[]>([]);
    const [packageSessionIds, setPackageSessionIds] = useState<string[]>([]);
    const [courseSearch, setCourseSearch] = useState('');
    const [paymentSearch, setPaymentSearch] = useState('');
    const [uploading, setUploading] = useState(false);
    const [dragOver, setDragOver] = useState(false);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!open) return;
        setName(pass?.name ?? '');
        setSlug(pass?.slug ?? '');
        setShortDescription(pass?.short_description ?? '');
        setDescription(pass?.description ?? '');
        setCoverImageUrl(pass?.cover_image_url ?? '');
        setTags(pass?.tags ?? []);
        setPaymentOptionId(pass?.payment_option_id ?? '');
        setPolicy(pass?.on_item_removed ?? 'KEEP_FOR_EXISTING');
        setAudience(pass?.audience_type ?? 'B2C');
        setScope(pass?.course_scope ?? 'SELECTED');
        setCreatedOptions([]);
        setPackageSessionIds([]);
        setCourseSearch('');
        setPaymentSearch('');
    }, [open, pass]);

    const { data: paymentData, isLoading: paymentsLoading } = useQuery({
        ...handleGetPaymentDetails(paymentSearch, PAYMENT_OPTIONS_PAGE_SIZE),
        enabled: open,
    });
    const paymentOptions = useMemo<PaymentOptionLite[]>(() => {
        const list = (Array.isArray(paymentData) ? paymentData : []) as PaymentOptionLite[];
        const live = list.filter((p) => (p.status ?? 'ACTIVE').toUpperCase() !== 'DELETED');
        const known = new Set(live.map((p) => p.id));
        return [...createdOptions.filter((c) => !known.has(c.id)), ...live];
    }, [paymentData, createdOptions]);
    const selectedOption = paymentOptions.find((p) => p.id === paymentOptionId);

    const filteredCourses = useMemo(() => {
        const q = courseSearch.trim().toLowerCase();
        return q ? batchOptions.filter((o) => o.label.toLowerCase().includes(q)) : batchOptions;
    }, [batchOptions, courseSearch]);
    const selectedSet = useMemo(() => new Set(packageSessionIds), [packageSessionIds]);
    const allFilteredSelected = filteredCourses.length > 0 && filteredCourses.every((o) => selectedSet.has(o.value));

    const toggleCourse = (id: string) =>
        setPackageSessionIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    const toggleAllFiltered = () => {
        const ids = filteredCourses.map((o) => o.value);
        setPackageSessionIds((prev) =>
            allFilteredSelected ? prev.filter((x) => !ids.includes(x)) : Array.from(new Set([...prev, ...ids]))
        );
    };

    const handleCoverUpload = async (file?: File) => {
        if (!file) return;
        if (!file.type.startsWith('image/')) {
            toast.error(t('editor.notImage', 'Choose an image file'));
            return;
        }
        try {
            const fileId = await UploadFileInS3(
                file,
                setUploading,
                getUserId() || 'admin',
                'ACCESS_PASS',
                'INSTITUTE',
                true
            );
            const url = await getPublicUrl(fileId);
            if (!url) throw new Error('no url');
            setCoverImageUrl(url);
        } catch {
            toast.error(t('editor.uploadFailed', 'Could not upload the image'));
        } finally {
            setUploading(false);
        }
    };

    const handleSave = async () => {
        if (!name.trim()) {
            toast.error(t('editor.nameRequired', 'Give the pass a name'));
            return;
        }
        if (!paymentOptionId) {
            toast.error(t('editor.paymentRequired', 'Choose how the pass is priced'));
            return;
        }
        if (!isEdit && scope === 'SELECTED' && packageSessionIds.length === 0) {
            toast.error(t('editor.coursesRequired', 'Select at least one course'));
            return;
        }
        const body: AccessPassRequest = {
            name: name.trim(),
            slug: slug.trim() || undefined,
            short_description: shortDescription,
            description,
            cover_image_url: coverImageUrl,
            tags,
            payment_option_id: paymentOptionId,
            on_item_removed: policy,
            course_scope: scope,
        };
        setSaving(true);
        try {
            const saved = isEdit
                ? await updateAccessPass(pass!.id, body)
                : await createAccessPass({
                      ...body,
                      audience_type: audience,
                      package_session_ids: scope === 'SELECTED' ? packageSessionIds : undefined,
                  });
            toast.success(isEdit ? t('editor.updated', 'Pass updated') : t('editor.created', 'Pass created as a draft — publish it to open the sell link'));
            onSaved(saved);
            onOpenChange(false);
        } catch (e: unknown) {
            const msg = (e as { response?: { data?: { ex?: string; message?: string } } })?.response?.data;
            toast.error(msg?.ex || msg?.message || t('editor.saveFailed', 'Could not save the pass'));
        } finally {
            setSaving(false);
        }
    };

    const courseSummary =
        scope === 'ALL_COURSES'
            ? t('editor.summaryAll', 'All courses')
            : isEdit
              ? t('editor.summaryKept', 'Courses unchanged')
              : t('editor.summarySelected', { defaultValue: '{{count}} courses', count: packageSessionIds.length });

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="flex max-h-[92vh] w-[min(980px,95vw)] max-w-[95vw] flex-col gap-0 overflow-hidden p-0">
                {/* Header */}
                <div className="flex items-start gap-3 bg-gradient-to-r from-primary-500 to-primary-400 px-5 py-4 text-white sm:px-6">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white/20">
                        <Ticket weight="duotone" className="size-6" />
                    </span>
                    <div className="min-w-0 pr-6">
                        <DialogTitle className="text-lg font-semibold text-white">
                            {isEdit ? t('editor.editTitle', 'Edit access pass') : t('editor.createTitle', 'New access pass')}
                        </DialogTitle>
                        <DialogDescription className="text-sm text-white/85">
                            {t(
                                'editor.headerHint',
                                'One purchase that unlocks a set of courses. Saved as a draft — publish it when it is ready.'
                            )}
                        </DialogDescription>
                    </div>
                </div>

                {/* Body */}
                <div className="flex-1 space-y-5 overflow-y-auto overflow-x-hidden bg-neutral-50 px-4 py-5 sm:px-6">
                    {/* 1. Type */}
                    <Section
                        step={1}
                        icon={<Sparkle weight="bold" className="size-4" />}
                        accent="bg-primary-100 text-primary-600"
                        title={t('editor.audience', 'Who is this pass for?')}
                        subtitle={
                            isEdit
                                ? t('editor.audienceLocked', 'The pass type cannot change after it is created.')
                                : undefined
                        }
                    >
                        <div className="grid gap-3 md:grid-cols-2">
                            <ChoiceCard
                                tone="primary"
                                selected={audience === 'B2C'}
                                disabled={isEdit}
                                onSelect={() => setAudience('B2C')}
                                icon={<Storefront weight="duotone" className="size-5" />}
                                title={t('editor.audienceB2CTitle', 'Learners (B2C)')}
                                description={t(
                                    'editor.audienceB2CDesc',
                                    'Sold on your website. Learners buy it and get every included course.'
                                )}
                            />
                            <ChoiceCard
                                tone="emerald"
                                selected={audience === 'B2B'}
                                disabled={isEdit}
                                onSelect={() => setAudience('B2B')}
                                icon={<Buildings weight="duotone" className="size-5" />}
                                title={t('editor.audienceB2BTitle', 'Organisations (B2B)')}
                                description={t(
                                    'editor.audienceB2BDesc',
                                    'Assigned to sub-orgs. Their members get the courses — including ones you add later.'
                                )}
                            />
                        </div>
                    </Section>

                    {/* 2. Basics */}
                    <Section
                        step={2}
                        icon={<Info weight="bold" className="size-4" />}
                        accent="bg-sky-100 text-sky-700"
                        title={t('editor.basics', 'Pass details')}
                        subtitle={t('editor.basicsHint', 'What learners see on the catalogue card and details page.')}
                    >
                        <div className="grid gap-4 md:grid-cols-2">
                            <div className="grid gap-1.5">
                                <Label>
                                    {t('editor.name', 'Name')} <span className="text-red-500">*</span>
                                </Label>
                                <Input
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    maxLength={255}
                                    placeholder={t('editor.namePlaceholder', 'e.g. NEET All-Access 2027')}
                                />
                            </div>
                            <div className="grid gap-1.5">
                                <Label>{t('editor.slug', 'URL key')}</Label>
                                <div className="flex items-center overflow-hidden rounded-md border border-input bg-white focus-within:ring-1 focus-within:ring-ring">
                                    <span className="shrink-0 border-r bg-neutral-50 px-2.5 py-2 text-xs text-neutral-500">
                                        ?pass=
                                    </span>
                                    <input
                                        value={slug}
                                        onChange={(e) => setSlug(e.target.value)}
                                        placeholder={t('editor.slugPlaceholder', 'generated from the name')}
                                        className="h-9 min-w-0 flex-1 bg-transparent px-2.5 text-sm outline-none placeholder:text-neutral-400"
                                    />
                                </div>
                            </div>
                            <div className="grid gap-1.5 md:col-span-2">
                                <Label>{t('editor.shortDescription', 'Short description')}</Label>
                                <Input
                                    value={shortDescription}
                                    onChange={(e) => setShortDescription(e.target.value)}
                                    placeholder={t('editor.shortDescriptionPlaceholder', 'One line shown on the card')}
                                />
                            </div>
                            <div className="grid gap-1.5 md:col-span-2">
                                <Label>{t('editor.description', 'Description')}</Label>
                                <Textarea
                                    rows={3}
                                    value={description}
                                    onChange={(e) => setDescription(e.target.value)}
                                    placeholder={t('editor.descriptionPlaceholder', 'What the pass includes and who it is for')}
                                />
                            </div>
                            <div className="grid gap-1.5">
                                <Label>{t('editor.cover', 'Cover image')}</Label>
                                {coverImageUrl ? (
                                    <div className="group relative overflow-hidden rounded-lg border">
                                        <img src={coverImageUrl} alt="" className="aspect-video w-full object-cover" />
                                        <div className="absolute inset-x-0 bottom-0 flex justify-end gap-2 bg-gradient-to-t from-black/60 to-transparent p-2">
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant="secondary"
                                                onClick={() => fileInput.current?.click()}
                                            >
                                                {t('editor.replaceCover', 'Replace')}
                                            </Button>
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant="destructive"
                                                onClick={() => setCoverImageUrl('')}
                                            >
                                                <Trash className="size-4" />
                                            </Button>
                                        </div>
                                    </div>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={() => fileInput.current?.click()}
                                        onDragOver={(e) => {
                                            e.preventDefault();
                                            setDragOver(true);
                                        }}
                                        onDragLeave={() => setDragOver(false)}
                                        onDrop={(e) => {
                                            e.preventDefault();
                                            setDragOver(false);
                                            handleCoverUpload(e.dataTransfer.files?.[0]);
                                        }}
                                        disabled={uploading}
                                        className={cn(
                                            'flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed text-sm transition-colors',
                                            dragOver
                                                ? 'border-primary-500 bg-primary-50 text-primary-600'
                                                : 'border-neutral-300 bg-white text-neutral-500 hover:border-primary-400 hover:bg-primary-50/50'
                                        )}
                                    >
                                        {uploading ? (
                                            <UploadSimple className="size-7 animate-bounce text-primary-500" />
                                        ) : (
                                            <ImageSquare weight="duotone" className="size-8 text-primary-400" />
                                        )}
                                        <span className="font-medium text-neutral-700">
                                            {uploading
                                                ? t('editor.uploading', 'Uploading…')
                                                : t('editor.coverDrop', 'Drop an image or click to upload')}
                                        </span>
                                        <span className="text-xs text-neutral-400">
                                            {t('editor.coverHint', '16:9 works best')}
                                        </span>
                                    </button>
                                )}
                                <input
                                    ref={fileInput}
                                    type="file"
                                    accept="image/*"
                                    className="hidden"
                                    onChange={(e) => {
                                        handleCoverUpload(e.target.files?.[0]);
                                        e.target.value = '';
                                    }}
                                />
                            </div>
                            <div className="grid content-start gap-1.5">
                                <Label>{t('editor.tags', 'Tags')}</Label>
                                <TagInput tags={tags} onChange={setTags} />
                                <p className="text-xs text-neutral-500">
                                    {t(
                                        'editor.tagsHint',
                                        'Used to filter passes on the website (e.g. a section showing only "NEET").'
                                    )}
                                </p>
                            </div>
                        </div>
                    </Section>

                    {/* 3. Courses */}
                    <Section
                        step={3}
                        icon={<BookOpen weight="bold" className="size-4" />}
                        accent="bg-violet-100 text-violet-700"
                        title={t('editor.courses', 'Included courses')}
                        subtitle={
                            isEdit && scope === 'SELECTED'
                                ? t(
                                      'editor.coursesEditHint',
                                      'Add or remove courses from the pass page after saving; each change reaches current holders.'
                                  )
                                : undefined
                        }
                    >
                        <div className="grid gap-3 md:grid-cols-2">
                            <ChoiceCard
                                tone="violet"
                                selected={scope === 'SELECTED'}
                                onSelect={() => setScope('SELECTED')}
                                icon={<CheckCircle weight="duotone" className="size-5" />}
                                title={t('editor.scopeSelected', 'Selected courses')}
                                description={t('editor.scopeSelectedDesc', 'Pick exactly which course batches the pass unlocks.')}
                            />
                            <ChoiceCard
                                tone="violet"
                                selected={scope === 'ALL_COURSES'}
                                onSelect={() => setScope('ALL_COURSES')}
                                icon={<BookOpen weight="duotone" className="size-5" />}
                                title={t('editor.scopeAllTitle', 'All courses')}
                                description={t(
                                    'editor.scopeAllDesc',
                                    'Every live course — and courses you publish later join automatically.'
                                )}
                            />
                        </div>

                        {scope === 'SELECTED' && !isEdit && (
                            <div className="overflow-hidden rounded-lg border border-neutral-200">
                                <div className="flex flex-col gap-2 border-b bg-neutral-50 p-3 sm:flex-row sm:items-center">
                                    <div className="relative flex-1">
                                        <MagnifyingGlass className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-neutral-400" />
                                        <Input
                                            value={courseSearch}
                                            onChange={(e) => setCourseSearch(e.target.value)}
                                            placeholder={t('editor.searchCourses', 'Search courses')}
                                            className="bg-white pl-8"
                                        />
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className="whitespace-nowrap rounded-full bg-violet-100 px-2.5 py-1 text-xs font-medium text-violet-700">
                                            {t('editor.selectedCount', {
                                                defaultValue: '{{count}} of {{total}} selected',
                                                count: packageSessionIds.length,
                                                total: batchOptions.length,
                                            })}
                                        </span>
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            onClick={toggleAllFiltered}
                                            disabled={filteredCourses.length === 0}
                                        >
                                            {allFilteredSelected
                                                ? t('editor.unselectAll', 'Unselect all')
                                                : t('editor.selectAll', 'Select all')}
                                        </Button>
                                    </div>
                                </div>
                                <ul className="max-h-64 divide-y overflow-y-auto bg-white">
                                    {filteredCourses.map((o) => {
                                        const checked = selectedSet.has(o.value);
                                        return (
                                            <li key={o.value}>
                                                <label
                                                    className={cn(
                                                        'flex cursor-pointer items-center gap-3 px-3 py-2.5 text-sm transition-colors',
                                                        checked ? 'bg-violet-50/60' : 'hover:bg-neutral-50'
                                                    )}
                                                >
                                                    <Checkbox
                                                        checked={checked}
                                                        onCheckedChange={() => toggleCourse(o.value)}
                                                    />
                                                    <span className="min-w-0 flex-1 truncate text-neutral-800">{o.label}</span>
                                                </label>
                                            </li>
                                        );
                                    })}
                                    {filteredCourses.length === 0 && (
                                        <li className="px-3 py-6 text-center text-sm text-neutral-500">
                                            {batchOptions.length === 0
                                                ? t('editor.noCourses', 'No live courses yet')
                                                : t('editor.noCourseMatch', 'No course matches your search')}
                                        </li>
                                    )}
                                </ul>
                            </div>
                        )}
                        {scope === 'SELECTED' && isEdit && pass?.course_scope === 'ALL_COURSES' && (
                            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                                {t(
                                    'editor.scopeToSelectedHint',
                                    "The pass keeps today's courses as its selection; new courses stop joining automatically."
                                )}
                            </p>
                        )}
                    </Section>

                    {/* 4. Pricing */}
                    <Section
                        step={4}
                        icon={<CurrencyCircleDollar weight="bold" className="size-4" />}
                        accent="bg-emerald-100 text-emerald-700"
                        title={t('editor.paymentOption', 'Pricing')}
                        subtitle={
                            isEdit
                                ? t(
                                      'editor.repriceHint',
                                      'Changing this re-prices the pass for new buyers only. Current holders keep their plan.'
                                  )
                                : t('editor.pricingHint', 'Pick an existing payment option or create one for this pass.')
                        }
                    >
                        <div className="flex flex-col gap-2 sm:flex-row">
                            <div className="relative flex-1">
                                <MagnifyingGlass className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-neutral-400" />
                                <Input
                                    value={paymentSearch}
                                    onChange={(e) => setPaymentSearch(e.target.value)}
                                    placeholder={t('editor.searchPayment', 'Search payment options')}
                                    className="pl-8"
                                />
                            </div>
                            <Button
                                type="button"
                                variant="outline"
                                className="border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                                onClick={() => setPricingOpen(true)}
                            >
                                <Plus className="mr-1 size-4" />
                                {t('editor.newPricing', 'Create pricing')}
                            </Button>
                        </div>
                        <div className="max-h-56 overflow-y-auto rounded-lg border border-neutral-200 bg-white">
                            {paymentsLoading && paymentOptions.length === 0 ? (
                                <p className="px-3 py-6 text-center text-sm text-neutral-500">
                                    {t('editor.loading', 'Loading…')}
                                </p>
                            ) : paymentOptions.length === 0 ? (
                                <p className="px-3 py-6 text-center text-sm text-neutral-500">
                                    {t('editor.noPayment', 'No payment options found. Create one for this pass.')}
                                </p>
                            ) : (
                                <ul className="divide-y">
                                    {paymentOptions.map((p) => {
                                        const active = p.id === paymentOptionId;
                                        const summary = optionSummary(p);
                                        return (
                                            <li key={p.id}>
                                                <button
                                                    type="button"
                                                    onClick={() => setPaymentOptionId(p.id)}
                                                    className={cn(
                                                        'flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm transition-colors',
                                                        active ? 'bg-emerald-50' : 'hover:bg-neutral-50'
                                                    )}
                                                >
                                                    <span
                                                        className={cn(
                                                            'flex size-4 shrink-0 items-center justify-center rounded-full border',
                                                            active ? 'border-emerald-600' : 'border-neutral-300'
                                                        )}
                                                    >
                                                        {active && <span className="size-2 rounded-full bg-emerald-600" />}
                                                    </span>
                                                    <span className="min-w-0 flex-1">
                                                        <span className="block truncate font-medium text-neutral-800">
                                                            {p.name}
                                                        </span>
                                                        {summary && (
                                                            <span className="block text-xs text-neutral-500">{summary}</span>
                                                        )}
                                                    </span>
                                                    {p.type && (
                                                        <span
                                                            className={cn(
                                                                'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1',
                                                                TYPE_STYLE[p.type] ?? 'bg-neutral-100 text-neutral-700 ring-neutral-200'
                                                            )}
                                                        >
                                                            {p.type.replace('_', ' ')}
                                                        </span>
                                                    )}
                                                </button>
                                            </li>
                                        );
                                    })}
                                </ul>
                            )}
                        </div>
                    </Section>

                    {/* 5. Removal policy */}
                    <Section
                        step={5}
                        icon={<ShieldCheck weight="bold" className="size-4" />}
                        accent="bg-amber-100 text-amber-700"
                        title={t('editor.policy', 'When a course is removed from the pass')}
                    >
                        <div className="grid gap-3 md:grid-cols-2">
                            <ChoiceCard
                                tone="primary"
                                selected={policy === 'KEEP_FOR_EXISTING'}
                                onSelect={() => setPolicy('KEEP_FOR_EXISTING')}
                                icon={<ShieldCheck weight="duotone" className="size-5" />}
                                title={t('editor.policyKeepTitle', 'Keep for current holders')}
                                description={t(
                                    'editor.policyKeep',
                                    'New buyers stop getting it; people who hold the pass keep it until their plan ends.'
                                )}
                            />
                            <ChoiceCard
                                tone="amber"
                                selected={policy === 'REVOKE'}
                                onSelect={() => setPolicy('REVOKE')}
                                icon={<Warning weight="duotone" className="size-5" />}
                                title={t('editor.policyRevokeTitle', 'Remove from everyone')}
                                description={t(
                                    'editor.policyRevoke',
                                    'Current holders lose it too. Courses they bought separately are never touched.'
                                )}
                            />
                        </div>
                    </Section>
                </div>

                {/* Footer */}
                <div className="flex flex-col gap-3 border-t bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span
                            className={cn(
                                'rounded-full px-2.5 py-1 font-medium',
                                audience === 'B2B' ? 'bg-emerald-100 text-emerald-700' : 'bg-primary-100 text-primary-700'
                            )}
                        >
                            {audience}
                        </span>
                        <span className="rounded-full bg-violet-100 px-2.5 py-1 font-medium text-violet-700">
                            {courseSummary}
                        </span>
                        <span
                            className={cn(
                                'rounded-full px-2.5 py-1 font-medium',
                                selectedOption ? 'bg-emerald-100 text-emerald-700' : 'bg-neutral-100 text-neutral-500'
                            )}
                        >
                            {selectedOption ? selectedOption.name : t('editor.noPricingYet', 'No pricing chosen')}
                        </span>
                    </div>
                    <div className="flex gap-2 sm:shrink-0">
                        <Button
                            variant="outline"
                            className="flex-1 sm:flex-none"
                            onClick={() => onOpenChange(false)}
                            disabled={saving}
                        >
                            {t('common.cancel', 'Cancel')}
                        </Button>
                        <Button className="flex-1 sm:flex-none" onClick={handleSave} disabled={saving || uploading}>
                            {saving
                                ? t('common.saving', 'Saving…')
                                : isEdit
                                  ? t('editor.saveChanges', 'Save changes')
                                  : t('editor.createPass', 'Create pass')}
                        </Button>
                    </div>
                </div>
            </DialogContent>
            <CreatePassPricingDialog
                open={pricingOpen}
                onOpenChange={setPricingOpen}
                onSaved={(option) => {
                    setCreatedOptions((prev) => [option, ...prev]);
                    setPaymentOptionId(option.id);
                }}
            />
        </Dialog>
    );
}
