package vacademy.io.admin_core_service.features.enrolment_break.service;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.cache.annotation.CacheEvict;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.enrolment_break.dto.BreakCourseDTO;
import vacademy.io.admin_core_service.features.enrolment_break.dto.BreakPreviewDTO;
import vacademy.io.admin_core_service.features.enrolment_break.dto.EnrolmentBreakDTO;
import vacademy.io.admin_core_service.features.enrolment_break.dto.EnrolmentBreakEndRequestDTO;
import vacademy.io.admin_core_service.features.enrolment_break.dto.EnrolmentBreakRequestDTO;
import vacademy.io.admin_core_service.features.enrolment_break.dto.EnrolmentBreakUpdateDTO;
import vacademy.io.admin_core_service.features.enrolment_break.dto.LearnerBreaksDTO;
import vacademy.io.admin_core_service.features.enrolment_break.entity.EnrolmentBreak;
import vacademy.io.admin_core_service.features.enrolment_break.repository.EnrolmentBreakRepository;
import vacademy.io.admin_core_service.features.fee_management.entity.StudentFeePayment;
import vacademy.io.admin_core_service.features.fee_management.repository.StudentFeePaymentRepository;
import vacademy.io.admin_core_service.features.fee_management.service.CpoDiscountService;
import vacademy.io.admin_core_service.features.timeline.service.TimelineEventService;
import vacademy.io.admin_core_service.features.user_subscription.entity.UserPlan;
import vacademy.io.admin_core_service.features.user_subscription.repository.UserPlanRepository;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.sql.Timestamp;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Calendar;
import java.util.Comparator;
import java.util.Date;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * Breaks and holds for learners (docs/ENROLMENT_BREAKS.md): create, preview, change, resume and
 * cancel, plus the daily start/end sweep the job calls.
 *
 * <p>Only rows this service writes are touched: a pause switches off exactly the access rows it
 * lists in {@code paused_access_ids} and turns exactly those back on, by id. Nothing here runs for
 * an institute that never creates a break.
 */
@Slf4j
@Service
public class EnrolmentBreakService {

    static final int MAX_DAYS = 366;
    static final Set<String> UNPAID = Set.of("PENDING", "PARTIAL_PAID", "OVERDUE");
    private static final String TIMELINE_TYPE = "ENROLMENT_BREAK";

    @PersistenceContext
    private EntityManager em;

    @Autowired private EnrolmentBreakRepository repository;
    @Autowired private EnrolmentBreakGuard guard;
    @Autowired private EnrolmentBreakSettings settings;
    @Autowired private UserPlanRepository userPlanRepository;
    @Autowired private StudentFeePaymentRepository studentFeePaymentRepository;
    @Autowired private CpoDiscountService cpoDiscountService;
    @Autowired private TimelineEventService timelineEventService;

    // ------------------------------------------------------------------ read

    @Transactional(readOnly = true)
    public LearnerBreaksDTO forLearner(String userId, String instituteId) {
        List<EnrolmentBreak> breaks = repository.findByUserIdAndInstituteIdOrderByStartsOnDescCreatedAtDesc(userId, instituteId);
        List<BreakCourseDTO> courses = courses(userId, instituteId, breaks);
        Map<String, String> labels = courses.stream().collect(Collectors.toMap(
                BreakCourseDTO::getPackageSessionId, BreakCourseDTO::getCourseLabel, (a, b) -> a));
        LocalDate today = guard.today(instituteId);
        List<EnrolmentBreakDTO> rows = breaks.stream()
                .sorted(Comparator.comparing((EnrolmentBreak b) -> b.isLive() ? 0 : 1)
                        .thenComparing(EnrolmentBreak::getStartsOn, Comparator.reverseOrder()))
                .map(b -> toDto(b, labels.getOrDefault(b.getPackageSessionId(),
                        b.getPackageSessionId() == null ? null : courseLabel(b.getPackageSessionId())), today))
                .toList();
        return LearnerBreaksDTO.builder()
                .enabled(settings.isEnabled(instituteId))
                .today(today)
                .courses(courses)
                .breaks(rows)
                .build();
    }

    /**
     * The learner's current enrolments a break can apply to. An INACTIVE row only appears when it
     * is one a live pause switched off, so a course an admin removed by hand is never offered.
     */
    @SuppressWarnings("unchecked")
    List<BreakCourseDTO> courses(String userId, String instituteId, List<EnrolmentBreak> breaks) {
        Set<String> pausedRowIds = new HashSet<>();
        for (EnrolmentBreak b : breaks) {
            if (b.isLive()) pausedRowIds.addAll(splitIds(b.getPausedAccessIds()));
        }
        List<Object[]> rows = em.createNativeQuery("""
                SELECT m.id, m.package_session_id, m.status, m.expiry_date, m.user_plan_id,
                       p.package_name, l.level_name, s.session_name,
                       up.status AS plan_status, up.end_date, up.next_charge_at, up.auto_renewal_enabled,
                       po.type AS payment_type
                  FROM student_session_institute_group_mapping m
                  JOIN package_session ps ON ps.id = m.package_session_id
                  LEFT JOIN package p ON p.id = ps.package_id
                  LEFT JOIN level l ON l.id = ps.level_id
                  LEFT JOIN session s ON s.id = ps.session_id
                  LEFT JOIN user_plan up ON up.id = m.user_plan_id
                  LEFT JOIN payment_option po ON po.id = up.payment_option_id
                 WHERE m.user_id = :userId AND m.institute_id = :instituteId
                   AND m.status IN ('ACTIVE', 'INACTIVE')
                   AND (m.type IS NULL OR m.type NOT IN ('ABANDONED_CART', 'PAYMENT_FAILED'))
                 ORDER BY p.package_name, s.session_name
                """)
                .setParameter("userId", userId)
                .setParameter("instituteId", instituteId)
                .getResultList();
        Map<String, BreakCourseDTO> byCourse = new LinkedHashMap<>();
        Set<String> planIds = new HashSet<>();
        for (Object[] r : rows) {
            String rowId = (String) r[0];
            String status = (String) r[2];
            if ("INACTIVE".equals(status) && !pausedRowIds.contains(rowId)) continue;
            String psId = (String) r[1];
            BreakCourseDTO existing = byCourse.get(psId);
            if (existing != null && "ACTIVE".equals(existing.getAccessStatus())) continue;
            String planId = (String) r[4];
            if (planId != null) planIds.add(planId);
            byCourse.put(psId, BreakCourseDTO.builder()
                    .packageSessionId(psId)
                    .courseLabel(label((String) r[5], (String) r[6], (String) r[7]))
                    .accessStatus(status)
                    .accessExpiry((Date) r[3])
                    .userPlanId(planId)
                    .planStatus((String) r[8])
                    .planEndDate((Date) r[9])
                    .nextChargeAt((Date) r[10])
                    .autopay(Boolean.TRUE.equals(r[11]))
                    .paymentType((String) r[12])
                    .build());
        }
        if (!planIds.isEmpty()) {
            Map<String, Integer> unpaid = unpaidCounts(planIds);
            byCourse.values().forEach(c -> c.setUnpaidInstalments(
                    c.getUserPlanId() == null ? 0 : unpaid.getOrDefault(c.getUserPlanId(), 0)));
        }
        return new ArrayList<>(byCourse.values());
    }

    // ------------------------------------------------------------------ preview + create

    @Transactional(readOnly = true)
    public BreakPreviewDTO preview(EnrolmentBreakRequestDTO req, String instituteId) {
        Draft d = draft(req, instituteId);
        return d.preview;
    }

    @Transactional
    @CacheEvict(value = { "userPlanById", "userPlanWithPaymentLogs", "membershipDetails" }, allEntries = true)
    public EnrolmentBreakDTO create(EnrolmentBreakRequestDTO req, String instituteId, CustomUserDetails admin) {
        if (!settings.isEnabled(instituteId)) {
            throw new VacademyException("Breaks and holds are switched off for this institute. "
                    + "An admin can switch them on in Settings → Breaks and holds.");
        }
        Draft d = draft(req, instituteId);
        if (!d.preview.getBlockers().isEmpty()) {
            throw new VacademyException(blockerMessage(d.preview.getBlockers().get(0)));
        }
        EnrolmentBreak b = new EnrolmentBreak();
        b.setInstituteId(instituteId);
        b.setUserId(req.getUserId());
        b.setPackageSessionId(d.course == null ? null : d.course.getPackageSessionId());
        b.setUserPlanId(d.course == null ? null : d.course.getUserPlanId());
        b.setKind(d.preview.getKind());
        b.setStopClassReminders(d.preview.isStopClassReminders());
        b.setStopFeeReminders(d.preview.isStopFeeReminders());
        b.setRemoveAccess(d.preview.isRemoveAccess());
        b.setStartsOn(d.preview.getStartsOn());
        b.setEndsOn(d.preview.getEndsOn());
        b.setReason(trimTo(req.getReason(), 100));
        b.setNote(StringUtils.hasText(req.getNote()) ? req.getNote().trim() : null);
        b.setStatus(EnrolmentBreak.STATUS_SCHEDULED);
        b.setCreatedByUserId(admin != null ? admin.getUserId() : null);
        b = repository.save(b);
        if (!b.getStartsOn().isAfter(d.today)) {
            start(b);
        }
        log("BREAK_CREATED", b, admin, title(b, "created"), b.getNote(), Map.of(
                "kind", b.getKind(), "starts_on", b.getStartsOn().toString(),
                "ends_on", b.getEndsOn() == null ? "" : b.getEndsOn().toString()));
        guard.invalidate();
        return toDto(b, d.course == null ? null : d.course.getCourseLabel(), d.today);
    }

    /** Validates a request and works out everything a preview shows. Saves nothing. */
    private Draft draft(EnrolmentBreakRequestDTO req, String instituteId) {
        if (req == null || !StringUtils.hasText(req.getUserId())) {
            throw new VacademyException("Choose the learner");
        }
        String kind = EnrolmentBreak.KIND_PAUSE.equalsIgnoreCase(req.getKind())
                ? EnrolmentBreak.KIND_PAUSE : EnrolmentBreak.KIND_HOLD;
        boolean pause = EnrolmentBreak.KIND_PAUSE.equals(kind);
        LocalDate today = guard.today(instituteId);
        LocalDate startsOn = req.getStartsOn() != null ? req.getStartsOn() : today;
        LocalDate endsOn = req.getEndsOn();

        List<String> blockers = new ArrayList<>();
        List<String> warnings = new ArrayList<>();

        List<EnrolmentBreak> existing = repository.findByUserIdAndInstituteIdOrderByStartsOnDescCreatedAtDesc(
                req.getUserId(), instituteId);
        List<BreakCourseDTO> courses = courses(req.getUserId(), instituteId, existing);
        BreakCourseDTO course = null;
        if (StringUtils.hasText(req.getPackageSessionId())) {
            course = courses.stream().filter(c -> req.getPackageSessionId().equals(c.getPackageSessionId()))
                    .findFirst().orElse(null);
            if (course == null) blockers.add("COURSE_NOT_FOUND");
        } else if (pause) {
            blockers.add("PAUSE_NEEDS_COURSE");
        } else if (courses.isEmpty()) {
            blockers.add("NO_COURSES");
        }

        boolean stopClass = req.getStopClassReminders() == null || req.getStopClassReminders();
        boolean stopFee = req.getStopFeeReminders() == null || req.getStopFeeReminders();
        boolean removeAccess = pause && (req.getRemoveAccess() == null || req.getRemoveAccess());
        if (!pause && !stopClass && !stopFee) blockers.add("NOTHING_TO_STOP");

        if (startsOn.isBefore(today)) blockers.add("START_IN_PAST");
        if (endsOn != null && endsOn.isBefore(startsOn)) blockers.add("END_BEFORE_START");
        if (endsOn != null && ChronoUnit.DAYS.between(startsOn, endsOn) + 1 > MAX_DAYS) blockers.add("TOO_LONG");

        String psId = course == null ? null : course.getPackageSessionId();
        for (EnrolmentBreak b : existing) {
            if (!b.isLive()) continue;
            boolean sameScope = b.getPackageSessionId() == null || psId == null
                    || psId.equals(b.getPackageSessionId());
            if (sameScope && overlaps(b.getStartsOn(), b.getEndsOn(), startsOn, endsOn)) {
                blockers.add("OVERLAP");
                break;
            }
        }

        Date planEndNow = null, planEndAfter = null, nextNow = null, nextAfter = null;
        int instalments = 0;
        if (pause && course != null) {
            if (course.getUserPlanId() == null) {
                warnings.add("NO_MEMBERSHIP");
            } else {
                if (!"ACTIVE".equals(course.getPlanStatus())) warnings.add("PLAN_NOT_ACTIVE");
                if (course.isAutopay()) warnings.add("AUTOPAY_ON");
                planEndNow = course.getPlanEndDate();
                nextNow = course.getNextChargeAt();
                instalments = course.getUnpaidInstalments();
                if (instalments > 0) warnings.add("INSTALMENTS_MOVE_ON_RESUME");
                if (endsOn != null) {
                    int days = (int) (ChronoUnit.DAYS.between(startsOn, endsOn) + 1);
                    planEndAfter = plusDays(planEndNow, days);
                    nextAfter = plusDays(nextNow, days);
                } else {
                    warnings.add("OPEN_ENDED");
                }
            }
        }
        if (!pause && stopFee && course != null && course.getUnpaidInstalments() > 0) {
            warnings.add("DUES_STILL_DUE");
        }

        BreakPreviewDTO preview = BreakPreviewDTO.builder()
                .kind(kind)
                .courseLabel(course == null ? null : course.getCourseLabel())
                .startsOn(startsOn)
                .endsOn(endsOn)
                .startsToday(!startsOn.isAfter(today))
                .days(endsOn == null ? null : (int) (ChronoUnit.DAYS.between(startsOn, endsOn) + 1))
                .stopClassReminders(stopClass)
                .stopFeeReminders(stopFee)
                .removeAccess(removeAccess)
                .stopBilling(pause)
                .planEndNow(planEndNow)
                .planEndAfter(planEndAfter)
                .nextChargeNow(nextNow)
                .nextChargeAfter(nextAfter)
                .unpaidInstalmentsMoved(instalments)
                .blockers(blockers)
                .warnings(warnings)
                .build();
        return new Draft(preview, course, today);
    }

    private record Draft(BreakPreviewDTO preview, BreakCourseDTO course, LocalDate today) {}

    // ------------------------------------------------------------------ change + cancel

    @Transactional
    public EnrolmentBreakDTO update(String id, EnrolmentBreakUpdateDTO req, String instituteId, CustomUserDetails admin) {
        EnrolmentBreak b = load(id, instituteId);
        if (!b.isLive()) throw new VacademyException("This break is over and can no longer be changed");
        LocalDate today = guard.today(instituteId);
        Map<String, Object> meta = new LinkedHashMap<>();
        if (req != null && (Boolean.TRUE.equals(req.getOpenEnded()) || req.getEndsOn() != null)) {
            LocalDate newEnd = Boolean.TRUE.equals(req.getOpenEnded()) ? null : req.getEndsOn();
            if (newEnd != null) {
                if (newEnd.isBefore(b.getStartsOn())) throw new VacademyException(blockerMessage("END_BEFORE_START"));
                if (newEnd.isBefore(today)) {
                    throw new VacademyException("The last day cannot be in the past. To end the break now, use Resume.");
                }
                if (ChronoUnit.DAYS.between(b.getStartsOn(), newEnd) + 1 > MAX_DAYS) {
                    throw new VacademyException(blockerMessage("TOO_LONG"));
                }
            }
            for (EnrolmentBreak other : repository.findByUserIdAndInstituteIdAndStatusIn(b.getUserId(), instituteId,
                    List.of(EnrolmentBreak.STATUS_SCHEDULED, EnrolmentBreak.STATUS_ACTIVE))) {
                if (other.getId().equals(b.getId())) continue;
                boolean sameScope = other.getPackageSessionId() == null || b.getPackageSessionId() == null
                        || b.getPackageSessionId().equals(other.getPackageSessionId());
                if (sameScope && overlaps(other.getStartsOn(), other.getEndsOn(), b.getStartsOn(), newEnd)) {
                    throw new VacademyException(blockerMessage("OVERLAP"));
                }
            }
            meta.put("previous_ends_on", b.getEndsOn() == null ? "" : b.getEndsOn().toString());
            meta.put("ends_on", newEnd == null ? "" : newEnd.toString());
            b.setEndsOn(newEnd);
        }
        if (req != null && req.getNote() != null) {
            b.setNote(StringUtils.hasText(req.getNote()) ? req.getNote().trim() : null);
        }
        b = repository.save(b);
        log("BREAK_CHANGED", b, admin, title(b, "changed"), b.getNote(), meta);
        guard.invalidate();
        return toDto(b, courseLabel(b.getPackageSessionId()), today);
    }

    @Transactional
    public EnrolmentBreakDTO cancel(String id, String instituteId, CustomUserDetails admin) {
        EnrolmentBreak b = load(id, instituteId);
        if (!EnrolmentBreak.STATUS_SCHEDULED.equals(b.getStatus())) {
            throw new VacademyException("Only a break that has not started can be cancelled. To end a running break, use Resume.");
        }
        b.setStatus(EnrolmentBreak.STATUS_CANCELLED);
        b.setEndKind(EnrolmentBreak.END_CANCELLED);
        b.setEndedAt(LocalDateTime.now());
        b.setEndedByUserId(admin != null ? admin.getUserId() : null);
        b = repository.save(b);
        log("BREAK_CANCELLED", b, admin, title(b, "cancelled"), null, Map.of());
        guard.invalidate();
        return toDto(b, courseLabel(b.getPackageSessionId()), guard.today(instituteId));
    }

    // ------------------------------------------------------------------ resume

    @Transactional(readOnly = true)
    public BreakPreviewDTO endPreview(String id, EnrolmentBreakEndRequestDTO req, String instituteId) {
        EnrolmentBreak b = load(id, instituteId);
        LocalDate today = guard.today(instituteId);
        return plan(b, req, today, false).preview();
    }

    @Transactional
    @CacheEvict(value = { "userPlanById", "userPlanWithPaymentLogs", "membershipDetails" }, allEntries = true)
    public EnrolmentBreakDTO end(String id, EnrolmentBreakEndRequestDTO req, String instituteId, CustomUserDetails admin) {
        EnrolmentBreak b = load(id, instituteId);
        if (!EnrolmentBreak.STATUS_ACTIVE.equals(b.getStatus())) {
            throw new VacademyException(EnrolmentBreak.STATUS_SCHEDULED.equals(b.getStatus())
                    ? "This break has not started yet. Cancel it instead."
                    : "This break is already over");
        }
        LocalDate today = guard.today(instituteId);
        finish(b, req, today, EnrolmentBreak.END_MANUAL, admin);
        return toDto(b, courseLabel(b.getPackageSessionId()), today);
    }

    /** What a resume would change, and (when {@code apply}) the change itself. */
    private ResumePlan plan(EnrolmentBreak b, EnrolmentBreakEndRequestDTO req, LocalDate today, boolean scheduled) {
        // A scheduled end counts the planned days, not the hours the daily job ran late.
        LocalDate effectiveEnd = scheduled && b.getEndsOn() != null ? b.getEndsOn().plusDays(1) : today;
        int pausedDays = (int) Math.max(0, ChronoUnit.DAYS.between(b.getStartsOn(), effectiveEnd));
        // No choice made (or the pause ended on its planned date): the institute's default, which
        // keeps the dates after a long pause when it asks for that, else moves them.
        String mode = req == null || !StringUtils.hasText(req.getResumeMode())
                ? settings.defaultResumeMode(b.getInstituteId(), pausedDays) : req.getResumeMode().trim().toUpperCase();
        if (!Set.of(EnrolmentBreak.RESUME_SHIFT, EnrolmentBreak.RESUME_KEEP, EnrolmentBreak.RESUME_NEW_DATE).contains(mode)) {
            throw new VacademyException("Unknown resume choice: " + mode);
        }
        List<String> blockers = new ArrayList<>();
        List<String> warnings = new ArrayList<>();
        UserPlan plan = b.isPause() && b.getUserPlanId() != null
                ? userPlanRepository.findById(b.getUserPlanId()).orElse(null) : null;
        Date endNow = plan == null ? null : plan.getEndDate();
        Date nextNow = plan == null ? null : plan.getNextChargeAt();
        Date endAfter = endNow, nextAfter = nextNow;
        int shiftDays = 0;
        if (b.isPause() && plan != null) {
            if (EnrolmentBreak.RESUME_SHIFT.equals(mode)) {
                shiftDays = pausedDays;
                endAfter = plusDays(endNow, shiftDays);
                nextAfter = plusDays(nextNow, shiftDays);
            } else if (EnrolmentBreak.RESUME_NEW_DATE.equals(mode)) {
                LocalDate newEnd = req == null ? null : req.getNewEndDate();
                if (newEnd == null) {
                    blockers.add("NEW_DATE_REQUIRED");
                } else if (!newEnd.isAfter(today)) {
                    blockers.add("NEW_DATE_NOT_FUTURE");
                } else {
                    endAfter = atTimeOf(newEnd, endNow, zone(b.getInstituteId()));
                    nextAfter = Boolean.TRUE.equals(plan.getAutoRenewalEnabled()) && nextNow != null ? endAfter : nextNow;
                    shiftDays = endNow == null ? pausedDays : (int) ChronoUnit.DAYS.between(
                            toLocal(endNow, zone(b.getInstituteId())), newEnd);
                }
            }
        } else if (b.isPause()) {
            warnings.add("NO_MEMBERSHIP");
        }
        boolean moveInstalments = req == null || req.getMoveUnpaidInstalments() == null || req.getMoveUnpaidInstalments();
        int instalments = 0;
        if (b.isPause() && plan != null && moveInstalments && shiftDays != 0) {
            instalments = (int) studentFeePaymentRepository.findByUserPlanId(plan.getId()).stream()
                    .filter(s -> UNPAID.contains(s.getStatus()) && s.getDueDate() != null).count();
        }
        BreakPreviewDTO preview = BreakPreviewDTO.builder()
                .kind(b.getKind())
                .courseLabel(courseLabel(b.getPackageSessionId()))
                .startsOn(b.getStartsOn())
                .endsOn(b.getEndsOn())
                .pausedDays(pausedDays)
                .stopClassReminders(b.isStopClassReminders())
                .stopFeeReminders(b.isStopFeeReminders())
                .removeAccess(b.isRemoveAccess())
                .stopBilling(b.isPause())
                .planEndNow(endNow)
                .planEndAfter(endAfter)
                .nextChargeNow(nextNow)
                .nextChargeAfter(nextAfter)
                .unpaidInstalmentsMoved(instalments)
                .blockers(blockers)
                .warnings(warnings)
                .build();
        return new ResumePlan(preview, mode, shiftDays, plan, moveInstalments);
    }

    private record ResumePlan(BreakPreviewDTO preview, String mode, int shiftDays, UserPlan plan, boolean moveInstalments) {}

    /** Ends an active break: access back on, dates moved, then ENDED. Used by Resume and by the job. */
    void finish(EnrolmentBreak b, EnrolmentBreakEndRequestDTO req, LocalDate today, String endKind, CustomUserDetails admin) {
        ResumePlan rp = plan(b, req, today, EnrolmentBreak.END_SCHEDULED.equals(endKind));
        if (!rp.preview().getBlockers().isEmpty()) {
            throw new VacademyException(blockerMessage(rp.preview().getBlockers().get(0)));
        }
        List<String> notRestored = restoreAccess(b);
        UserPlan plan = rp.plan();
        if (plan != null && rp.shiftDays() != 0 && !EnrolmentBreak.RESUME_KEEP.equals(rp.mode())) {
            b.setPlanEndBefore(toLdt(plan.getEndDate()));
            plan.setEndDate(toTimestamp(rp.preview().getPlanEndAfter()));
            if (plan.getNextChargeAt() != null) plan.setNextChargeAt(toTimestamp(rp.preview().getNextChargeAfter()));
            userPlanRepository.save(plan);
            b.setPlanEndAfter(toLdt(plan.getEndDate()));
            moveAccessExpiry(b, plan, rp);
            if (rp.moveInstalments()) moveInstalments(plan, rp.shiftDays(), admin);
        }
        b.setStatus(EnrolmentBreak.STATUS_ENDED);
        b.setEndKind(endKind);
        b.setEndedAt(LocalDateTime.now());
        b.setEndedByUserId(admin != null ? admin.getUserId() : null);
        b.setResumeMode(b.isPause() ? rp.mode() : null);
        b.setShiftedDays(b.isPause() ? rp.shiftDays() : null);
        repository.save(b);
        Map<String, Object> meta = new LinkedHashMap<>();
        meta.put("paused_days", rp.preview().getPausedDays());
        meta.put("resume_mode", b.getResumeMode());
        meta.put("shifted_days", b.getShiftedDays());
        if (!notRestored.isEmpty()) meta.put("access_not_restored", String.join(",", notRestored));
        String note = req != null && StringUtils.hasText(req.getNote()) ? req.getNote().trim() : null;
        log("BREAK_ENDED", b, admin, title(b, EnrolmentBreak.END_SCHEDULED.equals(endKind) ? "ended as planned" : "resumed"),
                note, meta);
        guard.invalidate();
    }

    // ------------------------------------------------------------------ the daily sweep

    /** Starts scheduled breaks whose day has come and ends active ones whose last day is over. */
    public int[] sweep() {
        int started = 0, ended = 0;
        LocalDate earliest = LocalDate.now(ZoneId.of("Pacific/Kiritimati")); // the first zone to reach a day
        for (EnrolmentBreak b : repository.findScheduledStartingBy(earliest)) {
            try {
                if (self().startIfDue(b.getId())) started++;
            } catch (Exception e) {
                log.error("[enrolment-break] could not start break {}: {}", b.getId(), e.getMessage(), e);
            }
        }
        for (EnrolmentBreak b : repository.findActiveEndedBefore(earliest)) {
            try {
                if (self().endIfDue(b.getId())) ended++;
            } catch (Exception e) {
                log.error("[enrolment-break] could not end break {}: {}", b.getId(), e.getMessage(), e);
            }
        }
        return new int[] { started, ended };
    }

    @Autowired private org.springframework.context.ApplicationContext context;

    private EnrolmentBreakService self() {
        return context.getBean(EnrolmentBreakService.class);
    }

    @Transactional
    @CacheEvict(value = { "userPlanById", "userPlanWithPaymentLogs", "membershipDetails" }, allEntries = true)
    public boolean startIfDue(String id) {
        EnrolmentBreak b = repository.findById(id).orElse(null);
        if (b == null || !EnrolmentBreak.STATUS_SCHEDULED.equals(b.getStatus())) return false;
        if (b.getStartsOn().isAfter(guard.today(b.getInstituteId()))) return false;
        start(b);
        log("BREAK_STARTED", b, null, title(b, "started"), null, Map.of());
        guard.invalidate();
        return true;
    }

    @Transactional
    @CacheEvict(value = { "userPlanById", "userPlanWithPaymentLogs", "membershipDetails" }, allEntries = true)
    public boolean endIfDue(String id) {
        EnrolmentBreak b = repository.findById(id).orElse(null);
        if (b == null || !EnrolmentBreak.STATUS_ACTIVE.equals(b.getStatus()) || b.getEndsOn() == null) return false;
        LocalDate today = guard.today(b.getInstituteId());
        if (!b.getEndsOn().isBefore(today)) return false;
        finish(b, null, today, EnrolmentBreak.END_SCHEDULED, null);
        return true;
    }

    // ------------------------------------------------------------------ effects

    /** Makes a break ACTIVE; a pause that removes access switches the course's ACTIVE rows off. */
    private void start(EnrolmentBreak b) {
        b.setStatus(EnrolmentBreak.STATUS_ACTIVE);
        b.setStartedAt(LocalDateTime.now());
        if (b.isPause() && b.isRemoveAccess() && b.getPackageSessionId() != null) {
            List<String> switched = new ArrayList<>();
            for (Object[] r : accessRows(b, "ACTIVE")) {
                String rowId = (String) r[0];
                if (wouldCollide(r, "INACTIVE")) {
                    log.warn("[enrolment-break] break {}: access row {} left on (an INACTIVE twin exists)", b.getId(), rowId);
                    continue;
                }
                em.createNativeQuery("UPDATE student_session_institute_group_mapping SET status = 'INACTIVE', "
                                + "updated_at = CURRENT_TIMESTAMP WHERE id = :id AND status = 'ACTIVE'")
                        .setParameter("id", rowId).executeUpdate();
                switched.add(rowId);
            }
            b.setPausedAccessIds(switched.isEmpty() ? null : String.join(",", switched));
        }
        repository.save(b);
    }

    /** Turns back on exactly the rows this break switched off. Returns the ids it could not restore. */
    private List<String> restoreAccess(EnrolmentBreak b) {
        List<String> ids = splitIds(b.getPausedAccessIds());
        List<String> notRestored = new ArrayList<>();
        for (String rowId : ids) {
            @SuppressWarnings("unchecked")
            List<Object[]> rows = em.createNativeQuery("""
                    SELECT id, user_id, package_session_id, institute_id, destination_package_session_id, status
                      FROM student_session_institute_group_mapping WHERE id = :id
                    """).setParameter("id", rowId).getResultList();
            if (rows.isEmpty() || !"INACTIVE".equals(rows.get(0)[5])) continue; // someone already changed it
            Object[] r = rows.get(0);
            // The learner was enrolled again in the same course meanwhile: keep that row, leave ours off.
            Number twins = (Number) em.createNativeQuery("""
                    SELECT COUNT(*) FROM student_session_institute_group_mapping
                     WHERE user_id = :u AND institute_id = :i AND package_session_id = :p
                       AND status = 'ACTIVE' AND id <> :id
                       AND (type IS NULL OR type NOT IN ('ABANDONED_CART', 'PAYMENT_FAILED'))
                    """)
                    .setParameter("u", r[1]).setParameter("i", r[3]).setParameter("p", r[2]).setParameter("id", rowId)
                    .getSingleResult();
            if (twins.intValue() > 0) {
                notRestored.add(rowId);
                continue;
            }
            em.createNativeQuery("UPDATE student_session_institute_group_mapping SET status = 'ACTIVE', "
                            + "updated_at = CURRENT_TIMESTAMP WHERE id = :id AND status = 'INACTIVE'")
                    .setParameter("id", rowId).executeUpdate();
        }
        return notRestored;
    }

    /** Course access expiry moves with the membership on this course's ACTIVE rows. */
    private void moveAccessExpiry(EnrolmentBreak b, UserPlan plan, ResumePlan rp) {
        if (b.getPackageSessionId() == null) return;
        for (Object[] r : accessRows(b, "ACTIVE")) {
            String planId = (String) r[6];
            Date expiry = (Date) r[5];
            if (expiry == null || (planId != null && !planId.equals(plan.getId()))) continue;
            Date moved = EnrolmentBreak.RESUME_NEW_DATE.equals(rp.mode())
                    ? rp.preview().getPlanEndAfter() : plusDays(expiry, rp.shiftDays());
            em.createNativeQuery("UPDATE student_session_institute_group_mapping SET expiry_date = :d, "
                            + "updated_at = CURRENT_TIMESTAMP WHERE id = :id")
                    .setParameter("d", moved).setParameter("id", r[0]).executeUpdate();
        }
    }

    private void moveInstalments(UserPlan plan, int days, CustomUserDetails admin) {
        String by = admin != null ? admin.getUserId() : "SYSTEM:enrolment-break";
        for (StudentFeePayment s : studentFeePaymentRepository.findByUserPlanId(plan.getId())) {
            if (!UNPAID.contains(s.getStatus()) || s.getDueDate() == null) continue;
            LocalDate due = toSqlLocal(s.getDueDate()).plusDays(days);
            LocalDate start = s.getStartDate() == null ? null : toSqlLocal(s.getStartDate()).plusDays(days);
            cpoDiscountService.setInstallmentDates(s.getId(), start, due, by);
        }
    }

    @SuppressWarnings("unchecked")
    private List<Object[]> accessRows(EnrolmentBreak b, String status) {
        return em.createNativeQuery("""
                SELECT id, user_id, package_session_id, institute_id, destination_package_session_id,
                       expiry_date, user_plan_id
                  FROM student_session_institute_group_mapping
                 WHERE user_id = :u AND institute_id = :i AND package_session_id = :p AND status = :s
                   AND (type IS NULL OR type NOT IN ('ABANDONED_CART', 'PAYMENT_FAILED'))
                """)
                .setParameter("u", b.getUserId()).setParameter("i", b.getInstituteId())
                .setParameter("p", b.getPackageSessionId()).setParameter("s", status)
                .getResultList();
    }

    /** The unique key (destination, package session, institute, user, status) only bites when destination is set. */
    private boolean wouldCollide(Object[] row, String targetStatus) {
        if (row[4] == null) return false;
        Number n = (Number) em.createNativeQuery("""
                SELECT COUNT(*) FROM student_session_institute_group_mapping
                 WHERE destination_package_session_id = :d AND package_session_id = :p
                   AND institute_id = :i AND user_id = :u AND status = :s
                """)
                .setParameter("d", row[4]).setParameter("p", row[2]).setParameter("i", row[3])
                .setParameter("u", row[1]).setParameter("s", targetStatus)
                .getSingleResult();
        return n.intValue() > 0;
    }

    // ------------------------------------------------------------------ helpers

    private EnrolmentBreak load(String id, String instituteId) {
        EnrolmentBreak b = repository.findById(id).orElseThrow(() -> new VacademyException("Break not found"));
        if (!Objects.equals(b.getInstituteId(), instituteId)) throw new VacademyException("Break not found");
        return b;
    }

    private Map<String, Integer> unpaidCounts(Set<String> planIds) {
        Map<String, Integer> out = new HashMap<>();
        for (StudentFeePayment s : studentFeePaymentRepository.findByUserPlanIdIn(new ArrayList<>(planIds))) {
            if (UNPAID.contains(s.getStatus())) out.merge(s.getUserPlanId(), 1, Integer::sum);
        }
        return out;
    }

    String courseLabel(String packageSessionId) {
        if (packageSessionId == null) return null;
        try {
            @SuppressWarnings("unchecked")
            List<Object[]> rows = em.createNativeQuery("""
                    SELECT p.package_name, l.level_name, s.session_name
                      FROM package_session ps
                      LEFT JOIN package p ON p.id = ps.package_id
                      LEFT JOIN level l ON l.id = ps.level_id
                      LEFT JOIN session s ON s.id = ps.session_id
                     WHERE ps.id = :id
                    """).setParameter("id", packageSessionId).getResultList();
            if (rows.isEmpty()) return null;
            return label((String) rows.get(0)[0], (String) rows.get(0)[1], (String) rows.get(0)[2]);
        } catch (Exception e) {
            return null;
        }
    }

    static String label(String pkg, String level, String session) {
        StringBuilder sb = new StringBuilder(pkg == null ? "" : pkg.trim());
        if (StringUtils.hasText(level) && !"default".equalsIgnoreCase(level.trim())) sb.append(" · ").append(level.trim());
        if (StringUtils.hasText(session) && !"default".equalsIgnoreCase(session.trim())) sb.append(" · ").append(session.trim());
        return sb.toString();
    }

    static boolean overlaps(LocalDate aStart, LocalDate aEnd, LocalDate bStart, LocalDate bEnd) {
        boolean aBeforeB = aEnd != null && aEnd.isBefore(bStart);
        boolean bBeforeA = bEnd != null && bEnd.isBefore(aStart);
        return !aBeforeB && !bBeforeA;
    }

    static List<String> splitIds(String csv) {
        if (!StringUtils.hasText(csv)) return List.of();
        return Arrays.stream(csv.split(",")).map(String::trim).filter(StringUtils::hasText).toList();
    }

    static Date plusDays(Date d, int days) {
        if (d == null) return null;
        Calendar c = Calendar.getInstance();
        c.setTime(d);
        c.add(Calendar.DAY_OF_MONTH, days);
        return new Timestamp(c.getTimeInMillis());
    }

    private ZoneId zone(String instituteId) {
        return guard.zone(instituteId);
    }

    /** The new date at the old end date's time of day (end-of-day stays end-of-day). */
    static Date atTimeOf(LocalDate day, Date reference, ZoneId zone) {
        LocalDateTime t = reference == null ? day.atTime(23, 59, 59)
                : day.atTime(reference.toInstant().atZone(zone).toLocalTime());
        return Timestamp.from(t.atZone(zone).toInstant());
    }

    static LocalDate toLocal(Date d, ZoneId zone) {
        return d.toInstant().atZone(zone).toLocalDate();
    }

    static LocalDate toSqlLocal(Date d) {
        return d instanceof java.sql.Date sd ? sd.toLocalDate() : d.toInstant().atZone(ZoneId.systemDefault()).toLocalDate();
    }

    static Timestamp toTimestamp(Date d) {
        return d == null ? null : new Timestamp(d.getTime());
    }

    static LocalDateTime toLdt(Date d) {
        return d == null ? null : new Timestamp(d.getTime()).toLocalDateTime();
    }

    private static String trimTo(String s, int max) {
        if (!StringUtils.hasText(s)) return null;
        String t = s.trim();
        return t.length() > max ? t.substring(0, max) : t;
    }

    private EnrolmentBreakDTO toDto(EnrolmentBreak b, String courseLabel, LocalDate today) {
        Integer daysSoFar = null;
        if (EnrolmentBreak.STATUS_ACTIVE.equals(b.getStatus()) && today != null) {
            daysSoFar = (int) Math.max(0, ChronoUnit.DAYS.between(b.getStartsOn(), today) + 1);
        }
        return EnrolmentBreakDTO.builder()
                .id(b.getId()).userId(b.getUserId()).kind(b.getKind()).status(b.getStatus())
                .packageSessionId(b.getPackageSessionId()).courseLabel(courseLabel).userPlanId(b.getUserPlanId())
                .stopClassReminders(b.isStopClassReminders()).stopFeeReminders(b.isStopFeeReminders())
                .removeAccess(b.isRemoveAccess()).startsOn(b.getStartsOn()).endsOn(b.getEndsOn())
                .reason(b.getReason()).note(b.getNote()).daysSoFar(daysSoFar).endKind(b.getEndKind())
                .resumeMode(b.getResumeMode()).shiftedDays(b.getShiftedDays())
                .planEndBefore(b.getPlanEndBefore()).planEndAfter(b.getPlanEndAfter())
                .startedAt(b.getStartedAt()).endedAt(b.getEndedAt()).createdAt(b.getCreatedAt())
                .createdByUserId(b.getCreatedByUserId())
                .suggestedResumeMode(b.isPause() && EnrolmentBreak.STATUS_ACTIVE.equals(b.getStatus()) && today != null
                        ? settings.defaultResumeMode(b.getInstituteId(), (int) Math.max(0, ChronoUnit.DAYS.between(b.getStartsOn(), today)))
                        : null)
                .keepDatesAfterDays(b.isPause() ? settings.keepDatesAfterDays(b.getInstituteId()) : null)
                .build();
    }

    private static String title(EnrolmentBreak b, String what) {
        String kind = b.isPause() ? "Pause" : "Reminder hold";
        String range = b.getStartsOn() + (b.getEndsOn() == null ? " (until resumed)" : " to " + b.getEndsOn());
        return kind + " " + what + ": " + range;
    }

    private void log(String action, EnrolmentBreak b, CustomUserDetails admin, String title, String description,
                     Map<String, Object> meta) {
        try {
            Map<String, Object> m = new LinkedHashMap<>(meta);
            m.put("break_id", b.getId());
            if (b.getPackageSessionId() != null) m.put("package_session_id", b.getPackageSessionId());
            timelineEventService.logEvent(TIMELINE_TYPE, b.getUserId(), action,
                    admin != null ? "ADMIN" : "SYSTEM", admin != null ? admin.getUserId() : null,
                    admin != null ? admin.getFullName() : "Breaks and holds", title, description, m, b.getUserId());
        } catch (Exception e) {
            // The timeline is a record, never a reason to fail the change itself.
            log.warn("[enrolment-break] timeline entry failed for {}: {}", b.getId(), e.getMessage());
        }
    }

    static String blockerMessage(String code) {
        return switch (code) {
            case "COURSE_NOT_FOUND" -> "The learner is not enrolled in that course";
            case "PAUSE_NEEDS_COURSE" -> "Choose the course to pause";
            case "NO_COURSES" -> "The learner has no current course";
            case "NOTHING_TO_STOP" -> "Choose at least one kind of reminder to stop";
            case "START_IN_PAST" -> "The first day cannot be in the past";
            case "END_BEFORE_START" -> "The last day must be on or after the first day";
            case "TOO_LONG" -> "A break can last at most " + MAX_DAYS + " days";
            case "OVERLAP" -> "The learner already has a break on these dates for this course";
            case "NEW_DATE_REQUIRED" -> "Choose the new end date";
            case "NEW_DATE_NOT_FUTURE" -> "The new end date must be in the future";
            default -> code;
        };
    }
}
