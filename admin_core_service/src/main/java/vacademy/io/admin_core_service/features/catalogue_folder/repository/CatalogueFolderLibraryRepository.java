package vacademy.io.admin_core_service.features.catalogue_folder.repository;

import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.catalogue_folder.entity.CatalogueFolderLibrary;

import java.util.List;
import java.util.Optional;

@Repository
public interface CatalogueFolderLibraryRepository extends JpaRepository<CatalogueFolderLibrary, String> {

    Optional<CatalogueFolderLibrary> findByIdAndInstituteIdAndStatus(String id, String instituteId, String status);

    /**
     * The same lookup, holding a row lock until the transaction ends. Every
     * change to a library's tree takes it first, so two admins' moves are
     * applied one after the other: checked concurrently, "A into B" and "B
     * into A" would each pass the cycle check and orphan both subtrees.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT l FROM CatalogueFolderLibrary l WHERE l.id = :id AND l.instituteId = :instituteId AND l.status = :status")
    Optional<CatalogueFolderLibrary> lockForUpdate(@Param("id") String id,
                                                   @Param("instituteId") String instituteId,
                                                   @Param("status") String status);

    List<CatalogueFolderLibrary> findByInstituteIdAndStatusOrderByUpdatedAtDesc(String instituteId, String status);

    long countByInstituteIdAndStatus(String instituteId, String status);
}
