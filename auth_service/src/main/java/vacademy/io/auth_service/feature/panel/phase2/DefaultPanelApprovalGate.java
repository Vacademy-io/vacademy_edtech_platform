package vacademy.io.auth_service.feature.panel.phase2;

import org.springframework.stereotype.Component;
import vacademy.io.auth_service.feature.panel.repository.PanelRepository.DeviceRow;

/** Only an APPROVED device starts sessions. A null state (a row read without the column) counts as APPROVED. */
@Component
public class DefaultPanelApprovalGate implements PanelApprovalGate {

    private final PanelCompat compat;

    public DefaultPanelApprovalGate(PanelCompat compat) {
        this.compat = compat;
    }

    @Override
    public void requireApproved(DeviceRow device) {
        String state = device.approvalState();
        if (state != null && !"APPROVED".equals(state)) {
            throw compat.refusal(device, PanelPhase2Errors.AWAITING_APPROVAL);
        }
    }
}
