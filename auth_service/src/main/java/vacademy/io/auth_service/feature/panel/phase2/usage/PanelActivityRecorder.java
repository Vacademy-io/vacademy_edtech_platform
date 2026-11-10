package vacademy.io.auth_service.feature.panel.phase2.usage;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.stereotype.Component;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.ActivityEvent;
import vacademy.io.auth_service.feature.panel.phase2.PanelActivityIngest;
import vacademy.io.auth_service.feature.panel.phase2.usage.PanelUsageRepository.NewEvent;
import vacademy.io.auth_service.feature.panel.repository.PanelRepository.DeviceRow;
import vacademy.io.auth_service.feature.panel.repository.PanelRepository.SessionRow;
import vacademy.io.auth_service.feature.panel.service.PanelSecrets;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Stores the "what was shown" events a signed-in panel sends on /sync and /session/end.
 *
 * <p>Rules: at most {@link #PER_REQUEST} events are taken from one request and {@link #PER_SESSION}
 * are kept per session; the rest are dropped without an error. An event needs a seq of zero or more
 * and a known kind. ref_id and parent_id longer than {@link #ID_MAX} characters or holding control
 * characters are dropped from the event; titles are cleaned and cut to {@link #TITLE_MAX}. The
 * event's time is clamped into [session start, now] by the database. A repeated (session, seq) is
 * ignored, so a panel that resends after a lost answer stores nothing twice.
 *
 * <p>The ack is the largest seq received in the request, including events dropped by a rule above,
 * because a dropped event would be dropped again. It is not taken from the insert count. When the
 * insert itself fails the ack is null, so the panel keeps its queue and sends it again later; the
 * sync answer is never turned into an error by this.
 *
 * <p>Runs on the request thread with no HTTP call. Events reach no log: only counts and the
 * exception class are logged.
 */
@Component
public class PanelActivityRecorder implements PanelActivityIngest {

    private static final Logger log = LoggerFactory.getLogger(PanelActivityRecorder.class);

    static final int PER_REQUEST = 20;
    static final int PER_SESSION = 100;
    static final int ID_MAX = 64;
    static final int TITLE_MAX = 200;
    /** /session/end may still add events to a session ended this recently. */
    static final int END_GRACE_SECONDS = 10 * 60;
    static final Set<String> KINDS = Set.of("LESSON", "DECK", "DECK_LIVE", "CLASS", "WHITEBOARD", "HOME");
    /** Event times outside this range are treated as "now" before the database clamps them. */
    static final long MAX_AT_MS = 4_102_444_800_000L;

    private final PanelUsageRepository repository;

    public PanelActivityRecorder(PanelUsageRepository repository) {
        this.repository = repository;
    }

    @Override
    public Integer ingestSync(DeviceRow device, SessionRow session, List<ActivityEvent> events) {
        return store(device, session, events);
    }

    @Override
    public void ingestEnd(DeviceRow device, SessionRow session, List<ActivityEvent> events) {
        store(device, session, events);
    }

    private Integer store(DeviceRow device, SessionRow session, List<ActivityEvent> events) {
        if (device == null || session == null || events == null || events.isEmpty()
                || !device.id().equals(session.deviceId())) {
            return null;
        }
        Integer ack = null;
        Set<Integer> seen = new HashSet<>();
        List<NewEvent> clean = new ArrayList<>();
        for (ActivityEvent event : events) {
            if (event == null || event.seq() == null || event.seq() < 0) {
                continue;
            }
            int seq = event.seq();
            ack = ack == null ? seq : Math.max(ack, seq);
            if (clean.size() >= PER_REQUEST || event.kind() == null || !KINDS.contains(event.kind())
                    || !seen.add(seq)) {
                continue;
            }
            clean.add(new NewEvent(seq, event.kind(), cleanId(event.refId()), cleanId(event.parentId()),
                    cleanTitle(event.title()), cleanAt(event.atMs())));
        }
        if (clean.isEmpty()) {
            return ack;
        }
        try {
            repository.insertEvents(session.id(), device.id(), clean, PER_SESSION, END_GRACE_SECONDS);
        } catch (DataAccessException e) {
            log.warn("Panel activity not stored ({} events): {}", clean.size(), e.getClass().getSimpleName());
            return null;
        }
        return ack;
    }

    static String cleanId(String value) {
        if (value == null || value.isEmpty() || value.length() > ID_MAX || PanelSecrets.hasControlChars(value)) {
            return null;
        }
        return value;
    }

    static String cleanTitle(String value) {
        if (value == null) {
            return null;
        }
        StringBuilder out = new StringBuilder(Math.min(value.length(), TITLE_MAX + 1));
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            out.append(c < 0x20 || c == 0x7F ? ' ' : c);
        }
        String title = out.toString().trim();
        if (title.length() > TITLE_MAX) {
            int cut = TITLE_MAX;
            if (Character.isHighSurrogate(title.charAt(cut - 1))) {
                cut--;
            }
            title = title.substring(0, cut).trim();
        }
        return title.isEmpty() ? null : title;
    }

    static Long cleanAt(Long atMs) {
        return atMs == null || atMs <= 0 || atMs > MAX_AT_MS ? null : atMs;
    }
}
