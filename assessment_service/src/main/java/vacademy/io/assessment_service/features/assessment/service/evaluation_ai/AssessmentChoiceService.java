package vacademy.io.assessment_service.features.assessment.service.evaluation_ai;

import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.assessment_service.core.exception.VacademyException;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.QuestionAssessmentSectionMapping;
import vacademy.io.assessment_service.features.assessment.entity.Section;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.enums.ReleaseResultStatusEnum;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentRepository;
import vacademy.io.assessment_service.features.assessment.repository.QuestionAssessmentSectionMappingRepository;
import vacademy.io.assessment_service.features.assessment.repository.SectionRepository;
import vacademy.io.assessment_service.features.assessment.repository.StudentAttemptRepository;
import vacademy.io.assessment_service.features.learner_assessment.entity.QuestionWiseMarks;
import vacademy.io.assessment_service.features.learner_assessment.repository.QuestionWiseMarksRepository;
import vacademy.io.assessment_service.features.open_evaluation.choice.ChoiceGroupStore;
import vacademy.io.assessment_service.features.open_evaluation.policy.ApiCandidatePolicy;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Internal choice on an existing dashboard assessment: read it, or set it and bring the
 * paper's maximum and every unreleased result in line with it.
 *
 * <p>Setting it changes three things and nothing else:
 * <ul>
 *   <li>the groups ({@code assessment_choice_group});</li>
 *   <li>{@code section.total_marks} of the sections holding grouped questions, so every
 *       screen that shows "out of" (all read the section totals) shows the paper's
 *       maximum;</li>
 *   <li>the total of every unreleased attempt that has per-question marks: the marks
 *       stay on each answer, the extra answers leave the total.</li>
 * </ul>
 * A released result is never rewritten here; it is counted and reported back.
 */
@Slf4j
@Service
public class AssessmentChoiceService {

    private static final String DELETED = "DELETED";

    private final AssessmentRepository assessmentRepository;
    private final SectionRepository sectionRepository;
    private final QuestionAssessmentSectionMappingRepository mappingRepository;
    private final StudentAttemptRepository studentAttemptRepository;
    private final QuestionWiseMarksRepository questionWiseMarksRepository;
    private final DashboardChoiceGroups choiceGroups;

    public AssessmentChoiceService(AssessmentRepository assessmentRepository, SectionRepository sectionRepository,
            QuestionAssessmentSectionMappingRepository mappingRepository,
            StudentAttemptRepository studentAttemptRepository,
            QuestionWiseMarksRepository questionWiseMarksRepository, DashboardChoiceGroups choiceGroups) {
        this.assessmentRepository = assessmentRepository;
        this.sectionRepository = sectionRepository;
        this.mappingRepository = mappingRepository;
        this.studentAttemptRepository = studentAttemptRepository;
        this.questionWiseMarksRepository = questionWiseMarksRepository;
        this.choiceGroups = choiceGroups;
    }

    /** {groups, paper_max, total_marks} - total_marks is every question added up. */
    public Map<String, Object> view(String instituteId, String assessmentId) {
        requireDashboardAssessment(instituteId, assessmentId);
        Map<String, Double> marks = choiceGroups.maxMarksByQuestion(assessmentId);
        List<ChoiceGroupStore.ChoiceGroupRow> rows = choiceGroups.groups(assessmentId);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("choice_groups", rows.stream().map(AssessmentChoiceService::view).toList());
        out.put("paper_max", DashboardChoiceGroups.paperMax(rows, marks));
        out.put("total_marks", marks.values().stream().mapToDouble(Double::doubleValue).sum());
        return out;
    }

    @Transactional
    public Map<String, Object> replace(String instituteId, String assessmentId,
            List<DashboardChoiceGroups.GroupInput> groups) {
        requireDashboardAssessment(instituteId, assessmentId);
        Map<String, Double> marks = choiceGroups.maxMarksByQuestion(assessmentId);
        Set<String> touched = new HashSet<>();
        choiceGroups.groups(assessmentId).forEach(g -> touched.addAll(g.questionIds()));
        double paperMax = choiceGroups.replace(assessmentId, groups, marks);
        List<ChoiceGroupStore.ChoiceGroupRow> rows = choiceGroups.groups(assessmentId);
        rows.forEach(g -> touched.addAll(g.questionIds()));

        int sectionsChanged = touched.isEmpty() ? 0 : updateSectionTotals(assessmentId, rows, marks, touched);

        int updated = 0;
        int released = 0;
        for (StudentAttempt attempt : studentAttemptRepository
                .findAllParticipantsFromAssessmentAndStatusNotIn(assessmentId, List.of(DELETED))) {
            if (ReleaseResultStatusEnum.RELEASED.name().equals(attempt.getReportReleaseStatus())) {
                released++;
                continue;
            }
            if (recompute(assessmentId, attempt)) updated++;
        }
        log.info("[choice] assessment {}: {} group(s), paper max {}, {} section(s) and {} result(s) updated, "
                + "{} released result(s) left as they are", assessmentId, rows.size(), paperMax, sectionsChanged,
                updated, released);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("choice_groups", rows.stream().map(AssessmentChoiceService::view).toList());
        out.put("paper_max", paperMax);
        out.put("results_updated", updated);
        out.put("released_results_unchanged", released);
        return out;
    }

    /**
     * Each section holding a grouped question (now or before) totals its questions'
     * marks less what its groups leave out; a group is booked to the section of its
     * first question. Other sections are not touched.
     */
    private int updateSectionTotals(String assessmentId, List<ChoiceGroupStore.ChoiceGroupRow> rows,
            Map<String, Double> marks, Set<String> touched) {
        Map<String, Section> sections = new LinkedHashMap<>();
        Map<String, String> sectionOf = new HashMap<>();
        Map<String, Double> sum = new HashMap<>();
        for (QuestionAssessmentSectionMapping m : mappingRepository.getQuestionAssessmentSectionMappingByAssessmentId(assessmentId)) {
            if (m.getQuestion() == null || m.getSection() == null
                    || (m.getStatus() != null && DELETED.equalsIgnoreCase(m.getStatus()))) continue;
            String sid = m.getSection().getId();
            sections.putIfAbsent(sid, m.getSection());
            sectionOf.put(m.getQuestion().getId(), sid);
            sum.merge(sid, marks.getOrDefault(m.getQuestion().getId(), 0.0), Double::sum);
        }
        for (ChoiceGroupStore.ChoiceGroupRow g : rows) {
            String sid = sectionOf.get(g.questionIds().get(0));
            if (sid == null) continue;
            double all = g.questionIds().stream().mapToDouble(id -> marks.getOrDefault(id, 0.0)).sum();
            double kept = DashboardChoiceGroups.paperMax(List.of(g), onlyOf(g.questionIds(), marks));
            sum.merge(sid, kept - all, Double::sum);
        }
        Set<String> sectionsToUpdate = new HashSet<>();
        for (String qid : touched) {
            if (sectionOf.containsKey(qid)) sectionsToUpdate.add(sectionOf.get(qid));
        }
        int changed = 0;
        for (String sid : sectionsToUpdate) {
            Section section = sections.get(sid);
            double total = sum.getOrDefault(sid, 0.0);
            if (section.getTotalMarks() == null || Math.abs(section.getTotalMarks() - total) > 1e-9) {
                section.setTotalMarks(total);
                sectionRepository.save(section);
                changed++;
            }
        }
        return changed;
    }

    /** The attempt's total from its per-question marks, extra answers left out. */
    private boolean recompute(String assessmentId, StudentAttempt attempt) {
        List<QuestionWiseMarks> rows = questionWiseMarksRepository.findByStudentAttemptId(attempt.getId());
        if (rows.isEmpty()) return false;
        Map<String, Double> byQuestion = new HashMap<>();
        double total = 0;
        for (QuestionWiseMarks m : rows) {
            if (m.getQuestion() == null) continue;
            byQuestion.put(m.getQuestion().getId(), m.getMarks());
            total += m.getMarks();
        }
        for (String left : choiceGroups.notCountedByMarks(assessmentId, byQuestion)) {
            Double marks = byQuestion.get(left);
            if (marks != null) total -= marks;
        }
        boolean changed = attempt.getTotalMarks() == null || Math.abs(attempt.getTotalMarks() - total) > 1e-9;
        attempt.setTotalMarks(total);
        if ("ENDED".equals(attempt.getStatus())
                && (attempt.getResultMarks() == null || Math.abs(attempt.getResultMarks() - total) > 1e-9)) {
            attempt.setResultMarks(total);
            changed = true;
        }
        if (changed) studentAttemptRepository.save(attempt);
        return changed;
    }

    private static Map<String, Double> onlyOf(List<String> ids, Map<String, Double> marks) {
        Map<String, Double> out = new LinkedHashMap<>();
        for (String id : ids) out.put(id, marks.getOrDefault(id, 0.0));
        return out;
    }

    private static Map<String, Object> view(ChoiceGroupStore.ChoiceGroupRow g) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", g.id());
        m.put("label", g.label());
        m.put("question_ids", new ArrayList<>(g.questionIds()));
        m.put("attempt", g.attempt());
        m.put("policy", g.policy());
        return m;
    }

    private Assessment requireDashboardAssessment(String instituteId, String assessmentId) {
        Assessment assessment = assessmentRepository.findByAssessmentIdAndInstituteId(assessmentId, instituteId)
                .orElseThrow(() -> new VacademyException("Assessment not found"));
        if (ApiCandidatePolicy.isApiExam(assessment)) {
            throw new VacademyException("This exam is managed by the API; set its choice groups through the API.");
        }
        return assessment;
    }
}
