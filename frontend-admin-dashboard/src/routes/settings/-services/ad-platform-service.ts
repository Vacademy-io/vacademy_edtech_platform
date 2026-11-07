import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { BASE_URL } from '@/constants/urls';

const BASE = `${BASE_URL}/admin-core-service/v1/oauth/meta`;
const WEBHOOK_BASE = `${BASE_URL}/admin-core-service/api/v1/webhook`;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MetaPage {
    id: string;
    name: string;
    /** Page tasks the connecting user holds (MANAGE, MANAGE_LEADS, ADVERTISE, ...). */
    tasks?: string[];
    /** True when the user has the MANAGE task (Full control) — required to receive leads. */
    hasManageTask?: boolean;
    /** Alias of hasManageTask. When explicitly false, leads can't be auto-synced. */
    canReceiveLeads?: boolean;
    /** Warning to show next to a page the user can pick but that won't deliver leads. */
    warning?: string | null;
}

export interface PlatformFormField {
    key: string;
    label: string;
    type: string;
    standardField: boolean;
}

export interface AdConnectorSetupRequest {
    vendor: string;
    instituteId: string;
    audienceId: string;
    platformPageId?: string;
    platformFormId: string;
    /** Human-readable form name (e.g. "Wakad_leadform_2026"). Persisted so the
     *  connector list can show names instead of opaque IDs. */
    platformFormName?: string;
    routingRulesJson?: string;
    fieldMappingJson?: string;
    producesSourceType?: string;
    sessionKey?: string;
    selectedPageId?: string;
    googleKey?: string;
    /**
     * Stringified JSON object of per-connector defaults stamped onto every
     * lead (e.g. '{"Center Name":"Wakad"}'). Form values always win.
     */
    defaultValuesJson?: string;
}

export interface ConnectorSaveResult {
    connector_id: string;
    status: string;
    message: string;
    page_name?: string;
    webhook_url?: string;
    /** Google only: the server-generated key — paste it into Google Ads with the URL. */
    google_key?: string;
    /** "true"/"false" — whether the page→app webhook subscribe actually succeeded. */
    subscribed?: string;
}

// ── Meta OAuth endpoints ─────────────────────────────────────────────────────

/** Step 1: Get Meta OAuth URL. Frontend navigates browser there. */
export const initiateMetaOAuth = async (
    instituteId: string,
    audienceId?: string
): Promise<{ oauth_url: string; session_key: string }> => {
    const params: Record<string, string> = { instituteId };
    if (audienceId) params.audienceId = audienceId;
    // Tell the backend which origin started the flow so the OAuth callback returns
    // the browser to THIS domain (works for white-label custom domains, not just
    // dash.vacademy.io). The backend validates it against the institute's hosts.
    if (typeof window !== 'undefined') params.frontendOrigin = window.location.origin;
    const res = await authenticatedAxiosInstance.post(`${BASE}/initiate`, null, { params });
    return res.data;
};

/** Step 3: Fetch pages for a session (after callback). Returns safe data — no tokens. */
export const getSessionPages = async (sessionKey: string): Promise<MetaPage[]> => {
    const res = await authenticatedAxiosInstance.get(`${BASE}/session/${sessionKey}/pages`);
    return res.data;
};

/** Step 4: Fetch form fields via the session (no token exposed to frontend). */
export const getFormFields = async (
    sessionKey: string,
    formId: string,
    pageId: string
): Promise<PlatformFormField[]> => {
    const res = await authenticatedAxiosInstance.get(
        `${BASE}/session/${sessionKey}/forms/${formId}/fields`,
        { params: { pageId } }
    );
    return res.data;
};

/**
 * Fallback: resolve a Page by its ID when the picker is empty.
 * Business-owned Pages granted via Facebook Login for Business don't appear in
 * /me/accounts for regular users, but are still fetchable by ID. The admin pastes
 * the Page ID (shown in Meta's connect dialog) and we add it to the session.
 */
export const resolvePageById = async (sessionKey: string, pageId: string): Promise<MetaPage> => {
    const res = await authenticatedAxiosInstance.post(
        `${BASE}/session/${sessionKey}/pages/resolve`,
        null,
        { params: { pageId } }
    );
    return res.data;
};

/** Step 4a: List lead gen forms for a page (after page selection). */
export const listPageForms = async (
    sessionKey: string,
    pageId: string
): Promise<{ id: string; name: string; status: string }[]> => {
    const res = await authenticatedAxiosInstance.get(
        `${BASE}/session/${sessionKey}/pages/${pageId}/forms`
    );
    return Array.isArray(res.data) ? res.data : [];
};

/** Step 5: Save a Meta connector. */
export const saveMetaConnector = async (
    request: AdConnectorSetupRequest
): Promise<ConnectorSaveResult> => {
    const res = await authenticatedAxiosInstance.post(`${BASE}/connector`, request);
    return res.data;
};

// ── Google endpoints ──────────────────────────────────────────────────────────

/**
 * Save a Google Lead Form connector (no OAuth needed). Omit googleKey to have the
 * server generate one; it comes back as google_key. platform_form_id is set server-side.
 */
export const saveGoogleConnector = async (
    request: Omit<AdConnectorSetupRequest, 'platformFormId'>
): Promise<ConnectorSaveResult> => {
    const res = await authenticatedAxiosInstance.post(`${BASE}/google/connector`, request);
    return res.data;
};

// ── Connector list + deactivate ───────────────────────────────────────────

export interface ConnectorListItem {
    id: string;
    vendor: string;
    /** Vendor-side id — e.g. the Zoho form code 'JS-114', the Meta form id, the Google key. */
    vendorId: string | null;
    audienceId: string;
    platformPageId: string | null;
    platformFormId: string | null;
    /** Human-readable form name captured at create time. Null on older rows. */
    platformFormName: string | null;
    connectionStatus: string;
    /** Human reason/remediation when connectionStatus is not ACTIVE (e.g. needs Full control). */
    statusDetail?: string | null;
    lastCheckedAt?: string | null;
    producesSourceType: string | null;
    createdAt: string | null;
    tokenExpiresAt: string | null;
    /**
     * Stringified JSON of per-connector default values merged into form payloads
     * at webhook time (e.g. center name, schedule link, school phone). Null/empty
     * means no defaults are configured.
     */
    defaultValuesJson: string | null;
    /** Google: campaigns that sent leads but have no list yet (they feed the main list). */
    unmappedCampaigns?: number | null;
}

/**
 * List active connectors for an institute. By default returns only ad-platform
 * connectors (Meta/Google) for the Integrations screen. Pass includeAllVendors=true
 * to also get Zoho/Google-Forms/Microsoft connectors for the Center Management screen.
 */
export const listConnectors = async (
    instituteId: string,
    includeAllVendors = false
): Promise<ConnectorListItem[]> => {
    const res = await authenticatedAxiosInstance.get(`${BASE}/connectors`, {
        params: includeAllVendors ? { instituteId, includeAllVendors: true } : { instituteId },
    });
    // Guard: API may return non-array on error or if endpoint isn't deployed yet
    return Array.isArray(res.data) ? res.data : [];
};

/** Deactivate (soft-delete) a connector. */
export const deactivateConnector = async (connectorId: string): Promise<void> => {
    await authenticatedAxiosInstance.delete(`${BASE}/connectors/${connectorId}`);
};

// ── Connection health + re-subscribe ──────────────────────────────────────

export interface ConnectorHealthCheck {
    /** TOKEN | SUBSCRIPTION | LEAD_READ | HEARTBEAT */
    key: string;
    label: string;
    status: 'PASS' | 'WARN' | 'FAIL' | 'SKIP';
    message: string;
    remediation?: string | null;
}

export interface ConnectorHealth {
    connectorId: string;
    vendor: string;
    /** VERIFIED | DEGRADED | ACTION_REQUIRED | BROKEN | UNKNOWN */
    overall: string;
    lastLeadAt?: string | null;
    checks: ConnectorHealthCheck[];
}

/**
 * Run a live health check ("Test connection") on a connector — verifies the
 * whole lead-delivery chain (token, page→app subscription, lead-read, heartbeat).
 * Side effect: the server flips the connector to ACTION_REQUIRED (or back to
 * ACTIVE) based on the result, so callers should refetch the connector list.
 */
export const checkConnectorHealth = async (connectorId: string): Promise<ConnectorHealth> => {
    const res = await authenticatedAxiosInstance.get(`${BASE}/connectors/${connectorId}/health`);
    return res.data;
};

/**
 * Re-attempt the page→app webhook subscription using the connector's stored
 * token. Use after granting the connecting account Full control of the Page.
 */
export const resubscribeConnector = async (connectorId: string): Promise<ConnectorSaveResult> => {
    const res = await authenticatedAxiosInstance.post(
        `${BASE}/connectors/${connectorId}/resubscribe`
    );
    return res.data;
};

export interface PollResult {
    connector_id: string;
    /** How many leads Meta returned for the window (before dedup). */
    fetched: number;
    since_minutes: number;
    /** True if the window held more leads than one pull returns (older ones remain). */
    truncated?: boolean;
    message: string;
}

/**
 * Pull leads on demand for a Meta connector (last `sinceMinutes`, default 24h).
 * Use when realtime push is blocked (Meta CRM access revoked) to sync immediately,
 * or pass a large window to backfill history. Already-delivered leads dedup, so
 * it's safe to run repeatedly.
 */
export const pollConnectorNow = async (
    connectorId: string,
    sinceMinutes?: number
): Promise<PollResult> => {
    const res = await authenticatedAxiosInstance.post(
        `${BASE}/connectors/${connectorId}/poll`,
        null,
        { params: sinceMinutes ? { sinceMinutes } : {} }
    );
    return res.data;
};

/** Fetch a single connector by id (includes defaultValuesJson for editing). */
export const getConnector = async (connectorId: string): Promise<ConnectorListItem> => {
    const res = await authenticatedAxiosInstance.get<ConnectorListItem>(
        `${BASE}/connectors/${connectorId}`
    );
    return res.data;
};

/** Partial update of a connector. Only non-undefined fields are applied server-side. */
export interface ConnectorUpdateRequest {
    /**
     * Stringified JSON object, e.g.
     * '{"center name": "Baner", "Schedule Link": "https://...", "School Phone": "..."}'.
     * Pass '{}' to clear all defaults.
     */
    defaultValuesJson?: string;
    /** Display name for the connector; '' clears it. Omit to leave it unchanged. */
    platformFormName?: string;
}

export const updateConnector = async (
    connectorId: string,
    payload: ConnectorUpdateRequest
): Promise<ConnectorListItem> => {
    const res = await authenticatedAxiosInstance.put<ConnectorListItem>(
        `${BASE}/connectors/${connectorId}`,
        payload
    );
    return res.data;
};

/** Fetch custom fields configured for a specific audience (campaign). */
export interface AudienceCustomField {
    id: string;
    fieldName: string;
    fieldType: string;
}

export const fetchAudienceCustomFields = async (
    instituteId: string,
    audienceId: string
): Promise<AudienceCustomField[]> => {
    const res = await authenticatedAxiosInstance.get(
        `${BASE_URL}/admin-core-service/common/custom-fields/feature-fields`,
        { params: { instituteId, type: 'AUDIENCE_FORM', typeId: audienceId } }
    );
    const raw = Array.isArray(res.data) ? res.data : [];
    return raw.map(
        (r: { custom_field?: { id?: string; fieldName?: string; fieldType?: string } }) => ({
            id: r.custom_field?.id ?? '',
            fieldName: r.custom_field?.fieldName ?? '',
            fieldType: r.custom_field?.fieldType ?? 'TEXT',
        })
    );
};

/** Build field_mapping_json from the UI mapping rows. */
export const buildFieldMappingJson = (
    mappings: { platformKey: string; targetFieldName: string }[]
): string => {
    return JSON.stringify({
        mappings: mappings
            .filter((m) => m.platformKey && m.targetFieldName)
            .map((m) => ({
                platform_key: m.platformKey,
                // target uses the raw field_name — saveCustomFieldValuesByFieldName matches by name
                target: m.targetFieldName,
            })),
        unmapped_field_action: 'KEEP_ORIGINAL',
    });
};

/** Build the full Google webhook URL for display. */
// ── Google campaign → lead list routing ──────────────────────────────────────

/** One Google campaign of a connector and the list its leads go to (snake_case: API shape). */
export interface CampaignRoute {
    campaign_id: string;
    /** null = not mapped yet: its leads go to the connector's main list. */
    audience_id: string | null;
    /** Admin-entered name (Google's webhook sends only the id); null until named. */
    campaign_name: string | null;
    lead_count: number;
    /** UTC, zone-less (the server JVM runs in UTC). */
    first_lead_at: string | null;
    last_lead_at: string | null;
    added_manually: boolean;
}

export interface CampaignRoutes {
    /** The connector's own list: the catch-all for campaigns without a list. */
    main_audience_id: string;
    routes: CampaignRoute[];
    /** New campaigns get their own list on their first lead. */
    auto_create_lists: boolean;
}

export interface CampaignRouteUpdate {
    audience_id?: string;
    /** Create this list and route the campaign to it (wins over audience_id). */
    new_list?: { name: string; campaign_type?: string };
    move_existing_leads?: boolean;
    /** The campaign's name from Google Ads; blank clears it. Sent alone, it only names it. */
    campaign_name?: string;
}

export interface CampaignRouteUpdateResult {
    route: CampaignRoute;
    created_audience_id: string | null;
    moved_leads: number;
    skipped_leads: number;
}

export const campaignRoutesQueryKey = (connectorId: string) =>
    ['google-campaign-routes', connectorId] as const;

export const fetchCampaignRoutes = async (connectorId: string): Promise<CampaignRoutes> => {
    const res = await authenticatedAxiosInstance.get<CampaignRoutes>(
        `${BASE}/connectors/${connectorId}/campaign-routes`
    );
    return res.data;
};

/** Route a campaign to a list (also maps a campaign id before its first lead). */
export const updateCampaignRoute = async (
    connectorId: string,
    campaignId: string,
    update: CampaignRouteUpdate
): Promise<CampaignRouteUpdateResult> => {
    const res = await authenticatedAxiosInstance.put<CampaignRouteUpdateResult>(
        `${BASE}/connectors/${connectorId}/campaign-routes/${encodeURIComponent(campaignId)}`,
        update
    );
    return res.data;
};

/** Turn "a new list for each new campaign" on or off for a connector. */
export const setCampaignAutoLists = async (
    connectorId: string,
    enabled: boolean
): Promise<CampaignRoutes> => {
    const res = await authenticatedAxiosInstance.put<CampaignRoutes>(
        `${BASE}/connectors/${connectorId}/campaign-auto-lists`,
        { enabled }
    );
    return res.data;
};

/** Remove a campaign added by mistake (only while it has sent no leads). */
export const deleteCampaignRoute = async (connectorId: string, campaignId: string) => {
    await authenticatedAxiosInstance.delete(
        `${BASE}/connectors/${connectorId}/campaign-routes/${encodeURIComponent(campaignId)}`
    );
};

/**
 * The id to show for a connector in lists. A Google connector's platform_form_id IS
 * its webhook key (a credential), so only its last four characters are shown.
 */
export const connectorDisplayId = (c: Pick<ConnectorListItem, 'vendor' | 'platformFormId'>) => {
    if (!c.platformFormId) return null;
    if (c.vendor === 'GOOGLE_LEAD_ADS') return `••••${c.platformFormId.slice(-4)}`;
    return c.platformFormId;
};

export const buildGoogleWebhookUrl = (googleKey: string): string =>
    `${WEBHOOK_BASE}/google/${googleKey}`;
