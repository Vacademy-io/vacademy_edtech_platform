package vacademy.io.auth_service.feature.panel.phase2.release;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

import java.util.Arrays;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * Settings of the app release registry. The on/off switch is panel.releases.enabled in
 * PanelPhase2Properties; these only shape what a release may contain. Read once at boot.
 *
 * <pre>
 *   panel.releases.allowed-hosts         (empty)                      comma list of exact host names an
 *                                                                     APK may be downloaded from; empty
 *                                                                     means no download link is accepted
 *   panel.releases.direct-package-name   io.vacademy.classroom.direct the package every direct build has
 *   panel.releases.signing-cert-sha256   (empty)                      SHA-256 of the direct signing
 *                                                                     certificate; empty means no direct
 *                                                                     release can be registered or go LIVE
 *   panel.releases.max-size-bytes        209715200                    largest APK a release may declare
 *   panel.releases.cache-seconds         60                           how long a pod keeps the LIVE list
 * </pre>
 */
@Component
public class PanelReleaseSettings {

    private final Set<String> allowedHosts;
    private final String directPackageName;
    private final String signingCertSha256;
    private final long maxSizeBytes;
    private final int cacheSeconds;

    @Autowired
    public PanelReleaseSettings(Environment environment) {
        this(environment::getProperty);
    }

    private PanelReleaseSettings(Function<String, String> lookup) {
        this.allowedHosts = Arrays.stream(text(lookup, "panel.releases.allowed-hosts", "").split(","))
                .map(host -> host.trim().toLowerCase(Locale.ROOT))
                .filter(host -> !host.isEmpty())
                .collect(Collectors.toUnmodifiableSet());
        this.directPackageName = text(lookup, "panel.releases.direct-package-name", "io.vacademy.classroom.direct")
                .trim();
        String cert = normaliseDigest(text(lookup, "panel.releases.signing-cert-sha256", ""));
        this.signingCertSha256 = cert == null ? "" : cert;
        this.maxSizeBytes = Math.max(1, longValue(lookup, "panel.releases.max-size-bytes", 209_715_200L));
        this.cacheSeconds = Math.max(1, (int) longValue(lookup, "panel.releases.cache-seconds", 60));
    }

    /** For tests: the given properties, every other one at its default. */
    public static PanelReleaseSettings of(Map<String, String> values) {
        return new PanelReleaseSettings(values::get);
    }

    private static String text(Function<String, String> lookup, String key, String fallback) {
        String value = lookup.apply(key);
        return value == null || value.isBlank() ? fallback : value;
    }

    private static long longValue(Function<String, String> lookup, String key, long fallback) {
        try {
            return Long.parseLong(text(lookup, key, String.valueOf(fallback)).trim());
        } catch (NumberFormatException e) {
            return fallback;
        }
    }

    /**
     * A SHA-256 digest as 64 lowercase hex characters. Colons and spaces (the way signing tools print
     * certificate digests) are removed first. Null when the value is not a SHA-256 digest.
     */
    public static String normaliseDigest(String value) {
        if (value == null) {
            return null;
        }
        String hex = value.replace(":", "").replace(" ", "").trim().toLowerCase(Locale.ROOT);
        return hex.matches("[0-9a-f]{64}") ? hex : null;
    }

    public boolean isAllowedHost(String host) {
        return host != null && allowedHosts.contains(host.toLowerCase(Locale.ROOT));
    }

    public Set<String> getAllowedHosts() {
        return allowedHosts;
    }

    public String getDirectPackageName() {
        return directPackageName;
    }

    /** Empty when not configured. */
    public String getSigningCertSha256() {
        return signingCertSha256;
    }

    public boolean hasSigningCert() {
        return !signingCertSha256.isEmpty();
    }

    public long getMaxSizeBytes() {
        return maxSizeBytes;
    }

    public int getCacheSeconds() {
        return cacheSeconds;
    }
}
