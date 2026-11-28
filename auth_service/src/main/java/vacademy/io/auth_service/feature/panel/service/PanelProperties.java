package vacademy.io.auth_service.feature.panel.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

import java.util.Arrays;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * Switches for the panel feature. All have defaults here, so no properties file changes. They are
 * read at boot: changing one means setting an env var (PANEL_ENABLED and so on) and a rolling
 * restart, not an instant flip.
 */
@Component
public class PanelProperties {

    private final boolean enabled;
    private final boolean remoteEnabled;
    private final double pollMultiplier;
    private final int publicMaxConcurrent;
    private final boolean voltLive;
    private final int bbbInAppMinWebview;
    private final int idleMinutes;
    private final int sessionHours;
    private final int minAppVersionCode;
    private final String approveDefaultBaseUrl;
    private final Set<String> allowedInstitutes;
    private final List<PanelIps.Cidr> trustedProxies;
    private final int sessionStartsPerUserPerHour;

    /** With the default limit on session starts, for tests. */
    public PanelProperties(boolean enabled, boolean remoteEnabled, double pollMultiplier, int publicMaxConcurrent,
            boolean voltLive, int bbbInAppMinWebview, int idleMinutes, int sessionHours, int minAppVersionCode,
            String approveDefaultBaseUrl, String allowedInstitutes, String trustedProxies) {
        this(enabled, remoteEnabled, pollMultiplier, publicMaxConcurrent, voltLive, bbbInAppMinWebview, idleMinutes,
                sessionHours, minAppVersionCode, approveDefaultBaseUrl, allowedInstitutes, trustedProxies,
                PanelRateLimiter.SESSION_STARTS_PER_USER_PER_HOUR);
    }

    @Autowired
    public PanelProperties(
            @Value("${panel.enabled:false}") boolean enabled,
            @Value("${panel.remote.enabled:true}") boolean remoteEnabled,
            @Value("${panel.poll.multiplier:1}") double pollMultiplier,
            @Value("${panel.public.max-concurrent:4}") int publicMaxConcurrent,
            @Value("${panel.flags.volt-live:false}") boolean voltLive,
            @Value("${panel.flags.bbb-in-app-min-webview:9999}") int bbbInAppMinWebview,
            @Value("${panel.policy.idle-minutes:30}") int idleMinutes,
            @Value("${panel.policy.session-hours:4}") int sessionHours,
            @Value("${panel.min-app-version-code:1}") int minAppVersionCode,
            @Value("${panel.approve.default-base-url:https://classroom.vacademy.io}") String approveDefaultBaseUrl,
            @Value("${panel.allowed-institutes:}") String allowedInstitutes,
            @Value("${panel.trusted-proxies:}") String trustedProxies,
            @Value("${panel.limits.session-starts-per-user-per-hour:20}") int sessionStartsPerUserPerHour) {
        this.enabled = enabled;
        this.remoteEnabled = remoteEnabled;
        this.pollMultiplier = pollMultiplier;
        this.publicMaxConcurrent = publicMaxConcurrent;
        this.voltLive = voltLive;
        this.bbbInAppMinWebview = bbbInAppMinWebview;
        this.idleMinutes = idleMinutes;
        this.sessionHours = sessionHours;
        this.minAppVersionCode = minAppVersionCode;
        this.approveDefaultBaseUrl = approveDefaultBaseUrl;
        this.allowedInstitutes = allowedInstitutes == null ? Set.of()
                : Arrays.stream(allowedInstitutes.split(",")).map(String::trim).filter(id -> !id.isEmpty())
                        .collect(Collectors.toUnmodifiableSet());
        this.trustedProxies = PanelIps.parseCidrs(trustedProxies);
        this.sessionStartsPerUserPerHour = Math.max(1, sessionStartsPerUserPerHour);
    }

    /**
     * panel.limits.session-starts-per-user-per-hour, per pod. Raised only for a local test run that
     * signs the same test teacher in more often than any real teacher would.
     */
    public int getSessionStartsPerUserPerHour() {
        return sessionStartsPerUserPerHour;
    }

    public boolean isEnabled() {
        return enabled;
    }

    public void requireEnabled() {
        if (!enabled) {
            throw PanelApiException.disabled();
        }
    }

    /**
     * panel.allowed-institutes, a comma list of institute ids. Empty means every institute. Checked
     * where a panel joins an institute (claim) and where a session starts (scan, approve, password).
     */
    public void requireInstituteAllowed(String instituteId) {
        if (!allowedInstitutes.isEmpty() && (instituteId == null || !allowedInstitutes.contains(instituteId))) {
            throw new PanelApiException(HttpStatus.FORBIDDEN, "PANEL_DISABLED",
                    "Classroom panels are not available for this institute");
        }
    }

    /**
     * panel.trusted-proxies, comma-separated CIDRs. Empty means forwarded client-IP headers are read
     * from any peer. Otherwise they are read only when the socket peer is in one of these ranges.
     */
    public List<PanelIps.Cidr> getTrustedProxies() {
        return trustedProxies;
    }

    public boolean isRemoteEnabled() {
        return remoteEnabled;
    }

    /** A base interval scaled by panel.poll.multiplier, which slows shipped APKs at their next sync. */
    public int poll(int baseMs) {
        return (int) Math.round(baseMs * pollMultiplier);
    }

    public int getPublicMaxConcurrent() {
        return publicMaxConcurrent;
    }

    public boolean isVoltLive() {
        return voltLive;
    }

    public int getBbbInAppMinWebview() {
        return bbbInAppMinWebview;
    }

    public int getIdleMinutes() {
        return idleMinutes;
    }

    public int getSessionHours() {
        return sessionHours;
    }

    public int getMinAppVersionCode() {
        return minAppVersionCode;
    }

    public String getApproveDefaultBaseUrl() {
        return approveDefaultBaseUrl;
    }
}
