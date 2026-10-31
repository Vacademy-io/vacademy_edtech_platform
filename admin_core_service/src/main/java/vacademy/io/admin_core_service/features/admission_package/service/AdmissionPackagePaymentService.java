package vacademy.io.admin_core_service.features.admission_package.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.admission_package.dto.AdmissionPackagePaymentPreviewDTO;
import vacademy.io.admin_core_service.features.admission_package.dto.AdmissionPackageSummaryDTO;
import vacademy.io.admin_core_service.features.admission_package.entity.AdmissionPackage;
import vacademy.io.admin_core_service.features.admission_package.entity.AdmissionPackageCourse;
import vacademy.io.admin_core_service.features.admission_package.repository.AdmissionPackageCourseRepository;
import vacademy.io.admin_core_service.features.admission_package.repository.AdmissionPackageRepository;
import vacademy.io.admin_core_service.features.fee_management.dto.RecordOfflinePaymentRequestDTO;
import vacademy.io.admin_core_service.features.fee_management.entity.StudentFeePayment;
import vacademy.io.admin_core_service.features.fee_management.repository.StudentFeePaymentRepository;
import vacademy.io.admin_core_service.features.fee_management.service.AdmissionPackageSplitter;
import vacademy.io.admin_core_service.features.fee_management.dto.StopDuesRequestDTO;
import vacademy.io.admin_core_service.features.fee_management.dto.StopDuesResultDTO;
import vacademy.io.admin_core_service.features.fee_management.entity.FeeBillCancellation;
import vacademy.io.admin_core_service.features.fee_management.repository.FeeBillCancellationRepository;
import vacademy.io.admin_core_service.features.fee_management.service.CpoDiscountService;
import vacademy.io.admin_core_service.features.fee_management.service.FeeBillCancellationService;
import vacademy.io.admin_core_service.features.fee_management.service.FeeStopDuesService;
import vacademy.io.admin_core_service.features.fee_management.service.CpoSideViewService;
import vacademy.io.admin_core_service.features.invoice.service.InvoiceService;
import vacademy.io.admin_core_service.features.packages.repository.PackageSessionRepository;
import vacademy.io.admin_core_service.features.user_subscription.entity.UserPlan;
import vacademy.io.admin_core_service.features.user_subscription.repository.UserPlanRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

/**
 * An admission package after enrollment: its totals for the learner side view, and payments
 * recorded against the package as a whole. A package payment is split between the courses
 * ({@link AdmissionPackageSplitter#allocatePayment}), recorded on each course exactly as the
 * per-course "Record payment" does, and gets one receipt covering all of them.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class AdmissionPackagePaymentService {

    private final AdmissionPackageRepository admissionPackageRepository;
    private final AdmissionPackageCourseRepository admissionPackageCourseRepository;
    private final StudentFeePaymentRepository studentFeePaymentRepository;
    private final UserPlanRepository userPlanRepository;
    private final PackageSessionRepository packageSessionRepository;
    private final CpoSideViewService cpoSideViewService;
    private final InvoiceService invoiceService;
    private final CpoDiscountService cpoDiscountService;
    private final FeeStopDuesService feeStopDuesService;
    private final FeeBillCancellationService feeBillCancellationService;
    private final FeeBillCancellationRepository feeBillCancellationRepository;

    /** A package with its courses and each course's live fee bills, in package order. */
    private record Loaded(AdmissionPackage pkg, List<AdmissionPackageCourse> courses, List<UserPlan> plans,
                          List<List<StudentFeePayment>> bills) {
    }

    public String instituteOf(String packageId) {
        return find(packageId).getInstituteId();
    }

    public List<AdmissionPackageSummaryDTO> listForUser(String userId, String instituteId) {
        List<AdmissionPackageSummaryDTO> out = new ArrayList<>();
        for (AdmissionPackage pkg : admissionPackageRepository.findByUserIdAndInstituteIdOrderByCreatedAtDesc(userId, instituteId)) {
            Loaded loaded = load(pkg);
            // Its courses' enrolments are gone (removed outside the app): nothing left to show.
            if (loaded.courses().isEmpty()) continue;
            out.add(summarise(loaded));
        }
        return out;
    }

    public AdmissionPackageSummaryDTO summary(String packageId) {
        return summarise(load(find(packageId)));
    }

    /** How {@code amount} would be shared between the courses. Saves nothing. */
    public AdmissionPackagePaymentPreviewDTO previewPayment(String packageId, BigDecimal amount) {
        Loaded loaded = load(find(packageId));
        BigDecimal[] shares = share(loaded, amount);
        List<AdmissionPackagePaymentPreviewDTO.Share> courses = new ArrayList<>();
        BigDecimal outstanding = BigDecimal.ZERO;
        for (int i = 0; i < loaded.courses().size(); i++) {
            outstanding = outstanding.add(outstanding(loaded.bills().get(i)));
            courses.add(AdmissionPackagePaymentPreviewDTO.Share.builder()
                    .userPlanId(loaded.courses().get(i).getUserPlanId())
                    .courseName(courseName(loaded.courses().get(i)))
                    .amount(shares[i])
                    .build());
        }
        return AdmissionPackagePaymentPreviewDTO.builder()
                .amount(amount).outstandingTotal(outstanding).courses(courses).build();
    }

    /**
     * Records one offline payment against the package: each course's share is recorded on that
     * course (ledger credit, oldest-first allocation, plan activation — all as a per-course
     * payment), in one transaction, and a single receipt lists every course it reached.
     */
    @Transactional
    public AdmissionPackageSummaryDTO recordPayment(String packageId, RecordOfflinePaymentRequestDTO req,
                                                    String adminUserId) {
        if (req == null || req.getAmount() == null || req.getAmount() <= 0) {
            throw new VacademyException("Payment amount must be positive");
        }
        Loaded loaded = load(find(packageId));
        BigDecimal[] shares = share(loaded, BigDecimal.valueOf(req.getAmount()));
        log.info("recordPackagePayment: package={}, amount={}, shares={}, appliedBy={}",
                packageId, req.getAmount(), java.util.Arrays.toString(shares), adminUserId);

        List<String> paymentLogIds = new ArrayList<>();
        for (int i = 0; i < shares.length; i++) {
            if (shares[i].signum() <= 0) continue;
            RecordOfflinePaymentRequestDTO part = RecordOfflinePaymentRequestDTO.builder()
                    .amount(shares[i].doubleValue())
                    .paymentDate(req.getPaymentDate())
                    .reference(req.getReference())
                    .currency(req.getCurrency())
                    .generateInvoice(false) // one receipt for the package, below
                    .paymentDetails(req.getPaymentDetails())
                    .build();
            paymentLogIds.add(cpoSideViewService.recordOfflinePaymentLog(
                    loaded.courses().get(i).getUserPlanId(), part, adminUserId));
        }
        if (req.isGenerateInvoice()) {
            invoiceService.generateCombinedInvoiceAfterCommit(paymentLogIds, loaded.pkg().getInstituteId());
        }
        return summarise(load(loaded.pkg()));
    }

    /**
     * Moves one package installment to a new due date on every course, so the courses' bills
     * stay together as one installment.
     */
    @Transactional
    public AdmissionPackageSummaryDTO moveInstallment(String packageId, LocalDate dueDate, LocalDate newDueDate,
                                                      String adminUserId) {
        if (newDueDate == null) {
            throw new VacademyException("Pick the new due date");
        }
        Loaded loaded = load(find(packageId));
        List<StudentFeePayment> bills = billsOn(loaded, dueDate);
        if (newDueDate.equals(dueDate)) {
            return summarise(loaded);
        }
        log.info("movePackageInstallment: package={}, {} -> {}, bills={}, appliedBy={}",
                packageId, dueDate, newDueDate, bills.size(), adminUserId);
        for (StudentFeePayment bill : bills) {
            LocalDate start = toLocalDate(bill.getStartDate());
            // A window that would open after the new due date opens on it instead.
            LocalDate newStart = start != null && start.isAfter(newDueDate) ? newDueDate : null;
            cpoDiscountService.setInstallmentDates(bill.getId(), newStart, newDueDate, adminUserId);
        }
        return summarise(load(loaded.pkg()));
    }

    /**
     * Moves {@code amount} of one package installment's unpaid balance onto a new installment
     * due on {@code newDueDate}: shared between the courses by what each still owes on it, and
     * split off each course's bill the same way the per-course Split does. Totals do not change.
     */
    @Transactional
    public AdmissionPackageSummaryDTO splitInstallment(String packageId, LocalDate dueDate, BigDecimal amount,
                                                       LocalDate newDueDate, String adminUserId) {
        if (newDueDate == null) {
            throw new VacademyException("Pick when the moved amount falls due");
        }
        if (newDueDate.equals(dueDate)) {
            throw new VacademyException("Pick a different date from the installment's own");
        }
        Loaded loaded = load(find(packageId));
        List<StudentFeePayment> open = new ArrayList<>();
        for (StudentFeePayment bill : billsOn(loaded, dueDate)) {
            String status = bill.getStatus() == null ? "" : bill.getStatus().toUpperCase();
            if (!"PAID".equals(status) && !"WAIVED".equals(status) && owed(bill).signum() > 0) {
                open.add(bill);
            }
        }
        if (open.isEmpty()) {
            throw new VacademyException("Nothing is unpaid on this installment");
        }
        BigDecimal[] shares = AdmissionPackageSplitter.shareOfInstallment(
                open.stream().map(AdmissionPackagePaymentService::owed).toList(), amount);
        log.info("splitPackageInstallment: package={}, due={}, amount={}, newDue={}, shares={}, appliedBy={}",
                packageId, dueDate, amount, newDueDate, java.util.Arrays.toString(shares), adminUserId);
        for (int i = 0; i < open.size(); i++) {
            if (shares[i].signum() <= 0) continue;
            LocalDate start = toLocalDate(open.get(i).getStartDate());
            cpoDiscountService.splitInstallment(open.get(i).getId(), shares[i],
                    start != null && !start.isAfter(newDueDate) ? start : null, newDueDate, adminUserId);
        }
        return summarise(load(loaded.pkg()));
    }

    /**
     * Stop dues on a package installment (or it and every later one) for every course at once —
     * a learner who dropped out or stopped paying. Optionally also removes them from every course
     * of the package.
     */
    public StopDuesResultDTO stopDues(String packageId, StopDuesRequestDTO req, String adminUserId) {
        if (req == null || req.getDueDate() == null) {
            throw new VacademyException("Say which installment: its due date");
        }
        Loaded loaded = load(find(packageId));
        List<StudentFeePayment> bills = new ArrayList<>();
        for (List<StudentFeePayment> courseBills : loaded.bills()) {
            for (StudentFeePayment bill : courseBills) {
                LocalDate due = toLocalDate(bill.getDueDate());
                boolean picked = req.isIncludeLater()
                        ? due == null || !due.isBefore(req.getDueDate())
                        : req.getDueDate().equals(due);
                if (picked) bills.add(bill);
            }
        }
        log.info("stopPackageDues: package={}, from={}, later={}, remove={}, bills={}, by={}", packageId,
                req.getDueDate(), req.isIncludeLater(), req.isRemoveFromCourse(), bills.size(), adminUserId);
        List<String> planIds = loaded.courses().stream().map(AdmissionPackageCourse::getUserPlanId).toList();
        return feeStopDuesService.stop(bills, req, loaded.pkg().getUserId(), loaded.pkg().getInstituteId(),
                planIds, adminUserId);
    }

    /** Reopens what was stopped together with the package installment due on {@code dueDate}. */
    public StopDuesResultDTO reopenDues(String packageId, LocalDate dueDate, String adminUserId) {
        if (dueDate == null) {
            throw new VacademyException("Say which installment: its due date");
        }
        Loaded loaded = load(find(packageId));
        java.util.Map<String, StudentFeePayment> toReopen = new java.util.LinkedHashMap<>();
        for (List<StudentFeePayment> courseBills : loaded.bills()) {
            for (StudentFeePayment bill : courseBills) {
                if (!FeeBillCancellationService.CANCELLED.equalsIgnoreCase(bill.getStatus())) continue;
                if (!dueDate.equals(toLocalDate(bill.getDueDate()))) continue;
                for (StudentFeePayment b : feeBillCancellationService.stoppedWith(bill)) toReopen.put(b.getId(), b);
            }
        }
        return feeStopDuesService.reopen(new ArrayList<>(toReopen.values()), adminUserId);
    }

    /**
     * Sets a package installment's amount to {@code amount} on every course: each course keeps
     * what it has paid on it, and the unpaid part is shared between the courses in proportion to
     * what each still owes on it. The package total moves by the difference.
     */
    @Transactional
    public AdmissionPackageSummaryDTO setInstallmentAmount(String packageId, LocalDate dueDate, BigDecimal amount,
                                                           String adminUserId) {
        if (amount == null || amount.signum() < 0) {
            throw new VacademyException("Enter the installment's new amount");
        }
        Loaded loaded = load(find(packageId));
        List<StudentFeePayment> bills = new ArrayList<>();
        for (StudentFeePayment bill : billsOn(loaded, dueDate)) {
            if (!"WAIVED".equalsIgnoreCase(bill.getStatus())) bills.add(bill);
        }
        BigDecimal paidOn = bills.stream().map(b -> nz(b.getAmountPaid())).reduce(BigDecimal.ZERO, BigDecimal::add);
        BigDecimal unpaidOn = bills.stream().map(AdmissionPackagePaymentService::owed)
                .reduce(BigDecimal.ZERO, BigDecimal::add);
        if (unpaidOn.signum() <= 0) {
            throw new VacademyException("This installment is paid, so its amount cannot change");
        }
        if (amount.compareTo(paidOn) < 0) {
            throw new VacademyException(paidOn.stripTrailingZeros().toPlainString()
                    + " is already paid on this installment, so it cannot be less than that");
        }
        BigDecimal[] unpaidParts = AdmissionPackageSplitter.shareByWeight(
                bills.stream().map(AdmissionPackagePaymentService::owed).toList(), amount.subtract(paidOn));
        log.info("setPackageInstallmentAmount: package={}, due={}, amount={}, unpaid shares={}, by={}",
                packageId, dueDate, amount, java.util.Arrays.toString(unpaidParts), adminUserId);
        for (int i = 0; i < bills.size(); i++) {
            BigDecimal net = nz(bills.get(i).getAmountPaid()).add(unpaidParts[i]);
            if (net.compareTo(nz(bills.get(i).getAmountExpected())) == 0) continue;
            cpoDiscountService.setInstallmentNetAmount(bills.get(i).getId(), net,
                    "Package installment amount changed", adminUserId);
        }
        return summarise(load(loaded.pkg()));
    }

    // ---------------------------------------------------------------- helpers

    /** The courses' live (not cancelled) bills due on {@code dueDate}: one package installment. */
    private List<StudentFeePayment> billsOn(Loaded loaded, LocalDate dueDate) {
        if (dueDate == null) {
            throw new VacademyException("Say which installment: its due date");
        }
        List<StudentFeePayment> out = new ArrayList<>();
        for (List<StudentFeePayment> bills : loaded.bills()) {
            for (StudentFeePayment bill : bills) {
                if (FeeBillCancellationService.CANCELLED.equalsIgnoreCase(bill.getStatus())) continue;
                if (dueDate.equals(toLocalDate(bill.getDueDate()))) out.add(bill);
            }
        }
        if (out.isEmpty()) {
            throw new VacademyException("This package has no installment due on " + dueDate);
        }
        return out;
    }

    /** The open Stop dues record of each of the package's cancelled bills, by bill id. */
    private Map<String, FeeBillCancellation> stopsOf(Loaded loaded) {
        List<String> cancelled = new ArrayList<>();
        for (List<StudentFeePayment> bills : loaded.bills()) {
            for (StudentFeePayment bill : bills) {
                if (FeeBillCancellationService.CANCELLED.equalsIgnoreCase(bill.getStatus())) cancelled.add(bill.getId());
            }
        }
        Map<String, FeeBillCancellation> out = new java.util.HashMap<>();
        if (cancelled.isEmpty()) return out;
        for (FeeBillCancellation c : feeBillCancellationRepository.findByStudentFeePaymentIdInAndReopenedAtIsNull(cancelled)) {
            out.put(c.getStudentFeePaymentId(), c);
        }
        return out;
    }

    private AdmissionPackage find(String packageId) {
        return admissionPackageRepository.findById(packageId)
                .orElseThrow(() -> new VacademyException("Admission package not found: " + packageId));
    }

    private Loaded load(AdmissionPackage pkg) {
        List<AdmissionPackageCourse> courses =
                admissionPackageCourseRepository.findByAdmissionPackageIdOrderByPositionAsc(pkg.getId());
        List<UserPlan> plans = new ArrayList<>();
        List<List<StudentFeePayment>> bills = new ArrayList<>();
        for (AdmissionPackageCourse course : courses) {
            plans.add(userPlanRepository.findById(course.getUserPlanId()).orElse(null));
            List<StudentFeePayment> rows = new ArrayList<>(studentFeePaymentRepository.findByUserPlanId(course.getUserPlanId()));
            // A cancelled bill stays: it holds what was paid on it (amount cut to that), and a stopped
            // one shows as stopped. Nothing is owed on it, so no payment or change reaches it.
            rows.removeIf(r -> "DELETED".equalsIgnoreCase(r.getStatus()));
            bills.add(rows);
        }
        return new Loaded(pkg, courses, plans, bills);
    }

    /**
     * Each course's share of {@code amount}. Only bills the course's own allocation will pay are
     * counted: not yet PAID, with something still owed.
     */
    private BigDecimal[] share(Loaded loaded, BigDecimal amount) {
        List<AdmissionPackageSplitter.OpenBill> open = new ArrayList<>();
        for (int i = 0; i < loaded.courses().size(); i++) {
            for (StudentFeePayment bill : loaded.bills().get(i)) {
                if ("PAID".equalsIgnoreCase(bill.getStatus())) continue;
                BigDecimal owed = owed(bill);
                if (owed.signum() > 0) {
                    open.add(new AdmissionPackageSplitter.OpenBill(i, toLocalDate(bill.getDueDate()), owed));
                }
            }
        }
        if (open.isEmpty()) {
            throw new VacademyException("Nothing is owed on this package");
        }
        return AdmissionPackageSplitter.allocatePayment(loaded.courses().size(), open, amount);
    }

    private AdmissionPackageSummaryDTO summarise(Loaded loaded) {
        LocalDate today = LocalDate.now();
        BigDecimal net = BigDecimal.ZERO, paid = BigDecimal.ZERO;
        String currency = null;
        List<AdmissionPackageSummaryDTO.Course> courses = new ArrayList<>();
        Map<LocalDate, BigDecimal[]> byDate = new TreeMap<>(); // amount, paid, owed, stopped
        Map<LocalDate, String> stoppedReason = new java.util.HashMap<>();
        Map<String, FeeBillCancellation> stops = stopsOf(loaded);
        for (int i = 0; i < loaded.courses().size(); i++) {
            AdmissionPackageCourse course = loaded.courses().get(i);
            UserPlan plan = loaded.plans().get(i);
            if (currency == null && plan != null && plan.getPaymentPlan() != null) {
                currency = plan.getPaymentPlan().getCurrency();
            }
            BigDecimal courseNet = BigDecimal.ZERO, coursePaid = BigDecimal.ZERO;
            for (StudentFeePayment bill : loaded.bills().get(i)) {
                BigDecimal expected = nz(bill.getAmountExpected());
                BigDecimal billPaid = nz(bill.getAmountPaid());
                courseNet = courseNet.add(expected);
                coursePaid = coursePaid.add(billPaid);
                LocalDate due = toLocalDate(bill.getDueDate());
                if (due == null) continue;
                BigDecimal[] day = byDate.computeIfAbsent(due, d -> new BigDecimal[]{
                        BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO});
                day[0] = day[0].add(expected);
                day[1] = day[1].add(billPaid);
                if (!"PAID".equalsIgnoreCase(bill.getStatus())) day[2] = day[2].add(owed(bill));
                FeeBillCancellation stop = stops.get(bill.getId());
                if (stop != null) {
                    day[3] = day[3].add(stop.cancelledAmount());
                    if (stop.getReason() != null) stoppedReason.putIfAbsent(due, stop.getReason());
                }
            }
            net = net.add(courseNet);
            paid = paid.add(coursePaid);
            courses.add(AdmissionPackageSummaryDTO.Course.builder()
                    .userPlanId(course.getUserPlanId())
                    .packageSessionId(course.getPackageSessionId())
                    .courseName(courseName(course))
                    .planStatus(plan != null ? plan.getStatus() : null)
                    .fee(course.getFee())
                    .discount(course.getDiscount())
                    .net(courseNet)
                    .paid(coursePaid)
                    .outstanding(courseNet.subtract(coursePaid).max(BigDecimal.ZERO))
                    .build());
        }

        List<AdmissionPackageSummaryDTO.Installment> installments = new ArrayList<>();
        LocalDate nextDue = null;
        BigDecimal nextAmount = null;
        for (Map.Entry<LocalDate, BigDecimal[]> e : byDate.entrySet()) {
            BigDecimal[] day = e.getValue();
            if (day[0].signum() == 0 && day[1].signum() == 0 && day[3].signum() == 0) continue;
            String status = day[2].signum() <= 0 ? (day[3].signum() > 0 ? "STOPPED" : "PAID")
                    : e.getKey().isBefore(today) ? "OVERDUE"
                    : day[1].signum() > 0 ? "PARTIAL_PAID" : "DUE";
            installments.add(AdmissionPackageSummaryDTO.Installment.builder()
                    .dueDate(e.getKey()).amount(day[0]).paid(day[1]).outstanding(day[2])
                    .stopped(day[3].signum() > 0 ? day[3] : null).stoppedReason(stoppedReason.get(e.getKey()))
                    .status(status).build());
            if (nextDue == null && day[2].signum() > 0) {
                nextDue = e.getKey();
                nextAmount = day[2];
            }
        }

        AdmissionPackage pkg = loaded.pkg();
        return AdmissionPackageSummaryDTO.builder()
                .id(pkg.getId())
                .createdAt(pkg.getCreatedAt())
                .discountReason(pkg.getDiscountReason())
                .currency(currency)
                .feeTotal(pkg.getFeeTotal())
                .discountTotal(pkg.getDiscountTotal())
                .netTotal(net)
                .paidTotal(paid)
                .outstandingTotal(net.subtract(paid).max(BigDecimal.ZERO))
                .nextDueDate(nextDue)
                .nextDueAmount(nextAmount)
                .courses(courses)
                .installments(installments)
                .build();
    }

    private String courseName(AdmissionPackageCourse course) {
        return packageSessionRepository.findById(course.getPackageSessionId())
                .map(ps -> ps.getPackageEntity() != null ? ps.getPackageEntity().getPackageName() : null)
                .orElse(null);
    }

    private static BigDecimal owed(StudentFeePayment bill) {
        return nz(bill.getAmountExpected()).subtract(nz(bill.getAmountPaid())).max(BigDecimal.ZERO);
    }

    private static BigDecimal outstanding(List<StudentFeePayment> bills) {
        return bills.stream().filter(b -> !"PAID".equalsIgnoreCase(b.getStatus()))
                .map(AdmissionPackagePaymentService::owed).reduce(BigDecimal.ZERO, BigDecimal::add);
    }

    private static BigDecimal nz(BigDecimal v) {
        return v == null ? BigDecimal.ZERO : v;
    }

    /** A DATE column arrives as {@link java.sql.Date}, whose {@code toInstant()} throws. */
    private static LocalDate toLocalDate(java.util.Date date) {
        if (date == null) return null;
        if (date instanceof java.sql.Date sqlDate) return sqlDate.toLocalDate();
        return date.toInstant().atZone(java.time.ZoneId.systemDefault()).toLocalDate();
    }
}
