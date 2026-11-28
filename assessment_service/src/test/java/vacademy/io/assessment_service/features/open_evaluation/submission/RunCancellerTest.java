package vacademy.io.assessment_service.features.open_evaluation.submission;

import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.core.namedparam.SqlParameterSource;
import vacademy.io.assessment_service.features.assessment.client.AiServiceCopyCheckClient;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.AiEvaluationCancellationService;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class RunCancellerTest {

    @Test
    @SuppressWarnings("unchecked")
    void queued_runs_are_cancelled_in_the_database_only_running_ones_also_in_ai_service() {
        NamedParameterJdbcTemplate jdbc = mock(NamedParameterJdbcTemplate.class);
        AiEvaluationCancellationService flags = mock(AiEvaluationCancellationService.class);
        AiServiceCopyCheckClient ai = mock(AiServiceCopyCheckClient.class);
        when(jdbc.query(contains("FOR UPDATE"), any(SqlParameterSource.class), any(RowMapper.class)))
                .thenReturn(List.of(new String[]{"p-queued", "PENDING"}, new String[]{"p-running", "EVALUATING"},
                        new String[]{"p-raced", "DISPATCHED"}));
        when(jdbc.update(contains("SET status = 'CANCELLED', current_step"), any(SqlParameterSource.class)))
                .thenAnswer(i -> "p-raced".equals(((SqlParameterSource) i.getArgument(1)).getValue("id")) ? 0 : 1);

        List<RunCanceller.Cancelled> out = new RunCanceller(jdbc, flags, ai).cancelLiveRuns("att-1");

        assertThat(out).extracting(RunCanceller.Cancelled::processId).containsExactly("p-queued", "p-running");
        verify(ai).cancelByProcessId("p-running");
        verify(flags).cancelProcess("p-running");
        verify(ai, never()).cancelByProcessId("p-queued");
        verify(ai, never()).cancelByProcessId("p-raced");
        verify(jdbc, never()).update(contains("ai_question_evaluation"),
                argThat((SqlParameterSource p) -> "p-raced".equals(p.getValue("id"))));
    }
}
