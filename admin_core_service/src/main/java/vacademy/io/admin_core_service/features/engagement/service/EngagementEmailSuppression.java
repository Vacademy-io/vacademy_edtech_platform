package vacademy.io.admin_core_service.features.engagement.service;

import com.fasterxml.jackson.databind.JsonNode;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.engagement.client.EngagementInternalClients;
import vacademy.io.admin_core_service.features.engagement.spi.Subject;

import java.util.ArrayList;
import java.util.Collection;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import java.util.Set;

/**
 * The engine's view of notification-service's bounce blocklist, the one list that decides whether an
 * address can receive mail. Unblocking an address there makes it usable here again, with no state of
 * its own to keep in sync.
 *
 * <p>A failed lookup reads as "nothing blocked": notification-service still refuses the send itself,
 * so an outage costs one FAILED action, never a mail to a blocked address or a stalled sweep.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class EngagementEmailSuppression {

    static final String BOUNCED_REASON =
            "This email address bounced, so nothing was sent. Update the address or use another channel.";

    private static final int LOOKUP_PAGE = 500;

    private final EngagementInternalClients clients;

    /** The given addresses that are blocked, lowercase. */
    public Set<String> blocked(Collection<String> emails) {
        List<String> distinct = emails.stream()
                .filter(Objects::nonNull)
                .map(e -> e.trim().toLowerCase(Locale.ROOT))
                .filter(e -> !e.isEmpty())
                .distinct()
                .toList();
        Set<String> out = new HashSet<>();
        try {
            for (int i = 0; i < distinct.size(); i += LOOKUP_PAGE) {
                List<String> page = new ArrayList<>(distinct.subList(i, Math.min(i + LOOKUP_PAGE, distinct.size())));
                JsonNode blocked = clients.blockedEmails(page).path("blocked");
                blocked.forEach(e -> out.add(e.asText().toLowerCase(Locale.ROOT)));
            }
        } catch (Exception e) {
            log.warn("Bounce blocklist lookup failed, treating {} address(es) as not blocked: {}",
                    distinct.size(), e.getMessage());
            return Set.of();
        }
        return out;
    }

    public boolean isBlocked(String email) {
        return email != null && !blocked(List.of(email)).isEmpty();
    }

    /** Flags the subjects whose address is blocked. The address stays: the ledger matches history on it. */
    public void markBounced(List<Subject> subjects) {
        Set<String> blocked = blocked(subjects.stream().map(Subject::getEmail).toList());
        if (blocked.isEmpty()) return;
        for (Subject s : subjects) {
            if (isListed(s.getEmail(), blocked)) s.setEmailUndeliverable(true);
        }
    }

    static boolean isListed(String email, Set<String> blocked) {
        return email != null && blocked.contains(email.trim().toLowerCase(Locale.ROOT));
    }
}
