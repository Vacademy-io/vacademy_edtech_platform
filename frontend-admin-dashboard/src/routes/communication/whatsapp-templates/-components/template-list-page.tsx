import { useEffect, useState, type ReactNode } from 'react';
import { TemplatesEnhancedCounts, type TemplateStatusView } from './TemplatesEnhancedCounts';
import { useTranslation } from 'react-i18next';
import {
    Plus,
    ArrowClockwise,
    Trash,
    PaperPlaneRight,
    PencilSimple,
    ArrowSquareOut,
    Info,
    WarningCircle,
    BracketsCurly,
    CaretDown,
    CaretUp,
    EnvelopeSimple,
    HandTap,
    ImageSquare,
    ChatTeardropText,
    MagnifyingGlass,
    X,
} from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { MyButton } from '@/components/design-system/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { getInstituteId } from '@/constants/helper';
import { reportApiError } from '@/lib/report-api-error';
import { listTemplates, deleteTemplate, submitToMeta, syncTemplates, WhatsAppTemplateDTO } from '../-services/template-api';
import { getWhatsAppProviderStatus } from '@/services/whatsapp-provider-service';
import { SettingsQuickAccessButton } from '@/components/settings/quick-access/SettingsQuickAccessButton';
import { SettingsTabs } from '@/routes/settings/-constants/terms';
import { TemplateBuilder } from './template-builder';
import { WhatsAppTemplateBubble } from './whatsapp-template-bubble';

export function TemplateListPage() {
    const { t } = useTranslation('communicationTemplateListPage');
    const [templates, setTemplates] = useState<WhatsAppTemplateDTO[]>([]);
    const [loading, setLoading] = useState(true);
    const [syncing, setSyncing] = useState(false);
    const [editingTemplate, setEditingTemplate] = useState<WhatsAppTemplateDTO | null>(null);
    const [isCreating, setIsCreating] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [activeProvider, setActiveProvider] = useState<string>('');
    const [channelFilter, setChannelFilter] = useState<'ALL' | 'WHATSAPP' | 'EMAIL'>('ALL');
    // Client-side views over the loaded list (no extra requests).
    const [statusFilter, setStatusFilter] = useState<TemplateStatusView>('ALL');
    const [categoryFilter, setCategoryFilter] = useState<string>(ANY);
    const [languageFilter, setLanguageFilter] = useState<string>(ANY);
    // Language labels live with the builder's language picker.
    const { t: tBuilder } = useTranslation('communicationTemplateBuilder');
    const instituteId = getInstituteId() || '';

    // Meta/COMBOT can create templates via API; WATI must use WATI dashboard
    const canCreateViaApi = activeProvider === 'META' || activeProvider === 'COMBOT' || activeProvider === '';

    const [loadError, setLoadError] = useState<string | null>(null);

    const loadTemplates = async () => {
        setLoading(true);
        try {
            const data = await listTemplates(instituteId);
            setTemplates(data);
            setLoadError(null);
        } catch (err) {
            // Keep the reason on screen, not just in a toast that disappears — an empty list with
            // no explanation reads as "you have no templates", which is a different problem.
            setLoadError(
                reportApiError(err, {
                    feature: 'whatsapp-template-list',
                    fallbackMessage: t('couldNotLoadTemplates'),
                })
            );
        } finally { setLoading(false); }
    };

    useEffect(() => {
        loadTemplates();
        getWhatsAppProviderStatus()
            .then((status) => setActiveProvider(status.activeProvider || ''))
            .catch(() => {});
    }, []);

    const providerLabel = activeProvider === 'WATI' ? 'WATI' : 'Meta';

    const handleSync = async () => {
        setSyncing(true);
        try {
            const result = await syncTemplates(instituteId);
            toast.success(
                result.synced > 0
                    ? t('syncedCount', { count: result.synced, provider: providerLabel })
                    : t('noTemplatesForAccount', { provider: providerLabel })
            );
            loadTemplates();
        } catch (err) {
            // Almost always an expired token or missing credentials — the server now says which.
            reportApiError(err, {
                feature: 'whatsapp-template-sync',
                fallbackMessage: t('couldNotSyncTemplates', { provider: providerLabel }),
            });
        } finally { setSyncing(false); }
    };

    const handleDelete = async (tpl: WhatsAppTemplateDTO) => {
        const warning = tpl.status === 'APPROVED' || tpl.status === 'PENDING'
            ? t('deleteConfirmLive', { name: tpl.name, provider: providerLabel })
            : t('deleteConfirmDraft', { name: tpl.name });
        if (!confirm(warning)) return;
        try {
            await deleteTemplate(tpl.id!);
            toast.success(t('templateDeleted'));
            loadTemplates();
        } catch (err) {
            reportApiError(err, {
                feature: 'whatsapp-template-delete',
                fallbackMessage: t('couldNotDeleteTemplate', { name: tpl.name }),
            });
        }
    };

    const handleSubmit = async (id: string) => {
        try {
            const submitted = await submitToMeta(id);
            toast.success(
                submitted.status === 'APPROVED'
                    ? t('approvedByMeta')
                    : t('submittedForApproval')
            );
            loadTemplates();
        } catch (err) {
            reportApiError(err, {
                feature: 'whatsapp-template-submit',
                fallbackMessage: t('metaRejectedTemplate'),
                toastDuration: 8000,
            });
        }
    };

    const handleBuilderClose = () => {
        setEditingTemplate(null);
        setIsCreating(false);
        loadTemplates();
    };

    // Show builder if creating or editing
    if (isCreating || editingTemplate) {
        return <TemplateBuilder template={editingTemplate} onClose={handleBuilderClose} />;
    }

    const statusBadge = (status: string) => {
        const styles: Record<string, string> = {
            DRAFT: 'bg-neutral-100 text-neutral-600',
            PENDING: 'bg-warning-50 text-warning-700',
            APPROVED: 'bg-success-50 text-success-700',
            REJECTED: 'bg-danger-50 text-danger-600',
            DISABLED: 'bg-warning-100 text-warning-700',
            DELETED: 'bg-neutral-200 text-neutral-400',
        };
        const labels: Record<string, string> = {
            DRAFT: t('status.draft'),
            PENDING: t('status.pending'),
            APPROVED: t('status.approved'),
            REJECTED: t('status.rejected'),
            DISABLED: t('status.disabled'),
            DELETED: t('status.deleted'),
        };
        return (
            <span
                className={cn(
                    'inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold',
                    styles[status] || styles.DRAFT
                )}
            >
                <span className="size-1.5 rounded-full bg-current" aria-hidden />
                <span className="text-caption">{labels[status] || status}</span>
            </span>
        );
    };

    const categoryBadge = (cat: string) => {
        const styles: Record<string, string> = {
            MARKETING: 'bg-primary-50 text-primary-600',
            UTILITY: 'bg-info-50 text-info-600',
            AUTHENTICATION: 'bg-neutral-100 text-neutral-700',
        };
        const labels: Record<string, string> = {
            MARKETING: t('category.marketing'),
            UTILITY: t('category.utility'),
            AUTHENTICATION: t('category.authentication'),
        };
        return (
            <span
                className={cn(
                    'rounded-md px-1.5 py-0.5 font-medium',
                    styles[cat] || 'bg-neutral-50 text-neutral-500'
                )}
            >
                <span className="text-caption">{labels[cat] || cat}</span>
            </span>
        );
    };

    const filtered = templates.filter(
        (t) =>
            t.status !== 'DELETED' &&
            (channelFilter === 'ALL' || (t.channelType || 'WHATSAPP') === channelFilter) &&
            (statusFilter === 'ALL' || (t.status || 'DRAFT') === statusFilter) &&
            (categoryFilter === ANY || t.category === categoryFilter) &&
            (languageFilter === ANY || t.language === languageFilter) &&
            (t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                (t.bodyText || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
                (t.subject || '').toLowerCase().includes(searchQuery.toLowerCase()))
    );
    // Only the languages the loaded templates actually use.
    const languageOptions = Array.from(
        new Set(
            templates.filter((x) => x.status !== 'DELETED' && x.language).map((x) => x.language)
        )
    ).sort();
    const filtersActive =
        searchQuery !== '' ||
        channelFilter !== 'ALL' ||
        statusFilter !== 'ALL' ||
        categoryFilter !== ANY ||
        languageFilter !== ANY;
    const clearFilters = () => {
        setSearchQuery('');
        setChannelFilter('ALL');
        setStatusFilter('ALL');
        setCategoryFilter(ANY);
        setLanguageFilter(ANY);
    };

    return (
        <div className="mx-auto w-full max-w-7xl p-4 sm:p-6">
            {/* Page header */}
            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-500">
                        <ChatTeardropText size={20} weight="duotone" />
                    </span>
                    <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                            <h1 className="font-semibold text-neutral-900">
                                <span className="text-h3">{t('pageTitle')}</span>
                            </h1>
                            {activeProvider && (
                                <span className="rounded-full bg-success-50 px-2 py-0.5 text-caption font-medium text-success-700">
                                    {t('providerChip', { provider: providerLabel })}
                                </span>
                            )}
                        </div>
                        <p className="text-neutral-500">
                            <span className="text-caption">
                                {canCreateViaApi ? t('subtitleApi') : t('subtitleWati')}
                            </span>
                        </p>
                    </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <SettingsQuickAccessButton
                        settingsKey={SettingsTabs.WhatsApp}
                        label={t('whatsappSettings')}
                    />
                    <MyButton
                        buttonType="secondary"
                        scale="medium"
                        onClick={handleSync}
                        disable={syncing}
                        className="gap-1.5 sm:min-w-0"
                    >
                        <ArrowClockwise size={16} className={syncing ? 'animate-spin' : ''} />
                        {syncing ? t('syncing') : t('syncTemplates')}
                    </MyButton>

                    {canCreateViaApi ? (
                        <MyButton
                            buttonType="primary"
                            scale="medium"
                            onClick={() => setIsCreating(true)}
                            className="gap-1.5 sm:min-w-0"
                        >
                            <Plus size={16} /> {t('createTemplate')}
                        </MyButton>
                    ) : (
                        <a
                            href="https://app.wati.io/template-messages"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex h-9 items-center gap-1.5 rounded-md bg-primary-500 px-3 text-body font-semibold text-neutral-50 hover:bg-primary-400"
                        >
                            <ArrowSquareOut size={16} /> {t('createInWati')}
                        </a>
                    )}
                </div>
            </div>

            {/* Provider info banner */}
            {activeProvider === 'WATI' && (
                <div className="mb-4 flex items-start gap-2 rounded-xl border border-info-100 bg-info-50 p-3">
                    <Info size={18} className="mt-0.5 shrink-0 text-info-600" />
                    <div className="text-caption text-neutral-700">
                        <p className="font-semibold text-neutral-800">{t('watiBanner.title')}</p>
                        <p className="mt-0.5">
                            {t('watiBanner.beforeLink')}{' '}
                            <a
                                href="https://app.wati.io/template-messages"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-medium text-info-600 underline"
                            >
                                {t('watiBanner.linkText')}
                            </a>
                            {t('watiBanner.afterLink')}
                        </p>
                    </div>
                </div>
            )}

            {/* Status counts — click one to show only those templates. */}
            <TemplatesEnhancedCounts
                statuses={templates.map((x) => x.status ?? 'DRAFT')}
                active={statusFilter}
                onSelect={setStatusFilter}
            />

            {/* Toolbar: search + channel / category / language over the loaded list */}
            <div className="mb-4 flex flex-col gap-2 rounded-xl border border-neutral-200 bg-white p-3 lg:flex-row lg:items-center">
                <div className="relative min-w-0 flex-1">
                    <MagnifyingGlass
                        size={16}
                        className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400"
                    />
                    <Input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder={t('searchPlaceholder')}
                        className="h-9 pl-9"
                    />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <div className="flex rounded-lg border border-neutral-200 bg-neutral-50 p-0.5">
                        {(['ALL', 'WHATSAPP', 'EMAIL'] as const).map((tab) => (
                            <button
                                key={tab}
                                type="button"
                                onClick={() => setChannelFilter(tab)}
                                aria-pressed={channelFilter === tab}
                                className={cn(
                                    'rounded-md px-3 py-1 text-xs font-medium transition',
                                    channelFilter === tab
                                        ? 'bg-white text-primary-600 shadow-sm'
                                        : 'text-neutral-500 hover:text-neutral-700'
                                )}
                            >
                                {tab === 'ALL'
                                    ? t('tabAll')
                                    : tab === 'WHATSAPP'
                                      ? t('tabWhatsapp')
                                      : t('tabEmail')}
                            </button>
                        ))}
                    </div>
                    <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                        <SelectTrigger
                            className="h-9 w-44 bg-white text-xs"
                            aria-label={t('filters.allCategories')}
                        >
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value={ANY}>{t('filters.allCategories')}</SelectItem>
                            <SelectItem value="MARKETING">{t('category.marketing')}</SelectItem>
                            <SelectItem value="UTILITY">{t('category.utility')}</SelectItem>
                            <SelectItem value="AUTHENTICATION">
                                {t('category.authentication')}
                            </SelectItem>
                        </SelectContent>
                    </Select>
                    <Select value={languageFilter} onValueChange={setLanguageFilter}>
                        <SelectTrigger
                            className="h-9 w-44 bg-white text-xs"
                            aria-label={t('filters.allLanguages')}
                        >
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value={ANY}>{t('filters.allLanguages')}</SelectItem>
                            {languageOptions.map((code) => (
                                <SelectItem key={code} value={code}>
                                    {tBuilder(`languages.${code}`, { defaultValue: code })}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    {filtersActive && (
                        <button
                            type="button"
                            onClick={clearFilters}
                            className="flex items-center gap-1 rounded-md px-2 py-1 text-caption font-medium text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700"
                        >
                            <X size={12} /> {t('filters.clear')}
                        </button>
                    )}
                </div>
            </div>

            {loading ? (
                <div
                    className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
                    aria-label={t('loadingTemplates')}
                >
                    {Array.from({ length: 6 }).map((_, i) => (
                        <Skeleton key={i} className="h-56 rounded-xl" />
                    ))}
                </div>
            ) : loadError ? (
                <div className="flex flex-col items-center gap-3 rounded-xl border border-danger-200 bg-danger-50 py-10 text-center">
                    <WarningCircle size={24} className="text-danger-600" />
                    <p className="max-w-md px-4 text-sm text-danger-600">{loadError}</p>
                    <MyButton
                        buttonType="secondary"
                        scale="medium"
                        onClick={loadTemplates}
                        className="bg-white"
                    >
                        {t('tryAgain')}
                    </MyButton>
                </div>
            ) : filtered.length === 0 ? (
                <div className="flex flex-col items-center rounded-xl border border-dashed border-neutral-200 bg-white px-4 py-12 text-center">
                    <span className="mb-3 flex size-12 items-center justify-center rounded-full bg-neutral-50 text-neutral-300">
                        <ChatTeardropText size={28} weight="duotone" />
                    </span>
                    <p className="mb-4 text-neutral-500">
                        {templates.length === 0
                            ? t('noTemplatesYet', { provider: providerLabel })
                            : t('noTemplatesMatchSearch')}
                    </p>
                    {templates.length === 0 && canCreateViaApi ? (
                        <MyButton
                            buttonType="primary"
                            scale="medium"
                            onClick={() => setIsCreating(true)}
                            className="gap-1.5"
                        >
                            <Plus size={16} /> {t('createTemplate')}
                        </MyButton>
                    ) : filtersActive ? (
                        <MyButton buttonType="secondary" scale="medium" onClick={clearFilters}>
                            {t('filters.clear')}
                        </MyButton>
                    ) : null}
                </div>
            ) : (
                <>
                    <p className="mb-2 text-caption text-neutral-500">
                        {t('resultsCount', { count: filtered.length })}
                    </p>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                        {filtered.map((tpl) => (
                            <TemplateCard
                                key={tpl.id}
                                tpl={tpl}
                                statusBadge={statusBadge(tpl.status || 'DRAFT')}
                                categoryBadge={categoryBadge(tpl.category)}
                                canEdit={
                                    canCreateViaApi &&
                                    (tpl.status === 'DRAFT' || tpl.status === 'REJECTED')
                                }
                                onEdit={() => setEditingTemplate(tpl)}
                                onSubmit={() => handleSubmit(tpl.id!)}
                                onDelete={() => handleDelete(tpl)}
                            />
                        ))}
                    </div>
                    {canCreateViaApi && (
                        <p className="mt-4 flex items-start gap-2 rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-caption text-neutral-600">
                            <Info size={14} className="mt-0.5 shrink-0 text-neutral-400" />
                            {t('actionsNote')}
                        </p>
                    )}
                </>
            )}
        </div>
    );
}

/** Select value for "no filter" (Radix Select can't use an empty string). */
const ANY = '__any__';

const PLACEHOLDER_TOKEN = /\{\{\s*[\w.]+\s*\}\}/g;

/**
 * One template as a card: name and status on top, the message the way the learner sees it in the
 * middle (long bodies folded), and what it carries — header, variables, buttons — at the bottom.
 */
function TemplateCard({
    tpl,
    statusBadge,
    categoryBadge,
    canEdit,
    onEdit,
    onSubmit,
    onDelete,
}: {
    tpl: WhatsAppTemplateDTO;
    statusBadge: ReactNode;
    categoryBadge: ReactNode;
    canEdit: boolean;
    onEdit: () => void;
    onSubmit: () => void;
    onDelete: () => void;
}) {
    const { t } = useTranslation('communicationTemplateListPage');
    const [expanded, setExpanded] = useState(false);
    const isWhatsApp = (tpl.channelType || 'WHATSAPP') === 'WHATSAPP';
    const body = tpl.bodyText || '';
    const isLong = body.split('\n').length > 6 || body.length > 260;
    const variableCount = new Set(`${tpl.headerText || ''} ${body}`.match(PLACEHOLDER_TOKEN) || []).size;
    const buttonCount = tpl.buttons?.length || 0;
    const headerType = (tpl.headerType || 'NONE').toUpperCase();
    // Meta sends the literal "NONE" when nothing was rejected.
    const rejection =
        tpl.rejectionReason && tpl.rejectionReason.trim().toUpperCase() !== 'NONE' ? tpl.rejectionReason : null;

    const chip = 'flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-caption text-neutral-600';

    return (
        <div className="flex flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm transition hover:border-primary-200 hover:shadow-md">
            {/* Name + status */}
            <div className="flex items-start justify-between gap-2 border-b border-neutral-100 px-4 py-3">
                <div className="min-w-0">
                    <p className="break-all font-mono text-body font-semibold text-neutral-800">
                        {tpl.name}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        {statusBadge}
                        {categoryBadge}
                        <span className="font-mono text-caption text-neutral-400">
                            {tpl.language}
                        </span>
                        {!isWhatsApp && (
                            <span className="flex items-center gap-1 text-caption text-neutral-500">
                                <EnvelopeSimple size={12} /> {t('tabEmail')}
                            </span>
                        )}
                    </div>
                </div>
                <div className="flex shrink-0 items-center">
                    {canEdit && (
                        <>
                            <button onClick={onEdit} title={t('edit')} className="rounded p-2 hover:bg-muted">
                                <PencilSimple size={16} className="text-neutral-500" />
                            </button>
                            <button onClick={onSubmit} title={t('submitToMeta')} className="rounded p-2 hover:bg-muted">
                                <PaperPlaneRight size={16} className="text-info-600" />
                            </button>
                        </>
                    )}
                    <button onClick={onDelete} title={t('delete')} className="rounded p-2 hover:bg-danger-50">
                        <Trash size={16} className="text-danger-500" />
                    </button>
                </div>
            </div>

            {/* The message as it arrives */}
            <div className={cn('flex flex-1 flex-col p-3', isWhatsApp ? 'bg-success-50' : 'bg-muted')}>
                {isWhatsApp ? (
                    <WhatsAppTemplateBubble
                        headerType={tpl.headerType}
                        headerText={tpl.headerText}
                        headerSampleUrl={tpl.headerSampleUrl}
                        bodyText={body}
                        footerText={tpl.footerText}
                        buttons={tpl.buttons}
                        clampBody={isLong && !expanded}
                        className="max-w-sm"
                    />
                ) : (
                    <div className="rounded-lg bg-card p-3 shadow-sm">
                        {tpl.subject && <p className="mb-1 text-body font-semibold text-neutral-800">{tpl.subject}</p>}
                        <p className={cn('whitespace-pre-wrap break-words text-caption text-neutral-600', !expanded && 'line-clamp-6')}>
                            {body}
                        </p>
                    </div>
                )}
                {isLong && (
                    <button
                        onClick={() => setExpanded((v) => !v)}
                        className="mt-2 flex items-center gap-1 self-start text-caption font-semibold text-info-600 hover:underline"
                    >
                        {expanded ? <CaretUp size={12} /> : <CaretDown size={12} />}
                        {expanded
                            ? t('showLess', { defaultValue: 'Show less' })
                            : t('showFullMessage', { defaultValue: 'Show full message' })}
                    </button>
                )}
            </div>

            {rejection && (
                <p className="border-t bg-danger-50 px-4 py-2 text-caption text-danger-600">
                    {t('rejectionReason', { reason: rejection })}
                </p>
            )}

            {/* What it carries */}
            {isWhatsApp && (headerType !== 'NONE' || variableCount > 0 || buttonCount > 0) && (
                <div className="flex flex-wrap gap-1.5 border-t px-4 py-2">
                    {headerType !== 'NONE' && (
                        <span className={chip}>
                            <ImageSquare size={12} />
                            {t('summary.header', {
                                type: t(`summary.headerType.${headerType.toLowerCase()}`, { defaultValue: headerType }),
                                defaultValue: '{{type}} header',
                            })}
                        </span>
                    )}
                    {variableCount > 0 && (
                        <span className={chip}>
                            <BracketsCurly size={12} />
                            {t('summary.variables', { count: variableCount, defaultValue: variableCount === 1 ? '{{count}} variable' : '{{count}} variables' })}
                        </span>
                    )}
                    {buttonCount > 0 && (
                        <span className={chip}>
                            <HandTap size={12} />
                            {t('summary.buttons', { count: buttonCount, defaultValue: buttonCount === 1 ? '{{count}} button' : '{{count}} buttons' })}
                        </span>
                    )}
                </div>
            )}
        </div>
    );
}
