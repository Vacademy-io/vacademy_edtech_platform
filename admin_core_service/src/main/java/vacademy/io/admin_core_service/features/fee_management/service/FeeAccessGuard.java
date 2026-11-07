package vacademy.io.admin_core_service.features.fee_management.service;

import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.core.security.GuardedChild;
import vacademy.io.admin_core_service.core.security.GuardianAccessGuard;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.fee_management.entity.ComplexPaymentOption;
import vacademy.io.admin_core_service.features.fee_management.entity.StudentFeePayment;
import vacademy.io.admin_core_service.features.fee_management.repository.ComplexPaymentOptionRepository;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ForbiddenException;
import vacademy.io.common.exceptions.VacademyException;

import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.Set;

/**
 * Who may call {@code /admin-core-service/v1/admin/student-fee/**}. Every route there took the
 * institute (or only an entity id) from the request with no caller check, so any signed-in
 * user could read any institute's fee roster and dues, mark bills paid, grant concessions or
 * mint receipt download links.
 *
 * <p>The rule:
 * <ul>
 *   <li>Fee management (reads and writes): institute STAFF of the institute that owns the data
 *       ({@link InstituteAccessValidator#requireInstituteStaff}: no root-user bypass, because
 *       learners carry {@code is_root_user}; {@code clientId} header must equal the institute).
 *       Where the route names only an entity (bill / installment / invoice / payment option) the
 *       institute is resolved from that entity, never taken from the request.</li>
 *   <li>The three parent-portal reads ({@code {userId}/dues}, {@code {userId}/invoice-receipts},
 *       {@code receipt/{invoiceId}/download-url}): staff as above, OR the learner reading their
 *       own data, OR a guardian linked to that learner — both decided by
 *       {@link GuardianAccessGuard#requireLinkedChild} (link checked against auth_service,
 *       institute from the {@code clientId} header, child enrolled there) — and the institute
 *       being read must be that same header institute.</li>
 * </ul>
 */
@Component
public class FeeAccessGuard {

    private final InstituteAccessValidator instituteAccessValidator;
    private final GuardianAccessGuard guardianAccessGuard;
    private final ComplexPaymentOptionRepository complexPaymentOptionRepository;

    public FeeAccessGuard(InstituteAccessValidator instituteAccessValidator,
                          GuardianAccessGuard guardianAccessGuard,
                          ComplexPaymentOptionRepository complexPaymentOptionRepository) {
        this.instituteAccessValidator = instituteAccessValidator;
        this.guardianAccessGuard = guardianAccessGuard;
        this.complexPaymentOptionRepository = complexPaymentOptionRepository;
    }

    /** Institute staff (admin, teacher, custom staff role) of {@code instituteId}; learners refused. */
    public void requireStaff(CustomUserDetails user, String instituteId) {
        instituteAccessValidator.requireInstituteStaff(user, instituteId);
    }

    /**
     * Staff of {@code instituteId}, and every bill must belong to that institute — so a staff
     * member of one institute cannot act on another institute's bills by naming their own.
     */
    public void requireStaffForBills(CustomUserDetails user, String instituteId,
                                     Collection<StudentFeePayment> bills) {
        requireStaff(user, instituteId);
        if (bills == null) {
            return;
        }
        for (StudentFeePayment bill : bills) {
            if (bill == null) {
                continue;
            }
            if (!instituteId.equals(resolveBillInstituteId(bill))) {
                throw new ForbiddenException("Access denied: fee record does not belong to institute " + instituteId);
            }
        }
    }

    /**
     * Staff of the institute that owns every given bill. All bills must resolve to one institute
     * (the caller's clientId institute); an empty collection resolves to nothing and is refused.
     *
     * @return the resolved institute id
     */
    public String requireStaffOfBillsInstitute(CustomUserDetails user, Collection<StudentFeePayment> bills,
                                               String requestedInstituteId) {
        Set<String> institutes = new LinkedHashSet<>();
        if (StringUtils.hasText(requestedInstituteId)) {
            institutes.add(requestedInstituteId);
        }
        if (bills != null) {
            for (StudentFeePayment bill : bills) {
                if (bill != null) {
                    institutes.add(resolveBillInstituteId(bill));
                }
            }
        }
        institutes.remove(null);
        if (institutes.isEmpty()) {
            throw new ForbiddenException("Access denied: the institute of these fee records could not be resolved");
        }
        if (institutes.size() > 1) {
            throw new ForbiddenException("Access denied: fee records span more than one institute");
        }
        String instituteId = institutes.iterator().next();
        requireStaff(user, instituteId);
        return instituteId;
    }

    /** Staff of the institute that owns the payment option {@code cpoId}. */
    public void requireStaffOfPaymentOption(CustomUserDetails user, String cpoId) {
        String instituteId = !StringUtils.hasText(cpoId) ? null : complexPaymentOptionRepository.findById(cpoId)
                .map(ComplexPaymentOption::getInstituteId)
                .orElse(null);
        if (!StringUtils.hasText(instituteId)) {
            throw new ForbiddenException("Access denied: unknown payment option");
        }
        requireStaff(user, instituteId);
    }

    /**
     * A learner's fee data, as read by the parent portal or the admin dashboard: staff of
     * {@code instituteId}, or the learner themself / a linked guardian with {@code instituteId}
     * equal to the {@code clientId} institute the guardian check ran against.
     */
    public void requireStaffOrLearnerSide(CustomUserDetails user, String learnerUserId, String instituteId) {
        RuntimeException staffDenial;
        try {
            requireStaff(user, instituteId);
            return;
        } catch (ForbiddenException | VacademyException e) {
            staffDenial = e;
        }
        if (!StringUtils.hasText(instituteId) || !StringUtils.hasText(learnerUserId)) {
            throw staffDenial;
        }
        // Self or linked guardian. Throws 403 when not linked / not enrolled, 503 when the
        // link source (auth_service) is unreachable.
        GuardedChild child = guardianAccessGuard.requireLinkedChild(user, learnerUserId);
        if (!instituteId.equals(child.instituteId())) {
            throw new ForbiddenException("Access denied: fee data of another institute");
        }
    }

    /**
     * The institute a bill belongs to: its own {@code institute_id}, or — for rows created
     * before V163 added that column — the institute of its payment option (non-null there).
     */
    public String resolveBillInstituteId(StudentFeePayment bill) {
        if (StringUtils.hasText(bill.getInstituteId())) {
            return bill.getInstituteId();
        }
        if (!StringUtils.hasText(bill.getCpoId())) {
            return null;
        }
        return complexPaymentOptionRepository.findById(bill.getCpoId())
                .map(ComplexPaymentOption::getInstituteId)
                .orElse(null);
    }
}
