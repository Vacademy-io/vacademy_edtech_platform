package vacademy.io.auth_service.feature.panel.phase2;

import vacademy.io.auth_service.feature.panel.repository.PanelRepository.DeviceRow;

/**
 * Seam: a panel set up by an installer waits for the school's approval before anyone can sign in
 * on it. Consulted at the same three session starts as {@link PanelLicenceGate#requireCanStart}.
 *
 * <p>Replacement: exactly one bean of this type exists. {@link DefaultPanelApprovalGate} is that bean.
 * Unlike the other placeholders it already enforces the rule (only APPROVED devices sign in), because
 * that is safe with every switch off: every phase 1 device is APPROVED by the column default. The
 * licence and partner chunk may keep it, or delete it and add its own {@code @Component}.
 */
public interface PanelApprovalGate {

    /** Throws {@code compat.refusal(device, AWAITING_APPROVAL)} unless approval_state is APPROVED. */
    void requireApproved(DeviceRow device);
}
