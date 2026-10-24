package vacademy.io.admin_core_service.features.learner_access.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.CollectionUtils;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.institute_learner.entity.Student;
import vacademy.io.admin_core_service.features.institute_learner.entity.StudentSessionInstituteGroupMapping;
import vacademy.io.admin_core_service.features.institute_learner.enums.LearnerSessionStatusEnum;
import vacademy.io.admin_core_service.features.institute_learner.repository.InstituteStudentRepository;
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionRepository;
import vacademy.io.admin_core_service.features.learner_access.dto.LearnerAccessChangeRequestDTO;
import vacademy.io.admin_core_service.features.learner_access.dto.LearnerAccessChangeResponseDTO;
import vacademy.io.admin_core_service.features.learner_access.dto.LearnerAccessLogDTO;
import vacademy.io.admin_core_service.features.learner_access.entity.LearnerAccessLog;
import vacademy.io.admin_core_service.features.learner_access.enums.LearnerAccessActionEnum;
import vacademy.io.admin_core_service.features.learner_access.enums.LearnerAccessSourceEnum;
import vacademy.io.admin_core_service.features.learner_access.repository.LearnerAccessLogRepository;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.util.ArrayList;
import java.util.Calendar;
import java.util.Date;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.concurrent.TimeUnit;
import java.util.stream.Collectors;

/**
 * Owns the learner's course-access window: reading it, changing it, and keeping the
 * audit trail behind it truthful.
 *
 * <p>Access is stored as {@code student_session_institute_group_mapping.expiry_date},
 * where NULL means unlimited. Every write that goes through this service also appends a
 * {@code learner_access_log} row in the same transaction, so the history can never claim
 * a change that did not commit — and a committed change can never be missing from it.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class LearnerAccessService {

    private static final long MILLIS_PER_DAY = TimeUnit.DAYS.toMillis(1);

    /**
     * Statuses an access change may touch. DELETED and INVITED are excluded: the first is
     * a tombstone, and the second has no access to extend — its expiry is written when the
     * learner actually enrolls.
     */
    private static final List<String> CHANGEABLE_STATUSES = List.of(
            LearnerSessionStatusEnum.ACTIVE.name(),
            LearnerSessionStatusEnum.INACTIVE.name(),
            LearnerSessionStatusEnum.EXPIRED.name(),
            LearnerSessionStatusEnum.TERMINATED.name());

    /** Statuses that a successful extension may lift back to ACTIVE. */
    private static final List<String> REACTIVATABLE_STATUSES = List.of(
            LearnerSessionStatusEnum.INACTIVE.name(),
            LearnerSessionStatusEnum.EXPIRED.name());

    private final StudentSessionRepository studentSessionRepository;
    private final InstituteStudentRepository instituteStudentRepository;
    private final LearnerAccessLogRepository learnerAccessLogRepository;
    private final vacademy.io.admin_core_service.features.user_subscription.repository.UserPlanRepository userPlanRepository;

    // ── Admin-initiated changes ───────────────────────────────────────────

    @Transactional
    public LearnerAccessChangeResponseDTO changeAccess(LearnerAccessChangeRequestDTO request,
                                                       CustomUserDetails userDetails) {
        validate(request);

        List<StudentSessionInstituteGroupMapping> mappings = studentSessionRepository.findForAccessChange(
                request.getInstituteId(),
                request.getUserIds(),
                request.getPackageSessionIds(),
                CHANGEABLE_STATUSES);

        // (userId, packageSessionId) slots that already hold an ACTIVE mapping. Promoting a
        // second row into an occupied slot would leave the learner with two ACTIVE
        // enrollments in one batch — which every roster, report and access check assumes
        // cannot happen — and can trip uq_dest_pkg_inst_user_status, rolling back the
        // whole bulk request over one learner.
        Set<String> claimedActiveSlots = mappings.stream()
                .filter(m -> LearnerSessionStatusEnum.ACTIVE.name().equals(m.getStatus()))
                .map(m -> activeSlotKey(m.getUserId(),
                        m.getPackageSession() != null ? m.getPackageSession().getId() : null))
                .collect(Collectors.toCollection(HashSet::new));

        Map<String, String> namesByUserId = resolveLearnerNames(request.getUserIds());
        String actorId = userDetails != null ? userDetails.getUserId() : null;
        String actorName = userDetails != null ? userDetails.getFullName() : null;
        Date now = new Date();

        List<LearnerAccessChangeResponseDTO.ItemDTO> results = new ArrayList<>();
        List<StudentSessionInstituteGroupMapping> toSave = new ArrayList<>();
        List<LearnerAccessLog> logs = new ArrayList<>();

        for (StudentSessionInstituteGroupMapping mapping : mappings) {
            String packageSessionId = mapping.getPackageSession() != null
                    ? mapping.getPackageSession().getId()
                    : null;
            LearnerAccessChangeResponseDTO.ItemDTO.ItemDTOBuilder item =
                    LearnerAccessChangeResponseDTO.ItemDTO.builder()
                            .userId(mapping.getUserId())
                            .learnerName(namesByUserId.get(mapping.getUserId()))
                            .packageSessionId(packageSessionId)
                            .mappingId(mapping.getId())
                            .previousExpiryDate(mapping.getExpiryDate());

            try {
                Date previous = mapping.getExpiryDate();
                Date next = resolveNewExpiry(request, mapping, now);

                Date previousJoin = mapping.getEnrolledDate();
                // A join move is independent of the expiry operations: a request may carry
                // either, both or neither.
                boolean joinChanged = request.getNewJoinDate() != null
                        && !Objects.equals(previousJoin, request.getNewJoinDate());
                if (joinChanged) {
                    item.previousJoinDate(previousJoin).newJoinDate(request.getNewJoinDate());
                }

                if (Objects.equals(previous, next) && !joinChanged) {
                    results.add(item.status("SKIPPED")
                            .newExpiryDate(previous)
                            .remainingDays(remainingDays(previous, now))
                            .message("Access window is already what was requested")
                            .build());
                    continue;
                }

                LearnerAccessActionEnum action = classify(previous, next, now);
                Integer delta = daysBetween(previous, next);

                if (!request.isDryRun()) {
                    mapping.setExpiryDate(next);
                    if (joinChanged) {
                        mapping.setEnrolledDate(request.getNewJoinDate());
                        Date newPlanEnd = shiftPlanWindow(mapping, request);
                        if (newPlanEnd != null) {
                            item.newPlanEndDate(newPlanEnd);
                        }
                    }
                    // Set.add both tests and claims the slot, so two INACTIVE rows for the
                    // same batch in one request cannot both be promoted either.
                    if (Boolean.TRUE.equals(request.getReactivateExpired())
                            && REACTIVATABLE_STATUSES.contains(mapping.getStatus())
                            && (next == null || next.after(now))
                            && claimedActiveSlots.add(
                                    activeSlotKey(mapping.getUserId(), packageSessionId))) {
                        mapping.setStatus(LearnerSessionStatusEnum.ACTIVE.name());
                    }
                    toSave.add(mapping);
                    logs.add(LearnerAccessLog.builder()
                            .instituteId(request.getInstituteId())
                            .userId(mapping.getUserId())
                            .packageSessionId(packageSessionId)
                            .mappingId(mapping.getId())
                            .source(LearnerAccessSourceEnum.ADMIN_EXTENSION.name())
                            .action(action.name())
                            .previousExpiryDate(previous)
                            .newExpiryDate(next)
                            .daysDelta(delta)
                            .accessDays(requestedAccessDays(request))
                            .userPlanId(mapping.getUserPlanId())
                            .reason(request.getReason())
                            .actorId(actorId)
                            .actorName(actorName)
                            .build());
                }

                results.add(item.status("UPDATED")
                        .action(action.name())
                        .newExpiryDate(next)
                        .daysDelta(delta)
                        .remainingDays(remainingDays(next, now))
                        .build());

            } catch (SkipException e) {
                results.add(item.status("SKIPPED").message(e.getMessage()).build());
            } catch (Exception e) {
                log.warn("Access change failed for user {} mapping {}: {}",
                        mapping.getUserId(), mapping.getId(), e.getMessage());
                results.add(item.status("FAILED").message(e.getMessage()).build());
            }
        }

        if (!request.isDryRun() && !toSave.isEmpty()) {
            studentSessionRepository.saveAll(toSave);
            learnerAccessLogRepository.saveAll(logs);
        }

        return LearnerAccessChangeResponseDTO.builder()
                .dryRun(request.isDryRun())
                .summary(summarise(results))
                .results(results)
                .build();
    }

    /**
     * Resolves what the expiry should become. Throws {@link SkipException} when the
     * requested change does not apply to this particular enrollment — that is a skip with
     * a reason, not a failure.
     */
    /**
     * Moves the plan's own window to follow a new join date, and returns the new end date.
     *
     * <p>Five fields describe one concept between them — ssigm.enrolled_date and expiry_date
     * for course access, user_plan.start_date and end_date for the term, next_charge_at for
     * the money — and they already drift apart in production: a trial mapping expires 30 days
     * after enrolment while the plan runs 14. Moving the join date alone would widen exactly
     * that gap, so the term moves with it and the charge follows the term.
     *
     * <p>The term length is preserved rather than recomputed from the invite: whatever the
     * learner was given (a 14-day trial, a 30-day month) they keep, just starting later.
     * Returns null when there is no plan to move or the caller opted out.
     */
    private Date shiftPlanWindow(StudentSessionInstituteGroupMapping mapping,
            LearnerAccessChangeRequestDTO request) {
        if (Boolean.FALSE.equals(request.getShiftPlanWindow()) || mapping.getUserPlanId() == null) {
            return null;
        }
        try {
            var plan = userPlanRepository.findById(mapping.getUserPlanId()).orElse(null);
            if (plan == null) {
                return null;
            }
            Date newStart = request.getNewJoinDate();
            Date newEnd = null;
            if (plan.getStartDate() != null && plan.getEndDate() != null) {
                long termMillis = plan.getEndDate().getTime() - plan.getStartDate().getTime();
                newEnd = new Date(newStart.getTime() + termMillis);
            } else if (plan.getEndDate() != null) {
                newEnd = plan.getEndDate();
            }
            plan.setStartDate(newStart);
            if (newEnd != null) {
                plan.setEndDate(newEnd);
                // Only an armed plan is re-pointed. A learner with no mandate is billed by the
                // pay-to-continue flow, and writing a charge date for them would arm a sweep
                // that has nothing to charge against.
                if (Boolean.TRUE.equals(plan.getAutoRenewalEnabled()) && plan.getNextChargeAt() != null) {
                    plan.setNextChargeAt(newEnd);
                }
            }
            userPlanRepository.save(plan);
            log.info("Join date moved for plan {}: start={} end={} nextChargeAt={}",
                    plan.getId(), newStart, newEnd, plan.getNextChargeAt());
            return newEnd;
        } catch (Exception e) {
            log.error("Could not shift the plan window for mapping {}", mapping.getId(), e);
            return null;
        }
    }

    private Date resolveNewExpiry(LearnerAccessChangeRequestDTO request,
                                  StudentSessionInstituteGroupMapping mapping,
                                  Date now) {
        if (Boolean.TRUE.equals(request.getMakeUnlimited())) {
            return null;
        }

        if (request.getNewExpiryDate() != null) {
            return request.getNewExpiryDate();
        }

        if (request.getAccessDaysFromEnrollment() != null) {
            Date enrolled = mapping.getEnrolledDate() != null ? mapping.getEnrolledDate() : now;
            return addDays(enrolled, request.getAccessDaysFromEnrollment());
        }

        // extendByDays
        Date current = mapping.getExpiryDate();
        if (current == null) {
            throw new SkipException("Learner already has unlimited access; "
                    + "use an explicit expiry date to make it finite");
        }
        // An expired learner extended by N days should get N usable days, not a window
        // that is still in the past.
        Date base = (Boolean.TRUE.equals(request.getExtendFromToday()) && current.before(now))
                ? now
                : current;
        return addDays(base, request.getExtendByDays());
    }

    private void validate(LearnerAccessChangeRequestDTO request) {
        if (request == null || !StringUtils.hasText(request.getInstituteId())) {
            throw new VacademyException("instituteId is required");
        }
        if (CollectionUtils.isEmpty(request.getUserIds())) {
            throw new VacademyException("At least one user_id is required");
        }

        int modes = 0;
        if (request.getExtendByDays() != null) modes++;
        if (request.getAccessDaysFromEnrollment() != null) modes++;
        if (request.getNewExpiryDate() != null) modes++;
        if (Boolean.TRUE.equals(request.getMakeUnlimited())) modes++;

        if (modes == 0) {
            throw new VacademyException("Specify one of extend_by_days, access_days_from_enrollment, "
                    + "new_expiry_date or make_unlimited");
        }
        if (modes > 1) {
            throw new VacademyException("Specify exactly one of extend_by_days, "
                    + "access_days_from_enrollment, new_expiry_date or make_unlimited");
        }
        if (request.getExtendByDays() != null && request.getExtendByDays() == 0) {
            throw new VacademyException("extend_by_days must not be zero");
        }
        if (request.getAccessDaysFromEnrollment() != null && request.getAccessDaysFromEnrollment() <= 0) {
            throw new VacademyException("access_days_from_enrollment must be greater than zero");
        }
    }

    /** The access-days figure the admin typed, for the log. Absolute dates have none. */
    private Integer requestedAccessDays(LearnerAccessChangeRequestDTO request) {
        if (request.getExtendByDays() != null) {
            return request.getExtendByDays();
        }
        return request.getAccessDaysFromEnrollment();
    }

    private LearnerAccessChangeResponseDTO.SummaryDTO summarise(
            List<LearnerAccessChangeResponseDTO.ItemDTO> results) {
        int updated = 0, skipped = 0, failed = 0;
        for (LearnerAccessChangeResponseDTO.ItemDTO item : results) {
            switch (item.getStatus()) {
                case "UPDATED" -> updated++;
                case "SKIPPED" -> skipped++;
                default -> failed++;
            }
        }
        return LearnerAccessChangeResponseDTO.SummaryDTO.builder()
                .totalTargeted(results.size())
                .updated(updated)
                .skipped(skipped)
                .failed(failed)
                .build();
    }

    // ── Automatic grants, recorded from the enrollment paths ──────────────

    /**
     * Records the access window an enrollment was born with, so a learner's timeline starts
     * at "granted 365 days by the Annual plan" rather than at the first admin extension.
     *
     * <p>Deliberately swallows its own failures: the enrollment itself has already
     * committed by the time this is called, and losing a history row must never roll one
     * back. A dropped row is logged loudly instead.
     */
    @Transactional
    public void recordGrant(LearnerAccessSourceEnum source,
                            String instituteId,
                            StudentSessionInstituteGroupMapping mapping,
                            Date previousExpiry,
                            Integer accessDays,
                            String userPlanId,
                            String paymentPlanId,
                            String enrollInviteId,
                            String reason,
                            String actorId,
                            String actorName) {
        if (mapping == null) {
            return;
        }
        recordGrant(source, instituteId, mapping.getUserId(),
                mapping.getPackageSession() != null ? mapping.getPackageSession().getId() : null,
                mapping.getId(), previousExpiry, mapping.getExpiryDate(), accessDays,
                userPlanId, paymentPlanId, enrollInviteId, reason, actorId, actorName);
    }

    /**
     * Id-level overload for enrollment paths that write the mapping through a native
     * insert and so never hold the entity.
     */
    @Transactional
    public void recordGrant(LearnerAccessSourceEnum source,
                            String instituteId,
                            String userId,
                            String packageSessionId,
                            String mappingId,
                            Date previousExpiry,
                            Date newExpiry,
                            Integer accessDays,
                            String userPlanId,
                            String paymentPlanId,
                            String enrollInviteId,
                            String reason,
                            String actorId,
                            String actorName) {
        try {
            if (!StringUtils.hasText(instituteId) || !StringUtils.hasText(userId)) {
                return;
            }
            if (Objects.equals(previousExpiry, newExpiry)) {
                return; // nothing actually changed
            }

            learnerAccessLogRepository.save(LearnerAccessLog.builder()
                    .instituteId(instituteId)
                    .userId(userId)
                    .packageSessionId(packageSessionId)
                    .mappingId(mappingId)
                    .source(source.name())
                    .action(previousExpiry == null
                            ? LearnerAccessActionEnum.GRANT.name()
                            : classify(previousExpiry, newExpiry, new Date()).name())
                    .previousExpiryDate(previousExpiry)
                    .newExpiryDate(newExpiry)
                    .daysDelta(daysBetween(previousExpiry, newExpiry))
                    .accessDays(accessDays)
                    .userPlanId(userPlanId)
                    .paymentPlanId(paymentPlanId)
                    .enrollInviteId(enrollInviteId)
                    .reason(reason)
                    .actorId(actorId)
                    .actorName(actorName)
                    .build());
        } catch (Exception e) {
            log.error("Failed to record learner access grant for user {} in institute {}: {}",
                    userId, instituteId, e.getMessage());
        }
    }

    // ── History ───────────────────────────────────────────────────────────

    @Transactional(readOnly = true)
    public Page<LearnerAccessLogDTO> getHistory(String instituteId,
                                                String userId,
                                                List<String> packageSessionIds,
                                                int page,
                                                int size) {
        if (!StringUtils.hasText(instituteId) || !StringUtils.hasText(userId)) {
            throw new VacademyException("instituteId and userId are required");
        }
        return learnerAccessLogRepository
                .findHistory(instituteId, userId, packageSessionIds, PageRequest.of(page, size))
                .map(LearnerAccessLogDTO::from);
    }

    // ── Helpers ───────────────────────────────────────────────────────────

    private LearnerAccessActionEnum classify(Date previous, Date next, Date now) {
        if (next == null) {
            return LearnerAccessActionEnum.MAKE_UNLIMITED;
        }
        if (!next.after(now)) {
            return LearnerAccessActionEnum.REVOKE;
        }
        if (previous == null) {
            // Was unlimited, now bounded — neither an extension nor a reduction in days.
            return LearnerAccessActionEnum.SET;
        }
        return next.after(previous)
                ? LearnerAccessActionEnum.EXTEND
                : LearnerAccessActionEnum.REDUCE;
    }

    /**
     * Whole days between two expiry instants. Null when either side is unlimited: the
     * distance to "forever" is not a number, and reporting 0 there would read as "no
     * change" in the timeline.
     */
    private Integer daysBetween(Date from, Date to) {
        if (from == null || to == null) {
            return null;
        }
        return (int) Math.round((double) (to.getTime() - from.getTime()) / MILLIS_PER_DAY);
    }

    /** Days of access left from {@code now}; null when unlimited, never negative. */
    private Integer remainingDays(Date expiry, Date now) {
        if (expiry == null) {
            return null;
        }
        return Math.max(0, (int) Math.ceil((double) (expiry.getTime() - now.getTime()) / MILLIS_PER_DAY));
    }

    /** Identity of the "one ACTIVE enrollment per learner per batch" slot. */
    private String activeSlotKey(String userId, String packageSessionId) {
        return userId + "\u0000" + packageSessionId;
    }

    private Date addDays(Date base, int days) {
        Calendar calendar = Calendar.getInstance();
        calendar.setTime(base);
        calendar.add(Calendar.DAY_OF_YEAR, days);
        return calendar.getTime();
    }

    private Map<String, String> resolveLearnerNames(List<String> userIds) {
        try {
            return instituteStudentRepository.findByUserIdIn(userIds).stream()
                    .filter(s -> StringUtils.hasText(s.getFullName()))
                    .collect(Collectors.toMap(Student::getUserId, Student::getFullName, (a, b) -> a));
        } catch (Exception e) {
            log.warn("Could not resolve learner names: {}", e.getMessage());
            return Map.of();
        }
    }

    /** A per-enrollment reason to leave the row untouched — reported, not thrown to the caller. */
    private static class SkipException extends RuntimeException {
        SkipException(String message) {
            super(message);
        }
    }
}
