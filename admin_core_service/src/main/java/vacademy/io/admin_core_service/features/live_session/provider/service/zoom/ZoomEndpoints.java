package vacademy.io.admin_core_service.features.live_session.provider.service.zoom;

/**
 * Hardcoded Zoom API + OAuth endpoints.
 *
 * Zoom's public endpoints are globally stable; keeping them as code constants
 * (rather than {@code @Value} properties) avoids polluting application.properties
 * with values that never change across environments. If Zoom ever regionalises
 * an endpoint, override here in code — a deliberate code change is the right
 * trigger for that kind of switch.
 */
// vendor-call-log: URL constants; calls are recorded in ZoomMeetingManager, ZoomAccessTokenService, ZoomOAuthService, ZoomAccountService
public final class ZoomEndpoints {

    /** OAuth token endpoint — both account_credentials (S2S) and authorization_code/refresh_token (Connect-with-Zoom). */
    public static final String OAUTH_TOKEN_URL = "https://zoom.us/oauth/token";

    /** Authorization-code consent screen for the "Connect with Zoom" onboarding flow. */
    public static final String OAUTH_AUTHORIZE_URL = "https://zoom.us/oauth/authorize";

    /** Base for all Zoom REST API calls (meetings, recordings, users, etc.). */
    public static final String API_BASE_URL = "https://api.zoom.us/v2";

    private ZoomEndpoints() {
        // utility — no instances
    }
}
