package vacademy.io.admin_core_service.features.live_session.provider.service.google;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.live_session.entity.SessionSchedule;
import vacademy.io.admin_core_service.features.live_session.provider.dto.google.GoogleAccount;
import vacademy.io.admin_core_service.features.live_session.provider.manager.GoogleMeetManager;
import vacademy.io.admin_core_service.features.live_session.provider.manager.GoogleMeetManager.CohostResult;
import vacademy.io.admin_core_service.features.live_session.repository.SessionScheduleRepository;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.TimeUnit;

/**
 * Makes a class's instructors co-hosts of the Meet spaces it already has, for when the
 * instructors change after the spaces were created (editing an existing class). New spaces get
 * their co-hosts in {@code GoogleMeetManager.createMeeting}.
 *
 * <p>Without this, a teacher assigned later would only be added at their first "Start as host",
 * about a second before Meet opens. Google has not applied the role by then, so they join as a
 * participant and only become co-host on the next join.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class GoogleMeetCohostSyncService {

    /** A day of slack so a class later today in another timezone is not skipped. */
    private static final long PAST_SLACK_MS = TimeUnit.DAYS.toMillis(1);

    private final SessionScheduleRepository scheduleRepository;
    private final GoogleAccountStore googleAccountStore;
    private final GoogleMeetManager googleMeetManager;

    /**
     * Best-effort and async: one members call per space per instructor, so a long recurring class
     * would otherwise hold up the step-2 save. Adding someone who already is a co-host is a 409,
     * which counts as done.
     */
    @Async
    public void addCohostsToUpcomingSpaces(String sessionId) {
        if (sessionId == null) return;
        try {
            long cutoff = System.currentTimeMillis() - PAST_SLACK_MS;
            List<SessionSchedule> spaces = scheduleRepository.findBySessionId(sessionId).stream()
                    .filter(s -> s.getProviderMeetingId() != null && s.getProviderMeetingId().startsWith("spaces/"))
                    .filter(s -> s.getProviderAccountId() != null)
                    .filter(s -> s.getMeetingDate() == null || s.getMeetingDate().getTime() >= cutoff)
                    .toList();
            if (spaces.isEmpty()) return;

            List<String> emails = googleMeetManager.sessionCohostEmails(sessionId);
            if (emails.isEmpty()) return;

            Map<String, Optional<GoogleAccount>> accounts = new HashMap<>();
            int added = 0;
            int failed = 0;
            for (SessionSchedule schedule : spaces) {
                GoogleAccount account = accounts
                        .computeIfAbsent(schedule.getProviderAccountId(), googleAccountStore::findById)
                        .orElse(null);
                if (account == null) continue; // a Zoom/other account, or a disconnected one
                for (String email : emails) {
                    CohostResult result = googleMeetManager.ensureCohost(account, schedule.getProviderMeetingId(), email);
                    if (result == CohostResult.ADDED) added++;
                    if (result == CohostResult.FAILED) failed++;
                }
            }
            log.info("google.meet.cohost.sync sessionId={} spaces={} people={} added={} failed={}",
                    sessionId, spaces.size(), emails.size(), added, failed);
        } catch (Exception e) {
            log.warn("google.meet.cohost.sync.fail sessionId={} reason={}", sessionId, e.getMessage());
        }
    }
}
