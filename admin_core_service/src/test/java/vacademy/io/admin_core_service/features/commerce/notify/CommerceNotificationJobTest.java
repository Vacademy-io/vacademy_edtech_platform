package vacademy.io.admin_core_service.features.commerce.notify;

import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.commerce.notify.repository.CommerceNotificationStore;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicLong;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * The job never outlives its lock (a second pod would start the job while a send is still
 * running), and the messages stay off until they are deliberately turned on.
 */
class CommerceNotificationJobTest {

    private static CommerceNotificationStore.DeliveryRow row(int i) {
        return new CommerceNotificationStore.DeliveryRow("dl-" + i, "ev-" + i, "inst-" + i, "order-" + i,
                "ORDER_SHIPPED", "", "WHATSAPP", "hi", "PENDING", null, 0, false);
    }

    @Test
    void theLockCoversTheLastSendItStartsAtItsWorstCase() throws Exception {
        SchedulerLock lock = CommerceNotificationJob.class.getMethod("run").getAnnotation(SchedulerLock.class);
        assertEquals(CommerceNotificationJob.LOCK_AT_MOST, Duration.parse(lock.lockAtMostFor()));
        assertEquals(Duration.ofMinutes(2), CommerceNotificationJob.LOCK_AT_MOST);
        // Two calls (template read, send), each at most a 10 s connect and a 30 s read.
        assertTrue(CommerceNotificationJob.WORST_CASE_SEND.compareTo(Duration.ofSeconds(2 * (10 + 30))) >= 0);
        assertTrue(CommerceNotificationJob.BUDGET.plus(CommerceNotificationJob.WORST_CASE_SEND)
                .plus(CommerceNotificationJob.MARGIN).compareTo(CommerceNotificationJob.LOCK_AT_MOST) <= 0);
        assertTrue(Duration.parse(lock.lockAtLeastFor()).compareTo(CommerceNotificationJob.LOCK_AT_MOST) < 0);
    }

    @Test
    void noSendStartsOnceTheBudgetOrTheLockCannotCoverAnotherWorstCaseSend() {
        AtomicLong now = new AtomicLong(1_000_000L);
        CommerceNotificationStore store = mock(CommerceNotificationStore.class);
        CommerceNotificationDispatcher dispatcher = mock(CommerceNotificationDispatcher.class);
        List<CommerceNotificationStore.DeliveryRow> due = new ArrayList<>();
        for (int i = 0; i < 20; i++) {
            due.add(row(i));
        }
        when(store.dueEvents(anyInt())).thenReturn(List.of());
        when(store.dueDeliveries(anyInt())).thenReturn(due);
        when(dispatcher.enabled()).thenReturn(true);
        List<Long> startedAt = new ArrayList<>();
        long begin = now.get();
        // Each send hangs on a slow platform for 9 s.
        when(dispatcher.send(anyString())).thenAnswer(call -> {
            startedAt.add(now.get() - begin);
            now.addAndGet(9_000);
            return CommerceNotificationDispatcher.Result.UNKNOWN;
        });
        CommerceNotificationJob job = new CommerceNotificationJob(store, dispatcher, now::get);

        Map<String, Integer> counts = job.runOnce();

        assertEquals(List.of(0L, 9_000L, 18_000L), startedAt);
        assertEquals(3, counts.get("send_unknown"));
        long lastStart = startedAt.get(startedAt.size() - 1);
        assertTrue(lastStart + CommerceNotificationJob.WORST_CASE_SEND.toMillis()
                <= CommerceNotificationJob.LOCK_AT_MOST.toMillis());
    }

    @Test
    void theStartRuleItself() {
        AtomicLong now = new AtomicLong(0);
        CommerceNotificationJob job = new CommerceNotificationJob(mock(CommerceNotificationStore.class),
                mock(CommerceNotificationDispatcher.class), now::get);
        assertTrue(job.canStartSend(0));
        now.set(CommerceNotificationJob.BUDGET.toMillis() - 1);
        assertTrue(job.canStartSend(0));
        now.set(CommerceNotificationJob.BUDGET.toMillis());
        assertFalse(job.canStartSend(0));
        now.set(CommerceNotificationJob.LOCK_AT_MOST.toMillis() - CommerceNotificationJob.WORST_CASE_SEND.toMillis());
        assertFalse(job.canStartSend(0));
    }

    @Test
    void messagesAreOffUnlessDeliberatelyTurnedOn() throws Exception {
        String properties = Files.readString(Path.of("src/main/resources/application.properties"));
        assertTrue(properties.contains(
                "\ncommerce.notifications.enabled=${COMMERCE_NOTIFICATIONS_ENABLED:false}\n"), "the default is off");
        var constructor = CommerceNotificationDispatcher.class.getConstructors()[0];
        boolean found = false;
        for (var parameter : constructor.getParameters()) {
            var value = parameter.getAnnotation(org.springframework.beans.factory.annotation.Value.class);
            if (value != null && value.value().startsWith("${commerce.notifications.enabled")) {
                assertEquals("${commerce.notifications.enabled:false}", value.value());
                found = true;
            }
        }
        assertTrue(found);
    }
}
