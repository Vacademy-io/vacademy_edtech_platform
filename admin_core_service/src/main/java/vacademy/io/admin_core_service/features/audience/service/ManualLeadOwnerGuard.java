package vacademy.io.admin_core_service.features.audience.service;

import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.audience.dto.SubmitLeadRequestDTO;
import vacademy.io.admin_core_service.features.audience.entity.Audience;
import vacademy.io.admin_core_service.features.audience.repository.AudienceRepository;
import vacademy.io.admin_core_service.features.audience.repository.AudienceResponseRepository.LeadOwnerRow;
import vacademy.io.admin_core_service.features.audience.repository.AudienceResponseRepository.OpenLeadRow;
import vacademy.io.admin_core_service.features.counsellor_workbench.service.CounsellorScopeService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;
import java.util.Optional;

/**
 * Stops a counsellor from adding by hand a lead that another counsellor already owns.
 *
 * <p>Under phone dedup with "Allow & reassign" such an add used to go through as a second
 * lead for the same student, usually owned by the person adding it, and two counsellors
 * then worked the same student. Now the add is refused with the current owner's name, so
 * the counsellor knows whom to talk to.
 *
 * <p>Off unless the institute's Lead Settings have dedup on PHONE with "Allow & reassign"
 * and {@code repeatLead.blockOwnedManualAdd} switched on. Only the authenticated single
 * add-lead form ({@code POST .../v1/audience/lead/submit}) calls this. Admins and non-
 * counsellor staff may still add; a counsellor may re-add their own lead; a lead whose owner
 * is no longer a counsellor is free to take. A phone too short to match, or a failed
 * lookup, lets the add through unchanged.
 *
 * <p>With {@code repeatLead.blockOpenLeadManualAdd} on (any dedup field), a counsellor also
 * cannot add a lead that is still open — not converted and not LOST — whoever owns it,
 * themselves included. A converted or discarded lead can be added again. Both refusals are
 * HTTP 409 so the add-lead page can show them as a dialog.
 */
@Service
@RequiredArgsConstructor
public class ManualLeadOwnerGuard {

    private static final Logger logger = LoggerFactory.getLogger(ManualLeadOwnerGuard.class);

    private final AudienceRepository audienceRepository;
    private final LeadDeduplicationService leadDeduplicationService;
    private final CounsellorScopeService counsellorScopeService;

    /**
     * Throws {@link VacademyException} (409) when the lead is still open and the institute
     * blocks re-adding open leads, or when the phone belongs to another counsellor's lead.
     */
    public void checkCanAdd(SubmitLeadRequestDTO request, CustomUserDetails caller) {
        if (request == null || caller == null || request.getUserDTO() == null
                || !StringUtils.hasText(request.getAudienceId())) {
            return;
        }
        checkNotAnOpenLead(request, caller);
        if (!StringUtils.hasText(request.getUserDTO().getMobileNumber())) {
            return;
        }
        LeadOwnerRow owner;
        try {
            String instituteId = audienceRepository.findById(request.getAudienceId())
                    .map(Audience::getInstituteId)
                    .orElse(null);
            if (instituteId == null) return;
            Optional<LeadOwnerRow> current = leadDeduplicationService.findCurrentOwnerByPhone(
                    instituteId, request.getAudienceId(), request.getUserDTO().getMobileNumber());
            if (current.isEmpty() || !StringUtils.hasText(current.get().getCounsellorId())) return;
            owner = current.get();
            if (owner.getCounsellorId().equals(caller.getUserId())) return;
            if (counsellorScopeService.hasAdminRole(caller, instituteId)) return;
            List<String> counsellors = counsellorScopeService.allCounsellorUserIds(instituteId);
            // Only counsellors are held back (front desk and other staff add walk-ins as
            // before), and only for an owner who is still a counsellor. An empty roster
            // means the lookup failed, which lets the add through.
            if (!counsellors.contains(caller.getUserId())) return;
            if (!counsellors.contains(owner.getCounsellorId())) return;
        } catch (Exception e) {
            logger.warn("Manual lead add for audience {}: owner check failed, allowing the add: {}",
                    request.getAudienceId(), e.getMessage());
            return;
        }
        String name = StringUtils.hasText(owner.getCounsellorName()) ? owner.getCounsellorName() : "another counsellor";
        throw new VacademyException(HttpStatus.CONFLICT, "This phone number is already a lead of " + name
                + ". Ask an admin if it should be reassigned.");
    }

    /**
     * Refuses a counsellor's manual add of a lead that is still being worked. Admins and
     * non-counsellor staff are not held back; a failed lookup lets the add through.
     */
    private void checkNotAnOpenLead(SubmitLeadRequestDTO request, CustomUserDetails caller) {
        OpenLeadRow open;
        try {
            String instituteId = audienceRepository.findById(request.getAudienceId())
                    .map(Audience::getInstituteId)
                    .orElse(null);
            if (instituteId == null) return;
            Optional<OpenLeadRow> match = leadDeduplicationService.findOpenLeadForManualAdd(instituteId,
                    request.getAudienceId(), request.getUserDTO().getEmail(), request.getUserDTO().getMobileNumber());
            if (match.isEmpty()) return;
            if (counsellorScopeService.hasAdminRole(caller, instituteId)) return;
            // An empty roster means the lookup failed, which lets the add through.
            if (!counsellorScopeService.allCounsellorUserIds(instituteId).contains(caller.getUserId())) return;
            open = match.get();
        } catch (Exception e) {
            logger.warn("Manual lead add for audience {}: open-lead check failed, allowing the add: {}",
                    request.getAudienceId(), e.getMessage());
            return;
        }
        String owner = StringUtils.hasText(open.getCounsellorName())
                ? "assigned to " + open.getCounsellorName() : "not assigned yet";
        String status = StringUtils.hasText(open.getStatusLabel()) ? ", status " + open.getStatusLabel() : "";
        throw new VacademyException(HttpStatus.CONFLICT, "This lead is already in the CRM and is still being worked ("
                + owner + status + "), so it can't be added again. It can be added once the lead is discarded.");
    }
}
