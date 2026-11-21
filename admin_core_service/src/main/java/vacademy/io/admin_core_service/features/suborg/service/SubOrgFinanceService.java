package vacademy.io.admin_core_service.features.suborg.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.fee_management.entity.StudentFeePayment;
import vacademy.io.admin_core_service.features.fee_management.repository.StudentFeePaymentRepository;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionInstituteGroupMappingRepository;
import vacademy.io.admin_core_service.features.suborg.dto.SubOrgFinanceDetailDTO;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentOption;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentPlan;
import vacademy.io.admin_core_service.features.user_subscription.entity.UserPlan;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentLogRepository;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentOptionRepository;
import vacademy.io.admin_core_service.features.user_subscription.repository.UserPlanRepository;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.payment.enums.PaymentStatusEnum;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.Institute;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.Date;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Powers the manage-sub-orgs detail panel. Reads only — no mutations.
 *
 * Roster comes from {@code student_session_institute_group_mapping} filtered by sub_org_id.
 * Admin payment is the first ROOT_ADMIN row's UserPlan; CPO ledger is its StudentFeePayment
 * rows. Learner rows include outstanding dues only if the learner happens to have SFPs
 * (which is rare under the FREE-scoped-invite flow but supported for completeness).
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class SubOrgFinanceService {

    private static final String ROLE_ROOT_ADMIN = "ROOT_ADMIN";
    private static final String SFP_STATUS_PAID = "PAID";

    private final StudentSessionInstituteGroupMappingRepository mappingRepository;
    private final UserPlanRepository userPlanRepository;
    private final PaymentOptionRepository paymentOptionRepository;
    private final SubOrgSeatCapResolver seatCapResolver;
    private final StudentFeePaymentRepository studentFeePaymentRepository;
    private final InstituteRepository instituteRepository;
    private final AuthService authService;
    private final PaymentLogRepository paymentLogRepository;

    @Transactional(readOnly = true)
    public SubOrgFinanceDetailDTO getFinanceDetail(String subOrgId, String parentInstituteId) {
        if (!StringUtils.hasText(subOrgId)) {
            throw new VacademyException("sub_org_id is required");
        }

        Institute subOrg = instituteRepository.findById(subOrgId)
                .orElseThrow(() -> new VacademyException("Sub-organization not found: " + subOrgId));

        List<Object[]> rosterRows = mappingRepository.findActiveSubOrgRoster(subOrgId);

        // Partition rows into root-admin and everyone-else. Sub-orgs can have more than one
        // ROOT_ADMIN (e.g. a free co-admin added after the paying admin). The right one to
        // surface as "Admin payment" is, in order: the admin with a CPO ledger (SFP rows),
        // else the admin who actually PAID, else a deterministic earliest-enrolled fallback.
        // See pickAdminRowWithBills — the roster query is unordered, so this ordering is what
        // keeps the displayed admin stable instead of flipping between co-admins.
        List<Object[]> adminCandidates = new ArrayList<>();
        List<Object[]> learnerRows = new ArrayList<>(rosterRows.size());
        for (Object[] row : rosterRows) {
            String roles = (String) row[4];
            if (roles != null && roles.toUpperCase().contains(ROLE_ROOT_ADMIN)) {
                adminCandidates.add(row);
            } else {
                learnerRows.add(row);
            }
        }
        Object[] rootAdminRow = pickAdminRowWithBills(adminCandidates);

        // Resolve user details in one auth-service round-trip.
        Map<String, UserDTO> userMap = fetchUsers(rosterRows);

        SubOrgFinanceDetailDTO.AdminPayment adminPayment = rootAdminRow != null
                ? buildAdminPayment(rootAdminRow, userMap)
                : null;

        // Group the learner SSIGM rows by user so a learner enrolled in multiple package
        // sessions shows once with ALL their courses (and combined dues) instead of one
        // row per enrollment. Insertion order is preserved for a stable roster.
        Map<String, List<Object[]>> learnerRowsByUser = new LinkedHashMap<>();
        for (Object[] row : learnerRows) {
            String userId = (String) row[1];
            learnerRowsByUser.computeIfAbsent(userId, k -> new ArrayList<>()).add(row);
        }

        List<SubOrgFinanceDetailDTO.LearnerRow> learners = new ArrayList<>(learnerRowsByUser.size());
        BigDecimal learnerOutstanding = BigDecimal.ZERO;
        for (List<Object[]> userRows : learnerRowsByUser.values()) {
            SubOrgFinanceDetailDTO.LearnerRow learnerRow = buildLearnerRow(userRows, userMap);
            learners.add(learnerRow);
            if (learnerRow.getOutstandingAmount() != null) {
                learnerOutstanding = learnerOutstanding.add(learnerRow.getOutstandingAmount());
            }
        }

        BigDecimal totalOutstanding = learnerOutstanding;
        if (adminPayment != null && adminPayment.getOutstandingAmount() != null) {
            totalOutstanding = totalOutstanding.add(adminPayment.getOutstandingAmount());
        }

        SubOrgFinanceDetailDTO.SeatUsage seatUsage = buildSeatUsage(
                rootAdminRow, learnerRows, subOrgId, parentInstituteId);

        return SubOrgFinanceDetailDTO.builder()
                .subOrgId(subOrgId)
                .subOrgName(subOrg.getInstituteName())
                .adminPayment(adminPayment)
                .learners(learners)
                .totals(SubOrgFinanceDetailDTO.Totals.builder()
                        .learnerCount(learners.size())
                        .totalOutstanding(totalOutstanding)
                        .build())
                .seatUsage(seatUsage)
                .build();
    }

    /**
     * Prefer the admin whose UserPlan has any non-empty StudentFeePayment rows. If none
     * do (e.g. a stale enrollment that pre-dates the CPO fix), fall back to the first
     * admin encountered. Returns null when the candidate list is empty.
     */
    private Object[] pickAdminRowWithBills(List<Object[]> candidates) {
        if (candidates == null || candidates.isEmpty()) return null;
        // 1) Prefer an admin whose plan has a CPO ledger (SFP installment bills).
        for (Object[] row : candidates) {
            String userPlanId = (String) row[3];
            if (!StringUtils.hasText(userPlanId)) continue;
            if (!studentFeePaymentRepository.findByUserPlanId(userPlanId).isEmpty()) {
                return row;
            }
        }
        // 2) Otherwise prefer the admin who actually PAID. A sub-org can have several
        //    ROOT_ADMINs (e.g. a free co-admin added later); the payer is the meaningful
        //    "Admin payment" to surface. This also makes selection DETERMINISTIC — the
        //    roster query is unordered, so without a real signal the displayed admin could
        //    flip between co-admins from one request to the next.
        for (Object[] row : candidates) {
            String userPlanId = (String) row[3];
            if (!StringUtils.hasText(userPlanId)) continue;
            if (paymentLogRepository.existsByUserPlanIdAndPaymentStatus(
                    userPlanId, PaymentStatusEnum.PAID.name())) {
                return row;
            }
        }
        // 3) Deterministic fallback (no bills, no payment on any admin yet): earliest-enrolled,
        //    tie-broken by mapping id, so the same admin shows on every request. Compare the
        //    enrolled_date (row[5]) by its epoch value — java.sql.Date/Timestamp both extend
        //    java.util.Date — with null-enrolled rows sorted last, rather than by string form.
        return candidates.stream()
                .min(Comparator
                        .comparingLong((Object[] r) -> r[5] instanceof java.util.Date
                                ? ((java.util.Date) r[5]).getTime() : Long.MAX_VALUE)
                        .thenComparing(r -> r[0] == null ? "" : r[0].toString()))
                .orElse(candidates.get(0));
    }

    /**
     * Seat cap summary. {@code used} is the active learner mapping count (admins excluded
     * by the partition above). {@code total} comes from {@link SubOrgSeatCapResolver}, and is
     * null when no cap is configured anywhere.
     */
    private SubOrgFinanceDetailDTO.SeatUsage buildSeatUsage(Object[] adminRow,
                                                            List<Object[]> learnerRows,
                                                            String subOrgId,
                                                            String parentInstituteId) {
        int used = learnerRows != null ? learnerRows.size() : 0;
        PaymentPlan adminPlan = null;
        if (adminRow != null) {
            String adminUserPlanId = (String) adminRow[3];
            if (StringUtils.hasText(adminUserPlanId)) {
                Optional<UserPlan> upOpt = userPlanRepository.findById(adminUserPlanId);
                if (upOpt.isPresent()) {
                    adminPlan = upOpt.get().getPaymentPlan();
                }
            }
        }
        Integer total = seatCapResolver.resolve(subOrgId, parentInstituteId, adminPlan);
        Integer remaining = (total != null) ? Math.max(0, total - used) : null;
        return SubOrgFinanceDetailDTO.SeatUsage.builder()
                .used(used)
                .total(total)
                .remaining(remaining)
                .build();
    }

    private Map<String, UserDTO> fetchUsers(List<Object[]> rows) {
        List<String> userIds = new ArrayList<>(rows.size());
        for (Object[] row : rows) {
            String userId = (String) row[1];
            if (userId != null) userIds.add(userId);
        }
        if (userIds.isEmpty()) return Map.of();
        try {
            List<UserDTO> users = authService.getUsersFromAuthServiceByUserIds(userIds);
            Map<String, UserDTO> result = new HashMap<>(users.size());
            for (UserDTO u : users) {
                if (u != null && u.getId() != null) result.put(u.getId(), u);
            }
            return result;
        } catch (Exception e) {
            log.warn("Failed to resolve user names for sub-org finance detail: {}", e.getMessage());
            return Map.of();
        }
    }

    private SubOrgFinanceDetailDTO.AdminPayment buildAdminPayment(Object[] row, Map<String, UserDTO> userMap) {
        String userId = (String) row[1];
        String userPlanId = (String) row[3];
        UserDTO user = userMap.get(userId);
        String fullName = user != null ? user.getFullName() : (String) row[6];

        SubOrgFinanceDetailDTO.AdminPayment.AdminPaymentBuilder builder =
                SubOrgFinanceDetailDTO.AdminPayment.builder()
                        .userId(userId)
                        .fullName(fullName)
                        .userPlanId(userPlanId);

        if (!StringUtils.hasText(userPlanId)) return builder.build();

        Optional<UserPlan> userPlanOpt = userPlanRepository.findById(userPlanId);
        if (userPlanOpt.isEmpty()) return builder.build();

        UserPlan userPlan = userPlanOpt.get();
        builder.userPlanStatus(userPlan.getStatus())
                .startDate(userPlan.getStartDate())
                .endDate(userPlan.getEndDate());

        // Resolve PaymentOption to expose payment_type + cpo id. UserPlan.paymentOption is LAZY,
        // and the json snapshot may be stale post-CPO-sync, so re-read from the repo.
        PaymentOption paymentOption = null;
        if (StringUtils.hasText(userPlan.getPaymentOptionId())) {
            paymentOption = paymentOptionRepository.findById(userPlan.getPaymentOptionId()).orElse(null);
        }
        if (paymentOption != null) {
            builder.paymentType(paymentOption.getType())
                    .complexPaymentOptionId(paymentOption.getComplexPaymentOptionId());
        }

        // CPO ledger
        List<StudentFeePayment> sfps = studentFeePaymentRepository.findByUserPlanId(userPlanId);
        if (!sfps.isEmpty()) {
            attachLedger(builder, sfps);
        }

        return builder.build();
    }

    /**
     * Builds one learner row from ALL of a user's active sub-org mappings (a learner can be
     * enrolled in several package sessions). Collects every distinct package session and
     * combines dues across the learner's distinct user plans.
     */
    private SubOrgFinanceDetailDTO.LearnerRow buildLearnerRow(List<Object[]> rows, Map<String, UserDTO> userMap) {
        Object[] first = rows.get(0);
        String userId = (String) first[1];
        UserDTO user = userMap.get(userId);
        String fullName = user != null ? user.getFullName() : (String) first[6];

        // Distinct package sessions + earliest enrolled date across all mappings.
        List<String> packageSessionIds = new ArrayList<>();
        Date enrolledDate = null;
        for (Object[] row : rows) {
            String psId = (String) row[2];
            if (StringUtils.hasText(psId) && !packageSessionIds.contains(psId)) {
                packageSessionIds.add(psId);
            }
            Date d = row[5] instanceof Date dd ? dd : null;
            if (d != null && (enrolledDate == null || d.before(enrolledDate))) {
                enrolledDate = d;
            }
        }

        // Combined dues across the learner's distinct user plans (FREE scoped learners have
        // no SFP rows, so this is usually zero — but a CPO-enrolled learner will have them).
        BigDecimal outstanding = BigDecimal.ZERO;
        int pending = 0;
        SubOrgFinanceDetailDTO.Installment nextDue = null;
        List<String> seenPlans = new ArrayList<>();
        for (Object[] row : rows) {
            String userPlanId = (String) row[3];
            if (!StringUtils.hasText(userPlanId) || seenPlans.contains(userPlanId)) continue;
            seenPlans.add(userPlanId);
            List<StudentFeePayment> sfps = studentFeePaymentRepository.findByUserPlanId(userPlanId);
            if (sfps.isEmpty()) continue;
            outstanding = outstanding.add(sumOutstanding(sfps));
            pending += countPending(sfps);
            SubOrgFinanceDetailDTO.Installment candidate = nextDue(sfps);
            if (candidate != null && candidate.getDueDate() != null
                    && (nextDue == null || nextDue.getDueDate() == null
                        || candidate.getDueDate().before(nextDue.getDueDate()))) {
                nextDue = candidate;
            }
        }

        return SubOrgFinanceDetailDTO.LearnerRow.builder()
                .userId(userId)
                .fullName(fullName)
                .packageSessionId(packageSessionIds.isEmpty() ? null : packageSessionIds.get(0))
                .packageSessionIds(packageSessionIds)
                .userPlanId((String) first[3])
                .enrolledDate(enrolledDate)
                .outstandingAmount(outstanding)
                .pendingInstallmentsCount(pending)
                .nextDue(nextDue)
                .build();
    }

    private void attachLedger(SubOrgFinanceDetailDTO.AdminPayment.AdminPaymentBuilder builder,
                              List<StudentFeePayment> sfps) {
        BigDecimal total = BigDecimal.ZERO;
        BigDecimal paid = BigDecimal.ZERO;
        BigDecimal outstanding = BigDecimal.ZERO;
        int pending = 0;
        List<SubOrgFinanceDetailDTO.Installment> ledger = new ArrayList<>(sfps.size());

        // Stable order by due date (nulls last) keeps the UI ledger consistent across reads.
        List<StudentFeePayment> ordered = new ArrayList<>(sfps);
        ordered.sort(Comparator.comparing(StudentFeePayment::getDueDate,
                Comparator.nullsLast(Comparator.naturalOrder())));

        for (StudentFeePayment sfp : ordered) {
            BigDecimal expected = nullToZero(sfp.getAmountExpected());
            BigDecimal amountPaid = nullToZero(sfp.getAmountPaid());
            BigDecimal original = sfp.getOriginalAmount() != null ? sfp.getOriginalAmount() : expected;
            total = total.add(original);
            paid = paid.add(amountPaid);
            if (!SFP_STATUS_PAID.equalsIgnoreCase(sfp.getStatus())) {
                outstanding = outstanding.add(expected.subtract(amountPaid).max(BigDecimal.ZERO));
                pending++;
            }
            ledger.add(SubOrgFinanceDetailDTO.Installment.builder()
                    .studentFeePaymentId(sfp.getId())
                    .amountExpected(expected)
                    .amountPaid(amountPaid)
                    .dueDate(sfp.getDueDate())
                    .status(sfp.getStatus())
                    .build());
        }

        builder.totalAmount(total)
                .paidAmount(paid)
                .outstandingAmount(outstanding)
                .installmentCount(ledger.size())
                .pendingInstallmentsCount(pending)
                .installments(ledger)
                .nextDue(firstUnpaid(ledger));
    }

    private static SubOrgFinanceDetailDTO.Installment firstUnpaid(List<SubOrgFinanceDetailDTO.Installment> ledger) {
        for (SubOrgFinanceDetailDTO.Installment i : ledger) {
            if (!SFP_STATUS_PAID.equalsIgnoreCase(i.getStatus())) return i;
        }
        return null;
    }

    private static BigDecimal sumOutstanding(List<StudentFeePayment> sfps) {
        BigDecimal sum = BigDecimal.ZERO;
        for (StudentFeePayment sfp : sfps) {
            if (SFP_STATUS_PAID.equalsIgnoreCase(sfp.getStatus())) continue;
            BigDecimal expected = nullToZero(sfp.getAmountExpected());
            BigDecimal paid = nullToZero(sfp.getAmountPaid());
            sum = sum.add(expected.subtract(paid).max(BigDecimal.ZERO));
        }
        return sum;
    }

    private static int countPending(List<StudentFeePayment> sfps) {
        int n = 0;
        for (StudentFeePayment sfp : sfps) {
            if (!SFP_STATUS_PAID.equalsIgnoreCase(sfp.getStatus())) n++;
        }
        return n;
    }

    private static SubOrgFinanceDetailDTO.Installment nextDue(List<StudentFeePayment> sfps) {
        StudentFeePayment best = null;
        for (StudentFeePayment sfp : sfps) {
            if (SFP_STATUS_PAID.equalsIgnoreCase(sfp.getStatus())) continue;
            if (sfp.getDueDate() == null) continue;
            if (best == null || sfp.getDueDate().before(best.getDueDate())) best = sfp;
        }
        if (best == null) return null;
        return SubOrgFinanceDetailDTO.Installment.builder()
                .studentFeePaymentId(best.getId())
                .amountExpected(nullToZero(best.getAmountExpected()))
                .amountPaid(nullToZero(best.getAmountPaid()))
                .dueDate(best.getDueDate())
                .status(best.getStatus())
                .build();
    }

    private static BigDecimal nullToZero(BigDecimal v) {
        return v != null ? v : BigDecimal.ZERO;
    }
}
