package vacademy.io.admin_core_service.features.enroll_invite.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.common.enums.StatusEnum;
import vacademy.io.admin_core_service.features.enroll_invite.dto.EnrollInviteDTO;
import vacademy.io.admin_core_service.features.enroll_invite.entity.EnrollInvite;
import vacademy.io.admin_core_service.features.enroll_invite.repository.EnrollInviteRepository;
import vacademy.io.admin_core_service.features.enroll_invite.util.EnrollInviteAvailabilityUtil;
import vacademy.io.admin_core_service.features.workflow.enums.WorkflowTriggerEvent;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowTriggerService;
import vacademy.io.common.exceptions.VacademyException;

import java.util.*;

@Service
@Slf4j
public class LearnerEnrollInviteService {

    @Autowired
    private EnrollInviteRepository enrollInviteRepository;

    @Autowired
    private EnrollInviteService enrollInviteService;

    @Autowired
    private WorkflowTriggerService workflowTriggerService;

    @Autowired
    private InviteFormAdminNotificationService inviteFormAdminNotificationService;

    /**
     * Fetches and validates an active enroll invite by instituteId and inviteCode.
     *
     * @param instituteId The ID of the institute.
     * @param inviteCode  The invite code used by learner.
     * @return Fully populated EnrollInviteDTO
     * @throws VacademyException if invite not found, not started yet, or expired.
     */
    public EnrollInviteDTO getEnrollInvite(String instituteId, String inviteCode) {
        if (Objects.isNull(instituteId) || Objects.isNull(inviteCode)) {
            throw new VacademyException("Institute ID and Invite Code are required.");
        }

        // Load ACTIVE or INACTIVE invites (only DELETED / genuinely-missing codes 404), so that an
        // expired, not-yet-started, or manually-deactivated link is still returned to the learner —
        // carrying its status/dates and its admin-authored "unavailable" message in setting_json.
        // Previously this method threw a hardcoded 510 for those cases, so the message (and the whole
        // DTO) never reached the browser. The FE now reads availabilityStatus to decide whether to
        // render the enrollment form or the admin message. The actual enrollment block is enforced
        // server-side in LearnerEnrollRequestService (see EnrollInviteAvailabilityUtil).
        EnrollInvite enrollInvite = enrollInviteRepository
                .findValidEnrollInvite(
                        List.of(StatusEnum.ACTIVE.name(), StatusEnum.INACTIVE.name()),
                        instituteId, inviteCode)
                .orElseThrow(() -> new VacademyException("Enroll invite not found."));

        EnrollInviteDTO result = enrollInviteService.buildFullEnrollInviteDTO(enrollInvite, instituteId);
        // This endpoint is open — keep the team-notification email list out of the payload.
        result.setSettingJson(inviteFormAdminNotificationService.redactFromSettingJson(result.getSettingJson()));

        // Only fire the form-fill workflow when the invite is actually open for enrollment.
        if (EnrollInviteAvailabilityUtil.isAvailable(enrollInvite)) {
            try {
                Map<String, Object> contextData = new HashMap<>();
                contextData.put("invite", enrollInvite);
                contextData.put("instituteId", instituteId);
                contextData.put("inviteCode", inviteCode);
                workflowTriggerService.handleTriggerEvents(
                        WorkflowTriggerEvent.INVITE_FORM_FILL.name(),
                        enrollInvite.getId(),
                        instituteId,
                        contextData);
            } catch (Exception e) {
                log.warn("Failed to trigger INVITE_FORM_FILL workflow", e);
            }
        }

        return result;
    }
}
