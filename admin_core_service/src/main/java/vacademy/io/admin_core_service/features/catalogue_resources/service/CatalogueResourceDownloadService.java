package vacademy.io.admin_core_service.features.catalogue_resources.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.audience.service.AudienceRoleAccessService;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.catalogue_resources.dto.LeadResourceDownload;
import vacademy.io.admin_core_service.features.catalogue_resources.dto.ResourceDownloadReport;
import vacademy.io.admin_core_service.features.catalogue_resources.dto.ResourceDownloadRequest;
import vacademy.io.admin_core_service.features.catalogue_resources.entity.CatalogueResourceDownload;
import vacademy.io.admin_core_service.features.catalogue_resources.repository.CatalogueResourceDownloadRepository;
import vacademy.io.admin_core_service.features.counsellor_workbench.service.CounsellorScopeService;
import vacademy.io.admin_core_service.features.suborg.service.SubOrgLeadScopeService;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.*;

/**
 * Freebie downloads on catalogue sites: recording one from the visitor's
 * browser, and the admin report of who took what.
 *
 * A download is tied to a lead by the email (or phone) the visitor typed into
 * a gate form in that browser. That is the same trust the form itself has —
 * anyone can type any email into a public form — so the worst a forged call
 * can do is add a download line to an existing lead.
 *
 * Deliberately NOT written to timeline_event: an ACTIVITY row there counts as
 * a counsellor response (TAT/SLA buckets), as last activity, and in activity
 * reports, so a lead taking a PDF would look worked. The Lead Profile reads
 * this table directly instead (forLead).
 */
@Service
public class CatalogueResourceDownloadService {

    private static final Logger logger = LoggerFactory.getLogger(CatalogueResourceDownloadService.class);

    /** The same lead opening the same file again inside this window is one download. */
    private static final int REPEAT_WINDOW_MINUTES = 10;
    private static final int MAX_DAYS = 365;
    private static final String TITLE_SEPARATOR = String.valueOf((char) 31);

    @Autowired
    private CatalogueResourceDownloadRepository repository;

    @Autowired
    private AuthService authService;

    @Autowired
    private InstituteAccessValidator accessValidator;

    @Autowired
    private AudienceRoleAccessService audienceRoleAccessService;

    @Autowired
    private CounsellorScopeService counsellorScopeService;

    @Autowired
    private SubOrgLeadScopeService subOrgLeadScopeService;

    /** Never throws: a beacon must not be able to break a visitor's page. */
    public void record(ResourceDownloadRequest req) {
        try {
            if (req == null || isBlank(req.getInstituteId()) || isBlank(req.getResourceUrl())) return;
            String instituteId = trim(req.getInstituteId(), 36);
            String url = trim(req.getResourceUrl(), 1024);
            String title = trim(req.getResourceTitle(), 255);

            // The gate list is only kept when it really belongs to this institute.
            String audienceId = trim(req.getAudienceId(), 36);
            if (!isBlank(audienceId) && repository.audienceInInstitute(audienceId, instituteId).isEmpty()) {
                audienceId = null;
            }

            String responseId = null;
            String userId = null;
            Object[] lead = findLead(instituteId, audienceId, req.getEmail(), req.getMobileNumber());
            if (lead != null) {
                responseId = (String) lead[0];
                userId = lead[1] == null ? null : String.valueOf(lead[1]);
                Timestamp since = Timestamp.from(Instant.now().minus(REPEAT_WINDOW_MINUTES, ChronoUnit.MINUTES));
                if (repository.countRecent(responseId, url, since) > 0) return;
            }

            repository.save(CatalogueResourceDownload.builder()
                    .instituteId(instituteId)
                    .catalogueId(trim(req.getCatalogueId(), 36))
                    .pageRoute(req.getPageRoute() == null ? "" : trim(req.getPageRoute(), 255))
                    .audienceId(audienceId)
                    .audienceResponseId(responseId)
                    .userId(userId)
                    .resourceTitle(title)
                    .resourceUrl(url)
                    .build());

        } catch (Exception e) {
            logger.warn("[catalogue-resources] dropped download: {}", e.getMessage());
        }
    }

    private Object[] findLead(String instituteId, String audienceId, String email, String mobile) {
        if (!isBlank(email)) {
            List<Object[]> rows = repository.findLeadByEmail(instituteId, audienceId, email.trim());
            if (!rows.isEmpty()) return rows.get(0);
        }
        String digits = mobile == null ? "" : mobile.replaceAll("[^0-9]", "");
        if (!isBlank(audienceId) && digits.length() >= 10) {
            List<Object[]> rows = repository.findLeadByPhone(audienceId, digits.substring(digits.length() - 10));
            if (!rows.isEmpty()) return rows.get(0);
        }
        return null;
    }

    /** One lead's freebies, newest first — the Lead Profile card. */
    public List<LeadResourceDownload> forLead(CustomUserDetails user, String instituteId, String userId) {
        accessValidator.validateUserAccess(user, instituteId);
        if (isBlank(userId)) return List.of();
        List<LeadResourceDownload> out = new ArrayList<>();
        for (Object[] r : repository.forLead(instituteId, userId.trim())) {
            out.add(LeadResourceDownload.builder()
                    .title(str(r[0]))
                    .url(str(r[1]))
                    .downloadedAt(iso(r[2]))
                    .build());
        }
        return out;
    }

    public ResourceDownloadReport report(CustomUserDetails user, String instituteId, String audienceId, int days) {
        // instituteId comes from the caller, so it is checked against the caller's own authorities.
        accessValidator.validateUserAccess(user, instituteId);
        // This report lists leads by name and phone across the whole institute or
        // list, without the per-caller narrowing the lead list applies (sub-org
        // admins, counsellor hierarchy, role access modes). Rather than re-derive
        // that narrowing here, only callers who already see every lead get it.
        if (!seesAllLeads(user, instituteId)) return emptyReport();
        String audience = isBlank(audienceId) ? null : audienceId.trim();
        int window = Math.max(1, Math.min(days, MAX_DAYS));
        Timestamp from = Timestamp.from(Instant.now().minus(window, ChronoUnit.DAYS));

        long total = 0, leadCount = 0;
        List<Object[]> totals = repository.totals(instituteId, audience, from);
        if (!totals.isEmpty() && totals.get(0) != null) {
            total = num(totals.get(0), 0);
            leadCount = num(totals.get(0), 1);
        }

        List<ResourceDownloadReport.ResourceRow> resources = new ArrayList<>();
        for (Object[] r : repository.byResource(instituteId, audience, from)) {
            resources.add(ResourceDownloadReport.ResourceRow.builder()
                    .url(str(r[0]))
                    .title(str(r[1]))
                    .downloads(num(r, 2))
                    .leads(num(r, 3))
                    .lastDownloadedAt(iso(r[4]))
                    .build());
        }

        List<Object[]> leadRows = repository.byLead(instituteId, audience, from);
        Map<String, UserDTO> users = usersById(leadRows);
        List<ResourceDownloadReport.LeadRow> leads = new ArrayList<>();
        for (Object[] r : leadRows) {
            String userId = str(r[1]);
            UserDTO u = userId == null ? null : users.get(userId);
            leads.add(ResourceDownloadReport.LeadRow.builder()
                    .responseId(str(r[0]))
                    .userId(userId)
                    .name(firstNonBlank(u == null ? null : u.getFullName(), str(r[2])))
                    .email(firstNonBlank(str(r[3]), u == null ? null : u.getEmail()))
                    .mobileNumber(firstNonBlank(str(r[4]), u == null ? null : u.getMobileNumber()))
                    .audienceName(str(r[5]))
                    .downloads(num(r, 6))
                    .resources(distinctTitles(str(r[7])))
                    .lastDownloadedAt(iso(r[8]))
                    .build());
        }

        return ResourceDownloadReport.builder()
                .totalDownloads(total)
                .leadsWithDownloads(leadCount)
                .resources(resources)
                .leads(leads)
                .build();
    }

    /**
     * True for callers whose lead list is institute-wide: the same three checks
     * AudienceService.getLeads uses to narrow it. Fails closed on any error.
     */
    private boolean seesAllLeads(CustomUserDetails user, String instituteId) {
        if (user == null || isBlank(user.getUserId())) return false;
        try {
            if (audienceRoleAccessService.resolveForCaller(user, instituteId).getMode()
                    != AudienceRoleAccessService.Mode.DEFAULT) return false;
            if (!subOrgLeadScopeService.subOrgScopedCounsellorUserIds(user.getUserId()).isEmpty()) return false;
            return !counsellorScopeService.isScopedCaller(instituteId, user);
        } catch (Exception e) {
            logger.warn("[catalogue-resources] scope check failed for {}: {}", user.getUserId(), e.getMessage());
            return false;
        }
    }

    private static ResourceDownloadReport emptyReport() {
        return ResourceDownloadReport.builder()
                .totalDownloads(0)
                .leadsWithDownloads(0)
                .resources(List.of())
                .leads(List.of())
                .build();
    }

    /** Website-form leads carry no parent_name, so the name comes from the auth user. */
    private Map<String, UserDTO> usersById(List<Object[]> leadRows) {
        List<String> ids = leadRows.stream().map(r -> str(r[1])).filter(Objects::nonNull).distinct().toList();
        Map<String, UserDTO> out = new HashMap<>();
        if (ids.isEmpty()) return out;
        try {
            for (UserDTO u : authService.getUsersFromAuthServiceByUserIds(ids)) {
                if (u != null && u.getId() != null) out.put(u.getId(), u);
            }
        } catch (Exception e) {
            // The report still renders with emails and phones.
            logger.warn("[catalogue-resources] user lookup failed: {}", e.getMessage());
        }
        return out;
    }

    private static List<String> distinctTitles(String joined) {
        if (joined == null || joined.isEmpty()) return List.of();
        return new ArrayList<>(new LinkedHashSet<>(Arrays.asList(joined.split(TITLE_SEPARATOR))));
    }

    /** created_at is a UTC wall-clock timestamp; report it as an instant. */
    private static String iso(Object v) {
        if (v == null) return null;
        if (v instanceof Timestamp t) return t.toLocalDateTime().toInstant(ZoneOffset.UTC).toString();
        if (v instanceof LocalDateTime t) return t.toInstant(ZoneOffset.UTC).toString();
        if (v instanceof OffsetDateTime t) return t.toInstant().toString();
        if (v instanceof Instant t) return t.toString();
        return String.valueOf(v);
    }

    private static long num(Object[] row, int i) {
        return row.length > i && row[i] instanceof Number n ? n.longValue() : 0L;
    }

    private static String str(Object v) {
        return v == null ? null : String.valueOf(v);
    }

    private static String firstNonBlank(String a, String b) {
        return !isBlank(a) ? a : (!isBlank(b) ? b : null);
    }

    private static boolean isBlank(String s) {
        return s == null || s.isBlank();
    }

    /** Column widths are a contract; an over-long value must not fail an insert. */
    private static String trim(String s, int max) {
        if (s == null) return null;
        String t = s.trim();
        return t.length() <= max ? t : t.substring(0, max);
    }
}
