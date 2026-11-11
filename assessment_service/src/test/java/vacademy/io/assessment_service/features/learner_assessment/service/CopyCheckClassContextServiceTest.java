package vacademy.io.assessment_service.features.learner_assessment.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import vacademy.io.assessment_service.features.assessment.dto.LeaderBoardDto;
import vacademy.io.assessment_service.features.learner_assessment.dto.ReportClassContext;
import vacademy.io.assessment_service.features.learner_assessment.dto.context.LeaderBoardSnapshot;
import vacademy.io.assessment_service.features.learner_assessment.dto.context.SectionSnapshot;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The AI reports of a paper with learners are unchanged; a paper whose copies were only
 * checked (no learner took it) gets those copies as its class.
 */
class CopyCheckClassContextServiceTest {

    private JdbcTemplate jdbc;
    private LearnerReportService learnerReports;
    private CopyCheckClassContextService service;

    @BeforeEach
    void setUp() {
        jdbc = mock(JdbcTemplate.class);
        learnerReports = mock(LearnerReportService.class);
        service = new CopyCheckClassContextService(jdbc, learnerReports);
    }

    @Test
    void paperWithLearnersIsReportedAsBefore() {
        ReportClassContext learners = ReportClassContext.builder()
                .fullLeaderboard(List.<LeaderBoardDto>of(LeaderBoardSnapshot.builder().attemptId("a").build()))
                .build();
        when(learnerReports.loadClassContext("as1", "inst")).thenReturn(learners);

        assertThat(service.forAiReport("as1", "inst")).isSameAs(learners);
        verify(jdbc, never()).queryForList(anyString(), any(Object[].class));
    }

    @Test
    void paperWithNeitherLearnersNorCopiesIsReportedAsBefore() {
        ReportClassContext empty = ReportClassContext.builder().fullLeaderboard(List.of()).build();
        when(learnerReports.loadClassContext("as1", "inst")).thenReturn(empty);
        when(jdbc.queryForList(anyString(), eq("as1"), eq("inst"))).thenReturn(List.of());

        assertThat(service.forAiReport("as1", "inst")).isSameAs(empty);
    }

    @Test
    void checkedCopiesBecomeTheClass() {
        ReportClassContext empty = ReportClassContext.builder()
                .assessmentName("Biology")
                .fullLeaderboard(List.of())
                .sections(List.of(new SectionSnapshot("s1", "Section A", 20.0, null, 1)))
                .build();
        when(learnerReports.loadClassContext("as1", "inst")).thenReturn(empty);
        when(jdbc.queryForList(argThat((String sql) -> sql != null && sql.contains("participant_name")),
                eq("as1"), eq("inst"))).thenReturn(List.of(
                Map.of("attempt_id", "a1", "user_id", "copy-check:1", "participant_name", "Riya",
                        "source_id", "b1", "total_marks", 16.0),
                Map.of("attempt_id", "a2", "user_id", "copy-check:2", "participant_name", "Aman",
                        "source_id", "b1", "total_marks", 12.0),
                Map.of("attempt_id", "a3", "user_id", "copy-check:3", "participant_name", "Copy 3",
                        "source_id", "b1", "total_marks", 12.0),
                Map.of("attempt_id", "a4", "user_id", "copy-check:4", "participant_name", "Dev",
                        "source_id", "b1", "total_marks", 8.0)));
        when(jdbc.queryForList(argThat((String sql) -> sql != null && sql.contains("avg_marks")),
                eq("as1"), eq("inst"))).thenReturn(List.of(
                Map.of("section_id", "s1", "avg_marks", new BigDecimal("12.0"), "max_marks", new BigDecimal("16"),
                        "total_correct", 3L, "total_questions", 8L)));

        ReportClassContext ctx = service.forAiReport("as1", "inst");

        assertThat(ctx.getFullLeaderboard()).extracting(LeaderBoardDto::getStudentName)
                .containsExactly("Riya", "Aman", "Copy 3", "Dev");
        assertThat(ctx.getFullLeaderboard()).extracting(LeaderBoardDto::getRank).containsExactly(1, 2, 2, 3);
        assertThat(ctx.getFullLeaderboard().get(0).getPercentile()).isEqualTo(100.0);
        assertThat(ctx.getOverview().getTotalParticipants()).isEqualTo(4L);
        assertThat(ctx.getOverview().getAverageMarks()).isEqualTo(12.0);
        assertThat(ctx.getHighestMarks()).isEqualTo(16.0);
        assertThat(ctx.getLowestMarks()).isEqualTo(8.0);
        assertThat(ctx.getTotalMarks()).isEqualTo(20.0);
        assertThat(ctx.getClassAccuracy()).isEqualTo(60.0);
        assertThat(ctx.getMarksDistribution()).hasSize(3);
        assertThat(ctx.getMarksDistribution().get(1).getNoOfParticipants()).isEqualTo(2);
        assertThat(ctx.getSectionAggregation().get("s1").avgMarks()).isEqualTo(12.0);
        assertThat(ctx.getAssessmentName()).isEqualTo("Biology");
    }
}
