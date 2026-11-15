package vacademy.io.admin_core_service.features.parent_link.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.apache.commons.lang3.RandomStringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.audience.repository.AudienceResponseRepository;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.institute.entity.Template;
import vacademy.io.admin_core_service.features.institute.repository.TemplateRepository;
import vacademy.io.admin_core_service.features.notification.entity.NotificationEventConfig;
import vacademy.io.admin_core_service.features.notification.enums.NotificationEventType;
import vacademy.io.admin_core_service.features.notification.enums.NotificationSourceType;
import vacademy.io.admin_core_service.features.notification.enums.NotificationTemplateType;
import vacademy.io.admin_core_service.features.notification.repository.NotificationEventConfigRepository;
import vacademy.io.admin_core_service.features.notification.service.DynamicNotificationService;
import vacademy.io.admin_core_service.features.institute_learner.entity.Student;
import vacademy.io.admin_core_service.features.institute_learner.enums.LearnerSessionStatusEnum;
import vacademy.io.admin_core_service.features.institute_learner.repository.InstituteStudentRepository;
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionInstituteGroupMappingRepository;
import vacademy.io.admin_core_service.features.parent_link.dto.BackfillSummaryDTO;
import vacademy.io.admin_core_service.features.parent_link.dto.CredentialTemplateConfigDTO;
import vacademy.io.admin_core_service.features.parent_link.dto.NewGuardianLinkRequestDTO;
import vacademy.io.admin_core_service.features.parent_link.dto.ParentLinkActionRequestDTO;
import vacademy.io.admin_core_service.features.parent_link.dto.ParentLinkActionResponseDTO;
import vacademy.io.admin_core_service.features.parent_link.dto.PendingGuardianStudentDTO;
import vacademy.io.admin_core_service.features.parent_link.dto.ShareCredentialsResultDTO;
import vacademy.io.common.auth.dto.UserCredentials;
import vacademy.io.common.auth.dto.BackfillCreatedPairDTO;
import vacademy.io.common.auth.dto.BackfillParentItemDTO;
import vacademy.io.common.auth.dto.BackfillParentsResultDTO;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.admin_core_service.features.learner.service.LearnerProfileEditGuard;
import vacademy.io.common.exceptions.VacademyException;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

@Service
public class ParentLinkService {

    private static final int BACKFILL_CHUNK_SIZE = 100;

    @Autowired
    private AuthService authService;

    @Autowired
    private StudentSessionInstituteGroupMappingRepository ssigmRepository;

    @Autowired
    private InstituteStudentRepository studentRepository;

    @Autowired
    private InstituteRepository instituteRepository;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private AudienceResponseRepository audienceResponseRepository;

    @Autowired
    private NotificationEventConfigRepository notificationEventConfigRepository;

    @Autowired
    private TemplateRepository templateRepository;

    @Autowired
    private DynamicNotificationService dynamicNotificationService;

    @Autowired
    private LearnerProfileEditGuard learnerProfileEditGuard;

    private static final String NOT_IN_INSTITUTE = "Both the guardian and the learner must belong to this institute";
    private static final String GUARDIAN_LINK_REFUSED =
            "Only an admin of every institute this learner belongs to can change their guardian";

    /**
     * Checks a staff member's {@link #link} request (the guardian screens): every existing
     * account named must belong to the request's institute, and an existing learner's guardian
     * link, which applies to the learner's whole account, is changed only as
     * {@link LearnerProfileEditGuard#requireCanChangeAccountFrom} allows. The caller's staff
     * role in the institute is checked by the controller.
     */
    public void requireCanLink(CustomUserDetails caller, ParentLinkActionRequestDTO request) {
        if (request == null || !StringUtils.hasText(request.getInstituteId())
                || !StringUtils.hasText(request.getAnchorUserId())) {
            throw new VacademyException("instituteId, anchorUserId, direction and mode are required");
        }
        String instituteId = request.getInstituteId();
        boolean parentAddsStudent = "PARENT_ADDS_STUDENT".equalsIgnoreCase(request.getDirection());
        boolean linkExisting = "LINK_EXISTING".equalsIgnoreCase(request.getMode());
        String existingParent = parentAddsStudent ? request.getAnchorUserId()
                : (linkExisting ? request.getExistingUserId() : null);
        String existingStudent = parentAddsStudent ? (linkExisting ? request.getExistingUserId() : null)
                : request.getAnchorUserId();
        requireBelongs(existingParent, instituteId);
        requireBelongs(existingStudent, instituteId);
        if (StringUtils.hasText(existingStudent)) {
            learnerProfileEditGuard.requireCanChangeAccountFrom(caller, existingStudent, instituteId,
                    GUARDIAN_LINK_REFUSED);
        }
    }

    /** Same checks for {@link #linkNewGuardian}: only an existing learner can be named there. */
    public void requireCanLinkNewGuardian(CustomUserDetails caller, NewGuardianLinkRequestDTO request) {
        if (request == null || !StringUtils.hasText(request.getInstituteId())) {
            throw new VacademyException("instituteId and mode are required");
        }
        if ("LINK_EXISTING".equalsIgnoreCase(request.getMode())
                && StringUtils.hasText(request.getStudentExistingUserId())) {
            requireBelongs(request.getStudentExistingUserId(), request.getInstituteId());
            learnerProfileEditGuard.requireCanChangeAccountFrom(caller, request.getStudentExistingUserId(),
                    request.getInstituteId(), GUARDIAN_LINK_REFUSED);
        }
    }

    /** A role in the institute (auth-service), or an active enrolment in it. */
    private void requireBelongs(String userId, String instituteId) {
        if (!StringUtils.hasText(userId)) {
            return;
        }
        if (learnerProfileEditGuard.belongsTo(userId, instituteId)) {
            return;
        }
        List<String> enrolled = ssigmRepository.findPackageSessionIdsByUserIdAndInstituteId(userId, instituteId);
        if (enrolled == null || enrolled.isEmpty()) {
            throw new VacademyException(org.springframework.http.HttpStatus.FORBIDDEN, NOT_IN_INSTITUTE);
        }
    }

    public UserDTO getParentOfStudent(String studentUserId) {
        if (!StringUtils.hasText(studentUserId)) {
            return null;
        }
        List<UserDTO> students = authService.getUsersFromAuthServiceByUserIds(List.of(studentUserId));
        if (students.isEmpty() || !StringUtils.hasText(students.get(0).getLinkedParentId())) {
            return null;
        }
        List<UserDTO> parents = authService.getUsersFromAuthServiceByUserIds(
                List.of(students.get(0).getLinkedParentId()));
        return parents.isEmpty() ? null : parents.get(0);
    }

    public List<UserDTO> getChildrenOfParent(String parentUserId) {
        return authService.getChildrenOfParent(parentUserId);
    }

    public ParentLinkActionResponseDTO link(ParentLinkActionRequestDTO request) {
        if (!StringUtils.hasText(request.getInstituteId()) || !StringUtils.hasText(request.getAnchorUserId())
                || !StringUtils.hasText(request.getDirection()) || !StringUtils.hasText(request.getMode())) {
            throw new VacademyException("instituteId, anchorUserId, direction and mode are required");
        }

        boolean parentAddsStudent = "PARENT_ADDS_STUDENT".equalsIgnoreCase(request.getDirection());
        String otherPartyUserId;
        UserDTO newlyCreatedGuardian = null;

        if ("LINK_EXISTING".equalsIgnoreCase(request.getMode())) {
            if (!StringUtils.hasText(request.getExistingUserId())) {
                throw new VacademyException("existingUserId is required for LINK_EXISTING mode");
            }
            otherPartyUserId = request.getExistingUserId();
        } else if ("CREATE_NEW".equalsIgnoreCase(request.getMode())) {
            UserDTO createdUser = createNewLinkedUser(request, parentAddsStudent);
            otherPartyUserId = createdUser.getId();
            // Only PARENT_ADDS_STUDENT=false (STUDENT_ADDS_PARENT) creates a brand-new
            // guardian here; the other direction creates a new student instead, whose
            // credentials are handled by the normal enrollment notification path.
            if (!parentAddsStudent) {
                newlyCreatedGuardian = createdUser;
            }
        } else {
            throw new VacademyException("Unknown mode: " + request.getMode());
        }

        String parentUserId = parentAddsStudent ? request.getAnchorUserId() : otherPartyUserId;
        String studentUserId = parentAddsStudent ? otherPartyUserId : request.getAnchorUserId();

        authService.linkParentChild(parentUserId, studentUserId);
        studentRepository.updateGuardianUserId(studentUserId, parentUserId);

        if (newlyCreatedGuardian != null) {
            UserDTO student = firstOrNull(authService.getUsersFromAuthServiceByUserIds(List.of(studentUserId)));
            notifyGuardianCreated(request.getInstituteId(), newlyCreatedGuardian, student);
        }

        return ParentLinkActionResponseDTO.builder()
                .parentUserId(parentUserId)
                .studentUserId(studentUserId)
                .build();
    }

    private static UserDTO firstOrNull(List<UserDTO> users) {
        return (users == null || users.isEmpty()) ? null : users.get(0);
    }

    /**
     * Creates the new party (student or guardian, depending on direction),
     * blocking on a duplicate email/mobile match — no auto-link, no override.
     */
    private UserDTO createNewLinkedUser(ParentLinkActionRequestDTO request, boolean parentAddsStudent) {
        checkNotAlreadyTaken(request.getNewEmail(), request.getNewMobileNumber());

        UserDTO newUser = new UserDTO();
        newUser.setFullName(request.getNewFullName());
        newUser.setEmail(request.getNewEmail());
        newUser.setMobileNumber(request.getNewMobileNumber());
        // The new party being created is the opposite role of what the anchor already is.
        newUser.setRoles(parentAddsStudent ? List.of("STUDENT") : List.of("PARENT"));

        return authService.createUserFromAuthService(newUser, request.getInstituteId(), false);
    }

    /**
     * Handles the one case {@code link()} can't: a brand-new manual chip in
     * the assign dialog flagged "is this a guardian?". The guardian has no
     * user id yet, so there is no valid anchor for {@code link()} — the
     * guardian is always created fresh here, and the student side is either
     * created fresh too or linked to an already-existing user.
     */
    public ParentLinkActionResponseDTO linkNewGuardian(NewGuardianLinkRequestDTO request) {
        if (!StringUtils.hasText(request.getInstituteId()) || !StringUtils.hasText(request.getMode())) {
            throw new VacademyException("instituteId and mode are required");
        }
        checkNotAlreadyTaken(request.getGuardianEmail(), request.getGuardianMobileNumber());

        if ("LINK_EXISTING".equalsIgnoreCase(request.getMode())) {
            if (!StringUtils.hasText(request.getStudentExistingUserId())) {
                throw new VacademyException("studentExistingUserId is required for LINK_EXISTING mode");
            }
            UserDTO parentDTO = new UserDTO();
            parentDTO.setFullName(request.getGuardianFullName());
            parentDTO.setEmail(request.getGuardianEmail());
            parentDTO.setMobileNumber(request.getGuardianMobileNumber());
            parentDTO.setRoles(List.of("PARENT"));

            UserDTO createdParent = authService.createUserFromAuthService(parentDTO, request.getInstituteId(), false);
            authService.linkParentChild(createdParent.getId(), request.getStudentExistingUserId());
            studentRepository.updateGuardianUserId(request.getStudentExistingUserId(), createdParent.getId());

            UserDTO existingStudent = firstOrNull(
                    authService.getUsersFromAuthServiceByUserIds(List.of(request.getStudentExistingUserId())));
            notifyGuardianCreated(request.getInstituteId(), createdParent, existingStudent);

            return ParentLinkActionResponseDTO.builder()
                    .parentUserId(createdParent.getId())
                    .studentUserId(request.getStudentExistingUserId())
                    .build();
        } else if ("CREATE_NEW".equalsIgnoreCase(request.getMode())) {
            checkNotAlreadyTaken(request.getStudentEmail(), request.getStudentMobileNumber());

            UserDTO parentDTO = new UserDTO();
            parentDTO.setFullName(request.getGuardianFullName());
            parentDTO.setEmail(request.getGuardianEmail());
            parentDTO.setMobileNumber(request.getGuardianMobileNumber());
            parentDTO.setRoles(List.of("PARENT"));

            UserDTO studentDTO = new UserDTO();
            studentDTO.setFullName(request.getStudentFullName());
            studentDTO.setEmail(request.getStudentEmail());
            studentDTO.setMobileNumber(request.getStudentMobileNumber());
            studentDTO.setRoles(List.of("STUDENT"));

            // createMultipleUsers (auth_service) requires exactly [parent, child] and
            // already sets is_parent / linked_parent_id internally — no separate
            // linkParentChild call needed here.
            List<UserDTO> created = authService.createMultipleUsers(
                    List.of(parentDTO, studentDTO), request.getInstituteId(), false);
            String newParentId = created.get(0).getId();
            String newStudentId = created.get(1).getId();
            // Best-effort: this student is a brand-new auth user, not yet enrolled
            // here, so there is usually no local `student` row for this UPDATE to
            // match yet (it's a no-op, not an error). The eligibility check in
            // backfillGuardians/previewPendingGuardians always falls back to
            // auth_service's linked_parent_id as the source of truth, so a student
            // enrolled later without this column ever getting stamped still won't
            // be double-backfilled — only the local "which one is missed" view
            // stays incomplete for this one edge case.
            studentRepository.updateGuardianUserId(newStudentId, newParentId);
            notifyGuardianCreated(request.getInstituteId(), created.get(0), created.get(1));

            return ParentLinkActionResponseDTO.builder()
                    .parentUserId(newParentId)
                    .studentUserId(newStudentId)
                    .build();
        } else {
            throw new VacademyException("Unknown mode: " + request.getMode());
        }
    }

    private void checkNotAlreadyTaken(String email, String mobileNumber) {
        if (StringUtils.hasText(email)) {
            UserDTO existingByEmail = authService.getUserByEmail(email);
            if (existingByEmail != null) {
                throw new VacademyException("A user with this email already exists: " + email);
            }
        }
        if (StringUtils.hasText(mobileNumber)) {
            UserDTO existingByMobile = authService.getUserByMobileNumber(mobileNumber);
            if (existingByMobile != null) {
                throw new VacademyException("A user with this mobile number already exists: " + mobileNumber);
            }
        }
    }

    /**
     * Enrolled students in this institute who don't have a guardian linked
     * yet — the same eligibility check {@link #backfillGuardians} uses,
     * exposed read-only so the settings page can show admins what a backfill
     * run would actually touch before they confirm it.
     */
    public List<PendingGuardianStudentDTO> previewPendingGuardians(String instituteId) {
        return toPendingDtos(computeEligibleFromUserIds(getEnrolledStudentUserIds(instituteId)));
    }

    /**
     * Leads in this institute (any campaign, any status) whose student side
     * already has a real user attached but no guardian linked yet — reaches
     * leads that never got as far as an SSIGM enrollment row, unlike
     * {@link #previewPendingGuardians}.
     */
    public List<PendingGuardianStudentDTO> previewPendingLeadGuardians(String instituteId) {
        return toPendingDtos(computeEligibleFromUserIds(getLeadStudentUserIds(instituteId)));
    }

    private List<PendingGuardianStudentDTO> toPendingDtos(List<UserDTO> eligible) {
        return eligible.stream()
                .map(u -> PendingGuardianStudentDTO.builder()
                        .userId(u.getId())
                        .fullName(u.getFullName())
                        .email(u.getEmail())
                        .mobileNumber(u.getMobileNumber())
                        .build())
                .toList();
    }

    private List<String> getEnrolledStudentUserIds(String instituteId) {
        if (!StringUtils.hasText(instituteId)) {
            throw new VacademyException("instituteId is required");
        }
        return ssigmRepository.findDistinctUserIdsByInstituteAndStatus(
                instituteId, List.of(LearnerSessionStatusEnum.ACTIVE.name()));
    }

    private List<String> getLeadStudentUserIds(String instituteId) {
        if (!StringUtils.hasText(instituteId)) {
            throw new VacademyException("instituteId is required");
        }
        return audienceResponseRepository.findDistinctStudentUserIdsByInstitute(instituteId);
    }

    /**
     * Given a candidate id list from either source (enrolled students or
     * leads), returns the ones with no guardian linked who also aren't
     * themselves flagged as a guardian. Pre-filters via the local
     * {@code student.guardian_user_id} column as an EXCLUDE-list only — never
     * an allow-list — before the authoritative auth_service check.
     *
     * <p>This distinction matters: leads frequently have no local
     * {@code student} row at all (a row is only created at enrollment, and a
     * lead can have a real auth user + audience_response row without ever
     * being enrolled). An allow-list approach ("only keep candidates whose
     * local row shows guardian_user_id IS NULL") would silently drop those
     * never-enrolled candidates the moment the batch also contains even one
     * candidate that DOES have a local row — the previous version of this
     * method had exactly that bug: new leads with no student row vanished
     * from every backfill/preview call whenever older, already-enrolled
     * candidates were also in scope. Subtracting only the PROVEN-linked ids
     * (guardian_user_id IS NOT NULL) can never cause that: a missing local
     * row simply falls through to the real auth_service check instead of
     * being excluded.
     */
    private List<UserDTO> computeEligibleFromUserIds(List<String> candidateUserIds) {
        if (candidateUserIds.isEmpty()) {
            return List.of();
        }

        Set<String> knownAlreadyLinkedIds = studentRepository.findByUserIdInAndGuardianUserIdIsNotNull(candidateUserIds)
                .stream()
                .map(Student::getUserId)
                .collect(HashSet::new, Set::add, Set::addAll);
        List<String> lookupIds = knownAlreadyLinkedIds.isEmpty()
                ? candidateUserIds
                : candidateUserIds.stream().filter(id -> !knownAlreadyLinkedIds.contains(id)).toList();
        if (lookupIds.isEmpty()) {
            return List.of();
        }

        List<UserDTO> students = authService.getUsersFromAuthServiceByUserIds(lookupIds);
        List<UserDTO> eligible = new ArrayList<>();
        for (UserDTO student : students) {
            boolean alreadyLinked = StringUtils.hasText(student.getLinkedParentId());
            boolean isItselfAGuardian = Boolean.TRUE.equals(student.getIsParent());
            if (alreadyLinked || isItselfAGuardian) {
                continue;
            }
            eligible.add(student);
        }
        return eligible;
    }

    public BackfillSummaryDTO backfillGuardians(String instituteId) {
        return runBackfill(instituteId, computeEligibleFromUserIds(getEnrolledStudentUserIds(instituteId)));
    }

    /** Same synthetic-guardian creation, sourced from leads instead of SSIGM enrollment. */
    public BackfillSummaryDTO backfillLeadGuardians(String instituteId) {
        return runBackfill(instituteId, computeEligibleFromUserIds(getLeadStudentUserIds(instituteId)));
    }

    /**
     * Processes at most ONE batch ({@link #BACKFILL_CHUNK_SIZE}) per call —
     * deliberately, so a single HTTP request can never run long enough to
     * risk a reverse-proxy timeout, regardless of institute size. The
     * frontend loops, calling this endpoint again until {@code totalEligible}
     * comes back {@code <=} what this batch just processed. This is
     * self-correcting rather than cursor-based: eligibility is recomputed
     * fresh on every call, so a student processed in an earlier batch simply
     * no longer appears (their linked_parent_id is now set) — no offset/page
     * token needs to be threaded through by the caller.
     *
     * {@code totalEligible} in the response is the FULL outstanding count as
     * of this call's snapshot (including the batch just processed), not just
     * the batch size — that's what lets the frontend show real progress
     * ("X of Y done") across the whole loop.
     */
    private BackfillSummaryDTO runBackfill(String instituteId, List<UserDTO> eligibleStudents) {
        int totalEligible = eligibleStudents.size();
        if (totalEligible == 0) {
            return BackfillSummaryDTO.builder().totalEligible(0).created(0).skipped(0).build();
        }

        List<UserDTO> batch = totalEligible > BACKFILL_CHUNK_SIZE
                ? eligibleStudents.subList(0, BACKFILL_CHUNK_SIZE)
                : eligibleStudents;

        List<BackfillParentItemDTO> items = new ArrayList<>();
        for (UserDTO student : batch) {
            String studentName = StringUtils.hasText(student.getFullName()) ? student.getFullName() : "Student";
            items.add(BackfillParentItemDTO.builder()
                    .childUserId(student.getId())
                    .parentFullName(studentName + "'s Guardian")
                    .parentEmail(RandomStringUtils.randomAlphanumeric(10).toLowerCase() + "@vacademy.com")
                    .build());
        }

        BackfillParentsResultDTO result = authService.backfillParents(items, instituteId);
        if (result.getCreatedPairs() != null) {
            CredentialEmailConfig emailConfig = readCredentialEmailConfig(instituteId);
            for (BackfillCreatedPairDTO pair : result.getCreatedPairs()) {
                studentRepository.updateGuardianUserId(pair.getChildUserId(), pair.getParentUserId());
                if (emailConfig.sendCredentials()) {
                    dynamicNotificationService.sendGuardianAccountCreatedNotification(
                            instituteId,
                            pair.getGuardianFullName(),
                            pair.getGuardianUsername(),
                            pair.getGuardianEmail(),
                            pair.getGuardianPassword(),
                            pair.getStudentFullName(),
                            pair.getStudentEmail(),
                            emailConfig.recipient());
                }
            }
        }

        return BackfillSummaryDTO.builder()
                .totalEligible(totalEligible)
                .created(result.getCreated())
                .skipped(result.getSkipped())
                .build();
    }

    private record CredentialEmailConfig(boolean sendCredentials, String recipient) {
    }

    /**
     * Reads the Guardian Setting's credential-email preference directly from
     * the institute's setting blob — the same source the Settings page
     * reads/writes (PARENT_SETTING), so there's a single source of truth for
     * every guardian-creation path (link, link-new-guardian, backfill)
     * rather than trusting a client-supplied flag on any one request.
     */
    private CredentialEmailConfig readCredentialEmailConfig(String instituteId) {
        try {
            String settingJson = instituteRepository.findById(instituteId)
                    .map(institute -> institute.getSetting())
                    .orElse(null);
            if (!StringUtils.hasText(settingJson)) {
                return new CredentialEmailConfig(true, "STUDENT");
            }
            JsonNode root = objectMapper.readTree(settingJson);
            JsonNode data = root.path("setting").path("PARENT_SETTING").path("data");
            boolean send = data.path("sendCredentialEmail").asBoolean(true);
            String recipient = data.path("credentialRecipient").asText("STUDENT");
            return new CredentialEmailConfig(send, recipient);
        } catch (Exception e) {
            return new CredentialEmailConfig(true, "STUDENT");
        }
    }

    /**
     * The EMAIL template currently bound to GUARDIAN_ACCOUNT_CREATED for this
     * institute, if the admin has picked one via the Guardian Setting's
     * TemplateSelector. Null fields mean nothing is configured yet — the
     * settings UI shows this as "no template selected", and notifications
     * are silently skipped (see {@link DynamicNotificationService#sendGuardianAccountCreatedNotification}).
     */
    public CredentialTemplateConfigDTO getCredentialTemplateConfig(String instituteId) {
        if (!StringUtils.hasText(instituteId)) {
            throw new VacademyException("instituteId is required");
        }
        NotificationEventConfig config = notificationEventConfigRepository
                .findFirstByEventNameAndSourceTypeAndSourceIdAndTemplateTypeAndIsActiveTrueOrderByUpdatedAtDesc(
                        NotificationEventType.GUARDIAN_ACCOUNT_CREATED,
                        NotificationSourceType.INSTITUTE,
                        instituteId,
                        NotificationTemplateType.EMAIL)
                .orElse(null);
        if (config == null || !StringUtils.hasText(config.getTemplateId())) {
            return CredentialTemplateConfigDTO.builder().build();
        }
        Template template = templateRepository.findById(config.getTemplateId()).orElse(null);
        return CredentialTemplateConfigDTO.builder()
                .templateId(config.getTemplateId())
                .templateName(template != null ? template.getName() : null)
                .templateSubject(template != null ? template.getSubject() : null)
                .build();
    }

    /**
     * Upserts the institute-scoped GUARDIAN_ACCOUNT_CREATED -> EMAIL template
     * binding. One row per institute (never duplicated) — reactivates and
     * repoints an existing row instead of inserting a new one each time the
     * admin changes their selection.
     */
    public void setCredentialTemplate(String instituteId, String templateId) {
        if (!StringUtils.hasText(instituteId) || !StringUtils.hasText(templateId)) {
            throw new VacademyException("instituteId and templateId are required");
        }
        templateRepository.findById(templateId)
                .orElseThrow(() -> new VacademyException("Template not found: " + templateId));

        NotificationEventConfig config = notificationEventConfigRepository
                .findFirstByEventNameAndSourceTypeAndSourceIdAndTemplateTypeOrderByUpdatedAtDesc(
                        NotificationEventType.GUARDIAN_ACCOUNT_CREATED,
                        NotificationSourceType.INSTITUTE,
                        instituteId,
                        NotificationTemplateType.EMAIL)
                .orElseGet(() -> new NotificationEventConfig(
                        NotificationEventType.GUARDIAN_ACCOUNT_CREATED,
                        NotificationSourceType.INSTITUTE,
                        instituteId,
                        NotificationTemplateType.EMAIL,
                        null));
        config.setTemplateId(templateId);
        config.setTemplateName(null);
        config.setIsActive(true);
        notificationEventConfigRepository.save(config);
    }

    /**
     * Explicit admin action: (re)send an ALREADY-created guardian's
     * credentials so they can onboard to the Parent Portal.
     *
     * <p>Deliberately NOT gated on {@code PARENT_SETTING.sendCredentialEmail} —
     * that flag governs the AUTOMATIC send at creation time, whereas here an
     * admin is explicitly asking for the mail. The configured recipient is
     * still honoured (so behaviour matches the automatic path) unless the
     * caller overrides it.
     *
     * <p>The guardian's password isn't held locally, so it's re-fetched from
     * auth_service — the create-time flows get it back inline, a later share
     * has to look it up.
     */
    public ShareCredentialsResultDTO shareGuardianCredentials(String instituteId, String studentUserId,
            String recipientOverride) {
        if (!StringUtils.hasText(instituteId) || !StringUtils.hasText(studentUserId)) {
            throw new VacademyException("instituteId and studentUserId are required");
        }
        UserDTO guardian = getParentOfStudent(studentUserId);
        if (guardian == null) {
            throw new VacademyException("No guardian is linked to this student");
        }
        UserDTO student = firstOrNull(authService.getUsersFromAuthServiceByUserIds(List.of(studentUserId)));

        String recipient = StringUtils.hasText(recipientOverride)
                ? recipientOverride
                : readCredentialEmailConfig(instituteId).recipient();
        boolean toGuardian = "GUARDIAN".equalsIgnoreCase(recipient);
        String recipientEmail = toGuardian
                ? guardian.getEmail()
                : (student != null ? student.getEmail() : null);

        // Pre-validate rather than letting the notification silently no-op —
        // a backfilled guardian's synthetic @vacademy.com address is exactly
        // the case an admin needs told about.
        if (!StringUtils.hasText(recipientEmail)) {
            return ShareCredentialsResultDTO.builder()
                    .sent(false)
                    .recipient(recipient)
                    .reason(toGuardian
                            ? "This guardian has no email address on file."
                            : "This student has no email address on file.")
                    .build();
        }

        UserCredentials guardianCreds = firstOrNullCreds(
                authService.getUsersCredentials(List.of(guardian.getId())));

        dynamicNotificationService.sendGuardianAccountCreatedNotification(
                instituteId,
                guardian.getFullName(),
                guardianCreds != null ? guardianCreds.getUsername() : guardian.getUsername(),
                guardian.getEmail(),
                guardianCreds != null ? guardianCreds.getPassword() : null,
                student != null ? student.getFullName() : null,
                student != null ? student.getEmail() : null,
                recipient);

        return ShareCredentialsResultDTO.builder()
                .sent(true)
                .recipient(recipient)
                .recipientEmail(recipientEmail)
                .build();
    }

    private static UserCredentials firstOrNullCreds(List<UserCredentials> creds) {
        return (creds == null || creds.isEmpty()) ? null : creds.get(0);
    }

    /**
     * Institute-wide guardian credential export — one row PER GUARDIAN (not
     * per student), since a guardian can cover several children; their linked
     * students are collapsed into one column rather than duplicating the
     * guardian's password across N rows.
     *
     * <p>Scope matches the enrolled-students backfill (active SSIGM rows +
     * a locally-stamped {@code guardian_user_id}), so "who appears here" is
     * consistent with "who the backfill created".
     *
     * <p>Contains PLAINTEXT passwords by design — this is the delivery
     * mechanism for backfilled guardians whose synthetic @vacademy.com address
     * can't receive the credential email. The caller is expected to gate this
     * on the same {@code allowViewPassword} setting that guards credential
     * reveal elsewhere.
     */
    public String exportGuardianCredentialsCsv(String instituteId) {
        List<String> studentUserIds = getEnrolledStudentUserIds(instituteId);
        StringBuilder csv = new StringBuilder();
        csv.append("Guardian Name,Guardian Username,Guardian Password,Guardian Email,Linked Students,Student Emails\n");
        if (studentUserIds.isEmpty()) {
            return csv.toString();
        }

        // guardianUserId -> the students they're linked to (within this institute)
        Map<String, List<String>> guardianToStudents = new LinkedHashMap<>();
        for (Student student : studentRepository.findByUserIdInAndGuardianUserIdIsNotNull(studentUserIds)) {
            guardianToStudents
                    .computeIfAbsent(student.getGuardianUserId(), k -> new ArrayList<>())
                    .add(student.getUserId());
        }
        if (guardianToStudents.isEmpty()) {
            return csv.toString();
        }

        List<String> guardianIds = new ArrayList<>(guardianToStudents.keySet());
        Map<String, UserDTO> guardiansById = new HashMap<>();
        for (UserDTO guardian : authService.getUsersFromAuthServiceByUserIds(guardianIds)) {
            guardiansById.put(guardian.getId(), guardian);
        }
        Map<String, UserCredentials> credsById = new HashMap<>();
        for (UserCredentials cred : authService.getUsersCredentials(guardianIds)) {
            credsById.put(cred.getUserId(), cred);
        }
        List<String> linkedStudentIds = guardianToStudents.values().stream().flatMap(List::stream).distinct().toList();
        Map<String, UserDTO> studentsById = new HashMap<>();
        for (UserDTO student : authService.getUsersFromAuthServiceByUserIds(linkedStudentIds)) {
            studentsById.put(student.getId(), student);
        }

        for (Map.Entry<String, List<String>> entry : guardianToStudents.entrySet()) {
            UserDTO guardian = guardiansById.get(entry.getKey());
            UserCredentials cred = credsById.get(entry.getKey());
            List<UserDTO> children = entry.getValue().stream()
                    .map(studentsById::get)
                    .filter(java.util.Objects::nonNull)
                    .toList();

            csv.append(csvCell(guardian != null ? guardian.getFullName() : null)).append(',')
                    .append(csvCell(cred != null ? cred.getUsername()
                            : (guardian != null ? guardian.getUsername() : null)))
                    .append(',')
                    .append(csvCell(cred != null ? cred.getPassword() : null)).append(',')
                    .append(csvCell(guardian != null ? guardian.getEmail() : null)).append(',')
                    .append(csvCell(children.stream().map(UserDTO::getFullName)
                            .filter(StringUtils::hasText).collect(Collectors.joining("; "))))
                    .append(',')
                    .append(csvCell(children.stream().map(UserDTO::getEmail)
                            .filter(StringUtils::hasText).collect(Collectors.joining("; "))))
                    .append('\n');
        }
        return csv.toString();
    }

    /** RFC-4180 cell: always quoted, embedded quotes doubled — safe for names/emails containing commas. */
    private static String csvCell(String value) {
        String safe = value == null ? "" : value;
        return "\"" + safe.replace("\"", "\"\"") + "\"";
    }

    /**
     * Best-effort credential notification for a freshly-created guardian
     * (link/link-new-guardian paths). Recipient choice ("STUDENT" vs
     * "GUARDIAN") comes from the same Guardian Setting the backfill path
     * uses, so all guardian-creation flows behave consistently.
     */
    private void notifyGuardianCreated(String instituteId, UserDTO guardian, UserDTO student) {
        CredentialEmailConfig emailConfig = readCredentialEmailConfig(instituteId);
        if (!emailConfig.sendCredentials()) {
            return;
        }
        dynamicNotificationService.sendGuardianAccountCreatedNotification(
                instituteId,
                guardian != null ? guardian.getFullName() : null,
                guardian != null ? guardian.getUsername() : null,
                guardian != null ? guardian.getEmail() : null,
                guardian != null ? guardian.getPassword() : null,
                student != null ? student.getFullName() : null,
                student != null ? student.getEmail() : null,
                emailConfig.recipient());
    }
}
