package vacademy.io.admin_core_service.features.classroom.notify;

import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.Instant;

/**
 * Hourly classroom panel notify tick: the daily alert digest and the weekly
 * WhatsApp summary, each sent at the hour an institute chose in its own zone.
 *
 * Off unless {@code classroom.notify.enabled=true}. While off, the tick returns
 * before reading anything.
 *
 * <p>{@code @SchedulerLock} keeps the tick to one pod at a time; the unique key on
 * {@code classroom_notice_log} is what guarantees a notice is sent once even if
 * two ticks did overlap. Both are needed.
 *
 * <p>Runs at five past the hour, clear of the report tick on the hour.
 */
@Component
@Slf4j
public class ClassroomNotifyJob {

    static final String ENABLED_PROPERTY = "${classroom.notify.enabled:false}";

    private final ClassroomNotifyService service;
    private final boolean enabled;
    private final Clock clock;

    @Autowired
    public ClassroomNotifyJob(ClassroomNotifyService service,
                              @Value(ENABLED_PROPERTY) boolean enabled) {
        this(service, enabled, Clock.systemUTC());
    }

    ClassroomNotifyJob(ClassroomNotifyService service, boolean enabled, Clock clock) {
        this.service = service;
        this.enabled = enabled;
        this.clock = clock;
    }

    @Scheduled(cron = "0 5 * * * ?")
    @SchedulerLock(name = "ClassroomNotifyTick", lockAtMostFor = "PT50M", lockAtLeastFor = "PT30S")
    public void tick() {
        if (!enabled) return;
        Instant now = clock.instant();
        try {
            service.runTick(now);
        } catch (Exception e) {
            log.error("[classroom] notify tick aborted", e);
        }
    }

    boolean isEnabled() {
        return enabled;
    }
}
