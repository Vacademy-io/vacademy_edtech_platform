package vacademy.io.admin_core_service.features.telephony.queue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

import java.sql.Timestamp;
import java.time.Instant;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.ArgumentMatchers.startsWith;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** The voice bot's failed vendor calls become failed rows, once each, keyed on their id. */
class VoiceBotVendorFailureRecorderTest {

    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final VoiceBotVendorFailureRecorder recorder = new VoiceBotVendorFailureRecorder(jdbc);

    private static JsonNode json(String s) throws Exception {
        return new ObjectMapper().readTree(s);
    }

    @Test
    void eachFailureIsOneRowKeyedOnItsId() throws Exception {
        recorder.record("in-1", json("""
                [{"id":"vb-ab12-1","at":"2026-11-18T09:00:00Z","vendor":"api.sarvam.ai",
                  "operation":"STT stream, key 1","httpStatus":null,
                  "reason":"Out of credits: Sarvam said \\"Credits exhausted\\" (socket close 1003)"},
                 {"id":"vb-ab12-2","at":"2026-11-18T09:00:05Z","vendor":"waves-api.smallest.ai",
                  "operation":"POST /api/v1","httpStatus":401,"reason":null}]"""));
        // occurred_at, vendor, source_service, operation, http_status, error_message, run_id (twice: the NOT EXISTS key)
        verify(jdbc).update(anyString(), eq(Timestamp.from(Instant.parse("2026-11-18T09:00:00Z"))),
                eq("api.sarvam.ai"), eq("voice_bot"), eq("STT stream, key 1"), isNull(),
                startsWith("Out of credits"), eq("vb-ab12-1"), eq("vb-ab12-1"));
        verify(jdbc).update(anyString(), eq(Timestamp.from(Instant.parse("2026-11-18T09:00:05Z"))),
                eq("waves-api.smallest.ai"), eq("voice_bot"), eq("POST /api/v1"), eq(401),
                isNull(), eq("vb-ab12-2"), eq("vb-ab12-2"));
    }

    @Test
    void incompleteOrUnreadableBodiesWriteNothing() throws Exception {
        recorder.record("in-1", json("[{\"vendor\":\"api.sarvam.ai\"}]"));
        recorder.record("in-1", json("{\"not\":\"a list\"}"));
        recorder.record("in-1", null);
        verify(jdbc, never()).update(anyString(), any(Object[].class));
    }

    @Test
    void aDatabaseErrorNeverReachesThePoll() throws Exception {
        when(jdbc.update(anyString(), any(Object[].class)))
                .thenThrow(new org.springframework.dao.DataAccessResourceFailureException("down"));
        recorder.record("in-1", json("[{\"id\":\"x\",\"at\":\"2026-11-18T09:00:00Z\",\"vendor\":\"api.sarvam.ai\"}]"));
    }
}
