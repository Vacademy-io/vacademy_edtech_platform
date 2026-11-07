package vacademy.io.admin_core_service.features.white_label.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.domain_routing.dto.DomainRoutingUpsertRequest;
import vacademy.io.admin_core_service.features.domain_routing.entity.InstituteDomainRouting;
import vacademy.io.admin_core_service.features.domain_routing.enums.PhoneCountryGeoMode;
import vacademy.io.admin_core_service.features.domain_routing.repository.InstituteDomainRoutingRepository;
import vacademy.io.admin_core_service.features.domain_routing.service.DomainRoutingAdminService;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.live_session.provider.manager.BbbMeetingManager;
import vacademy.io.admin_core_service.features.white_label.dto.*;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.auth.repository.UserRoleRepository;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.Institute;

import java.util.*;
import java.util.stream.Collectors;

/**
 * Core orchestrator for white-label setup.
 *
 * Supports multiple domain entries per role. E.g. "ADMIN" can have two
 * domains (admin.myschool.com AND manage.myschool.com). Each entry gets
 * its own Cloudflare CNAME and domain_routing row. Exactly one entry per
 * role may be is_primary = true — that host is the institute's portal URL.
 *
 * <p>The primary flag is persisted on the routing row and applied by
 * {@link PortalUrlReconciler}, not written straight into the institute table
 * here. Two things follow from that, and both are the point of the feature:
 *
 * <ul>
 *   <li>A host reaches {@code institutes.<role>_portal_base_url} only once
 *       Cloudflare reports it ACTIVE. Those columns are the origin of every
 *       link the platform mails a learner, and a Pages custom domain is
 *       {@code pending} — not serving — until the customer's CNAME lands.</li>
 *   <li>Adoption is re-evaluated on every setup <em>and</em> every status read,
 *       so a domain that goes live an hour after setup is picked up by itself,
 *       and so is a portal added without anyone ticking the primary star.</li>
 * </ul>
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class WhiteLabelService {

    private static final String DOMAIN_TYPE_SUBDOMAIN = "VACADEMY_SUBDOMAIN";
    private static final String DOMAIN_TYPE_CUSTOM = "CUSTOM";

    private static final String ROLE_LEARNER = "LEARNER";
    private static final String ROLE_ADMIN = "ADMIN";
    private static final String ROLE_TEACHER = "TEACHER";

    // Role names are simple uppercase tokens (system roles like
    // LEARNER/ADMIN/TEACHER
    // and institute custom roles like MANAGE_LEAD). Used to sanity-check request
    // tokens.
    private static final java.util.regex.Pattern ROLE_TOKEN_PATTERN = java.util.regex.Pattern.compile("[A-Z0-9_]+");

    @Value("${cloudflare.learner.target:learner.vacademy.io}")
    private String learnerCnameTarget;

    @Value("${cloudflare.admin.target:dash.vacademy.io}")
    private String adminCnameTarget;

    @Value("${cloudflare.teacher.target:teacher.vacademy.io}")
    private String teacherCnameTarget;

    @Value("${vacademy.base.domain:vacademy.io}")
    private String vacademyBaseDomain;

    private static final String ROLE_NAME_ADMIN = "ADMIN";

    private final InstituteRepository instituteRepository;
    private final InstituteDomainRoutingRepository routingRepository;
    private final DomainRoutingAdminService domainRoutingAdminService;
    private final CloudflareService cloudflareService;
    private final UserRoleRepository userRoleRepository;
    private final PortalUrlReconciler portalUrlReconciler;

    // ── Setup ─────────────────────────────────────────────────────────────────

    @Transactional
    public WhiteLabelSetupResponse setup(CustomUserDetails user, String instituteId,
            WhiteLabelSetupRequest request) {

        // 0) Hard gate — some Cloudflare capability must be configured on this
        // deployment: DNS (token + zone) and/or Pages provisioning (token + account).
        if (!cloudflareService.isEnabled() && !cloudflareService.isPagesEnabled()) {
            throw new VacademyException(
                    "White-label automation is not available on this deployment. " +
                            "Set CLOUDFLARE_API_TOKEN with CLOUDFLARE_ZONE_ID (DNS) and/or " +
                            "CLOUDFLARE_ACCOUNT_ID (Pages custom domains).");
        }

        // 1) Security check
        assertInstituteAccess(user, instituteId);

        // 2) Validate entries
        List<WhiteLabelSetupRequest.DomainEntry> entries = request.getEntries();
        if (entries == null || entries.isEmpty()) {
            throw new VacademyException("At least one domain entry is required");
        }

        // Validate domains and validate+canonicalize role strings (comma-separated
        // lists).
        // After this loop, each entry.role is a canonical "ROLE1,ROLE2" string with
        // unique, sorted, upper-cased tokens.
        for (WhiteLabelSetupRequest.DomainEntry e : entries) {
            if (!StringUtils.hasText(e.getDomain())) {
                throw new VacademyException("Domain is required for each entry");
            }
            e.setRole(validateAndCanonicalizeRoles(e.getRole()));
            e.setDomain(e.getDomain().trim().toLowerCase()
                    .replaceFirst("^https?://", "")
                    .replaceFirst("/.*$", ""));
        }

        // Validate: at most one primary per *individual* role token. If a user marks
        // one entry primary with roles "ADMIN,MANAGE_LEAD" and another entry primary
        // with "ADMIN", they collide on ADMIN.
        Map<String, Long> primaryTokenCounts = entries.stream()
                .filter(WhiteLabelSetupRequest.DomainEntry::isPrimary)
                .flatMap(e -> splitRoleTokens(e.getRole()).stream())
                .collect(Collectors.groupingBy(r -> r, Collectors.counting()));
        for (Map.Entry<String, Long> pc : primaryTokenCounts.entrySet()) {
            if (pc.getValue() > 1) {
                throw new VacademyException("At most one primary domain per role allowed. " +
                        "Role '" + pc.getKey() + "' has " + pc.getValue() + " primary entries.");
            }
        }

        // 3) Process each entry: Cloudflare Pages custom domain (preferred) or the
        // legacy DNS-only fallback, then the routing row.
        List<WhiteLabelSetupResponse.DnsRecordResult> dnsResults = new ArrayList<>();
        List<WhiteLabelSetupResponse.PagesDomainResult> pagesResults = new ArrayList<>();
        List<String> warnings = new ArrayList<>();

        // Attaching a Pages custom domain already tells us its status, so seed the
        // probe as we go. This method runs inside a transaction (it has routing rows
        // to write), and every Cloudflare call it makes holds that connection open —
        // so the reconcile below should not re-ask about hosts we just heard about.
        PortalUrlReconciler.ActivationProbe probe = portalUrlReconciler.newProbe();

        for (WhiteLabelSetupRequest.DomainEntry entry : entries) {
            String host = entry.getDomain();
            boolean inZone = portalUrlReconciler.isVacademySubdomain(host);
            String pagesProject = portalUrlReconciler.pagesProjectForRole(entry.getRole());
            boolean pagesEnabled = cloudflareService.isPagesEnabled() && StringUtils.hasText(pagesProject);

            // a) Wire the host into the serving layer.
            if (pagesEnabled) {
                // Preferred: attach the host as a custom domain on the Pages project
                // that serves this role. This is the step that makes the host actually
                // SERVE the SPA. For in-zone (*.vacademy.io) hosts Cloudflare also
                // creates the DNS record + certificate automatically; for external
                // customer domains we can't touch their zone, so we surface the CNAME
                // they must add themselves.
                try {
                    WhiteLabelSetupResponse.PagesDomainResult pr =
                            cloudflareService.upsertPagesCustomDomain(pagesProject, host);
                    pagesResults.add(pr);
                    probe.seed(host, entry.getRole(), pr.getStatus());
                    if (!inZone) {
                        warnings.add("Custom domain " + host + ": add a CNAME at your DNS provider pointing "
                                + host + " → " + pr.getPagesCnameTarget()
                                + ". SSL activates automatically once Cloudflare validates it"
                                + " (current status: " + pr.getStatus() + ").");
                    }
                } catch (Exception e) {
                    warnings.add("Failed to attach Pages custom domain for " + host + ": " + e.getMessage());
                    log.error("[WhiteLabel] Pages attach failed host={}, role={}: {}",
                            host, entry.getRole(), e.getMessage());
                }
            } else if (inZone) {
                // Legacy fallback (Pages not configured): proxied CNAME only. NOTE: this
                // only serves traffic if a wildcard/Pages custom domain already covers
                // the target — otherwise the host will 522 until registered on Pages.
                String cnameTarget = cnameTargetForRole(entry.getRole());
                try {
                    dnsResults.add(cloudflareService.upsertCname(host, cnameTarget));
                } catch (Exception e) {
                    warnings.add("Failed to configure DNS for " + host + ": " + e.getMessage());
                    log.error("[WhiteLabel] DNS failed for domain={}, role={}: {}",
                            host, entry.getRole(), e.getMessage());
                }
            } else {
                // External custom domain with no Pages provisioning configured — we can
                // neither create DNS in the customer's zone nor register the domain.
                warnings.add("Custom external domain " + host + " needs Cloudflare Pages provisioning "
                        + "(CLOUDFLARE_ACCOUNT_ID + a Pages project for role " + entry.getRole()
                        + "), which is not set on this deployment. Nothing was provisioned for it.");
            }

            // b) Upsert routing row (by exact domain+subdomain+role match). The
            // primary flag is recorded here rather than applied to the institute
            // row — it is an intent that outlives this request, and it is honoured
            // only when the host actually serves.
            upsertRoutingRow(instituteId, host, entry.getRole(), entry.isPrimary(), entry.getRoutingConfig());
        }

        // 4) Keep "at most one primary row per role token" true across ALL of the
        // institute's rows, not just the ones in this request.
        List<InstituteDomainRouting> routings = routingRepository.findByInstituteId(instituteId);
        warnings.addAll(demoteSupersededPrimaries(routings, entries));

        // 5) Adopt into the institute's portal-URL columns — the hosts that are
        // live now; the rest on a later setup or status read, by themselves.
        Institute institute = instituteRepository.findById(instituteId)
                .orElseThrow(() -> new VacademyException("Institute not found: " + instituteId));

        PortalUrlReconciler.ReconcileResult reconciled =
                portalUrlReconciler.reconcile(institute, routings, probe);
        if (reconciled.isChanged()) {
            instituteRepository.save(institute);
        }
        warnings.addAll(reconciled.getWarnings());

        log.info("[WhiteLabel] Setup complete for instituteId={}, {} entries processed, {} portal URL(s) adopted",
                instituteId, entries.size(), reconciled.getAdoptedUrlByRole().size());

        return WhiteLabelSetupResponse.builder()
                .setupComplete(true)
                .learnerPortalUrl(institute.getLearnerPortalBaseUrl())
                .adminPortalUrl(institute.getAdminPortalBaseUrl())
                .teacherPortalUrl(institute.getTeacherPortalBaseUrl())
                .dnsRecordsConfigured(dnsResults)
                .pagesDomainsConfigured(pagesResults)
                .warnings(warnings)
                .build();
    }

    /**
     * Clears {@code is_primary} on rows this request supersedes, so exactly one
     * row stays primary per role token.
     *
     * <p>The flag is per-row while roles are per-token, so a row serving
     * {@code "ADMIN,TEACHER"} that is superseded for ADMIN loses its TEACHER
     * primacy too — there is no third state to demote it into. That is reported
     * back rather than hidden; the fix is to give each role its own row.
     *
     * @return warnings to surface in the setup response
     */
    private List<String> demoteSupersededPrimaries(List<InstituteDomainRouting> routings,
            List<WhiteLabelSetupRequest.DomainEntry> entries) {

        Map<String, String> requestedPrimaryHost = new LinkedHashMap<>();
        for (WhiteLabelSetupRequest.DomainEntry e : entries) {
            if (!e.isPrimary())
                continue;
            for (String token : splitRoleTokens(e.getRole())) {
                requestedPrimaryHost.put(token, e.getDomain());
            }
        }
        if (requestedPrimaryHost.isEmpty()) {
            return List.of();
        }

        List<String> warnings = new ArrayList<>();
        for (InstituteDomainRouting routing : routings) {
            if (!routing.isPrimary()) {
                continue;
            }
            String host = PortalUrlReconciler.hostOf(routing);
            List<String> tokens = splitRoleTokens(routing.getRole());
            boolean superseded = tokens.stream().anyMatch(
                    t -> requestedPrimaryHost.containsKey(t) && !requestedPrimaryHost.get(t).equals(host));
            if (!superseded) {
                continue;
            }

            routing.setPrimary(false);
            routingRepository.save(routing);
            log.info("[WhiteLabel] Demoted primary routing row id={} ({}) — superseded for {}",
                    routing.getId(), host, routing.getRole());

            List<String> collateral = tokens.stream()
                    .filter(PortalUrlReconciler.PORTAL_ROLES::contains)
                    .filter(t -> !requestedPrimaryHost.containsKey(t))
                    .toList();
            if (!collateral.isEmpty()) {
                warnings.add(host + " was also the primary domain for " + String.join(", ", collateral)
                        + ". It served several roles from one entry, so replacing it for "
                        + String.join(", ", requestedPrimaryHost.keySet())
                        + " cleared it for those too — add a separate entry if "
                        + String.join(", ", collateral) + " should keep this domain.");
            }
        }
        return warnings;
    }

    // ── Status ────────────────────────────────────────────────────────────────

    /**
     * Deliberately carries NO transaction, unlike the rest of this class.
     *
     * <p>Two things had to be true at once. This is where a host that went active
     * since setup gets adopted into the institute's portal-URL columns — Cloudflare
     * has no webhook, the settings page already asks it for every row's live status
     * on load, so the read is the only honest place to act on the answer. But it
     * spends most of its time in Cloudflare HTTP calls, one per routing row, and
     * wrapping that in a transaction would pin a connection for the whole of it.
     * A writable transaction is served by the PRIMARY (see
     * {@code ReplicationRoutingDataSource}), whose pool is small; a status page with
     * eight domains would hold one of those connections for eight round trips.
     *
     * <p>So each repository call takes its own short transaction instead: the reads
     * go to the replica, the Cloudflare probing happens with no connection held, and
     * the adoption — which fires only on an actual transition, not on every load —
     * is a single write against a freshly re-read row.
     */
    public WhiteLabelStatusResponse getStatus(CustomUserDetails user, String instituteId) {

        if (!cloudflareService.isEnabled() && !cloudflareService.isPagesEnabled()) {
            log.info("[WhiteLabel] getStatus called but Cloudflare is not configured on this deployment");
            return WhiteLabelStatusResponse.builder()
                    .cloudflareEnabled(false)
                    .isConfigured(false)
                    .routingEntries(Collections.emptyList())
                    .build();
        }

        Institute institute = instituteRepository.findById(instituteId)
                .orElseThrow(() -> new VacademyException("Institute not found: " + instituteId));

        List<InstituteDomainRouting> routings = routingRepository.findByInstituteId(instituteId);

        // One probe for the whole request: the reconcile pass and the per-row status
        // below ask Cloudflare about the same hosts, and every miss is an HTTP call.
        PortalUrlReconciler.ActivationProbe probe = portalUrlReconciler.newProbe();

        // Adopt anything that has become active since the last look. Gated on the
        // same membership check as setup — the read below is left as permissive as
        // it has always been, but a write must not be reachable by someone who only
        // guessed an institute id.
        List<String> adopted = List.of();
        if (hasInstituteAccess(user, instituteId)) {
            PortalUrlReconciler.ReconcileResult reconciled =
                    portalUrlReconciler.reconcile(institute, routings, probe);
            if (reconciled.isChanged()) {
                adopted = persistAdoptedUrls(instituteId, reconciled.getAdoptedUrlByRole());
            }
        }

        boolean configured = StringUtils.hasText(institute.getLearnerPortalBaseUrl())
                || !routings.isEmpty();

        // Guess domain type from existing learner URL
        String domainType = null;
        if (StringUtils.hasText(institute.getLearnerPortalBaseUrl())) {
            domainType = institute.getLearnerPortalBaseUrl().contains(vacademyBaseDomain)
                    ? DOMAIN_TYPE_SUBDOMAIN
                    : DOMAIN_TYPE_CUSTOM;
        }

        List<WhiteLabelStatusResponse.RoutingEntry> entries = routings.stream()
                .map(r -> WhiteLabelStatusResponse.RoutingEntry.builder()
                        .id(r.getId())
                        .role(r.getRole())
                        .domain(r.getDomain())
                        .subdomain(r.getSubdomain())
                        // Live Cloudflare Pages custom-domain status (active/pending/…)
                        .pagesStatus(pagesStatusFor(r, probe))
                        .pagesCnameTarget(portalUrlReconciler.pagesCnameTargetForRole(r.getRole()))
                        // Whether the admin chose this host, and whether it is the one
                        // actually in use. The two differ while a choice is pending.
                        .isPrimary(r.isPrimary())
                        .isPortalUrl(isCurrentPortalUrl(institute, r))
                        // Which sub-org this portal belongs to, so the wizard can show
                        // and re-send it rather than silently dropping it on save.
                        .subOrgId(r.getSubOrgId())
                        // Branding
                        .tabText(r.getTabText())
                        .tabIconFileId(r.getTabIconFileId())
                        .theme(r.getTheme())
                        .fontFamily(r.getFontFamily())
                        // Routes
                        .redirect(r.getRedirect())
                        .afterLoginRoute(r.getAfterLoginRoute())
                        .adminPortalAfterLogoutRoute(r.getAdminPortalAfterLogoutRoute())
                        .homeIconClickRoute(r.getHomeIconClickRoute())
                        // Auth
                        .allowSignup(r.getAllowSignup())
                        .allowGoogleAuth(r.getAllowGoogleAuth())
                        .allowGithubAuth(r.getAllowGithubAuth())
                        .allowEmailOtpAuth(r.getAllowEmailOtpAuth())
                        .allowPhoneAuth(r.getAllowPhoneAuth())
                        .allowUsernamePasswordAuth(r.getAllowUsernamePasswordAuth())
                        .convertUsernamePasswordToLowercase(r.isConvertUsernamePasswordToLowercase())
                        // Legal / Links
                        .privacyPolicyUrl(r.getPrivacyPolicyUrl())
                        .termsAndConditionUrl(r.getTermsAndConditionUrl())
                        .playStoreAppLink(r.getPlayStoreAppLink())
                        .appStoreAppLink(r.getAppStoreAppLink())
                        .windowsAppLink(r.getWindowsAppLink())
                        .macAppLink(r.getMacAppLink())
                        .commaSeparatedPreferredCountry(r.getCommaSeparatedPreferredCountry())
                        // Raw, NOT resolved. This payload feeds an editor that posts
                        // every field back verbatim, so resolving a null here would
                        // stamp INSTITUTE_FIRST onto the column the first time an
                        // admin saved an unrelated change — and "this portal never
                        // chose a mode" would stop being distinguishable from "this
                        // portal chose the default". The public resolve endpoint,
                        // whose consumers need an answer rather than a round-trip,
                        // does resolve it. The settings field treats absent as the
                        // default on its own.
                        .phoneCountryGeoMode(r.getPhoneCountryGeoMode())
                        // Logo / institute-name display
                        .hideInstituteName(r.getHideInstituteName())
                        .logoWidthPx(r.getLogoWidthPx())
                        .logoHeightPx(r.getLogoHeightPx())
                        .stackNameBelowLogo(r.getStackNameBelowLogo())
                        .build())
                .collect(Collectors.toList());

        return WhiteLabelStatusResponse.builder()
                .cloudflareEnabled(true)
                .isConfigured(configured)
                .domainType(domainType)
                .learnerPortalUrl(institute.getLearnerPortalBaseUrl())
                .adminPortalUrl(institute.getAdminPortalBaseUrl())
                .teacherPortalUrl(institute.getTeacherPortalBaseUrl())
                .rolesAdoptedNow(adopted)
                .routingEntries(entries)
                .build();
    }

    // ── Live-class domain ─────────────────────────────────────────────────────

    /**
     * Current custom live-class host for the institute, or null when it uses the
     * platform default.
     */
    @Transactional(readOnly = true)
    public Map<String, String> getLiveSessionDomain(CustomUserDetails user, String instituteId) {
        assertInstituteAccess(user, instituteId);
        Institute institute = instituteRepository.findById(instituteId)
                .orElseThrow(() -> new VacademyException("Institute not found: " + instituteId));

        Map<String, String> out = new LinkedHashMap<>();
        out.put("instituteId", instituteId);
        out.put("liveSessionBaseUrl", institute.getLiveSessionBaseUrl());
        return out;
    }

    /**
     * Set (or clear, by passing null/blank) the institute's custom live-class host.
     *
     * Validation is strict rather than forgiving: this value becomes the origin of
     * a URL learners are redirected into, so a malformed one is rejected outright
     * instead of being coerced into something that merely looks plausible.
     *
     * Setting this row is only half the job — the host must also resolve to the
     * PRIMARY BBB pool server and be present as a SAN on that server's
     * certificate. Until both are true, participants sent to it will hit a DNS or
     * TLS error.
     */
    @Transactional
    public Map<String, String> setLiveSessionDomain(CustomUserDetails user, String instituteId,
            String rawDomain) {
        assertInstituteAccess(user, instituteId);
        Institute institute = instituteRepository.findById(instituteId)
                .orElseThrow(() -> new VacademyException("Institute not found: " + instituteId));

        String normalized = null;
        if (StringUtils.hasText(rawDomain)) {
            normalized = BbbMeetingManager.normalizeLiveSessionHost(rawDomain);
            if (normalized == null) {
                throw new VacademyException("Invalid live-class domain '" + rawDomain
                        + "'. Use a plain hostname such as meet.yourschool.com — no path, port or credentials.");
            }
        }

        institute.setLiveSessionBaseUrl(normalized);
        instituteRepository.save(institute);
        log.info("[WhiteLabel] Live-class domain for institute {} set to {}", instituteId,
                normalized == null ? "(default)" : normalized);

        Map<String, String> out = new LinkedHashMap<>();
        out.put("instituteId", instituteId);
        out.put("liveSessionBaseUrl", normalized);
        return out;
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    private void assertInstituteAccess(CustomUserDetails user, String instituteId) {
        if (!hasInstituteAccess(user, instituteId)) {
            log.warn("[WhiteLabel] Unauthorized attempt by userId={} on instituteId={}",
                    user == null ? "anonymous" : user.getUserId(), instituteId);
            throw new VacademyException(user == null
                    ? "Access denied: no authenticated user"
                    : "Access denied: you are not a member of institute " + instituteId);
        }
    }

    /**
     * Whether {@code user} may configure {@code instituteId}. Split out from
     * {@link #assertInstituteAccess} so the status read can gate its write on
     * membership without turning a read into a 403 for callers that could always
     * perform it.
     */
    private boolean hasInstituteAccess(CustomUserDetails user, String instituteId) {
        if (user == null) {
            return false;
        }

        // 1) Root users bypass all institute membership checks. Matches the convention
        // used elsewhere in the codebase (e.g.
        // StudentListManager#applyFacultyAccessFilter).
        if (user.isRootUser()) {
            return true;
        }

        // 2) Users with an active ADMIN role on the *specific* target institute are
        // allowed. This uses the canonical user_role table (the same source the
        // auth service builds the JWT's per-institute authorities from), so it
        // correctly authorizes admins regardless of how they were provisioned —
        // including admins who don't have a row in the `staff` table.
        if (userRoleRepository.existsByUserIdAndInstituteIdAndRoleName(
                user.getUserId(), instituteId, ROLE_NAME_ADMIN)) {
            return true;
        }

        // 3) Fallback: legacy staff-table membership check, preserved for backward
        // compatibility with users who were granted access via that path.
        return instituteRepository.findInstitutesByUserId(user.getUserId())
                .stream()
                .anyMatch(i -> i.getId().equals(instituteId));
    }

    /**
     * Returns the Cloudflare CNAME target for a role string.
     *
     * The role string may contain multiple comma-separated role tokens. We pick
     * the first system-role token in priority order [LEARNER, ADMIN, TEACHER]
     * and use its CNAME target. If the entry has only custom-role tokens
     * (e.g. "MANAGE_LEAD"), we default to the admin target since custom roles
     * are virtually always served from the admin-side infra.
     */
    private String cnameTargetForRole(String role) {
        List<String> tokens = splitRoleTokens(role);
        if (tokens.contains(ROLE_LEARNER))
            return learnerCnameTarget;
        if (tokens.contains(ROLE_ADMIN))
            return adminCnameTarget;
        if (tokens.contains(ROLE_TEACHER))
            return teacherCnameTarget;
        // Custom-role-only entry: admin infra serves it.
        return adminCnameTarget;
    }

    /**
     * Writes the adopted portal URLs against a freshly re-read institute row.
     *
     * <p>The row this method is handed was loaded before the Cloudflare probing, so
     * saving it would blindly re-write every other column with values that are by
     * now seconds stale — this is a full-entity JPA save, not a targeted UPDATE.
     * Re-reading first narrows that to the three columns actually being changed.
     *
     * @return the roles actually written, for the response
     */
    private List<String> persistAdoptedUrls(String instituteId, Map<String, String> adoptedUrlByRole) {
        if (adoptedUrlByRole.isEmpty()) {
            return List.of();
        }
        Institute fresh = instituteRepository.findById(instituteId).orElse(null);
        if (fresh == null) {
            return List.of();
        }
        adoptedUrlByRole.forEach((role, url) -> PortalUrlReconciler.setPortalUrl(fresh, role, url));
        instituteRepository.save(fresh);
        return List.copyOf(adoptedUrlByRole.keySet());
    }

    /**
     * Live Cloudflare Pages custom-domain status for a routing row (active/pending/…),
     * or null when Pages isn't configured or the host isn't attached. Failure-safe —
     * used only for display, and served from {@code probe}'s memo so a status page
     * asks Cloudflare about each host once.
     */
    private String pagesStatusFor(InstituteDomainRouting r, PortalUrlReconciler.ActivationProbe probe) {
        if (!cloudflareService.isPagesEnabled()) {
            return null;
        }
        return probe.rawPagesStatus(PortalUrlReconciler.hostOf(r), r.getRole());
    }

    /**
     * True when this row's host is the one currently stored in the institute's
     * portal-URL column for any role it serves — i.e. the domain outbound links
     * actually use, which is not always the one flagged primary.
     */
    private boolean isCurrentPortalUrl(Institute institute, InstituteDomainRouting r) {
        String host = PortalUrlReconciler.hostOf(r);
        if (host == null) {
            return false;
        }
        for (String token : splitRoleTokens(r.getRole())) {
            String stored = PortalUrlReconciler.normalizeHost(
                    PortalUrlReconciler.currentPortalUrl(institute, token));
            if (host.equals(stored)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Upsert a domain routing row. Looks up by institute+domain+subdomain+role
     * (exact match on the full role string, so "ADMIN" and "ADMIN,MANAGE_LEAD"
     * are separate rows). Updates if found, creates otherwise.
     */
    private void upsertRoutingRow(String instituteId, String fullDomain,
            String role, boolean isPrimary, PortalRoutingConfig config) {

        String[] parts = splitDomain(fullDomain);
        String domain = parts[0];
        String subdomain = parts[1];

        DomainRoutingUpsertRequest req = buildUpsertRequest(instituteId, domain, subdomain, role, config);
        req.setPrimary(isPrimary);

        Optional<InstituteDomainRouting> existing = routingRepository.findByInstituteIdAndDomainAndSubdomainAndRole(
                instituteId, domain, subdomain, role);

        if (existing.isPresent()) {
            domainRoutingAdminService.update(existing.get().getId(), req);
            log.info("[WhiteLabel] Updated routing row id={} for {}://{}.{}", existing.get().getId(), role, subdomain,
                    domain);
        } else {
            InstituteDomainRouting created = domainRoutingAdminService.create(req);
            log.info("[WhiteLabel] Created routing row id={} for {}://{}.{}", created.getId(), role, subdomain, domain);
        }
    }

    // ── Role helpers ──────────────────────────────────────────────────────────

    /**
     * Validates a comma-separated role string and returns its canonical form:
     * tokens trimmed, uppercased, deduped, sorted alphabetically and rejoined
     * with a single comma. Sorting makes "ADMIN,MANAGE_LEAD" and
     * "MANAGE_LEAD,ADMIN" collapse to one canonical value so upserts match.
     *
     * Role names are NOT validated against the `roles` table: that table lives
     * in the auth service's database and is not reachable from
     * admin_core_service's database. Instead we enforce a simple token format,
     * which covers both system roles (LEARNER/ADMIN/TEACHER) and any institute
     * custom role (e.g. MANAGE_LEAD). An unrecognized token simply produces a
     * routing row that no user matches — harmless and editable — so we don't
     * need an authoritative role list here.
     *
     * Throws VacademyException if the string is empty or contains a malformed
     * token.
     */
    private String validateAndCanonicalizeRoles(String roleStr) {
        if (!StringUtils.hasText(roleStr)) {
            throw new VacademyException("Role is required for each entry");
        }
        Set<String> tokens = new TreeSet<>();
        for (String raw : roleStr.split(",")) {
            String token = raw == null ? "" : raw.trim().toUpperCase();
            if (token.isEmpty())
                continue;
            if (!ROLE_TOKEN_PATTERN.matcher(token).matches()) {
                throw new VacademyException("Invalid role '" + token + "'. "
                        + "Role names may contain only letters, digits and underscores.");
            }
            tokens.add(token);
        }
        if (tokens.isEmpty()) {
            throw new VacademyException("Role is required for each entry");
        }
        return String.join(",", tokens);
    }

    /**
     * Splits a canonical role string into its role tokens. Safe for null/empty
     * input (returns an empty list). Used by cname-target and primary-URL logic
     * that need to inspect individual roles.
     */
    private List<String> splitRoleTokens(String roleStr) {
        if (!StringUtils.hasText(roleStr))
            return List.of();
        List<String> tokens = new ArrayList<>();
        for (String raw : roleStr.split(",")) {
            String t = raw == null ? "" : raw.trim().toUpperCase();
            if (!t.isEmpty())
                tokens.add(t);
        }
        return tokens;
    }

    /**
     * Splits "learn.myschool.com" → ["myschool.com", "learn"]
     */
    private String[] splitDomain(String fullDomain) {
        String d = fullDomain.trim().toLowerCase()
                .replaceFirst("^https?://", "")
                .replaceFirst("/.*$", "");

        String[] parts = d.split("\\.", 2);
        if (parts.length == 2) {
            return new String[] { parts[1], parts[0] };
        }
        return new String[] { d, "*" };
    }

    private DomainRoutingUpsertRequest buildUpsertRequest(
            String instituteId, String domain, String subdomain, String role,
            PortalRoutingConfig cfg) {

        DomainRoutingUpsertRequest r = new DomainRoutingUpsertRequest();
        r.setInstituteId(instituteId);
        r.setDomain(domain);
        r.setSubdomain(subdomain);
        r.setRole(role);

        if (cfg != null) {
            r.setRedirect(cfg.getRedirect());
            r.setPrivacyPolicyUrl(cfg.getPrivacyPolicyUrl());
            r.setTermsAndConditionUrl(cfg.getTermsAndConditionUrl());
            r.setAfterLoginRoute(cfg.getAfterLoginRoute());
            r.setAdminPortalAfterLogoutRoute(cfg.getAdminPortalAfterLogoutRoute());
            r.setHomeIconClickRoute(cfg.getHomeIconClickRoute());
            r.setTheme(cfg.getTheme());
            r.setTabText(cfg.getTabText());
            r.setAllowSignup(cfg.getAllowSignup());
            r.setSubOrgId(cfg.getSubOrgId());
            r.setTabIconFileId(cfg.getTabIconFileId());
            r.setFontFamily(cfg.getFontFamily());
            r.setAllowGoogleAuth(cfg.getAllowGoogleAuth());
            r.setAllowGithubAuth(cfg.getAllowGithubAuth());
            r.setAllowEmailOtpAuth(cfg.getAllowEmailOtpAuth());
            r.setAllowPhoneAuth(cfg.getAllowPhoneAuth());
            r.setAllowUsernamePasswordAuth(cfg.getAllowUsernamePasswordAuth());
            r.setPlayStoreAppLink(cfg.getPlayStoreAppLink());
            r.setAppStoreAppLink(cfg.getAppStoreAppLink());
            r.setWindowsAppLink(cfg.getWindowsAppLink());
            r.setMacAppLink(cfg.getMacAppLink());
            r.setConvertUsernamePasswordToLowercase(
                    cfg.getConvertUsernamePasswordToLowercase() != null
                            ? cfg.getConvertUsernamePasswordToLowercase()
                            : false);
            r.setCommaSeparatedPreferredCountry(cfg.getCommaSeparatedPreferredCountry());
            r.setPhoneCountryGeoMode(PhoneCountryGeoMode.normalizeForStorage(cfg.getPhoneCountryGeoMode()));
            r.setHideInstituteName(cfg.getHideInstituteName());
            r.setLogoWidthPx(cfg.getLogoWidthPx());
            r.setLogoHeightPx(cfg.getLogoHeightPx());
            r.setStackNameBelowLogo(cfg.getStackNameBelowLogo());
        } else {
            r.setAllowUsernamePasswordAuth(true);
            r.setConvertUsernamePasswordToLowercase(false);
        }
        return r;
    }
}
