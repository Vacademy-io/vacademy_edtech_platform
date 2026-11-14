package vacademy.io.admin_core_service.features.classroom.notify;

import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.UUID;

/**
 * {@link ClassroomNoticeLog} on the master database.
 *
 * The claim is a single {@code INSERT ... ON CONFLICT DO NOTHING} against the
 * unique key, so it is atomic without a transaction or a lock. With the
 * PostgreSQL JDBC driver the update count of that statement is exact (1 inserted,
 * 0 skipped), which is what the claim reads.
 */
@Component
@RequiredArgsConstructor
public class JdbcClassroomNoticeLog implements ClassroomNoticeLog {

    static final String CLAIM_SQL =
            "INSERT INTO classroom_notice_log (id, institute_id, kind, subject_id, incident_key) "
                    + "VALUES (?, ?, ?, ?, ?) "
                    + "ON CONFLICT (institute_id, kind, subject_id, incident_key) DO NOTHING";

    private final JdbcTemplate jdbcTemplate;

    @Override
    public String claim(String instituteId, String kind, String subjectId, String incidentKey) {
        String id = UUID.randomUUID().toString();
        int inserted = jdbcTemplate.update(CLAIM_SQL,
                id,
                instituteId,
                ClassroomNoticeLog.fit(kind, KIND_MAX, "UNKNOWN"),
                ClassroomNoticeLog.fit(subjectId, SUBJECT_MAX, "none"),
                ClassroomNoticeLog.fit(incidentKey, INCIDENT_MAX, "none"));
        return inserted == 1 ? id : null;
    }

    @Override
    public boolean isClaimed(String instituteId, String kind, String subjectId, String incidentKey) {
        Integer n = jdbcTemplate.queryForObject(
                "SELECT count(*) FROM classroom_notice_log WHERE institute_id = ? AND kind = ? "
                        + "AND subject_id = ? AND incident_key = ?",
                Integer.class,
                instituteId,
                ClassroomNoticeLog.fit(kind, KIND_MAX, "UNKNOWN"),
                ClassroomNoticeLog.fit(subjectId, SUBJECT_MAX, "none"),
                ClassroomNoticeLog.fit(incidentKey, INCIDENT_MAX, "none"));
        return n != null && n > 0;
    }

    @Override
    public void release(Collection<String> ids) {
        if (ids == null || ids.isEmpty()) return;
        List<String> list = new ArrayList<>(ids);
        for (int i = 0; i < list.size(); i += 200) {
            List<String> chunk = list.subList(i, Math.min(list.size(), i + 200));
            String marks = String.join(",", java.util.Collections.nCopies(chunk.size(), "?"));
            jdbcTemplate.update("DELETE FROM classroom_notice_log WHERE id IN (" + marks + ")", chunk.toArray());
        }
    }

    @Override
    public void markSent(Collection<String> ids, boolean ok) {
        if (ids == null || ids.isEmpty()) return;
        List<String> list = new ArrayList<>(ids);
        // Bounded batches keep the IN list short for large digests.
        for (int i = 0; i < list.size(); i += 200) {
            List<String> chunk = list.subList(i, Math.min(list.size(), i + 200));
            String marks = String.join(",", java.util.Collections.nCopies(chunk.size(), "?"));
            Object[] args = new Object[chunk.size() + 1];
            args[0] = ok;
            for (int j = 0; j < chunk.size(); j++) args[j + 1] = chunk.get(j);
            jdbcTemplate.update("UPDATE classroom_notice_log SET sent_ok = ? WHERE id IN (" + marks + ")", args);
        }
    }
}
