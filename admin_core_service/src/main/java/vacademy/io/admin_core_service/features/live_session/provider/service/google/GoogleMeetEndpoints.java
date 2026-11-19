package vacademy.io.admin_core_service.features.live_session.provider.service.google;

/**
 * Hardcoded Google OAuth + Meet/Workspace API endpoints.
 *
 * Google's public endpoints are globally stable; keeping them as code constants
 * (rather than {@code @Value} properties) avoids polluting application.properties
 * with values that never change across environments — same convention as
 * {@code ZoomEndpoints}.
 */
// vendor-call-log: URL constants; calls are recorded in GoogleOAuthService, GoogleMeetManager, GoogleConferenceService, GoogleAccountService, GoogleEventsSubscriptionService
public final class GoogleMeetEndpoints {

    /** Authorization-code consent screen for the "Connect Google Workspace" onboarding flow. */
    public static final String OAUTH_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";

    /** OAuth token endpoint — authorization_code exchange + refresh_token grant. */
    public static final String OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";

    /** Revoke a refresh/access token (best-effort on disconnect). */
    public static final String OAUTH_REVOKE_URL = "https://oauth2.googleapis.com/revoke";

    /** OpenID Connect userinfo — resolves the connected account's email (needs openid/email scope). */
    public static final String USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

    /** Base for all Google Meet REST API v2 calls (spaces, conferenceRecords). */
    public static final String MEET_API_BASE_URL = "https://meet.googleapis.com/v2";

    /** Google Workspace Events API — subscriptions that push Meet events to a Cloud Pub/Sub topic. */
    public static final String WORKSPACE_EVENTS_SUBSCRIPTIONS = "https://workspaceevents.googleapis.com/v1/subscriptions";

    private GoogleMeetEndpoints() {
        // utility — no instances
    }
}
