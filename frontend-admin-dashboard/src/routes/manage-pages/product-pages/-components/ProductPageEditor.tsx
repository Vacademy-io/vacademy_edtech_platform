import { useParams, useNavigate } from '@tanstack/react-router';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { ArrowLeft, Save, AlertCircle, Copy, Check, Link, Activity, Link2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { BASE_URL_LEARNER_DASHBOARD } from '@/constants/urls';
import { useState, useMemo } from 'react';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { useProductPageEditor } from '../-hooks/use-product-page-editor';
import { CourseSessionSelector } from './CourseSessionSelector';
import { ProductPageSettingsCard } from './ProductPageSettingsCard';
import { CouponManager } from './CouponManager';
import { ProductPagePreview } from './ProductPagePreview';
import { MyButton } from '@/components/design-system/button';
import { PageDesignEditor } from './PageDesignEditor';
import { ProductPageCustomFieldsManager } from './ProductPageCustomFieldsManager';
import { CatalogueSyncPanel } from './CatalogueSyncPanel';
import { StorePageNotice } from './StorePageNotice';
import { distinctInviteCount } from '../-utils/store-page';
import { getTerminologyPlural } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

const TABS = [
    { id: 'design', label: 'Page Design' },
    { id: 'courses', label: 'Courses' },
    { id: 'settings', label: 'Settings' },
    { id: 'coupons', label: 'Coupons' },
    { id: 'custom-fields', label: 'Custom Fields' },
    { id: 'preview', label: 'Preview' },
] as const;

export const ProductPageEditor = () => {
    const { productPageId } = useParams({
        from: '/manage-pages/product-pages/editor/$productPageId',
    });
    const navigate = useNavigate();
    const { toast } = useToast();
    const instituteId = getCurrentInstituteId() || '';
    const { instituteDetails } = useInstituteDetailsStore();
    const [codeCopied, setCodeCopied] = useState(false);
    const [gtmOpen, setGtmOpen] = useState(false);
    const [utmOpen, setUtmOpen] = useState(false);
    const [utmFields, setUtmFields] = useState({ source: '', medium: '', campaign: '', term: '', content: '' });
    const [utmLinkCopied, setUtmLinkCopied] = useState(false);
    const [catalogueSyncing, setCatalogueSyncing] = useState(false);

    const {
        page,
        isLoading,
        name,
        status,
        settings,
        pageJson,
        mappingRows,
        isDirty,
        activeTab,
        setActiveTab,
        updateName,
        updateStatus,
        updateSettings,
        updatePageJson,
        addRow: _addRow,
        addRowWithData,
        updateRow,
        removeRow,
        moveRow,
        reorderRows,
        reseedMappings,
        save,
        isSaving,
        saveError,
    } = useProductPageEditor(productPageId);
    void _addRow; // unused — CourseSessionSelector uses addRowWithData directly

    const handleSave = () => {
        save(undefined, {
            onSuccess: () =>
                toast({ title: 'Saved', description: 'Product page saved successfully' }),
            onError: () =>
                toast({ title: 'Error', description: 'Failed to save', variant: 'destructive' }),
        });
    };

    const getLearnerUrl = () => {
        if (!page?.code) return '';
        const rawCustomDomain = instituteDetails?.learner_portal_base_url;
        if (rawCustomDomain) {
            const base = rawCustomDomain.startsWith('http')
                ? rawCustomDomain
                : `https://${rawCustomDomain}`;
            return `${base}/product-pages/${page.code}`;
        }
        return `${BASE_URL_LEARNER_DASHBOARD}/product-pages/${page.code}?instituteId=${instituteId}`;
    };

    const utmLink = useMemo(() => {
        const base = getLearnerUrl();
        if (!base) return '';
        const params = new URLSearchParams();
        if (utmFields.source)   params.set('utm_source', utmFields.source);
        if (utmFields.medium)   params.set('utm_medium', utmFields.medium);
        if (utmFields.campaign) params.set('utm_campaign', utmFields.campaign);
        if (utmFields.term)     params.set('utm_term', utmFields.term);
        if (utmFields.content)  params.set('utm_content', utmFields.content);
        const qs = params.toString();
        return qs ? `${base}&${qs}` : base;
    }, [utmFields, page?.code, settings?.defaultStep, instituteDetails?.learner_portal_base_url]);

    const copyCode = () => {
        const url = getLearnerUrl();
        if (!url) return;
        navigator.clipboard.writeText(url);
        setCodeCopied(true);
        setTimeout(() => setCodeCopied(false), 2000);
    };

    if (isLoading) {
        return (
            <div className="flex min-h-[60vh] items-center justify-center">
                <div className="size-8 animate-spin rounded-full border-4 border-neutral-200 border-t-primary-500" />
            </div>
        );
    }

    if (!page && !isLoading) {
        return (
            <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
                <AlertCircle className="size-10 text-neutral-400" />
                <p className="text-neutral-500">Product page not found.</p>
                <MyButton
                    buttonType="secondary"
                    scale="medium"
                    onClick={() => navigate({ to: '/manage-pages/product-pages' })}
                >
                    Back to list
                </MyButton>
            </div>
        );
    }

    return (
        <>
        <div className="flex h-[calc(100vh-3.5rem)] flex-col overflow-hidden md:h-[calc(100vh-4.5rem)]">
            {/* Top bar */}
            <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-neutral-200 bg-white px-6 py-3">
                <button
                    onClick={() => navigate({ to: '/manage-pages/product-pages' })}
                    className="flex items-center gap-1.5 text-sm text-neutral-500 transition-colors hover:text-neutral-700"
                >
                    <ArrowLeft className="size-4" />
                    Back
                </button>

                <div className="h-4 w-px bg-neutral-200" />

                {/* Name inline edit */}
                <Input
                    value={name}
                    onChange={(e) => updateName(e.target.value)}
                    className="h-8 max-w-xs border-transparent bg-transparent text-sm font-semibold text-neutral-800 shadow-none hover:border-neutral-200 focus:border-neutral-300"
                    placeholder="Page name"
                />

                {/* Shareable link badge */}
                {page?.code && (
                    <button
                        onClick={copyCode}
                        className="flex items-center gap-1.5 rounded-md border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-[11px] text-neutral-500 transition-colors hover:bg-neutral-100"
                        title="Copy shareable link"
                    >
                        {codeCopied ? (
                            <>
                                <Check className="size-3 text-success-600" />
                                <span className="font-medium text-success-600">Copied!</span>
                            </>
                        ) : (
                            <>
                                <span className="font-medium">Copy Link</span>
                                <Copy className="size-3 text-neutral-300" />
                            </>
                        )}
                    </button>
                )}

                {/* UTM Link generator button */}
                {page?.code && (
                    <button
                        onClick={() => setUtmOpen(true)}
                        className="flex items-center gap-1.5 rounded-md border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-[11px] text-neutral-500 transition-colors hover:bg-violet-50 hover:border-violet-300 hover:text-violet-600"
                        title="Generate UTM tracking link"
                    >
                        <Link2 className="size-3" />
                        <span className="font-medium">UTM Link</span>
                    </button>
                )}

                {/* GTM Events button */}
                <button
                    onClick={() => setGtmOpen(true)}
                    className="flex items-center gap-1.5 rounded-md border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-[11px] text-neutral-500 transition-colors hover:bg-emerald-50 hover:border-emerald-300 hover:text-emerald-600"
                    title="View GTM tracking events"
                >
                    <Activity className="size-3 " />
                    <span className="font-medium">GTM Events</span>
                </button>

                {/* Status toggle */}
                <select
                    value={status}
                    onChange={(e) => updateStatus(e.target.value as 'DRAFT' | 'ACTIVE')}
                    className="rounded-md border border-neutral-200 bg-white px-2 py-1 text-xs text-neutral-600 shadow-sm focus:border-primary-400 focus:outline-none focus:ring-1 focus:ring-primary-300"
                >
                    <option value="DRAFT">Draft</option>
                    <option value="ACTIVE">Active</option>
                </select>

                <div className="ml-auto flex items-center gap-2">
                    {isDirty && (
                        <span className="text-xs font-medium text-warning-600">
                            Unsaved changes
                        </span>
                    )}
                    {saveError && <span className="text-xs text-danger-600">Save failed</span>}
                    <MyButton
                        scale="small"
                        buttonType="primary"
                        onClick={handleSave}
                        disable={isSaving || !isDirty}
                    >
                        <Save className="size-3.5" />
                        {isSaving ? 'Saving...' : 'Save'}
                    </MyButton>
                </div>
            </div>

            {/* Tab bar */}
            <div className="flex shrink-0 items-center gap-0 border-b border-neutral-200 bg-white px-6">
                {TABS.map((tab) => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`border-b-2 px-5 py-3 text-sm font-medium transition-colors ${
                            activeTab === tab.id
                                ? 'border-primary-500 text-primary-600'
                                : 'border-transparent text-neutral-500 hover:text-neutral-700'
                        }`}
                    >
                        {tab.id === 'courses'
                            ? getTerminologyPlural(ContentTerms.Course, SystemTerms.Course)
                            : tab.label}
                    </button>
                ))}
            </div>

            {/* Tab content — design tab is full-height with no padding; others scroll */}
            {activeTab === 'design' ? (
                <div className="min-h-0 flex-1 overflow-hidden">
                    <PageDesignEditor pageJson={pageJson} onChange={updatePageJson} />
                </div>
            ) : (
                <div className="flex-1 overflow-auto p-6 lg:p-8">
                    {activeTab === 'courses' && (
                        <div className="mx-auto max-w-3xl">
                            <div className="mb-4">
                                <h2 className="text-sm font-semibold text-neutral-800">
                                    {getTerminologyPlural(ContentTerms.Course, SystemTerms.Course)}
                                </h2>
                                <p className="mt-0.5 text-xs text-neutral-500">
                                    Select package sessions to include. Each uses its default invite
                                    — you can change it per session.
                                </p>
                            </div>
                            <div className="mb-4">
                                <CatalogueSyncPanel
                                    productPageId={productPageId}
                                    instituteId={instituteId}
                                    productPageCode={page?.code}
                                    isDirty={isDirty}
                                    onSynced={reseedMappings}
                                    onRunningChange={setCatalogueSyncing}
                                />
                            </div>
                            {/* Locked while a catalogue sync runs: its result replaces these rows
                                (pointer-events also stops the session browser's clickable rows). */}
                            <fieldset
                                disabled={catalogueSyncing}
                                aria-busy={catalogueSyncing}
                                className="min-w-0 disabled:pointer-events-none disabled:opacity-60"
                            >
                                <CourseSessionSelector
                                    mappingRows={mappingRows}
                                    suggestions={pageJson?.suggestions ?? {}}
                                    onUpdateSuggestions={(s) =>
                                        updatePageJson({ ...pageJson, suggestions: s })
                                    }
                                    onAdd={addRowWithData}
                                    onUpdate={updateRow}
                                    onRemove={removeRow}
                                    onMove={moveRow}
                                    onReorder={reorderRows}
                                />
                            </fieldset>
                        </div>
                    )}

                    {activeTab === 'settings' && (
                        <div className="mx-auto max-w-2xl">
                            <ProductPageSettingsCard
                                settings={settings}
                                onChange={updateSettings}
                                courses={mappingRows}
                            />
                        </div>
                    )}

                    {activeTab === 'coupons' && (
                        <div className="mx-auto max-w-2xl">
                            <CouponManager productPageId={productPageId} />
                        </div>
                    )}

                    {activeTab === 'custom-fields' && (
                        <div className="mx-auto max-w-2xl">
                            <StorePageNotice
                                productPageCode={page?.code}
                                instituteId={instituteId}
                                inviteCount={distinctInviteCount(mappingRows)}
                            />
                            <ProductPageCustomFieldsManager
                                productPageId={productPageId}
                                instituteId={instituteId}
                            />
                        </div>
                    )}

                    {activeTab === 'preview' && (
                        <div className="mx-auto max-w-5xl">
                            <ProductPagePreview
                                productPageCode={page?.code || ''}
                                instituteId={instituteId}
                                learnerPortalBaseUrl={instituteDetails?.learner_portal_base_url}
                                preselectedCourseIds={mappingRows
                                    .filter((r) => r.preselected && r.packageSessionId)
                                    .map((r) => r.packageSessionId)}
                                defaultStep={settings?.defaultStep}
                            />
                        </div>
                    )}
                </div>
            )}
        </div>

        {/* UTM Link Generator Dialog */}
        <Dialog open={utmOpen} onOpenChange={(o) => { setUtmOpen(o); if (!o) setUtmLinkCopied(false); }}>
            <DialogContent className="w-[90vw] max-w-lg">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Link2 className="size-4 text-violet-500" />
                        UTM Link Generator
                    </DialogTitle>
                    <p className="text-xs text-neutral-400 mt-0.5">Build a trackable link for this product page.</p>
                </DialogHeader>

                <div className="space-y-3">
                    {([
                        { key: 'source',   label: 'Source',   placeholder: 'facebook, google, newsletter…', required: true },
                        { key: 'medium',   label: 'Medium',   placeholder: 'cpc, email, social…',           required: true },
                        { key: 'campaign', label: 'Campaign', placeholder: 'summer_sale, launch…',          required: true },
                        { key: 'term',     label: 'Term',     placeholder: 'keyword (optional)',             required: false },
                        { key: 'content',  label: 'Content',  placeholder: 'banner_v1 (optional)',          required: false },
                    ] as const).map(({ key, label, placeholder, required }) => (
                        <div key={key} className="grid grid-cols-[80px_1fr] items-center gap-3">
                            <Label className="text-xs font-medium text-neutral-600 text-right">
                                {label}{required && <span className="ml-0.5 text-danger-500">*</span>}
                            </Label>
                            <Input
                                placeholder={placeholder}
                                value={utmFields[key]}
                                onChange={(e) => setUtmFields((p) => ({ ...p, [key]: e.target.value.trim() }))}
                                className="h-8 text-xs"
                            />
                        </div>
                    ))}
                </div>

                {/* Generated URL preview */}
                <div className="mt-1 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
                    <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-400">Generated URL</p>
                    <p className="break-all font-mono text-[11px] text-neutral-600 leading-relaxed">
                        {utmLink || <span className="text-neutral-300">Fill in the fields above…</span>}
                    </p>
                </div>

                <button
                    disabled={!utmLink}
                    onClick={() => {
                        navigator.clipboard.writeText(utmLink);
                        setUtmLinkCopied(true);
                        setTimeout(() => setUtmLinkCopied(false), 2000);
                    }}
                    className={`flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                        utmLinkCopied
                            ? 'bg-success-500 text-white'
                            : 'bg-violet-600 text-white hover:bg-violet-700'
                    }`}
                >
                    {utmLinkCopied ? <><Check className="size-4" /> Copied!</> : <><Copy className="size-4" /> Copy UTM Link</>}
                </button>
            </DialogContent>
        </Dialog>

        {/* GTM Events Dialog */}
        <Dialog open={gtmOpen} onOpenChange={setGtmOpen}>
            <DialogContent className="w-[90vw] max-w-5xl">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Activity className="size-4 text-emerald-500" />
                        GTM Tracking Events
                    </DialogTitle>
                    <p className="text-xs text-neutral-400 mt-1">
                        These events are pushed to <code className="rounded bg-neutral-100 px-1">window.dataLayer</code> automatically.
                        GTM container ID is configured in <strong>Settings → GTM Settings</strong>.
                    </p>
                </DialogHeader>

                <div className="max-h-[60vh] overflow-y-auto space-y-2 pr-1">
                    {([
                        { event: 'product_page_view', trigger: 'Page loads', params: 'page_code, default_step, utm_*' },
                        { event: 'product_page_course_selection_changed', trigger: 'Course selected / deselected', params: 'selected_count, total_amount' },
                        { event: 'product_page_cart_viewed', trigger: 'Cart step shown', params: 'selected_courses[], total_amount, utm_*' },
                        { event: 'product_page_coupon_applied', trigger: 'Coupon code applied', params: 'coupon_code, discount_amount' },
                        { event: 'product_page_tnc_accepted', trigger: 'T&C accepted', params: '—' },
                        { event: 'product_page_payment_initiated', trigger: 'Pay Now clicked', params: 'total_amount, course_count, vendor, utm_*' },
                        { event: 'product_page_enrollment_success', trigger: 'Payment confirmed & enrolled', params: 'total_amount, course_count, utm_*' },
                        { event: 'product_page_payment_failed', trigger: 'Payment / enrollment error', params: 'error_message, vendor, utm_*' },
                    ] as const).map(({ event, trigger, params }) => (
                        <div key={event} className="flex items-start justify-between gap-4 rounded-lg border border-neutral-100 bg-neutral-50 px-4 py-3">
                            <div className="min-w-0 flex-1">
                                <code className="block rounded bg-emerald-50 px-2 py-0.5 font-mono text-[11px] font-medium text-emerald-700 w-fit">
                                    {event}
                                </code>
                                <p className="mt-1.5 font-mono text-[10px] text-neutral-400">{params}</p>
                            </div>
                            <span className="shrink-0 text-xs text-neutral-500">{trigger}</span>
                        </div>
                    ))}
                </div>
            </DialogContent>
        </Dialog>
        </>
    );
};
