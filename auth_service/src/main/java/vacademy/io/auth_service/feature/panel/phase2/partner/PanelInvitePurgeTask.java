package vacademy.io.auth_service.feature.panel.phase2.partner;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import vacademy.io.auth_service.feature.panel.phase2.PanelPhase2Properties;
import vacademy.io.auth_service.feature.panel.phase2.PanelPurgeTask;

/**
 * Marks unredeemed codes past their expiry as EXPIRED, and deletes codes of any state once they are
 * panel.partners.invite-keep-days (default 30) past expiry. Does nothing while panel.partners.enabled
 * is false.
 */
@Component
public class PanelInvitePurgeTask implements PanelPurgeTask {

    private final PanelPartnerRepository partners;
    private final PanelPhase2Properties phase2;
    private final int keepDays;

    public PanelInvitePurgeTask(PanelPartnerRepository partners, PanelPhase2Properties phase2,
            @Value("${panel.partners.invite-keep-days:30}") int keepDays) {
        this.partners = partners;
        this.phase2 = phase2;
        this.keepDays = Math.max(0, keepDays);
    }

    @Override
    public int purge(int limit) {
        if (!phase2.isPartnersEnabled()) {
            return 0;
        }
        partners.markExpiredInvites(limit);
        return partners.purgeOldInvites(keepDays, limit);
    }
}
