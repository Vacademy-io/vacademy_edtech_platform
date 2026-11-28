package vacademy.io.admin_core_service.features.timeline.service;

import vacademy.io.admin_core_service.features.timeline.entity.TimelineEvent;

/**
 * Told about every timeline event as it is saved (notes, follow-ups, status and owner changes,
 * calls...). Runs inside the writer's transaction, so an implementation must be quick, must not
 * write, and should defer real work until after commit. Its failures are logged and swallowed:
 * a hook can never fail the CRM write.
 */
public interface TimelineEventHook {

    void onEventSaved(TimelineEvent event);
}
