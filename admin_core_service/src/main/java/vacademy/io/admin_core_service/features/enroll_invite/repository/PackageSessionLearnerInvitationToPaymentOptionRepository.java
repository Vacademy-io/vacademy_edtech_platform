package vacademy.io.admin_core_service.features.enroll_invite.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.enroll_invite.entity.EnrollInvite;
import vacademy.io.admin_core_service.features.enroll_invite.entity.PackageSessionLearnerInvitationToPaymentOption;

import java.util.List;
import java.util.Optional;

@Repository
public interface PackageSessionLearnerInvitationToPaymentOptionRepository
                extends JpaRepository<PackageSessionLearnerInvitationToPaymentOption, String> {

        @Query("SELECT psl FROM PackageSessionLearnerInvitationToPaymentOption psl " +
                        "WHERE psl.enrollInvite.id = :enrollInviteId " +
                        "AND psl.packageSession.id = :packageSessionId " +
                        "AND psl.status != 'DELETED' " +
                        "ORDER BY psl.createdAt DESC")
        Optional<PackageSessionLearnerInvitationToPaymentOption> findActiveByEnrollInviteIdAndPackageSessionId(
                        @Param("enrollInviteId") String enrollInviteId,
                        @Param("packageSessionId") String packageSessionId);

        List<PackageSessionLearnerInvitationToPaymentOption> findByEnrollInviteAndStatusIn(
                        EnrollInvite enrollInvite,
                        List<String> statusList);

        @Query("SELECT psl " +
                        "FROM PackageSessionLearnerInvitationToPaymentOption psl " +
                        "WHERE psl.paymentOption.id IN :paymentOptionIds " +
                        "AND psl.enrollInvite.status IN :enrollInviteStatuses " +
                        "AND psl.status IN :invitationStatuses")
        List<PackageSessionLearnerInvitationToPaymentOption> findByCriteria(
                        @Param("paymentOptionIds") List<String> paymentOptionIds,
                        @Param("enrollInviteStatuses") List<String> enrollInviteStatuses,
                        @Param("invitationStatuses") List<String> invitationStatuses);

        List<PackageSessionLearnerInvitationToPaymentOption> findByEnrollInvite_IdInAndStatusIn(
                        List<String> enrollInviteIds,
                        List<String> statusList);

        @Modifying
        @Query("UPDATE PackageSessionLearnerInvitationToPaymentOption psl " +
                        "SET psl.status = :status " +
                        "WHERE psl.id IN :ids")
        void updateStatusByIds(List<String> ids, String status);

        List<PackageSessionLearnerInvitationToPaymentOption> findByEnrollInvite_IdInAndPaymentOption_IdInAndPackageSession_IdInAndStatusIn(
                        List<String> enrollInviteIds, List<String> paymentOptionIds, List<String> packageSessionIds,
                        List<String> status);

        /** One entry per package type on the invite, whatever the link's status; null for an untyped course. */
        @Query("SELECT DISTINCT p.packageSession.packageEntity.packageType FROM PackageSessionLearnerInvitationToPaymentOption p WHERE p.enrollInvite.id = :enrollInviteId")
        List<String> findPackageTypesByEnrollInviteId(@Param("enrollInviteId") String enrollInviteId);

        @Query("SELECT p.packageSession.id FROM PackageSessionLearnerInvitationToPaymentOption p WHERE p.enrollInvite = :enrollInvite AND p.status IN :status")
        List<String> findPackageSessionIdsByEnrollInviteAndStatusIn(@Param("enrollInvite") EnrollInvite enrollInvite,
                        @Param("status") List<String> status);

        @Query("SELECT p FROM PackageSessionLearnerInvitationToPaymentOption p JOIN FETCH p.packageSession ps LEFT JOIN FETCH ps.level LEFT JOIN FETCH ps.session LEFT JOIN FETCH ps.packageEntity JOIN FETCH p.paymentOption WHERE p.enrollInvite.id IN :enrollInviteIds AND p.status IN :statusList")
        List<PackageSessionLearnerInvitationToPaymentOption> findByEnrollInviteIdsAndStatusWithPackageSession(
                        @Param("enrollInviteIds") List<String> enrollInviteIds,
                        @Param("statusList") List<String> statusList);

        @Query("SELECT p FROM PackageSessionLearnerInvitationToPaymentOption p JOIN FETCH p.packageSession ps LEFT JOIN FETCH ps.level LEFT JOIN FETCH ps.session LEFT JOIN FETCH ps.packageEntity JOIN FETCH p.paymentOption WHERE p.enrollInvite.id = :enrollInviteId AND p.status IN :statusList")
        List<PackageSessionLearnerInvitationToPaymentOption> findByEnrollInviteIdAndStatusWithPackageSession(
                        @Param("enrollInviteId") String enrollInviteId,
                        @Param("statusList") List<String> statusList);

        @Modifying
        @Transactional
        @Query("UPDATE PackageSessionLearnerInvitationToPaymentOption psl " +
                        "SET psl.status = :status " +
                        "WHERE psl.packageSession.id IN :packageSessionIds")
        void updateStatusByPackageSessionIds(@Param("packageSessionIds") List<String> packageSessionIds,
                        @Param("status") String status);

        @Query("SELECT DISTINCT psl.enrollInvite.id FROM PackageSessionLearnerInvitationToPaymentOption psl " +
                        "WHERE psl.packageSession.id IN :packageSessionIds")
        List<String> findDistinctEnrollInviteIdsByPackageSessionIds(
                        @Param("packageSessionIds") List<String> packageSessionIds);

        @Query("SELECT psl.enrollInvite.id, COUNT(psl) " +
                        "FROM PackageSessionLearnerInvitationToPaymentOption psl " +
                        "WHERE psl.enrollInvite.id IN :enrollInviteIds " +
                        "AND psl.status != 'DELETED' " +
                        "GROUP BY psl.enrollInvite.id")
        List<Object[]> countActiveByEnrollInviteIds(@Param("enrollInviteIds") List<String> enrollInviteIds);

        @Query("SELECT DISTINCT psl.paymentOption.complexPaymentOptionId FROM PackageSessionLearnerInvitationToPaymentOption psl " +
                        "WHERE psl.packageSession.id = :packageSessionId " +
                        "AND psl.paymentOption.complexPaymentOptionId IS NOT NULL " +
                        "AND psl.status = 'ACTIVE'")
        List<String> findDistinctCpoIdsByPackageSessionId(@Param("packageSessionId") String packageSessionId);

        @Query(value = "SELECT DISTINCT sfp.user_plan_id, p.package_session_id " +
                        "FROM student_fee_payment sfp " +
                        "JOIN payment_option po ON po.complex_payment_option_id = sfp.cpo_id " +
                        "JOIN package_session_learner_invitation_to_payment_option p " +
                        "ON p.payment_option_id = po.id " +
                        "WHERE sfp.user_plan_id IN (:userPlanIds) " +
                        "AND p.status != 'DELETED'", nativeQuery = true)
        List<Object[]> findPackageSessionIdsByUserPlanIds(@Param("userPlanIds") List<String> userPlanIds);

        @Query("SELECT psl FROM PackageSessionLearnerInvitationToPaymentOption psl " +
                        "WHERE psl.paymentOption.complexPaymentOptionId = :cpoId AND psl.status != 'DELETED'")
        List<PackageSessionLearnerInvitationToPaymentOption> findByCpoId(@Param("cpoId") String cpoId);

        @Query(value = "SELECT DISTINCT psl.package_session_id FROM package_session_learner_invitation_to_payment_option psl " +
                        "WHERE psl.enroll_invite_id IN (:enrollInviteIds) " +
                        "AND psl.status != 'DELETED'", nativeQuery = true)
        List<String> findPackageSessionIdsByEnrollInviteIds(@Param("enrollInviteIds") List<String> enrollInviteIds);

        @Query("SELECT psl FROM PackageSessionLearnerInvitationToPaymentOption psl " +
                        "JOIN FETCH psl.packageSession ps " +
                        "LEFT JOIN FETCH ps.level " +
                        "LEFT JOIN FETCH ps.session " +
                        "LEFT JOIN FETCH ps.packageEntity " +
                        "JOIN FETCH psl.paymentOption po " +
                        "JOIN psl.enrollInvite ei " +
                        "WHERE psl.packageSession.id IN :packageSessionIds " +
                        "AND ei.instituteId = :instituteId " +
                        "AND psl.status = 'ACTIVE' " +
                        "AND ei.status = 'ACTIVE'")
        List<PackageSessionLearnerInvitationToPaymentOption> findActiveByPackageSessionIdsAndInstituteId(
                        @Param("packageSessionIds") List<String> packageSessionIds,
                        @Param("instituteId") String instituteId);

        @Query("SELECT psl FROM PackageSessionLearnerInvitationToPaymentOption psl " +
                        "JOIN psl.enrollInvite ei " +
                        "WHERE psl.paymentOption.id IN :paymentOptionIds " +
                        "AND ei.instituteId = :instituteId " +
                        "AND psl.status = 'ACTIVE' " +
                        "AND ei.status = 'ACTIVE'")
        List<PackageSessionLearnerInvitationToPaymentOption> findActiveByPaymentOptionIdsAndInstituteId(
                        @Param("paymentOptionIds") List<String> paymentOptionIds,
                        @Param("instituteId") String instituteId);
}