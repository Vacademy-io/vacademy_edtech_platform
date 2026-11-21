package vacademy.io.auth_service.feature.panel.phase2;

/**
 * Seam: a bounded cleanup batch that PanelMaintenance runs with its own, at most once a minute per
 * pod, from pair/start and challenge create. Any number of beans may implement this; there is no
 * placeholder to delete. A task deletes at most {@code limit} rows, never throws for an empty batch,
 * and makes no HTTP call. A failure is logged and the other tasks still run.
 */
public interface PanelPurgeTask {

    /** @return rows deleted */
    int purge(int limit);
}
