package vacademy.io.admin_core_service.features.white_label.service;

import lombok.Builder;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.domain_routing.entity.InstituteDomainRouting;
import vacademy.io.common.institute.entity.Institute;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Decides which of an institute's configured white-label hosts becomes its stored
 * portal URL — {@code institutes.learner_portal_base_url},
 * {@code admin_portal_base_url} and {@code teacher_portal_base_url} — and writes
 * it there once the host actually serves.
 *
 * <p><b>Why this is not just "save what the admin typed".</b> Those three columns
 * are the origin of every link the platform mails a human: enrollment mails,
 * credential shares, report links, {@code LearnerPortalUrlResolver}. Writing a
 * host into them the moment it is submitted is writing a link before it works — a
 * Cloudflare Pages custom domain sits in {@code pending} until the customer points
 * their CNAME at {@code <project>.pages.dev} and Cloudflare validates it, which is
 * hours away and sometimes never. So adoption is gated on {@link Activation#ACTIVE}
 * and re-evaluated on every setup and status read: the admin adds a portal, and the
 * institute row picks it up by itself the moment it goes live.
 *
 * <p><b>The rules, per role.</b> In order, first match wins:
 * <ol>
 *   <li>The row the admin flagged {@code is_primary}, if ACTIVE — a deliberate
 *       choice, so it overrides even a working incumbent. Unless legacy data
 *       flagged two rows for the same role, in which case there is no choice to
 *       honour and a live incumbent is kept instead of a coin flip.</li>
 *   <li>The stored column, if it names a configured host that is ACTIVE — leave it
 *       alone. Without this the columns would flap between equally-live domains
 *       every time an admin opened the settings page.</li>
 *   <li>The first ACTIVE candidate, but only when the column is safe to claim:
 *       blank, a platform-default host nobody chose (the {@code V1} column
 *       defaults, e.g. {@code learner.vacademy.io}), or a configured host that is
 *       no longer live. This is the case the feature exists for.</li>
 *   <li>Otherwise nothing. A curated URL that is not among the configured hosts —
 *       set by hand, or by an older tool — is somebody's decision this class knows
 *       nothing about, and is never overwritten.</li>
 * </ol>
 *
 * <p>Roles outside LEARNER/ADMIN/TEACHER (institute custom roles such as
 * {@code MANAGE_LEAD}) have no column to adopt into; their branding lives on the
 * routing row alone and they are skipped.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class PortalUrlReconciler {

    public static final String ROLE_LEARNER = "LEARNER";
    public static final String ROLE_ADMIN = "ADMIN";
    public static final String ROLE_TEACHER = "TEACHER";

    /** The roles that own a column on {@code institutes}. */
    public static final List<String> PORTAL_ROLES = List.of(ROLE_LEARNER, ROLE_ADMIN, ROLE_TEACHER);

    /**
     * The {@code V1__Initial_schema.sql} defaults for the three columns. A row
     * carrying one of these was stamped at creation, not chosen, so it may be
     * claimed by the first branded host that goes live. Kept as literals rather
     * than derived from the CNAME-target properties because they are a fact about
     * what is already in the database, not about how this deployment is wired.
     */
    private static final Map<String, String> PLATFORM_DEFAULT_HOST = Map.of(
            ROLE_LEARNER, "learner.vacademy.io",
            ROLE_ADMIN, "dash.vacademy.io",
            ROLE_TEACHER, "teacher.vacademy.io");

    private static final String CF_STATUS_ACTIVE = "active";

    @Value("${cloudflare.learner.target:learner.vacademy.io}")
    private String learnerCnameTarget;

    @Value("${cloudflare.admin.target:dash.vacademy.io}")
    private String adminCnameTarget;

    @Value("${cloudflare.teacher.target:teacher.vacademy.io}")
    private String teacherCnameTarget;

    @Value("${cloudflare.learner.pages-project:}")
    private String learnerPagesProject;

    @Value("${cloudflare.admin.pages-project:}")
    private String adminPagesProject;

    @Value("${vacademy.base.domain:vacademy.io}")
    private String vacademyBaseDomain;

    private final CloudflareService cloudflareService;

    // ── Activation ────────────────────────────────────────────────────────────

    /** Whether a configured host actually serves the SPA right now. */
    public enum Activation {
        /** Cloudflare serves it — safe to put in an email. */
        ACTIVE,
        /** Attached but not validated yet; it will start serving on its own. */
        PENDING,
        /** Not attached, or Cloudflare could not be asked. Treated as not serving. */
        UNKNOWN
    }

    /**
     * Per-request memo over the Cloudflare Pages lookups. One host is asked about
     * by both the reconcile pass and the status rendering, and every miss is an
     * HTTP round trip, so a status page with eight routing rows should make eight
     * calls rather than sixteen. Not thread-safe and not shared between requests —
     * a Pages domain that goes active mid-request should still read as pending
     * consistently for the whole of it.
     */
    public final class ActivationProbe {
        private final Map<String, String> statusCache = new HashMap<>();

        /**
         * Projects whose custom domains have been listed in full. A host missing
         * from the cache for one of these is <em>known</em> to be unattached, so it
         * must not trigger a lookup that can only confirm that.
         */
        private final Set<String> enumeratedProjects = new LinkedHashSet<>();

        private ActivationProbe() {
        }

        /**
         * Records Cloudflare's complete custom-domain listing for a Pages project,
         * so every host on it — and every host absent from it — is answered without
         * a further round trip. Used by the reconcile sweep, which asks about every
         * configured host on the platform and would otherwise pay one HTTP call per
         * routing row.
         *
         * @param statusByHost host → raw status, as returned by
         *                     {@code CloudflareService.listPagesCustomDomains}. Pass
         *                     null (a listing that failed) to leave the project
         *                     un-enumerated and fall back to per-host lookups; an
         *                     incomplete listing recorded as complete would read as
         *                     "nothing is attached" and quietly stop all adoption.
         */
        public void seedProjectListing(String project, Map<String, String> statusByHost) {
            if (!StringUtils.hasText(project) || statusByHost == null) {
                return;
            }
            statusByHost.forEach((host, status) -> {
                String normalized = normalizeHost(host);
                if (normalized != null) {
                    statusCache.put(project + "|" + normalized, status);
                }
            });
            enumeratedProjects.add(project);
        }

        /**
         * Records a status Cloudflare has already reported, so the caller does not
         * pay for a second round trip to be told the same thing. Used by the setup
         * path, where attaching each Pages custom domain already returns its status.
         */
        public void seed(String host, String role, String status) {
            String project = pagesProjectForRole(role);
            if (!StringUtils.hasText(host) || !StringUtils.hasText(project) || status == null) {
                return;
            }
            statusCache.put(project + "|" + normalizeHost(host), status);
        }

        /**
         * Cloudflare's raw custom-domain status for {@code host} on the project that
         * serves {@code role} ("active" / "pending" / "initializing" / …), or null
         * when Pages is not configured, the role has no project, or the host is not
         * attached. Never throws.
         */
        public String rawPagesStatus(String host, String role) {
            String project = pagesProjectForRole(role);
            if (!StringUtils.hasText(host) || !StringUtils.hasText(project)) {
                return null;
            }
            String normalized = normalizeHost(host);
            String key = project + "|" + normalized;
            // containsKey, not computeIfAbsent: a host that is NOT attached looks up
            // as null, and computeIfAbsent refuses to store a null — so the miss
            // would be re-fetched on every consultation. The unattached host is
            // exactly the one a status page asks about twice.
            if (!statusCache.containsKey(key)) {
                if (enumeratedProjects.contains(project)) {
                    // The full listing was seeded and this host was not in it.
                    return null;
                }
                statusCache.put(key, cloudflareService.getPagesCustomDomainStatus(project, normalized));
            }
            return statusCache.get(key);
        }

        /** See {@link Activation}. */
        public Activation of(String host, String role) {
            if (!StringUtils.hasText(host)) {
                return Activation.UNKNOWN;
            }
            String project = pagesProjectForRole(role);
            if (cloudflareService.isPagesEnabled() && StringUtils.hasText(project)) {
                String status = rawPagesStatus(host, role);
                if (!StringUtils.hasText(status)) {
                    // Not attached to the project, or the lookup failed. Either way we
                    // have no evidence it serves, and a portal URL is not the place to
                    // guess optimistically.
                    return Activation.UNKNOWN;
                }
                return CF_STATUS_ACTIVE.equalsIgnoreCase(status.trim())
                        ? Activation.ACTIVE
                        : Activation.PENDING;
            }
            // Pages provisioning is off on this deployment, so the legacy DNS-only path
            // ran instead. An in-zone *.vacademy.io host got a proxied CNAME and serves
            // immediately; an external customer domain could not be provisioned at all.
            return isVacademySubdomain(host) ? Activation.ACTIVE : Activation.UNKNOWN;
        }
    }

    public ActivationProbe newProbe() {
        return new ActivationProbe();
    }

    // ── Reconcile ─────────────────────────────────────────────────────────────

    /** What one reconcile pass decided. */
    @Data
    @Builder
    public static class ReconcileResult {
        /** role → URL newly written into the institute row this pass. Empty when nothing moved. */
        private Map<String, String> adoptedUrlByRole;

        /** Human-readable notes for the setup response (e.g. "pending, will be adopted"). */
        private List<String> warnings;

        /** True when {@code institute} was mutated and the caller must save it. */
        private boolean changed;
    }

    /**
     * Applies the rules above to {@code institute}, mutating its portal-URL fields
     * in place. Does <em>not</em> save — the caller owns the transaction and knows
     * whether a write is wanted.
     *
     * @param routings every routing row for the institute; hosts are taken from
     *                 here rather than from a request body so that a host added in
     *                 an earlier session is still reconsidered once it goes live.
     */
    public ReconcileResult reconcile(Institute institute, List<InstituteDomainRouting> routings,
            ActivationProbe probe) {

        Map<String, String> adopted = new LinkedHashMap<>();
        List<String> warnings = new ArrayList<>();

        if (institute == null) {
            return ReconcileResult.builder()
                    .adoptedUrlByRole(adopted).warnings(warnings).changed(false).build();
        }

        for (String role : PORTAL_ROLES) {
            List<String> candidates = candidateHostsForRole(routings, role);
            if (candidates.isEmpty()) {
                continue;
            }

            String storedHost = normalizeHost(currentPortalUrl(institute, role));
            String chosen = choose(role, candidates, storedHost, routings, probe, warnings);

            if (chosen == null || chosen.equals(storedHost)) {
                continue;
            }
            String url = "https://" + chosen;
            setPortalUrl(institute, role, url);
            adopted.put(role, url);
            log.info("[WhiteLabel] Adopted {} portal URL for institute {}: {} (was {})",
                    role, institute.getId(), url,
                    StringUtils.hasText(storedHost) ? storedHost : "unset");
        }

        return ReconcileResult.builder()
                .adoptedUrlByRole(adopted)
                .warnings(warnings)
                .changed(!adopted.isEmpty())
                .build();
    }

    /**
     * Returns the host to store for {@code role}, or null to leave the column as it
     * is. Implements the four ordered rules in the class javadoc.
     */
    private String choose(String role, List<String> candidates, String storedHost,
            List<InstituteDomainRouting> routings, ActivationProbe probe, List<String> warnings) {

        // Rule 1 — the admin's flagged choice, once it serves.
        List<String> primaries = primaryHostsForRole(routings, role);
        if (!primaries.isEmpty()) {
            // "At most one primary per role token" is enforced on write, but legacy
            // rows violate it — three institutes did as of 2026-09-09, courtesy of a
            // V486 backfill row plus a later setup flagging a second host. When the
            // invariant is broken there is no admin choice to honour, only a tie, and
            // breaking it by sort order demotes whichever branded host happens to sort
            // late: EduStream's teacher portal would have moved teacher.edustream.ae →
            // admin.edustream.ae, and Brahm Varchas' learners would have been mailed
            // brahmvarchas.vacademy.io instead of learning.brahmvarchas.org. The
            // column already names one of the tied hosts, and that is real evidence of
            // intent where alphabetical order is none — so a live incumbent holds.
            if (primaries.size() > 1
                    && StringUtils.hasText(storedHost)
                    && primaries.contains(storedHost)
                    && probe.of(storedHost, role) == Activation.ACTIVE) {
                warnings.add("More than one " + role.toLowerCase(Locale.ROOT)
                        + " domain is marked as the portal URL (" + String.join(", ", primaries)
                        + "). Keeping " + storedHost
                        + ", which is the one currently in use — clear the extra stars to change it.");
                return null;
            }
            // Prefer a primary that actually serves over one that merely sorts first;
            // with the invariant intact there is only ever one to choose from.
            String host = primaries.stream()
                    .filter(h -> probe.of(h, role) == Activation.ACTIVE)
                    .findFirst()
                    .orElse(null);
            if (host != null) {
                return host;
            }
            String stalled = primaries.get(0);
            warnings.add(stalled + " is marked as the " + role.toLowerCase(Locale.ROOT)
                    + " portal URL but is not serving yet ("
                    + probe.of(stalled, role).name().toLowerCase(Locale.ROOT)
                    + "). It will be applied automatically once Cloudflare activates it; "
                    + "until then links keep using the current portal URL.");
            // Fall through: a pending choice must not block rules 2-4 from healing a
            // column that is blank, defaulted, or pointing at a dead host.
        }

        // Rule 2 — the incumbent still works. Don't flap.
        if (StringUtils.hasText(storedHost)
                && candidates.contains(storedHost)
                && probe.of(storedHost, role) == Activation.ACTIVE) {
            return null;
        }

        // Rules 3 & 4 — is the column ours to claim?
        boolean claimable = !StringUtils.hasText(storedHost)
                || isPlatformDefaultHost(storedHost, role)
                || candidates.contains(storedHost);
        if (!claimable) {
            // A curated host that was never configured here. Somebody chose it on
            // purpose; adopting over it would silently redirect their outbound links.
            return null;
        }

        return candidates.stream()
                .filter(h -> probe.of(h, role) == Activation.ACTIVE)
                .findFirst()
                .orElse(null);
    }

    // ── Candidate hosts ───────────────────────────────────────────────────────

    /**
     * Hosts configured for {@code role}, primary-flagged first and then
     * alphabetical. The ordering only has to be stable: two institutes' pages must
     * not adopt different hosts on different reads just because the rows came back
     * in a different order.
     */
    private List<String> candidateHostsForRole(List<InstituteDomainRouting> routings, String role) {
        if (routings == null) {
            return List.of();
        }
        return routings.stream()
                .filter(r -> servesRole(r, role))
                .sorted(Comparator.comparing((InstituteDomainRouting r) -> r.isPrimary() ? 0 : 1)
                        .thenComparing(PortalUrlReconciler::hostOf,
                                Comparator.nullsLast(Comparator.naturalOrder())))
                .map(PortalUrlReconciler::hostOf)
                .filter(StringUtils::hasText)
                .collect(java.util.stream.Collectors.toCollection(LinkedHashSet::new))
                .stream()
                .toList();
    }

    /**
     * The hosts flagged {@code is_primary} for {@code role}, alphabetical so the
     * outcome is deterministic. Normally one; {@code choose} handles the legacy
     * rows that break the "at most one primary per role token" invariant enforced
     * on write in {@code WhiteLabelService}.
     */
    private List<String> primaryHostsForRole(List<InstituteDomainRouting> routings, String role) {
        if (routings == null) {
            return List.of();
        }
        return routings.stream()
                .filter(InstituteDomainRouting::isPrimary)
                .filter(r -> servesRole(r, role))
                .map(PortalUrlReconciler::hostOf)
                .filter(StringUtils::hasText)
                .distinct()
                .sorted()
                .toList();
    }

    /** True when the row's comma-separated role list contains {@code role}. */
    private static boolean servesRole(InstituteDomainRouting r, String role) {
        if (r == null || !StringUtils.hasText(r.getRole())) {
            return false;
        }
        for (String token : r.getRole().split(",")) {
            if (role.equalsIgnoreCase(token.trim())) {
                return true;
            }
        }
        return false;
    }

    /** {@code subdomain="learn", domain="myschool.com"} → {@code learn.myschool.com}. */
    public static String hostOf(InstituteDomainRouting r) {
        if (r == null || !StringUtils.hasText(r.getDomain())) {
            return null;
        }
        String domain = r.getDomain().trim().toLowerCase(Locale.ROOT);
        String subdomain = r.getSubdomain();
        // '*' is a catch-all marker, not a label to prepend.
        if (!StringUtils.hasText(subdomain) || "*".equals(subdomain.trim())) {
            return domain;
        }
        return subdomain.trim().toLowerCase(Locale.ROOT) + "." + domain;
    }

    // ── Institute column access ───────────────────────────────────────────────

    public static String currentPortalUrl(Institute institute, String role) {
        if (institute == null) {
            return null;
        }
        return switch (role) {
            case ROLE_LEARNER -> institute.getLearnerPortalBaseUrl();
            case ROLE_ADMIN -> institute.getAdminPortalBaseUrl();
            case ROLE_TEACHER -> institute.getTeacherPortalBaseUrl();
            default -> null;
        };
    }

    public static void setPortalUrl(Institute institute, String role, String url) {
        switch (role) {
            case ROLE_LEARNER -> institute.setLearnerPortalBaseUrl(url);
            case ROLE_ADMIN -> institute.setAdminPortalBaseUrl(url);
            case ROLE_TEACHER -> institute.setTeacherPortalBaseUrl(url);
            default -> {
                /* custom role: no column to write */ }
        }
    }

    /**
     * Strips scheme, path and trailing dot so a stored {@code https://learn.x.com/}
     * and a routing row's {@code learn.x.com} compare equal. The columns are
     * genuinely inconsistent about this: the {@code V1} defaults are bare hosts
     * while {@code WhiteLabelService} writes {@code https://}-prefixed values.
     */
    public static String normalizeHost(String value) {
        if (!StringUtils.hasText(value)) {
            return null;
        }
        String host = value.trim().toLowerCase(Locale.ROOT)
                .replaceFirst("^https?://", "")
                .replaceFirst("/.*$", "");
        while (host.endsWith(".")) {
            host = host.substring(0, host.length() - 1);
        }
        return StringUtils.hasText(host) ? host : null;
    }

    /**
     * True when the stored value is a platform-owned host rather than one this
     * institute chose: the column default stamped at creation, or this
     * deployment's configured CNAME target for the role (the same hosts, spelled
     * out in two places, and both meaning "nobody picked this").
     */
    private boolean isPlatformDefaultHost(String host, String role) {
        if (!StringUtils.hasText(host)) {
            return true;
        }
        Set<String> platformHosts = new LinkedHashSet<>();
        String columnDefault = PLATFORM_DEFAULT_HOST.get(role);
        if (columnDefault != null) {
            platformHosts.add(columnDefault);
        }
        String cnameTarget = normalizeHost(switch (role) {
            case ROLE_LEARNER -> learnerCnameTarget;
            case ROLE_ADMIN -> adminCnameTarget;
            case ROLE_TEACHER -> teacherCnameTarget;
            default -> null;
        });
        if (cnameTarget != null) {
            platformHosts.add(cnameTarget);
        }
        return platformHosts.contains(host);
    }

    // ── Cloudflare wiring, shared with WhiteLabelService ──────────────────────

    /**
     * The Cloudflare Pages project serving a role string, or null when it is not
     * configured. Only LEARNER has its own project; ADMIN, TEACHER and every
     * institute custom role are served by the admin dashboard SPA, so they share
     * the admin project — {@code teacher.vacademy.io} is just another custom domain
     * on it.
     */
    public String pagesProjectForRole(String role) {
        if (StringUtils.hasText(role)) {
            for (String token : role.split(",")) {
                if (ROLE_LEARNER.equalsIgnoreCase(token.trim())) {
                    return trimToNull(learnerPagesProject);
                }
            }
        }
        return trimToNull(adminPagesProject);
    }

    /**
     * The distinct Pages projects configured on this deployment — at most the
     * learner one and the admin one, and empty when Pages provisioning is off.
     * Everything {@link #pagesProjectForRole} can return comes from here, so a
     * caller that lists all of these has covered every host the probe can be asked
     * about.
     */
    public Set<String> configuredPagesProjects() {
        // Arrays.asList, not List.of: List.of throws on a null element, and these
        // fields are null whenever Spring has not injected them — which is every
        // unit test that builds this class directly, and any deployment whose
        // property is bound to a literal null rather than the empty default.
        Set<String> projects = new LinkedHashSet<>();
        for (String p : Arrays.asList(learnerPagesProject, adminPagesProject)) {
            String trimmed = trimToNull(p);
            if (trimmed != null) {
                projects.add(trimmed);
            }
        }
        return projects;
    }

    /** The {@code <project>.pages.dev} CNAME target for a role, or null. */
    public String pagesCnameTargetForRole(String role) {
        String project = pagesProjectForRole(role);
        return StringUtils.hasText(project) ? project + ".pages.dev" : null;
    }

    /** True when {@code host} is the base vacademy domain or a subdomain of it. */
    public boolean isVacademySubdomain(String host) {
        String h = normalizeHost(host);
        if (h == null) {
            return false;
        }
        String base = vacademyBaseDomain.trim().toLowerCase(Locale.ROOT);
        return h.equals(base) || h.endsWith("." + base);
    }

    private static String trimToNull(String s) {
        return StringUtils.hasText(s) ? s.trim() : null;
    }
}
