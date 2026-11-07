package vacademy.io.admin_core_service.features.points_ledger.service;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.institute_learner.entity.Student;
import vacademy.io.admin_core_service.features.institute_learner.repository.InstituteStudentRepository;
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionInstituteGroupMappingRepository;
import vacademy.io.admin_core_service.features.learner_badge.repository.LearnerBadgeRepository;
import vacademy.io.admin_core_service.features.points_ledger.dto.PointsOverviewDTO;
import vacademy.io.admin_core_service.features.points_ledger.repository.PointsLedgerRepository;

import java.sql.Timestamp;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.time.temporal.TemporalAdjusters;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;

/** Points and badges earned across some batches, for LMS Gamification and Points. */
@Service
@RequiredArgsConstructor
public class PointsOverviewService {

    private static final List<String> ACTIVE = List.of("ACTIVE");
    private static final int MAX_SCOPE_BATCHES = 5000;
    private static final int DAILY_UP_TO_DAYS = 14;
    private static final int WEEKLY_UP_TO_DAYS = 120;
    private static final int TOP_EARNERS = 10;
    private static final int RECENT_BADGES = 12;

    private final PointsLedgerRepository pointsLedgerRepository;
    private final LearnerBadgeRepository learnerBadgeRepository;
    private final StudentSessionInstituteGroupMappingRepository mappingRepository;
    private final InstituteStudentRepository studentRepository;

    @Transactional(readOnly = true)
    public PointsOverviewDTO getOverview(String instituteId, List<String> packageSessionIds,
                                         LocalDate start, LocalDate end) {
        List<String> batches = packageSessionIds == null || packageSessionIds.isEmpty()
                ? mappingRepository.findDistinctPackageSessionIdsByInstituteAndStatus(instituteId, ACTIVE, MAX_SCOPE_BATCHES)
                : packageSessionIds;
        long days = ChronoUnit.DAYS.between(start, end) + 1;
        String unit = days <= DAILY_UP_TO_DAYS ? "day" : days <= WEEKLY_UP_TO_DAYS ? "week" : "month";
        Map<LocalDate, PointsOverviewDTO.Period> periods = new TreeMap<>();
        for (LocalDate d = start; !d.isAfter(end); d = d.plusDays(1)) {
            PointsOverviewDTO.Period period = periods.computeIfAbsent(periodStart(d, unit),
                    k -> new PointsOverviewDTO.Period(null, null, 0, 0));
            if (period.getStart() == null) period.setStart(d.toString());
            period.setEnd(d.toString());
        }
        PointsOverviewDTO.PointsOverviewDTOBuilder out = PointsOverviewDTO.builder()
                .granularity(unit.toUpperCase())
                .periods(new ArrayList<>(periods.values()))
                .sources(List.of())
                .topEarners(List.of())
                .badges(List.of())
                .recentBadges(List.of());
        if (batches.isEmpty()) return out.build();

        Timestamp from = Timestamp.valueOf(start.atStartOfDay());
        Timestamp to = Timestamp.valueOf(end.atTime(23, 59, 59));

        for (Object[] r : pointsLedgerRepository.pointsByPeriodForBatches(unit, instituteId, batches, from, to)) {
            PointsOverviewDTO.Period period = periods.get(rowDate(r[0]));
            if (period != null) period.setPoints(longOf(r[1]));
        }
        for (Object[] r : learnerBadgeRepository.badgesByPeriodForBatches(unit, instituteId, batches, from, to)) {
            PointsOverviewDTO.Period period = periods.get(rowDate(r[0]));
            if (period != null) period.setBadges(longOf(r[1]));
        }

        List<Object[]> earners = pointsLedgerRepository.earnersForBatches(instituteId, batches, from, to);
        List<Object[]> topEarners = earners.subList(0, Math.min(TOP_EARNERS, earners.size()));
        List<Object[]> recent = learnerBadgeRepository.recentBadgesForBatches(instituteId, batches, from, to, RECENT_BADGES);
        Set<String> named = new LinkedHashSet<>();
        topEarners.forEach(r -> named.add(r[0].toString()));
        recent.forEach(r -> named.add(r[0].toString()));
        Map<String, String> names = learnerNames(named);

        List<Object[]> badges = learnerBadgeRepository.topBadgesForBatches(instituteId, batches, from, to);
        return out
                .totalPoints(earners.stream().mapToLong(r -> longOf(r[1])).sum())
                .learnersEarning(earners.size())
                .badgesAwarded(badges.stream().mapToLong(r -> longOf(r[2])).sum())
                .learnersWithBadge(learnerBadgeRepository.countLearnersWithBadgeForBatches(instituteId, batches, from, to))
                .sources(pointsLedgerRepository.pointsBySourceForBatches(instituteId, batches, from, to).stream()
                        .map(r -> new PointsOverviewDTO.Source(r[0].toString(),
                                PointsLedgerService.sourceLabel(r[0].toString()), longOf(r[1])))
                        .toList())
                .topEarners(topEarners.stream()
                        .map(r -> new PointsOverviewDTO.Earner(r[0].toString(),
                                names.getOrDefault(r[0].toString(), "Learner"), longOf(r[1])))
                        .toList())
                .badges(badges.stream()
                        .map(r -> new PointsOverviewDTO.BadgeRow(r[0] == null ? "Badge" : r[0].toString(),
                                r[1] == null ? null : r[1].toString(), longOf(r[2]), longOf(r[3])))
                        .toList())
                .recentBadges(recent.stream()
                        .map(r -> new PointsOverviewDTO.RecentBadge(r[0].toString(),
                                names.getOrDefault(r[0].toString(), "Learner"),
                                r[1] == null ? "Badge" : r[1].toString(),
                                r[2] == null ? null : r[2].toString(),
                                r[3] instanceof Timestamp t ? t : null))
                        .toList())
                .build();
    }

    private Map<String, String> learnerNames(Set<String> userIds) {
        Map<String, String> names = new HashMap<>();
        if (userIds.isEmpty()) return names;
        for (Student s : studentRepository.findByUserIdIn(new ArrayList<>(userIds))) {
            if (StringUtils.hasText(s.getFullName())) names.putIfAbsent(s.getUserId(), s.getFullName());
        }
        return names;
    }

    /** The day, the Monday of its week or the first of its month, matching Postgres date_trunc. */
    private static LocalDate periodStart(LocalDate date, String unit) {
        return switch (unit) {
            case "week" -> date.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
            case "month" -> date.withDayOfMonth(1);
            default -> date;
        };
    }

    private static LocalDate rowDate(Object value) {
        return LocalDate.parse(value.toString().substring(0, 10));
    }

    private static long longOf(Object value) {
        return value == null ? 0L : ((Number) value).longValue();
    }
}
