package vacademy.io.notification_service.features.email_sending_controls.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.notification_service.features.email_sending_controls.entity.DeferredEmail;
import vacademy.io.notification_service.features.email_sending_controls.repository.DeferredEmailRepository;
import vacademy.io.notification_service.service.EmailService;

import java.time.LocalDateTime;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Every minute, replays due deferred emails through the normal send path. The send
 * path re-checks the cap; when a sender's cap is hit mid-drain, every remaining due
 * row of that sender is pushed to the next window in one statement rather than
 * being visited one by one.
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class DeferredEmailDrainer {

    private static final int BATCH = 200;
    private static final int MAX_ATTEMPTS = 5;

    private final DeferredEmailRepository repository;
    private final DeferredEmailService deferredEmailService;
    private final EmailService emailService;

    @Scheduled(fixedDelayString = "${email.deferred.drain.interval.ms:60000}", initialDelay = 30000)
    @Transactional
    public void drain() {
        LocalDateTime now = LocalDateTime.now();
        List<DeferredEmail> due = repository.lockDue(now, BATCH);
        if (due.isEmpty()) return;
        log.info("Draining {} deferred email(s)", due.size());
        Set<String> exhausted = new HashSet<>();
        for (DeferredEmail d : due) {
            if (exhausted.contains(d.getSenderKey())) continue;
            d.setAttempts(d.getAttempts() + 1);
            try {
                EmailService.SendOutcome outcome = emailService.sendDeferred(d, deferredEmailService.ccOf(d));
                switch (outcome) {
                    case DEFERRED -> {
                        // Cap still reached for this sender: push the whole sender's due backlog.
                        exhausted.add(d.getSenderKey());
                        LocalDateTime next = emailService.nextWindowFor(d.getInstituteId(), d.getEmailType());
                        d.setSendAfter(next);
                        d.setAttempts(d.getAttempts() - 1); // not a real attempt
                        int moved = repository.pushBack(d.getSenderKey(), now, next);
                        log.info("Sender {} still capped; pushed {} deferred row(s) to {}", d.getSenderKey(), moved, next);
                    }
                    case SENT -> d.setStatus("SENT");
                    default -> { d.setStatus("CANCELLED"); d.setLastError(outcome.name()); }
                }
            } catch (Exception ex) {
                d.setLastError(ex.getMessage());
                if (d.getAttempts() >= MAX_ATTEMPTS) d.setStatus("FAILED");
                else d.setSendAfter(now.plusMinutes(15L * d.getAttempts()));
                log.warn("Deferred email {} failed (attempt {}): {}", d.getId(), d.getAttempts(), ex.getMessage());
            }
            repository.save(d);
        }
    }
}
