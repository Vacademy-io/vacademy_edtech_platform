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
import vacademy.io.assessment_service.features.assessment.repository.AssessmentReattemptRequestRepository;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentRepository;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentUserRegistrationRepository;
import vacademy.io.assessment_service.features.assessment.service.AssessmentWorkflowEventPublisher;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.util.Date;
import java.util.List;
import java.util.Optional;

/**
 * The learner-raised reattempt / time-extension request, and the admin review of it.
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
        String userId = user.getUserId();
        String assessmentId = dto.getAssessmentId();

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
        Optional<AssessmentReattemptRequest> open = reattemptRequestRepository
                .findFirstByAssessmentIdAndUserIdAndRequestTypeAndStatus(
                        assessmentId, userId, requestType, AssessmentReattemptRequest.STATUS_PENDING);
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
                .status(AssessmentReattemptRequest.STATUS_PENDING)
                .build();

        try {
            request = reattemptRequestRepository.save(request);
        } catch (DataIntegrityViolationException e) {
            // Lost the race against the partial unique index — another tap got there first.
            return reattemptRequestRepository
                    .findFirstByAssessmentIdAndUserIdAndRequestTypeAndStatus(
                            assessmentId, userId, requestType, AssessmentReattemptRequest.STATUS_PENDING)
                    .map(existing -> toDto(existing, registration.orElse(null), null))
                    .orElseThrow(() -> new VacademyException("Could not record your request. Please try again."));
        }

        Assessment assessment = assessmentRepository.findById(assessmentId).orElse(null);
        assessmentWorkflowEventPublisher.publishReattemptRequested(request, assessment,
                registration.orElse(null));

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
                                                  List<String> statuses, int page, int size) {
        if (instituteId == null || instituteId.isBlank()) {
            throw new VacademyException("instituteId is required");
        }
        int safeSize = Math.min(Math.max(size, 1), MAX_PAGE_SIZE);
        List<String> statusFilter = (statuses == null || statuses.isEmpty()) ? null : statuses;
        String assessmentFilter = (assessmentId == null || assessmentId.isBlank()) ? null : assessmentId;

        return reattemptRequestRepository
                .findForAdmin(instituteId, assessmentFilter, statusFilter,
                        PageRequest.of(Math.max(page, 0), safeSize))
                .map(this::enrich);
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
        String status = dto.getStatus().trim().toUpperCase();
        if (!AssessmentReattemptRequest.STATUS_APPROVED.equals(status)
                && !AssessmentReattemptRequest.STATUS_REJECTED.equals(status)) {
            throw new VacademyException("status must be APPROVED or REJECTED");
        }

        AssessmentReattemptRequest request = reattemptRequestRepository.findById(requestId)
                .orElseThrow(() -> new VacademyException("Request not found"));

        // A forged id must not let one institute review another's request.
        if (instituteId != null && !instituteId.equals(request.getInstituteId())) {
            throw new VacademyException("Request not found");
        }
        if (!AssessmentReattemptRequest.STATUS_PENDING.equals(request.getStatus())) {
            throw new VacademyException("This request has already been "
                    + request.getStatus().toLowerCase());
        }

        Integer granted = null;
        if (AssessmentReattemptRequest.STATUS_APPROVED.equals(status)) {
            granted = (dto.getGrantedCount() == null || dto.getGrantedCount() < 1) ? 1 : dto.getGrantedCount();

            if (AssessmentReattemptRequest.TYPE_REATTEMPT.equals(request.getRequestType())) {
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
        request.setReviewNote(dto.getReviewNote());
        request.setReviewedBy(user != null ? user.getUserId() : null);
        request.setReviewedAt(new Date());
        request = reattemptRequestRepository.save(request);

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
        String upper = requestType.trim().toUpperCase();
        if (AssessmentReattemptRequest.TYPE_REATTEMPT.equals(upper)
                || AssessmentReattemptRequest.TYPE_TIME_INCREASE.equals(upper)) {
            return upper;
        }
        throw new VacademyException("request_type must be REATTEMPT or TIME_INCREASE");
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
