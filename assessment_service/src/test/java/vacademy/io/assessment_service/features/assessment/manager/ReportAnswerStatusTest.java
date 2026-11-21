package vacademy.io.assessment_service.features.assessment.manager;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.assessment_service.features.assessment.dto.admin_get_dto.response.StudentReportAnswerReviewDto;
import vacademy.io.assessment_service.features.assessment.dto.admin_get_dto.response.StudentReportOverallDetailDto;
import vacademy.io.assessment_service.features.assessment.entity.QuestionAssessmentSectionMapping;
import vacademy.io.assessment_service.features.assessment.entity.Section;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.repository.QuestionAssessmentSectionMappingRepository.MarkingSchemeRow;
import vacademy.io.assessment_service.features.assessment.repository.SectionRepository;
import vacademy.io.assessment_service.features.assessment.repository.StudentAttemptRepository;
import vacademy.io.assessment_service.features.assessment.service.bulk_entry_services.QuestionAssessmentSectionMappingService;
import vacademy.io.assessment_service.features.learner_assessment.dto.ReportClassContext;
import vacademy.io.assessment_service.features.learner_assessment.dto.context.SectionSnapshot;
import vacademy.io.assessment_service.features.learner_assessment.entity.QuestionWiseMarks;
import vacademy.io.assessment_service.features.learner_assessment.service.QuestionWiseMarksService;
import vacademy.io.assessment_service.features.question_core.entity.Question;

import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Review issues B1-legacy-null-max-reads-correct / B1-reader-null-max: each question's
 * answer_status on the learner report. An old AI row (status PENDING, max_marks NULL) is read
 * against the paper's max (row max_marks, else the newest mapping's totalMark, else the
 * section's marks_per_question). The paper is never re-queried per attempt: the single report
 * reuses the mappings it already loaded, the bulk export loads each section once per job.
 */
class ReportAnswerStatusTest {

    private static final String CBE_10_TEXT = "{\"type\":\"CBE_RESPONSE\",\"data\":{\"totalMark\":\"10\"}}";
    private static final String CBE_10 = "{\"type\":\"CBE_RESPONSE\",\"data\":{\"totalMark\":10}}";
    private static final String CBE_4 = "{\"type\":\"CBE_RESPONSE\",\"data\":{\"totalMark\":4}}";

    private AssessmentParticipantsManager manager;
    private QuestionWiseMarksService marksService;
    private QuestionAssessmentSectionMappingService mappingService;
    private StudentAttemptRepository attempts;
    private SectionRepository sections;
    private final Map<String, Section> sectionById = new HashMap<>();

    @BeforeEach
    void setUp() {
        manager = new AssessmentParticipantsManager();
        marksService = mock(QuestionWiseMarksService.class);
        mappingService = mock(QuestionAssessmentSectionMappingService.class);
        attempts = mock(StudentAttemptRepository.class);
        sections = mock(SectionRepository.class);
        ReflectionTestUtils.setField(manager, "questionWiseMarksService", marksService);
        ReflectionTestUtils.setField(manager, "questionAssessmentSectionMappingService", mappingService);
        ReflectionTestUtils.setField(manager, "studentAttemptRepository", attempts);
        ReflectionTestUtils.setField(manager, "sectionRepository", sections);
        when(attempts.findById(anyString())).thenAnswer(inv -> {
            StudentAttempt a = new StudentAttempt();
            a.setId(inv.getArgument(0));
            return Optional.of(a);
        });
        section("s1");
    }

    private Section section(String id) {
        return sectionById.computeIfAbsent(id, k -> {
            Section s = new Section();
            s.setId(k);
            return s;
        });
    }

    private static Question question(String id) {
        Question q = new Question();
        q.setId(id);
        q.setQuestionType("CBE_RESPONSE");
        return q;
    }

    private QuestionWiseMarks row(String sectionId, Question q, double marks, String status, String source,
                                  String state, Double max) {
        QuestionWiseMarks r = new QuestionWiseMarks();
        r.setQuestion(q);
        r.setSection(section(sectionId));
        r.setMarks(marks);
        r.setStatus(status);
        r.setMarksSource(source);
        r.setMarkState(state);
        r.setMaxMarks(max);
        return r;
    }

    private QuestionWiseMarks row(Question q, double marks, String status, String source, String state, Double max) {
        return row("s1", q, marks, status, source, state, max);
    }

    private QuestionAssessmentSectionMapping mapping(String sectionId, Question q, String markingJson, Date createdAt) {
        QuestionAssessmentSectionMapping m = new QuestionAssessmentSectionMapping();
        m.setQuestion(q);
        m.setSection(section(sectionId));
        m.setMarkingJson(markingJson);
        m.setCreatedAt(createdAt);
        m.setQuestionOrder(Integer.parseInt(q.getId().substring(1)));
        return m;
    }

    private static MarkingSchemeRow flat(QuestionAssessmentSectionMapping m) {
        return new MarkingSchemeRow() {
            public String getQuestionId() { return m.getQuestion().getId(); }
            public String getSectionId() { return m.getSection().getId(); }
            public String getMarkingJson() { return m.getMarkingJson(); }
            public String getAutoEvaluationJson() { return null; }
            public Date getCreatedAt() { return m.getCreatedAt(); }
        };
    }

    /** The paper as both loaders see it: entities for the single report, flat rows per section for the export. */
    private void paper(QuestionAssessmentSectionMapping... ms) {
        List<QuestionAssessmentSectionMapping> all = List.of(ms);
        when(mappingService.getQuestionAssessmentSectionMappingBySectionIds(anyList())).thenAnswer(inv -> {
            List<String> ids = inv.getArgument(0);
            return all.stream().filter(m -> ids.contains(m.getSection().getId())).toList();
        });
        when(mappingService.getMarkingSchemeRowsBySectionIds(anyList())).thenAnswer(inv -> {
            List<String> ids = inv.getArgument(0);
            return all.stream().filter(m -> ids.contains(m.getSection().getId()))
                    .map(ReportAnswerStatusTest::flat).toList();
        });
        List<Section> secs = all.stream().map(QuestionAssessmentSectionMapping::getSection).distinct().toList();
        when(sections.findByAssessmentIdAndStatusNotIn(eq("as-1"), anyList())).thenReturn(secs);
    }

    private void marks(String attemptId, String sectionId, List<QuestionWiseMarks> rows) {
        when(marksService.getAllQuestionWiseMarksForQuestionIdsAndAttemptId(eq(attemptId), anyList(), eq(sectionId)))
                .thenReturn(rows);
    }

    private ReportClassContext ctx(Map<String, List<String>> questionIdsBySection) {
        Map<String, Integer> order = new HashMap<>();
        List<SectionSnapshot> snaps = new ArrayList<>();
        questionIdsBySection.forEach((sid, ids) -> {
            snaps.add(new SectionSnapshot(sid, sid, null, null, snaps.size()));
            for (int i = 0; i < ids.size(); i++) order.put(ids.get(i) + "#" + sid, i + 1);
        });
        return ReportClassContext.builder().assessmentId("as-1").instituteId("inst")
                .sections(snaps).questionOrderByQuestionAndSection(order).build();
    }

    private static List<String> statuses(StudentReportOverallDetailDto d, String sectionId) {
        return d.getAllSections().get(sectionId).stream().map(StudentReportAnswerReviewDto::getAnswerStatus).toList();
    }

    /** The bulk-export path for one attempt with section s1 only. */
    private List<String> exportStatuses(List<String> ids) {
        return statuses(manager.createStudentReportDetailResponse(ctx(Map.of("s1", ids)), "att-1", "inst"), "s1");
    }

    @Test
    void old_partial_ai_mark_without_a_max_reads_partial_from_the_paper() {
        Question cbe = question("q1");
        Question full = question("q2");
        paper(mapping("s1", cbe, CBE_10_TEXT, null), mapping("s1", full, CBE_10, null));
        marks("att-1", "s1", List.of(
                row(cbe, 4, "PENDING", "AI_REVIEWED", "MARKED", null),
                row(full, 10, "PENDING", "AI", null, null)));
        assertThat(exportStatuses(List.of("q1", "q2"))).containsExactly("PARTIAL_CORRECT", "CORRECT");
        // One flat lookup for the section, not one per row, and never the entity loader.
        verify(mappingService, times(1)).getMarkingSchemeRowsBySectionIds(List.of("s1"));
        verify(mappingService, never()).getQuestionAssessmentSectionMappingBySectionIds(anyList());
    }

    @Test
    void rows_read_as_stored_never_load_the_paper() {
        Question q = question("q1");
        marks("att-1", "s1", List.of(row(q, 4, "PARTIAL_CORRECT", "MANUAL", "MARKED", null)));
        assertThat(exportStatuses(List.of("q1"))).containsExactly("PARTIAL_CORRECT");
        verify(mappingService, never()).getMarkingSchemeRowsBySectionIds(anyList());
        verify(mappingService, never()).getQuestionAssessmentSectionMappingBySectionIds(anyList());
    }

    @Test
    void the_pdf_tools_evaluated_status_and_an_old_ai_zero() {
        Question a = question("q1");
        Question b = question("q2");
        section("s1").setMarksPerQuestion(5.0); // no usable marking json: the section's marks per question
        paper(mapping("s1", a, "{not json", null));
        marks("att-1", "s1", List.of(
                row(a, 3, "evaluated", null, null, null),
                row(b, 0, "PENDING", "AI", null, null)));
        assertThat(exportStatuses(List.of("q1", "q2"))).containsExactly("PARTIAL_CORRECT", "PENDING");
    }

    @Test
    void a_failed_paper_lookup_keeps_the_question_in_the_report() {
        Question q = question("q1");
        when(mappingService.getMarkingSchemeRowsBySectionIds(anyList()))
                .thenThrow(new IllegalStateException("db down"));
        marks("att-1", "s1", List.of(row(q, 4, "PENDING", "AI", null, null), row(question("q2"), 4, "PENDING", "AI", null, null)));
        ReportClassContext ctx = ctx(Map.of("s1", List.of("q1", "q2")));
        assertThat(statuses(manager.createStudentReportDetailResponse(ctx, "att-1", "inst"), "s1"))
                .containsExactly("CORRECT", "CORRECT");
        // Tried once for the attempt (not per row); a failure is not cached, so the next attempt retries.
        verify(mappingService, times(1)).getMarkingSchemeRowsBySectionIds(anyList());
        manager.createStudentReportDetailResponse(ctx, "att-1", "inst");
        verify(mappingService, times(2)).getMarkingSchemeRowsBySectionIds(anyList());
        verify(marksService, times(2)).getAllQuestionWiseMarksForQuestionIdsAndAttemptId(anyString(), anyList(), anyString());
    }

    /**
     * Two sections, an older and a newer mapping of q1 (the newest wins), and many attempts.
     * The bulk export loads each section's marking once for the whole job; the single report
     * reuses the mappings it already loaded. Both give the same statuses as each other.
     */
    @Test
    void one_paper_lookup_per_section_across_many_attempts_and_both_paths_agree() {
        Question q1 = question("q1");
        Question q2 = question("q2");
        Question q3 = question("q3");
        section("s2").setMarksPerQuestion(8.0);
        paper(mapping("s1", q1, CBE_4, new Date(1_000)),     // older: would make 4/4 read CORRECT
                mapping("s1", q1, CBE_10, new Date(2_000)),  // newest: 4/10 is PARTIAL_CORRECT
                mapping("s1", q2, CBE_10, new Date(1_000)),
                mapping("s2", q3, null, new Date(1_000)));  // no marking json: s2's 8 per question, 4/8 is partial
        int n = 6;
        for (int i = 0; i < n; i++) {
            String att = "att-" + i;
            marks(att, "s1", List.of(
                    row("s1", q1, 4, "PENDING", "AI", null, null),
                    row("s1", q2, 10, "PENDING", "AI", null, null)));
            marks(att, "s2", List.of(row("s2", q3, 4, "PENDING", "AI", null, null)));
        }

        // Bulk export: one context for the job.
        ReportClassContext ctx = ctx(Map.of("s1", List.of("q1", "q2"), "s2", List.of("q3")));
        List<StudentReportOverallDetailDto> exported = new ArrayList<>();
        for (int i = 0; i < n; i++) exported.add(manager.createStudentReportDetailResponse(ctx, "att-" + i, "inst"));
        verify(mappingService, times(1)).getMarkingSchemeRowsBySectionIds(List.of("s1"));
        verify(mappingService, times(1)).getMarkingSchemeRowsBySectionIds(List.of("s2"));
        verify(mappingService, times(2)).getMarkingSchemeRowsBySectionIds(anyList());
        verify(mappingService, never()).getQuestionAssessmentSectionMappingBySectionIds(anyList());

        // Single report: only its own up-front mapping load, once per report.
        List<StudentReportOverallDetailDto> single = new ArrayList<>();
        for (int i = 0; i < n; i++) single.add(manager.createStudentReportDetailResponse("as-1", "att-" + i, "inst"));
        verify(mappingService, times(n)).getQuestionAssessmentSectionMappingBySectionIds(anyList());
        verify(mappingService, times(2)).getMarkingSchemeRowsBySectionIds(anyList());

        for (int i = 0; i < n; i++) {
            assertThat(statuses(exported.get(i), "s1")).containsExactly("PARTIAL_CORRECT", "CORRECT");
            assertThat(statuses(exported.get(i), "s2")).containsExactly("PARTIAL_CORRECT");
            assertThat(statuses(single.get(i), "s1")).isEqualTo(statuses(exported.get(i), "s1"));
            assertThat(statuses(single.get(i), "s2")).isEqualTo(statuses(exported.get(i), "s2"));
        }
    }
}
