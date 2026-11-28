package vacademy.io.admin_core_service.features.commerce.catalogue.repository;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import vacademy.io.admin_core_service.features.commerce.catalogue.entity.CommerceProduct;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface CommerceProductRepository extends JpaRepository<CommerceProduct, String> {

    Optional<CommerceProduct> findByInstituteIdAndPackageId(String instituteId, String packageId);

    /** "Is this package a shop product?" for the guards on legacy code; returns no data. */
    boolean existsByPackageId(String packageId);

    Optional<CommerceProduct> findByInstituteIdAndExternalRef(String instituteId, String externalRef);

    Optional<CommerceProduct> findByInstituteIdAndSlug(String instituteId, String slug);

    List<CommerceProduct> findByInstituteIdAndPackageIdIn(String instituteId, Collection<String> packageIds);

    /** :q is an already lower-cased LIKE pattern; search_text is stored lower-cased. */
    @Query("""
            SELECT p FROM CommerceProduct p
            WHERE p.instituteId = :instituteId
              AND (:status IS NULL OR p.status = :status)
              AND (:q IS NULL OR p.slug LIKE :q OR EXISTS (
                    SELECT 1 FROM CommerceProductTranslation t
                    WHERE t.instituteId = :instituteId AND t.packageId = p.packageId AND t.searchText LIKE :q))
              AND (:collectionId IS NULL OR EXISTS (
                    SELECT 1 FROM CommerceProductCollection pc
                    WHERE pc.instituteId = :instituteId AND pc.packageId = p.packageId
                      AND pc.collectionId = :collectionId))
              AND (:taxClassMissing = FALSE OR p.taxClassId IS NULL)
            """)
    Page<CommerceProduct> search(@Param("instituteId") String instituteId,
                                 @Param("status") String status,
                                 @Param("q") String q,
                                 @Param("collectionId") String collectionId,
                                 @Param("taxClassMissing") boolean taxClassMissing,
                                 Pageable pageable);
}
