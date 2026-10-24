import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { MyButton } from '@/components/design-system/button';
import { toast } from 'sonner';
import {
    Globe,
    Shield,
    CheckCircle2,
    AlertCircle,
    ExternalLink,
    Loader2,
    RefreshCw,
    Info,
    LinkIcon,
    TableIcon,
    Plus,
    Trash2,
    Star,
    Copy,
} from 'lucide-react';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { RoleTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import {
    ChevronDown,
    ChevronUp,
    Palette,
    KeyRound,
    Route,
    Link2,
    Upload,
    Pencil,
    Phone
} from 'lucide-react';
import PreferredCountriesSelector from './PreferredCountriesSelector';
import { SearchableSelect } from '@/components/design-system/searchable-select';
import { getSubOrgs } from '@/routes/manage-custom-teams/-services/custom-team-services';
import {
    parsePreferredCountriesString,
    stringifyPreferredCountries,
    countryCodeToFlag,
} from '../-utils/countries';
import PhoneCountryGeoModeField from './PhoneCountryGeoModeField';
import GoogleSignInBrandingCard from './GoogleSignInBrandingCard';
import {
    DEFAULT_PHONE_COUNTRY_GEO_MODE,
    PHONE_COUNTRY_GEO_MODES,
    type PhoneCountryGeoMode,
} from '@/services/domain-routing';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { WHITE_LABEL_SETUP, WHITE_LABEL_STATUS } from '@/constants/urls';
import { getInstituteId } from '@/constants/helper';
import { copyTextToClipboard } from '@/lib/clipboard';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { UploadFileInS3Public } from '@/routes/signup/-services/signup-services';
import { useFileUpload } from '@/hooks/use-file-upload';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';

// ─── Types ────────────────────────────────────────────────────────────────────

interface DnsRecordResult {
    type: string;
    name: string;
    target: string;
    proxied: boolean;
    cloudflare_record_id: string;
    action: string;
}

interface PagesDomainResult {
    project: string;
    name: string;
    status: string;
    action: string;
    pages_cname_target: string;
}

interface WhiteLabelSetupResponse {
    setup_complete: boolean;
    learner_portal_url: string;
    admin_portal_url: string;
    teacher_portal_url: string;
    dns_records_configured: DnsRecordResult[];
    pages_domains_configured?: PagesDomainResult[];
    warnings: string[];
}

interface RoutingConfig {
    redirect?: string;
    privacy_policy_url?: string;
    terms_and_condition_url?: string;
    after_login_route?: string;
    admin_portal_after_logout_route?: string;
    home_icon_click_route?: string;
    theme?: string;
    tab_text?: string;
    allow_signup?: boolean;
    tab_icon_file_id?: string;
    font_family?: string;
    allow_google_auth?: boolean;
    allow_github_auth?: boolean;
    allow_email_otp_auth?: boolean;
    allow_phone_auth?: boolean;
    allow_username_password_auth?: boolean;
    convert_username_password_to_lowercase?: boolean;
    play_store_app_link?: string;
    app_store_app_link?: string;
    windows_app_link?: string;
    mac_app_link?: string;
    /**
     * Comma-separated ISO 3166-1 alpha-2 country codes (e.g. "in,us,gb,au").
     * The first entry becomes the default country in phone inputs across the
     * learner and admin dashboards. The full ordered list determines the order
     * of the country picker dropdown.
     */
    comma_separated_preferred_country?: string;
    /**
     * Decides whether the list above is the last word, or whether the country a
     * form is actually being opened from may override it. One of
     * PHONE_COUNTRY_GEO_MODES; undefined behaves as INSTITUTE_FIRST.
     */
    phone_country_geo_mode?: string;
    /**
     * When true, the institute name is hidden wherever the logo is rendered
     * (login page, sidebar header). Useful when the logo already contains the
     * institute name. Default (undefined / false): name is shown as before.
     */
    hide_institute_name?: boolean;
    /**
     * Optional explicit logo width in pixels. When set, overrides the default
     * responsive logo sizing in the sidebar and login page. Leave unset to
     * preserve existing behavior. 250+ (the panel width) COMBINED WITH a blank
     * logo_height_px makes the sidebar logo full-bleed: the header padding is
     * dropped and the logo spans all 250px, scaling by width alone.
     */
    logo_width_px?: number;
    /**
     * Optional explicit logo height in pixels. When set, the logo is fitted
     * (object-contain) inside the width × height box — which also opts the
     * sidebar out of full-bleed, since fitting a fixed height would letterbox
     * the logo back down. Leave unset to scale proportionally to the width.
     */
    logo_height_px?: number;
    /**
     * When true, the institute name is rendered stacked BELOW the logo (centered
     * vertical) instead of to its right, in the sidebar header. Default
     * (undefined / false): name sits beside the logo, as before.
     */
    stack_name_below_logo?: boolean;
    /**
     * Sub-organisation this domain serves. Not styling — the routing row's
     * institute stays the PARENT, so this id is the only thing that tells one
     * sub-org's portal from another's. It drives the logo/name/theme overlay AND
     * the login scoping in loginFlowHandler.
     *
     * Null or omitted leaves an existing mapping alone; '' clears it.
     */
    sub_org_id?: string | null;
}

/**
 * How often, and how many times, the settings page re-asks the server whether a
 * pending domain has gone live. ~10 minutes covers the common in-zone case
 * (Cloudflare provisions a *.vacademy.io host in under a minute) without
 * hammering the Cloudflare API on behalf of an external domain whose owner has
 * not added their CNAME yet — that one is picked up on the next page visit.
 */
/**
 * Radix's Select refuses an empty-string item value, so "not linked" needs a
 * sentinel. It maps back to '' on submit, which is what the backend reads as
 * "clear the link" — an omitted field means "leave it alone" instead.
 */
const NO_SUB_ORG = '__none__';

/** Sub-org list rows come back under several field spellings depending on endpoint. */
type RawSubOrg = Record<string, unknown>;

interface SubOrgOption {
    id: string;
    /** Absent when the row carries no name — the label is resolved at render. */
    name?: string;
}

const firstString = (org: RawSubOrg | undefined, keys: string[]): string | undefined => {
    for (const key of keys) {
        const value = org?.[key];
        if (typeof value === 'string' && value.trim()) return value;
    }
    return undefined;
};

/**
 * Deliberately does NOT resolve a fallback label. This runs inside a fetch
 * effect, and calling `t()` there without `t` in the dependency array freezes
 * whatever the catalog held at that moment — which, before the lazy namespace
 * lands, is the raw key. The label is resolved at render instead.
 */
const normaliseSubOrg = (org: RawSubOrg | undefined): SubOrgOption | null => {
    const id = firstString(org, ['sub_org_id', 'suborgId', 'subOrgId', 'suborg_id', 'id']);
    if (!id) return null;
    return {
        id,
        name: firstString(org, ['name', 'institute_name', 'instituteName', 'subOrgName']),
    };
};

const ACTIVATION_POLL_INTERVAL_MS = 30_000;
const MAX_ACTIVATION_POLLS = 20;

// UI-enforced caps so operators can't enter values that break the layout.
export const LOGO_DIMENSION_LIMITS = {
    minPx: 16,
    maxWidthPx: 400,
    maxHeightPx: 200,
} as const;

interface RoutingEntry extends RoutingConfig {
    id: string;
    role: string;
    domain: string;
    subdomain: string;
    /** Live Cloudflare Pages custom-domain status: active / pending / initializing / … */
    pages_status?: string | null;
    /** CNAME target (<project>.pages.dev) the customer must point an external domain at. */
    pages_cname_target?: string | null;
    /**
     * The admin picked this host as the portal URL for the roles it serves. An
     * intent — it only becomes `is_portal_url` once Cloudflare activates the host.
     */
    is_primary?: boolean;
    /**
     * This host is what the institute's <role>_portal_base_url actually holds, i.e.
     * the domain outbound learner emails use right now.
     */
    is_portal_url?: boolean;
}

interface WhiteLabelStatusResponse {
    cloudflare_enabled: boolean;
    is_configured: boolean;
    domain_type: string | null;
    learner_portal_url: string | null;
    admin_portal_url: string | null;
    teacher_portal_url: string | null;
    /** Roles whose portal URL the server adopted during THIS read, because the chosen host had just gone live. */
    roles_adopted_now?: string[];
    routing_entries: RoutingEntry[];
}

/** A single row in the setup form */
interface DomainFormEntry {
    id: string;
    role: 'LEARNER' | 'ADMIN' | 'TEACHER';
    domain: string;
    isPrimary: boolean;
    expanded: boolean;
    config: RoutingConfig;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ROLES = ['LEARNER', 'ADMIN', 'TEACHER'] as const;

const roleLabel = (role: string, t: (key: string) => string): string => {
    switch (role?.toUpperCase()) {
        case 'LEARNER': return t('roles.learnerPortal');
        case 'ADMIN':   return t('roles.adminPortal');
        case 'TEACHER': return t('roles.teacherPortal');
        default:        return role;
    }
};

const roleBadgeClass = (role: string): string => {
    switch (role?.toUpperCase()) {
        case 'LEARNER': return 'border-green-200 bg-green-50 text-green-700';
        case 'ADMIN':   return 'border-orange-200 bg-orange-50 text-orange-700';
        case 'TEACHER': return 'border-purple-200 bg-purple-50 text-purple-700';
        default:        return '';
    }
};

const fqdn = (entry: RoutingEntry): string => {
    if (!entry.subdomain || entry.subdomain === '*') return entry.domain;
    return `${entry.subdomain}.${entry.domain}`;
};

// ─── Short-link domain ────────────────────────────────────────────────────────

/**
 * The zone we own. A portal on `*.vacademy.io` needs no short-link record from
 * anyone — those links already run on the platform default `u.vacademy.io`.
 */
const PLATFORM_ZONE = 'vacademy.io';

/**
 * The label a white-label short link is served from, and the nginx ingress that
 * label has to resolve to.
 *
 * Every short domain in production (u.aanandham.uk, u.readonrent.com,
 * u.elevateeducation.in, u.suchbliss.com) is a plain A record to this address —
 * not a CNAME — and unproxied, because cert-manager answers an HTTP-01 challenge
 * that has to reach the origin directly.
 *
 * Overridable so a change of ingress address is a deploy, not a code change.
 */
const SHORT_LINK_LABEL = 'u';
const SHORT_LINK_INGRESS_IP = import.meta.env.VITE_SHORT_LINK_INGRESS_IP || '5.223.55.238';

/**
 * Public suffixes made of two labels. Without them an apex host like
 * `myschool.co.in` would be trimmed to `co.in`, and the record would name a
 * domain the customer does not own.
 */
const MULTI_LABEL_PUBLIC_SUFFIXES = new Set([
    'co.in',
    'org.in',
    'net.in',
    'ac.in',
    'edu.in',
    'gen.in',
    'firm.in',
    'ind.in',
    'co.uk',
    'org.uk',
    'ac.uk',
    'me.uk',
    'net.uk',
    'sch.uk',
    'com.au',
    'edu.au',
    'net.au',
    'org.au',
    'co.nz',
    'ac.nz',
    'org.nz',
    'co.za',
    'org.za',
    'com.sg',
    'edu.sg',
    'com.my',
    'edu.my',
    'com.np',
    'com.bd',
    'edu.bd',
    'com.pk',
    'edu.pk',
    'com.br',
    'com.mx',
    'co.jp',
    'or.jp',
    'ac.jp',
]);

/**
 * The registrable domain a short link would hang off — the public suffix plus
 * one label — derived from a full host.
 *
 * Deliberately NOT read off `RoutingEntry.domain`: the backend splits on the
 * first dot, so an apex host entered as `aanandham.uk` is stored as
 * domain `uk` / subdomain `aanandham`, and `u.uk` is not a domain anyone owns.
 * Running the reassembled host through this instead gets `aanandham.uk` back.
 *
 * Returns '' for anything that is not a host, so callers can filter on it.
 */
const shortLinkRootDomain = (fullDomain: string): string => {
    const host = (fullDomain || '')
        .trim()
        .toLowerCase()
        .replace(/^https?:\/\//, '')
        .replace(/\/.*$/, '')
        .replace(/\.+$/, '');
    if (!host || !host.includes('.')) return '';

    const labels = host.split('.');
    if (labels.some((l) => l === '' || l === '*')) return '';

    const keep = MULTI_LABEL_PUBLIC_SUFFIXES.has(labels.slice(-2).join('.')) ? 3 : 2;
    return labels.length <= keep ? host : labels.slice(labels.length - keep).join('.');
};

let nextFormId = 1;
const makeFormId = () => `form-${nextFormId++}`;

/**
 * A new entry starts on the same values the backend would apply if these were
 * left unsent (DomainRoutingAdminService).
 *
 * <p>They have to match. The switches render `checked={!!config[field]}`, so an
 * empty config drew six OFF switches — while the backend stored NULL and every
 * login page read NULL as ON. Admins configured portals seeing "all off" and
 * shipped "all on", self-signup included. Stating the defaults here is what
 * makes the form agree with what saving it actually does.
 */
const emptyConfig = (): RoutingConfig => ({
    // Off until somebody asks for it — an open self-registration link is the one
    // flag here with real consequence.
    allow_signup: false,
    allow_google_auth: true,
    allow_github_auth: true,
    allow_email_otp_auth: true,
    // Off, unlike its siblings: the login pages read this one as
    // `allowPhoneAuth === true`, so null already meant off — and it also decides
    // whether learners get enrolled with a phone number as their username.
    allow_phone_auth: false,
    allow_username_password_auth: true,
    convert_username_password_to_lowercase: false,
});

// ─── Unsaved draft ────────────────────────────────────────────────────────────

/**
 * The settings screen mounts exactly ONE tab component at a time, so opening any
 * other setting unmounts this one and takes every typed-but-unsaved domain with
 * it. Domains here are long, hand-copied out of a customer's email, and a setup
 * often needs a dozen rows — losing them to a stray click costs real work.
 *
 * Parking the in-progress form in sessionStorage makes that round trip
 * survivable. It is per-institute, dropped the moment a setup actually saves,
 * and best-effort: a browser that refuses storage just behaves as before.
 */
const DRAFT_STORAGE_PREFIX = 'vacademy:white-label-draft:';

const draftKey = (instituteId: string) => `${DRAFT_STORAGE_PREFIX}${instituteId}`;

const defaultFormEntries = (): DomainFormEntry[] => [
    { id: makeFormId(), role: 'LEARNER', domain: '', isPrimary: true, expanded: false, config: emptyConfig() },
    { id: makeFormId(), role: 'ADMIN',   domain: '', isPrimary: true, expanded: false, config: emptyConfig() },
];

const readDraft = (instituteId: string | null | undefined): DomainFormEntry[] | null => {
    if (!instituteId || typeof sessionStorage === 'undefined') return null;
    try {
        const raw = sessionStorage.getItem(draftKey(instituteId));
        if (!raw) return null;
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed) || parsed.length === 0) return null;
        const entries: DomainFormEntry[] = parsed
            .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
            .map((e) => ({
                id: makeFormId(),
                role: (ROLES as readonly string[]).includes(String(e.role))
                    ? (e.role as DomainFormEntry['role'])
                    : 'LEARNER',
                domain: typeof e.domain === 'string' ? e.domain : '',
                isPrimary: e.isPrimary === true,
                expanded: false,
                config:
                    e.config && typeof e.config === 'object'
                        ? (e.config as RoutingConfig)
                        : emptyConfig(),
            }));
        return entries.length > 0 ? entries : null;
    } catch {
        return null;
    }
};

const writeDraft = (instituteId: string | null | undefined, entries: DomainFormEntry[]) => {
    if (!instituteId || typeof sessionStorage === 'undefined') return;
    try {
        sessionStorage.setItem(
            draftKey(instituteId),
            // `expanded` is view state, not input: restoring it would reopen
            // panels the admin had deliberately collapsed.
            JSON.stringify(
                entries.map((e) => ({
                    role: e.role,
                    domain: e.domain,
                    isPrimary: e.isPrimary,
                    config: e.config,
                }))
            )
        );
    } catch {
        // Private mode or quota. The form still works; it just won't survive
        // a tab switch, which is exactly the old behaviour.
    }
};

const clearDraft = (instituteId: string | null | undefined) => {
    if (!instituteId || typeof sessionStorage === 'undefined') return;
    try {
        sessionStorage.removeItem(draftKey(instituteId));
    } catch {
        // Nothing to do — a draft we cannot remove is also one we cannot read.
    }
};

// ─── Sub-components ───────────────────────────────────────────────────────────

const ImageUploadButton = ({
    fileId,
    onChange,
}: {
    fileId?: string;
    onChange: (fileId: string | undefined) => void;
}) => {
    const { t } = useTranslation('settingsWhiteLabel');
    const instituteId = getInstituteId() || 'admin';
    const [isUploading, setIsUploading] = useState(false);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const { getPublicUrl } = useFileUpload();
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (fileId) {
            getPublicUrl(fileId)
                .then((url) => setPreviewUrl(url))
                .catch(() => setPreviewUrl(null));
        } else {
            setPreviewUrl(null);
        }
    }, [fileId, getPublicUrl]);

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        try {
            setIsUploading(true);
            const uploadedFileId = await UploadFileInS3Public(
                file,
                setIsUploading,
                instituteId,
                'INSTITUTE_BRANDING'
            );

            if (uploadedFileId) {
                onChange(uploadedFileId);
            }
        } catch (error) {
            console.error('Upload failed:', error);
            toast.error(t('imageUpload.uploadFailed'));
        } finally {
            setIsUploading(false);
            if (fileInputRef.current) {
                fileInputRef.current.value = '';
            }
        }
    };

    return (
        <div className="flex items-center gap-3">
            <input
                type="file"
                accept="image/*"
                className="hidden"
                ref={fileInputRef}
                onChange={handleFileChange}
            />

            {previewUrl ? (
                <div className="group relative size-12 shrink-0 rounded-md border border-slate-200 overflow-hidden bg-slate-50">
                    <img src={previewUrl} alt={t('imageUpload.iconPreviewAlt')} className="size-full object-cover" />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1">
                        <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            className="p-1 rounded text-white hover:bg-white/20"
                            title={t('imageUpload.changeImage')}
                        >
                            <Pencil className="size-3" />
                        </button>
                        <button
                            type="button"
                            onClick={() => onChange(undefined)}
                            className="p-1 rounded text-white hover:bg-red-500/80"
                            title={t('imageUpload.removeImage')}
                        >
                            <Trash2 className="size-3" />
                        </button>
                    </div>
                </div>
            ) : (
                <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading}
                    className="flex size-12 shrink-0 flex-col items-center justify-center gap-1 rounded-md border border-dashed border-slate-300 bg-slate-50 text-slate-500 hover:border-blue-400 hover:bg-blue-50 hover:text-blue-600 transition-colors"
                >
                    {isUploading ? (
                        <Loader2 className="size-4 animate-spin" />
                    ) : (
                        <>
                            <Upload className="size-4" />
                        </>
                    )}
                </button>
            )}

            <div className="flex-1 space-y-1">
                <Input
                    placeholder={t('imageUpload.fileUuidPlaceholder')}
                    value={fileId || ''}
                    onChange={(e) => onChange(e.target.value || undefined)}
                    className="h-8 text-sm"
                />
            </div>
        </div>
    );
};

const StatusBadge = ({ configured }: { configured: boolean }) => {
    const { t } = useTranslation('settingsWhiteLabel');
    return configured ? (
        <Badge className="gap-1 bg-emerald-100 text-emerald-700 border-emerald-200 hover:bg-emerald-100">
            <CheckCircle2 className="size-3" />
            {t('status.configured')}
        </Badge>
    ) : (
        <Badge variant="secondary" className="gap-1">
            <AlertCircle className="size-3" />
            {t('status.notConfigured')}
        </Badge>
    );
};

const DnsRecordRow = ({ record }: { record: DnsRecordResult }) => (
    <div className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-4 py-2.5 text-sm font-mono">
        <div className="flex items-center gap-3 min-w-0">
            <span className="shrink-0 rounded bg-blue-100 px-1.5 py-0.5 text-xs font-sans font-semibold text-blue-700">
                {record.type}
            </span>
            <span className="truncate text-slate-700">{record.name}</span>
            <span className="hidden shrink-0 text-slate-400 sm:inline">→</span>
            <span className="hidden truncate text-slate-500 sm:inline">{record.target}</span>
        </div>
        <Badge variant={record.action === 'CREATED' ? 'default' : 'secondary'} className="ml-3 shrink-0 text-xs">
            {record.action}
        </Badge>
    </div>
);

const pagesStatusClass = (status: string): string => {
    switch (status?.toLowerCase()) {
        case 'active':
            return 'bg-emerald-100 text-emerald-700 border-emerald-200';
        case 'pending':
        case 'initializing':
            return 'bg-amber-100 text-amber-700 border-amber-200';
        default:
            return 'bg-slate-100 text-slate-600 border-slate-200';
    }
};

const PagesDomainRow = ({ record }: { record: PagesDomainResult }) => {
    const { t } = useTranslation('settingsWhiteLabel');
    return (
        <div className="rounded-lg border border-slate-100 bg-slate-50 px-4 py-2.5 text-sm space-y-1.5">
            <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                    <span className="shrink-0 rounded bg-violet-100 px-1.5 py-0.5 text-xs font-semibold text-violet-700">
                        PAGES
                    </span>
                    <span className="truncate font-mono text-slate-700">{record.name}</span>
                    <span className="hidden shrink-0 text-slate-400 sm:inline">→</span>
                    <span className="hidden truncate font-mono text-slate-500 sm:inline">{record.project}</span>
                </div>
                <Badge variant="outline" className={`ml-3 shrink-0 text-xs ${pagesStatusClass(record.status)}`}>
                    {record.status || record.action}
                </Badge>
            </div>
            {record.status?.toLowerCase() !== 'active' && record.pages_cname_target && (
                <p className="text-xs text-slate-500">
                    {t('pagesDomain.cnameHint')}{' '}
                    <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-slate-700">
                        {record.name} → {record.pages_cname_target}
                    </code>
                    . {t('pagesDomain.sslHint')}
                </p>
            )}
        </div>
    );
};

/**
 * The one DNS record a customer has to add for short links to run on their own
 * domain, laid out the way a registrar's form asks for it (Type / Name / Value)
 * so it can be pasted straight into the same email as the portal CNAMEs.
 */
const ShortLinkDnsRow = ({ rootDomain }: { rootDomain: string }) => {
    const { t } = useTranslation('settingsWhiteLabel');
    const host = `${SHORT_LINK_LABEL}.${rootDomain}`;

    const fields = [
        { label: t('shortLinkDns.dnsType'), value: 'A' },
        { label: t('shortLinkDns.dnsName'), value: SHORT_LINK_LABEL },
        { label: t('shortLinkDns.dnsValue'), value: SHORT_LINK_INGRESS_IP },
        { label: t('shortLinkDns.dnsTtl'), value: t('shortLinkDns.ttlAuto') },
        { label: t('shortLinkDns.dnsProxy'), value: t('shortLinkDns.proxyOff') },
    ];

    const handleCopy = async () => {
        const text = [
            ...fields.map((f) => `${f.label}: ${f.value}`),
            '',
            `${t('shortLinkDns.hostLabel')}: https://${host}`,
        ].join('\n');
        // copyTextToClipboard reports failure rather than pretending; a silent
        // no-op here would have the admin send an email with nothing in it.
        if (await copyTextToClipboard(text)) toast.success(t('shortLinkDns.copied'));
        else toast.error(t('shortLinkDns.copyFailed'));
    };

    return (
        <div className="rounded-lg border border-slate-200 bg-slate-50/60 px-4 py-3">
            <div className="mb-2 flex items-center justify-between gap-3">
                <span className="truncate font-mono text-sm text-slate-700">{host}</span>
                <button
                    type="button"
                    onClick={handleCopy}
                    className="flex shrink-0 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-800"
                >
                    <Copy className="size-3" />
                    {t('shortLinkDns.copy')}
                </button>
            </div>
            <div className="space-y-1 text-xs">
                {fields.map((f) => (
                    <div key={f.label} className="flex gap-3">
                        <span className="w-16 shrink-0 text-slate-500">{f.label}</span>
                        <span className="break-all font-mono text-slate-800">{f.value}</span>
                    </div>
                ))}
            </div>
        </div>
    );
};

/**
 * Shown beside the portal DNS instructions so the short-link record goes out in
 * the same message, instead of being discovered weeks later.
 *
 * Display only. The record is inert until the host is ALSO added to the ingress
 * (TLS host + a `/s` rule) and registered against the institute in
 * media_service — which is why the footnote spells out the ordering. Two live
 * institutes have a short domain registered with neither, and every link they
 * mint is dead.
 */
const ShortLinkDnsCard = ({ domains }: { domains: string[] }) => {
    const { t } = useTranslation('settingsWhiteLabel');
    if (domains.length === 0) return null;

    return (
        <Card className="border-slate-200">
            <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                    <Link2 className="size-4 text-slate-500" />
                    {t('shortLinkDns.title')}
                </CardTitle>
                <CardDescription>{t('shortLinkDns.description')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
                {domains.map((d) => (
                    <ShortLinkDnsRow key={d} rootDomain={d} />
                ))}
                <Alert className="border-amber-100 bg-amber-50">
                    <AlertCircle className="size-4 text-amber-600" />
                    <AlertDescription className="text-sm text-amber-700">
                        {t('shortLinkDns.platformNote')}
                    </AlertDescription>
                </Alert>
            </CardContent>
        </Card>
    );
};

const PortalUrlRow = ({ label, url }: { label: string; url: string | null | undefined }) => {
    if (!url) return null;
    return (
        <div className="flex items-center justify-between gap-3 text-sm">
            <span className="font-medium text-slate-600 w-28 shrink-0">{label}</span>
            <a href={url} target="_blank" rel="noopener noreferrer"
               className="flex items-center gap-1 text-blue-600 hover:underline truncate">
                {url}
                <ExternalLink className="size-3 shrink-0" />
            </a>
        </div>
    );
};

/** Displays a single config value in the current config table */
const ConfigValue = ({ label, value }: { label: string; value: any }) => {
    const { t } = useTranslation('settingsWhiteLabel');
    if (value === null || value === undefined || value === '') return null;
    const display = typeof value === 'boolean' ? (value ? t('configValue.yes') : t('configValue.no')) : String(value);
    return (
        <div className="flex items-center justify-between gap-2 text-xs">
            <span className="text-slate-500 shrink-0">{label}</span>
            <span className="text-slate-700 font-mono truncate text-right">{display}</span>
        </div>
    );
};

// ─── Config Form Section ──────────────────────────────────────────────────────

const ConfigFormSection = ({
    config,
    onUpdate,
}: {
    config: RoutingConfig;
    onUpdate: (field: keyof RoutingConfig, value: any) => void;
}) => {
    const { t } = useTranslation('settingsWhiteLabel');
    return (
    <div className="space-y-5 pt-4">
        {/* Branding */}
        <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                <Palette className="size-4 text-blue-500" />
                {t('configForm.branding.heading')}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                    <Label className="text-xs text-slate-500">{t('configForm.branding.tabTitleLabel')}</Label>
                    <Input placeholder={t('configForm.branding.tabTitlePlaceholder')} value={config.tab_text || ''}
                           onChange={e => onUpdate('tab_text', e.target.value)} className="h-8 text-sm" />
                </div>
                <div className="space-y-1">
                    <Label className="text-xs text-slate-500">{t('configForm.branding.tabIconLabel')}</Label>
                    <ImageUploadButton
                        fileId={config.tab_icon_file_id}
                        onChange={(id) => onUpdate('tab_icon_file_id', id)}
                    />
                </div>
                <div className="space-y-1">
                    <Label className="text-xs text-slate-500">{t('configForm.branding.themeLabel')}</Label>
                    <Input placeholder={t('configForm.branding.themePlaceholder')} value={config.theme || ''}
                           onChange={e => onUpdate('theme', e.target.value)} className="h-8 text-sm" />
                </div>
                <div className="space-y-1">
                    <Label className="text-xs text-slate-500">{t('configForm.branding.fontFamilyLabel')}</Label>
                    <Input placeholder={t('configForm.branding.fontFamilyPlaceholder')} value={config.font_family || ''}
                           onChange={e => onUpdate('font_family', e.target.value)} className="h-8 text-sm" />
                </div>
            </div>

            {/* Logo display controls — apply to sidebar + login on both admin and learner sides */}
            <div className="rounded-md border border-slate-100 bg-slate-50/50 p-3 space-y-3">
                <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                        <Label className="text-xs font-medium text-slate-700 cursor-pointer" htmlFor="switch-hide_institute_name">
                            {t('configForm.branding.hideNameLabel')}
                        </Label>
                        <p className="text-[11px] text-slate-400">
                            {t('configForm.branding.hideNameHint')}
                        </p>
                    </div>
                    <Switch
                        id="switch-hide_institute_name"
                        checked={!!config.hide_institute_name}
                        onCheckedChange={v => onUpdate('hide_institute_name', v)}
                    />
                </div>
                <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                        <Label className="text-xs font-medium text-slate-700 cursor-pointer" htmlFor="switch-stack_name_below_logo">
                            {t('configForm.branding.stackNameLabel')}
                        </Label>
                        <p className="text-xs text-slate-400">
                            {t('configForm.branding.stackNameHint')}
                        </p>
                    </div>
                    <Switch
                        id="switch-stack_name_below_logo"
                        checked={!!config.stack_name_below_logo}
                        onCheckedChange={v => onUpdate('stack_name_below_logo', v)}
                    />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                        <Label className="text-xs text-slate-500">
                            {t('configForm.branding.logoWidthLabel')}
                        </Label>
                        <Input
                            type="number"
                            min={LOGO_DIMENSION_LIMITS.minPx}
                            max={LOGO_DIMENSION_LIMITS.maxWidthPx}
                            placeholder={`${LOGO_DIMENSION_LIMITS.minPx}–${LOGO_DIMENSION_LIMITS.maxWidthPx}`}
                            value={config.logo_width_px ?? ''}
                            onChange={e => {
                                const raw = e.target.value;
                                if (raw === '') {
                                    onUpdate('logo_width_px', undefined);
                                    return;
                                }
                                const n = Number(raw);
                                if (!Number.isFinite(n)) return;
                                const clamped = Math.max(
                                    LOGO_DIMENSION_LIMITS.minPx,
                                    Math.min(LOGO_DIMENSION_LIMITS.maxWidthPx, Math.round(n))
                                );
                                onUpdate('logo_width_px', clamped);
                            }}
                            className="h-8 text-sm"
                        />
                        <p className="text-[10px] text-slate-400">
                            {t('configForm.branding.logoWidthHint')}
                        </p>
                    </div>
                    <div className="space-y-1">
                        <Label className="text-xs text-slate-500">
                            {t('configForm.branding.logoHeightLabel')}
                        </Label>
                        <Input
                            type="number"
                            min={LOGO_DIMENSION_LIMITS.minPx}
                            max={LOGO_DIMENSION_LIMITS.maxHeightPx}
                            placeholder={`${LOGO_DIMENSION_LIMITS.minPx}–${LOGO_DIMENSION_LIMITS.maxHeightPx}`}
                            value={config.logo_height_px ?? ''}
                            onChange={e => {
                                const raw = e.target.value;
                                if (raw === '') {
                                    onUpdate('logo_height_px', undefined);
                                    return;
                                }
                                const n = Number(raw);
                                if (!Number.isFinite(n)) return;
                                const clamped = Math.max(
                                    LOGO_DIMENSION_LIMITS.minPx,
                                    Math.min(LOGO_DIMENSION_LIMITS.maxHeightPx, Math.round(n))
                                );
                                onUpdate('logo_height_px', clamped);
                            }}
                            className="h-8 text-sm"
                        />
                        <p className="text-[10px] text-slate-400">
                            {t('configForm.branding.logoHeightHint')}
                        </p>
                    </div>
                </div>
            </div>
        </div>

        <Separator />

        {/* Authentication */}
        <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                <KeyRound className="size-4 text-amber-500" />
                {t('configForm.auth.heading')}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {([
                    ['allow_signup', t('configForm.auth.allowSignup')],
                    ['allow_google_auth', t('configForm.auth.googleAuth')],
                    ['allow_github_auth', t('configForm.auth.githubAuth')],
                    ['allow_email_otp_auth', t('configForm.auth.emailOtpAuth')],
                    ['allow_phone_auth', t('configForm.auth.phoneAuth')],
                    ['allow_username_password_auth', t('configForm.auth.usernamePasswordAuth')],
                    ['convert_username_password_to_lowercase', t('configForm.auth.convertUsernameLowercase')],
                ] as [keyof RoutingConfig, string][]).map(([field, label]) => (
                    <div key={field} className="flex items-center justify-between rounded-md border border-slate-100 bg-slate-50/50 px-3 py-2">
                        <Label className="text-xs text-slate-600 cursor-pointer" htmlFor={`switch-${field}`}>
                            {label}
                        </Label>
                        <Switch
                            id={`switch-${field}`}
                            checked={!!config[field]}
                            onCheckedChange={v => onUpdate(field, v)}
                        />
                    </div>
                ))}
            </div>
        </div>

        <Separator />

        {/* Phone Input Preferences */}
        <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                <Phone className="size-4 text-sky-500" />
                {t('configForm.phone.heading')}
            </div>
            <div className="space-y-1.5">
                <Label className="text-xs text-slate-500">
                    {t('configForm.phone.preferredCountriesLabel')}
                </Label>
                <PreferredCountriesSelector
                    value={parsePreferredCountriesString(
                        config.comma_separated_preferred_country
                    )}
                    onChange={(codes) =>
                        onUpdate(
                            'comma_separated_preferred_country',
                            codes.length > 0 ? stringifyPreferredCountries(codes) : undefined
                        )
                    }
                />
                <p className="text-[11px] text-slate-400">
                    {t('configForm.phone.preferredCountriesHint')}
                </p>
            </div>
            <PhoneCountryGeoModeField
                value={config.phone_country_geo_mode}
                preferredCountriesValue={config.comma_separated_preferred_country}
                onChange={(mode) => onUpdate('phone_country_geo_mode', mode)}
            />
        </div>

        <Separator />

        {/* Routes */}
        <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                <Route className="size-4 text-green-500" />
                {t('configForm.routes.heading')}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                    <Label className="text-xs text-slate-500">{t('configForm.routes.redirectLabel')}</Label>
                    <Input placeholder={t('configForm.routes.redirectPlaceholder')} value={config.redirect || ''}
                           onChange={e => onUpdate('redirect', e.target.value)} className="h-8 text-sm" />
                </div>
                <div className="space-y-1">
                    <Label className="text-xs text-slate-500">{t('configForm.routes.afterLoginLabel')}</Label>
                    <Input placeholder={t('configForm.routes.afterLoginPlaceholder')} value={config.after_login_route || ''}
                           onChange={e => onUpdate('after_login_route', e.target.value)} className="h-8 text-sm" />
                </div>
                <div className="space-y-1">
                    <Label className="text-xs text-slate-500">{t('configForm.routes.afterLogoutLabel')}</Label>
                    <Input placeholder={t('configForm.routes.afterLogoutPlaceholder')} value={config.admin_portal_after_logout_route || ''}
                           onChange={e => onUpdate('admin_portal_after_logout_route', e.target.value)} className="h-8 text-sm" />
                </div>
                <div className="space-y-1">
                    <Label className="text-xs text-slate-500">{t('configForm.routes.homeClickLabel')}</Label>
                    <Input placeholder={t('configForm.routes.homeClickPlaceholder')} value={config.home_icon_click_route || ''}
                           onChange={e => onUpdate('home_icon_click_route', e.target.value)} className="h-8 text-sm" />
                </div>
            </div>
        </div>

        <Separator />

        {/* Links */}
        <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                <Link2 className="size-4 text-violet-500" />
                {t('configForm.links.heading')}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                    <Label className="text-xs text-slate-500">{t('configForm.links.privacyPolicyLabel')}</Label>
                    <Input placeholder={t('configForm.links.privacyPolicyPlaceholder')} value={config.privacy_policy_url || ''}
                           onChange={e => onUpdate('privacy_policy_url', e.target.value)} className="h-8 text-sm" />
                </div>
                <div className="space-y-1">
                    <Label className="text-xs text-slate-500">{t('configForm.links.termsLabel')}</Label>
                    <Input placeholder={t('configForm.links.termsPlaceholder')} value={config.terms_and_condition_url || ''}
                           onChange={e => onUpdate('terms_and_condition_url', e.target.value)} className="h-8 text-sm" />
                </div>
                <div className="space-y-1">
                    <Label className="text-xs text-slate-500">{t('configForm.links.playStoreLabel')}</Label>
                    <Input placeholder={t('configForm.links.playStorePlaceholder')} value={config.play_store_app_link || ''}
                           onChange={e => onUpdate('play_store_app_link', e.target.value)} className="h-8 text-sm" />
                </div>
                <div className="space-y-1">
                    <Label className="text-xs text-slate-500">{t('configForm.links.appStoreLabel')}</Label>
                    <Input placeholder={t('configForm.links.appStorePlaceholder')} value={config.app_store_app_link || ''}
                           onChange={e => onUpdate('app_store_app_link', e.target.value)} className="h-8 text-sm" />
                </div>
                <div className="space-y-1">
                    <Label className="text-xs text-slate-500">{t('configForm.links.windowsLabel')}</Label>
                    <Input placeholder={t('configForm.links.genericUrlPlaceholder')} value={config.windows_app_link || ''}
                           onChange={e => onUpdate('windows_app_link', e.target.value)} className="h-8 text-sm" />
                </div>
                <div className="space-y-1">
                    <Label className="text-xs text-slate-500">{t('configForm.links.macLabel')}</Label>
                    <Input placeholder={t('configForm.links.genericUrlPlaceholder')} value={config.mac_app_link || ''}
                           onChange={e => onUpdate('mac_app_link', e.target.value)} className="h-8 text-sm" />
                </div>
            </div>
        </div>
    </div>
    );
};

// ─── Main Component ───────────────────────────────────────────────────────────

export default function WhiteLabelSettings({ isTab }: { isTab?: boolean }) {
    const { t } = useTranslation('settingsWhiteLabel');
    const instituteId = getInstituteId();

    // A draft parked by an earlier visit to this tab beats the blank form, and
    // counts as unsaved input from the very first render — so the status prefill
    // below leaves it alone instead of overwriting it on arrival.
    const [initialForm] = useState(() => {
        const draft = readDraft(instituteId);
        return { entries: draft ?? defaultFormEntries(), fromDraft: draft !== null };
    });

    const [formEntries, setFormEntries] = useState<DomainFormEntry[]>(initialForm.entries);
    const [draftRestored, setDraftRestored] = useState(initialForm.fromDraft);
    const [hasUnsavedEdits, setHasUnsavedEdits] = useState(initialForm.fromDraft);

    /**
     * The same flag as `hasUnsavedEdits`, readable synchronously from callbacks
     * that must not wait for a re-render — chiefly the activation poll below.
     *
     * Every status read used to call prefillFromStatus, which replaces
     * formEntries wholesale. With the poll running every 30s while any domain is
     * still activating, a domain typed but not yet applied was silently wiped
     * mid-edit; switching tabs and back did the same thing on mount.
     */
    const hasUnsavedEditsRef = useRef(initialForm.fromDraft);

    const markEdited = () => {
        hasUnsavedEditsRef.current = true;
        setHasUnsavedEdits(true);
    };

    // Persist while dirty, so unmounting this screen (any settings-tab switch)
    // no longer costs the admin what they had typed.
    useEffect(() => {
        if (!hasUnsavedEditsRef.current) return;
        writeDraft(instituteId, formEntries);
    }, [formEntries, instituteId]);

    const [status, setStatus] = useState<WhiteLabelStatusResponse | null>(null);
    const [statusLoading, setStatusLoading] = useState(false);
    const [setupLoading, setSetupLoading] = useState(false);
    const [lastSetupResult, setLastSetupResult] = useState<WhiteLabelSetupResponse | null>(null);

    useEffect(() => { if (instituteId) fetchStatus(); }, [instituteId]);

    // Sub-orgs of this institute, for the per-domain linkage picker. Most
    // institutes have none, in which case the picker never renders and the page
    // looks exactly as it did. Best-effort: a failure here must not block
    // white-label setup, so it degrades to "no sub-orgs" rather than erroring.
    const [subOrgs, setSubOrgs] = useState<SubOrgOption[]>([]);

    useEffect(() => {
        if (!instituteId) return;
        let cancelled = false;
        (async () => {
            try {
                const raw: unknown = await getSubOrgs(instituteId);
                const list: RawSubOrg[] = Array.isArray(raw)
                    ? (raw as RawSubOrg[])
                    : (raw as { content?: RawSubOrg[] } | null)?.content ?? [];
                const options = list
                    .map((o) => normaliseSubOrg(o))
                    .filter((o): o is SubOrgOption => o !== null);
                if (!cancelled) setSubOrgs(options);
            } catch (err) {
                console.error('[WhiteLabel] Failed to load sub-orgs', err);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [instituteId]);

    const subOrgSearchPlaceholder = t('subOrg.searchPlaceholder');
    const subOrgSearchEmpty = t('subOrg.searchEmpty');

    /**
     * Options for the per-domain sub-org picker: "parent institute" pinned first,
     * then every sub-org sorted by name. An institute running white-label for its
     * franchisees has dozens of these, and the old plain <Select> offered no
     * search — finding one meant scrolling an unordered list.
     */
    const subOrgOptions = useMemo(
        () => [
            { value: NO_SUB_ORG, label: t('subOrg.none') },
            ...subOrgs
                .map((o) => ({ value: o.id, label: o.name || t('subOrg.untitled') }))
                .sort((a, b) => a.label.localeCompare(b.label)),
        ],
        [subOrgs, t]
    );

    // ── Pre-fill from existing routing entries ────────────────────────────────
    const prefillFromStatus = (data: WhiteLabelStatusResponse, force = false) => {
        // Anything the admin has typed outranks the server copy. Without this the
        // 30-second activation poll — or simply re-opening the tab — replaced the
        // whole form with the saved rows, so an unapplied domain just vanished.
        if (hasUnsavedEditsRef.current && !force) return;
        if (!data.routing_entries || data.routing_entries.length === 0) return;

        const newEntries: DomainFormEntry[] = data.routing_entries.map((r) => {
            const fullDomain = fqdn(r);
            // The server stores the primary choice on the routing row, so read it
            // rather than inferring it from the portal URL. Inferring is wrong now
            // that a choice is only applied once its host goes live: a pending
            // primary would come back un-starred, and the next Save would clear it.
            const isPrimary = r.is_primary === true;

            return {
                id: makeFormId(),
                role: r.role as 'LEARNER' | 'ADMIN' | 'TEACHER',
                domain: fullDomain,
                isPrimary,
                expanded: false,
                config: {
                    tab_text: r.tab_text ?? undefined,
                    tab_icon_file_id: r.tab_icon_file_id ?? undefined,
                    theme: r.theme ?? undefined,
                    font_family: r.font_family ?? undefined,
                    redirect: r.redirect ?? undefined,
                    after_login_route: r.after_login_route ?? undefined,
                    admin_portal_after_logout_route: r.admin_portal_after_logout_route ?? undefined,
                    home_icon_click_route: r.home_icon_click_route ?? undefined,
                    allow_signup: r.allow_signup ?? undefined,
                    allow_google_auth: r.allow_google_auth ?? undefined,
                    allow_github_auth: r.allow_github_auth ?? undefined,
                    allow_email_otp_auth: r.allow_email_otp_auth ?? undefined,
                    allow_phone_auth: r.allow_phone_auth ?? undefined,
                    allow_username_password_auth: r.allow_username_password_auth ?? undefined,
                    convert_username_password_to_lowercase: r.convert_username_password_to_lowercase ?? undefined,
                    privacy_policy_url: r.privacy_policy_url ?? undefined,
                    terms_and_condition_url: r.terms_and_condition_url ?? undefined,
                    play_store_app_link: r.play_store_app_link ?? undefined,
                    app_store_app_link: r.app_store_app_link ?? undefined,
                    windows_app_link: r.windows_app_link ?? undefined,
                    mac_app_link: r.mac_app_link ?? undefined,
                    comma_separated_preferred_country:
                        r.comma_separated_preferred_country ?? undefined,
                    phone_country_geo_mode: r.phone_country_geo_mode ?? undefined,
                    hide_institute_name: r.hide_institute_name ?? undefined,
                    logo_width_px: r.logo_width_px ?? undefined,
                    logo_height_px: r.logo_height_px ?? undefined,
                    stack_name_below_logo: r.stack_name_below_logo ?? undefined,
                    // Round-trip the linkage. Before this the wizard didn't know the
                    // field existed, so every save posted a config without it and the
                    // backend blanked sub_org_id — un-branding the portal and
                    // disabling its login scoping.
                    sub_org_id: r.sub_org_id ?? undefined,
                },
            };
        });

        if (newEntries.length > 0) setFormEntries(newEntries);
    };

    // ── API ───────────────────────────────────────────────────────────────────
    const fetchStatus = async () => {
        if (!instituteId) return;
        setStatusLoading(true);
        try {
            const res = await authenticatedAxiosInstance.get<WhiteLabelStatusResponse>(
                WHITE_LABEL_STATUS(instituteId)
            );
            console.log('[WhiteLabel] Status response:', res.data);
            setStatus(res.data);
            prefillFromStatus(res.data);

            // The server adopts a chosen domain into the institute's portal URL the
            // moment Cloudflare activates it. That can land on a poll rather than an
            // action, so say so — otherwise the change is invisible.
            const adopted = res.data.roles_adopted_now ?? [];
            if (adopted.length > 0) {
                toast.success(
                    t('toast.portalUrlAdopted', {
                        roles: adopted.map((r) => roleLabel(r, t)).join(', '),
                    })
                );
            }
        } catch (err) {
            console.error('[WhiteLabel] Failed to load status', err);
        } finally {
            setStatusLoading(false);
        }
    };

    // ── Auto-poll while a domain is still activating ──────────────────────────
    // Cloudflare validates an external domain minutes — sometimes hours — after
    // it is added, and it has no webhook to tell us. Every status read reconciles
    // server-side, so simply asking again is what turns "stored once the URL goes
    // active" into something that happens while the admin watches, rather than
    // the next time somebody happens to open this page. Bounded, so a domain
    // whose CNAME never lands doesn't poll forever.
    const [pollsLeft, setPollsLeft] = useState(MAX_ACTIVATION_POLLS);

    const hasActivatingDomain = (status?.routing_entries ?? []).some(
        (e) => !!e.pages_status && e.pages_status.toLowerCase() !== 'active'
    );

    /**
     * Customer root domains that would need a short-link record, taken from the
     * saved routing rows AND from whatever is currently typed into the form —
     * so the record is on screen while the admin is still drafting the email
     * that asks for the portal CNAMEs, not only after setup has run.
     *
     * Deduped: learner/admin/teacher on one domain is one record, not three.
     */
    const shortLinkDomains = useMemo(() => {
        const roots = new Set<string>();
        for (const e of status?.routing_entries ?? []) {
            const root = shortLinkRootDomain(fqdn(e));
            if (root && root !== PLATFORM_ZONE) roots.add(root);
        }
        for (const e of formEntries) {
            const root = shortLinkRootDomain(e.domain);
            if (root && root !== PLATFORM_ZONE) roots.add(root);
        }
        return [...roots].sort();
    }, [status?.routing_entries, formEntries]);

    // Held in a ref so the poll effect doesn't re-run on every render just
    // because fetchStatus is a new closure each time.
    const fetchStatusRef = useRef(fetchStatus);
    fetchStatusRef.current = fetchStatus;

    useEffect(() => {
        if (!hasActivatingDomain || pollsLeft <= 0) return;
        const timer = setTimeout(() => {
            setPollsLeft((n) => n - 1);
            void fetchStatusRef.current();
        }, ACTIVATION_POLL_INTERVAL_MS);
        return () => clearTimeout(timer);
    }, [hasActivatingDomain, pollsLeft]);

    const handleSetup = async () => {
        if (!instituteId) { toast.error(t('toast.noInstituteSelected')); return; }

        const nonEmpty = formEntries.filter(e => e.domain.trim());
        if (nonEmpty.length === 0) { toast.error(t('toast.addAtLeastOneDomain')); return; }

        setSetupLoading(true);
        setLastSetupResult(null);
        try {
            const payload = {
                entries: nonEmpty.map(e => ({
                    role: e.role,
                    domain: e.domain.trim().toLowerCase(),
                    is_primary: e.isPrimary,
                    routing_config: e.config,
                })),
            };

            const res = await authenticatedAxiosInstance.post<WhiteLabelSetupResponse>(
                `${WHITE_LABEL_SETUP}?instituteId=${instituteId}`,
                payload
            );
            setLastSetupResult(res.data);
            toast.success(t('toast.setupCompleted'));
            setPollsLeft(MAX_ACTIVATION_POLLS);
            // Saved: drop the draft and let the form re-read what the server
            // actually stored (normalised domains, generated rows, and so on).
            clearDraft(instituteId);
            hasUnsavedEditsRef.current = false;
            setHasUnsavedEdits(false);
            setDraftRestored(false);
            await fetchStatus();
        } catch (err: any) {
            const errMsg = err?.response?.data?.message || err?.response?.data || t('toast.setupFailed');
            toast.error(typeof errMsg === 'string' ? errMsg : t('toast.setupFailed'));
        } finally {
            setSetupLoading(false);
        }
    };

    // ── Form entry CRUD ───────────────────────────────────────────────────────
    const addEntry = () => {
        markEdited();
        setFormEntries(prev => [
            ...prev,
            { id: makeFormId(), role: 'LEARNER', domain: '', isPrimary: false, expanded: false, config: emptyConfig() },
        ]);
    };

    const removeEntry = (id: string) => {
        markEdited();
        setFormEntries(prev => prev.filter(e => e.id !== id));
    };

    const updateEntry = (id: string, field: keyof DomainFormEntry, value: any) => {
        markEdited();
        setFormEntries(prev => prev.map(e => e.id === id ? { ...e, [field]: value } : e));
    };

    const updateEntryConfig = (id: string, field: keyof RoutingConfig, value: any) => {
        markEdited();
        setFormEntries(prev =>
            prev.map(e =>
                e.id === id ? { ...e, config: { ...e.config, [field]: value } } : e
            )
        );
    };

    const toggleExpand = (id: string) => {
        // Deliberately not an edit: opening a panel to read it must not start
        // pinning a draft, nor block the form from picking up server changes.
        setFormEntries(prev => prev.map(e => e.id === id ? { ...e, expanded: !e.expanded } : e));
    };

    const discardDraft = () => {
        clearDraft(instituteId);
        hasUnsavedEditsRef.current = false;
        setHasUnsavedEdits(false);
        setDraftRestored(false);
        if (status?.routing_entries?.length) prefillFromStatus(status, true);
        else setFormEntries(defaultFormEntries());
    };

    // ── Render ────────────────────────────────────────────────────────────────

    if (status !== null && !status.cloudflare_enabled) {
        return (
            <div className="max-w-3xl">
                <Card className="border-slate-200">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-lg">
                            <Globe className="size-5 text-slate-400" />
                            {t('header.title')}
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <Alert className="border-slate-200 bg-slate-50">
                            <Info className="size-4 text-slate-500" />
                            <AlertDescription className="text-slate-600">
                                <strong>{t('notAvailable.strong')}</strong> {t('notAvailable.description')}
                            </AlertDescription>
                        </Alert>
                    </CardContent>
                </Card>
            </div>
        );
    }

    return (
        // Wider than the other settings screens on purpose: a domain row carries
        // a role, a full FQDN, a sub-org and three actions side by side, and at
        // max-w-3xl the domain input was squeezed to about 60px.
        <div className="max-w-5xl space-y-6">
            {/* ── Header ── */}
            <Card>
                <CardHeader>
                    <div className="flex items-start justify-between gap-4">
                        <div className="space-y-1">
                            <CardTitle className="flex items-center gap-2 text-lg">
                                <Globe className="size-5 text-blue-600" />
                                {t('header.title')}
                            </CardTitle>
                            <CardDescription>
                                {t('header.description')}
                            </CardDescription>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                            {statusLoading ? (
                                <Loader2 className="size-4 animate-spin text-slate-400" />
                            ) : status ? (
                                <StatusBadge configured={status.is_configured} />
                            ) : null}
                            <button onClick={fetchStatus} disabled={statusLoading}
                                    className="rounded p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                                    title={t('header.refreshStatus')}>
                                <RefreshCw className="size-4" />
                            </button>
                        </div>
                    </div>
                </CardHeader>
            </Card>

            {/* ── Current Configuration ── */}
            {status?.is_configured && (
                <Card className="border-blue-100">
                    <CardHeader className="pb-3">
                        <CardTitle className="flex items-center gap-2 text-base">
                            <LinkIcon className="size-4 text-blue-600" />
                            {t('currentConfig.title')}
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {/* Primary URLs */}
                        <div>
                            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                                {t('currentConfig.primaryUrlsLabel')}
                            </p>
                            <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-4 space-y-3">
                                <PortalUrlRow label={getTerminology(RoleTerms.Learner, SystemTerms.Learner)} url={status.learner_portal_url} />
                                <PortalUrlRow label={getTerminology(RoleTerms.Admin, SystemTerms.Admin)} url={status.admin_portal_url} />
                                <PortalUrlRow label={getTerminology(RoleTerms.Teacher, SystemTerms.Teacher)} url={status.teacher_portal_url} />
                                {!status.learner_portal_url && !status.admin_portal_url && !status.teacher_portal_url && (
                                    <p className="text-sm text-slate-400 italic">{t('currentConfig.noPortalUrls')}</p>
                                )}
                            </div>
                        </div>

                        {/* Full routing entries */}
                        {status.routing_entries && status.routing_entries.length > 0 && (
                            <>
                                <Separator />
                                <div className="space-y-3">
                                    <div className="flex items-center gap-2">
                                        <TableIcon className="size-4 text-slate-500" />
                                        <p className="text-sm font-semibold text-slate-700">
                                            {t('currentConfig.domainRoutingEntries')}
                                        </p>
                                        <Badge variant="secondary" className="text-xs">
                                            {t('currentConfig.totalBadge', { count: status.routing_entries.length })}
                                        </Badge>
                                    </div>
                                    <div className="space-y-2">
                                        {status.routing_entries.map((entry) => (
                                            <RoutingEntryCard
                                                key={entry.id}
                                                entry={entry}
                                                subOrgs={subOrgs}
                                            />
                                        ))}
                                    </div>
                                </div>
                            </>
                        )}
                    </CardContent>
                </Card>
            )}

            {/* ── Short link DNS record (to forward to the customer) ── */}
            <ShortLinkDnsCard domains={shortLinkDomains} />

            {/* ── Brand name on Google's "Continue with Google" screen ── */}
            <GoogleSignInBrandingCard learnerPortalUrl={status?.learner_portal_url ?? null} />

            {/* ── Setup / Update Form ── */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-base">
                        {status?.is_configured ? t('setupCard.titleUpdate') : t('setupCard.titleNew')}
                    </CardTitle>
                    <CardDescription>
                        {t('setupCard.descriptionPart1')} <strong>{t('setupCard.settingsLabel')}</strong> {t('setupCard.descriptionPart2')}
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <Alert className="border-blue-100 bg-blue-50">
                        <Info className="size-4 text-blue-600" />
                        <AlertDescription className="text-blue-700 text-sm">
                            <strong>{t('setupCard.tip.label')}</strong> {t('setupCard.tip.enterPrefix')}{' '}
                            <code className="text-xs bg-blue-100 px-1 py-0.5 rounded">my-school.vacademy.io</code> {t('setupCard.tip.vacademySuffix')}{' '}
                            <code className="text-xs bg-blue-100 px-1 py-0.5 rounded">learn.myschool.com</code> {t('setupCard.tip.customSuffix')}
                        </AlertDescription>
                    </Alert>

                    {draftRestored && (
                        <Alert className="border-amber-200 bg-amber-50">
                            <Info className="size-4 text-amber-600" />
                            <AlertDescription className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-amber-800">
                                <span>{t('setupCard.draftRestored')}</span>
                                <button
                                    type="button"
                                    onClick={discardDraft}
                                    className="font-medium underline underline-offset-2 hover:text-amber-900"
                                >
                                    {t('setupCard.discardDraft')}
                                </button>
                            </AlertDescription>
                        </Alert>
                    )}

                    {/* Dynamic entries */}
                    <div className="space-y-3">
                        {formEntries.map((entry, idx) => (
                            <div key={entry.id}
                                 className="rounded-lg border border-slate-200 bg-white overflow-hidden">
                                {/* Top row: entry number, role, domain, primary, expand, delete.
                                    Wrapping, and every track sized with minmax(0, …): the fixed
                                    140px/200px columns plus three buttons used to eat the whole
                                    row, leaving the domain input — the one field holding a long
                                    FQDN — narrower than the word "learn.". */}
                                <div className="flex flex-wrap items-start gap-x-3 gap-y-2 p-4">
                                    <span className="mt-2 flex size-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-500">
                                        {idx + 1}
                                    </span>

                                    <div
                                        className={`grid flex-1 basis-[460px] grid-cols-1 gap-3 ${
                                            subOrgs.length > 0
                                                ? 'sm:grid-cols-[150px_minmax(0,1fr)] lg:grid-cols-[150px_minmax(0,1.5fr)_minmax(0,1fr)]'
                                                : 'sm:grid-cols-[150px_minmax(0,1fr)]'
                                        }`}
                                    >
                                        <div className="space-y-1">
                                            <Label className="text-xs text-slate-500">{t('setupCard.roleLabel')}</Label>
                                            <Select value={entry.role}
                                                    onValueChange={v => updateEntry(entry.id, 'role', v)}>
                                                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                                                <SelectContent>
                                                    {ROLES.map(r => (
                                                        <SelectItem key={r} value={r}>{roleLabel(r, t)}</SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>

                                        <div className="space-y-1">
                                            <Label className="text-xs text-slate-500">{t('setupCard.domainLabel')}</Label>
                                            <Input placeholder={t('setupCard.domainPlaceholder')} value={entry.domain}
                                                   onChange={e => updateEntry(entry.id, 'domain',
                                                       e.target.value.toLowerCase().replace(/\s/g, ''))}
                                                   className="h-9" />
                                        </div>

                                        {/* Sub-org linkage. Only rendered when this institute
                                            actually has sub-orgs, so the row is unchanged for
                                            everyone else. Picking one brands the portal with
                                            that sub-org's logo/name/theme AND restricts login
                                            to its members. */}
                                        {subOrgs.length > 0 && (
                                            <div className="space-y-1 sm:col-span-2 lg:col-span-1">
                                                <Label className="text-xs text-slate-500">
                                                    {t('subOrg.label')}
                                                </Label>
                                                <SearchableSelect
                                                    options={subOrgOptions}
                                                    value={entry.config.sub_org_id || NO_SUB_ORG}
                                                    onChange={(v) =>
                                                        updateEntryConfig(
                                                            entry.id,
                                                            'sub_org_id',
                                                            v === NO_SUB_ORG ? '' : v
                                                        )
                                                    }
                                                    placeholder={t('subOrg.none')}
                                                    searchPlaceholder={subOrgSearchPlaceholder}
                                                    emptyText={subOrgSearchEmpty}
                                                    triggerClassName="h-9 px-3 text-sm"
                                                />
                                            </div>
                                        )}
                                    </div>

                                    {/* Actions travel together: on a narrow row they wrap
                                        onto their own line and hand the whole width back
                                        to the fields, rather than each squeezing them. */}
                                    <div className="ml-auto mt-6 flex shrink-0 items-center gap-2">
                                        {/* Primary */}
                                        <button type="button"
                                                onClick={() => updateEntry(entry.id, 'isPrimary', !entry.isPrimary)}
                                                className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                                                    entry.isPrimary
                                                        ? 'bg-amber-100 text-amber-700 border border-amber-200'
                                                        : 'bg-slate-50 text-slate-400 border border-slate-200 hover:bg-slate-100 hover:text-slate-600'
                                                }`}
                                                title={entry.isPrimary ? t('setupCard.primaryTooltip') : t('setupCard.setPrimaryTooltip')}>
                                            <Star className={`size-3 ${entry.isPrimary ? 'fill-amber-500' : ''}`} />
                                            {entry.isPrimary ? t('setupCard.primary') : t('setupCard.setPrimary')}
                                        </button>

                                        {/* Expand config */}
                                        <button type="button" onClick={() => toggleExpand(entry.id)}
                                                className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium bg-slate-50 text-slate-500 border border-slate-200 hover:bg-slate-100 hover:text-slate-700 transition-colors"
                                                title={t('setupCard.toggleSettingsTooltip')}>
                                            {entry.expanded ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
                                            {t('setupCard.settingsToggle')}
                                        </button>

                                        {/* Remove */}
                                        {formEntries.length > 1 && (
                                            <button type="button" onClick={() => removeEntry(entry.id)}
                                                    className="rounded p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                                                    title={t('setupCard.removeTooltip')}>
                                                <Trash2 className="size-4" />
                                            </button>
                                        )}
                                    </div>
                                </div>

                                {/* Expanded config section */}
                                {entry.expanded && (
                                    <div className="border-t border-slate-100 bg-slate-50/30 px-4 pb-4">
                                        <ConfigFormSection
                                            config={entry.config}
                                            onUpdate={(field, value) => updateEntryConfig(entry.id, field, value)}
                                        />
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>

                    {/* Add entry */}
                    <button type="button" onClick={addEntry}
                            className="flex items-center gap-2 rounded-lg border border-dashed border-slate-300 px-4 py-2.5 text-sm text-slate-500 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50/50 transition-colors w-full justify-center">
                        <Plus className="size-4" />
                        {t('setupCard.addAnotherDomain')}
                    </button>

                    <Separator />

                    {/* Submit */}
                    <div className="flex items-center gap-3">
                        <MyButton id="white-label-setup-btn" onClick={handleSetup}
                                  disabled={setupLoading} buttonType="primary" scale="large" layoutVariant="default">
                            {setupLoading ? (
                                <><Loader2 className="size-4 animate-spin mr-2" /> {t('setupCard.configuring')}</>
                            ) : status?.is_configured ? t('setupCard.updateButton') : t('setupCard.applyButton')}
                        </MyButton>
                        {hasUnsavedEdits ? (
                            <p className="text-xs font-medium text-amber-600">
                                {t('setupCard.unsavedChanges')}
                            </p>
                        ) : status?.is_configured ? (
                            <p className="text-xs text-slate-500">
                                {t('setupCard.preservedHint')}
                            </p>
                        ) : null}
                    </div>
                </CardContent>
            </Card>

            {/* ── Last setup result ── */}
            {lastSetupResult && (
                <Card className="border-emerald-200">
                    <CardHeader className="pb-3">
                        <CardTitle className="flex items-center gap-2 text-base text-emerald-700">
                            <CheckCircle2 className="size-5" />
                            {t('setupResult.title')}
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-2">
                            <PortalUrlRow label={getTerminology(RoleTerms.Learner, SystemTerms.Learner)} url={lastSetupResult.learner_portal_url} />
                            <PortalUrlRow label={getTerminology(RoleTerms.Admin, SystemTerms.Admin)} url={lastSetupResult.admin_portal_url} />
                            <PortalUrlRow label={getTerminology(RoleTerms.Teacher, SystemTerms.Teacher)} url={lastSetupResult.teacher_portal_url} />
                        </div>
                        {(lastSetupResult.pages_domains_configured?.length ?? 0) > 0 && (
                            <>
                                <Separator />
                                <div className="space-y-2">
                                    <p className="text-sm font-semibold text-slate-700">
                                        {t('setupResult.pagesCustomDomains')}
                                    </p>
                                    <p className="text-xs text-slate-500">
                                        {t('setupResult.pagesHint')}
                                    </p>
                                    <div className="space-y-1.5">
                                        {lastSetupResult.pages_domains_configured!.map((r, i) => (
                                            <PagesDomainRow key={i} record={r} />
                                        ))}
                                    </div>
                                </div>
                            </>
                        )}
                        {lastSetupResult.dns_records_configured?.length > 0 && (
                            <>
                                <Separator />
                                <div className="space-y-2">
                                    <p className="text-sm font-semibold text-slate-700">{t('setupResult.dnsRecordsConfigured')}</p>
                                    <div className="space-y-1.5">
                                        {lastSetupResult.dns_records_configured.map((r, i) => (
                                            <DnsRecordRow key={i} record={r} />
                                        ))}
                                    </div>
                                </div>
                            </>
                        )}
                        {lastSetupResult.warnings?.length > 0 && (
                            <Alert className="border-amber-100 bg-amber-50">
                                <AlertCircle className="size-4 text-amber-600" />
                                <AlertDescription className="text-amber-700 text-sm space-y-1">
                                    {lastSetupResult.warnings.map((w, i) => <p key={i}>{w}</p>)}
                                </AlertDescription>
                            </Alert>
                        )}
                    </CardContent>
                </Card>
            )}
        </div>
    );
}

// ─── Routing Entry Card (current config display) ──────────────────────────────

function RoutingEntryCard({ entry, subOrgs }: { entry: RoutingEntry; subOrgs: SubOrgOption[] }) {
    const { t } = useTranslation('settingsWhiteLabel');
    const subOrgName = entry.sub_org_id
        ? subOrgs.find((o) => o.id === entry.sub_org_id)?.name ?? entry.sub_org_id
        : null;

    const [expanded, setExpanded] = useState(false);
    const full = fqdn(entry);

    const hasConfig = !!(
        entry.tab_text || entry.theme || entry.font_family || entry.tab_icon_file_id ||
        entry.redirect || entry.after_login_route || entry.admin_portal_after_logout_route ||
        entry.home_icon_click_route || entry.privacy_policy_url || entry.terms_and_condition_url ||
        entry.play_store_app_link || entry.app_store_app_link ||
        entry.windows_app_link || entry.mac_app_link ||
        entry.allow_signup != null || entry.allow_google_auth != null ||
        entry.allow_github_auth != null || entry.allow_email_otp_auth != null ||
        entry.allow_phone_auth != null || entry.allow_username_password_auth != null ||
        entry.comma_separated_preferred_country ||
        entry.phone_country_geo_mode ||
        entry.hide_institute_name != null ||
        entry.logo_width_px != null || entry.logo_height_px != null ||
        entry.stack_name_below_logo != null
    );

    // Under GEO_FIRST the first configured country is NOT what a phone field
    // starts on — the visitor's own country is — so the star and its "default
    // selected country" tooltip below have to know the mode before claiming it.
    const savedGeoMode: PhoneCountryGeoMode = PHONE_COUNTRY_GEO_MODES.includes(
        (entry.phone_country_geo_mode ?? '') as PhoneCountryGeoMode
    )
        ? (entry.phone_country_geo_mode as PhoneCountryGeoMode)
        : DEFAULT_PHONE_COUNTRY_GEO_MODE;
    const firstCountryIsDefault = savedGeoMode !== 'GEO_FIRST';

    const preferredCountryCodes = parsePreferredCountriesString(
        entry.comma_separated_preferred_country
    );

    return (
        <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
            {/* Summary row */}
            <div className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-3 min-w-0">
                    <Badge variant="outline" className={roleBadgeClass(entry.role)}>
                        {roleLabel(entry.role, t)}
                    </Badge>
                    <a href={`https://${full}`} target="_blank" rel="noopener noreferrer"
                       className="flex items-center gap-1 text-sm text-blue-600 hover:underline font-mono truncate">
                        {full}
                        <ExternalLink className="size-3 shrink-0" />
                    </a>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    {/* Two different facts, deliberately shown separately: which host
                        the admin chose, and which one outbound links actually use.
                        They diverge for as long as a chosen host stays pending, and
                        that gap is the thing an admin otherwise cannot explain. */}
                    {entry.is_portal_url ? (
                        <Badge
                            variant="outline"
                            className="gap-1 border-emerald-200 bg-emerald-50 text-xs text-emerald-700"
                            title={t('routingEntryCard.portalUrlTooltip')}
                        >
                            <CheckCircle2 className="size-3" />
                            {t('routingEntryCard.portalUrl')}
                        </Badge>
                    ) : entry.is_primary ? (
                        <Badge
                            variant="outline"
                            className="gap-1 border-amber-200 bg-amber-50 text-xs text-amber-700"
                            title={t('routingEntryCard.primaryPendingTooltip')}
                        >
                            <Star className="size-3" />
                            {t('routingEntryCard.primaryPending')}
                        </Badge>
                    ) : null}
                    {subOrgName && (
                        <Badge
                            variant="outline"
                            className="border-sky-200 bg-sky-50 text-xs text-sky-700"
                            title={t('subOrg.badgeTooltip')}
                        >
                            {subOrgName}
                        </Badge>
                    )}
                    {entry.pages_status && (
                        <Badge
                            variant="outline"
                            className={`text-xs capitalize ${pagesStatusClass(entry.pages_status)}`}
                            title={t('routingEntryCard.cloudflareStatusTooltip')}
                        >
                            {entry.pages_status}
                        </Badge>
                    )}
                    {entry.tab_text && (
                        <span className="text-xs text-slate-500 hidden sm:inline">
                            {t('routingEntryCard.tabPrefix', { value: entry.tab_text })}
                        </span>
                    )}
                    {entry.theme && (
                        <span className="text-xs text-slate-500 hidden sm:inline">
                            {t('routingEntryCard.themePrefix', { value: entry.theme })}
                        </span>
                    )}
                    {hasConfig && (
                        <button onClick={() => setExpanded(!expanded)}
                                className="rounded p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                                title={t('routingEntryCard.showDetailsTooltip')}>
                            {expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                        </button>
                    )}
                </div>
            </div>

            {/* Chosen but not yet live: say what happens next, so the admin doesn't
                assume the choice failed to save and re-submit it. */}
            {entry.is_primary && !entry.is_portal_url && (
                <div className="border-t border-amber-100 bg-amber-50/60 px-4 py-2">
                    <p className="text-xs text-amber-800">
                        {t('routingEntryCard.willBeAdoptedOnceActive')}
                    </p>
                </div>
            )}

            {/* CNAME record to add — shown for a pending external (non-vacademy.io) domain */}
            {entry.pages_status &&
                entry.pages_status.toLowerCase() !== 'active' &&
                entry.pages_cname_target &&
                !full.toLowerCase().endsWith('.vacademy.io') && (
                    <div className="border-t border-amber-100 bg-amber-50 px-4 py-3">
                        <p className="mb-2 text-xs font-medium text-amber-800">
                            {t('routingEntryCard.cnameInstructionPrefix')}{' '}
                            <span className="font-mono">{entry.domain}</span> {t('routingEntryCard.cnameInstructionSuffix')}
                        </p>
                        <div className="space-y-1 text-xs font-mono">
                            <div className="flex gap-3">
                                <span className="w-12 text-slate-500">{t('routingEntryCard.dnsType')}</span>
                                <span className="text-slate-800">CNAME</span>
                            </div>
                            <div className="flex gap-3">
                                <span className="w-12 text-slate-500">{t('routingEntryCard.dnsName')}</span>
                                <span className="text-slate-800">{entry.subdomain}</span>
                            </div>
                            <div className="flex gap-3">
                                <span className="w-12 text-slate-500">{t('routingEntryCard.dnsValue')}</span>
                                <span className="break-all text-slate-800">{entry.pages_cname_target}</span>
                            </div>
                        </div>
                        <p className="mt-2 text-xs text-amber-700">
                            {t('routingEntryCard.sslAutoActivate')}
                        </p>
                    </div>
                )}

            {/* Expanded details */}
            {expanded && (
                <div className="border-t border-slate-100 bg-slate-50/50 px-4 py-3">
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-1.5">
                        <ConfigValue label={t('routingEntryCard.fields.domain')} value={entry.domain} />
                        <ConfigValue label={t('routingEntryCard.fields.subdomain')} value={entry.subdomain} />
                        <ConfigValue label={t('routingEntryCard.fields.tabTitle')} value={entry.tab_text} />
                        <ConfigValue label={t('routingEntryCard.fields.tabIcon')} value={entry.tab_icon_file_id} />
                        <ConfigValue label={t('routingEntryCard.fields.theme')} value={entry.theme} />
                        <ConfigValue label={t('routingEntryCard.fields.font')} value={entry.font_family} />
                        <ConfigValue label={t('routingEntryCard.fields.redirect')} value={entry.redirect} />
                        <ConfigValue label={t('routingEntryCard.fields.afterLogin')} value={entry.after_login_route} />
                        <ConfigValue label={t('routingEntryCard.fields.afterLogout')} value={entry.admin_portal_after_logout_route} />
                        <ConfigValue label={t('routingEntryCard.fields.homeClick')} value={entry.home_icon_click_route} />
                        <ConfigValue label={t('routingEntryCard.fields.signUp')} value={entry.allow_signup} />
                        <ConfigValue label={t('routingEntryCard.fields.googleAuth')} value={entry.allow_google_auth} />
                        <ConfigValue label={t('routingEntryCard.fields.githubAuth')} value={entry.allow_github_auth} />
                        <ConfigValue label={t('routingEntryCard.fields.emailOtp')} value={entry.allow_email_otp_auth} />
                        <ConfigValue label={t('routingEntryCard.fields.phoneAuth')} value={entry.allow_phone_auth} />
                        <ConfigValue label={t('routingEntryCard.fields.userPassAuth')} value={entry.allow_username_password_auth} />
                        <ConfigValue label={t('routingEntryCard.fields.privacyPolicy')} value={entry.privacy_policy_url} />
                        <ConfigValue label={t('routingEntryCard.fields.terms')} value={entry.terms_and_condition_url} />
                        <ConfigValue label={t('routingEntryCard.fields.playStore')} value={entry.play_store_app_link} />
                        <ConfigValue label={t('routingEntryCard.fields.appStore')} value={entry.app_store_app_link} />
                        <ConfigValue label={t('routingEntryCard.fields.windows')} value={entry.windows_app_link} />
                        <ConfigValue label={t('routingEntryCard.fields.mac')} value={entry.mac_app_link} />
                        <ConfigValue label={t('routingEntryCard.fields.hideInstituteName')} value={entry.hide_institute_name} />
                        <ConfigValue label={t('routingEntryCard.fields.logoWidth')} value={entry.logo_width_px} />
                        <ConfigValue label={t('routingEntryCard.fields.logoHeight')} value={entry.logo_height_px} />
                        <ConfigValue label={t('routingEntryCard.fields.stackNameBelowLogo')} value={entry.stack_name_below_logo} />
                        <ConfigValue
                            label={t('configForm.phone.geoModeLabel')}
                            value={t(`configForm.phone.geoModes.${savedGeoMode}.label`)}
                        />
                    </div>
                    {preferredCountryCodes.length > 0 && (
                        <div className="mt-3 border-t border-slate-200 pt-3">
                            <div className="flex items-center gap-2 text-xs">
                                <span className="text-slate-500">{t('routingEntryCard.preferredCountries')}</span>
                                <div className="flex flex-wrap gap-1">
                                    {preferredCountryCodes.map((code, idx) => (
                                        <span
                                            key={code}
                                            className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-mono ${
                                                idx === 0 && firstCountryIsDefault
                                                    ? 'border-amber-200 bg-amber-50 text-amber-800'
                                                    : 'border-slate-200 bg-slate-50 text-slate-600'
                                            }`}
                                            title={
                                                idx === 0 && firstCountryIsDefault
                                                    ? t('routingEntryCard.defaultCountryTooltip')
                                                    : undefined
                                            }
                                        >
                                            {idx === 0 && firstCountryIsDefault && (
                                                <Star className="size-2.5 fill-amber-500 text-amber-500" />
                                            )}
                                            <span className="text-sm leading-none">
                                                {countryCodeToFlag(code)}
                                            </span>
                                            <span className="uppercase">{code}</span>
                                        </span>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
