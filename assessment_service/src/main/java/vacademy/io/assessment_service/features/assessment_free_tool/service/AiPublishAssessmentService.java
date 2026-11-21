package vacademy.io.assessment_service.features.assessment_free_tool.service;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import jakarta.transaction.Transactional;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentBatchRegistration;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentInstituteMapping;
import vacademy.io.assessment_service.features.assessment.entity.QuestionAssessmentSectionMapping;
import vacademy.io.assessment_service.features.assessment.entity.Section;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentBatchRegistrationRepository;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentInstituteMappingRepository;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentRepository;
import vacademy.io.assessment_service.features.assessment.repository.QuestionAssessmentSectionMappingRepository;
import vacademy.io.assessment_service.features.assessment.repository.SectionRepository;
import vacademy.io.assessment_service.features.assessment_free_tool.dto.AiPublishAssessmentRequest;
import vacademy.io.assessment_service.features.question_core.entity.Option;
import vacademy.io.assessment_service.features.question_core.entity.Question;
import vacademy.io.assessment_service.features.question_core.repository.QuestionRepository;
import vacademy.io.assessment_service.features.rich_text.entity.AssessmentRichTextData;
import vacademy.io.common.exceptions.VacademyException;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * Publishes an AI-generated MCQ assessment (built from a class recording
 * transcript) into the assessment_service tables so learners can take it.
 *
 * Handles the full single-call path required for AI-generated content
 * (MCQ options included): Assessment + Section +
 * Question (with auto_evaluation_json wired to a pre-generated option UUID)
 * + Option rows + section mapping with markingJson.
 *
 * Called from admin_core_service when a teacher clicks "Publish" in the
 * Create-Assessment-from-Recording modal. Batch registration is handled
 * separately on the admin-core side.
 */
@Service
@Slf4j
public class AiPublishAssessmentService {

    @Autowired
    private AssessmentRepository assessmentRepository;
    @Autowired
    private SectionRepository sectionRepository;
    @Autowired
    private QuestionRepository questionRepository;
    @Autowired
    private QuestionAssessmentSectionMappingRepository mappingRepository;
    @Autowired
    private AssessmentBatchRegistrationRepository batchRegistrationRepository;
    @Autowired
    private AssessmentInstituteMappingRepository instituteMappingRepository;

    /**
     * EntityManager is used for Options because Option.id has no
     * @UuidGenerator — we need to pre-generate UUIDs to wire them into
     * auto_evaluation_json. JpaRepository.save() with a non-null id would
     * call merge() and fail with EntityNotFoundException, so we use
     * persist() to force INSERT.
     */
    @PersistenceContext
    private EntityManager entityManager;

    @Transactional
    public String publish(AiPublishAssessmentRequest req) {
        if (req.getQuestions() == null || req.getQuestions().isEmpty()) {
            throw new VacademyException("Cannot publish assessment with no questions");
        }

        Assessment assessment = createAssessment(req);
        assessmentRepository.save(assessment);
        log.info("[ai-publish] saved assessment id={} duration={} duration_distribution={} " +
                        "reattempt_count={} preview_time={} visibility={}",
                assessment.getId(), assessment.getDuration(), assessment.getDurationDistribution(),
                assessment.getReattemptCount(), assessment.getPreviewTime(),
                assessment.getAssessmentVisibility());

        Section section = createSection(assessment, req);
        sectionRepository.save(section);

        // The admin assessment-list-filter query LEFT JOINs
        // assessment_institute_mapping and filters by institute_id. Without
        // this row the published assessment is invisible to the institute UI.
        if (req.getInstituteId() != null && !req.getInstituteId().isBlank()) {
            AssessmentInstituteMapping mapping = new AssessmentInstituteMapping();
            mapping.setAssessment(assessment);
            mapping.setInstituteId(req.getInstituteId());
            // assessment_url is NOT NULL — use the assessment id as a stable
            // placeholder; admin UI builds the real URL from the id anyway.
            mapping.setAssessmentUrl(assessment.getId());
            instituteMappingRepository.save(mapping);
        }

        int totalMark = req.getMarksPerQuestion() != null ? req.getMarksPerQuestion() : 4;
        int negativeMark = req.getNegativeMarkPerQuestion() != null
                ? req.getNegativeMarkPerQuestion() : 0;

        List<Question> questionsToSave = new ArrayList<>();
        List<Option> optionsToSave = new ArrayList<>();
        List<QuestionAssessmentSectionMapping> mappingsToSave = new ArrayList<>();

        int order = 1;
        for (AiPublishAssessmentRequest.AiQuestion q : req.getQuestions()) {
            // Pre-generate option UUIDs so we can wire the correct one into
            // auto_evaluation_json before persisting (chicken-and-egg).
            List<String> opts = q.getOptions();
            if (opts == null || opts.isEmpty()) continue;
            int correctIdx = q.getCorrectAnswerIndex() != null
                    ? q.getCorrectAnswerIndex() : 0;
            if (correctIdx < 0 || correctIdx >= opts.size()) correctIdx = 0;

            List<String> optionIds = new ArrayList<>(opts.size());
            for (int i = 0; i < opts.size(); i++) optionIds.add(UUID.randomUUID().toString());
            String correctOptionId = optionIds.get(correctIdx);

            String autoEval = String.format(
                    "{\"type\":\"MCQS\",\"data\":{\"correctOptionIds\":[\"%s\"]}}",
                    correctOptionId
            );

            Question question = Question.builder()
                    .questionType("MCQS")
                    .questionResponseType("OPTION")
                    .accessLevel("PUBLIC")
                    .evaluationType("AUTO")
                    .autoEvaluationJson(autoEval)
                    .status("ACTIVE")
                    .difficulty("MEDIUM")
                    .textData(richText(q.getQuestion()))
                    .explanationTextData(richText(q.getExplanation() == null ? "" : q.getExplanation()))
                    .build();
            questionsToSave.add(question);

            for (int i = 0; i < opts.size(); i++) {
                Option opt = new Option();
                opt.setId(optionIds.get(i));
                opt.setQuestion(question);
                opt.setText(richText(opts.get(i)));
                optionsToSave.add(opt);
            }

            QuestionAssessmentSectionMapping mapping = new QuestionAssessmentSectionMapping();
            mapping.setSection(section);
            mapping.setQuestion(question);
            mapping.setQuestionOrder(order++);
            mapping.setQuestionDurationInMin(0);
            mapping.setStatus("ACTIVE");
            mapping.setMarkingJson(String.format(
                    "{\"type\":\"MCQS\",\"data\":{\"totalMark\":%d,\"negativeMark\":%d,\"negativeMarkingPercentage\":0}}",
                    totalMark, negativeMark
            ));
            mappingsToSave.add(mapping);
        }

        questionRepository.saveAll(questionsToSave);
        // Options have manually-assigned IDs, so we use persist() to force
        // INSERT instead of repository.save() which would call merge().
        for (Option opt : optionsToSave) entityManager.persist(opt);
        mappingRepository.saveAll(mappingsToSave);

        // Register the assessment against each batch attached to the live
        // session so learners on those batches see it in their assignments.
        if (req.getBatchIds() != null && !req.getBatchIds().isEmpty()
                && req.getInstituteId() != null) {
            List<AssessmentBatchRegistration> regs = new ArrayList<>();
            for (String batchId : req.getBatchIds()) {
                if (batchId == null || batchId.isBlank()) continue;
                AssessmentBatchRegistration reg = new AssessmentBatchRegistration();
                reg.setAssessment(assessment);
                reg.setBatchId(batchId);
                reg.setInstituteId(req.getInstituteId());
                reg.setRegistrationTime(new java.util.Date());
                reg.setStatus("ACTIVE");
                regs.add(reg);
            }
            batchRegistrationRepository.saveAll(regs);
        }

        return assessment.getId();
    }

    private Assessment createAssessment(AiPublishAssessmentRequest req) {
        // Assessment + Section use @UuidGenerator so Hibernate auto-assigns
        // the id at INSERT time. Setting the id manually here would trigger
        // merge() and fail with EntityNotFoundException.
        Assessment a = new Assessment();
        a.setName(req.getName() == null || req.getName().isBlank()
                ? "Untitled Assessment" : req.getName());
        // Match the shape of existing PUBLISHED rows so the admin-list-filter
        // query (which filters by assessment_type and play_mode) picks them up.
        a.setPlayMode("EXAM");
        a.setEvaluationType("AUTO");
        a.setSubmissionType("AUTO");
        a.setAssessmentType("ASSESSMENT");
        a.setAssessmentVisibility(
                "PUBLIC".equalsIgnoreCase(req.getAssessmentVisibility()) ? "PUBLIC" : "PRIVATE"
        );
        a.setStatus("PUBLISHED");
        // The wizard detail endpoint (assessment/create/v1/status) calls
        // .toDTO() on these rich-text fields without a null guard, so leaving
        // them null causes a downstream NPE. Set empty rich-text rows so
        // the detail view renders.
        a.setAbout(richText(""));
        a.setInstructions(richText(""));
        a.setRegistrationInstructions(richText(""));
        a.setCanSwitchSection(false);
        // Learner-side AssessmentUserRegistration has a NOT NULL constraint
        // on reattempt_count and copies the value off Assessment at first
        // attempt-start. Leaving it null here blows up assessment-start-preview
        // with "not-null property references a null or transient value :
        // AssessmentUserRegistration.reattemptCount". Default to 0 retries
        // when caller didn't specify; otherwise honour the override.
        a.setReattemptCount(req.getReattemptCount() != null ? req.getReattemptCount() : 0);
        if (req.getPreviewTime() != null) {
            a.setPreviewTime(req.getPreviewTime());
        }
        a.setCanRequestReattempt(false);
        a.setCanRequestTimeIncrease(false);
        a.setSource("AI_RECORDING");
        if (req.getDurationMinutes() != null) {
            a.setDuration(req.getDurationMinutes());
        }
        // The admin UI renders the "Entire Test Duration" cell by reading
        // duration_distribution to decide which column to surface. Null
        // here makes the UI show 00:00 even though `duration` is populated.
        // AI-published assessments are always whole-assessment timed (one
        // section, no per-question timer), so pin this to ASSESSMENT.
        a.setDurationDistribution("ASSESSMENT");
        if (req.getStartDateTime() != null) {
            a.setBoundStartTime(parseTs(req.getStartDateTime()));
        }
        if (req.getEndDateTime() != null) {
            a.setBoundEndTime(parseTs(req.getEndDateTime()));
        }
        return a;
    }

    private Section createSection(Assessment assessment, AiPublishAssessmentRequest req) {
        // @UuidGenerator on Section.id — Hibernate auto-assigns on INSERT.
        Section s = new Section();
        s.setAssessment(assessment);
        s.setName("Section 1");
        s.setSectionOrder(1);
        s.setStatus("ACTIVE");
        // total_marks must be non-null; downstream code unboxes to double.
        int perQ = req.getMarksPerQuestion() != null ? req.getMarksPerQuestion() : 4;
        int qCount = req.getQuestions() != null ? req.getQuestions().size() : 0;
        s.setTotalMarks((double) (perQ * qCount));
        return s;
    }

    private AssessmentRichTextData richText(String content) {
        AssessmentRichTextData rt = new AssessmentRichTextData();
        rt.setType("HTML");
        rt.setContent(content == null ? "" : content);
        return rt;
    }

    private Timestamp parseTs(String iso) {
        // Accepts "2026-05-21T10:00" (datetime-local) or full ISO with offset.
        try {
            return Timestamp.from(OffsetDateTime.parse(iso).toInstant());
        } catch (Exception e) {
            // Fall back to treating it as a local datetime — append Z.
            try {
                return Timestamp.from(Instant.parse(iso + ":00Z"));
            } catch (Exception ee) {
                return Timestamp.from(Instant.now());
            }
        }
    }
}
