package vacademy.io.admin_core_service.features.commerce.storefront.redirect;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionException;
import org.springframework.transaction.support.TransactionTemplate;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.InvalidRequestException;
import vacademy.io.common.exceptions.ResourceNotFoundException;
import vacademy.io.common.exceptions.VacademyException;

import java.io.UncheckedIOException;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Supplier;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Staff work on a shop's old-site redirects ({@code site_redirect}): the list, the CSV import
 * (validate, then commit with the validation's token), removing a row and the CSV export.
 * Every method takes the institute id the access guard has already checked.
 *
 * <p>Validate and commit run the same {@link SiteRedirectPlanner} against the stored rows read
 * from the primary database. Commit plans again inside its transaction, under the institute's
 * redirect lock, and writes only when the plan is the one the token stands for, so what was
 * shown is what is written. A commit writes every row or none.
 *
 * <p>Every commit has an id and keeps an undo record in its audit row (the ids it created and,
 * for each row it changed, the old target and status: what the rows held before, as a delete's
 * audit row keeps the removed row). {@link #undo} takes the whole commit back in one go, under
 * the same lock, and only while every row is still as the commit left it.
 *
 * <p>The commit token ({@link #token}) is a digest of the institute, the file and the plan, not a
 * secret: it proves the file was planned against the rows stored now, so a commit writes what
 * the validation showed. Anyone who may commit could compute it; that is fine, because the
 * commit plans again and refuses any error. It starts with the first characters of the file's
 * SHA-256, so a commit checks the token's shape and that it was handed out for this file before
 * it takes the lock and plans; the full comparison follows the plan, under the lock.
 *
 * <p>A database failure is answered with a plain message and code; the cause goes to the log
 * only, never into the answer.
 */
@Service
public class SiteRedirectAdminService {

    static final int MAX_PAGE_SIZE = 200;
    static final int MAX_SEARCH_CHARS = 200;
    /** Most issues returned; the counts are always exact. */
    static final int MAX_ISSUES = 1000;
    static final String TOKEN_PREFIX = "rv2.";
    /** Characters of the file's SHA-256 the token starts with. */
    static final int TOKEN_FILE_CHARS = 16;
    private static final Pattern TOKEN_SHAPE =
            Pattern.compile("rv2\\.([0-9a-f]{" + TOKEN_FILE_CHARS + "})\\.[0-9a-f]{64}");

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final Logger log = LoggerFactory.getLogger(SiteRedirectAdminService.class);
    static final int MAX_COMMIT_ID_CHARS = 64;

    private final SiteRedirectStore store;
    private final CommerceAuditService auditService;
    private final TransactionTemplate transaction;
    /** The time and PREFIX steps each plan may use (a test may give less). */
    Supplier<SiteRedirectPlanner.Budget> planBudget = SiteRedirectPlanner.Budget::standard;

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
        String matchFilter = match;
        long total = reading(() -> store.count(instituteId, needles, matchFilter, statusCode));
        long offset = (long) page * size;
        List<SiteRedirectDtos.RedirectRow> rows = offset >= total ? List.of()
                : reading(() -> store.page(instituteId, needles, matchFilter, statusCode,
                        (int) Math.min(offset, Integer.MAX_VALUE), size))
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
        SiteRedirectPlanner.Plan plan = reading(() -> plan(instituteId, parsed));
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
        // Checked before the lock and the plan: a token of the wrong shape or for another file
        // costs nothing to refuse.
        Matcher shape = TOKEN_SHAPE.matcher(commitToken.trim());
        if (!shape.matches()) {
            throw new InvalidRequestException("the commit_token is not one mode=validate returns; validate the"
                    + " file and commit with the commit_token it returns");
        }
        String fileSha = sha256(content);
        if (!fileSha.startsWith(shape.group(1))) {
            throw new ConflictException("the commit_token was handed out for another file; validate this file"
                    + " and commit with the commit_token it returns");
        }
        SiteRedirectCsv.Parsed parsed = SiteRedirectCsv.parse(content);
        return writing(() -> transaction.execute(status -> {
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

            String commitId = UUID.randomUUID().toString();
            Map<String, Object> detail = new LinkedHashMap<>();
            detail.put("commit_id", commitId);
            detail.put("file_sha256", fileSha);
            detail.put("rows", parsed.rows().size());
            detail.put("created", plan.creates().size());
            detail.put("updated", plan.updates().size());
            detail.put("unchanged", plan.unchanged());
            detail.put("ignored", plan.ignored());
            detail.put("warnings", plan.warningCount());
            auditService.record(instituteId, actorUserId, null, "REDIRECTS_IMPORTED", "SITE_REDIRECT", commitId,
                    json(undoRecord(plan, ids)), json(detail), null);

            SiteRedirectDtos.RedirectImportResult result = result("commit", fileName, fileSha, parsed, plan);
            result.setCommitted(true);
            result.setCommitId(commitId);
            List<SiteRedirectDtos.WrittenRow> created = new ArrayList<>(ids.size());
            for (int i = 0; i < ids.size(); i++) {
                created.add(written(plan.creates().get(i), ids.get(i)));
            }
            result.setCreated(created);
            result.setUpdated(plan.updates().stream().map(u -> written(u, u.id())).toList());
            return result;
        }));
    }

    // -------------------------------------------------------------------- undo

    /**
     * Takes one commit back: removes the rows it created and puts the rows it changed back to
     * their old target and status, all or nothing, under the institute's redirect lock. Refused
     * (409) when it was undone already, when any of its rows has been changed or removed since
     * (a later change would be lost), or when putting a row back would make a second hop or a
     * PREFIX circle with rows added since. 404 for a commit id the institute does not have.
     */
    public SiteRedirectDtos.RedirectUndoResult undo(String instituteId, String actorUserId, String commitId) {
        if (commitId == null || commitId.isBlank() || commitId.length() > MAX_COMMIT_ID_CHARS) {
            throw new ResourceNotFoundException("no redirect commit with this id");
        }
        String id = commitId.trim();
        return writing(() -> transaction.execute(status -> {
            store.lock(instituteId);
            String record = store.commitRecord(instituteId, id)
                    .orElseThrow(() -> new ResourceNotFoundException("no redirect commit with this id"));
            if (store.commitUndone(instituteId, id)) {
                throw new ConflictException("this commit has already been undone");
            }
            UndoRecord undo = UndoRecord.read(record);
            if (undo == null) {
                throw new ConflictException("this commit has no undo record; take it back with the created and"
                        + " updated lists its commit answer returned");
            }
            Map<String, SiteRedirectPlanner.Existing> byId = new HashMap<>();
            List<SiteRedirectPlanner.Existing> all = store.all(instituteId);
            for (SiteRedirectPlanner.Existing e : all) {
                byId.put(e.id(), e);
            }
            List<String> updatedIds = undo.updated().stream().map(UndoRow::id).toList();
            if (!digest(undo.createdIds(), byId).equals(undo.createdDigest())
                    || !digest(updatedIds, byId).equals(undo.updatedDigest())) {
                long gone = undo.createdIds().stream().filter(x -> !byId.containsKey(x)).count()
                        + updatedIds.stream().filter(x -> !byId.containsKey(x)).count();
                throw new ConflictException("rows this commit wrote have been changed or removed since (" + gone
                        + " removed); the undo is refused so no later change is lost. Export the redirects and"
                        + " correct them with a file");
            }
            Set<String> created = new HashSet<>(undo.createdIds());
            Map<String, UndoRow> restore = new HashMap<>();
            for (UndoRow row : undo.updated()) {
                restore.put(row.id(), row);
            }
            List<SiteRedirectPlanner.Existing> after = new ArrayList<>(all.size());
            List<SiteRedirectPlanner.Change> back = new ArrayList<>(restore.size());
            for (SiteRedirectPlanner.Existing e : all) {
                if (created.contains(e.id())) {
                    continue;
                }
                UndoRow old = restore.get(e.id());
                if (old == null) {
                    after.add(e);
                    continue;
                }
                after.add(new SiteRedirectPlanner.Existing(e.id(), e.matchType(), e.fromPath(), old.toPath(),
                        old.statusCode()));
                back.add(new SiteRedirectPlanner.Change(0, e.id(), e.matchType(), e.fromPath(), old.toPath(),
                        old.statusCode(), e.toPath(), e.statusCode()));
            }
            List<String> problems = timed(() -> SiteRedirectPlanner.restoreProblems(after, restore.keySet(),
                    planBudget.get()));
            if (!problems.isEmpty()) {
                throw new ConflictException("undoing this commit would " + problems.get(0)
                        + (problems.size() > 1 ? " (and " + (problems.size() - 1) + " more)" : "")
                        + "; change those rows first, or correct the redirects with a file");
            }
            store.deleteAll(instituteId, undo.createdIds());
            store.update(instituteId, back);

            Map<String, Object> detail = new LinkedHashMap<>();
            detail.put("commit_id", id);
            detail.put("removed", undo.createdIds().size());
            detail.put("restored", back.size());
            auditService.record(instituteId, actorUserId, null, "REDIRECTS_UNDONE", "SITE_REDIRECT", id, null,
                    json(detail), null);
            return SiteRedirectDtos.RedirectUndoResult.builder().commitId(id).removed(undo.createdIds().size())
                    .restored(back.size()).build();
        }));
    }

    /** One changed row of a commit: its id and what it held before. */
    record UndoRow(String id, String toPath, int statusCode) {
    }

    /**
     * What an undo needs, kept in the commit's audit row: the created ids, the changed rows' old
     * values, and a digest of every row as the commit left it. Each changed row is written as
     * {@code [id, old_to_path, old_status_code]}, without the field names on every row; the
     * longer form {@code {"id", "old_to_path", "old_status_code"}} is read too.
     */
    record UndoRecord(List<String> createdIds, String createdDigest, List<UndoRow> updated, String updatedDigest) {

        static UndoRecord read(String json) {
            try {
                JsonNode root = json == null || json.isBlank() ? null : JSON.readTree(json);
                if (root == null || !root.has("created_ids") || !root.has("updated")) {
                    return null;
                }
                List<String> created = new ArrayList<>();
                root.get("created_ids").forEach(n -> created.add(n.asText()));
                List<UndoRow> updated = new ArrayList<>();
                for (JsonNode n : root.get("updated")) {
                    JsonNode id = n.isArray() ? n.get(0) : n.get("id");
                    JsonNode toPath = n.isArray() ? n.get(1) : n.get("old_to_path");
                    JsonNode statusCode = n.isArray() ? n.get(2) : n.get("old_status_code");
                    updated.add(new UndoRow(id.asText(), toPath.isNull() ? null : toPath.asText(), statusCode.asInt()));
                }
                return new UndoRecord(created, root.path("created_digest").asText(), updated,
                        root.path("updated_digest").asText());
            } catch (JsonProcessingException | RuntimeException e) {
                return null;
            }
        }
    }

    private static Map<String, Object> undoRecord(SiteRedirectPlanner.Plan plan, List<String> createdIds) {
        List<String> createdLines = new ArrayList<>(createdIds.size());
        for (int i = 0; i < createdIds.size(); i++) {
            SiteRedirectPlanner.Change c = plan.creates().get(i);
            createdLines.add(stateLine(createdIds.get(i), c.matchType(), c.fromPath(), c.toPath(), c.statusCode()));
        }
        List<String> updatedLines = new ArrayList<>(plan.updates().size());
        List<List<Object>> updated = new ArrayList<>(plan.updates().size());
        for (SiteRedirectPlanner.Change u : plan.updates()) {
            updatedLines.add(stateLine(u.id(), u.matchType(), u.fromPath(), u.toPath(), u.statusCode()));
            updated.add(Arrays.asList(u.id(), u.oldToPath(), u.oldStatusCode()));
        }
        Map<String, Object> record = new LinkedHashMap<>();
        record.put("created_ids", createdIds);
        record.put("created_digest", digestOf(createdLines));
        record.put("updated", updated);
        record.put("updated_digest", digestOf(updatedLines));
        return record;
    }

    /** The digest of the rows with these ids as they are stored now (a missing row counts as such). */
    private static String digest(List<String> ids, Map<String, SiteRedirectPlanner.Existing> byId) {
        List<String> lines = new ArrayList<>(ids.size());
        for (String id : ids) {
            SiteRedirectPlanner.Existing e = byId.get(id);
            lines.add(e == null ? id + "\u0000missing"
                    : stateLine(id, e.matchType(), e.fromPath(), e.toPath(), e.statusCode()));
        }
        return digestOf(lines);
    }

    private static String stateLine(String id, String matchType, String fromPath, String toPath, int statusCode) {
        return id + "\u0000" + matchType + "\u0000" + fromPath + "\u0000" + toPath + "\u0000" + statusCode;
    }

    private static String digestOf(List<String> lines) {
        List<String> sorted = new ArrayList<>(lines);
        sorted.sort(null);
        return SiteRedirectPlanner.sha256(String.join("\n", sorted));
    }

    // ------------------------------------------------------------------ delete

    /**
     * Removes one row of the institute; answers the row as it was (404 when it is not there).
     * Takes the redirect lock, so it never runs between a commit's plan and its writes.
     */
    public SiteRedirectDtos.RedirectRow delete(String instituteId, String actorUserId, String id) {
        if (id == null || id.isBlank() || id.length() > 36) {
            throw new ResourceNotFoundException("no redirect with this id");
        }
        return writing(() -> transaction.execute(status -> {
            store.lock(instituteId);
            SiteRedirectStore.Row row = store.find(instituteId, id)
                    .orElseThrow(() -> new ResourceNotFoundException("no redirect with this id"));
            if (store.delete(instituteId, id) != 1) {
                throw new ConflictException("the redirect changed while it was being removed; look at the list"
                        + " and try again");
            }
            Map<String, Object> old = new LinkedHashMap<>();
            old.put("match_type", row.matchType());
            old.put("from_path", row.fromPath());
            old.put("to_path", row.toPath());
            old.put("status_code", row.statusCode());
            auditService.record(instituteId, actorUserId, null, "REDIRECT_DELETED", "SITE_REDIRECT", id,
                    json(old), null, null);
            return view(row);
        }));
    }

    // ------------------------------------------------------------------ export

    /**
     * Records an export that was sent (counts only): called after the file has been written, with
     * the number of rows it held.
     */
    public void auditExport(String instituteId, String actorUserId, int rows) {
        Map<String, Object> detail = new LinkedHashMap<>();
        detail.put("rows", rows);
        writing(() -> {
            transaction.executeWithoutResult(status -> auditService.record(instituteId, actorUserId,
                    "REDIRECTS_EXPORTED", "SITE_REDIRECT", null, json(detail)));
            return null;
        });
    }

    /**
     * Every row of the institute in the import's columns, as a file the import takes back to the
     * same rows (a percent sign in a stored address is written as {@code %25}).
     */
    public List<SiteRedirectCsv.ExportRow> exportRows(String instituteId) {
        List<SiteRedirectCsv.ExportRow> rows = new ArrayList<>();
        reading(() -> {
            store.each(instituteId, row -> rows.add(new SiteRedirectCsv.ExportRow(
                    SiteRedirectPaths.fromPathForFile(row.fromPath()), row.toPath(), row.statusCode(), row.matchType())));
            return null;
        });
        return rows;
    }

    // ----------------------------------------------------------------- helpers

    /** A read; a database failure becomes a plain 500 with no SQL in it. */
    private static <T> T reading(Supplier<T> work) {
        try {
            return work.get();
        } catch (DataAccessException e) {
            log.error("Redirect read failed", e);
            throw new VacademyException(HttpStatus.INTERNAL_SERVER_ERROR,
                    "REDIRECT_READ_FAILED: the redirects could not be read; try again");
        }
    }

    /**
     * A write; a clash with a row written at the same moment becomes a 409 and any other database
     * failure a plain 500, both with no SQL in them. The transaction has rolled back either way.
     */
    private static <T> T writing(Supplier<T> work) {
        try {
            return work.get();
        } catch (DataIntegrityViolationException e) {
            log.warn("Redirect write refused by the database: {}", e.getMostSpecificCause().getClass().getSimpleName());
            throw new ConflictException("REDIRECT_CONFLICT: the stored redirects changed while this was written;"
                    + " nothing was saved. Validate the file again");
        } catch (DataAccessException | TransactionException e) {
            log.error("Redirect write failed", e);
            throw new VacademyException(HttpStatus.INTERNAL_SERVER_ERROR,
                    "REDIRECT_WRITE_FAILED: the redirects could not be saved and nothing was changed; try again");
        }
    }

    private SiteRedirectPlanner.Plan plan(String instituteId, SiteRedirectCsv.Parsed parsed) {
        List<SiteRedirectPlanner.Existing> existing = store.all(instituteId);
        Set<String> products = store.activeProductSlugs(instituteId);
        Set<String> collections = store.activeCollectionSlugs(instituteId);
        return timed(() -> SiteRedirectPlanner.plan(parsed.rows(), existing, products, collections, planBudget.get()));
    }

    /** A plan stopped at its time limit becomes a plain 400; in a commit the transaction rolls back. */
    private static <T> T timed(Supplier<T> planning) {
        try {
            return planning.get();
        } catch (SiteRedirectPlanner.PlanTooSlowException e) {
            log.warn("Redirect plan stopped: {}", e.getMessage());
            throw new InvalidRequestException("REDIRECT_PLAN_TOO_SLOW: checking these redirects took longer than "
                    + SiteRedirectPlanner.MAX_PLAN_MILLIS / 1000 + " seconds and was stopped; split the file, or use"
                    + " fewer PREFIX rows whose targets other PREFIX rows catch");
        }
    }

    /**
     * Names the institute, the file and the plan (old values included), after the first
     * {@link #TOKEN_FILE_CHARS} characters of the file's SHA-256.
     */
    static String token(String instituteId, String fileSha, SiteRedirectPlanner.Plan plan) {
        return TOKEN_PREFIX + fileSha.substring(0, TOKEN_FILE_CHARS) + "."
                + SiteRedirectPlanner.sha256(instituteId + "\n" + fileSha + "\n" + plan.fingerprint());
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
                .rowsIgnored(plan.ignored())
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
