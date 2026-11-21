package vacademy.io.admin_core_service.features.commerce.parallelrun;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.persistence.OptimisticLockException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.orm.ObjectOptimisticLockingFailureException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.parallelrun.ParallelRunDtos.DayView;
import vacademy.io.admin_core_service.features.commerce.parallelrun.ParallelRunDtos.DaysAnswer;
import vacademy.io.admin_core_service.features.commerce.parallelrun.ParallelRunDtos.DifferenceView;
import vacademy.io.admin_core_service.features.commerce.parallelrun.ParallelRunDtos.OldView;
import vacademy.io.admin_core_service.features.commerce.parallelrun.ParallelRunDtos.PlatformView;
import vacademy.io.admin_core_service.features.commerce.parallelrun.ParallelRunDtos.SaveDayRequest;
import vacademy.io.admin_core_service.features.commerce.parallelrun.ParallelRunMath.Differences;
import vacademy.io.admin_core_service.features.commerce.parallelrun.ParallelRunMath.Figures;
import vacademy.io.admin_core_service.features.commerce.parallelrun.ParallelRunMath.OldFigures;
import vacademy.io.admin_core_service.features.commerce.parallelrun.ParallelRunMath.StreakDay;
import vacademy.io.admin_core_service.features.commerce.parallelrun.entity.CommerceParallelRunDay;
import vacademy.io.admin_core_service.features.commerce.parallelrun.enums.ParallelRunResult;
import vacademy.io.admin_core_service.features.commerce.parallelrun.repository.CommerceParallelRunDayRepository;
import vacademy.io.admin_core_service.features.commerce.pos.service.PosUserNames;
import vacademy.io.admin_core_service.features.commerce.report.dto.ReportDtos.ReportAnswer;
import vacademy.io.admin_core_service.features.commerce.report.export.ReportExports;
import vacademy.io.admin_core_service.features.commerce.report.export.ReportTable;
import vacademy.io.admin_core_service.features.commerce.report.service.ReportRange;
import vacademy.io.admin_core_service.features.commerce.report.service.ReportRunner;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessDeniedException;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessGuard;
import vacademy.io.admin_core_service.features.commerce.security.CommerceFeature;
import vacademy.io.admin_core_service.features.commerce.security.CommerceRole;
import vacademy.io.admin_core_service.features.commerce.stock.controller.StockAccess;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockClock;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.ZonedDateTime;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

import static vacademy.io.admin_core_service.features.commerce.report.export.ReportTable.date;
import static vacademy.io.admin_core_service.features.commerce.report.export.ReportTable.integer;
import static vacademy.io.admin_core_service.features.commerce.report.export.ReportTable.money;
import static vacademy.io.admin_core_service.features.commerce.report.export.ReportTable.text;

/**
 * The parallel run of a store (WP-53 lane D): the old system's day totals entered by the store
 * manager beside the platform's figures for the same location and India business date, the
 * verdict per day, and the clean-day streak.
 *
 * <p>Access (every route needs {@code commerce.migration} and {@code commerce.tax_reports}; the
 * migration feature is checked first, so with it off every caller who belongs to the institute
 * gets 403 {@code FEATURE_DISABLED}):
 * <ul>
 *   <li>Read and export: institute ADMIN; a store manager assigned to the location; an accountant
 *       assigned to the location or institute-wide.</li>
 *   <li>Save a day: institute ADMIN or a store manager assigned to the location.</li>
 * </ul>
 *
 * <p>Platform figures are read through {@link ParallelRunReadRepository} inside
 * {@link ReportRunner} (replica, statement timeout, at most the reports' connections per pod).
 * A save reads the day's figures on the primary inside its own short write transaction (statement
 * time limited with {@code SET LOCAL}), so the stored figures are never behind the bills. Business dates are India
 * dates from {@link StockClock}; stored times are UTC wall times, set here explicitly (never the
 * JVM's default zone).
 */
@Service
public class ParallelRunService {

    /** Longest range of the day list and the export. */
    public static final int MAX_DAYS = 62;
    /** How far back from the latest saved day the streak is counted. */
    public static final int STREAK_WINDOW_DAYS = 62;
    public static final String AUDIT_KIND = "PARALLEL_RUN_DAY";
    public static final String AUDIT_REFERENCE = "PARALLEL_RUN_DAY";
    public static final String EXPORT_NAME = "parallel-run";
    static final int MAX_NOTE = 500;
    static final int MAX_BILLS = 1_000_000;
    /** NUMERIC(14,2): twelve digits before the point. */
    static final BigDecimal MAX_MONEY = new BigDecimal("999999999999.99");

    static final Set<CommerceRole> READERS = Set.of(CommerceRole.STORE_MANAGER, CommerceRole.ACCOUNTANT);
    static final Set<CommerceRole> WRITERS = Set.of(CommerceRole.STORE_MANAGER);

    public static final String STATUS_NOT_SAVED = "NOT_SAVED";
    public static final String STATUS_NO_SALES = "NO_SALES";
    public static final String STATUS_RECHECK = "RECHECK";

    private static final ObjectMapper JSON = new ObjectMapper()
            .enable(DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS);
    private static final ZoneId INDIA = ReportRange.INDIA;

    private final CommerceAccessGuard guard;
    private final ReportRunner runner;
    private final StockClock clock;
    private final ParallelRunReadRepository reads;
    private final CommerceParallelRunDayRepository dayRepository;
    private final CommerceAuditService auditService;
    private final PosUserNames userNames;
    private final TransactionTemplate writeTx;

    public ParallelRunService(CommerceAccessGuard guard, ReportRunner runner, StockClock clock,
                              ParallelRunReadRepository reads, CommerceParallelRunDayRepository dayRepository,
                              CommerceAuditService auditService, PosUserNames userNames,
                              PlatformTransactionManager transactionManager) {
        this.guard = guard;
        this.runner = runner;
        this.clock = clock;
        this.reads = reads;
        this.dayRepository = dayRepository;
        this.auditService = auditService;
        this.userNames = userNames;
        this.writeTx = new TransactionTemplate(transactionManager);
    }

    // ================================================================== access

    /** Read and export: ADMIN; manager at the location; accountant at the location or institute-wide. */
    String requireReader(CustomUserDetails user, String instituteId, String locationId) {
        guard.require(user, instituteId, CommerceFeature.MIGRATION, READERS);
        guard.require(user, instituteId, CommerceFeature.REPORTS, READERS);
        String location = location(locationId);
        if (StockAccess.isAdmin(user)) {
            return location;
        }
        Set<CommerceRole> roles = CommerceAccessGuard.rolesOf(user);
        if (roles.contains(CommerceRole.ACCOUNTANT) && guard.isInstituteWide(user, instituteId)) {
            return location;
        }
        // Assigned to the location (manager or accountant).
        guard.require(user, instituteId, CommerceFeature.REPORTS, READERS, location);
        return location;
    }

    /** Save a day: ADMIN or a store manager assigned to the location. */
    String requireWriter(CustomUserDetails user, String instituteId, String locationId) {
        guard.require(user, instituteId, CommerceFeature.MIGRATION, WRITERS);
        String location = location(locationId);
        guard.require(user, instituteId, CommerceFeature.REPORTS, WRITERS, location);
        return location;
    }

    private static String location(String locationId) {
        String value = locationId == null ? "" : locationId.trim();
        if (value.isEmpty()) {
            throw new InvalidRequestException("VALIDATION: locationId is required");
        }
        if (value.length() > 64) {
            throw new CommerceAccessDeniedException(CommerceAccessDeniedException.LOCATION_NOT_ALLOWED,
                    "this is not a location of the institute");
        }
        return value;
    }

    /**
     * Inside a read: the location must be one of the institute (an ADMIN or an institute-wide
     * accountant passes the guard without an assignment row that would prove it).
     */
    private void requireLocationOfInstitute(String instituteId, String locationId) {
        if (!reads.locationIds(instituteId).contains(locationId)) {
            throw new CommerceAccessDeniedException(CommerceAccessDeniedException.LOCATION_NOT_ALLOWED,
                    "this is not a location of the institute");
        }
    }

    // ================================================================== days

    /** The range of a read: to defaults to today (and stops at today), from to the 1st of to's month. */
    static ReportRange range(LocalDate from, LocalDate to, LocalDate today) {
        LocalDate end = to == null || to.isAfter(today) ? today : to;
        LocalDate start = from == null ? end.withDayOfMonth(1) : from;
        if (start.isAfter(today)) {
            throw new InvalidRequestException("VALIDATION: from must not be after today");
        }
        if (start.isAfter(end)) {
            throw new InvalidRequestException("VALIDATION: from must not be after to");
        }
        if (start.isBefore(ReportRange.earliest(today))) {
            throw new InvalidRequestException("VALIDATION: the parallel run reaches back "
                    + ReportRange.MAX_YEARS_BACK + " years at most");
        }
        if (ChronoUnit.DAYS.between(start, end) + 1 > MAX_DAYS) {
            throw new InvalidRequestException("VALIDATION: the range is at most " + MAX_DAYS + " days");
        }
        return new ReportRange(start, end);
    }

    /** {@code GET /parallel-run/days}. */
    public DaysAnswer days(CustomUserDetails user, String instituteId, String locationId, LocalDate from,
                           LocalDate to) {
        String location = requireReader(user, instituteId, locationId);
        LocalDate today = clock.today(instituteId);
        ReportRange range = range(from, to, today);
        return runner.screenRequest(() -> {
            Snapshot snapshot = runner.screen(() -> snapshot(instituteId, location, range, today));
            Map<String, String> names = userNames.names(snapshot.reviewers());
            return answer(location, range, today, snapshot, names);
        });
    }

    /** What one read of the days gathers (inside the read transaction). */
    record Snapshot(Map<LocalDate, Figures> figures, Map<LocalDate, CommerceParallelRunDay> saved,
                    LocalDate latestSaved, LocalDate windowStart) {

        Set<String> reviewers() {
            Set<String> ids = new LinkedHashSet<>();
            saved.values().forEach(day -> ids.add(day.getReviewedBy()));
            return ids;
        }
    }

    private Snapshot snapshot(String instituteId, String location, ReportRange range,
                              LocalDate today) {
        requireLocationOfInstitute(instituteId, location);
        Map<LocalDate, CommerceParallelRunDay> saved = new HashMap<>();
        for (CommerceParallelRunDay day : dayRepository
                .findByInstituteIdAndLocationIdAndBusinessDateBetweenOrderByBusinessDateAsc(instituteId, location,
                        range.from(), range.to())) {
            saved.put(day.getBusinessDate(), day);
        }
        LocalDate latest = dayRepository.findFirstByInstituteIdAndLocationIdOrderByBusinessDateDesc(instituteId,
                location).map(CommerceParallelRunDay::getBusinessDate).orElse(null);
        Map<LocalDate, Figures> figures = new HashMap<>();
        LocalDate windowStart = null;
        if (latest == null) {
            figures.putAll(reads.figures(instituteId, location, range.from(), range.to()));
        } else {
            windowStart = latest.minusDays(STREAK_WINDOW_DAYS - 1L);
            LocalDate earliest = ReportRange.earliest(today);
            if (windowStart.isBefore(earliest)) {
                windowStart = earliest;
            }
            for (CommerceParallelRunDay day : dayRepository
                    .findByInstituteIdAndLocationIdAndBusinessDateBetweenOrderByBusinessDateAsc(instituteId,
                            location, windowStart, latest)) {
                saved.putIfAbsent(day.getBusinessDate(), day);
            }
            LocalDate spanFrom = windowStart.isBefore(range.from()) ? windowStart : range.from();
            LocalDate spanTo = latest.isAfter(range.to()) ? latest : range.to();
            if (ChronoUnit.DAYS.between(spanFrom, spanTo) + 1 <= MAX_DAYS + STREAK_WINDOW_DAYS + 7) {
                figures.putAll(reads.figures(instituteId, location, spanFrom, spanTo));
            } else {
                figures.putAll(reads.figures(instituteId, location, range.from(), range.to()));
                figures.putAll(reads.figures(instituteId, location, windowStart, latest));
            }
        }
        return new Snapshot(figures, saved, latest, windowStart);
    }

    private DaysAnswer answer(String location, ReportRange range, LocalDate today, Snapshot s,
                              Map<String, String> names) {
        List<DayView> days = new ArrayList<>();
        for (LocalDate day = range.from(); !day.isAfter(range.to()); day = day.plusDays(1)) {
            Figures live = s.figures().getOrDefault(day, Figures.zero());
            days.add(view(day, live, s.saved().get(day), names));
        }
        int streak = 0;
        if (s.latestSaved() != null) {
            List<StreakDay> streakDays = new ArrayList<>();
            for (LocalDate day = s.windowStart(); !day.isAfter(s.latestSaved()); day = day.plusDays(1)) {
                Figures live = s.figures().getOrDefault(day, Figures.zero());
                CommerceParallelRunDay saved = s.saved().get(day);
                streakDays.add(StreakDay.of(day, live, saved == null ? null : countsClean(saved, live)));
            }
            streak = ParallelRunMath.streak(streakDays);
        }
        return new DaysAnswer(location, range.from().toString(), range.to().toString(), today.toString(), days,
                streak, ParallelRunMath.passed(streak), ParallelRunMath.CLEAN_DAYS_NEEDED, STREAK_WINDOW_DAYS,
                s.latestSaved() == null ? null : s.latestSaved().toString(), ParallelRunMath.TOLERANCE, nowIndia());
    }

    /** Saved CLEAN, and the platform's figures are still those the verdict was made on. */
    static boolean countsClean(CommerceParallelRunDay saved, Figures live) {
        return ParallelRunResult.CLEAN.name().equals(saved.getResult())
                && ParallelRunMath.sameFigures(readPlatform(saved.getPlatformJson()), live);
    }

    static DayView view(LocalDate day, Figures live, CommerceParallelRunDay saved, Map<String, String> names) {
        PlatformView platform = platformView(live);
        if (saved == null) {
            String status = ParallelRunMath.hasActivity(live) ? STATUS_NOT_SAVED : STATUS_NO_SALES;
            return new DayView(day.toString(), status, platform, null, null, null, null, false, false, null, null,
                    null, null, null);
        }
        OldFigures old = oldFigures(saved);
        Figures stored = readPlatform(saved.getPlatformJson());
        boolean changed = !ParallelRunMath.sameFigures(stored, live);
        boolean clean = !changed && ParallelRunResult.CLEAN.name().equals(saved.getResult());
        String status = changed ? STATUS_RECHECK : saved.getResult();
        Differences d = ParallelRunMath.differences(old, live);
        String reviewer = saved.getReviewedBy();
        return new DayView(day.toString(), status, platform,
                new OldView(old.billCount(), old.salesValue(), old.tax(), old.cash(), old.returns()),
                new DifferenceView(d.bills(), d.salesValue(), d.tax(), d.cash(), d.returns()),
                saved.getResult(), stored == null ? null : platformView(stored), changed, clean, saved.getNote(),
                reviewer, names == null || reviewer == null ? null : names.get(reviewer),
                indiaTime(saved.getReviewedAt()), saved.getVersion());
    }

    private static PlatformView platformView(Figures f) {
        return new PlatformView(f.bills(), f.salesValue(), f.tax(), f.cash(), f.returns(), f.openSessions());
    }

    private static OldFigures oldFigures(CommerceParallelRunDay day) {
        return new OldFigures(day.getOldBillCount() == null ? 0 : day.getOldBillCount(), day.getOldSalesValue(),
                day.getOldTax(), day.getOldCash(), day.getOldReturns());
    }

    // ================================================================== save

    /** {@code PUT /parallel-run/days/{date}}: saves (or replaces) the old system's figures of a day. */
    public DayView save(CustomUserDetails user, String instituteId, String locationId, LocalDate date,
                        SaveDayRequest request) {
        String location = requireWriter(user, instituteId, locationId);
        LocalDate today = clock.today(instituteId);
        if (date == null) {
            throw new InvalidRequestException("VALIDATION: the date is required");
        }
        if (date.isAfter(today)) {
            throw new InvalidRequestException("VALIDATION: the date is in the future");
        }
        if (date.isBefore(ReportRange.earliest(today))) {
            throw new InvalidRequestException("VALIDATION: the parallel run reaches back "
                    + ReportRange.MAX_YEARS_BACK + " years at most");
        }
        OldFigures old = validated(request);
        String note = request.getNote() == null || request.getNote().isBlank() ? null : request.getNote().trim();
        if (note != null && note.length() > MAX_NOTE) {
            throw new InvalidRequestException("VALIDATION: note must be at most " + MAX_NOTE + " characters");
        }

        String actor = user.getUserId();
        Saved saved;
        try {
            // One transaction on the primary: the figures and the open-session check are read where
            // the bills are written (no replica lag, no report slot), then the day is written.
            saved = writeTx.execute(status -> {
                reads.limitStatementTime();
                requireLocationOfInstitute(instituteId, location);
                Figures platform = reads.figures(instituteId, location, date, date)
                        .getOrDefault(date, Figures.zero());
                if (platform.openSessions() > 0) {
                    throw new ConflictException("SESSION_OPEN: a counter session at this location is still open "
                            + "for " + date + "; close it before saving the day");
                }
                ParallelRunResult result = ParallelRunMath.result(old, platform);
                if (result == ParallelRunResult.DIFFERENT && note == null) {
                    throw new InvalidRequestException("NOTE_REQUIRED: the figures differ; write a note on why");
                }
                return new Saved(platform, write(instituteId, location, date, request.getVersion(), old, platform,
                        result, note, actor));
            });
        } catch (ObjectOptimisticLockingFailureException | OptimisticLockException
                 | DataIntegrityViolationException e) {
            throw dayChanged();
        }
        return view(date, saved.platform(), saved.day(), userNames.names(List.of(actor)));
    }

    /** What a save wrote, and the platform figures it was judged on. */
    private record Saved(Figures platform, CommerceParallelRunDay day) {
    }

    private CommerceParallelRunDay write(String instituteId, String location, LocalDate date, Integer version,
                                         OldFigures old, Figures platform, ParallelRunResult result, String note,
                                         String actor) {
        CommerceParallelRunDay day = dayRepository
                .findByInstituteIdAndLocationIdAndBusinessDate(instituteId, location, date).orElse(null);
        String before = null;
        if (day == null) {
            day = new CommerceParallelRunDay();
            day.setInstituteId(instituteId);
            day.setLocationId(location);
            day.setBusinessDate(date);
        } else {
            if (version == null || !version.equals(day.getVersion())) {
                throw dayChanged();
            }
            before = auditValue(date, oldFigures(day), readPlatform(day.getPlatformJson()), day.getResult(),
                    day.getNote());
        }
        day.setOldBillCount(old.billCount());
        day.setOldSalesValue(old.salesValue());
        day.setOldTax(old.tax());
        day.setOldCash(old.cash());
        day.setOldReturns(old.returns());
        day.setPlatformJson(writePlatform(platform));
        day.setResult(result.name());
        day.setNote(note);
        day.setReviewedBy(actor);
        // Stored times are UTC wall times; the insert sends the column, so the default never applies.
        day.setReviewedAt(LocalDateTime.now(ZoneOffset.UTC));
        CommerceParallelRunDay saved = dayRepository.saveAndFlush(day);
        auditService.record(instituteId, actor, location, AUDIT_KIND, AUDIT_REFERENCE, saved.getId(), before,
                auditValue(date, old, platform, result.name(), note), null);
        return saved;
    }

    static OldFigures validated(SaveDayRequest request) {
        if (request == null) {
            throw new InvalidRequestException("VALIDATION: request body is required");
        }
        Integer bills = request.getOldBillCount();
        if (bills == null || bills < 0 || bills > MAX_BILLS) {
            throw new InvalidRequestException("VALIDATION: old_bill_count must be a whole number from 0 to "
                    + MAX_BILLS);
        }
        return new OldFigures(bills,
                amount(request.getOldSalesValue(), "old_sales_value", true, false),
                amount(request.getOldTax(), "old_tax", true, false),
                amount(request.getOldCash(), "old_cash", true, true),
                amount(request.getOldReturns(), "old_returns", false, false));
    }

    private static BigDecimal amount(BigDecimal value, String field, boolean required, boolean mayBeNegative) {
        if (value == null) {
            if (required) {
                throw new InvalidRequestException("VALIDATION: " + field + " is required");
            }
            return null;
        }
        if (value.stripTrailingZeros().scale() > 2) {
            throw new InvalidRequestException("VALIDATION: " + field + " has more than 2 decimal places");
        }
        if (!mayBeNegative && value.signum() < 0) {
            throw new InvalidRequestException("VALIDATION: " + field + " must not be negative");
        }
        if (value.abs().compareTo(MAX_MONEY) > 0) {
            throw new InvalidRequestException("VALIDATION: " + field + " is too large");
        }
        return value;
    }

    private static ConflictException dayChanged() {
        return new ConflictException("DAY_CHANGED: someone else saved this day; reload and try again");
    }

    // ================================================================== export

    /** The file of an export. */
    public record ExportFile(byte[] bytes, String fileName, String format) {
    }

    /** {@code GET /parallel-run/export}: the day list as CSV or Excel (one export at a time, audited). */
    public ExportFile export(CustomUserDetails user, String instituteId, String locationId, LocalDate from,
                             LocalDate to, String format, boolean hindi) {
        String fmt = format == null || format.isBlank() ? "xlsx" : format.trim().toLowerCase(Locale.ROOT);
        if (!"xlsx".equals(fmt) && !"csv".equals(fmt)) {
            throw new InvalidRequestException("VALIDATION: format must be xlsx or csv");
        }
        DaysAnswer answer = days(user, instituteId, locationId, from, to);
        ReportAnswer file = exportAnswer(answer);
        Map<String, Object> filters = new LinkedHashMap<>();
        filters.put("location_id", answer.locationId());
        ReportRunner.ExportResult result = runner.export(
                new ReportRunner.ExportAudit(instituteId, user.getUserId(), answer.locationId(), EXPORT_NAME,
                        answer.from(), answer.to(), filters, fmt),
                (out, maxRows) -> "csv".equals(fmt) ? ReportExports.csv(file, out, maxRows)
                        : ReportExports.xlsx(file, hindi, out, maxRows));
        return new ExportFile(result.bytes(), EXPORT_NAME + "-" + answer.from() + "-" + answer.to() + "." + fmt,
                fmt);
    }

    static final ReportTable EXPORT_TABLE = ReportTable.of(
            date("date", "Date", "तारीख़"),
            text("status", "Status", "स्थिति"),
            integer("platform_bills", "Bills (platform)", "बिल (प्लैटफ़ॉर्म)"),
            integer("old_bills", "Bills (old system)", "बिल (पुराना सिस्टम)"),
            integer("difference_bills", "Bills difference", "बिल का अंतर"),
            money("platform_sales_value", "Sales (platform)", "बिक्री (प्लैटफ़ॉर्म)"),
            money("old_sales_value", "Sales (old system)", "बिक्री (पुराना सिस्टम)"),
            money("difference_sales_value", "Sales difference", "बिक्री का अंतर"),
            money("platform_tax", "Tax (platform)", "टैक्स (प्लैटफ़ॉर्म)"),
            money("old_tax", "Tax (old system)", "टैक्स (पुराना सिस्टम)"),
            money("difference_tax", "Tax difference", "टैक्स का अंतर"),
            money("platform_cash", "Cash (platform)", "नकद (प्लैटफ़ॉर्म)"),
            money("old_cash", "Cash (old system)", "नकद (पुराना सिस्टम)"),
            money("difference_cash", "Cash difference", "नकद का अंतर"),
            money("platform_returns", "Returns (platform)", "वापसी (प्लैटफ़ॉर्म)"),
            money("old_returns", "Returns (old system)", "वापसी (पुराना सिस्टम)"),
            money("difference_returns", "Returns difference", "वापसी का अंतर"),
            text("result", "Saved result", "सहेजा गया नतीजा"),
            text("note", "Note", "टिप्पणी"),
            text("reviewed_by", "Reviewed by", "जाँचने वाले"),
            text("reviewed_at", "Reviewed at", "जाँच का समय"));

    static ReportAnswer exportAnswer(DaysAnswer answer) {
        ReportAnswer file = new ReportAnswer();
        file.setReport(EXPORT_NAME);
        file.setFrom(answer.from());
        file.setTo(answer.to());
        file.setColumns(EXPORT_TABLE.dto());
        List<Map<String, Object>> rows = new ArrayList<>();
        for (DayView day : answer.days()) {
            Map<String, Object> row = ReportTable.row();
            row.put("date", day.date());
            row.put("status", day.status());
            row.put("platform_bills", day.platform().bills());
            row.put("platform_sales_value", day.platform().salesValue());
            row.put("platform_tax", day.platform().tax());
            row.put("platform_cash", day.platform().cash());
            row.put("platform_returns", day.platform().returns());
            if (day.old() != null) {
                row.put("old_bills", day.old().billCount());
                row.put("old_sales_value", day.old().salesValue());
                row.put("old_tax", day.old().tax());
                row.put("old_cash", day.old().cash());
                row.put("old_returns", day.old().returns());
                row.put("difference_bills", day.difference().bills());
                row.put("difference_sales_value", day.difference().salesValue());
                row.put("difference_tax", day.difference().tax());
                row.put("difference_cash", day.difference().cash());
                row.put("difference_returns", day.difference().returns());
            }
            row.put("result", day.result());
            row.put("note", day.note());
            row.put("reviewed_by", day.reviewedByName() != null ? day.reviewedByName() : day.reviewedBy());
            row.put("reviewed_at", day.reviewedAt());
            rows.add(row);
        }
        file.setRows(rows);
        Map<String, Object> totals = new LinkedHashMap<>();
        totals.put("status", answer.streak() + " / " + answer.cleanDaysNeeded());
        file.setTotals(totals);
        return file;
    }

    // ================================================================== JSON and time

    static String writePlatform(Figures f) {
        ObjectNode node = JSON.createObjectNode();
        node.put("bills", f.bills());
        node.put("sales_value", f.salesValue());
        node.put("tax", f.tax());
        node.put("cash", f.cash());
        node.put("returns", f.returns());
        node.put("open_sessions", f.openSessions());
        return node.toString();
    }

    /** The stored platform figures; null when the text is missing or not readable. */
    static Figures readPlatform(String json) {
        if (json == null || json.isBlank()) {
            return null;
        }
        try {
            JsonNode node = JSON.readTree(json);
            return new Figures(node.path("bills").asLong(), decimal(node, "sales_value"), decimal(node, "tax"),
                    decimal(node, "cash"), decimal(node, "returns"), node.path("open_sessions").asInt());
        } catch (JsonProcessingException e) {
            return null;
        }
    }

    private static BigDecimal decimal(JsonNode node, String field) {
        JsonNode value = node.get(field);
        if (value == null || value.isNull()) {
            return BigDecimal.ZERO;
        }
        return value.isNumber() ? value.decimalValue() : new BigDecimal(value.asText("0"));
    }

    private static String auditValue(LocalDate date, OldFigures old, Figures platform, String result, String note) {
        ObjectNode node = JSON.createObjectNode();
        node.put("business_date", date.toString());
        node.put("old_bill_count", old.billCount());
        node.put("old_sales_value", old.salesValue());
        node.put("old_tax", old.tax());
        node.put("old_cash", old.cash());
        if (old.returns() != null) {
            node.put("old_returns", old.returns());
        }
        if (platform != null) {
            node.set("platform", JSON.valueToTree(Map.of(
                    "bills", platform.bills(),
                    "sales_value", platform.salesValue(),
                    "tax", platform.tax(),
                    "cash", platform.cash(),
                    "returns", platform.returns())));
        }
        node.put("result", result);
        if (note != null) {
            node.put("note", note);
        }
        return node.toString();
    }

    /** A stored UTC wall time as India time with offset. */
    static String indiaTime(LocalDateTime storedUtc) {
        if (storedUtc == null) {
            return null;
        }
        return storedUtc.atOffset(ZoneOffset.UTC).atZoneSameInstant(INDIA).toOffsetDateTime()
                .truncatedTo(ChronoUnit.SECONDS).toString();
    }

    private static String nowIndia() {
        return ZonedDateTime.now(INDIA).truncatedTo(ChronoUnit.SECONDS).toOffsetDateTime().toString();
    }
}
