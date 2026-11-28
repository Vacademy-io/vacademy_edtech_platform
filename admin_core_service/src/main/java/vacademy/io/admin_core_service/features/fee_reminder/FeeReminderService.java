package vacademy.io.admin_core_service.features.fee_reminder;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.commerce.common.CommercePlans;
import vacademy.io.admin_core_service.features.enrolment_break.service.EnrolmentBreakGuard;
import vacademy.io.admin_core_service.features.institute.service.InstituteTimezoneService;
import vacademy.io.admin_core_service.features.regional_pricing.service.RegionalPriceLock;
import vacademy.io.admin_core_service.features.user_subscription.entity.UserPlan;
import vacademy.io.admin_core_service.features.user_subscription.repository.UserPlanRepository;
import vacademy.io.admin_core_service.features.workflow.enums.WorkflowTriggerEvent;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowTriggerService;
import vacademy.io.common.auth.dto.UserDTO;

import java.sql.Date;
import java.sql.Timestamp;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Sends each membership's payment reminders on the institute's own schedule
 * (FEE_REMINDER_SETTING, see {@link FeeReminderSettings}): days before the due date, on it, and
 * every N days after, plus a one-off red-list alert. The due date is the membership's end date,
 * which for a monthly member is the next payment day.
 *
 * <p>Nothing is sent directly: each step fires the workflow event MEMBERSHIP_PAYMENT_DUE (or
 * MEMBERSHIP_PAYMENT_RED_LIST), and the institute's workflow picks the channel and template.
 * The context carries the amount, currency, due date, days overdue and a pay link to the
 * learner's own subscriptions page. Each step goes out once (fee_reminder_log). Learners on a
 * break with fee reminders stopped, paused memberships, shop orders and (unless the institute
 * asks) autopay members are skipped. Institutes without the setting are never queried.
 */
@Slf4j
@Service
public class FeeReminderService {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    @Autowired private JdbcTemplate jdbc;
    @Autowired private UserPlanRepository userPlanRepository;
    @Autowired private WorkflowTriggerService workflowTriggerService;
    @Autowired private InstituteTimezoneService timezoneService;
    @Autowired private AuthService authService;
    @Autowired(required = false) private EnrolmentBreakGuard breakGuard;
    @Autowired(required = false) private CommercePlans commercePlans;
    @Autowired private PlatformTransactionManager transactionManager;

    record InstituteRow(String id, FeeReminderSettings settings, String learnerPortal) {}

    /** Institutes that switched the schedule on. One query; others are never touched. */
    List<InstituteRow> institutesWithSchedule() {
        List<InstituteRow> out = new ArrayList<>();
        jdbc.query("SELECT id, setting_json, learner_portal_base_url FROM institutes "
                        + "WHERE setting_json LIKE '%" + FeeReminderSettings.SETTING_KEY + "%'",
                rs -> {
                    try {
                        JsonNode data = MAPPER.readTree(rs.getString("setting_json"))
                                .path("setting").path(FeeReminderSettings.SETTING_KEY).path("data");
                        FeeReminderSettings s = FeeReminderSettings.from(data);
                        if (s.enabled()) out.add(new InstituteRow(rs.getString("id"), s, rs.getString("learner_portal_base_url")));
                    } catch (Exception e) {
                        log.warn("[fee-reminder] unreadable setting for institute {}: {}", rs.getString("id"), e.getMessage());
                    }
                });
        return out;
    }

    /** One pass over every opted-in institute whose local send hour has come. Returns events fired. */
    public int run() {
        int fired = 0;
        for (InstituteRow inst : institutesWithSchedule()) {
            try {
                ZoneId zone = timezoneService.getZone(inst.id());
                ZonedDateTime now = ZonedDateTime.now(zone);
                if (now.getHour() < inst.settings().sendHour()) continue;
                fired += runInstitute(inst, now.toLocalDate(), zone);
            } catch (Exception e) {
                log.error("[fee-reminder] institute {} failed: {}", inst.id(), e.getMessage(), e);
            }
        }
        return fired;
    }

    int runInstitute(InstituteRow inst, LocalDate today, ZoneId zone) {
        FeeReminderSettings s = inst.settings();
        int lookBack = s.stopAfterDays() != null ? s.stopAfterDays()
                : Math.max(400, s.redListAfterDays() == null ? 0 : s.redListAfterDays());
        Timestamp from = Timestamp.from(today.minusDays(lookBack).atStartOfDay(zone).toInstant());
        Timestamp to = Timestamp.from(today.plusDays(s.maxDaysBefore() + 1L).atStartOfDay(zone).toInstant());
        List<String> planIds = jdbc.queryForList("""
                SELECT up.id FROM user_plan up
                  JOIN enroll_invite ei ON ei.id = up.enroll_invite_id
                  LEFT JOIN payment_option po ON po.id = up.payment_option_id
                 WHERE ei.institute_id = ? AND up.status = 'ACTIVE'
                   AND up.end_date >= ? AND up.end_date < ?
                   AND (po.type IS NULL OR po.type IN ('SUBSCRIPTION', 'ONE_TIME'))
                """, String.class, inst.id(), from, to);
        if (planIds.isEmpty()) return 0;

        // Plans and their lazy price plan are read inside one short read-only transaction (the job
        // runs outside any session); everything later steps need is copied into Pending.
        List<Pending> pending = new ArrayList<>();
        readOnly().executeWithoutResult(tx -> {
            for (UserPlan plan : userPlanRepository.findAllById(planIds)) {
                if (plan.getEndDate() == null) continue;
                if (commercePlans != null && commercePlans.isCommercePlan(plan)) continue;
                boolean autopay = Boolean.TRUE.equals(plan.getAutoRenewalEnabled());
                if (autopay && !s.includeAutopay()) continue;
                if (breakGuard != null && breakGuard.isFeeHeldForPlan(inst.id(), plan.getUserId(), plan.getId())) continue;
                double amount = RegionalPriceLock.linePrice(plan);
                if (amount <= 0) continue;
                LocalDate due = plan.getEndDate().toInstant().atZone(zone).toLocalDate();
                long daysToDue = ChronoUnit.DAYS.between(today, due);
                PlanInfo info = new PlanInfo(plan.getId(), plan.getUserId(), plan.getEnrollInviteId(),
                        RegionalPriceLock.currency(plan, plan.getPaymentPlan() != null ? plan.getPaymentPlan().getCurrency() : null),
                        plan.getPaymentPlan() != null ? plan.getPaymentPlan().getName() : null);
                String step = s.stepFor(daysToDue);
                if (step != null) pending.add(new Pending(info, due, daysToDue, step, false, amount, autopay));
                if (s.redListAfterDays() != null && -daysToDue == s.redListAfterDays()) {
                    pending.add(new Pending(info, due, daysToDue, "RED_LIST", true, amount, autopay));
                }
            }
        });
        if (pending.isEmpty()) return 0;

        Map<String, UserDTO> users = new HashMap<>();
        try {
            authService.getUsersFromAuthServiceByUserIds(
                            pending.stream().map(p -> p.plan().userId()).distinct().toList())
                    .forEach(u -> users.put(u.getId(), u));
        } catch (Exception e) {
            log.warn("[fee-reminder] user lookup failed for institute {}: {}", inst.id(), e.getMessage());
        }

        int fired = 0;
        for (Pending p : pending) {
            if (!claim(inst.id(), p)) continue; // already sent
            PlanInfo plan = p.plan();
            UserDTO user = users.get(plan.userId());
            Map<String, Object> ctx = new HashMap<>();
            ctx.put("userPlanId", plan.id());
            ctx.put("userId", plan.userId());
            ctx.put("enrollInviteId", plan.enrollInviteId());
            ctx.put("dueDate", p.due().toString());
            ctx.put("daysToDue", p.daysToDue());
            ctx.put("daysOverdue", Math.max(0, -p.daysToDue()));
            ctx.put("stage", p.daysToDue() > 0 ? "BEFORE" : p.daysToDue() == 0 ? "DUE" : "OVERDUE");
            ctx.put("step", p.step());
            ctx.put("amount", formatAmount(p.amount()));
            ctx.put("currency", plan.currency());
            ctx.put("planName", plan.planName());
            ctx.put("autopay", p.autopay());
            if (user != null) {
                ctx.put("learnerName", user.getFullName());
                ctx.put("learnerEmail", user.getEmail());
                ctx.put("learnerMobile", user.getMobileNumber());
            }
            String payLink = payLink(inst.learnerPortal(), user);
            if (payLink != null) ctx.put("payLink", payLink);
            String event = p.redList() ? WorkflowTriggerEvent.MEMBERSHIP_PAYMENT_RED_LIST.name()
                    : WorkflowTriggerEvent.MEMBERSHIP_PAYMENT_DUE.name();
            try {
                workflowTriggerService.handleTriggerEvents(event,
                        plan.id() + ":" + p.due() + ":" + p.step(), inst.id(), ctx);
                fired++;
            } catch (Exception e) {
                log.warn("[fee-reminder] {} for plan {} failed: {}", event, plan.id(), e.getMessage());
            }
        }
        if (fired > 0) log.info("[fee-reminder] institute {}: {} reminder event(s)", inst.id(), fired);
        return fired;
    }

    record PlanInfo(String id, String userId, String enrollInviteId, String currency, String planName) {}

    record Pending(PlanInfo plan, LocalDate due, long daysToDue, String step, boolean redList,
                   double amount, boolean autopay) {}

    private TransactionTemplate readOnly() {
        TransactionTemplate t = new TransactionTemplate(transactionManager);
        t.setReadOnly(true);
        return t;
    }

    /** Records the step; false when it was already sent (unique key), so each step goes out once. */
    boolean claim(String instituteId, Pending p) {
        int n = jdbc.update("""
                INSERT INTO fee_reminder_log (id, institute_id, user_plan_id, due_date, step)
                VALUES (?, ?, ?, ?, ?) ON CONFLICT (user_plan_id, due_date, step) DO NOTHING
                """, UUID.randomUUID().toString(), instituteId, p.plan().id(), Date.valueOf(p.due()), p.step());
        return n > 0;
    }

    static String payLink(String learnerPortal, UserDTO user) {
        if (!StringUtils.hasText(learnerPortal) || user == null || !StringUtils.hasText(user.getUsername())) return null;
        String base = learnerPortal.trim();
        if (!base.startsWith("http")) base = "https://" + base;
        if (base.endsWith("/")) base = base.substring(0, base.length() - 1);
        return base + "/subscriptions/" + java.net.URLEncoder.encode(user.getUsername(), java.nio.charset.StandardCharsets.UTF_8);
    }

    static String formatAmount(double amount) {
        return amount == Math.rint(amount) ? String.valueOf((long) amount) : String.format(java.util.Locale.ROOT, "%.2f", amount);
    }
}
