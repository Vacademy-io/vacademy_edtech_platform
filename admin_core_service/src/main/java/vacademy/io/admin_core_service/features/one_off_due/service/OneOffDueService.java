package vacademy.io.admin_core_service.features.one_off_due.service;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.institute.service.setting.PaymentSettingService;
import vacademy.io.admin_core_service.features.invoice.dto.AdminCreateInvoiceRequestDTO;
import vacademy.io.admin_core_service.features.invoice.dto.AdminInvoiceLineItemRequestDTO;
import vacademy.io.admin_core_service.features.invoice.dto.AdminInvoicePaymentLinkResponseDTO;
import vacademy.io.admin_core_service.features.invoice.entity.Invoice;
import vacademy.io.admin_core_service.features.invoice.repository.InvoiceRepository;
import vacademy.io.admin_core_service.features.invoice.service.InvoiceService;
import vacademy.io.admin_core_service.features.one_off_due.dto.LearnerOneOffDuesDTO;
import vacademy.io.admin_core_service.features.one_off_due.dto.OneOffDueDTO;
import vacademy.io.admin_core_service.features.one_off_due.entity.OneOffDue;
import vacademy.io.admin_core_service.features.one_off_due.repository.OneOffDueRepository;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * One-off charges: staff add a single extra charge to one learner, the
 * learner pays it online like any other invoice.
 *
 * <p>Each charge is an ordinary admin invoice (source ADMIN_MANUAL) with one line, raised without
 * the in-app "new invoice" alert, plus a {@code one_off_due} row for the batch, staff note and
 * source. So it is payable through the institute's gateway on the existing /pay/invoice page,
 * shows in the learner's invoices, account summary and the institute invoice list, and can be
 * marked paid offline there. Status is the invoice's: PENDING_PAYMENT = due, PAID = paid,
 * REJECTED (or deleted) = cancelled.
 *
 * <p>Nothing here sends a message: creating raises no alert, email or workflow event, and
 * cancelling only voids the invoice. Nothing runs for an institute with the switch off.
 */
@Slf4j
@Service
public class OneOffDueService {

    @PersistenceContext
    private EntityManager em;

    @Autowired private OneOffDueRepository repository;
    @Autowired private OneOffDueSettings settings;
    @Autowired private InvoiceService invoiceService;
    @Autowired private InvoiceRepository invoiceRepository;
    @Autowired private PaymentSettingService paymentSettingService;

    /**
     * Adds a one-off charge for a learner and returns its id. Joins the caller's transaction, so a
     * caller that rolls back takes the charge (and its invoice) with it.
     *
     * @param packageSessionId the batch the charge relates to; optional, but when given the
     *                         learner must have (or have had) that batch at this institute
     * @param sourceType       e.g. "MANUAL" (staff screen) or "REENTRY_BRIDGE"; blank = MANUAL
     * @param sourceId         id of the record that caused the charge, optional
     * @throws VacademyException with a plain-language message when the feature is off, the amount
     *                           is not above zero, the learner is not in the institute, etc.
     */
    @Transactional
    public String create(String instituteId, String userId, String packageSessionId,
                         BigDecimal amount, LocalDate dueDate, String title, String note,
                         String sourceType, String sourceId, CustomUserDetails actor) {
        if (!StringUtils.hasText(instituteId)) {
            throw new VacademyException("Institute is required.");
        }
        if (!settings.isEnabled(instituteId)) {
            throw new VacademyException("One-off charges are switched off for this institute. "
                    + "Turn them on in Settings → One-off charges.");
        }
        if (!StringUtils.hasText(userId)) {
            throw new VacademyException("Choose the learner to charge.");
        }
        OneOffDueRules.Clean c = OneOffDueRules.validate(amount, dueDate, title, note, sourceType, sourceId,
                LocalDate.now());
        if (!isLearnerOfInstitute(userId, instituteId)) {
            throw new VacademyException("This learner is not enrolled at this institute.");
        }
        String psId = StringUtils.hasText(packageSessionId) ? packageSessionId.trim() : null;
        if (psId != null && !hasBatch(userId, instituteId, psId)) {
            throw new VacademyException("This learner is not in the chosen batch.");
        }
        String actorId = actor != null ? actor.getUserId() : null;
        String currency = paymentSettingService.getDefaultCurrency(instituteId);
        if (!StringUtils.hasText(currency)) currency = "INR";

        AdminInvoiceLineItemRequestDTO line = new AdminInvoiceLineItemRequestDTO();
        line.setDescription(c.title());
        line.setQuantity(1);
        line.setUnitPrice(c.amount());
        line.setItemType("SERVICE");

        AdminCreateInvoiceRequestDTO req = new AdminCreateInvoiceRequestDTO();
        req.setInstituteId(instituteId);
        req.setUserIds(List.of(userId));
        req.setLineItems(List.of(line));
        req.setCurrency(currency);
        req.setDueDate(c.dueDate().atTime(23, 59, 59));
        // The learner pays exactly the amount staff typed: no tax added on top.
        req.setTaxEnabled(false);

        List<AdminInvoicePaymentLinkResponseDTO> made =
                invoiceService.createAdminInvoices(req, actorId, false);
        if (made == null || made.isEmpty() || made.get(0).getInvoiceId() == null) {
            throw new VacademyException("The charge could not be created: the learner's account was not found.");
        }

        OneOffDue due = new OneOffDue();
        due.setInstituteId(instituteId);
        due.setUserId(userId);
        due.setInvoiceId(made.get(0).getInvoiceId());
        due.setPackageSessionId(psId);
        due.setTitle(c.title());
        due.setNote(c.note());
        due.setAmount(c.amount());
        due.setCurrency(currency);
        due.setDueDate(c.dueDate());
        due.setSourceType(c.sourceType());
        due.setSourceId(c.sourceId());
        due.setCreatedBy(actorId);
        due = repository.save(due);
        log.info("[one-off-due] created {} for user {} at {}: {} {} due {} (invoice {}, source {}/{})",
                due.getId(), userId, instituteId, c.amount(), currency, c.dueDate(), due.getInvoiceId(),
                c.sourceType(), c.sourceId());
        return due.getId();
    }

    /** Cancels an unpaid charge: its invoice is voided (no message is sent). */
    @Transactional
    public OneOffDueDTO cancel(String id, String instituteId, String reason, CustomUserDetails actor) {
        OneOffDue due = repository.findById(id)
                .filter(d -> d.getInstituteId().equals(instituteId))
                .orElseThrow(() -> new VacademyException("This charge was not found."));
        Invoice invoice = due.getInvoiceId() == null ? null
                : invoiceRepository.findById(due.getInvoiceId()).orElse(null);
        String status = OneOffDueRules.statusOf(invoice == null ? null : invoice.getStatus());
        OneOffDueRules.requireCancellable(status);
        String cleanReason = OneOffDueRules.cleanReason(reason);
        invoiceService.rejectInvoice(invoice.getId(), instituteId,
                cleanReason != null ? cleanReason : "One-off charge cancelled", actor);
        due.setCancelledAt(LocalDateTime.now());
        due.setCancelledBy(actor != null ? actor.getUserId() : null);
        due.setCancelReason(cleanReason);
        due = repository.save(due);
        log.info("[one-off-due] cancelled {} (invoice {})", due.getId(), due.getInvoiceId());
        return toDtos(List.of(due), true).get(0);
    }

    /** Staff view of a learner: the switch, the learner's batches and every charge. */
    @Transactional(readOnly = true)
    public LearnerOneOffDuesDTO forStaff(String userId, String instituteId) {
        boolean enabled = settings.isEnabled(instituteId);
        List<OneOffDue> dues = repository.findByUserIdAndInstituteIdOrderByCreatedAtDesc(userId, instituteId);
        List<LearnerOneOffDuesDTO.Course> courses = enabled ? courses(userId, instituteId) : List.of();
        return LearnerOneOffDuesDTO.builder()
                .enabled(enabled)
                .defaultCurrency(enabled ? paymentSettingService.getDefaultCurrency(instituteId) : null)
                .courses(courses)
                .dues(toDtos(dues, true))
                .build();
    }

    /**
     * The learner's own charges. Empty while the institute has the switch off, so nothing shows for
     * an institute that never turned it on. Staff notes are left out.
     */
    @Transactional(readOnly = true)
    public LearnerOneOffDuesDTO forLearner(String userId, String instituteId) {
        if (!settings.isEnabled(instituteId)) {
            return LearnerOneOffDuesDTO.builder().enabled(false).courses(List.of()).dues(List.of()).build();
        }
        List<OneOffDue> dues = repository.findByUserIdAndInstituteIdOrderByCreatedAtDesc(userId, instituteId);
        return LearnerOneOffDuesDTO.builder()
                .enabled(true)
                .courses(List.of())
                .dues(toDtos(dues, false))
                .build();
    }

    // ------------------------------------------------------------------ helpers

    private List<OneOffDueDTO> toDtos(List<OneOffDue> dues, boolean staff) {
        if (dues.isEmpty()) return List.of();
        List<String> invoiceIds = dues.stream().map(OneOffDue::getInvoiceId)
                .filter(StringUtils::hasText).distinct().toList();
        Map<String, Invoice> invoices = invoiceIds.isEmpty() ? Map.of()
                : invoiceRepository.findAllById(invoiceIds).stream()
                .collect(Collectors.toMap(Invoice::getId, Function.identity(), (a, b) -> a));
        Map<String, String> labels = courseLabels(dues.stream().map(OneOffDue::getPackageSessionId)
                .filter(StringUtils::hasText).distinct().toList());
        List<OneOffDueDTO> out = new ArrayList<>();
        for (OneOffDue d : dues) {
            Invoice inv = d.getInvoiceId() == null ? null : invoices.get(d.getInvoiceId());
            out.add(OneOffDueDTO.builder()
                    .id(d.getId())
                    .userId(d.getUserId())
                    .title(d.getTitle())
                    // Staff can edit the invoice from the invoice list; what is owed is the invoice's.
                    .amount(inv != null && inv.getTotalAmount() != null ? inv.getTotalAmount() : d.getAmount())
                    .currency(inv != null && inv.getCurrency() != null ? inv.getCurrency() : d.getCurrency())
                    .dueDate(inv != null && inv.getDueDate() != null ? inv.getDueDate().toLocalDate() : d.getDueDate())
                    .status(OneOffDueRules.statusOf(inv == null ? null : inv.getStatus()))
                    .invoiceId(inv == null ? null : inv.getId())
                    .invoiceNumber(inv == null ? null : inv.getInvoiceNumber())
                    .packageSessionId(d.getPackageSessionId())
                    .courseLabel(d.getPackageSessionId() == null ? null : labels.get(d.getPackageSessionId()))
                    .note(staff ? d.getNote() : null)
                    .sourceType(staff ? d.getSourceType() : null)
                    .sourceId(staff ? d.getSourceId() : null)
                    .createdBy(staff ? d.getCreatedBy() : null)
                    .createdAt(d.getCreatedAt())
                    .cancelledAt(d.getCancelledAt())
                    .cancelReason(staff ? d.getCancelReason() : null)
                    .build());
        }
        return out;
    }

    /** Any access row at this institute, whatever its status: a returning learner may be inactive. */
    boolean isLearnerOfInstitute(String userId, String instituteId) {
        List<?> rows = em.createNativeQuery("""
                SELECT 1 FROM student_session_institute_group_mapping
                 WHERE user_id = :userId AND institute_id = :instituteId
                 LIMIT 1
                """)
                .setParameter("userId", userId)
                .setParameter("instituteId", instituteId)
                .getResultList();
        return !rows.isEmpty();
    }

    boolean hasBatch(String userId, String instituteId, String packageSessionId) {
        List<?> rows = em.createNativeQuery("""
                SELECT 1 FROM student_session_institute_group_mapping
                 WHERE user_id = :userId AND institute_id = :instituteId
                   AND package_session_id = :psId
                 LIMIT 1
                """)
                .setParameter("userId", userId)
                .setParameter("instituteId", instituteId)
                .setParameter("psId", packageSessionId)
                .getResultList();
        return !rows.isEmpty();
    }

    @SuppressWarnings("unchecked")
    private List<LearnerOneOffDuesDTO.Course> courses(String userId, String instituteId) {
        List<Object[]> rows = em.createNativeQuery("""
                SELECT DISTINCT m.package_session_id, p.package_name, l.level_name, s.session_name,
                       CASE WHEN m.status = 'ACTIVE' THEN 0 ELSE 1 END AS inactive
                  FROM student_session_institute_group_mapping m
                  JOIN package_session ps ON ps.id = m.package_session_id
                  LEFT JOIN package p ON p.id = ps.package_id
                  LEFT JOIN level l ON l.id = ps.level_id
                  LEFT JOIN session s ON s.id = ps.session_id
                 WHERE m.user_id = :userId AND m.institute_id = :instituteId
                   AND (m.type IS NULL OR m.type NOT IN ('ABANDONED_CART', 'PAYMENT_FAILED'))
                 ORDER BY inactive, p.package_name, s.session_name
                """)
                .setParameter("userId", userId)
                .setParameter("instituteId", instituteId)
                .getResultList();
        Map<String, LearnerOneOffDuesDTO.Course> byId = new LinkedHashMap<>();
        for (Object[] r : rows) {
            String psId = (String) r[0];
            byId.putIfAbsent(psId, LearnerOneOffDuesDTO.Course.builder()
                    .packageSessionId(psId)
                    .courseLabel(label((String) r[1], (String) r[2], (String) r[3]))
                    .build());
        }
        return new ArrayList<>(byId.values());
    }

    @SuppressWarnings("unchecked")
    private Map<String, String> courseLabels(List<String> psIds) {
        if (psIds.isEmpty()) return Map.of();
        List<Object[]> rows = em.createNativeQuery("""
                SELECT ps.id, p.package_name, l.level_name, s.session_name
                  FROM package_session ps
                  LEFT JOIN package p ON p.id = ps.package_id
                  LEFT JOIN level l ON l.id = ps.level_id
                  LEFT JOIN session s ON s.id = ps.session_id
                 WHERE ps.id IN (:ids)
                """)
                .setParameter("ids", psIds)
                .getResultList();
        Map<String, String> out = new LinkedHashMap<>();
        for (Object[] r : rows) out.put((String) r[0], label((String) r[1], (String) r[2], (String) r[3]));
        return out;
    }

    static String label(String pkg, String level, String session) {
        StringBuilder sb = new StringBuilder(pkg == null ? "" : pkg.trim());
        if (StringUtils.hasText(level) && !"default".equalsIgnoreCase(level.trim())) sb.append(" · ").append(level.trim());
        if (StringUtils.hasText(session) && !"default".equalsIgnoreCase(session.trim())) sb.append(" · ").append(session.trim());
        return sb.toString();
    }
}
