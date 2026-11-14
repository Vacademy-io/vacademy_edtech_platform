package vacademy.io.admin_core_service.features.learner.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.features.learner.dto.LmsLoginUrlsRequest;
import vacademy.io.admin_core_service.features.learner.dto.UsernameChangedRequest;
import vacademy.io.admin_core_service.features.learner.service.LearnerCredentialSyncService;
import vacademy.io.admin_core_service.features.learner.service.LearnerLmsConnectionResolver;
import vacademy.io.admin_core_service.features.learner.service.LearnerLmsUserSyncService;
import vacademy.io.admin_core_service.features.learner.service.LearnerService;
import vacademy.io.admin_core_service.features.institute_learner.dto.batch_enrollment.BatchEnrolledLearnerDto;
import vacademy.io.admin_core_service.features.institute_learner.dto.batch_enrollment.BatchEnrollmentRowDto;
import vacademy.io.admin_core_service.features.institute_learner.dto.batch_enrollment.EnrolledLearnersRequest;
import vacademy.io.admin_core_service.features.institute_learner.dto.batch_enrollment.EnrollmentNumberRowDto;
import vacademy.io.admin_core_service.features.institute_learner.dto.batch_enrollment.EnrollmentNumbersRequest;
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionInstituteGroupMappingRepository;
import vacademy.io.common.auth.dto.UserDTO;

import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/admin-core-service/internal/learner/v1")
public class InternalLearnerDetailController {

    @Autowired
    private LearnerService learnerService;

    @Autowired
    private LearnerLmsUserSyncService learnerLmsUserSyncService;

    @Autowired
    private LearnerCredentialSyncService learnerCredentialSyncService;

    @Autowired
    private LearnerLmsConnectionResolver learnerLmsConnectionResolver;

    @Autowired
    private StudentSessionInstituteGroupMappingRepository studentSessionRepository;

    /** Mapping statuses that count as enrolled when the caller does not say. */
    private static final List<String> DEFAULT_ENROLLED_STATUSES = List.of("ACTIVE");

    /**
     * Refuses absurd batch sets rather than streaming an unbounded result. The largest
     * single batch in prod holds ~4k learners, so this is roughly 5x headroom; a request
     * past it is a bug or an abuse, not a real assessment.
     */
    private static final int MAX_PACKAGE_SESSIONS = 200;

    /**
     * Called by auth_service AFTER it commits a new {@code users.username}.
     * Updates admin_core's own {@code student.username} copies and forwards the
     * rename to assessment_service, which holds four more.
     */
    @PostMapping("/username-changed")
    public ResponseEntity<String> usernameChanged(@RequestBody UsernameChangedRequest request) {
        learnerCredentialSyncService.applyUsernameChange(
                request.getUserId(), request.getOldUsername(), request.getNewUsername());
        return ResponseEntity.ok("done");
    }

    @PutMapping("/update")
    public ResponseEntity<String> updateLearnerDetail(@RequestBody UserDTO userDTO){
        return ResponseEntity.ok(learnerService.updateLearnerDetail(userDTO));
    }

    /**
     * Learners enrolled in the given batches, one row per learner.
     *
     * <p>Exists for assessment_service's "enrolled but has not attempted" list: batch
     * learners get no row in the assessment database until they actually start a test, so
     * that set cannot be derived there at all. The caller fetches the enrolled set and
     * subtracts the learners who already have an attempt.
     *
     * <p>There is deliberately no exclude-users parameter and no pagination. Both were
     * tried; both push an unestimable predicate into the query, and once Postgres chose a
     * generic plan the array got re-evaluated per row (22ms -> 434-880ms on prod data,
     * intermittently). Returning the whole enrolled set keeps the plan stable, and the
     * caller caches it, so this runs once per batch-set per cache window rather than once
     * per page view.
     */
    @PostMapping("/enrolled-by-package-sessions")
    public ResponseEntity<List<BatchEnrolledLearnerDto>> getEnrolledLearners(
            @RequestBody EnrolledLearnersRequest request) {
        if (request == null || request.getInstituteId() == null || request.getInstituteId().isBlank()
                || request.getPackageSessionIds() == null || request.getPackageSessionIds().isEmpty()) {
            return ResponseEntity.ok(List.of());
        }
        if (request.getPackageSessionIds().size() > MAX_PACKAGE_SESSIONS) {
            return ResponseEntity.badRequest().build();
        }
        List<String> statuses = (request.getStatuses() == null || request.getStatuses().isEmpty())
                ? DEFAULT_ENROLLED_STATUSES
                : request.getStatuses();
        return ResponseEntity.ok(studentSessionRepository.findEnrolledLearnersByPackageSessions(
                request.getPackageSessionIds(), request.getInstituteId(), statuses));
    }

    /**
     * Every (learner, batch) enrolment in the given batches, one row per pair, with the
     * enrolment date. For assessment_service's Assessment Dashboard, which needs each
     * batch's full membership to count who was set a test and never attempted it.
     * Same request shape, status default and batch ceiling as the endpoint above.
     */
    @PostMapping("/enrollments-by-package-sessions")
    public ResponseEntity<List<BatchEnrollmentRowDto>> getEnrollmentRows(
            @RequestBody EnrolledLearnersRequest request) {
        if (request == null || request.getInstituteId() == null || request.getInstituteId().isBlank()
                || request.getPackageSessionIds() == null || request.getPackageSessionIds().isEmpty()) {
            return ResponseEntity.ok(List.of());
        }
        if (request.getPackageSessionIds().size() > MAX_PACKAGE_SESSIONS) {
            return ResponseEntity.badRequest().build();
        }
        List<String> statuses = (request.getStatuses() == null || request.getStatuses().isEmpty())
                ? DEFAULT_ENROLLED_STATUSES
                : request.getStatuses();
        return ResponseEntity.ok(studentSessionRepository.findEnrollmentRowsByPackageSessions(
                request.getPackageSessionIds(), request.getInstituteId(), statuses));
    }

    /** OMR sheets cap a paper at one A4 page per student; no real class needs more. */
    private static final int MAX_ENROLLMENT_NUMBER_USERS = 5000;

    /**
     * The institute enrollment number on each of these learners' enrolments, one row per
     * (learner, batch). assessment_service prints it as the roll-number grid on OMR sheets
     * and matches every scanned sheet back to its learner by it.
     */
    @PostMapping("/enrollment-numbers")
    public ResponseEntity<List<EnrollmentNumberRowDto>> getEnrollmentNumbers(
            @RequestBody EnrollmentNumbersRequest request) {
        if (request == null || request.getInstituteId() == null || request.getInstituteId().isBlank()
                || request.getUserIds() == null || request.getUserIds().isEmpty()) {
            return ResponseEntity.ok(List.of());
        }
        if (request.getUserIds().size() > MAX_ENROLLMENT_NUMBER_USERS) {
            return ResponseEntity.badRequest().build();
        }
        List<String> statuses = (request.getStatuses() == null || request.getStatuses().isEmpty())
                ? DEFAULT_ENROLLED_STATUSES
                : request.getStatuses();
        return ResponseEntity.ok(studentSessionRepository.findEnrollmentNumbersForUsers(
                request.getUserIds(), request.getInstituteId(), statuses));
    }

    /**
     * A learner's enrollment number at an institute, shown on assessment report headers.
     * Empty object when they have none.
     */
    @GetMapping("/enrollment-number")
    public ResponseEntity<Map<String, String>> getEnrollmentNumber(@RequestParam String userId,
                                                                   @RequestParam String instituteId) {
        return ResponseEntity.ok(studentSessionRepository.findLatestEnrollmentNumber(userId, instituteId)
                .map(n -> Map.of("enrollment_number", n.trim()))
                .orElse(Map.of()));
    }

    /**
     * Mirrors a learner's newly-changed portal password to any WordPress LMS their
     * courses are connected to. Called by auth_service after a password update.
     * The sync itself is @Async + best-effort, so this returns immediately.
     */
    @PostMapping("/sync-lms-password")
    public ResponseEntity<String> syncLmsPassword(@RequestBody UserDTO userDTO){
        learnerLmsUserSyncService.syncPasswordUpdate(
                userDTO.getId(), userDTO.getEmail(), userDTO.getPassword());
        return ResponseEntity.ok("triggered");
    }

    /** One credential-share batch; the UI caps a bulk share well below this. */
    private static final int MAX_LMS_LOGIN_URL_USERS = 1000;

    /**
     * userId -> the LMS site each learner signs in to, for the login link in the credential
     * emails auth_service sends. Learners with no connected LMS are left out of the map, so
     * the caller keeps its own learner-portal fallback for them.
     */
    @PostMapping("/lms-login-urls")
    public ResponseEntity<Map<String, String>> getLmsLoginUrls(@RequestBody LmsLoginUrlsRequest request) {
        if (request == null || request.getUserIds() == null || request.getUserIds().isEmpty()) {
            return ResponseEntity.ok(Map.of());
        }
        if (request.getUserIds().size() > MAX_LMS_LOGIN_URL_USERS) {
            return ResponseEntity.badRequest().build();
        }
        Map<String, String> urls = new LinkedHashMap<>();
        for (String userId : new LinkedHashSet<>(request.getUserIds())) {
            String url = learnerLmsConnectionResolver.resolveLoginSiteUrl(userId, request.getInstituteId());
            if (url != null) {
                urls.put(userId, url);
            }
        }
        return ResponseEntity.ok(urls);
    }
}
