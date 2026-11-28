package vacademy.io.auth_service.feature.panel.phase2.usage;

import org.springframework.stereotype.Component;
import vacademy.io.auth_service.feature.panel.phase2.PanelPhase2Properties;
import vacademy.io.auth_service.feature.panel.phase2.PanelPurgeTask;

/**
 * Deletes panel_activity events older than panel.activity.retention-days, one bounded batch at a
 * time, from PanelMaintenance. panel_session rows are kept, as in phase 1.
 */
@Component
public class PanelActivityPurgeTask implements PanelPurgeTask {

    private final PanelUsageRepository repository;
    private final PanelPhase2Properties phase2;

    public PanelActivityPurgeTask(PanelUsageRepository repository, PanelPhase2Properties phase2) {
        this.repository = repository;
        this.phase2 = phase2;
    }

    @Override
    public int purge(int limit) {
        if (limit <= 0) {
            return 0;
        }
        return repository.purgeActivity(phase2.getActivityRetentionDays(), limit);
    }
}
