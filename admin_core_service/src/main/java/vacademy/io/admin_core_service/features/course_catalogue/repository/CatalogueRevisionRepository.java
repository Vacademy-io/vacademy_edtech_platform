package vacademy.io.admin_core_service.features.course_catalogue.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import vacademy.io.admin_core_service.features.course_catalogue.entity.CatalogueRevision;

import java.util.Date;
import java.util.List;
import java.util.Optional;

public interface CatalogueRevisionRepository extends JpaRepository<CatalogueRevision, String> {

    // IdDesc tiebreaker: equal revision_no rows (pre-fix data) resolve deterministically
    Optional<CatalogueRevision> findFirstByCatalogueIdAndStatusOrderByRevisionNoDescIdDesc(String catalogueId, String status);

    List<CatalogueRevision> findByCatalogueIdAndStatusInOrderByRevisionNoDescIdDesc(String catalogueId, List<String> statuses);

    Optional<CatalogueRevision> findFirstByCatalogueIdOrderByRevisionNoDescIdDesc(String catalogueId);

    // The live version is the PUBLISHED row touched last (publish bumps updated_at)
    Optional<CatalogueRevision> findFirstByCatalogueIdAndStatusOrderByUpdatedAtDescIdDesc(String catalogueId, String status);

    // What was live when a draft started: the last PUBLISHED row touched at or before then
    Optional<CatalogueRevision> findFirstByCatalogueIdAndStatusAndUpdatedAtLessThanEqualOrderByUpdatedAtDescIdDesc(
            String catalogueId, String status, Date at);

    // A given PUBLISHED version (what the editor loaded)
    Optional<CatalogueRevision> findFirstByCatalogueIdAndRevisionNoAndStatusOrderByUpdatedAtDescIdDesc(
            String catalogueId, Integer revisionNo, String status);
}
