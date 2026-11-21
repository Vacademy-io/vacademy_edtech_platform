package vacademy.io.admin_core_service.features.fee_management.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.enroll_invite.repository.PackageSessionLearnerInvitationToPaymentOptionRepository;
import vacademy.io.admin_core_service.features.fee_management.dto.FeeSearchFilterDTO;
import vacademy.io.admin_core_service.features.fee_management.dto.CollectionDashboardRequestDTO;
import vacademy.io.admin_core_service.features.fee_management.dto.CollectionDashboardResponseDTO;
import vacademy.io.admin_core_service.features.fee_management.dto.InvoiceReceiptDTO;
import vacademy.io.admin_core_service.features.fee_management.dto.ReceiptDetailsDTO;
import vacademy.io.admin_core_service.features.fee_management.dto.StudentFeeAllocationLedgerDTO;
import vacademy.io.admin_core_service.features.fee_management.dto.StudentFeePaymentDTO;
import vacademy.io.admin_core_service.features.fee_management.dto.StudentFeePaymentRowDTO;
import vacademy.io.admin_core_service.features.fee_management.entity.AftInstallment;
import vacademy.io.admin_core_service.features.fee_management.entity.AssignedFeeValue;
import vacademy.io.admin_core_service.features.fee_management.entity.ComplexPaymentOption;
import vacademy.io.admin_core_service.features.fee_management.entity.FeeType;
import vacademy.io.admin_core_service.features.fee_management.entity.StudentFeeAdjustmentHistory;
import vacademy.io.admin_core_service.features.fee_management.entity.StudentFeeAllocationLedger;
import vacademy.io.admin_core_service.features.fee_management.entity.StudentFeePayment;
import vacademy.io.admin_core_service.features.fee_management.repository.*;
import vacademy.io.admin_core_service.features.invoice.entity.Invoice;
import vacademy.io.admin_core_service.features.invoice.entity.InvoiceLineItem;
import vacademy.io.admin_core_service.features.invoice.repository.InvoiceLineItemRepository;
import vacademy.io.admin_core_service.features.invoice.repository.InvoiceRepository;
import vacademy.io.admin_core_service.features.user_subscription.entity.UserPlan;
import vacademy.io.admin_core_service.features.user_subscription.repository.UserPlanRepository;
import vacademy.io.common.auth.dto.UserDTO;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.*;
import java.util.function.Function;
import java.util.stream.Collectors;

@Service
@Slf4j
public class FeeTrackingService {

        @Autowired
        private StudentFeePaymentRepository studentFeePaymentRepository;

        @Autowired
        private StudentFeeAllocationLedgerRepository studentFeeAllocationLedgerRepository;

        @Autowired
        private UserPlanRepository userPlanRepository;

        @Autowired
        private AftInstallmentRepository aftInstallmentRepository;

        @Autowired
        private FeeTypeRepository feeTypeRepository;

        @Autowired
        private AuthService authService;

        @Autowired
        private AssignedFeeValueRepository assignedFeeValueRepository;

        @Autowired
        private ComplexPaymentOptionRepository complexPaymentOptionRepository;

        @Autowired
        private PackageSessionLearnerInvitationToPaymentOptionRepository packageSessionInviteRepo;

        @Autowired
        private AdjustmentResolver adjustmentResolver;

        @PersistenceContext
        private EntityManager entityManager;


        private StudentFeeAllocationLedgerDTO mapToLedgerDTO(StudentFeeAllocationLedger entity) {
                return StudentFeeAllocationLedgerDTO.builder()
                                .id(entity.getId())
                                .paymentLogId(entity.getPaymentLogId())
                                .studentFeePaymentId(entity.getStudentFeePaymentId())
                                .amountAllocated(entity.getAmountAllocated())
                                .allocationType(entity.getAllocationType())
                                .remarks(entity.getRemarks())
                                .createdAt(entity.getCreatedAt())
                                .build();
        }

        /**
         * Admin fee roster search — powers the Manage Finances table.
         * <p>
         * Flow:
         * 1. If studentSearchQuery is provided, resolve matching userIds from
         * auth-service.
         * 2. Build a dynamic JPA Specification using the active filters.
         * 3. Execute the paginated, sorted query against student_fee_payment.
         * 4. Collect all unique userIds from the page result and batch-fetch user info.
         * 5. Enrich each row DTO with studentName, studentEmail, feeTypeName,
         * installmentNumber.
         */
        @Transactional(readOnly = true)
        public Page<StudentFeePaymentRowDTO> searchFeePayments(String instituteId, FeeSearchFilterDTO request) {
                FeeSearchFilterDTO.Filters filters = request.getFilters();

                // Step 1: Resolve studentSearchQuery to userIds if provided
                List<String> matchedUserIds = resolveStudentSearchQuery(filters);

                // Step 2: Build the dynamic specification
                Specification<StudentFeePayment> spec = StudentFeePaymentSpecification
                                .withFilters(instituteId, filters, matchedUserIds);

                // Step 3: Fetch all matching rows (unpaginated) for aggregation
                List<StudentFeePayment> allPayments = studentFeePaymentRepository.findAll(spec);
                
                // Fetch maps for enrichment before aggregation
                List<String> userIds = allPayments.stream()
                                .map(StudentFeePayment::getUserId)
                                .distinct()
                                .collect(Collectors.toList());
                Map<String, UserDTO> userMap = fetchUserMap(userIds);

                List<String> userPlanIds = allPayments.stream()
                                .map(StudentFeePayment::getUserPlanId)
                                .distinct()
                                .collect(Collectors.toList());
                Map<String, List<String>> packageSessionMap = fetchPackageSessionMap(userPlanIds);

                List<String> cpoIds = allPayments.stream().map(StudentFeePayment::getCpoId).filter(Objects::nonNull).distinct().collect(Collectors.toList());
                Map<String, String> cpoNameMap = complexPaymentOptionRepository.findAllById(cpoIds).stream().collect(Collectors.toMap(ComplexPaymentOption::getId, ComplexPaymentOption::getName, (a, b) -> a));

                // Batch-load current adjustment events to avoid N+1 in the aggregation loop
                Map<String, StudentFeeAdjustmentHistory> adjustmentMap =
                                adjustmentResolver.loadCurrentEventsForBills(allPayments);

                // Step 4: Grouping by [userId, cpoId]
                Map<String, List<StudentFeePayment>> groupedPayments = allPayments.stream()
                        .collect(Collectors.groupingBy(p -> p.getUserId() + "_" + p.getCpoId()));

                List<StudentFeePaymentRowDTO> aggregatedRows = new ArrayList<>();
                LocalDate today = LocalDate.now(ZoneId.systemDefault());

                for (Map.Entry<String, List<StudentFeePayment>> entry : groupedPayments.entrySet()) {
                    List<StudentFeePayment> group = entry.getValue();
                    // Sort by due date for consistent ordering in progress bar
                    group.sort(Comparator.comparing(StudentFeePayment::getDueDate, Comparator.nullsLast(Comparator.naturalOrder())));
                    StudentFeePayment first = group.get(0);

                    BigDecimal totalExpectedAmount = BigDecimal.ZERO;
                    BigDecimal totalPaidAmount = BigDecimal.ZERO;
                    BigDecimal overdueAmount = BigDecimal.ZERO;

                    for (StudentFeePayment p : group) {
                        BigDecimal expected = p.getAmountExpected() != null ? p.getAmountExpected() : BigDecimal.ZERO;
                        BigDecimal paid = p.getAmountPaid() != null ? p.getAmountPaid() : BigDecimal.ZERO;

                        StudentFeeAdjustmentHistory pEvent = adjustmentResolver.lookup(p, adjustmentMap);
                        BigDecimal netExpected = expected.add(adjustmentResolver.computeAdjustmentEffect(pEvent));
                        totalExpectedAmount = totalExpectedAmount.add(netExpected);
                        totalPaidAmount = totalPaidAmount.add(paid);

                        if (p.getDueDate() != null && netExpected.compareTo(paid) > 0) {
                            LocalDate due = p.getDueDate().toInstant().atZone(ZoneId.systemDefault()).toLocalDate();
                            if (due.isBefore(today)) {
                                overdueAmount = overdueAmount.add(netExpected.subtract(paid));
                            }
                        }
                    }

                    BigDecimal dueAmount = totalExpectedAmount.subtract(totalPaidAmount);

                    String status;
                    if (totalExpectedAmount.compareTo(BigDecimal.ZERO) > 0 && totalPaidAmount.compareTo(totalExpectedAmount) >= 0) {
                        status = "PAID";
                    } else if (overdueAmount.compareTo(BigDecimal.ZERO) > 0) {
                        status = "OVERDUE";
                    } else if (totalPaidAmount.compareTo(BigDecimal.ZERO) > 0) {
                        status = "PARTIAL";
                    } else {
                        status = "PENDING";
                    }

                    // Apply status filter after aggregation
                    if (filters != null && filters.getStatuses() != null && !filters.getStatuses().isEmpty()) {
                        if (!filters.getStatuses().contains(status)) {
                            continue;
                        }
                    }

                    // Collect per-installment statuses (already sorted by due date)
                    List<String> installmentStatuses = group.stream()
                            .map(StudentFeePayment::getStatus)
                            .collect(Collectors.toList());

                    UserDTO user = userMap.get(first.getUserId());

                    aggregatedRows.add(StudentFeePaymentRowDTO.builder()
                            .studentId(first.getUserId())
                            .cpoId(first.getCpoId())
                            .packageSessionIds(packageSessionMap.getOrDefault(first.getUserPlanId(), Collections.emptyList()))
                            .studentName(user != null ? user.getFullName() : first.getUserId())
                            .phone(user != null ? user.getMobileNumber() : null)
                            .cpoName(cpoNameMap.getOrDefault(first.getCpoId(), "N/A"))
                            .totalExpectedAmount(totalExpectedAmount)
                            .totalPaidAmount(totalPaidAmount)
                            .dueAmount(dueAmount)
                            .overdueAmount(overdueAmount)
                            .status(status)
                            .installmentStatuses(installmentStatuses)
                            .build());
                }

                // Sorting
                String sortField = StringUtils.hasText(request.getSortBy()) ? request.getSortBy() : "studentName";
                boolean isAsc = !"DESC".equalsIgnoreCase(request.getSortDirection());

                aggregatedRows.sort((a, b) -> {
                    int cmp = 0;
                    switch (sortField) {
                        case "studentName":
                            cmp = compareNullable(a.getStudentName(), b.getStudentName());
                            break;
                        case "cpoName":
                            cmp = compareNullable(a.getCpoName(), b.getCpoName());
                            break;
                        case "totalExpectedAmount":
                            cmp = compareNullable(a.getTotalExpectedAmount(), b.getTotalExpectedAmount());
                            break;
                        case "totalPaidAmount":
                            cmp = compareNullable(a.getTotalPaidAmount(), b.getTotalPaidAmount());
                            break;
                        case "dueAmount":
                            cmp = compareNullable(a.getDueAmount(), b.getDueAmount());
                            break;
                        case "overdueAmount":
                            cmp = compareNullable(a.getOverdueAmount(), b.getOverdueAmount());
                            break;
                        case "status":
                            cmp = compareNullable(a.getStatus(), b.getStatus());
                            break;
                        default:
                            cmp = compareNullable(a.getStudentName(), b.getStudentName());
                    }
                    return isAsc ? cmp : -cmp;
                });

                // Pagination
                int startIndex = request.getPage() * request.getSize();
                int endIndex = Math.min(startIndex + request.getSize(), aggregatedRows.size());
                
                List<StudentFeePaymentRowDTO> pagedRows = new ArrayList<>();
                if (startIndex < aggregatedRows.size()) {
                    pagedRows = aggregatedRows.subList(startIndex, endIndex);
                }

                return new PageImpl<>(pagedRows, PageRequest.of(request.getPage(), request.getSize()), aggregatedRows.size());
        }

        private <T extends Comparable<T>> int compareNullable(T a, T b) {
            if (a == null && b == null) return 0;
            if (a == null) return -1;
            if (b == null) return 1;
            return a.compareTo(b);
        }

        @SuppressWarnings("unchecked")
        private List<String> resolveStudentSearchQuery(FeeSearchFilterDTO.Filters filters) {
                if (filters == null || !StringUtils.hasText(filters.getStudentSearchQuery())) {
                        return null;
                }
                String query = filters.getStudentSearchQuery().trim();
                String pattern = query + "%";

                List<String> matchedUserIds = entityManager.createNativeQuery(
                        "SELECT DISTINCT s.user_id FROM student s " +
                        "WHERE s.full_name ILIKE :pattern " +
                        "OR s.username ILIKE :pattern " +
                        "OR s.mobile_number ILIKE :pattern")
                        .setParameter("pattern", pattern)
                        .getResultList();

                if (matchedUserIds.isEmpty()) {
                        // Return a non-null empty list so the spec filters to zero results
                        return List.of("__NO_MATCH__");
                }
                return matchedUserIds;
        }

        private Map<String, UserDTO> fetchUserMap(List<String> userIds) {
                if (userIds == null || userIds.isEmpty()) return Map.of();
                try {
                        List<UserDTO> users = authService.getUsersFromAuthServiceByUserIds(userIds);
                        return users.stream().collect(Collectors.toMap(UserDTO::getId, Function.identity(), (a, b) -> a));
                } catch (Exception e) {
                        log.warn("Failed to fetch user details for fee roster enrichment: {}", e.getMessage());
                        return Map.of();
                }
        }

        private Map<String, String> fetchFeeTypeNameMap(List<String> asvIds) {
                if (asvIds.isEmpty()) return Map.of();

                List<AssignedFeeValue> afvs = assignedFeeValueRepository.findAllById(asvIds);
                List<String> feeTypeIds = afvs.stream().map(AssignedFeeValue::getFeeTypeId).distinct().collect(Collectors.toList());

                Map<String, String> feeTypeNames = feeTypeRepository.findAllById(feeTypeIds).stream()
                                .collect(Collectors.toMap(FeeType::getId, FeeType::getName, (a, b) -> a));

                return afvs.stream().collect(Collectors.toMap(AssignedFeeValue::getId,
                                afv -> feeTypeNames.getOrDefault(afv.getFeeTypeId(), "N/A"), (a, b) -> a));
        }

        private Map<String, Integer> fetchInstallmentNumberMap(List<String> installmentIds) {
                if (installmentIds.isEmpty()) return Map.of();
                return aftInstallmentRepository.findAllById(installmentIds).stream()
                                .collect(Collectors.toMap(AftInstallment::getId, AftInstallment::getInstallmentNumber, (a, b) -> a));
        }

        private Map<String, List<String>> fetchPackageSessionMap(List<String> userPlanIds) {
                if (userPlanIds == null || userPlanIds.isEmpty()) return Collections.emptyMap();
                try {
                        List<Object[]> rows = packageSessionInviteRepo.findPackageSessionIdsByUserPlanIds(userPlanIds);
                        Map<String, List<String>> result = new HashMap<>();
                        for (Object[] row : rows) {
                                String userPlanId = (String) row[0];
                                String packageSessionId = (String) row[1];
                                result.computeIfAbsent(userPlanId, k -> new ArrayList<>()).add(packageSessionId);
                        }
                        return result;
                } catch (Exception e) {
                        log.warn("PKG-SESSION Fetch failed: {}", e.getMessage());
                        return Collections.emptyMap();
                }
        }

        @Transactional(readOnly = true)
        public List<vacademy.io.admin_core_service.features.fee_management.dto.InstallmentDetailsDTO> getPaymentDetails(String studentId, String cpoId) {
            List<StudentFeePayment> payments = studentFeePaymentRepository.findByUserId(studentId).stream()
                    .filter(p -> Objects.equals(p.getCpoId(), cpoId))
                    .collect(Collectors.toList());

            List<String> asvIds = payments.stream().map(StudentFeePayment::getAsvId).filter(Objects::nonNull).distinct().collect(Collectors.toList());
            Map<String, String> feeTypeNameMap = fetchFeeTypeNameMap(asvIds);

            List<String> installmentIds = payments.stream().map(StudentFeePayment::getIId).filter(Objects::nonNull).distinct().collect(Collectors.toList());
            Map<String, Integer> installmentNumberMap = fetchInstallmentNumberMap(installmentIds);

            Map<String, StudentFeeAdjustmentHistory> adjustmentMap =
                    adjustmentResolver.loadCurrentEventsForBills(payments);

            return payments.stream().map(p -> {
                BigDecimal expected = p.getAmountExpected() != null ? p.getAmountExpected() : BigDecimal.ZERO;
                BigDecimal paid = p.getAmountPaid() != null ? p.getAmountPaid() : BigDecimal.ZERO;
                StudentFeeAdjustmentHistory event = adjustmentResolver.lookup(p, adjustmentMap);
                StudentFeeAdjustmentHistory effective = adjustmentResolver.effectiveOrNull(event);
                BigDecimal adjustmentEffect = adjustmentResolver.computeAdjustmentEffect(effective);
                String name = feeTypeNameMap.getOrDefault(p.getAsvId(), "N/A");
                // i_id is null on lump-sum and schedule-generated bills; Map.of() (used when no
                // bill has an i_id) throws on a null key, so never look it up.
                Integer num = p.getInstallmentNumber() != null
                        ? p.getInstallmentNumber()
                        : p.getIId() != null ? installmentNumberMap.get(p.getIId()) : null;

                return vacademy.io.admin_core_service.features.fee_management.dto.InstallmentDetailsDTO.builder()
                        .feeTypeName(name)
                        .installmentNumber(num)
                        .amountExpected(expected)
                        .adjustmentAmount(effective != null ? effective.getAmount() : null)
                        .adjustmentType(effective != null ? effective.getAdjustmentType() : null)
                        .adjustmentStatus(effective != null ? effective.getResultingStatus() : null)
                        .amountPaid(paid)
                        .dueAmount(expected.add(adjustmentEffect).subtract(paid))
                        .dueDate(p.getDueDate())
                        .status(p.getStatus())
                        .build();
            }).collect(Collectors.toList());
        }

        @Autowired
        private CollectionDashboardRepository collectionDashboardRepository;

        @Transactional(readOnly = true)
        public CollectionDashboardResponseDTO getCollectionDashboard(CollectionDashboardRequestDTO request) {
                String instituteId = request.getInstituteId();
                String sessionId = StringUtils.hasText(request.getSessionId()) ? request.getSessionId() : null;

                List<String> feeTypeIds = (request.getFeeTypeIds() != null)
                                ? request.getFeeTypeIds().stream().filter(StringUtils::hasText)
                                                .collect(Collectors.toList())
                                : Collections.emptyList();
                boolean hasFeeTypes = !feeTypeIds.isEmpty();

                Object[] sr = collectionDashboardRepository.getCollectionSummary(
                                instituteId, sessionId, hasFeeTypes, feeTypeIds);

                List<Object[]> classRows = collectionDashboardRepository.getClassWiseBreakdown(
                                instituteId, sessionId, hasFeeTypes, feeTypeIds);

                List<Object[]> modeRows = collectionDashboardRepository.getPaymentModeBreakdown(
                                instituteId, sessionId, hasFeeTypes, feeTypeIds);

                List<CollectionDashboardResponseDTO.ClassWiseBreakdownDTO> classWiseBreakdown = classRows.stream()
                                .map(row -> CollectionDashboardResponseDTO.ClassWiseBreakdownDTO.builder()
                                                .packageSessionId((String) row[0])
                                                .className((String) row[1])
                                                .projectedRevenue(toBD(row[2]))
                                                .expectedToDate(toBD(row[3]))
                                                .collectedToDate(toBD(row[4]))
                                                .overdue(toBD(row[5]))
                                                .build())
                                .collect(Collectors.toList());

                List<CollectionDashboardResponseDTO.PaymentModeBreakdownDTO> paymentModeBreakdown = modeRows.stream()
                                .map(row -> CollectionDashboardResponseDTO.PaymentModeBreakdownDTO.builder()
                                                .vendor(row[0] != null ? row[0].toString() : "UNKNOWN")
                                                .amount(toBD(row[1]))
                                                .build())
                                .collect(Collectors.toList());

                return CollectionDashboardResponseDTO.builder()
                                .projectedRevenue(toBD(sr[0]))
                                .expectedToDate(toBD(sr[1]))
                                .collectedToDate(toBD(sr[2]))
                                .totalOverdue(toBD(sr[3]))
                                .classWiseBreakdown(classWiseBreakdown)
                                .paymentModeBreakdown(paymentModeBreakdown)
                                .build();
        }

        private BigDecimal toBD(Object val) {
                if (val == null)
                        return BigDecimal.ZERO;
                if (val instanceof BigDecimal)
                        return (BigDecimal) val;
                return new BigDecimal(val.toString());
        }


        @Autowired
        private InvoiceRepository invoiceRepository;

        @Autowired
        private InvoiceLineItemRepository invoiceLineItemRepository;

        @Transactional(readOnly = true)
        public List<StudentFeePaymentDTO> getPendingAdjustments(String instituteId) {
                List<StudentFeePayment> pending = studentFeePaymentRepository
                        .findBillsWithCurrentResultingStatus(instituteId, "PENDING_FOR_APPROVAL");
                if (pending.isEmpty()) return Collections.emptyList();

                Map<String, FeeMeta> metaMap = buildFeeMetaMap(pending);
                Map<String, StudentFeeAdjustmentHistory> adjustmentMap =
                                adjustmentResolver.loadCurrentEventsForBills(pending);

                List<String> userIds = pending.stream()
                        .map(StudentFeePayment::getUserId)
                        .distinct()
                        .collect(Collectors.toList());
                Map<String, UserDTO> userMap = fetchUserMap(userIds);

                return pending.stream()
                        .map(entity -> {
                                StudentFeePaymentDTO dto = mapToPaymentDTO(
                                                entity,
                                                metaMap.getOrDefault(entity.getId(), null),
                                                adjustmentResolver.lookup(entity, adjustmentMap));
                                dto.setUserId(entity.getUserId());
                                UserDTO user = userMap.get(entity.getUserId());
                                dto.setStudentName(user != null ? user.getFullName() : entity.getUserId());
                                return dto;
                        })
                        .collect(Collectors.toList());
        }

        /**
         * Fetch all StudentFeePayment rows for a specific UserPlan, validate they all
         * belong to {@code userId}, and return them as {@link StudentFeePaymentDTO}s.
         *
         * <p>Used by the open (no-JWT) CPO dues endpoint so the caller can see their
         * full installment schedule after enrollment without needing a JWT.</p>
         */
        @Transactional(readOnly = true)
        public List<StudentFeePaymentDTO> getCpoDuesByUserPlan(String userId, String userPlanId) {
                List<StudentFeePayment> bills = studentFeePaymentRepository.findByUserPlanId(userPlanId);

                if (bills == null || bills.isEmpty()) {
                        return Collections.emptyList();
                }

                // Validate all rows belong to the expected user
                for (StudentFeePayment bill : bills) {
                        if (!userId.equals(bill.getUserId())) {
                                throw new vacademy.io.common.exceptions.VacademyException(
                                        "UserPlan " + userPlanId + " does not belong to user " + userId);
                        }
                }

                Map<String, FeeMeta> billIdToMeta = buildFeeMetaMap(bills);
                Map<String, StudentFeeAdjustmentHistory> adjustmentMap =
                                adjustmentResolver.loadCurrentEventsForBills(bills);

                return bills.stream()
                                .map(bill -> mapToPaymentDTO(
                                                bill,
                                                billIdToMeta.get(bill.getId()),
                                                adjustmentResolver.lookup(bill, adjustmentMap)))
                                .collect(Collectors.toList());
        }

        @Transactional(readOnly = true)
        public List<StudentFeePaymentDTO> getStudentDues(String userId, String instituteId) {
                List<StudentFeePayment> allBills = fetchBillsForUserAndInstitute(userId, instituteId);

                if (allBills == null || allBills.isEmpty()) {
                        return Collections.emptyList();
                }

                Map<String, FeeMeta> billIdToMeta = buildFeeMetaMap(allBills);
                Map<String, StudentFeeAdjustmentHistory> adjustmentMap =
                                adjustmentResolver.loadCurrentEventsForBills(allBills);

                return allBills.stream()
                                .map(bill -> mapToPaymentDTO(
                                                bill,
                                                billIdToMeta.get(bill.getId()),
                                                adjustmentResolver.lookup(bill, adjustmentMap)))
                                .collect(Collectors.toList());
        }

        @Transactional(readOnly = true)
        public List<StudentFeeAllocationLedgerDTO> getStudentReceipts(String userId, String instituteId) {
                List<StudentFeePayment> bills = fetchBillsForUserAndInstitute(userId, instituteId);
                if (bills == null || bills.isEmpty()) {
                        return Collections.emptyList();
                }

                List<String> billIds = bills.stream().map(StudentFeePayment::getId).collect(Collectors.toList());
                Map<String, FeeMeta> billIdToMeta = buildFeeMetaMap(bills);

                return studentFeeAllocationLedgerRepository.findByStudentFeePaymentIdInOrderByCreatedAtDesc(billIds)
                                .stream()
                                // A voided payment's allocations are kept for audit but are not a receipt.
                                .filter(ledger -> !"VOIDED".equals(ledger.getAllocationType()))
                                .map(ledger -> mapToLedgerDTO(ledger,
                                                billIdToMeta.get(ledger.getStudentFeePaymentId())))
                                .collect(Collectors.toList());
        }

        @Transactional(readOnly = true)
        public List<InvoiceReceiptDTO> getStudentInvoiceReceipts(String userId, String instituteId) {
        List<Invoice> invoices;
        if (instituteId != null && !instituteId.isBlank()) {
            invoices = invoiceRepository.findByUserIdAndInstituteIdOrderByCreatedAtDesc(userId, instituteId);
        } else {
            invoices = invoiceRepository.findByUserIdOrderByCreatedAtDesc(userId);
        }

        if (invoices == null || invoices.isEmpty()) {
            return Collections.emptyList();
        }

        // Collect all source_ids (student_fee_payment_ids) across all line items
        // to batch-load fee metadata
        Set<String> allSourceIds = new HashSet<>();
        Map<String, List<InvoiceLineItem>> invoiceIdToLines = new HashMap<>();
        for (Invoice inv : invoices) {
            List<InvoiceLineItem> lines = invoiceLineItemRepository.findByInvoiceId(inv.getId());
            invoiceIdToLines.put(inv.getId(), lines);
            for (InvoiceLineItem line : lines) {
                if (line.getSourceId() != null && !line.getSourceId().isBlank()) {
                    allSourceIds.add(line.getSourceId());
                }
            }
        }

        // Build fee metadata map keyed by student_fee_payment_id
        Map<String, FeeMeta> billIdToMeta = Collections.emptyMap();
        if (!allSourceIds.isEmpty()) {
            List<StudentFeePayment> relatedBills = studentFeePaymentRepository.findAllById(allSourceIds);
            billIdToMeta = buildFeeMetaMap(relatedBills);
        }

        List<InvoiceReceiptDTO> result = new ArrayList<>();
        for (Invoice inv : invoices) {
            List<InvoiceLineItem> lines = invoiceIdToLines.getOrDefault(inv.getId(), Collections.emptyList());

            // Extract fields from invoice_data_json
            InvoiceDataFields dataFields = extractInvoiceDataFields(inv.getInvoiceDataJson());

            List<InvoiceReceiptDTO.InvoiceLineItemDTO> lineDTOs = new ArrayList<>();
            for (InvoiceLineItem line : lines) {
                FeeMeta meta = (line.getSourceId() != null) ? billIdToMeta.get(line.getSourceId()) : null;
                lineDTOs.add(InvoiceReceiptDTO.InvoiceLineItemDTO.builder()
                        .lineItemId(line.getId())
                        .itemType(line.getItemType())
                        .description(line.getDescription())
                        .amount(line.getAmount())
                        .sourceId(line.getSourceId())
                        .feeTypeName(meta != null ? meta.feeTypeName : null)
                        .feeTypeCode(meta != null ? meta.feeTypeCode : null)
                        .cpoName(meta != null ? meta.cpoName : null)
                        .build());
            }

            result.add(InvoiceReceiptDTO.builder()
                    .invoiceId(inv.getId())
                    .invoiceNumber(inv.getInvoiceNumber())
                    .totalAmount(inv.getTotalAmount())
                    .currency(inv.getCurrency())
                    .status(inv.getStatus())
                    .pdfFileId(inv.getPdfFileId())
                    .type(dataFields.type)
                    .amountPaidNow(dataFields.amountPaidNow)
                    .totalPaid(dataFields.totalPaid)
                    .balanceDue(dataFields.balanceDue)
                    .totalDiscount(dataFields.totalDiscount)
                    .totalExpected(dataFields.totalExpected)
                    .invoiceDate(inv.getInvoiceDate())
                    .createdAt(inv.getCreatedAt())
                    .lineItems(lineDTOs)
                    .build());
        }

        return result;
    }

    private record InvoiceDataFields(
            String type,
            BigDecimal amountPaidNow,
            BigDecimal totalPaid,
            BigDecimal balanceDue,
            BigDecimal totalDiscount,
            BigDecimal totalExpected,
            BigDecimal totalConcession,
            BigDecimal totalPenalty
    ) {}

    private InvoiceDataFields extractInvoiceDataFields(String json) {
        if (json == null || json.isBlank()) {
            return new InvoiceDataFields(null, null, null, null, null, null, null, null);
        }

        return new InvoiceDataFields(
                extractStringField(json, "type"),
                extractDecimalField(json, "amountPaidNow"),
                extractDecimalField(json, "totalPaid"),
                extractDecimalField(json, "balanceDue"),
                extractDecimalField(json, "totalDiscount"),
                extractDecimalField(json, "totalExpected"),
                extractDecimalField(json, "totalConcession"),
                extractDecimalField(json, "totalPenalty")
        );
    }

    private String extractStringField(String json, String fieldName) {
        String pattern = "\"" + fieldName + "\":\"";
        int idx = json.indexOf(pattern);
        if (idx < 0) return null;
        int start = idx + pattern.length();
        int end = json.indexOf("\"", start);
        return end > start ? json.substring(start, end) : null;
    }

    private BigDecimal extractDecimalField(String json, String fieldName) {
        String pattern = "\"" + fieldName + "\":";
        int idx = json.indexOf(pattern);
        if (idx < 0) return null;
        int start = idx + pattern.length();
        int end = start;
        while (end < json.length()) {
            char c = json.charAt(end);
            if (c == ',' || c == '}') break;
            end++;
        }
        try {
            return new BigDecimal(json.substring(start, end).trim());
        } catch (NumberFormatException e) {
            return null;
        }
    }

        private List<StudentFeePayment> fetchBillsForUserAndInstitute(String userId, String instituteId) {
                if (instituteId == null || instituteId.isBlank()) {
                        return studentFeePaymentRepository.findByUserId(userId);
                }

                List<UserPlan> plans = userPlanRepository.findByUserIdAndInstituteIdWithFilters(
                                userId,
                                instituteId,
                                List.of("ACTIVE", "PENDING", "PENDING_FOR_PAYMENT", "EXPIRED", "TERMINATED"),
                                null).getContent();

                if (plans == null || plans.isEmpty()) {
                        return Collections.emptyList();
                }

                List<String> planIds = plans.stream().map(UserPlan::getId).collect(Collectors.toList());
                return studentFeePaymentRepository.findByUserPlanIdIn(planIds);
        }

        private StudentFeePaymentDTO mapToPaymentDTO(StudentFeePayment entity, FeeMeta meta) {
                return mapToPaymentDTO(entity, meta, adjustmentResolver.getCurrentEvent(entity));
        }

        private StudentFeePaymentDTO mapToPaymentDTO(
                        StudentFeePayment entity,
                        FeeMeta meta,
                        StudentFeeAdjustmentHistory event) {
                StudentFeeAdjustmentHistory effective = adjustmentResolver.effectiveOrNull(event);
                BigDecimal expected = entity.getAmountExpected() != null ? entity.getAmountExpected() : BigDecimal.ZERO;
                BigDecimal paid = entity.getAmountPaid() != null ? entity.getAmountPaid() : BigDecimal.ZERO;
                BigDecimal amountDue = expected.add(adjustmentResolver.computeAdjustmentEffect(effective)).subtract(paid);

                Boolean isOverdue = false;
                Long daysOverdue = null;
                if (entity.getDueDate() != null && amountDue.compareTo(BigDecimal.ZERO) > 0) {
                        LocalDate due = entity.getDueDate().toInstant().atZone(ZoneId.systemDefault()).toLocalDate();
                        LocalDate today = LocalDate.now(ZoneId.systemDefault());
                        if (due.isBefore(today)) {
                                isOverdue = true;
                                daysOverdue = ChronoUnit.DAYS.between(due, today);
                        }
                }

                return StudentFeePaymentDTO.builder()
                                .id(entity.getId())
                                .userPlanId(entity.getUserPlanId())
                                .cpoId(entity.getCpoId())
                                .cpoName(meta != null ? meta.cpoName : null)
                                .feeTypeName(meta != null ? meta.feeTypeName : null)
                                .feeTypeCode(meta != null ? meta.feeTypeCode : null)
                                .feeTypeDescription(meta != null ? meta.feeTypeDescription : null)
                                .amountExpected(entity.getAmountExpected())
                                .adjustmentAmount(effective != null ? effective.getAmount() : null)
                                .adjustmentReason(effective != null ? effective.getReason() : null)
                                .adjustmentType(effective != null ? effective.getAdjustmentType() : null)
                                .adjustmentStatus(effective != null ? effective.getResultingStatus() : null)
                                .amountPaid(entity.getAmountPaid())
                                .dueDate(entity.getDueDate())
                                .status(entity.getStatus())
                                .amountDue(amountDue)
                                .isOverdue(isOverdue)
                                .daysOverdue(daysOverdue)
                                .build();
        }

        private StudentFeeAllocationLedgerDTO mapToLedgerDTO(StudentFeeAllocationLedger entity, FeeMeta meta) {
                return StudentFeeAllocationLedgerDTO.builder()
                                .id(entity.getId())
                                .paymentLogId(entity.getPaymentLogId())
                                .studentFeePaymentId(entity.getStudentFeePaymentId())
                                .cpoName(meta != null ? meta.cpoName : null)
                                .feeTypeName(meta != null ? meta.feeTypeName : null)
                                .feeTypeCode(meta != null ? meta.feeTypeCode : null)
                                .feeTypeDescription(meta != null ? meta.feeTypeDescription : null)
                                .amountAllocated(entity.getAmountAllocated())
                                .allocationType(entity.getAllocationType())
                                .remarks(entity.getRemarks())
                                .createdAt(entity.getCreatedAt())
                                .build();
        }

        @Transactional(readOnly = true)
        public ReceiptDetailsDTO buildReceiptDetails(String invoiceId) {
            Invoice invoice = invoiceRepository.findById(invoiceId).orElse(null);
            if (invoice == null) return null;

            List<InvoiceLineItem> lineItems = invoiceLineItemRepository.findByInvoiceId(invoiceId);

            List<String> sourceIds = lineItems.stream()
                    .map(InvoiceLineItem::getSourceId)
                    .filter(s -> s != null && !s.isBlank())
                    .collect(Collectors.toList());

            Map<String, StudentFeePayment> paymentMap = studentFeePaymentRepository.findAllById(sourceIds)
                    .stream().collect(Collectors.toMap(StudentFeePayment::getId, Function.identity(), (a, b) -> a));

            List<StudentFeePayment> bills = new ArrayList<>(paymentMap.values());
            Map<String, FeeMeta> metaMap = bills.isEmpty() ? Collections.emptyMap() : buildFeeMetaMap(bills);

            // Parse payment mode and transaction ID from ledger remarks
            String paymentMode = null;
            String transactionId = null;
            if (!sourceIds.isEmpty()) {
                // A voided payment's allocation is kept for audit; it must not lend its mode or
                // transaction id to a receipt for a payment that really arrived.
                List<StudentFeeAllocationLedger> ledgers =
                        studentFeeAllocationLedgerRepository.findByStudentFeePaymentId(sourceIds.get(0)).stream()
                                .filter(l -> !"VOIDED".equals(l.getAllocationType()))
                                .collect(Collectors.toList());
                if (!ledgers.isEmpty() && ledgers.get(0).getRemarks() != null) {
                    String[] parts = ledgers.get(0).getRemarks().split(" \\| ");
                    for (String part : parts) {
                        if (part.startsWith("Mode: ")) paymentMode = part.replace("Mode: ", "").trim();
                        if (part.startsWith("Txn ID: ")) transactionId = part.replace("Txn ID: ", "").trim();
                    }
                }
            }

            // Batch-load current adjustment events to avoid N+1
            Map<String, StudentFeeAdjustmentHistory> adjustmentMap =
                    adjustmentResolver.loadCurrentEventsForBills(bills);

            // Build line item DTOs with fresh post-payment amounts
            List<ReceiptDetailsDTO.ReceiptLineItemDTO> lineDTOs = new ArrayList<>();
            BigDecimal computedConcession = BigDecimal.ZERO;
            BigDecimal computedPenalty = BigDecimal.ZERO;
            for (String sourceId : sourceIds) {
                StudentFeePayment sfp = paymentMap.get(sourceId);
                if (sfp == null) continue;
                FeeMeta meta = metaMap.get(sfp.getId());
                BigDecimal expected = sfp.getAmountExpected() != null ? sfp.getAmountExpected() : BigDecimal.ZERO;
                BigDecimal paid = sfp.getAmountPaid() != null ? sfp.getAmountPaid() : BigDecimal.ZERO;
                StudentFeeAdjustmentHistory sfpEvent = adjustmentResolver.lookup(sfp, adjustmentMap);
                StudentFeeAdjustmentHistory sfpEffective = adjustmentResolver.effectiveOrNull(sfpEvent);
                BigDecimal adjustmentEffect = adjustmentResolver.computeAdjustmentEffect(sfpEffective);
                BigDecimal balance = expected.add(adjustmentEffect).subtract(paid).max(BigDecimal.ZERO);
                boolean approvedAdjustment = sfpEffective != null
                        && "APPROVED".equals(sfpEffective.getResultingStatus());
                String adjustmentType = approvedAdjustment ? sfpEffective.getAdjustmentType() : null;
                BigDecimal adjustmentAmount = approvedAdjustment && sfpEffective.getAmount() != null
                        ? sfpEffective.getAmount()
                        : BigDecimal.ZERO;
                String adjustmentStatus = approvedAdjustment ? sfpEffective.getResultingStatus() : null;
                computedConcession = computedConcession.add(adjustmentResolver.computeConcession(sfpEffective));
                computedPenalty = computedPenalty.add(adjustmentResolver.computePenalty(sfpEffective));
                lineDTOs.add(ReceiptDetailsDTO.ReceiptLineItemDTO.builder()
                        .feeTypeName(meta != null ? meta.feeTypeName() : null)
                        .cpoName(meta != null ? meta.cpoName() : null)
                        .dueDate(sfp.getDueDate())
                        .amountExpected(expected)
                        .amountPaid(paid)
                        .balance(balance)
                        .status(sfp.getStatus())
                        .adjustmentType(adjustmentType)
                        .adjustmentAmount(adjustmentAmount)
                        .adjustmentStatus(adjustmentStatus)
                        .build());
            }

            // Sort by due date
            lineDTOs.sort(Comparator.comparing(
                    ReceiptDetailsDTO.ReceiptLineItemDTO::getDueDate,
                    Comparator.nullsLast(Comparator.naturalOrder())));

            InvoiceDataFields dataFields = extractInvoiceDataFields(invoice.getInvoiceDataJson());
            BigDecimal totalConcession = dataFields.totalConcession() != null
                    ? dataFields.totalConcession()
                    : computedConcession;
            BigDecimal totalPenalty = dataFields.totalPenalty() != null
                    ? dataFields.totalPenalty()
                    : computedPenalty;

            return ReceiptDetailsDTO.builder()
                    .invoiceId(invoice.getId())
                    .receiptNumber(invoice.getInvoiceNumber())
                    .receiptDate(invoice.getInvoiceDate())
                    .paymentMode(paymentMode)
                    .transactionId(transactionId)
                    .lineItems(lineDTOs)
                    .totalExpected(dataFields.totalExpected())
                    .totalPaid(dataFields.totalPaid())
                    .totalConcession(totalConcession)
                    .totalPenalty(totalPenalty)
                    .balanceDue(dataFields.balanceDue())
                    .amountPaidNow(dataFields.amountPaidNow())
                    .build();
        }

        private Map<String, FeeMeta> buildFeeMetaMap(List<StudentFeePayment> bills) {
                if (bills == null || bills.isEmpty()) {
                        return Collections.emptyMap();
                }

                List<String> cpoIds = bills.stream()
                                .map(StudentFeePayment::getCpoId)
                                .filter(Objects::nonNull)
                                .distinct()
                                .toList();

                List<String> asvIds = bills.stream()
                                .map(StudentFeePayment::getAsvId)
                                .filter(Objects::nonNull)
                                .distinct()
                                .toList();

                Map<String, String> cpoIdToName = complexPaymentOptionRepository.findAllById(cpoIds).stream()
                                .collect(Collectors.toMap(ComplexPaymentOption::getId, ComplexPaymentOption::getName,
                                                (a, b) -> a));

                Map<String, String> asvIdToFeeTypeId = assignedFeeValueRepository.findAllById(asvIds).stream()
                                .collect(Collectors.toMap(AssignedFeeValue::getId, AssignedFeeValue::getFeeTypeId,
                                                (a, b) -> a));

                List<String> feeTypeIds = asvIdToFeeTypeId.values().stream()
                                .filter(Objects::nonNull)
                                .distinct()
                                .toList();

                Map<String, FeeType> feeTypeIdToEntity = feeTypeRepository.findAllById(feeTypeIds).stream()
                                .collect(Collectors.toMap(FeeType::getId, ft -> ft, (a, b) -> a));

                Map<String, FeeMeta> billIdToMeta = new HashMap<>();
                for (StudentFeePayment bill : bills) {
                        String cpoName = bill.getCpoId() != null ? cpoIdToName.get(bill.getCpoId()) : null;

                        String feeTypeId = bill.getAsvId() != null ? asvIdToFeeTypeId.get(bill.getAsvId()) : null;
                        FeeType feeType = feeTypeId != null ? feeTypeIdToEntity.get(feeTypeId) : null;

                        billIdToMeta.put(
                                        bill.getId(),
                                        new FeeMeta(
                                                        cpoName,
                                                        feeType != null ? feeType.getName() : null,
                                                        feeType != null ? feeType.getCode() : null,
                                                        feeType != null ? feeType.getDescription() : null));
                }
                return billIdToMeta;
        }

        private record FeeMeta(
                        String cpoName,
                        String feeTypeName,
                        String feeTypeCode,
                        String feeTypeDescription) {
        }

        /**
         * Returns all fee types for an institute by looking up all CPOs
         * belonging to the institute and then fetching their fee types.
         */
        @Transactional(readOnly = true)
        public List<Map<String, String>> getFeeTypesForInstitute(String instituteId) {
                // Leave out the hidden plans behind one-time prices (V575): each would add its own
                // "Course fee" entry to the fee-type filters.
                List<ComplexPaymentOption> cpos = complexPaymentOptionRepository.findByInstituteId(instituteId).stream()
                                .filter(c -> c.getSourcePaymentPlanId() == null)
                                .collect(Collectors.toList());
                List<String> cpoIds = cpos.stream().map(ComplexPaymentOption::getId).collect(Collectors.toList());
                if (cpoIds.isEmpty()) return Collections.emptyList();

                List<FeeType> feeTypes = feeTypeRepository.findByCpoIdInAndStatusNot(cpoIds, "DELETED");

                return feeTypes.stream()
                        .map(ft -> Map.of("id", ft.getId(), "name", ft.getName()))
                        .collect(Collectors.toList());
        }
}
