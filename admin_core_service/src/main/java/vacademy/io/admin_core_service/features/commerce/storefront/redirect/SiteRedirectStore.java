package vacademy.io.admin_core_service.features.commerce.storefront.redirect;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.stereotype.Repository;
import vacademy.io.common.exceptions.ConflictException;

import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.function.Consumer;

/**
 * The SQL of {@code site_redirect} for the staff screens. Every statement names the institute;
 * no row of another institute is ever read, changed or removed.
 */
@Repository
public class SiteRedirectStore {

    private static final int BATCH = 1000;

    /** A stored row as staff see it. */
    public record Row(String id, String fromPath, String toPath, int statusCode, String matchType,
                      Timestamp createdAt, Timestamp updatedAt) {
    }

    private final JdbcTemplate jdbc;

    public SiteRedirectStore(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** Every stored row of the institute, for the planner. */
    public List<SiteRedirectPlanner.Existing> all(String instituteId) {
        return jdbc.query("SELECT id, match_type, from_path, to_path, status_code FROM site_redirect "
                        + "WHERE institute_id = ?",
                (rs, i) -> new SiteRedirectPlanner.Existing(rs.getString("id"), rs.getString("match_type"),
                        rs.getString("from_path"), rs.getString("to_path"), rs.getInt("status_code")),
                instituteId);
    }

    public Set<String> activeProductSlugs(String instituteId) {
        return new HashSet<>(jdbc.queryForList("SELECT slug FROM commerce_product "
                + "WHERE institute_id = ? AND status = 'ACTIVE'", String.class, instituteId));
    }

    public Set<String> activeCollectionSlugs(String instituteId) {
        return new HashSet<>(jdbc.queryForList("SELECT slug FROM commerce_collection "
                + "WHERE institute_id = ? AND status = 'ACTIVE'", String.class, instituteId));
    }

    /**
     * Holds the institute's redirect lock until the transaction ends, so two commits of one
     * institute run one after the other and each plans against what the other wrote.
     */
    public void lock(String instituteId) {
        jdbc.query("SELECT 1 FROM pg_advisory_xact_lock(hashtext(?))", rs -> null, "site_redirect:" + instituteId);
    }

    /** Inserts the creates; returns their new ids in the same order. */
    public List<String> insert(String instituteId, List<SiteRedirectPlanner.Change> creates) {
        List<String> ids = new ArrayList<>(creates.size());
        List<Object[]> args = new ArrayList<>(creates.size());
        for (SiteRedirectPlanner.Change c : creates) {
            String id = UUID.randomUUID().toString();
            ids.add(id);
            args.add(new Object[]{id, instituteId, c.fromPath(), c.matchType(), c.toPath(), c.statusCode()});
        }
        for (int from = 0; from < args.size(); from += BATCH) {
            jdbc.batchUpdate("INSERT INTO site_redirect (id, institute_id, from_path, match_type, to_path, status_code, "
                            + "created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, now(), now())",
                    args.subList(from, Math.min(args.size(), from + BATCH)));
        }
        return ids;
    }

    /**
     * Sets target and status of the updates; each by id and institute. Every row must be there:
     * a row removed in between makes this throw {@link ConflictException}, which rolls the
     * transaction back, so a commit never reports a row as changed that it did not change.
     */
    public void update(String instituteId, List<SiteRedirectPlanner.Change> updates) {
        List<Object[]> args = new ArrayList<>(updates.size());
        for (SiteRedirectPlanner.Change u : updates) {
            args.add(new Object[]{u.toPath(), u.statusCode(), u.id(), instituteId});
        }
        long written = 0;
        for (int from = 0; from < args.size(); from += BATCH) {
            written += sum(jdbc.batchUpdate("UPDATE site_redirect SET to_path = ?, status_code = ?, updated_at = now() "
                            + "WHERE id = ? AND institute_id = ?",
                    args.subList(from, Math.min(args.size(), from + BATCH))));
        }
        requireAll(written, args.size(), "changed");
    }

    /** Removes the rows by id and institute; every one must be there ({@link ConflictException} otherwise). */
    public void deleteAll(String instituteId, List<String> ids) {
        List<Object[]> args = new ArrayList<>(ids.size());
        for (String id : ids) {
            args.add(new Object[]{id, instituteId});
        }
        long removed = 0;
        for (int from = 0; from < args.size(); from += BATCH) {
            removed += sum(jdbc.batchUpdate("DELETE FROM site_redirect WHERE id = ? AND institute_id = ?",
                    args.subList(from, Math.min(args.size(), from + BATCH))));
        }
        requireAll(removed, args.size(), "removed");
    }

    /**
     * The undo record of one import commit ({@code commerce_audit} kind {@code REDIRECTS_IMPORTED},
     * referenced by its commit id), as JSON text; empty when the institute has no such commit.
     */
    public Optional<String> commitRecord(String instituteId, String commitId) {
        List<String> rows = jdbc.queryForList("SELECT old_value_json::text FROM commerce_audit WHERE institute_id = ? "
                        + "AND kind = 'REDIRECTS_IMPORTED' AND reference_type = 'SITE_REDIRECT' AND reference_id = ?",
                String.class, instituteId, commitId);
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0) == null ? "" : rows.get(0));
    }

    /** True when the commit has already been undone. */
    public boolean commitUndone(String instituteId, String commitId) {
        Long n = jdbc.queryForObject("SELECT count(*) FROM commerce_audit WHERE institute_id = ? "
                        + "AND kind = 'REDIRECTS_UNDONE' AND reference_type = 'SITE_REDIRECT' AND reference_id = ?",
                Long.class, instituteId, commitId);
        return n != null && n > 0;
    }

    /** A count the driver did not report ({@code SUCCESS_NO_INFO}, negative) is taken as one row. */
    private static long sum(int[] counts) {
        long total = 0;
        for (int n : counts) {
            total += n < 0 ? 1 : n;
        }
        return total;
    }

    private static void requireAll(long done, int expected, String verb) {
        if (done != expected) {
            throw new ConflictException("the stored redirects changed while this was written (" + done + " of "
                    + expected + " rows " + verb + "); nothing was saved. Look at the list and try again");
        }
    }

    public Optional<Row> find(String instituteId, String id) {
        List<Row> rows = jdbc.query("SELECT " + COLUMNS + " FROM site_redirect WHERE id = ? AND institute_id = ?",
                SiteRedirectStore::row, id, instituteId);
        return rows.stream().findFirst();
    }

    /** 1 when the row was removed. */
    public int delete(String instituteId, String id) {
        return jdbc.update("DELETE FROM site_redirect WHERE id = ? AND institute_id = ?", id, instituteId);
    }

    /** Rows whose from_path or to_path holds any of {@code needles}, with the optional filters. */
    public long count(String instituteId, Set<String> needles, String matchType, Integer statusCode) {
        List<Object> args = new ArrayList<>();
        String where = where(instituteId, needles, matchType, statusCode, args);
        Long total = jdbc.queryForObject("SELECT count(*) FROM site_redirect WHERE " + where, Long.class,
                args.toArray());
        return total == null ? 0 : total;
    }

    public List<Row> page(String instituteId, Set<String> needles, String matchType, Integer statusCode,
                          int offset, int limit) {
        List<Object> args = new ArrayList<>();
        String where = where(instituteId, needles, matchType, statusCode, args);
        args.add(limit);
        args.add(offset);
        return jdbc.query("SELECT " + COLUMNS + " FROM site_redirect WHERE " + where
                        + " ORDER BY from_path, match_type, id LIMIT ? OFFSET ?",
                SiteRedirectStore::row, args.toArray());
    }

    /** Every row of the institute in from_path order, one at a time. */
    public void each(String instituteId, Consumer<Row> sink) {
        jdbc.query("SELECT " + COLUMNS + " FROM site_redirect WHERE institute_id = ? ORDER BY from_path, match_type, id",
                (RowCallbackHandler) rs -> sink.accept(row(rs, 0)), instituteId);
    }

    private static final String COLUMNS = "id, from_path, to_path, status_code, match_type, created_at, updated_at";

    private static Row row(java.sql.ResultSet rs, int i) throws java.sql.SQLException {
        return new Row(rs.getString("id"), rs.getString("from_path"), rs.getString("to_path"),
                rs.getInt("status_code"), rs.getString("match_type"), rs.getTimestamp("created_at"),
                rs.getTimestamp("updated_at"));
    }

    private static String where(String instituteId, Set<String> needles, String matchType, Integer statusCode,
                                List<Object> args) {
        StringBuilder sql = new StringBuilder("institute_id = ?");
        args.add(instituteId);
        if (matchType != null) {
            sql.append(" AND match_type = ?");
            args.add(matchType);
        }
        if (statusCode != null) {
            sql.append(" AND status_code = ?");
            args.add(statusCode);
        }
        if (needles != null && !needles.isEmpty()) {
            List<String> ors = new ArrayList<>();
            for (String needle : new LinkedHashSet<>(needles)) {
                String like = "%" + escapeLike(needle) + "%";
                ors.add("from_path ILIKE ? ESCAPE '\\'");
                ors.add("to_path ILIKE ? ESCAPE '\\'");
                args.add(like);
                args.add(like);
            }
            sql.append(" AND (").append(String.join(" OR ", ors)).append(')');
        }
        return sql.toString();
    }

    /** {@code %} and {@code _} in a search are letters, not wildcards. */
    static String escapeLike(String value) {
        return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
    }
}
