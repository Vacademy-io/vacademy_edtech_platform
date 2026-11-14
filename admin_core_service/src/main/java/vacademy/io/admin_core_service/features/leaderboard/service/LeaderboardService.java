package vacademy.io.admin_core_service.features.leaderboard.service;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.leaderboard.dto.BadgeStatDTO;
import vacademy.io.admin_core_service.features.leaderboard.dto.BadgeStatsResponseDTO;
import vacademy.io.admin_core_service.features.leaderboard.dto.LeaderboardBadgeDTO;
import vacademy.io.admin_core_service.features.leaderboard.dto.LeaderboardEntryDTO;
import vacademy.io.admin_core_service.features.leaderboard.dto.LeaderboardResponseDTO;
import vacademy.io.admin_core_service.features.leaderboard.dto.LearnerSummaryDTO;
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionInstituteGroupMappingRepository;
import vacademy.io.admin_core_service.features.learner_badge.repository.LearnerBadgeRepository;
import vacademy.io.admin_core_service.features.points_ledger.repository.PointsLedgerRepository;
import vacademy.io.admin_core_service.features.institute.service.InstituteTimezoneService;
import vacademy.io.admin_core_service.features.learner_reports.dto.LearnerActivityDataProjection;
import vacademy.io.admin_core_service.features.learner_reports.dto.ReportFilterDTO;
import vacademy.io.admin_core_service.features.learner_reports.service.BatchReportService;
import vacademy.io.admin_core_service.features.packages.repository.PackageSessionRepository;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.institute.dto.settings.InstituteSettingDto;
import vacademy.io.admin_core_service.features.institute.dto.settings.SettingDto;
import vacademy.io.common.institute.entity.Institute;
import vacademy.io.admin_core_service.features.session.dto.BatchInstituteProjection;
import vacademy.io.common.auth.model.CustomUserDetails;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.sql.Date;
import java.sql.Timestamp;
import java.time.DayOfWeek;
import java.time.ZoneId;
import java.time.temporal.TemporalAdjusters;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.stream.Collectors;

/**
 * Builds a course/batch leaderboard by combining the existing activity-rank report
 * (engagement minutes, via {@link BatchReportService}) with each learner's awarded-badge
 * count. Exposes a learner-facing ANONYMIZED view (initials only, own row marked) and a
 * named admin view, plus institute-wide badge stats.
 */
@Service
@RequiredArgsConstructor
public class LeaderboardService {

    private static final int MAX_BADGES_PER_ENTRY = 6;
    private static final int MAX_BATCHES_FOR_RANK = 5;
    private static final List<String> ACTIVE_LEARNER_STATUSES = List.of("ACTIVE");

    private final BatchReportService batchReportService;
    private final LearnerBadgeRepository learnerBadgeRepository;
    private final StudentSessionInstituteGroupMappingRepository ssigmRepository;
    private final PackageSessionRepository packageSessionRepository;
    private final InstituteRepository instituteRepository;
    private final PointsLedgerRepository pointsLedgerRepository;
    private final InstituteTimezoneService instituteTimezoneService;
    private final ObjectMapper objectMapper;

    /**
     * Public, fully-anonymized course leaderboard for the shareable page (no auth).
     * Gated behind the institute's master badges/leaderboard toggle; adds the course name.
     */
    public LeaderboardResponseDTO buildPublicCourseLeaderboard(String packageSessionId, String instituteIdHint) {
        // Derive the institute from the batch so the public page works on ANY domain
        // (generic learner.vacademy.io included), not only the institute's white-label domain.
        BatchInstituteProjection ctx = packageSessionRepository
                .findBatchAndInstituteByPackageSessionId(packageSessionId).orElse(null);
        String instituteId = (ctx != null && ctx.getInstituteId() != null)
                ? ctx.getInstituteId() : instituteIdHint;
        if (instituteId == null || !isLeaderboardEnabled(instituteId)) {
            return new LeaderboardResponseDTO(0, List.of(), null, null, null, null, null, true);
        }
        boolean anonymize = !isPublicFullNames(instituteId);
        LeaderboardResponseDTO dto =
                buildCourseLeaderboard(packageSessionId, instituteId, null, anonymize, 50, null);
        if (ctx != null) {
            dto.setCourseName(ctx.getBatchName());
            dto.setInstituteName(ctx.getInstituteName());
            dto.setInstituteLogoFileId(ctx.getInstituteLogoFileId());
            dto.setInstituteThemeCode(ctx.getInstituteThemeCode());
        }
        return dto;
    }

    /** The institute's BADGES_REWARDS_SETTING data map, or null if unset/unparseable. */
    private Map<?, ?> badgesSettingData(String instituteId) {
        try {
            Institute institute = instituteRepository.findById(instituteId).orElse(null);
            if (institute == null || institute.getSetting() == null) return null;
            InstituteSettingDto settingDto =
                    objectMapper.readValue(institute.getSetting(), InstituteSettingDto.class);
            Map<String, SettingDto> settings = settingDto.getSetting();
            if (settings == null) return null;
            SettingDto s = settings.get("BADGES_REWARDS_SETTING");
            if (s == null || !(s.getData() instanceof Map)) return null;
            return (Map<?, ?>) s.getData();
        } catch (Exception e) {
            return null;
        }
    }

    /** Master toggle; defaults to OFF (opt-in). */
    private boolean isLeaderboardEnabled(String instituteId) {
        Map<?, ?> data = badgesSettingData(instituteId);
        return data != null && Boolean.TRUE.equals(data.get("enabled"));
    }

    /** Whether the PUBLIC leaderboard shows full names (admin opt-in); defaults to anonymized. */
    private boolean isPublicFullNames(String instituteId) {
        Map<?, ?> data = badgesSettingData(instituteId);
        return data != null && Boolean.TRUE.equals(data.get("publicShowFullNames"));
    }

    /**
     * Whether this institute's leaderboards should show real names (admin opt-in via
     * the "show full names" toggle). Applies to BOTH the public shareable page and the
     * in-app learner view; defaults to anonymized (initials). The caller's own row is
     * always labelled "You" regardless.
     */
    public boolean showFullNames(String instituteId) {
        return isPublicFullNames(instituteId);
    }

    /** Ranking metric. ACTIVITY is the legacy focused-minutes ranking; POINTS reads points_ledger. */
    public enum Metric { ACTIVITY, POINTS }

    /** Time window for POINTS mode. */
    public enum Window { ALL, WEEK }

    public LeaderboardResponseDTO buildCourseLeaderboard(String packageSessionId, String instituteId,
                                                         String currentUserId, boolean anonymize, int limit,
                                                         CustomUserDetails userDetails) {
        return buildCourseLeaderboard(packageSessionId, instituteId, currentUserId, anonymize, limit,
                userDetails, Metric.ACTIVITY, Window.ALL);
    }

    /**
     * POINTS mode keeps the same row source (the batch's activity rows) so learner
     * NAMES and the full roster still come from one place, then replaces the ranking
     * value with each learner's points_ledger total and re-ranks. A learner with ledger
     * points but no activity row would be missing, so their ledger rows are merged in
     * with a placeholder name rather than dropped.
     */
    public LeaderboardResponseDTO buildCourseLeaderboard(String packageSessionId, String instituteId,
                                                         String currentUserId, boolean anonymize, int limit,
                                                         CustomUserDetails userDetails,
                                                         Metric metric, Window window) {
        if (metric == Metric.POINTS) {
            Map<String, Long> ledger =
                    ledgerPointsForPackageSession(packageSessionId, instituteId, since(instituteId, window));
            return buildCourseLeaderboardWithPoints(packageSessionId, instituteId, currentUserId,
                    anonymize, limit, userDetails, ledger);
        }
        ReportFilterDTO filter = new ReportFilterDTO();
        filter.setPackageSessionId(packageSessionId);
        // All-time window — capture every activity record for this batch.
        filter.setStartDate(Date.valueOf(LocalDate.of(2000, 1, 1)));
        filter.setEndDate(Date.valueOf(LocalDate.now().plusDays(1)));

        List<LearnerActivityDataProjection> rows =
                batchReportService.getBatchActivityDataLeaderBoard(filter, userDetails);
        return buildFromActivityRows(rows, instituteId, currentUserId, anonymize, limit);
    }

    public LeaderboardResponseDTO buildInstituteLeaderboard(String instituteId, String currentUserId,
                                                            boolean anonymize, int limit,
                                                            Metric metric, Window window) {
        if (metric == Metric.POINTS) {
            Map<String, Long> ledger = ledgerPointsForInstitute(instituteId, since(instituteId, window));
            List<LearnerActivityDataProjection> rows = batchReportService.getInstituteActivityDataLeaderBoard(
                    instituteId,
                    Date.valueOf(LocalDate.of(2000, 1, 1)),
                    Date.valueOf(LocalDate.now().plusDays(1)));
            return buildFromRowsWithPoints(rows, instituteId, currentUserId, anonymize, limit, ledger);
        }
        return buildInstituteLeaderboard(instituteId, currentUserId, anonymize, limit);
    }

    /** Institute-WIDE leaderboard: rank every learner across all their courses combined. */
    public LeaderboardResponseDTO buildInstituteLeaderboard(String instituteId, String currentUserId,
                                                            boolean anonymize, int limit) {
        List<LearnerActivityDataProjection> rows = batchReportService.getInstituteActivityDataLeaderBoard(
                instituteId,
                Date.valueOf(LocalDate.of(2000, 1, 1)),
                Date.valueOf(LocalDate.now().plusDays(1)));
        return buildFromActivityRows(rows, instituteId, currentUserId, anonymize, limit);
    }

    /** Public, fully-anonymized institute-wide leaderboard (no auth); gated by the master toggle. */
    public LeaderboardResponseDTO buildPublicInstituteLeaderboard(String instituteId) {
        if (!isLeaderboardEnabled(instituteId)) {
            return new LeaderboardResponseDTO(0, List.of(), null, null, null, null, null, true);
        }
        boolean anonymize = !isPublicFullNames(instituteId);
        LeaderboardResponseDTO dto = buildInstituteLeaderboard(instituteId, null, anonymize, 50);
        // Institute branding so the public page renders on ANY domain.
        instituteRepository.findById(instituteId).ifPresent(inst -> {
            dto.setInstituteName(inst.getInstituteName());
            dto.setInstituteLogoFileId(inst.getLogoFileId());
            dto.setInstituteThemeCode(inst.getInstituteThemeCode());
        });
        return dto;
    }

    /** Shared: turn ranked activity rows + institute badge counts into a leaderboard DTO. */
    private LeaderboardResponseDTO buildFromActivityRows(List<LearnerActivityDataProjection> rows,
                                                         String instituteId, String currentUserId,
                                                         boolean anonymize, int limit) {
        if (rows == null) rows = List.of();

        List<String> userIds = rows.stream()
                .map(LearnerActivityDataProjection::getUserId)
                .filter(Objects::nonNull)
                .collect(Collectors.toList());

        Map<String, Long> badgeCounts = new HashMap<>();
        Map<String, List<LeaderboardBadgeDTO>> badgesByUser = new HashMap<>();
        if (!userIds.isEmpty() && instituteId != null) {
            for (Object[] r : learnerBadgeRepository.findActiveBadgesByUsers(instituteId, userIds)) {
                String uid = (String) r[0];
                badgeCounts.merge(uid, 1L, Long::sum);
                List<LeaderboardBadgeDTO> list = badgesByUser.computeIfAbsent(uid, k -> new ArrayList<>());
                if (list.size() < MAX_BADGES_PER_ENTRY) {
                    list.add(new LeaderboardBadgeDTO((String) r[1], (String) r[2]));
                }
            }
        }

        List<LeaderboardEntryDTO> all = rows.stream()
                .sorted(Comparator.comparingInt(p -> p.getRank() == null ? Integer.MAX_VALUE : p.getRank()))
                .map(p -> {
                    boolean isMe = p.getUserId() != null && p.getUserId().equals(currentUserId);
                    // The caller's own row is always "You"; peers are initials (anonymized) or full names.
                    String displayName;
                    if (isMe) {
                        displayName = "You";
                    } else if (anonymize) {
                        displayName = toInitials(p.getFullName());
                    } else {
                        displayName = p.getFullName();
                    }
                    long points = p.getTotalTime() == null ? 0L : Math.round(p.getTotalTime());
                    // In anonymized mode only the caller's own userId is exposed.
                    String exposedUserId = anonymize ? (isMe ? p.getUserId() : null) : p.getUserId();
                    return new LeaderboardEntryDTO(
                            p.getRank(), exposedUserId, displayName, points,
                            badgeCounts.getOrDefault(p.getUserId(), 0L),
                            badgesByUser.getOrDefault(p.getUserId(), List.of()),
                            isMe);
                })
                .collect(Collectors.toList());

        LeaderboardEntryDTO me = all.stream().filter(LeaderboardEntryDTO::isCurrentUser).findFirst().orElse(null);
        List<LeaderboardEntryDTO> top = all.stream().limit(Math.max(1, limit)).collect(Collectors.toList());

        return new LeaderboardResponseDTO(all.size(), top, me, null, null, null, null, anonymize);
    }

    public BadgeStatsResponseDTO buildBadgeStats(String instituteId) {
        List<BadgeStatDTO> badges = new ArrayList<>();
        long total = 0;
        for (Object[] r : learnerBadgeRepository.getBadgeStats(instituteId)) {
            long count = ((Number) r[3]).longValue();
            badges.add(new BadgeStatDTO((String) r[0], (String) r[1], (String) r[2], count));
            total += count;
        }
        long learners = learnerBadgeRepository.countDistinctLearnersWithActiveBadge(instituteId);
        return new BadgeStatsResponseDTO(total, learners, badges);
    }

    /** The learner's own profile summary: total badges, badge list, and best rank across enrolled courses. */
    public LearnerSummaryDTO buildLearnerSummary(String instituteId, String userId, CustomUserDetails userDetails) {
        List<LeaderboardBadgeDTO> badges = new ArrayList<>();
        long totalBadges = 0;
        for (Object[] r : learnerBadgeRepository.findActiveBadgesByUsers(instituteId, List.of(userId))) {
            totalBadges++;
            if (badges.size() < MAX_BADGES_PER_ENTRY) {
                badges.add(new LeaderboardBadgeDTO((String) r[1], (String) r[2]));
            }
        }

        // Best (lowest) rank across the learner's enrolled batches — capped to bound profile-load cost.
        Integer bestRank = null;
        List<String> packageSessionIds =
                ssigmRepository.findPackageSessionIdsByUserIdAndInstituteId(userId, instituteId);
        int checked = 0;
        for (String psId : packageSessionIds) {
            if (checked >= MAX_BATCHES_FOR_RANK) break;
            checked++;
            ReportFilterDTO filter = new ReportFilterDTO();
            filter.setPackageSessionId(psId);
            filter.setStartDate(Date.valueOf(LocalDate.of(2000, 1, 1)));
            filter.setEndDate(Date.valueOf(LocalDate.now().plusDays(1)));
            List<LearnerActivityDataProjection> rows =
                    batchReportService.getBatchActivityDataLeaderBoard(filter, userDetails);
            if (rows == null) continue;
            for (LearnerActivityDataProjection p : rows) {
                if (userId.equals(p.getUserId()) && p.getRank() != null) {
                    if (bestRank == null || p.getRank() < bestRank) bestRank = p.getRank();
                    break;
                }
            }
        }

        return new LearnerSummaryDTO(totalBadges, bestRank, badges);
    }


    // ── Ledger-backed ranking (points_ledger) ────────────────────────────────

    /** Start of the window in the institute's own timezone; null for all-time. */
    private Timestamp since(String instituteId, Window window) {
        if (window != Window.WEEK) return null;
        ZoneId zone = instituteTimezoneService.getZone(instituteId);
        LocalDate monday = LocalDate.now(zone).with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
        return Timestamp.from(monday.atStartOfDay(zone).toInstant());
    }

    /**
     * Ledger totals for a batch, scoped by its ROSTER rather than by
     * package_session_id on the ledger rows.
     *
     * Engagement points carry the batch they were earned in, but learner-level awards
     * (ACTIVITY, streak bonuses) carry no batch at all — a package-session filter
     * would silently drop them and the leaderboard would show only engagement points.
     */
    private Map<String, Long> ledgerPointsForPackageSession(String packageSessionId, String instituteId,
                                                            Timestamp since) {
        List<String> memberIds =
                ssigmRepository.findDistinctUserIdsByPackageSessionAndStatus(packageSessionId, ACTIVE_LEARNER_STATUSES);
        if (memberIds == null || memberIds.isEmpty()) return new HashMap<>();
        return ledgerPoints(since == null
                ? pointsLedgerRepository.sumByUsers(instituteId, memberIds)
                : pointsLedgerRepository.sumByUsersSince(instituteId, memberIds, since));
    }

    private Map<String, Long> ledgerPointsForInstitute(String instituteId, Timestamp since) {
        return ledgerPoints(since == null
                ? pointsLedgerRepository.leaderboardForInstitute(instituteId)
                : pointsLedgerRepository.leaderboardForInstituteSince(instituteId, since));
    }

    private Map<String, Long> ledgerPoints(List<Object[]> rows) {
        Map<String, Long> out = new HashMap<>();
        if (rows == null) return out;
        for (Object[] r : rows) {
            if (r[0] == null) continue;
            out.put((String) r[0], r[1] == null ? 0L : ((Number) r[1]).longValue());
        }
        return out;
    }

    private LeaderboardResponseDTO buildCourseLeaderboardWithPoints(
            String packageSessionId, String instituteId, String currentUserId, boolean anonymize,
            int limit, CustomUserDetails userDetails, Map<String, Long> ledger) {
        ReportFilterDTO filter = new ReportFilterDTO();
        filter.setPackageSessionId(packageSessionId);
        filter.setStartDate(Date.valueOf(LocalDate.of(2000, 1, 1)));
        filter.setEndDate(Date.valueOf(LocalDate.now().plusDays(1)));
        List<LearnerActivityDataProjection> rows =
                batchReportService.getBatchActivityDataLeaderBoard(filter, userDetails);
        return buildFromRowsWithPoints(rows, instituteId, currentUserId, anonymize, limit, ledger);
    }

    /**
     * Same row source as the legacy ranking (so names and the roster come from one
     * place), but ranked by points_ledger totals instead of focused minutes.
     *
     * Learners who hold ledger points but have no activity row are appended rather than
     * dropped — otherwise a learner who only ever answered the daily question would be
     * invisible on a leaderboard they are supposed to be winning.
     */
    private LeaderboardResponseDTO buildFromRowsWithPoints(List<LearnerActivityDataProjection> rows,
                                                           String instituteId, String currentUserId,
                                                           boolean anonymize, int limit,
                                                           Map<String, Long> ledger) {
        if (rows == null) rows = List.of();

        Map<String, String> nameByUser = new HashMap<>();
        for (LearnerActivityDataProjection p : rows) {
            if (p.getUserId() != null) nameByUser.put(p.getUserId(), p.getFullName());
        }
        // Every user who appears in either source.
        List<String> userIds = new ArrayList<>(nameByUser.keySet());
        for (String uid : ledger.keySet()) {
            if (!nameByUser.containsKey(uid)) userIds.add(uid);
        }

        Map<String, Long> badgeCounts = new HashMap<>();
        Map<String, List<LeaderboardBadgeDTO>> badgesByUser = new HashMap<>();
        if (!userIds.isEmpty() && instituteId != null) {
            for (Object[] r : learnerBadgeRepository.findActiveBadgesByUsers(instituteId, userIds)) {
                String uid = (String) r[0];
                badgeCounts.merge(uid, 1L, Long::sum);
                List<LeaderboardBadgeDTO> list = badgesByUser.computeIfAbsent(uid, k -> new ArrayList<>());
                if (list.size() < MAX_BADGES_PER_ENTRY) {
                    list.add(new LeaderboardBadgeDTO((String) r[1], (String) r[2]));
                }
            }
        }

        List<LeaderboardEntryDTO> all = userIds.stream()
                .sorted(Comparator.comparingLong((String uid) -> -ledger.getOrDefault(uid, 0L))
                        .thenComparing(uid -> String.valueOf(nameByUser.get(uid))))
                .map(uid -> {
                    boolean isMe = uid.equals(currentUserId);
                    String fullName = nameByUser.get(uid);
                    String displayName;
                    if (isMe) {
                        displayName = "You";
                    } else if (anonymize) {
                        displayName = toInitials(fullName);
                    } else {
                        displayName = fullName == null ? "?" : fullName;
                    }
                    String exposedUserId = anonymize ? (isMe ? uid : null) : uid;
                    return new LeaderboardEntryDTO(
                            0, exposedUserId, displayName, ledger.getOrDefault(uid, 0L),
                            badgeCounts.getOrDefault(uid, 0L),
                            badgesByUser.getOrDefault(uid, List.of()),
                            isMe);
                })
                .collect(Collectors.toList());

        // Rank after sorting; equal point totals share a rank.
        long previousPoints = Long.MIN_VALUE;
        int rank = 0;
        for (int i = 0; i < all.size(); i++) {
            LeaderboardEntryDTO entry = all.get(i);
            if (entry.getPoints() != previousPoints) {
                rank = i + 1;
                previousPoints = entry.getPoints();
            }
            entry.setRank(rank);
        }

        LeaderboardEntryDTO me = all.stream().filter(LeaderboardEntryDTO::isCurrentUser).findFirst().orElse(null);
        List<LeaderboardEntryDTO> top = all.stream().limit(Math.max(1, limit)).collect(Collectors.toList());
        return new LeaderboardResponseDTO(all.size(), top, me, null, null, null, null, anonymize);
    }

    /** "Anna Smith" → "A.S."; single name → first letter; blank → "?". */
    private String toInitials(String fullName) {
        if (fullName == null || fullName.isBlank()) return "?";
        String[] parts = fullName.trim().split("\\s+");
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < parts.length && i < 2; i++) {
            if (!parts[i].isEmpty()) {
                sb.append(Character.toUpperCase(parts[i].charAt(0)));
                sb.append('.');
            }
        }
        return sb.length() == 0 ? "?" : sb.toString();
    }
}
