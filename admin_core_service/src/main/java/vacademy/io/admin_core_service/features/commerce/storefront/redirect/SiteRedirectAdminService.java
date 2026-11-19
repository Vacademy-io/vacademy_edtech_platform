package vacademy.io.admin_core_service.features.commerce.storefront.redirect;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.InvalidRequestException;
import vacademy.io.common.exceptions.ResourceNotFoundException;

import java.io.IOException;
import java.io.OutputStream;
import java.io.UncheckedIOException;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Staff work on a shop's old-site redirects ({@code site_redirect}): the list, the CSV import
 * (validate, then commit with the validation's token), removing a row and the CSV export.
 * Every method takes the institute id the access guard has already checked.
 *
 * <p>Validate and commit run the same {@link SiteRedirectPlanner} against the stored rows read
 * from the primary database. Commit plans again inside its transaction, under the institute's
 * redirect lock, and writes only when the plan is the one the token stands for, so what was
 * shown is what is written. A commit writes every row or none.
 */
@Service
public class SiteRedirectAdminService {

    static final int MAX_PAGE_SIZE = 200;
    static final int MAX_SEARCH_CHARS = 200;
    /** Most issues returned; the counts are always exact. */
    static final int MAX_ISSUES = 1000;
    static final String TOKEN_PREFIX = "rv1.";

    private static final ObjectMapper JSON = new ObjectMapper();

    private final SiteRedirectStore store;
    private final CommerceAuditService auditService;
    private final TransactionTemplate transaction;

    public SiteRedirectAdminService(SiteRedirectStore store, CommerceAuditService auditService,
                                    PlatformTransactionManager transactionManager) {
        this.store = store;
        this.auditService = auditService;
        this.transaction = new TransactionTemplate(transactionManager);
    }

    // -------------------------------------------------------------------- list

    public SiteRedirectDtos.RedirectPage list(String instituteId, String q, String matchType, Integer statusCode,
                                              int page, int size) {
        if (page < 0) {
            throw new InvalidRequestException("page must be 0 or more");
        }
        if (size < 1 || size > MAX_PAGE_SIZE) {
            throw new InvalidRequestException("size must be 1 to " + MAX_PAGE_SIZE);
        }
        String match = null;
        if (matchType != null && !matchType.isBlank()) {
            match = matchType.trim().toUpperCase(Locale.ROOT);
            if (!SiteRedirectPlanner.EXACT.equals(match) && !SiteRedirectPlanner.PREFIX.equals(match)) {
                throw new InvalidRequestException("match_type must be EXACT or PREFIX");
            }
        }
        if (statusCode != null && statusCode != 301 && statusCode != 410) {
            throw new InvalidRequestException("status_code must be 301 or 410");
        }
        Set<String> needles = needles(q);
        long total = store.count(instituteId, needles, match, statusCode);
        long offset = (long) page * size;
        List<SiteRedirectDtos.RedirectRow> rows = offset >= total ? List.of()
                : store.page(instituteId, needles, match, statusCode, (int) Math.min(offset, Integer.MAX_VALUE), size)
                        .stream().map(SiteRedirectAdminService::view).toList();
        return SiteRedirectDtos.RedirectPage.builder().redirects(rows).page(page).pageSize(size).total(total).build();
    }

    /**
     * A search finds a path as typed, as the stored address reads it (percent-decoded: from_path
     * is stored decoded) and as the stored target reads it (to_path is stored encoded).
     */
    static Set<String> needles(String q) {
        if (q == null || q.isBlank()) {
            return Set.of();
        }
        String typed = q.trim();
        if (typed.length() > MAX_SEARCH_CHARS) {
            throw new InvalidRequestException("the search is longer than " + MAX_SEARCH_CHARS + " characters");
        }
        Set<String> out = new LinkedHashSet<>();
        out.add(typed);
        try {
            out.add(URLDecoder.decode(typed.replace("+", "%2B"), StandardCharsets.UTF_8));
        } catch (IllegalArgumentException e) {
            // a malformed escape: searched as typed only
        }
        out.add(SiteRedirectPaths.ascii(typed));
        return out;
    }

    // ---------------------------------------------------------------- validate

    /** Checks every row against the stored rows and writes nothing. */
    public SiteRedirectDtos.RedirectImportResult validate(String instituteId, String fileName, byte[] content) {
        SiteRedirectCsv.Parsed parsed = SiteRedirectCsv.parse(content);
        String fileSha = sha256(content);
        SiteRedirectPlanner.Plan plan = plan(instituteId, parsed);
        SiteRedirectDtos.RedirectImportResult result = result("validate", fileName, fileSha, parsed, plan);
        if (!plan.hasErrors()) {
            result.setCommitToken(token(instituteId, fileSha, plan));
        }
        return result;
    }

    // ------------------------------------------------------------------ commit

    /**
     * Writes the file in one transaction when it has no error and the plan equals the one the
     * validation's token stands for. 409 when the file or the stored rows changed since.
     */
    public SiteRedirectDtos.RedirectImportResult commit(String instituteId, String actorUserId, String fileName,
                                                        byte[] content, String commitToken) {
        if (commitToken == null || commitToken.isBlank()) {
            throw new InvalidRequestException("validate the file first: commit takes the commit_token that"
                    + " mode=validate returned for it");
        }
        SiteRedirectCsv.Parsed parsed = SiteRedirectCsv.parse(content);
        String fileSha = sha256(content);
        return transaction.execute(status -> {
            store.lock(instituteId);
            SiteRedirectPlanner.Plan plan = plan(instituteId, parsed);
            if (plan.hasErrors()) {
                throw new InvalidRequestException("the file has " + plan.errorCount()
                        + " errors; validate it to see them, fix them and validate again");
            }
            if (!token(instituteId, fileSha, plan).equals(commitToken.trim())) {
                throw new ConflictException("the file or the stored redirects changed since this file was"
                        + " validated; validate it again and commit with the new commit_token");
            }
            List<String> ids = store.insert(instituteId, plan.creates());
            store.update(instituteId, plan.updates());

            Map<String, Object> detail = new LinkedHashMap<>();
            detail.put("file_sha256", fileSha);
            detail.put("rows", parsed.rows().size());
            detail.put("created", plan.creates().size());
            detail.put("updated", plan.updates().size());
            detail.put("unchanged", plan.unchanged());
            detail.put("warnings", plan.warningCount());
            auditService.record(instituteId, actorUserId, "REDIRECTS_IMPORTED", "SITE_REDIRECT", null, json(detail));

            SiteRedirectDtos.RedirectImportResult result = result("commit", fileName, fileSha, parsed, plan);
            result.setCommitted(true);
            List<SiteRedirectDtos.WrittenRow> created = new ArrayList<>(ids.size());
            for (int i = 0; i < ids.size(); i++) {
                created.add(written(plan.creates().get(i), ids.get(i)));
            }
            result.setCreated(created);
            result.setUpdated(plan.updates().stream().map(u -> written(u, u.id())).toList());
            return result;
        });
    }

    // ------------------------------------------------------------------ delete

    /** Removes one row of the institute; answers the row as it was (404 when it is not there). */
    public SiteRedirectDtos.RedirectRow delete(String instituteId, String actorUserId, String id) {
        if (id == null || id.isBlank() || id.length() > 36) {
            throw new ResourceNotFoundException("no redirect with this id");
        }
        return transaction.execute(status -> {
            SiteRedirectStore.Row row = store.find(instituteId, id)
                    .orElseThrow(() -> new ResourceNotFoundException("no redirect with this id"));
            store.delete(instituteId, id);
            Map<String, Object> old = new LinkedHashMap<>();
            old.put("match_type", row.matchType());
            old.put("from_path", row.fromPath());
            old.put("to_path", row.toPath());
            old.put("status_code", row.statusCode());
            auditService.record(instituteId, actorUserId, null, "REDIRECT_DELETED", "SITE_REDIRECT", id,
                    json(old), null, null);
            return view(row);
        });
    }

    // ------------------------------------------------------------------ export

    /** Records the export (counts only). */
    public void auditExport(String instituteId, String actorUserId) {
        Map<String, Object> detail = new LinkedHashMap<>();
        detail.put("rows", store.count(instituteId, Set.of(), null, null));
        transaction.executeWithoutResult(status -> auditService.record(instituteId, actorUserId,
                "REDIRECTS_EXPORTED", "SITE_REDIRECT", null, json(detail)));
    }

    /** Every row of the institute in the import's columns. */
    public void export(String instituteId, OutputStream out) throws IOException {
        List<SiteRedirectCsv.ExportRow> rows = new ArrayList<>();
        store.each(instituteId, row -> rows.add(new SiteRedirectCsv.ExportRow(row.fromPath(), row.toPath(),
                row.statusCode(), row.matchType())));
        SiteRedirectCsv.write(out, rows);
    }

    // ----------------------------------------------------------------- helpers

    private SiteRedirectPlanner.Plan plan(String instituteId, SiteRedirectCsv.Parsed parsed) {
        return SiteRedirectPlanner.plan(parsed.rows(), store.all(instituteId), store.activeProductSlugs(instituteId),
                store.activeCollectionSlugs(instituteId));
    }

    /** Names the institute, the file and the plan (old values included). */
    static String token(String instituteId, String fileSha, SiteRedirectPlanner.Plan plan) {
        return TOKEN_PREFIX + SiteRedirectPlanner.sha256(instituteId + "\n" + fileSha + "\n" + plan.fingerprint());
    }

    private static SiteRedirectDtos.RedirectImportResult result(String mode, String fileName, String fileSha,
                                                                SiteRedirectCsv.Parsed parsed,
                                                                SiteRedirectPlanner.Plan plan) {
        List<SiteRedirectDtos.RedirectIssue> issues = plan.issues().stream()
                .limit(MAX_ISSUES)
                .map(i -> SiteRedirectDtos.RedirectIssue.builder().row(i.row())
                        .severity(i.error() ? "error" : "warning").code(i.code()).message(i.message()).build())
                .toList();
        return SiteRedirectDtos.RedirectImportResult.builder()
                .mode(mode)
                .fileName(cleanFileName(fileName))
                .fileSha256(fileSha)
                .rowsTotal(parsed.rows().size())
                .rowsSkipped(parsed.blankRows())
                .toCreate(plan.creates().size())
                .toUpdate(plan.updates().size())
                .unchanged(plan.unchanged())
                .errorCount(plan.errorCount())
                .warningCount(plan.warningCount())
                .issues(issues)
                .issuesTruncated(plan.issues().size() > MAX_ISSUES)
                .build();
    }

    private static SiteRedirectDtos.WrittenRow written(SiteRedirectPlanner.Change c, String id) {
        return SiteRedirectDtos.WrittenRow.builder().row(c.row()).id(id).matchType(c.matchType())
                .fromPath(c.fromPath()).toPath(c.toPath()).statusCode(c.statusCode())
                .oldToPath(c.oldToPath()).oldStatusCode(c.oldStatusCode()).build();
    }

    static SiteRedirectDtos.RedirectRow view(SiteRedirectStore.Row row) {
        return SiteRedirectDtos.RedirectRow.builder().id(row.id()).fromPath(row.fromPath()).toPath(row.toPath())
                .statusCode(row.statusCode()).matchType(row.matchType()).createdAt(row.createdAt())
                .updatedAt(row.updatedAt()).build();
    }

    /** The name without folders, at most 200 characters; null when none was sent. */
    static String cleanFileName(String fileName) {
        if (fileName == null || fileName.isBlank()) {
            return null;
        }
        String name = fileName.replace('\\', '/');
        name = name.substring(name.lastIndexOf('/') + 1).trim();
        return name.length() > 200 ? name.substring(0, 200) : name;
    }

    static String sha256(byte[] content) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(content));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private static String json(Map<String, Object> value) {
        try {
            return JSON.writeValueAsString(value);
        } catch (JsonProcessingException e) {
            throw new UncheckedIOException(e);
        }
    }
}
