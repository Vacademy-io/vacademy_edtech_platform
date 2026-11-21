package vacademy.io.admin_core_service.features.commerce.report.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.commerce.report.export.ReportCsvWriter;
import vacademy.io.admin_core_service.features.commerce.report.export.ReportTable;
import vacademy.io.admin_core_service.features.commerce.report.repository.AuditReadRepository;
import vacademy.io.admin_core_service.features.commerce.report.repository.AuditReadRepository.ApprovalRow;
import vacademy.io.admin_core_service.features.commerce.report.repository.AuditReadRepository.AuditFilter;
import vacademy.io.admin_core_service.features.commerce.report.repository.AuditReadRepository.AuditKeyset;
import vacademy.io.admin_core_service.features.commerce.report.repository.AuditReadRepository.AuditRow;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.io.IOException;
import java.io.OutputStream;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Iterator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

import static vacademy.io.admin_core_service.features.commerce.report.export.ReportTable.text;
import static vacademy.io.admin_core_service.features.commerce.report.export.ReportTable.time;

/**
 * The audit list (contract 6.4): what changed, who did it, where and why, and the PIN approvals.
 * Read-only for everyone; rows with a location only for the caller's locations, rows without one
 * (settings, tax) only for ADMIN and staff of every location. Newest first, keyset paged.
 *
 * <p>Changes are computed on the server: per key of the old and new JSON objects, the keys whose
 * value differs, as {@code {key, old, new}} (text). A value that is not an object is one key
 * {@code value}.
 */
@Service
public class CommerceAuditQueryService {

    public static final String AUDIT = "audit";

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final ZoneId INDIA = ZoneId.of("Asia/Kolkata");
    private static final DateTimeFormatter WHEN = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

    static final ReportTable CSV = ReportTable.of(
            time("when", "When", "कब"),
            text("who", "Who", "किसने"),
            text("location", "Location", "जगह"),
            text("kind", "What happened", "क्या हुआ"),
            text("reference_type", "Reference type", "संदर्भ का प्रकार"),
            text("reference", "Reference", "संदर्भ"),
            text("changes", "Changes", "बदलाव"),
            text("reason", "Reason", "कारण"));

    private final AuditReadRepository repository;

    public CommerceAuditQueryService(AuditReadRepository repository) {
        this.repository = repository;
    }

    /** The checked request of the audit list. */
    public record AuditQuery(String instituteId, ReportRange range, ReportScope scope, String actorUserId,
                             String kind, String reference, String cursor, int size) {
        int pageSize() {
            return size <= 0 ? ReportQuery.DEFAULT_SIZE : Math.min(size, ReportQuery.MAX_SIZE);
        }
    }

    /** One changed key: {@code {key, old, new}} (text; null when absent). */
    public record Change(String key, String old,
                         @com.fasterxml.jackson.annotation.JsonProperty("new") String newValue) {
    }

    /** One audit row as the screen reads it. */
    @Data
    @NoArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class AuditEntry {
        private String id;
        /** ISO time with the India offset ({@code 2026-11-19T10:30:00+05:30}). */
        private String createdAt;
        /** India time as text {@code yyyy-MM-dd HH:mm:ss}. */
        private String when;
        private String actorUserId;
        private String actorName;
        private String locationId;
        private String locationName;
        private String kind;
        private String referenceType;
        private String referenceId;
        private String referenceLabel;
        private List<Change> changes = new ArrayList<>();
        private String reason;
    }

    /** One PIN approval as the screen reads it. */
    @Data
    @NoArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class ApprovalEntry {
        private String id;
        private String createdAt;
        private String when;
        private String action;
        private String referenceType;
        private String referenceId;
        private String referenceLabel;
        private String requestedBy;
        private String requestedByName;
        private String approvedBy;
        private String approvedByName;
        private BigDecimal amount;
        private String reason;
        private String locationId;
        private String locationName;
    }

    /** A page: rows and the cursor of the next page (null on the last). */
    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Page<T> {
        private List<T> rows = new ArrayList<>();
        private String nextCursor;
        private String from;
        private String to;
    }

    /** {@code {kinds: [...]}}. */
    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Kinds {
        private List<String> kinds = new ArrayList<>();
    }

    /** {@code {actors: [{user_id, name}]}}: the "who" filter of the audit screen, by name. */
    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Actors {
        private List<Actor> actors = new ArrayList<>();
    }

    /** One actor: the user id the list filters on ({@code actorUserId}) and the name to show. */
    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class Actor {
        private String userId;
        private String name;
    }

    /** The actors with their names (the id when the account service gave none), by name then id. */
    public static Actors actors(List<String> ids, Map<String, String> names) {
        List<Actor> out = new ArrayList<>();
        for (String id : new LinkedHashSet<>(ids)) {
            if (id != null) {
                out.add(new Actor(id, name(names, id)));
            }
        }
        out.sort(java.util.Comparator.comparing((Actor a) -> a.getName().toLowerCase(java.util.Locale.ROOT))
                .thenComparing(Actor::getUserId));
        return new Actors(out);
    }

    // ================================================================== reads (inside the runner's transaction)

    /** The page of audit rows (names filled later, outside the transaction, by {@link #fillNames}). */
    public Page<AuditEntry> audit(AuditQuery q) {
        AuditFilter f = filter(q);
        int size = q.pageSize();
        List<AuditRow> fetched = new ArrayList<>();
        repository.audit(f, decode(q.cursor()), size + 1, fetched::add);
        boolean more = fetched.size() > size;
        List<AuditRow> page = more ? fetched.subList(0, size) : fetched;
        Page<AuditEntry> out = new Page<>();
        out.setFrom(q.range().from().toString());
        out.setTo(q.range().to().toString());
        for (AuditRow row : page) {
            out.getRows().add(entry(row));
        }
        if (more && !page.isEmpty()) {
            AuditRow last = page.get(page.size() - 1);
            out.setNextCursor(encode(last.createdAtRaw(), last.id()));
        }
        return out;
    }

    /** The page of PIN approvals. */
    public Page<ApprovalEntry> approvals(AuditQuery q) {
        AuditFilter f = filter(q);
        int size = q.pageSize();
        List<ApprovalRow> fetched = new ArrayList<>();
        repository.approvals(f, decode(q.cursor()), size + 1, fetched::add);
        boolean more = fetched.size() > size;
        List<ApprovalRow> page = more ? fetched.subList(0, size) : fetched;
        Page<ApprovalEntry> out = new Page<>();
        out.setFrom(q.range().from().toString());
        out.setTo(q.range().to().toString());
        for (ApprovalRow row : page) {
            ApprovalEntry e = new ApprovalEntry();
            e.setId(row.id());
            e.setCreatedAt(iso(row.createdAt()));
            e.setWhen(when(row.createdAt()));
            e.setAction(row.action());
            e.setReferenceType(row.referenceType());
            e.setReferenceId(row.referenceId());
            e.setReferenceLabel(row.referenceLabel());
            e.setRequestedBy(row.requestedBy());
            e.setApprovedBy(row.approvedBy());
            e.setAmount(ReportTable.money(row.amount()));
            e.setReason(row.reason());
            e.setLocationId(row.locationId());
            e.setLocationName(row.locationName());
            out.getRows().add(e);
        }
        if (more && !page.isEmpty()) {
            ApprovalRow last = page.get(page.size() - 1);
            out.setNextCursor(encode(last.createdAtRaw(), last.id()));
        }
        return out;
    }

    /** The kinds of the rows the caller may see (a location-limited reader: their locations' rows). */
    public Kinds kinds(String instituteId, ReportScope scope) {
        return new Kinds(repository.kinds(instituteId, scope == null ? null : scope.locationIn()));
    }

    /** The staff the filtered rows name (CSV: names are read before the export's transaction). */
    public List<String> actors(AuditQuery q) {
        return repository.actors(filter(q));
    }

    /** The audit rows of the filter as CSV (every row, up to the cap); returns the rows written. */
    public int exportCsv(AuditQuery q, Map<String, String> names, OutputStream out, int maxRows) throws IOException {
        AuditFilter f = filter(q);
        try (ReportCsvWriter writer = ReportCsvWriter.of(out, CSV.columns(), maxRows)) {
            repository.audit(f, null, null, row -> {
                AuditEntry e = entry(row);
                Map<String, Object> csv = ReportTable.row();
                csv.put("when", e.getWhen());
                csv.put("who", name(names, e.getActorUserId()));
                csv.put("location", e.getLocationName());
                csv.put("kind", e.getKind());
                csv.put("reference_type", e.getReferenceType());
                csv.put("reference", e.getReferenceLabel() != null ? e.getReferenceLabel() : e.getReferenceId());
                csv.put("changes", changesText(e.getChanges()));
                csv.put("reason", e.getReason());
                writer.row(csv);
            });
            return writer.rows();
        }
    }

    // ================================================================== names (outside the transaction)

    /** The staff ids a page names. */
    public static Set<String> userIds(Page<?> page) {
        Set<String> ids = new LinkedHashSet<>();
        for (Object row : page.getRows()) {
            if (row instanceof AuditEntry a) {
                ids.add(a.getActorUserId());
            } else if (row instanceof ApprovalEntry a) {
                ids.add(a.getRequestedBy());
                ids.add(a.getApprovedBy());
            }
        }
        ids.remove(null);
        return ids;
    }

    /** Fills the staff names of a page (the id when no name is known). */
    public static void fillNames(Page<?> page, Map<String, String> names) {
        for (Object row : page.getRows()) {
            if (row instanceof AuditEntry a) {
                a.setActorName(name(names, a.getActorUserId()));
            } else if (row instanceof ApprovalEntry a) {
                a.setRequestedByName(name(names, a.getRequestedBy()));
                a.setApprovedByName(name(names, a.getApprovedBy()));
            }
        }
    }

    static String name(Map<String, String> names, String userId) {
        if (userId == null) {
            return null;
        }
        String name = names == null ? null : names.get(userId);
        return name == null || name.isBlank() ? userId : name;
    }

    // ================================================================== helpers

    private AuditFilter filter(AuditQuery q) {
        List<String> referenceIds = null;
        if (q.reference() != null) {
            referenceIds = repository.referenceIds(q.instituteId(), q.reference());
        }
        return new AuditFilter(q.instituteId(), q.range().storedFrom(), q.range().storedToExclusive(),
                q.actorUserId(), q.kind(), q.scope() == null ? null : q.scope().locationIn(), referenceIds);
    }

    static AuditEntry entry(AuditRow row) {
        AuditEntry e = new AuditEntry();
        e.setId(row.id());
        e.setCreatedAt(iso(row.createdAt()));
        e.setWhen(when(row.createdAt()));
        e.setActorUserId(row.actorUserId());
        e.setLocationId(row.locationId());
        e.setLocationName(row.locationName());
        e.setKind(row.kind());
        e.setReferenceType(row.referenceType());
        e.setReferenceId(row.referenceId());
        e.setReferenceLabel(row.referenceLabel());
        e.setChanges(changes(row.oldValueJson(), row.newValueJson()));
        e.setReason(row.reason());
        return e;
    }

    /** Per key of the old and new JSON objects, the keys whose value differs (old first, then new keys). */
    static List<Change> changes(String oldJson, String newJson) {
        JsonNode before = read(oldJson);
        JsonNode after = read(newJson);
        List<Change> out = new ArrayList<>();
        if (before == null && after == null) {
            return out;
        }
        if ((before != null && !before.isObject()) || (after != null && !after.isObject())) {
            String o = valueText(before);
            String n = valueText(after);
            if (!Objects.equals(o, n)) {
                out.add(new Change("value", o, n));
            }
            return out;
        }
        Set<String> keys = new LinkedHashSet<>();
        if (before != null) {
            before.fieldNames().forEachRemaining(keys::add);
        }
        if (after != null) {
            for (Iterator<String> it = after.fieldNames(); it.hasNext(); ) {
                keys.add(it.next());
            }
        }
        for (String key : keys) {
            String o = before == null ? null : valueText(before.get(key));
            String n = after == null ? null : valueText(after.get(key));
            if (!Objects.equals(o, n)) {
                out.add(new Change(key, o, n));
            }
        }
        return out;
    }

    static String changesText(List<Change> changes) {
        List<String> parts = new ArrayList<>();
        for (Change c : changes) {
            parts.add(c.key() + ": " + (c.old() == null ? "—" : c.old()) + " → "
                    + (c.newValue() == null ? "—" : c.newValue()));
        }
        return String.join("; ", parts);
    }

    private static JsonNode read(String json) {
        if (json == null || json.isBlank()) {
            return null;
        }
        try {
            JsonNode node = JSON.readTree(json);
            return node == null || node.isNull() || node.isMissingNode() ? null : node;
        } catch (IOException e) {
            return JSON.getNodeFactory().textNode(json);
        }
    }

    private static String valueText(JsonNode node) {
        if (node == null || node.isNull() || node.isMissingNode()) {
            return null;
        }
        return node.isValueNode() ? node.asText() : node.toString();
    }

    /** A stored time (UTC wall time, contract 3.1) as ISO with the India offset; never through the JVM zone. */
    static String iso(LocalDateTime stored) {
        return stored == null ? null
                : stored.atZone(ZoneOffset.UTC).withZoneSameInstant(INDIA).toOffsetDateTime().toString();
    }

    static String when(LocalDateTime stored) {
        return stored == null ? null
                : stored.atZone(ZoneOffset.UTC).withZoneSameInstant(INDIA).format(WHEN);
    }

    static String encode(String createdAtRaw, String id) {
        return Base64.getUrlEncoder().withoutPadding()
                .encodeToString((createdAtRaw + "|" + id).getBytes(StandardCharsets.UTF_8));
    }

    static AuditKeyset decode(String cursor) {
        if (cursor == null || cursor.isBlank()) {
            return null;
        }
        try {
            String trimmed = cursor.trim();
            if (trimmed.length() > ReportCursor.MAX_LENGTH) {
                throw new IllegalArgumentException("length");
            }
            String raw = new String(Base64.getUrlDecoder().decode(trimmed), StandardCharsets.UTF_8);
            int bar = raw.indexOf('|');
            if (bar <= 0 || bar == raw.length() - 1) {
                throw new IllegalArgumentException("parts");
            }
            String id = raw.substring(bar + 1);
            if (!ReportCursor.ID.matcher(id).matches()) {
                throw new IllegalArgumentException("id");
            }
            return new AuditKeyset(LocalDateTime.parse(raw.substring(0, bar)), id);
        } catch (RuntimeException e) {
            throw new InvalidRequestException("VALIDATION: cursor is not valid; start from the first page");
        }
    }
}
