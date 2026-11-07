package vacademy.io.admin_core_service.features.white_label.service;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestTemplate;
import vacademy.io.admin_core_service.features.white_label.dto.WhiteLabelSetupResponse;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Thin wrapper around the Cloudflare DNS API.
 *
 * All tokens are read from env variables:
 * CLOUDFLARE_API_TOKEN – scoped Zone:DNS:Edit for the Vacademy zones
 * CLOUDFLARE_ZONE_ID – zone that owns *.vacademy.io (and can also create
 * CNAME proxies for customer-added domains inside the same zone)
 *
 * For fully custom external domains (e.g. learn.myschool.com) the institute
 * admin
 * must point their domain's CNAME at our Cloudflare Worker / origin. We still
 * create the record on our end so that Cloudflare's proxy handles routing.
 *
 * NOTE: Cloudflare API reference:
 * https://developers.cloudflare.com/api/operations/dns-records-for-a-zone-list-dns-records
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class CloudflareService {

    private static final String CF_API_BASE = "https://api.cloudflare.com/client/v4";

    @Value("${cloudflare.api.token}")
    private String apiToken;

    @Value("${cloudflare.zone.id}")
    private String zoneId;

    @Value("${cloudflare.account.id:}")
    private String accountId;

    private final RestTemplate restTemplate;

    // ── Public API ────────────────────────────────────────────────────────────

    /**
     * Returns true only when both Cloudflare credentials are present in the
     * environment.
     * Deployments that don't have CLOUDFLARE_API_TOKEN / CLOUDFLARE_ZONE_ID set
     * will
     * always return false — the white-label DNS feature is disabled for them.
     */
    public boolean isEnabled() {
        return StringUtils.hasText(apiToken) && StringUtils.hasText(zoneId);
    }

    /**
     * Returns true when Cloudflare Pages custom-domain provisioning is available,
     * i.e. an API token (with Pages:Edit scope) and the account id are configured.
     * When enabled, the white-label setup attaches each host to its SPA Pages
     * project so the host is actually served — a DNS CNAME alone never is.
     */
    public boolean isPagesEnabled() {
        return StringUtils.hasText(apiToken) && StringUtils.hasText(accountId);
    }

    /**
     * Attaches {@code host} as a custom domain on the given Cloudflare Pages
     * {@code projectName} (idempotent — a no-op if it's already attached).
     *
     * For a host inside a Cloudflare zone on our account (e.g. a *.vacademy.io
     * subdomain) Cloudflare provisions the DNS record and certificate itself.
     * For a fully external customer domain the returned status stays "pending"
     * until the customer points a CNAME at {@code <project>.pages.dev} and
     * Cloudflare validates it.
     */
    public WhiteLabelSetupResponse.PagesDomainResult upsertPagesCustomDomain(String projectName, String host) {
        String pagesTarget = projectName + ".pages.dev";

        // 1) Already attached? Then just report its current status.
        CfPagesDomain existing = getPagesDomain(projectName, host);
        if (existing != null) {
            log.info("[CloudflareService] Pages custom domain already attached: {} on project {} (status={})",
                    host, projectName, existing.getStatus());
            return buildPagesResult("EXISTS", projectName, host, existing.getStatus(), pagesTarget);
        }

        // 2) Attach it.
        String url = CF_API_BASE + "/accounts/" + accountId + "/pages/projects/" + projectName + "/domains";
        Map<String, Object> body = Map.of("name", host);
        try {
            ResponseEntity<CfPagesDomainResponse> resp = restTemplate.exchange(
                    url, HttpMethod.POST,
                    new HttpEntity<>(body, authHeaders()),
                    CfPagesDomainResponse.class);
            CfPagesDomainResponse r = resp.getBody();
            String status = (r != null && r.getResult() != null) ? r.getResult().getStatus() : null;
            log.info("[CloudflareService] Attached Pages custom domain {} to project {} (status={})",
                    host, projectName, status);
            return buildPagesResult("CREATED", projectName, host, status, pagesTarget);
        } catch (HttpClientErrorException e) {
            log.error("[CloudflareService] Failed to attach Pages custom domain {} to project {}: {}",
                    host, projectName, e.getResponseBodyAsString());
            throw new RuntimeException(
                    "Cloudflare Pages domain attach failed for " + host + ": " + e.getResponseBodyAsString());
        }
    }

    /**
     * Creates or updates a proxied CNAME record in Cloudflare.
     *
     * @param name   DNS name e.g. "learn.myschool.com" or "myschool.vacademy.io"
     * @param target CNAME target, e.g. "learner.vacademy.io"
     * @return result describing the action taken
     */
    public WhiteLabelSetupResponse.DnsRecordResult upsertCname(String name, String target) {
        String existingId = findExistingRecord(name);
        if (existingId != null) {
            return updateCname(existingId, name, target);
        } else {
            return createCname(name, target);
        }
    }

    /**
     * Returns the live Cloudflare Pages custom-domain status for {@code host} on
     * {@code projectName} (e.g. "active", "pending", "initializing"), or null when
     * Pages isn't configured, the args are blank, or the host isn't attached.
     * Read-only and failure-safe — never throws.
     */
    public String getPagesCustomDomainStatus(String projectName, String host) {
        if (!isPagesEnabled() || !StringUtils.hasText(projectName) || !StringUtils.hasText(host)) {
            return null;
        }
        CfPagesDomain d = getPagesDomain(projectName, host);
        return d != null ? d.getStatus() : null;
    }

    /**
     * Every custom domain attached to {@code projectName}, as host → status
     * ("active", "pending", "deactivated", …).
     *
     * <p>For asking about one host use {@link #getPagesCustomDomainStatus}; this is
     * for the callers that are about to ask about all of them. The reconcile sweep
     * covers ~120 hosts, and one round trip each is a needless minute of wall clock
     * against an API this deployment shares with every other white-label operation.
     *
     * <p>Returns null — distinct from an empty map — when the listing could not be
     * completed, so a caller can tell "this project has no custom domains" from
     * "Cloudflare did not answer" and decline to conclude that nothing is attached.
     */
    public Map<String, String> listPagesCustomDomains(String projectName) {
        if (!isPagesEnabled() || !StringUtils.hasText(projectName)) {
            return null;
        }
        Map<String, String> statusByHost = new LinkedHashMap<>();
        // The endpoint pages at 20 and rejects per_page overrides, so walk it. The
        // bound is a guard against an unterminating cursor, not an expected depth:
        // 50 pages is 1000 custom domains.
        for (int page = 1; page <= 50; page++) {
            List<CfPagesDomain> batch = getPagesDomainPage(projectName, page);
            if (batch == null) {
                return null; // partial listing would read as "the rest is unattached"
            }
            if (batch.isEmpty()) {
                return statusByHost;
            }
            for (CfPagesDomain d : batch) {
                if (d != null && StringUtils.hasText(d.getName())) {
                    statusByHost.put(d.getName().trim().toLowerCase(), d.getStatus());
                }
            }
        }
        log.warn("[CloudflareService] Pages custom-domain listing for {} exceeded 50 pages; treating as incomplete",
                projectName);
        return null;
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    /**
     * One page of a project's custom domains, empty when the page is past the end,
     * or null when the request failed — the caller must not read a failure as an
     * end-of-list.
     */
    private List<CfPagesDomain> getPagesDomainPage(String projectName, int page) {
        try {
            String url = CF_API_BASE + "/accounts/" + accountId + "/pages/projects/" + projectName
                    + "/domains?page=" + page;
            ResponseEntity<CfPagesDomainListResponse> resp = restTemplate.exchange(
                    url, HttpMethod.GET,
                    new HttpEntity<>(authHeaders()),
                    CfPagesDomainListResponse.class);
            CfPagesDomainListResponse body = resp.getBody();
            if (body == null || !body.isSuccess()) {
                log.warn("[CloudflareService] Pages domain listing for {} page {} was unsuccessful", projectName, page);
                return null;
            }
            return body.getResult() != null ? body.getResult() : List.of();
        } catch (Exception e) {
            log.warn("[CloudflareService] Could not list Pages domains for {} page {}: {}",
                    projectName, page, e.getMessage());
            return null;
        }
    }

    private HttpHeaders authHeaders() {
        HttpHeaders h = new HttpHeaders();
        h.setBearerAuth(apiToken);
        h.setContentType(MediaType.APPLICATION_JSON);
        return h;
    }

    /**
     * Returns the Cloudflare record ID if a record for `name` already exists, else
     * null.
     */
    private String findExistingRecord(String name) {
        try {
            String url = CF_API_BASE + "/zones/" + zoneId + "/dns_records?type=CNAME&name=" + name;
            ResponseEntity<CfListResponse> resp = restTemplate.exchange(
                    url, HttpMethod.GET,
                    new HttpEntity<>(authHeaders()),
                    CfListResponse.class);
            CfListResponse body = resp.getBody();
            if (body != null && body.getResult() != null && !body.getResult().isEmpty()) {
                return body.getResult().get(0).getId();
            }
        } catch (Exception e) {
            log.warn("[CloudflareService] Could not check existing record for name={}: {}", name, e.getMessage());
        }
        return null;
    }

    private WhiteLabelSetupResponse.DnsRecordResult createCname(String name, String target) {
        String url = CF_API_BASE + "/zones/" + zoneId + "/dns_records";
        Map<String, Object> body = Map.of(
                "type", "CNAME",
                "name", name,
                "content", target,
                "proxied", true,
                "ttl", 1 // 1 = auto in Cloudflare
        );
        try {
            ResponseEntity<CfSingleResponse> resp = restTemplate.exchange(
                    url, HttpMethod.POST,
                    new HttpEntity<>(body, authHeaders()),
                    CfSingleResponse.class);
            CfSingleResponse r = resp.getBody();
            String recordId = (r != null && r.getResult() != null) ? r.getResult().getId() : null;
            log.info("[CloudflareService] Created CNAME {} → {} (id={})", name, target, recordId);
            return buildResult("CREATED", name, target, recordId);
        } catch (HttpClientErrorException e) {
            log.error("[CloudflareService] Failed to create CNAME {} → {}: {}", name, target,
                    e.getResponseBodyAsString());
            throw new RuntimeException("Cloudflare DNS create failed for " + name + ": " + e.getResponseBodyAsString());
        }
    }

    private WhiteLabelSetupResponse.DnsRecordResult updateCname(String recordId, String name, String target) {
        String url = CF_API_BASE + "/zones/" + zoneId + "/dns_records/" + recordId;
        Map<String, Object> body = Map.of(
                "type", "CNAME",
                "name", name,
                "content", target,
                "proxied", true,
                "ttl", 1);
        try {
            restTemplate.exchange(url, HttpMethod.PUT,
                    new HttpEntity<>(body, authHeaders()),
                    Void.class);
            log.info("[CloudflareService] Updated CNAME {} → {} (id={})", name, target, recordId);
            return buildResult("UPDATED", name, target, recordId);
        } catch (HttpClientErrorException e) {
            log.error("[CloudflareService] Failed to update CNAME {} (id={}): {}", name, recordId,
                    e.getResponseBodyAsString());
            throw new RuntimeException("Cloudflare DNS update failed for " + name + ": " + e.getResponseBodyAsString());
        }
    }

    private WhiteLabelSetupResponse.DnsRecordResult buildResult(String action, String name, String target, String id) {
        return WhiteLabelSetupResponse.DnsRecordResult.builder()
                .type("CNAME")
                .name(name)
                .target(target)
                .proxied(true)
                .cloudflareRecordId(id)
                .action(action)
                .build();
    }

    /**
     * Returns the Pages custom-domain object if {@code host} is already attached
     * to {@code projectName}, else null (including when it simply isn't attached,
     * which Cloudflare reports as 404).
     */
    private CfPagesDomain getPagesDomain(String projectName, String host) {
        try {
            String url = CF_API_BASE + "/accounts/" + accountId + "/pages/projects/" + projectName
                    + "/domains/" + host;
            ResponseEntity<CfPagesDomainResponse> resp = restTemplate.exchange(
                    url, HttpMethod.GET,
                    new HttpEntity<>(authHeaders()),
                    CfPagesDomainResponse.class);
            CfPagesDomainResponse body = resp.getBody();
            return body != null ? body.getResult() : null;
        } catch (HttpClientErrorException.NotFound nf) {
            return null;
        } catch (Exception e) {
            log.warn("[CloudflareService] Could not check existing Pages domain {} on {}: {}",
                    host, projectName, e.getMessage());
            return null;
        }
    }

    private WhiteLabelSetupResponse.PagesDomainResult buildPagesResult(
            String action, String project, String name, String status, String pagesTarget) {
        return WhiteLabelSetupResponse.PagesDomainResult.builder()
                .project(project)
                .name(name)
                .status(status)
                .action(action)
                .pagesCnameTarget(pagesTarget)
                .build();
    }

    // ── Inner types for Cloudflare API JSON ───────────────────────────────────

    @Data
    @JsonIgnoreProperties(ignoreUnknown = true)
    static class CfListResponse {
        private List<CfRecord> result;
    }

    @Data
    @JsonIgnoreProperties(ignoreUnknown = true)
    static class CfSingleResponse {
        private CfRecord result;
    }

    @Data
    @JsonIgnoreProperties(ignoreUnknown = true)
    static class CfRecord {
        private String id;
        private String name;
        private String content;

        @JsonProperty("zone_id")
        private String zoneId;
    }

    @Data
    @JsonIgnoreProperties(ignoreUnknown = true)
    static class CfPagesDomainResponse {
        private CfPagesDomain result;
    }

    @Data
    @JsonIgnoreProperties(ignoreUnknown = true)
    static class CfPagesDomain {
        private String id;
        private String name;
        private String status;
    }

    /**
     * {@code success} is read here, unlike the single-record responses, because a
     * paged listing has a failure mode they don't: Cloudflare answers 200 with
     * {@code success=false, result=null} for a bad page cursor, which would
     * otherwise be indistinguishable from the end of the list.
     */
    @Data
    @JsonIgnoreProperties(ignoreUnknown = true)
    static class CfPagesDomainListResponse {
        private boolean success;
        private List<CfPagesDomain> result;
    }
}
