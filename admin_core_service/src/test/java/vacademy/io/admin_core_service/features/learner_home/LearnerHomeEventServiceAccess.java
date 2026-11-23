package vacademy.io.admin_core_service.features.learner_home;

import java.lang.reflect.Method;
import java.time.Instant;

/** Reaches the package-private clamp of the event service from this test package. */
final class LearnerHomeEventServiceAccess {

    private LearnerHomeEventServiceAccess() {
    }

    static Instant clamp(Instant ts, Instant now) {
        try {
            Method m = vacademy.io.admin_core_service.features.learner_home.analytics.LearnerHomeEventService.class
                    .getDeclaredMethod("clamp", Instant.class, Instant.class);
            m.setAccessible(true);
            return (Instant) m.invoke(null, ts, now);
        } catch (ReflectiveOperationException e) {
            throw new IllegalStateException(e);
        }
    }
}
