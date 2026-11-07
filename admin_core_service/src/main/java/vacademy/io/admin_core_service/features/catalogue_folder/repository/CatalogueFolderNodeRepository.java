package vacademy.io.admin_core_service.features.catalogue_folder.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.catalogue_folder.entity.CatalogueFolderNode;

import java.util.List;
import java.util.Optional;

@Repository
public interface CatalogueFolderNodeRepository extends JpaRepository<CatalogueFolderNode, String> {

    /** The whole tree of one library, flat; the service nests it. */
    List<CatalogueFolderNode> findByLibraryIdAndInstituteIdOrderByDisplayOrderAsc(String libraryId, String instituteId);

    /** The node's library id, without loading (and so caching) the node itself. */
    @Query("SELECT n.libraryId FROM CatalogueFolderNode n WHERE n.id = :id AND n.instituteId = :instituteId")
    Optional<String> findLibraryIdOf(@Param("id") String id, @Param("instituteId") String instituteId);

    long countByLibraryId(String libraryId);

    /** Node counts per library for the library list: rows of [libraryId, count]. */
    @Query("SELECT n.libraryId, COUNT(n) FROM CatalogueFolderNode n WHERE n.instituteId = :instituteId GROUP BY n.libraryId")
    List<Object[]> countNodesByLibrary(@Param("instituteId") String instituteId);
}
