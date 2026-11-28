package vacademy.io.auth_service.feature.panel.phase2.licence;

import org.springframework.stereotype.Component;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.LicenceUsageResponse;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.LicenceUsageRow;
import vacademy.io.auth_service.feature.panel.dto.PanelDtos.PartnerRoomCount;
import vacademy.io.auth_service.feature.panel.phase2.PanelPhase2Properties;
import vacademy.io.auth_service.feature.panel.phase2.licence.PanelLicenceRepository.EventRow;
import vacademy.io.auth_service.feature.panel.phase2.licence.PanelLicenceRepository.GrantRow;
import vacademy.io.auth_service.feature.panel.service.PanelApiException;
import vacademy.io.auth_service.feature.panel.service.PanelTx;

import java.sql.Timestamp;
import java.time.DateTimeException;
import java.time.Instant;
import java.time.YearMonth;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.regex.Pattern;

/**
 * Monthly seat counts for platform staff. Counts only: nothing here knows or computes money.
 *
 * <ul>
 * <li>seats_granted_peak: the largest total of granted seats at any one moment in the month, up to
 * now (grace days not included; a cancelled grant counts until it was cancelled). A grant ending at
 * the moment the next one starts is never added to it.</li>
 * <li>licensed_rooms_peak and licensed_room_days: from the seat history (panel_licence_event). A
 * room counts for a day when it held a seat at any moment of that day.</li>
 * <li>active_licensed_rooms: rooms that held a seat on at least one day of the month and had at
 * least one counted session in it (panel_seen_at set).</li>
 * <li>rooms_by_partner: those active rooms grouped by the attribution recorded with the room's
 * latest seat assignment.</li>
 * </ul>
 * Days are local days in the requested zone. In the current month only days that have started count.
 */
@Component
public class PanelLicenceUsageService {

    private static final Pattern MONTH = Pattern.compile("\\d{4}-\\d{2}");
    private static final String DEFAULT_ZONE = "Asia/Kolkata";
    private static final int MAX_INSTITUTES = 5000;

    private final PanelLicenceRepository seats;
    private final PanelLicenceService licence;
    private final PanelPhase2Properties properties;
    private final PanelTx tx;

    public PanelLicenceUsageService(PanelLicenceRepository seats, PanelLicenceService licence,
            PanelPhase2Properties properties, PanelTx tx) {
        this.seats = seats;
        this.licence = licence;
        this.properties = properties;
        this.tx = tx;
    }

    /** A half-open interval [from, to). */
    record Span(Instant from, Instant to) {
        boolean overlaps(Instant start, Instant end) {
            return from.isBefore(end) && to.isAfter(start);
        }
    }

    public LicenceUsageResponse usage(String month, String zone) {
        properties.requireLicence();
        if (month == null || !MONTH.matcher(month).matches()) {
            throw PanelApiException.badRequest("month must look like 2026-11");
        }
        YearMonth ym;
        try {
            ym = YearMonth.parse(month);
        } catch (DateTimeException e) {
            throw PanelApiException.badRequest("month must look like 2026-11");
        }
        ZoneId zoneId = zone(zone);
        Instant from = ym.atDay(1).atStartOfDay(zoneId).toInstant();
        Instant to = ym.plusMonths(1).atDay(1).atStartOfDay(zoneId).toInstant();
        return tx.run(() -> {
            Instant now = seats.dbNow().toInstant();
            List<Span> days = days(ym, zoneId, now);
            List<LicenceUsageRow> rows = new ArrayList<>();
            for (String instituteId : seats.institutesForMonth(Timestamp.from(from), Timestamp.from(to),
                    MAX_INSTITUTES)) {
                rows.add(row(instituteId, from, to, days, now));
            }
            return new LicenceUsageResponse(month, rows);
        });
    }

    static ZoneId zone(String raw) {
        if (raw == null || raw.isBlank() || raw.length() > 64) {
            return ZoneId.of(DEFAULT_ZONE);
        }
        try {
            return ZoneId.of(raw.trim());
        } catch (DateTimeException e) {
            return ZoneId.of(DEFAULT_ZONE);
        }
    }

    /** The month's local days that have started by now. */
    static List<Span> days(YearMonth month, ZoneId zone, Instant now) {
        List<Span> days = new ArrayList<>();
        for (int d = 1; d <= month.lengthOfMonth(); d++) {
            Instant start = month.atDay(d).atStartOfDay(zone).toInstant();
            if (!start.isBefore(now)) {
                break;
            }
            days.add(new Span(start, month.atDay(d).plusDays(1).atStartOfDay(zone).toInstant()));
        }
        return days;
    }

    private LicenceUsageRow row(String instituteId, Instant from, Instant to, List<Span> days, Instant now) {
        List<GrantRow> grants = seats.listGrants(instituteId);
        List<EventRow> events = seats.eventsBefore(instituteId, Timestamp.from(to));
        Set<String> counted = new HashSet<>(seats.roomsWithCountedSessions(instituteId, Timestamp.from(from),
                Timestamp.from(to)));
        PanelLicenceService.Snapshot current = licence.snapshot(instituteId);
        Counts counts = counts(grants, events, counted, days, now);
        return new LicenceUsageRow(instituteId, rowPartner(grants, from, to), current.result().enforcement(),
                current.result().state(), counts.seatsPeak(), counts.roomsPeak(), counts.roomDays(),
                counts.activeRooms(), counts.byPartner());
    }

    record Counts(int seatsPeak, int roomsPeak, int roomDays, int activeRooms, List<PartnerRoomCount> byPartner) {
    }

    /** Pure, for tests: the counts from the rows. */
    static Counts counts(List<GrantRow> grants, List<EventRow> events, Set<String> roomsWithSessions,
            List<Span> days, Instant now) {
        List<Span> grantSpans = new ArrayList<>();
        List<Integer> grantSeats = new ArrayList<>();
        for (GrantRow grant : grants) {
            Instant end = grant.endsAt().toInstant();
            if (grant.cancelledAt() != null && grant.cancelledAt().toInstant().isBefore(end)) {
                end = grant.cancelledAt().toInstant();
            }
            Instant start = grant.startsAt().toInstant();
            if (end.isAfter(start)) {
                grantSpans.add(new Span(start, end));
                grantSeats.add(grant.seats());
            }
        }

        Map<String, List<Span>> licensed = new LinkedHashMap<>();
        Map<String, Instant> openSince = new HashMap<>();
        Map<String, String> attribution = new HashMap<>();
        for (EventRow event : events) {
            String room = event.roomId();
            Instant at = event.at().toInstant();
            if ("ASSIGNED".equals(event.action())) {
                openSince.putIfAbsent(room, at);
                attribution.put(room, event.partnerId());
            } else if (openSince.containsKey(room)) {
                licensed.computeIfAbsent(room, r -> new ArrayList<>()).add(new Span(openSince.remove(room), at));
            }
        }
        for (Map.Entry<String, Instant> open : openSince.entrySet()) {
            Instant start = open.getValue();
            Instant end = now.isAfter(start) ? now : start.plusMillis(1);
            licensed.computeIfAbsent(open.getKey(), r -> new ArrayList<>()).add(new Span(start, end));
        }

        int seatsPeak = seatsPeak(grantSpans, grantSeats, days, now);
        int roomsPeak = 0;
        int roomDays = 0;
        Set<String> licensedInMonth = new HashSet<>();
        for (Span day : days) {
            int dayRooms = 0;
            for (Map.Entry<String, List<Span>> room : licensed.entrySet()) {
                if (room.getValue().stream().anyMatch(span -> span.overlaps(day.from(), day.to()))) {
                    dayRooms++;
                    licensedInMonth.add(room.getKey());
                }
            }
            roomsPeak = Math.max(roomsPeak, dayRooms);
            roomDays += dayRooms;
        }

        Map<String, Integer> byPartner = new TreeMap<>();
        int active = 0;
        for (String room : licensedInMonth) {
            if (!roomsWithSessions.contains(room)) {
                continue;
            }
            active++;
            String partner = attribution.get(room);
            if (partner != null) {
                byPartner.merge(partner, 1, Integer::sum);
            }
        }
        List<PartnerRoomCount> partners = byPartner.entrySet().stream()
                .map(entry -> new PartnerRoomCount(entry.getKey(), entry.getValue()))
                .toList();
        return new Counts(seatsPeak, roomsPeak, roomDays, active, partners);
    }

    /**
     * The largest sum of seats granted at the same instant within [first day's start, min(last day's
     * end, now)). At an instant where one grant ends and another starts, the end is applied first.
     */
    static int seatsPeak(List<Span> spans, List<Integer> spanSeats, List<Span> days, Instant now) {
        if (days.isEmpty()) {
            return 0;
        }
        Instant winFrom = days.get(0).from();
        Instant lastEnd = days.get(days.size() - 1).to();
        Instant winTo = now.isBefore(lastEnd) ? now : lastEnd;
        List<Map.Entry<Instant, Integer>> points = new ArrayList<>();
        for (int i = 0; i < spans.size(); i++) {
            Span span = spans.get(i);
            Instant from = span.from().isAfter(winFrom) ? span.from() : winFrom;
            Instant to = span.to().isBefore(winTo) ? span.to() : winTo;
            if (from.isBefore(to)) {
                points.add(Map.entry(from, spanSeats.get(i)));
                points.add(Map.entry(to, -spanSeats.get(i)));
            }
        }
        points.sort(Map.Entry.<Instant, Integer>comparingByKey()
                .thenComparing(entry -> entry.getValue() < 0 ? 0 : 1));
        int running = 0;
        int peak = 0;
        for (Map.Entry<Instant, Integer> point : points) {
            running += point.getValue();
            peak = Math.max(peak, running);
        }
        return peak;
    }

    /** The partner on the latest-starting grant of the month that names one, else null. */
    static String rowPartner(List<GrantRow> grants, Instant from, Instant to) {
        String partner = null;
        Instant latest = null;
        for (GrantRow grant : grants) {
            Span span = new Span(grant.startsAt().toInstant(), grant.endsAt().toInstant());
            if (grant.partnerId() != null && span.overlaps(from, to)
                    && (latest == null || span.from().isAfter(latest))) {
                latest = span.from();
                partner = grant.partnerId();
            }
        }
        return partner;
    }
}
