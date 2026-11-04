package vacademy.io.admin_core_service.features.engagement.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementMember;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementActionRepository;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementMemberRepository;
import vacademy.io.admin_core_service.features.engagement.spi.Subject;

import java.time.Instant;
import java.util.List;
import java.util.Set;

/**
 * An address can bounce after an email to it was already drafted or scheduled, and older drafts were
 * written for people with no address at all. This cancels those unsent emails with the reason, so
 * nobody is asked to approve a mail that cannot arrive and an auto-send does not sit waiting for its
 * time. The person stays a member: other channels still work.
 */
@Component
@Slf4j
@RequiredArgsConstructor
public class EngagementBouncedEmailJob {

    static final String NO_ADDRESS_REASON =
            "There is no email address on file for this person, so this email cannot be sent.";

    private final EngagementMemberRepository memberRepository;
    private final EngagementActionRepository actionRepository;
    private final ContactResolver contactResolver;
    private final EngagementEmailSuppression emailSuppression;

    @Scheduled(fixedDelayString = "${engagement.bounced-email.delay-ms:900000}",
            initialDelayString = "${engagement.bounced-email.initial-delay-ms:120000}")
    @SchedulerLock(name = "EngagementBouncedEmail", lockAtMostFor = "PT10M", lockAtLeastFor = "PT10S")
    public void sweep() {
        Instant now = Instant.now();
        int cancelled = 0;
        for (String instituteId : memberRepository.institutesWithLiveEngines()) {
            try {
                cancelled += sweepInstitute(instituteId, now);
            } catch (Exception e) {
                // One institute's hiccup must not stall the others; the next run looks again.
                log.warn("Bounced email sweep failed for institute {}: {}", instituteId, e.getMessage());
            }
        }
        if (cancelled > 0) log.info("Bounced email sweep: {} unsent email(s) cancelled", cancelled);
    }

    int sweepInstitute(String instituteId, Instant now) {
        List<String> memberIds = actionRepository.memberIdsWithUnsentEmails(instituteId);
        if (memberIds.isEmpty()) return 0;
        List<EngagementMember> members = memberRepository.findAllById(memberIds);
        List<Subject> subjects = contactResolver.resolve(members);
        Set<String> blocked = emailSuppression.blocked(subjects.stream().map(Subject::getEmail).toList());
        List<String> bounced = subjects.stream()
                .filter(s -> EngagementEmailSuppression.isListed(s.getEmail(), blocked))
                .map(Subject::getMemberId)
                .toList();
        List<String> noAddress = subjects.stream()
                .filter(s -> s.getEmail() == null || s.getEmail().isBlank())
                .map(Subject::getMemberId)
                .toList();
        int cancelled = 0;
        if (!bounced.isEmpty()) {
            cancelled += actionRepository.cancelUnsentEmails(bounced, EngagementEmailSuppression.BOUNCED_REASON, now);
        }
        if (!noAddress.isEmpty()) {
            cancelled += actionRepository.cancelUnsentEmails(noAddress, NO_ADDRESS_REASON, now);
        }
        return cancelled;
    }
}
