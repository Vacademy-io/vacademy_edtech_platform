package vacademy.io.admin_core_service.features.user_subscription.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.common.enums.StatusEnum;
import vacademy.io.admin_core_service.features.common.util.JsonUtil;
import vacademy.io.admin_core_service.features.enroll_invite.repository.PackageSessionLearnerInvitationToPaymentOptionRepository;
import vacademy.io.admin_core_service.features.institute_learner.entity.StudentSessionInstituteGroupMapping;
import vacademy.io.admin_core_service.features.institute_learner.enums.LearnerSessionStatusEnum;
import vacademy.io.admin_core_service.features.institute_learner.enums.LearnerSessionTypeEnum;
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionInstituteGroupMappingRepository;
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionRepository;
import vacademy.io.admin_core_service.features.invoice.service.InvoiceService;
import vacademy.io.admin_core_service.features.learner_access.enums.LearnerAccessSourceEnum;
import vacademy.io.admin_core_service.features.learner_access.service.LearnerAccessService;
import vacademy.io.admin_core_service.features.offline_payment.service.OfflinePaymentDetailsService;
import vacademy.io.admin_core_service.features.packages.repository.PackageSessionRepository;
import vacademy.io.admin_core_service.features.regional_pricing.service.RegionalPriceLock;
import vacademy.io.admin_core_service.features.timeline.dto.TimelineEventDTO;
import vacademy.io.admin_core_service.features.timeline.dto.TimelineEventRequestDTO;
import vacademy.io.admin_core_service.features.timeline.service.TimelineEventService;
import vacademy.io.admin_core_service.features.user_account.service.UserAccountLedgerService;
import vacademy.io.admin_core_service.features.user_subscription.dto.ChangePlanEndDateRequestDTO;
import vacademy.io.admin_core_service.features.user_subscription.dto.ManualRenewalPreviewDTO;
import vacademy.io.admin_core_service.features.user_subscription.dto.ManualRenewalRequestDTO;
import vacademy.io.admin_core_service.features.user_subscription.dto.ManualRenewalResultDTO;
import vacademy.io.admin_core_service.features.user_subscription.entity.UserPlan;
import vacademy.io.admin_core_service.features.user_subscription.enums.PaymentLogStatusEnum;
import vacademy.io.admin_core_service.features.user_subscription.enums.UserPlanStatusEnum;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentLogRepository;
import vacademy.io.admin_core_service.features.user_subscription.repository.UserPlanRepository;
import vacademy.io.admin_core_service.features.user_subscription.util.PlanValidityResolver;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.Institute;
import vacademy.io.common.institute.entity.session.PackageSession;
import vacademy.io.common.payment.enums.PaymentGateway;
import vacademy.io.common.payment.enums.PaymentStatusEnum;

import java.math.BigDecimal;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Date;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * Admin-recorded renewal: the member paid outside the platform and an admin extends the
 * membership by hand, leaving a remark the other admins can read.
 *
 * <p>Deliberately quieter than the gateway renewal ({@code RenewalPaymentService}), which
 * always invoices, emails and fires PAYMENT_SUCCESS workflows. Here nothing reaches the
 * member unless the admin asks for it, and autopay is never armed: the plan's
 * {@code auto_renewal_enabled} is left exactly as it was, so a member in manual mode stays
 * in manual mode and no charge is scheduled against them.
 *
 * <p>Remarks live in {@code timeline_event} (type {@value #REMARK_TYPE}, type_id = the
 * user plan), so they also appear on the learner's timeline.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class AdminManualRenewalService {

    public static final String REMARK_TYPE = "USER_PLAN";
    public static final String ACTION_RENEWAL = "MANUAL_RENEWAL";
    public static final String ACTION_REMARK = "PLAN_REMARK";
    public static final String ACTION_END_DATE_CHANGE = "END_DATE_CHANGE";

    /** A terminated membership was ended on purpose; it is re-enrolled, not renewed. */
    private static final Set<String> NOT_RENEWABLE = Set.of(UserPlanStatusEnum.TERMINATED.name());

    /** Access rows that a renewal brings back, alongside the ACTIVE ones it extends. */
    private static final List<String> REACTIVATABLE = List.of(
            LearnerSessionStatusEnum.INACTIVE.name(), LearnerSessionStatusEnum.EXPIRED.name());

    private final UserPlanRepository userPlanRepository;
    private final StudentSessionInstituteGroupMappingRepository mappingRepository;
    private final PaymentLogService paymentLogService;
    private final PaymentLogRepository paymentLogRepository;
    private final OfflinePaymentDetailsService offlinePaymentDetailsService;
    private final UserAccountLedgerService userAccountLedgerService;
    private final LearnerAccessService learnerAccessService;
    private final TimelineEventService timelineEventService;
    private final InvoiceService invoiceService;
    private final AuthService authService;
    private final PackageSessionLearnerInvitationToPaymentOptionRepository invitationRepository;
    private final PackageSessionRepository packageSessionRepository;
    private final StudentSessionRepository studentSessionRepository;

    @Transactional(readOnly = true)
    public ManualRenewalPreviewDTO preview(String userPlanId, String instituteId) {
        UserPlan plan = loadForInstitute(userPlanId, instituteId);
        String reason = notRenewableReason(plan);
        return ManualRenewalPreviewDTO.builder()
                .userPlanId(plan.getId())
                .status(plan.getStatus())
                .currentEndDate(plan.getEndDate())
                .suggestedEndDate(defaultNewEndDate(plan, new Date()))
                .validityDays(PlanValidityResolver.resolveValidityDays(plan))
                .suggestedAmount(RegionalPriceLock.listPrice(plan))
                .currency(currencyOf(plan, null))
                .autoRenewalEnabled(Boolean.TRUE.equals(plan.getAutoRenewalEnabled()))
                .renewable(reason == null)
                .notRenewableReason(reason)
                .build();
    }

    @Transactional
    public ManualRenewalResultDTO renew(String userPlanId, String instituteId,
                                        ManualRenewalRequestDTO req, CustomUserDetails admin) {
        if (req == null || req.getAmount() == null || req.getAmount() < 0) {
            throw new VacademyException("Enter the amount received (0 or more)");
        }
        // Every manual renewal must say why, so the other admins can follow it later.
        if (!StringUtils.hasText(req.getRemarks())) {
            throw new VacademyException("Add a remark explaining this renewal");
        }
        UserPlan plan = loadForInstitute(userPlanId, instituteId);
        String reason = notRenewableReason(plan);
        if (reason != null) {
            throw new VacademyException(reason);
        }

        Date now = new Date();
        Date newEndDate = req.getNewEndDate() != null ? req.getNewEndDate() : defaultNewEndDate(plan, now);
        if (!newEndDate.after(now)) {
            throw new VacademyException("The new end date must be in the future");
        }

        List<StudentSessionInstituteGroupMapping> active = mappingRepository
                .findByUserPlanIdAndStatus(plan.getId(), LearnerSessionStatusEnum.ACTIVE.name());
        List<StudentSessionInstituteGroupMapping> lapsed = new ArrayList<>();
        for (String status : REACTIVATABLE) {
            lapsed.addAll(mappingRepository.findByUserPlanIdAndStatus(plan.getId(), status));
        }
        // No access row is linked to the plan: older enrolments and imports often left
        // user_plan_id empty, and some plans were never given their course at all. The gateway
        // renewal enrols here, which fires the enrolment workflow and its emails; a silent admin
        // action must not, so the plan's own course rows are adopted or built directly instead.
        // Resolved before anything is written, so a refusal still leaves nothing behind.
        List<StudentSessionInstituteGroupMapping> granted = new ArrayList<>();
        if (active.isEmpty() && lapsed.isEmpty()) {
            granted = accessForUnlinkedPlan(plan, instituteId);
            if (granted.isEmpty()) {
                throw new VacademyException("This membership's invite has no course to give access to. "
                        + "Enrol the learner instead of renewing.");
            }
        }

        String adminId = admin != null ? admin.getUserId() : null;
        String adminName = admin != null ? admin.getUsername() : null;
        String currency = currencyOf(plan, req.getCurrency());

        // Validate how it was paid before anything is written.
        // A payment mode is enforced (where the institute requires one) only when money changed hands.
        OfflinePaymentDetailsService.Resolved paymentDetails = offlinePaymentDetailsService.resolve(
                instituteId, req.getPaymentDetails(), null, req.getAmount() > 0);
        Date paymentDate = req.getPaymentDate() != null ? req.getPaymentDate()
                : paymentDetails != null && paymentDetails.paymentDate() != null
                        ? java.sql.Date.valueOf(paymentDetails.paymentDate())
                        : now;

        String paymentLogId = null;
        if (req.getAmount() > 0) {
            paymentLogId = paymentLogService.createPaymentLog(plan.getUserId(), req.getAmount(),
                    PaymentGateway.MANUAL.name(), PaymentGateway.MANUAL.name(), currency, plan, null, paymentDate);
            Map<String, Object> data = new HashMap<>();
            if (paymentDetails != null && StringUtils.hasText(paymentDetails.reference())) {
                data.put("transaction_id", paymentDetails.reference());
            }
            data.put("source", ACTION_RENEWAL);
            data.put("recorded_by", adminId);
            // updatePaymentLogOnly, not updatePaymentLog: the latter's PAID branch invoices and
            // emails the member, which the admin may not want.
            paymentLogService.updatePaymentLogOnly(paymentLogId, PaymentLogStatusEnum.SUCCESS.name(),
                    PaymentStatusEnum.PAID.name(), JsonUtil.toJson(data));
            offlinePaymentDetailsService.apply(paymentLogId, paymentDetails, adminId);
            // Accrual + credit pair, as a gateway renewal books it, so Total Billed and Total
            // Paid both move and the balance is unchanged.
            // The remark rides on the ledger rows so Payment History shows why it was recorded.
            try {
                userAccountLedgerService.recordSettledCharge(plan.getUserId(), instituteId,
                        BigDecimal.valueOf(req.getAmount()), currency, null,
                        "USER_PLAN", plan.getId(), paymentLogId, "Manual renewal: " + req.getRemarks().trim());
            } catch (Exception e) {
                log.error("Manual renewal of plan {}: ledger posting failed for payment {}: {}",
                        plan.getId(), paymentLogId, e.getMessage(), e);
            }
        }

        String previousStatus = plan.getStatus();
        Date previousEndDate = plan.getEndDate();
        plan.setEndDate(newEndDate);
        plan.setStatus(UserPlanStatusEnum.ACTIVE.name());
        plan.setIsTrial(false);
        plan.setRenewalAttemptCount(0);
        plan.setLastRenewalAttemptAt(null);
        // auto_renewal_enabled is left alone. A charge is only scheduled where the member
        // already had autopay on; otherwise nothing is due to be taken automatically.
        boolean autopayOn = Boolean.TRUE.equals(plan.getAutoRenewalEnabled());
        plan.setNextChargeAt(autopayOn ? newEndDate : null);
        userPlanRepository.save(plan);

        String grantReason = "Manual renewal recorded by admin";
        List<StudentSessionInstituteGroupMapping> touched = new ArrayList<>(active);
        touched.addAll(lapsed);
        touched.addAll(granted);
        for (StudentSessionInstituteGroupMapping m : touched) {
            Date previousExpiry = m.getExpiryDate();
            if (m.getUserPlanId() == null) {
                m.setUserPlanId(plan.getId());
            }
            m.setStatus(LearnerSessionStatusEnum.ACTIVE.name());
            m.setExpiryDate(newEndDate);
            mappingRepository.save(m);
            learnerAccessService.recordGrant(LearnerAccessSourceEnum.RENEWAL, instituteId, m, previousExpiry,
                    null, plan.getId(), plan.getPaymentPlanId(), plan.getEnrollInviteId(),
                    grantReason, adminId, adminName);
        }

        Map<String, Object> metadata = new LinkedHashMap<>();
        metadata.put("amount", req.getAmount());
        metadata.put("currency", currency);
        metadata.put("payment_date", isoDate(paymentDate));
        metadata.put("previous_status", previousStatus);
        metadata.put("previous_end_date", previousEndDate != null ? isoDate(previousEndDate) : null);
        metadata.put("new_end_date", isoDate(newEndDate));
        metadata.put("payment_log_id", paymentLogId);
        if (paymentDetails != null) {
            metadata.put("payment_mode", paymentDetails.modeLabel() != null ? paymentDetails.modeLabel() : paymentDetails.mode());
            metadata.put("reference", paymentDetails.reference());
        }
        timelineEventService.createManualEvent(TimelineEventRequestDTO.builder()
                .type(REMARK_TYPE)
                .typeId(plan.getId())
                .actionType(ACTION_RENEWAL)
                .title(renewalTitle(req.getAmount(), currency, newEndDate))
                .description(StringUtils.hasText(req.getRemarks()) ? req.getRemarks().trim() : null)
                .metadata(metadata)
                .studentUserId(plan.getUserId())
                .build(), admin);

        boolean invoiceQueued = paymentLogId != null && req.isGenerateInvoice();
        if (invoiceQueued) {
            if (req.isSendEmail()) {
                // The normal offline-payment email: the invoice email, or the payment
                // confirmation with the PDF attached, per the institute's placement setting.
                String id = paymentLogId;
                paymentLogService.scheduleSyncInvoiceAfterCommit(paymentLogRepository.findById(id)
                        .orElseThrow(() -> new VacademyException("Payment not found: " + id)), instituteId);
            } else {
                scheduleSilentInvoice(paymentLogId, instituteId);
            }
        }

        log.info("Manual renewal of plan {} by {}: {} -> ACTIVE, end {} -> {}, {} access row(s), payment {}",
                plan.getId(), adminId, previousStatus, previousEndDate, newEndDate, touched.size(), paymentLogId);

        return ManualRenewalResultDTO.builder()
                .userPlanId(plan.getId())
                .paymentLogId(paymentLogId)
                .previousStatus(previousStatus)
                .status(plan.getStatus())
                .previousEndDate(previousEndDate)
                .newEndDate(newEndDate)
                .mappingsUpdated(touched.size())
                .invoiceQueued(invoiceQueued)
                .build();
    }

    /**
     * Moves an active membership's end date, and its course access with it, without a payment.
     * For corrections: the member paid on the 7th but was enrolled on the 23rd, a date typed
     * wrong at import. A lapsed membership is brought back with {@link #renew} instead, which
     * records what was paid.
     *
     * <p>Every change is traceable three ways: a remark on the membership (who, when, from and
     * to, why), a learner_access_log row per access row, and the admin activity log entry the
     * controller writes.
     */
    @Transactional
    public ManualRenewalResultDTO changeEndDate(String userPlanId, String instituteId,
                                                ChangePlanEndDateRequestDTO req, CustomUserDetails admin) {
        if (req == null || req.getNewEndDate() == null) {
            throw new VacademyException("Choose the new end date");
        }
        if (!StringUtils.hasText(req.getRemarks())) {
            throw new VacademyException("Add a remark explaining why the end date is changing");
        }
        UserPlan plan = loadForInstitute(userPlanId, instituteId);
        if (!UserPlanStatusEnum.ACTIVE.name().equalsIgnoreCase(plan.getStatus())) {
            throw new VacademyException("Only an active membership's end date can be changed. "
                    + "Use Renew manually to bring a lapsed membership back.");
        }
        Date now = new Date();
        Date newEndDate = req.getNewEndDate();
        if (!newEndDate.after(now)) {
            throw new VacademyException("The new end date must be in the future. "
                    + "To end a membership now, cancel it instead.");
        }
        if (plan.getStartDate() != null && !newEndDate.after(plan.getStartDate())) {
            throw new VacademyException("The new end date must be after the membership started");
        }

        List<StudentSessionInstituteGroupMapping> touched = new ArrayList<>(mappingRepository
                .findByUserPlanIdAndStatus(plan.getId(), LearnerSessionStatusEnum.ACTIVE.name()));
        for (String status : REACTIVATABLE) {
            touched.addAll(mappingRepository.findByUserPlanIdAndStatus(plan.getId(), status));
        }
        if (touched.isEmpty()) {
            // Same adoption as a renewal for plans whose access was never linked. A course the
            // member holds under another membership is left alone: the date fix still applies
            // to this membership, and moving that course would take it from the other one.
            try {
                touched.addAll(accessForUnlinkedPlan(plan, instituteId));
            } catch (VacademyException e) {
                log.info("End-date change on plan {}: access not adopted ({})", plan.getId(), e.getMessage());
            }
        }

        String adminId = admin != null ? admin.getUserId() : null;
        String adminName = admin == null ? null
                : StringUtils.hasText(admin.getFullName()) ? admin.getFullName() : admin.getUsername();
        String remarks = req.getRemarks().trim();

        Date previousEndDate = plan.getEndDate();
        plan.setEndDate(newEndDate);
        // A charge is only re-pointed where autopay is on; otherwise nothing is scheduled.
        if (Boolean.TRUE.equals(plan.getAutoRenewalEnabled())) {
            plan.setNextChargeAt(newEndDate);
        }
        userPlanRepository.save(plan);

        for (StudentSessionInstituteGroupMapping m : touched) {
            Date previousExpiry = m.getExpiryDate();
            if (m.getUserPlanId() == null) {
                m.setUserPlanId(plan.getId());
            }
            m.setStatus(LearnerSessionStatusEnum.ACTIVE.name());
            m.setExpiryDate(newEndDate);
            mappingRepository.save(m);
            learnerAccessService.recordGrant(LearnerAccessSourceEnum.ADMIN_EXTENSION, instituteId, m, previousExpiry,
                    null, plan.getId(), plan.getPaymentPlanId(), plan.getEnrollInviteId(),
                    "Membership end date changed: " + remarks, adminId, adminName);
        }

        Map<String, Object> metadata = new LinkedHashMap<>();
        metadata.put("previous_end_date", previousEndDate != null ? isoDate(previousEndDate) : null);
        metadata.put("new_end_date", isoDate(newEndDate));
        metadata.put("access_rows_updated", touched.size());
        timelineEventService.createManualEvent(TimelineEventRequestDTO.builder()
                .type(REMARK_TYPE)
                .typeId(plan.getId())
                .actionType(ACTION_END_DATE_CHANGE)
                .title(endDateChangeTitle(previousEndDate, newEndDate))
                .description(remarks)
                .metadata(metadata)
                .studentUserId(plan.getUserId())
                .build(), admin);

        log.info("End date of plan {} changed by {}: {} -> {}, {} access row(s)",
                plan.getId(), adminId, previousEndDate, newEndDate, touched.size());

        return ManualRenewalResultDTO.builder()
                .userPlanId(plan.getId())
                .previousStatus(plan.getStatus())
                .status(plan.getStatus())
                .previousEndDate(previousEndDate)
                .newEndDate(newEndDate)
                .mappingsUpdated(touched.size())
                .invoiceQueued(false)
                .build();
    }

    @Transactional
    public TimelineEventDTO addRemark(String userPlanId, String instituteId, String remark, CustomUserDetails admin) {
        if (!StringUtils.hasText(remark)) {
            throw new VacademyException("Remark cannot be empty");
        }
        UserPlan plan = loadForInstitute(userPlanId, instituteId);
        return timelineEventService.createManualEvent(TimelineEventRequestDTO.builder()
                .type(REMARK_TYPE)
                .typeId(plan.getId())
                .actionType(ACTION_REMARK)
                .title("Remark")
                .description(remark.trim())
                .studentUserId(plan.getUserId())
                .build(), admin);
    }

    /**
     * Renewals and remarks on the plan, newest first, each with the full name of the admin who
     * wrote it. The timeline stores the login username; the name is looked up so the history
     * reads "Priya Sharma", not "priya.s@…". Falls back to the stored value if the lookup fails.
     */
    @Transactional(readOnly = true)
    public Page<TimelineEventDTO> listRemarks(String userPlanId, String instituteId, int page, int size) {
        UserPlan plan = loadForInstitute(userPlanId, instituteId);
        Page<TimelineEventDTO> events = timelineEventService.getTimelineEvents(REMARK_TYPE, plan.getId(),
                PageRequest.of(Math.max(page, 0), Math.min(Math.max(size, 1), 100)));
        Map<String, String> names = adminNames(events.getContent().stream()
                .map(TimelineEventDTO::getActorId).filter(StringUtils::hasText).distinct().toList());
        events.getContent().forEach(e -> {
            String name = e.getActorId() != null ? names.get(e.getActorId()) : null;
            if (StringUtils.hasText(name)) {
                e.setActorName(name);
            }
        });
        return events;
    }

    private Map<String, String> adminNames(List<String> userIds) {
        Map<String, String> out = new HashMap<>();
        if (userIds.isEmpty()) {
            return out;
        }
        try {
            for (UserDTO u : authService.getUsersFromAuthServiceByUserIds(userIds)) {
                if (u != null && u.getId() != null && StringUtils.hasText(u.getFullName())) {
                    out.put(u.getId(), u.getFullName().trim());
                }
            }
        } catch (Exception e) {
            log.warn("Could not resolve remark authors {}: {}", userIds, e.getMessage());
        }
        return out;
    }

    // ---------------------------------------------------------------- helpers

    /**
     * Access for a plan that has no row linked to it. For each course on the plan's invite, the
     * member's own unlinked row is adopted (an import that never set user_plan_id); where they
     * have none, a new row is built. Nothing is saved here: renew() links, extends and saves
     * them with the rest. A course already held under another membership is refused rather
     * than moved, since extending it here would take it away from that membership.
     */
    private List<StudentSessionInstituteGroupMapping> accessForUnlinkedPlan(UserPlan plan, String instituteId) {
        if (plan.getEnrollInvite() == null) {
            return List.of();
        }
        List<String> packageSessionIds = invitationRepository
                .findPackageSessionIdsByEnrollInviteAndStatusIn(plan.getEnrollInvite(), List.of(StatusEnum.ACTIVE.name()))
                .stream().distinct().toList();
        if (packageSessionIds.isEmpty()) {
            return List.of();
        }
        List<String> statuses = new ArrayList<>(REACTIVATABLE);
        statuses.add(LearnerSessionStatusEnum.ACTIVE.name());
        List<StudentSessionInstituteGroupMapping> held = mappingRepository
                .findAllByUserIdAndPackageSessionIdsAndStatus(plan.getUserId(), packageSessionIds, statuses);

        List<StudentSessionInstituteGroupMapping> out = new ArrayList<>();
        StudentSessionInstituteGroupMapping reference = null;
        for (String packageSessionId : packageSessionIds) {
            List<StudentSessionInstituteGroupMapping> rows = held.stream()
                    .filter(m -> m.getPackageSession() != null && packageSessionId.equals(m.getPackageSession().getId()))
                    .filter(m -> m.getInstitute() != null && instituteId.equals(m.getInstitute().getId()))
                    .toList();
            Optional<StudentSessionInstituteGroupMapping> unlinked = rows.stream()
                    .filter(m -> m.getUserPlanId() == null).findFirst();
            if (unlinked.isPresent()) {
                out.add(unlinked.get());
                continue;
            }
            if (!rows.isEmpty()) {
                throw new VacademyException("The learner already has this course under another membership. "
                        + "Renew that membership instead.");
            }
            if (reference == null) {
                reference = studentSessionRepository.findByInstituteIdAndUserIdNative(instituteId, plan.getUserId())
                        .orElse(null);
            }
            out.add(newAccessRow(plan.getUserId(), instituteId, packageSessionId, reference));
        }
        return out;
    }

    /** A course row shaped like an ordinary enrolment's; renew() sets status, expiry and plan. */
    private StudentSessionInstituteGroupMapping newAccessRow(String userId, String instituteId, String packageSessionId,
                                                             StudentSessionInstituteGroupMapping reference) {
        PackageSession packageSession = packageSessionRepository.findById(packageSessionId)
                .orElseThrow(() -> new VacademyException("Course not found: " + packageSessionId));
        StudentSessionInstituteGroupMapping m = new StudentSessionInstituteGroupMapping();
        m.setUserId(userId);
        m.setPackageSession(packageSession);
        m.setEnrolledDate(new Date());
        m.setType(LearnerSessionTypeEnum.PACKAGE_SESSION.name());
        m.setSource(ACTION_RENEWAL);
        if (reference != null) {
            m.setInstitute(reference.getInstitute());
            m.setInstituteEnrolledNumber(reference.getInstituteEnrolledNumber());
        } else {
            Institute institute = new Institute();
            institute.setId(instituteId);
            m.setInstitute(institute);
        }
        return m;
    }

    private UserPlan loadForInstitute(String userPlanId, String instituteId) {
        UserPlan plan = userPlanRepository.findById(userPlanId)
                .orElseThrow(() -> new VacademyException("Membership not found: " + userPlanId));
        String planInstitute = plan.getEnrollInvite() != null ? plan.getEnrollInvite().getInstituteId() : null;
        if (!StringUtils.hasText(instituteId) || !instituteId.equals(planInstitute)) {
            throw new VacademyException("Membership not found: " + userPlanId);
        }
        return plan;
    }

    static String notRenewableReason(UserPlan plan) {
        if (plan.getStatus() != null && NOT_RENEWABLE.contains(plan.getStatus().toUpperCase())) {
            return "A terminated membership cannot be renewed. Enrol the learner again instead.";
        }
        return null;
    }

    /**
     * Same rule as a gateway renewal: extend from the current end date while it is still
     * ahead (no days lost by renewing early), otherwise start from today.
     */
    static Date defaultNewEndDate(UserPlan plan, Date now) {
        Date base = plan.getEndDate();
        if (base == null || base.before(now)) {
            base = now;
        }
        Calendar c = Calendar.getInstance();
        c.setTime(base);
        c.add(Calendar.DAY_OF_MONTH, PlanValidityResolver.resolveValidityDays(plan));
        return c.getTime();
    }

    private static String currencyOf(UserPlan plan, String requested) {
        if (StringUtils.hasText(requested)) {
            return requested;
        }
        String base = plan.getPaymentPlan() != null && StringUtils.hasText(plan.getPaymentPlan().getCurrency())
                ? plan.getPaymentPlan().getCurrency() : "INR";
        return RegionalPriceLock.currency(plan, base);
    }

    private static String renewalTitle(double amount, String currency, Date newEndDate) {
        String until = new SimpleDateFormat("dd MMM yyyy").format(newEndDate);
        return amount > 0
                ? String.format("Manual renewal: %s %.2f received, access until %s", currency, amount, until)
                : "Manual renewal: access extended until " + until;
    }

    private static String endDateChangeTitle(Date previousEndDate, Date newEndDate) {
        SimpleDateFormat f = new SimpleDateFormat("dd MMM yyyy");
        return previousEndDate != null
                ? "End date changed from " + f.format(previousEndDate) + " to " + f.format(newEndDate)
                : "End date set to " + f.format(newEndDate);
    }

    private static String isoDate(Date d) {
        return new SimpleDateFormat("yyyy-MM-dd").format(d);
    }

    /**
     * After commit, like every other invoice path: generating inside this transaction would
     * hit the payment_log FK on the uncommitted row and roll the renewal back.
     */
    private void scheduleSilentInvoice(String paymentLogId, String instituteId) {
        Runnable task = () -> {
            try {
                invoiceService.generateInvoiceWithResultForCommittedPayment(paymentLogId, instituteId, /* sendEmail */ false);
            } catch (Exception e) {
                log.error("Manual renewal invoice failed for payment {}: {}", paymentLogId, e.getMessage(), e);
            }
        };
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    task.run();
                }
            });
        } else {
            task.run();
        }
    }
}
