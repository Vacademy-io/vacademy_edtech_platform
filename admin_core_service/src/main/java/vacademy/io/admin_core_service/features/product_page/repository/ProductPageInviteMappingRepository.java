package vacademy.io.admin_core_service.features.product_page.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.product_page.entity.ProductPageInviteMapping;

import java.util.List;

@Repository
public interface ProductPageInviteMappingRepository extends JpaRepository<ProductPageInviteMapping, String> {

    /** Unordered, bridges loaded lazily one by one. Prefer {@link #findOrderedWithBridge}. */
    List<ProductPageInviteMapping> findByProductPageIdAndStatusIn(String coursePageId, List<String> statuses);

    /**
     * A page's mappings in the order the page shows them (display_order, then
     * created_at and id, because rows written outside the editor all sit on
     * the column default 0), each with its bridge row and everything a
     * response reads from it - invite, package session (course, level,
     * session, group) and payment option - in this one query. Reading them
     * lazily cost one query per course, which a store page selling the whole
     * catalogue multiplies into hundreds.
     */
    @Query("SELECT m FROM ProductPageInviteMapping m "
            + "JOIN FETCH m.psInvitePaymentOption b "
            + "LEFT JOIN FETCH b.enrollInvite "
            + "LEFT JOIN FETCH b.packageSession ps "
            + "LEFT JOIN FETCH ps.packageEntity "
            + "LEFT JOIN FETCH ps.level "
            + "LEFT JOIN FETCH ps.session "
            + "LEFT JOIN FETCH ps.group "
            + "LEFT JOIN FETCH b.paymentOption "
            + "WHERE m.productPage.id = :productPageId AND m.status IN :statuses "
            + "ORDER BY m.displayOrder ASC, m.createdAt ASC, m.id ASC")
    List<ProductPageInviteMapping> findOrderedWithBridge(@Param("productPageId") String productPageId,
                                                         @Param("statuses") List<String> statuses);

    /** How many mappings in the statuses each of the pages has, as rows of page id and count. */
    @Query("SELECT m.productPage.id, COUNT(m) FROM ProductPageInviteMapping m "
            + "WHERE m.productPage.id IN :productPageIds AND m.status IN :statuses "
            + "GROUP BY m.productPage.id")
    List<Object[]> countByProductPageIds(@Param("productPageIds") List<String> productPageIds,
                                         @Param("statuses") List<String> statuses);

    @Modifying
    @Query("UPDATE ProductPageInviteMapping m SET m.status = :status WHERE m.productPage.id = :coursePageId")
    void updateStatusByProductPageId(@Param("coursePageId") String coursePageId, @Param("status") String status);
}
