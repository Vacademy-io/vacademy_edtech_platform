package vacademy.io.assessment_service.features.assessment.manager;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.assessment_service.features.assessment.dto.reattempt.CreateReattemptRequestDto;
import vacademy.io.assessment_service.features.assessment.dto.reattempt.ReattemptRequestDto;
import vacademy.io.assessment_service.features.assessment.dto.reattempt.ReviewReattemptRequestDto;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentReattemptRequest;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentUserRegistration;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentReattemptRequestRepository;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentRepository;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentUserRegistrationRepository;
import vacademy.io.assessment_service.features.assessment.repository.QuestionAssessmentSectionMappingRepository;
import vacademy.io.assessment_service.features.assessment.repository.StudentAttemptRepository;
import vacademy.io.assessment_service.features.assessment.service.AssessmentWorkflowEventPublisher;
import vacademy.io.assessment_service.features.learner_assessment.enums.AssessmentAttemptEnum;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import vacademy.io.assessment_service.features.assessment.service.QuestionTextPreview;

import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * The learner-raised reattempt / time-extension request and problem report, and the admin
 * review of it.
 *
 * <p>Approving a time-extension request adds the admin's minutes to the learner's live attempt
 * ({@code student_attempt.max_time}); the open exam picks the new limit up on its next autosave.
 * A problem report grants nothing: the admin reads it and marks it resolved.
 *
 * <p>Grant mechanics deliberately stay in {@link AssessmentParticipantsManager}: an admin can
 * still grant attempts directly from the participants screen without any request existing, and
 * approving from this inbox has to end up in exactly the same place — one learner's
 * {@code reattempt_count} bumped and one ASSESSMENT_REATTEMPT_GRANTED emitted. Duplicating that
 * arithmetic here is how the two paths would drift.
 */
@Slf4j
@Component
public class AssessmentReattemptRequestManager {

    private static final int MAX_PAGE_SIZE = 200;

    /** Upper bound on one time grant, so a typo (600 for 60) cannot hand out ten hours. */
    static final int MAX_GRANTED_MINUTES = 300;


    @Autowired
    private AssessmentReattemptRequestRepository reattemptRequestRepository;

    @Autowired
    private AssessmentUserRegistrationRepository assessmentUserRegistrationRepository;

    @Autowired
    private AssessmentRepository assessmentRepository;

    @Autowired
    private AssessmentWorkflowEventPublisher assessmentWorkflowEventPublisher;

    @Autowired
    private AssessmentParticipantsManager assessmentParticipantsManager;

    @Autowired
    private StudentAttemptRepository studentAttemptRepository;

    @Autowired
    private QuestionAssessmentSectionMappingRepository questionMappingRepository;

    // ------------------------------------------------------------------ learner

    @Transactional
    public ReattemptRequestDto createRequest(CustomUserDetails user, CreateReattemptRequestDto dto) {
        if (user == null || user.getUserId() == null) {
            throw new VacademyException("Not signed in");
        }
        if (dto == null || dto.getAssessmentId() == null || dto.getAssessmentId().isBlank()) {
            throw new VacademyException("assessment_id is required");
        }
        String reason = dto.getReason() == null ? "" : dto.getReason().trim();
        if (reason.isEmpty()) {
            throw new VacademyException("Please give a reason for your request");
        }

        String requestType = normaliseType(dto.getRequestType());
        boolean problemReport = AssessmentReattemptRequest.TYPE_PROBLEM_REPORT.equals(requestType);
        String userId = user.getUserId();
        String assessmentId = dto.getAssessmentId();
        String questionId = problemReport ? questionInAssessment(assessmentId, dto.getQuestionId()) : null;

        // The learner's registration carries the institute and their contact details. Fall back
        // to whatever the client sent so a request is never lost just because the row is missing.
        Optional<AssessmentUserRegistration> registration = assessmentUserRegistrationRepository
                .findTopByUserIdAndAssessmentId(userId, assessmentId);
        String instituteId = registration.map(AssessmentUserRegistration::getInstituteId)
                .orElse(dto.getInstituteId());
        if (instituteId == null || instituteId.isBlank()) {
            throw new VacademyException("Could not resolve the institute for this assessment");
        }

        // Surface an existing open request rather than stacking duplicates — a learner watching
        // a timer run down will press Submit more than once.
        Optional<AssessmentReattemptRequest> open = findOpen(assessmentId, userId, requestType, questionId);
        if (open.isPresent()) {
            return toDto(open.get(), registration.orElse(null), null);
        }

        AssessmentReattemptRequest request = AssessmentReattemptRequest.builder()
                .assessmentId(assessmentId)
                .instituteId(instituteId)
                .userId(userId)
                .registrationId(registration.map(AssessmentUserRegistration::getId).orElse(null))
                .attemptId(dto.getAttemptId())
                .requestType(requestType)
                .reason(reason)
                .questionId(questionId)
                .status(AssessmentReattemptRequest.STATUS_PENDING)
                .build();

        try {
            request = reattemptRequestRepository.save(request);
        } catch (DataIntegrityViolationException e) {
            // Lost the race against the partial unique index — another tap got there first.
            return findOpen(assessmentId, userId, requestType, questionId)
                    .map(existing -> toDto(existing, registration.orElse(null), null))
                    .orElseThrow(() -> new VacademyException("Could not record your request. Please try again."));
        }

        Assessment assessment = assessmentRepository.findById(assessmentId).orElse(null);
        // ASSESSMENT_REATTEMPT_REQUESTED automations are written for reattempt and time requests
        // ("we got your reattempt request"); firing them for a problem report would send the
        // learner the wrong message. Problem reports reach the admin through the inbox badge.
        if (!problemReport) {
            assessmentWorkflowEventPublisher.publishReattemptRequested(request, assessment,
                    registration.orElse(null));
        }

        return toDto(request, registration.orElse(null), assessment);
    }

    public List<ReattemptRequestDto> myRequests(CustomUserDetails user, String assessmentId) {
        if (user == null || user.getUserId() == null) {
            throw new VacademyException("Not signed in");
        }
        return reattemptRequestRepository
                .findByAssessmentIdAndUserIdOrderByCreatedAtDesc(assessmentId, user.getUserId())
                .stream()
                .map(request -> toDto(request, null, null))
                .toList();
    }

    // ------------------------------------------------------------------ admin

    public Page<ReattemptRequestDto> listForAdmin(String instituteId, String assessmentId,
                                                  List<String> statuses, List<String> types,
                                                  int page, int size) {
        if (instituteId == null || instituteId.isBlank()) {
            throw new VacademyException("instituteId is required");
        }
        int safeSize = Math.min(Math.max(size, 1), MAX_PAGE_SIZE);
        List<String> statusFilter = (statuses == null || statuses.isEmpty()) ? null : statuses;
        List<String> typeFilter = (types == null || types.isEmpty()) ? null
                : types.stream().map(t -> t.trim().toUpperCase(Locale.ROOT)).toList();
        String assessmentFilter = (assessmentId == null || assessmentId.isBlank()) ? null : assessmentId;

        Page<ReattemptRequestDto> rows = reattemptRequestRepository
                .findForAdmin(instituteId, assessmentFilter, statusFilter, typeFilter,
                        PageRequest.of(Math.max(page, 0), safeSize))
                .map(this::enrich);
        attachReportedQuestions(rows.getContent());
        return rows;
    }

    /**
     * Drives the inbox badge — the admin's "you have requests waiting" signal.
     *
     * {@code assessmentId} is optional and must be passed by anything showing the badge next to
     * one assessment's inbox: the institute-wide count is the same number on every assessment
     * page, so an unscoped badge reads as "this exam has a request" when the request is someone
     * else's exam entirely, and the tab it points at then renders empty.
     */
    public long pendingCount(String instituteId, String assessmentId) {
        if (instituteId == null || instituteId.isBlank()) {
            throw new VacademyException("instituteId is required");
        }
        if (assessmentId == null || assessmentId.isBlank()) {
            return reattemptRequestRepository.countByInstituteIdAndStatus(instituteId,
                    AssessmentReattemptRequest.STATUS_PENDING);
        }
        return reattemptRequestRepository.countByInstituteIdAndAssessmentIdAndStatus(instituteId,
                assessmentId, AssessmentReattemptRequest.STATUS_PENDING);
    }

    @Transactional
    public ReattemptRequestDto review(CustomUserDetails user, String requestId, String instituteId,
                                      ReviewReattemptRequestDto dto) {
        if (dto == null || dto.getStatus() == null) {
            throw new VacademyException("status is required");
        }
        String status = dto.getStatus().trim().toUpperCase(Locale.ROOT);

        AssessmentReattemptRequest request = reattemptRequestRepository.findByIdForUpdate(requestId)
                .orElseThrow(() -> new VacademyException("Request not found"));

        // A forged id must not let one institute review another's request.
        if (instituteId != null && !instituteId.equals(request.getInstituteId())) {
            throw new VacademyException("Request not found");
        }
        if (!AssessmentReattemptRequest.STATUS_PENDING.equals(request.getStatus())) {
            throw new VacademyException("This request has already been "
                    + request.getStatus().toLowerCase());
        }

        String requestType = request.getRequestType();
        if (AssessmentReattemptRequest.TYPE_PROBLEM_REPORT.equals(requestType)) {
            // Closing is the only action on a report. An admin page built before reports existed
            // shows them with Approve / Reject; either one closes the report.
            if (!AssessmentReattemptRequest.STATUS_RESOLVED.equals(status)
                    && !AssessmentReattemptRequest.STATUS_APPROVED.equals(status)
                    && !AssessmentReattemptRequest.STATUS_REJECTED.equals(status)) {
                throw new VacademyException("A problem report can only be marked RESOLVED");
            }
            status = AssessmentReattemptRequest.STATUS_RESOLVED;
        } else if (!AssessmentReattemptRequest.STATUS_APPROVED.equals(status)
                && !AssessmentReattemptRequest.STATUS_REJECTED.equals(status)) {
            throw new VacademyException("status must be APPROVED or REJECTED");
        }

        Integer granted = null;
        Integer grantedMinutes = null;
        if (AssessmentReattemptRequest.STATUS_APPROVED.equals(status)) {
            if (AssessmentReattemptRequest.TYPE_TIME_INCREASE.equals(requestType)) {
                // Approving still works as it always did: without minutes (an admin page built
                // before the minutes field) or when the test is over, it only records the
                // approval. Only a live, timed attempt gets the minutes. granted_minutes stays
                // null otherwise, which the inbox shows as "approved, no time added".
                Integer minutes = validGrantedMinutes(dto.getGrantedMinutes());
                if (minutes != null) {
                    grantedMinutes = addMinutesToLiveAttempt(request, minutes);
                }
            } else if (AssessmentReattemptRequest.TYPE_REATTEMPT.equals(requestType)) {
                granted = (dto.getGrantedCount() == null || dto.getGrantedCount() < 1) ? 1 : dto.getGrantedCount();
                String registrationId = resolveRegistrationId(request);
                if (registrationId == null) {
                    throw new VacademyException(
                            "This learner is not registered for the assessment, so attempts cannot be granted");
                }
                // Same call the participants screen makes, so both paths bump the count and emit
                // ASSESSMENT_REATTEMPT_GRANTED identically.
                assessmentParticipantsManager.provideReattempt(user, request.getAssessmentId(),
                        request.getInstituteId(),
                        new vacademy.io.assessment_service.features.assessment.dto.admin_get_dto.request
                                .ProvideReattemptRequestDto(List.of(registrationId), granted));
                request.setRegistrationId(registrationId);
            }
        }

        request.setStatus(status);
        request.setGrantedCount(granted);
        request.setGrantedMinutes(grantedMinutes);
        request.setReviewNote(dto.getReviewNote());
        request.setReviewedBy(user != null ? user.getUserId() : null);
        request.setReviewedAt(new Date());
        request = reattemptRequestRepository.save(request);

        // No question preview here: the lookup would run inside this transaction, where a failed
        // query would roll the review back. The inbox reloads its list after a review anyway.
        return enrich(request);
    }

    // ------------------------------------------------------------------ helpers

    /**
     * A request can be raised before the learner has a registration row (they may be asking
     * precisely because they could not get in), so resolve it lazily at approval time.
     */
    private String resolveRegistrationId(AssessmentReattemptRequest request) {
        if (request.getRegistrationId() != null && !request.getRegistrationId().isBlank()) {
            return request.getRegistrationId();
        }
        return assessmentUserRegistrationRepository
                .findTopByUserIdAndAssessmentId(request.getUserId(), request.getAssessmentId())
                .map(AssessmentUserRegistration::getId)
                .orElse(null);
    }

    private String normaliseType(String requestType) {
        if (requestType == null || requestType.isBlank()) {
            return AssessmentReattemptRequest.TYPE_REATTEMPT;
        }
        String upper = requestType.trim().toUpperCase(Locale.ROOT);
        if (AssessmentReattemptRequest.TYPE_REATTEMPT.equals(upper)
                || AssessmentReattemptRequest.TYPE_TIME_INCREASE.equals(upper)
                || AssessmentReattemptRequest.TYPE_PROBLEM_REPORT.equals(upper)) {
            return upper;
        }
        throw new VacademyException("request_type must be REATTEMPT, TIME_INCREASE or PROBLEM_REPORT");
    }

    /**
     * The learner's open request of this type. Problem reports are matched per question as well,
     * since a learner may report several questions while each has its own open report.
     */
    private Optional<AssessmentReattemptRequest> findOpen(String assessmentId, String userId,
                                                         String requestType, String questionId) {
        if (!AssessmentReattemptRequest.TYPE_PROBLEM_REPORT.equals(requestType)) {
            return reattemptRequestRepository.findFirstByAssessmentIdAndUserIdAndRequestTypeAndStatus(
                    assessmentId, userId, requestType, AssessmentReattemptRequest.STATUS_PENDING);
        }
        return reattemptRequestRepository.findByAssessmentIdAndUserIdOrderByCreatedAtDesc(assessmentId, userId)
                .stream()
                .filter(r -> AssessmentReattemptRequest.TYPE_PROBLEM_REPORT.equals(r.getRequestType())
                        && AssessmentReattemptRequest.STATUS_PENDING.equals(r.getStatus())
                        && Objects.equals(r.getQuestionId(), questionId))
                .findFirst();
    }

    /**
     * The reported question id, kept only when it is in this assessment's paper. The id comes
     * from the learner's device; an unchecked one would let a report show the admin another
     * assessment's question. A question that is not in the paper does not refuse the report: it
     * is saved without the question.
     */
    private String questionInAssessment(String assessmentId, String questionId) {
        if (questionId == null || questionId.isBlank()) {
            return null;
        }
        String trimmed = questionId.trim();
        if (questionMappingRepository.existsBySection_Assessment_IdAndQuestion_Id(assessmentId, trimmed)) {
            return trimmed;
        }
        log.warn("Problem report on assessment {} named question {}, which is not in its paper; saved without it",
                assessmentId, trimmed);
        return null;
    }

    /** The admin's minutes, or null when none were sent (nothing is added then). */
    private static Integer validGrantedMinutes(Integer minutes) {
        if (minutes == null) {
            return null;
        }
        if (minutes < 1 || minutes > MAX_GRANTED_MINUTES) {
            throw new VacademyException("Enter the extra minutes to give, from 1 to " + MAX_GRANTED_MINUTES);
        }
        return minutes;
    }

    /**
     * Adds the minutes to the attempt the request was raised from (or, when it did not say, the
     * learner's latest attempt on this assessment) and returns the minutes added. Returns null
     * (nothing added) when there is no live, timed attempt: the test already ended, or never had
     * a clock. The approval itself still goes through, as it did before time was ever added.
     */
    private Integer addMinutesToLiveAttempt(AssessmentReattemptRequest request, int minutes) {
        StudentAttempt attempt = attemptForRequest(request);
        if (attempt == null) {
            return null;
        }
        request.setAttemptId(attempt.getId());
        String live = AssessmentAttemptEnum.LIVE.name();
        if (!live.equals(attempt.getStatus()) || attempt.getMaxTime() == null || attempt.getMaxTime() <= 0) {
            return null;
        }
        // 0 rows: the attempt ended between the read above and this update.
        return studentAttemptRepository.addMinutesToLiveAttempt(attempt.getId(), minutes, live) == 0 ? null : minutes;
    }

    private StudentAttempt attemptForRequest(AssessmentReattemptRequest request) {
        if (request.getAttemptId() != null && !request.getAttemptId().isBlank()) {
            // The attempt id came from the learner's device: use it only if it is theirs and on
            // this assessment, so a forged id cannot extend someone else's attempt.
            Optional<StudentAttempt> named = studentAttemptRepository.findByIdWithRegistration(request.getAttemptId())
                    .filter(a -> a.getRegistration() != null
                            && request.getUserId().equals(a.getRegistration().getUserId())
                            && a.getRegistration().getAssessment() != null
                            && request.getAssessmentId().equals(a.getRegistration().getAssessment().getId()));
            if (named.isPresent()) {
                return named.get();
            }
        }
        return assessmentUserRegistrationRepository
                .findTopByUserIdAndAssessmentId(request.getUserId(), request.getAssessmentId())
                .flatMap(studentAttemptRepository::findTopByRegistrationOrderByCreatedAtDesc)
                .orElse(null);
    }

    /**
     * Fills in where each reported question sits in the paper, and the start of its text. A
     * failed lookup costs the preview, never the inbox.
     */
    private void attachReportedQuestions(List<ReattemptRequestDto> rows) {
        List<ReattemptRequestDto> reports = rows.stream().filter(r -> r.getQuestionId() != null).toList();
        if (reports.isEmpty()) {
            return;
        }
        try {
            List<String> assessmentIds = reports.stream().map(ReattemptRequestDto::getAssessmentId).distinct().toList();
            List<String> questionIds = reports.stream().map(ReattemptRequestDto::getQuestionId).distinct().toList();
            Map<String, QuestionAssessmentSectionMappingRepository.ReportedQuestionRow> found = questionMappingRepository
                    .findReportedQuestions(assessmentIds, questionIds)
                    .stream()
                    .collect(Collectors.toMap(q -> q.getAssessmentId() + "|" + q.getQuestionId(),
                            Function.identity(), (first, second) -> first));
            for (ReattemptRequestDto report : reports) {
                QuestionAssessmentSectionMappingRepository.ReportedQuestionRow question =
                        found.get(report.getAssessmentId() + "|" + report.getQuestionId());
                if (question == null) {
                    continue;
                }
                report.setQuestionSectionName(question.getSectionName());
                report.setQuestionNumber(question.getQuestionNumber());
                report.setQuestionText(QuestionTextPreview.of(question.getQuestionHtml()));
            }
        } catch (Exception e) {
            log.warn("Could not load reported questions for the request inbox: {}", e.getMessage());
        }
    }

    private ReattemptRequestDto enrich(AssessmentReattemptRequest request) {
        AssessmentUserRegistration registration = assessmentUserRegistrationRepository
                .findTopByUserIdAndAssessmentId(request.getUserId(), request.getAssessmentId())
                .orElse(null);
        Assessment assessment = assessmentRepository.findById(request.getAssessmentId()).orElse(null);
        return toDto(request, registration, assessment);
    }

    private ReattemptRequestDto toDto(AssessmentReattemptRequest request,
                                      AssessmentUserRegistration registration,
                                      Assessment assessment) {
        ReattemptRequestDto.ReattemptRequestDtoBuilder builder = ReattemptRequestDto.builder()
                .id(request.getId())
                .assessmentId(request.getAssessmentId())
                .instituteId(request.getInstituteId())
                .userId(request.getUserId())
                .registrationId(request.getRegistrationId())
                .attemptId(request.getAttemptId())
                .requestType(request.getRequestType())
                .reason(request.getReason())
                .status(request.getStatus())
                .grantedCount(request.getGrantedCount())
                .grantedMinutes(request.getGrantedMinutes())
                .questionId(request.getQuestionId())
                .reviewedBy(request.getReviewedBy())
                .reviewNote(request.getReviewNote())
                .reviewedAt(request.getReviewedAt())
                .createdAt(request.getCreatedAt());

        if (assessment != null) {
            builder.assessmentName(assessment.getName());
        }
        if (registration != null) {
            builder.participantName(registration.getParticipantName())
                    .userEmail(registration.getUserEmail())
                    .phoneNumber(registration.getPhoneNumber())
                    .attemptsAllowed(registration.getReattemptCount())
                    .attemptsUsed(attemptsUsed(registration));
        }
        return builder.build();
    }

    /** studentAttempts is LAZY; a missing count should cost one field, not the whole row. */
    private Integer attemptsUsed(AssessmentUserRegistration registration) {
        try {
            return registration.getStudentAttempts() != null ? registration.getStudentAttempts().size() : null;
        } catch (Exception e) {
            log.debug("Could not resolve attempts used for registration {}: {}",
                    registration.getId(), e.getMessage());
            return null;
        }
    }
}
