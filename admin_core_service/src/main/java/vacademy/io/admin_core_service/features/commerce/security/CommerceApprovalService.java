package vacademy.io.admin_core_service.features.commerce.security;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.commerce.security.entity.CommerceApproval;
import vacademy.io.admin_core_service.features.commerce.security.repository.CommerceApprovalRepository;
import vacademy.io.admin_core_service.features.commerce.security.repository.CommerceStaffLocationRepository;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;

/**
 * Approval by manager PIN. The PIN travels with the action it approves:
 * the action's service calls {@link #approve} inside its own transaction, and the
 * {@code commerce_approval} row commits or rolls back with the action.
 */
@Service
public class CommerceApprovalService {

    private static final String ADMIN = "ADMIN";

    private final CommercePinService pinService;
    private final CommerceApprovalRepository approvalRepository;
    private final CommerceStaffLocationRepository staffLocationRepository;
    private final AuthService authService;

    public CommerceApprovalService(CommercePinService pinService,
                                   CommerceApprovalRepository approvalRepository,
                                   CommerceStaffLocationRepository staffLocationRepository,
                                   AuthService authService) {
        this.pinService = pinService;
        this.approvalRepository = approvalRepository;
        this.staffLocationRepository = staffLocationRepository;
        this.authService = authService;
    }

    /**
     * Checks the approver and their PIN and writes the approval row. MANDATORY on purpose: an
     * approval written outside the action's transaction could outlive an action that failed.
     *
     * <p>The PIN row is written once, when a manager sets it, and nothing removes it when the
     * role is taken away in auth_service. So the approver's role is read again here, on every
     * approval: ADMIN, or COMMERCE_STORE_MANAGER assigned to the action's location. A requester
     * can approve their own action only if they pass that same test.
     *
     * @param locationId     the location the action happens at; null for an action with no location
     * @param requestedBy    the signed-in user doing the action (for example the cashier)
     * @param approverUserId the manager whose PIN was typed
     * @throws CommerceAccessDeniedException 403 PIN_INVALID or PIN_LOCKED
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public CommerceApproval approve(String instituteId, String locationId, String requestedBy,
                                    String approverUserId, String rawPin, String action,
                                    String referenceType, String referenceId, BigDecimal amount, String reason) {
        if (isBlank(instituteId) || isBlank(requestedBy) || isBlank(action) || isBlank(referenceType)
                || isBlank(referenceId)) {
            throw new IllegalArgumentException(
                    "commerce approval: institute, requester, action and reference are required");
        }
        requireCurrentManager(instituteId, locationId, approverUserId);
        pinService.verify(instituteId, approverUserId, rawPin);

        CommerceApproval approval = new CommerceApproval();
        approval.setInstituteId(instituteId);
        approval.setAction(action);
        approval.setReferenceType(referenceType);
        approval.setReferenceId(referenceId);
        approval.setRequestedBy(requestedBy);
        approval.setApprovedBy(approverUserId);
        approval.setAmount(amount);
        approval.setReason(reason);
        return approvalRepository.save(approval);
    }

    /**
     * Refused with the same PIN_INVALID as a wrong PIN, so the answer does not tell a guesser
     * who is a manager. A failed lookup returns no roles and is refused too.
     */
    private void requireCurrentManager(String instituteId, String locationId, String approverUserId) {
        if (isBlank(approverUserId)) {
            throw wrongPin();
        }
        Map<String, List<String>> rolesByUser = authService.getInstituteRoles(instituteId, List.of(approverUserId));
        List<String> roles = rolesByUser == null ? null : rolesByUser.get(approverUserId);
        if (roles == null) {
            throw wrongPin();
        }
        boolean admin = roles.stream().anyMatch(ADMIN::equalsIgnoreCase);
        boolean manager = roles.stream().anyMatch(CommerceRole.STORE_MANAGER.authority()::equalsIgnoreCase);
        if (admin) {
            return;
        }
        if (!manager) {
            throw wrongPin();
        }
        if (!isBlank(locationId)
                && !staffLocationRepository.existsByInstituteIdAndUserIdAndLocationId(instituteId, approverUserId, locationId)) {
            throw wrongPin();
        }
    }

    private static CommerceAccessDeniedException wrongPin() {
        return new CommerceAccessDeniedException(CommerceAccessDeniedException.PIN_INVALID, "wrong PIN");
    }

    private static boolean isBlank(String value) {
        return value == null || value.isBlank();
    }
}
