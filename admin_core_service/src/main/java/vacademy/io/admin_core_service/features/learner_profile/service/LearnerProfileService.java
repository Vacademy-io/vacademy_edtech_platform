package vacademy.io.admin_core_service.features.learner_profile.service;

import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.learner_profile.dto.LearnerProfileSignalDto;

import java.sql.Timestamp;
import java.util.List;

/**
 * Read side of the learner profile: what the Student AI noticed about a learner
 * (ai_service learner_profile poller writes learner_profile_signal). Every query is
 * scoped to the caller's institute.
 */
@Service
@RequiredArgsConstructor
public class LearnerProfileService {

    private static final int MAX_SIGNALS = 200;

    private final NamedParameterJdbcTemplate jdbc;

    public List<LearnerProfileSignalDto> signals(String instituteId, String userId, boolean includeDismissed) {
        String sql = """
                SELECT id, source, kind, topic, detail, confidence, stated, evidence_quote,
                       evidence_session_id, status, observed_at
                  FROM learner_profile_signal
                 WHERE institute_id = :instituteId AND user_id = :userId
                """ + (includeDismissed ? "" : " AND status = 'ACTIVE' ") + """
                 ORDER BY observed_at DESC, id DESC
                 LIMIT :limit
                """;
        MapSqlParameterSource params = new MapSqlParameterSource()
                .addValue("instituteId", instituteId)
                .addValue("userId", userId)
                .addValue("limit", MAX_SIGNALS);
        return jdbc.query(sql, params, (rs, i) -> {
            Timestamp observed = rs.getTimestamp("observed_at");
            Number confidence = (Number) rs.getObject("confidence");
            return LearnerProfileSignalDto.builder()
                    .id(rs.getLong("id"))
                    .source(rs.getString("source"))
                    .kind(rs.getString("kind"))
                    .topic(rs.getString("topic"))
                    .detail(rs.getString("detail"))
                    .confidence(confidence == null ? null : confidence.doubleValue())
                    .stated(rs.getBoolean("stated"))
                    .evidenceQuote(rs.getString("evidence_quote"))
                    .evidenceSessionId(rs.getString("evidence_session_id"))
                    .status(rs.getString("status"))
                    .observedAt(observed == null ? null : observed.getTime())
                    .build();
        });
    }

    /** Hide a wrong observation. False when no such signal exists in this institute. */
    public boolean dismiss(String instituteId, long signalId, String dismissedBy) {
        int updated = jdbc.update("""
                UPDATE learner_profile_signal
                   SET status = 'DISMISSED', dismissed_by = :by, dismissed_at = now()
                 WHERE id = :id AND institute_id = :instituteId
                """, new MapSqlParameterSource()
                .addValue("id", signalId)
                .addValue("instituteId", instituteId)
                .addValue("by", dismissedBy));
        return updated > 0;
    }
}
