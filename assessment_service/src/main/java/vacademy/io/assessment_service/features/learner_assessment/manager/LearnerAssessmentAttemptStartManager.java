package vacademy.io.assessment_service.features.learner_assessment.manager;


import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.ObjectUtils;
import org.springframework.util.StringUtils;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import vacademy.io.assessment_service.features.assessment.dto.AssessmentQuestionPreviewDto;
import vacademy.io.assessment_service.features.assessment.dto.admin_get_dto.SectionDto;
import vacademy.io.assessment_service.features.question_core.enums.QuestionTypes;
import vacademy.io.assessment_service.features.assessment.entity.*;
import vacademy.io.assessment_service.features.assessment.enums.UserRegistrationSources;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentRepository;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentUserRegistrationRepository;
import vacademy.io.assessment_service.features.assessment.repository.QuestionAssessmentSectionMappingRepository;
import vacademy.io.assessment_service.features.assessment.repository.StudentAttemptRepository;
import vacademy.io.assessment_service.features.learner_assessment.dto.LearnerAssessmentStartAssessmentResponse;
import vacademy.io.assessment_service.features.learner_assessment.dto.LearnerAssessmentStartPreviewResponse;
import vacademy.io.assessment_service.features.learner_assessment.dto.StartAssessmentRequest;
import vacademy.io.assessment_service.features.learner_assessment.enums.AssessmentAttemptEnum;
import vacademy.io.assessment_service.features.learner_assessment.service.UserRegistrationService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.core.utils.DateUtil;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.student.dto.BasicParticipantDTO;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import java.util.stream.Collectors;

import static org.hibernate.event.internal.EntityState.DELETED;
import static vacademy.io.common.auth.enums.CompanyStatus.ACTIVE;

@Component
public class LearnerAssessmentAttemptStartManager {

    @Autowired
    AssessmentRepository assessmentRepository;

    @Autowired
    UserRegistrationService userRegistrationService;

    @Autowired
    AssessmentUserRegistrationRepository assessmentUserRegistrationRepository;

    @Autowired
    StudentAttemptRepository studentAttemptRepository;

    @Autowired
    QuestionAssessmentSectionMappingRepository questionAssessmentSectionMappingRepository;

    @Autowired
    vacademy.io.assessment_service.features.assessment.service.AssessmentWorkflowEventPublisher assessmentWorkflowEventPublisher;

    @Autowired
    vacademy.io.assessment_service.features.translation.service.TranslationService translationService;


    @Transactional
    public ResponseEntity<LearnerAssessmentStartPreviewResponse> startAssessmentPreview(CustomUserDetails user, String assessmentId, String instituteId, String batchIds, BasicParticipantDTO basicParticipantDTO) {

        Optional<Assessment> assessment = assessmentRepository.findByAssessmentIdAndInstituteId(assessmentId, instituteId);
        if (assessment.isEmpty()) {
            throw new VacademyException("Assessment not found");
        }

        Optional<AssessmentUserRegistration> assessmentUserRegistration = userRegistrationService.findByAssessmentIdAndUserId(assessmentId, user.getUserId());
        AssessmentUserRegistration newAssessmentUserRegistration = verifyAssessmentRegistration(assessment.get(), assessmentUserRegistration, batchIds, basicParticipantDTO);
        verifyAssessmentStart(assessment.get());

        // Reuse a leftover PREVIEW attempt (learner opened the instructions but
        // never clicked Start) instead of blocking. Otherwise the dangling
        // PREVIEW attempt is not ENDED, so verifyLastAttemptState throws
        // "Assessment already live or in preview" and the learner is stuck for
        // good: start-preview is blocked here, restart rejects PREVIEW, and the
        // only endpoint that accepts a PREVIEW attempt (start) can't be reached
        // without a preview response. A genuinely LIVE attempt still blocks —
        // that is an in-progress test and must be resumed via restart, not by
        // spawning a fresh preview. The exam clock is unaffected: startAssessment
        // stamps a fresh start/end time when Start is actually clicked.
        Optional<StudentAttempt> lastAttempt = getLastStudentAttempt(newAssessmentUserRegistration);
        StudentAttempt newStudentAttempt;
        if (lastAttempt.isPresent()
                && AssessmentAttemptEnum.PREVIEW.name().equals(lastAttempt.get().getStatus())) {
            newStudentAttempt = lastAttempt.get();
        } else {
            verifyLastAttemptState(lastAttempt);
            newStudentAttempt = createStudentAttempt(newAssessmentUserRegistration, assessment.get());
        }

        LearnerAssessmentStartPreviewResponse learnerAssessmentStartPreviewResponse = new LearnerAssessmentStartPreviewResponse();
        learnerAssessmentStartPreviewResponse.setAssessmentUserRegistrationId(newAssessmentUserRegistration.getId());
        learnerAssessmentStartPreviewResponse.setAttemptId(newStudentAttempt.getId());
        learnerAssessmentStartPreviewResponse.setPreviewTotalTime(assessment.get().getPreviewTime());
        // i18n: swap servable (PUBLISHED/STALE) sidecar translations into the
        // preview DTOs for the request locale. No-op for "en"; per-item
        // fallback to canonical content; never throws (DTO shape unchanged).
        List<SectionDto> sectionDtos = createSectionDtoList(assessment.get());
        translationService.localizeSectionDtos(sectionDtos);
        learnerAssessmentStartPreviewResponse.setSectionDtos(sectionDtos);
        return ResponseEntity.ok(learnerAssessmentStartPreviewResponse);
    }

    public List<SectionDto> createSectionDtoList(Assessment assessment) {
        List<SectionDto> sectionDtos = new ArrayList<>();
        var allQuestions = createQuestionAssessmentSectionMappingList(assessment);
        assessment.getSections().stream().filter(section -> !DELETED.name().equals(section.getStatus())).forEach(section -> {
            SectionDto sectionDto = new SectionDto(section);
            sectionDto.fillQuestions(allQuestions.stream().filter(questionAssessmentSectionMapping -> section.getId().equals(questionAssessmentSectionMapping.getSectionId())).collect(Collectors.toList()));
            sectionDtos.add(sectionDto);
        });
        return sectionDtos;
    }

    /**
     * An attempt may only begin inside the assessment's own window. Both bounds
     * are enforced here — the end bound previously was not, so an assessment
     * whose window had closed could still be started (most visibly from an
     * assessment slide in a course, which offers a Start button of its own).
     * A null bound means "unbounded on that side"; no end date is stored as the
     * 9999 sentinel, which never trips the check.
     */
    private void verifyAssessmentStart(Assessment assessment) {
        Date now = new Date();
        if (assessment.getBoundStartTime() != null && assessment.getBoundStartTime().after(now))
            throw new VacademyException("Assessment not yet started");
        if (assessment.getBoundEndTime() != null && assessment.getBoundEndTime().before(now))
            throw new VacademyException("Assessment has ended");
    }

    private Optional<StudentAttempt> getLastStudentAttempt(AssessmentUserRegistration assessmentUserRegistration) {
        List<StudentAttempt> studentAttempts = assessmentUserRegistration.getStudentAttempts().stream().toList();
        if (studentAttempts.isEmpty()) return Optional.empty();
        return studentAttempts.stream().max(Comparator.comparing(StudentAttempt::getStartTime));
    }

    private void verifyLastAttemptState(Optional<StudentAttempt> studentAttempt) {
        if (studentAttempt.isPresent()) {
            if (!AssessmentAttemptEnum.ENDED.name().equals(studentAttempt.get().getStatus()))
                throw new VacademyException("Assessment already live or in preview");
        }
    }

    AssessmentUserRegistration verifyAssessmentRegistration(Assessment assessment, Optional<AssessmentUserRegistration> assessmentUserRegistration, String batchIds, BasicParticipantDTO basicParticipantDTO) {
        if (assessmentUserRegistration.isPresent()) return assessmentUserRegistration.get();
        if (!StringUtils.hasText(batchIds)) throw new VacademyException("Batch ids not found");
        List<String> batchIdList = Arrays.stream(batchIds.split(",")).toList();

        List<AssessmentBatchRegistration> assessmentBatchRegistrations = assessment.getBatchRegistrations().stream().toList();
        List<String> assessmentBatchIds = assessmentBatchRegistrations.stream().map(AssessmentBatchRegistration::getBatchId).toList();

        // Find the first matching assessment batch registration
        Optional<AssessmentBatchRegistration> matchingBatchRegistration = assessmentBatchRegistrations.stream()
                .filter(registration -> batchIdList.contains(registration.getBatchId()))
                .findFirst();

        if (matchingBatchRegistration.isEmpty())
            throw new VacademyException("Assessment batch not found"); // TODO: Add error()

        var newAssessmentUserRegistration = createAssessmentUserRegistration(assessment, basicParticipantDTO, matchingBatchRegistration.get());
        return assessmentUserRegistrationRepository.save(newAssessmentUserRegistration);
    }

    private AssessmentUserRegistration createAssessmentUserRegistration(Assessment assessment, BasicParticipantDTO basicParticipantDTO, AssessmentBatchRegistration matchingBatchRegistration) {
        AssessmentUserRegistration newAssessmentUserRegistration = new AssessmentUserRegistration();
        newAssessmentUserRegistration.setAssessment(assessment);
        newAssessmentUserRegistration.setUserEmail(basicParticipantDTO.getEmail());
        newAssessmentUserRegistration.setUsername(basicParticipantDTO.getUsername());
        newAssessmentUserRegistration.setPhoneNumber(basicParticipantDTO.getMobileNumber());
        newAssessmentUserRegistration.setReattemptCount(assessment.getReattemptCount());
        newAssessmentUserRegistration.setParticipantName(basicParticipantDTO.getFullName());
        newAssessmentUserRegistration.setSource(UserRegistrationSources.BATCH_PREVIEW_REGISTRATION.name());
        newAssessmentUserRegistration.setStatus(ACTIVE.name());
        newAssessmentUserRegistration.setSourceId(matchingBatchRegistration.getBatchId());
        newAssessmentUserRegistration.setRegistrationTime(new Date());
        newAssessmentUserRegistration.setFaceFileId(basicParticipantDTO.getFileId());
        newAssessmentUserRegistration.setInstituteId(matchingBatchRegistration.getInstituteId());
        newAssessmentUserRegistration.setUserId(basicParticipantDTO.getUserId());
        return newAssessmentUserRegistration;
    }

    private StudentAttempt createStudentAttempt(AssessmentUserRegistration assessmentUserRegistration, Assessment assessment) {
        StudentAttempt studentAttempt = new StudentAttempt();
        studentAttempt.setRegistration(assessmentUserRegistration);
        studentAttempt.setStartTime(DateUtil.getCurrentUtcTime());
        studentAttempt.setPreviewStartTime(DateUtil.getCurrentUtcTime());
        studentAttempt.setStatus(AssessmentAttemptEnum.PREVIEW.name());
        studentAttempt.setMaxTime(assessment.getDuration());
        studentAttempt.setAttemptNumber(ObjectUtils.isEmpty(assessmentUserRegistration.getStudentAttempts()) ? 1 : assessmentUserRegistration.getStudentAttempts().size() + 1);
        StudentAttempt saved = studentAttemptRepository.save(studentAttempt);

        // Trigger ASSESSMENT_START workflow
        assessmentWorkflowEventPublisher.publishAssessmentStart(saved, assessment,
                assessmentUserRegistration.getInstituteId());

        return saved;
    }

    private List<AssessmentQuestionPreviewDto> createQuestionAssessmentSectionMappingList(Assessment assessment) {
        List<QuestionAssessmentSectionMapping> mappings = questionAssessmentSectionMappingRepository.getQuestionAssessmentSectionMappingByAssessmentId(assessment.getId());
        List<AssessmentQuestionPreviewDto> questions = new ArrayList<>();
        for (QuestionAssessmentSectionMapping mapping : mappings) {
            String sectionId = mapping.getSection().getId();
            AssessmentQuestionPreviewDto question = new AssessmentQuestionPreviewDto(mapping.getQuestion(), mapping);
            question.fillOptionsOfQuestion(mapping.getQuestion());
            redactHiddenTestExpectedStdout(question);
            questions.add(question);
        }
        return questions;
    }

    // Redact the expected outputs of hidden test cases so the answer key never
    // reaches the learner in plaintext. We replace expectedStdout / acceptedOutputs
    // with SHA-256 hex digests of their NORMALIZED (trimmed) values and mark the
    // test case with outputsHashed=true. The client grades a hidden test by hashing
    // the learner's own normalized output and comparing digests — normalization
    // MUST match the client's (trim leading/trailing whitespace). Removing the
    // fields entirely (the old behavior) made hidden tests impossible to grade
    // client-side, so they always failed.
    private void redactHiddenTestExpectedStdout(AssessmentQuestionPreviewDto preview) {
        if (preview == null || !QuestionTypes.CODING.name().equals(preview.getQuestionType())) return;
        String evaluationJson = preview.getEvaluationJson();
        if (evaluationJson == null || evaluationJson.isEmpty()) return;
        try {
            ObjectMapper mapper = new ObjectMapper();
            JsonNode root = mapper.readTree(evaluationJson);
            JsonNode testCases = root.path("data").path("testCases");
            if (!testCases.isArray()) return;
            for (JsonNode tc : testCases) {
                if (!(tc instanceof ObjectNode node) || node.path("visible").asBoolean(true)) continue;
                // Guard against double-hashing if ever handed already-redacted JSON.
                if (node.path("outputsHashed").asBoolean(false)) continue;
                JsonNode acceptedNode = node.get("acceptedOutputs");
                if (acceptedNode != null && acceptedNode.isArray() && acceptedNode.size() > 0) {
                    ArrayNode hashed = mapper.createArrayNode();
                    for (JsonNode a : acceptedNode) hashed.add(sha256Normalized(a.asText("")));
                    node.set("acceptedOutputs", hashed);
                    node.put("expectedStdout", sha256Normalized(acceptedNode.get(0).asText("")));
                    node.put("outputsHashed", true);
                } else {
                    JsonNode expectedNode = node.get("expectedStdout");
                    if (expectedNode == null || expectedNode.isNull()) continue;
                    node.put("expectedStdout", sha256Normalized(expectedNode.asText("")));
                    node.put("outputsHashed", true);
                }
            }
            preview.setEvaluationJson(mapper.writeValueAsString(root));
        } catch (Exception ignored) {
            // If parsing fails, fall through and leave the original JSON; the client must still tolerate it.
        }
    }

    // SHA-256 hex of the trimmed input, matching the client's normalizeOutput()
    // (trim leading/trailing whitespace) so hidden-test digests compare equal.
    private String sha256Normalized(String raw) {
        String normalized = raw == null ? "" : raw.trim();
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(normalized.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder(hash.length * 2);
            for (byte b : hash) sb.append(Character.forDigit((b >> 4) & 0xF, 16)).append(Character.forDigit(b & 0xF, 16));
            return sb.toString();
        } catch (Exception e) {
            // SHA-256 is always available; if it somehow isn't, fail closed with an
            // empty digest so the redacted output can never match a real one.
            return "";
        }
    }

    /**
     * PREVIEW -> LIVE is a one-shot transition, but the client can fire it more
     * than once: the learner double-taps Start, or the preview screen remounts
     * and its "preview time is up" effect starts the attempt again. The two
     * requests land milliseconds apart on different worker threads, and the
     * loser used to 510 with "Assessment already live or in preview" even though
     * the attempt it was looking at is perfectly healthy and already running.
     *
     * So the call is idempotent for an attempt this same flow just started: the
     * loser replays the winner's answer instead of failing. It deliberately
     * returns the ALREADY-STORED startTime rather than a fresh one, so a repeat
     * call can never re-stamp the clock and hand the learner extra time (the two
     * racing writers could otherwise overwrite each other's startTime). Any
     * other status (ENDED, and so on) still fails loudly.
     */
    public ResponseEntity<LearnerAssessmentStartAssessmentResponse> startAssessment(CustomUserDetails user, StartAssessmentRequest startAssessmentRequest) {
        Optional<StudentAttempt> maybeAttempt = studentAttemptRepository.findById(startAssessmentRequest.getAttemptId());
        if (maybeAttempt.isEmpty()) throw new VacademyException("Student attempt not found");
        StudentAttempt studentAttempt = maybeAttempt.get();

        // The attempt id is the only input here, and `user` used to be ignored entirely
        // — so any authenticated caller could flip another learner's PREVIEW attempt to
        // LIVE and reset its start time out from under them.
        //
        // Checked BEFORE the idempotent replay below: that path returns the attempt's
        // real startTime and registration id, so letting a non-owner reach it would leak
        // another learner's exam state even though it mutates nothing.
        LearnerAssessmentAttemptStatusManager.assertOwnershipOrStaff(studentAttempt, user, "start-assessment");

        if (AssessmentAttemptEnum.LIVE.name().equals(studentAttempt.getStatus()) && studentAttempt.getStartTime() != null)
            return ResponseEntity.ok(buildStartAssessmentResponse(studentAttempt, studentAttempt.getStartTime()));

        if (!AssessmentAttemptEnum.PREVIEW.name().equals(studentAttempt.getStatus()))
            throw new VacademyException("Assessment already live or in preview");

        Date startTime = DateUtil.getCurrentUtcTime();
        studentAttempt.setStartTime(startTime);
        studentAttempt.setStatus(AssessmentAttemptEnum.LIVE.name());
        // i18n: stamp which content locale this attempt is being served in
        // (?lang > Accept-Language > JWT claim > "en"). Purely additive.
        studentAttempt.setContentLocale(translationService.resolveRequestLocale());

        studentAttemptRepository.save(studentAttempt);

        return ResponseEntity.ok(buildStartAssessmentResponse(studentAttempt, startTime));
    }

    private LearnerAssessmentStartAssessmentResponse buildStartAssessmentResponse(StudentAttempt studentAttempt, Date startTime) {
        Date endTime = DateUtil.addMinutes(startTime, studentAttempt.getMaxTime());
        return new LearnerAssessmentStartAssessmentResponse(startTime, endTime, studentAttempt.getId(), studentAttempt.getRegistration().getId());
    }
}
