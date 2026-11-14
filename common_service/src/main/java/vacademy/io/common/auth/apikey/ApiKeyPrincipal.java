package vacademy.io.common.auth.apikey;

import lombok.Builder;
import lombok.Value;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.Collection;
import java.util.Set;

/**
 * Who is calling, when a request authenticated with an institute API key.
 *
 * <p>Mirrors the admin_core verify response
 * ({@code POST /admin-core-service/internal/api-keys/v1/verify}): the key itself plus the
 * institute's {@code institute_api_access} row for the product. It never holds the key or
 * its hash.
 */
@Value
public class ApiKeyPrincipal {

    public static final String STATUS_ACTIVE = "ACTIVE";

    String keyId;
    String instituteId;
    String name;
    Set<String> products;
    Set<String> scopes;
    /** ACTIVE | REVOKED. */
    String status;
    /** Null = never expires. */
    Instant expiresAt;

    // ---- limits (institute_api_access + per-key cap) ----
    /** Per-key daily copy cap; null = institute quota only. */
    Integer dailyCopyCap;
    String segment;
    String rateTier;
    Integer dailyCopyQuota;
    Integer dailyIdentifyPages;
    Integer dailyRubricGenerations;
    /** Null = platform default. */
    Integer copyLaneCap;
    /** Null = platform default. */
    Integer typedLaneCap;
    BigDecimal creditLimit;
    boolean fireWorkflowEvents;
    /** {@code institute_api_access(product).enabled}. */
    boolean accessEnabled;

    @Builder(toBuilder = true)
    private ApiKeyPrincipal(String keyId, String instituteId, String name, Collection<String> products,
            Collection<String> scopes, String status, Instant expiresAt, Integer dailyCopyCap, String segment,
            String rateTier, Integer dailyCopyQuota, Integer dailyIdentifyPages, Integer dailyRubricGenerations,
            Integer copyLaneCap, Integer typedLaneCap, BigDecimal creditLimit, boolean fireWorkflowEvents,
            boolean accessEnabled) {
        this.keyId = keyId;
        this.instituteId = instituteId;
        this.name = name;
        this.products = products == null ? Set.of() : Set.copyOf(products);
        this.scopes = scopes == null ? Set.of() : Set.copyOf(scopes);
        this.status = status;
        this.expiresAt = expiresAt;
        this.dailyCopyCap = dailyCopyCap;
        this.segment = segment;
        this.rateTier = rateTier;
        this.dailyCopyQuota = dailyCopyQuota;
        this.dailyIdentifyPages = dailyIdentifyPages;
        this.dailyRubricGenerations = dailyRubricGenerations;
        this.copyLaneCap = copyLaneCap;
        this.typedLaneCap = typedLaneCap;
        this.creditLimit = creditLimit;
        this.fireWorkflowEvents = fireWorkflowEvents;
        this.accessEnabled = accessEnabled;
    }

    public boolean hasScope(String scope) {
        return scope != null && scopes.contains(scope);
    }

    public boolean hasProduct(String product) {
        return product != null && products.contains(product);
    }

    public boolean isActive() {
        return STATUS_ACTIVE.equalsIgnoreCase(status);
    }

    /** True once {@code expiresAt} is at or before {@code now}. */
    public boolean isExpired(Instant now) {
        return expiresAt != null && !expiresAt.isAfter(now);
    }

    /** The actor recorded for billing and audit: {@code apikey:<key_id>}. */
    public String actorId() {
        return "apikey:" + keyId;
    }
}
