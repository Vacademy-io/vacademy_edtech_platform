package vacademy.io.admin_core_service.features.commerce.tax.repository;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import vacademy.io.admin_core_service.features.commerce.tax.entity.CommerceTaxClass;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface CommerceTaxClassRepository extends JpaRepository<CommerceTaxClass, String> {

    Optional<CommerceTaxClass> findByInstituteIdAndId(String instituteId, String id);

    Optional<CommerceTaxClass> findByInstituteIdAndCode(String instituteId, String code);

    List<CommerceTaxClass> findByInstituteIdAndIdIn(String instituteId, Collection<String> ids);

    Page<CommerceTaxClass> findByInstituteId(String instituteId, Pageable pageable);

    /** Published products that use the class. Read from the catalogue table; nothing is written. */
    @Query(value = "SELECT COUNT(*) FROM commerce_product"
            + " WHERE institute_id = :instituteId AND tax_class_id = :taxClassId AND status = 'ACTIVE'",
            nativeQuery = true)
    long countActiveProductsUsing(@Param("instituteId") String instituteId, @Param("taxClassId") String taxClassId);

    /** Published products with no tax class: they block a switch to REGULAR tax mode. */
    @Query(value = "SELECT COUNT(*) FROM commerce_product"
            + " WHERE institute_id = :instituteId AND tax_class_id IS NULL AND status = 'ACTIVE'",
            nativeQuery = true)
    long countActiveProductsWithoutTaxClass(@Param("instituteId") String instituteId);
}
