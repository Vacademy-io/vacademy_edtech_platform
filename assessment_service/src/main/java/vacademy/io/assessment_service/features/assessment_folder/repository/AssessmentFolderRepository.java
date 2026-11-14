package vacademy.io.assessment_service.features.assessment_folder.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import vacademy.io.assessment_service.features.assessment_folder.entity.AssessmentFolder;

import java.util.List;
import java.util.Optional;

public interface AssessmentFolderRepository extends JpaRepository<AssessmentFolder, String> {

    Optional<AssessmentFolder> findByIdAndInstituteId(String id, String instituteId);

    List<AssessmentFolder> findByInstituteIdAndIdIn(String instituteId, List<String> ids);

    @Query(value = "SELECT COALESCE(MAX(f.display_order), -1) FROM assessment_folder f WHERE f.institute_id = :instituteId",
            nativeQuery = true)
    Integer findMaxDisplayOrder(@Param("instituteId") String instituteId);

    /** id, name, description, image_url, display_order, status, parent_id, assessment_count */
    @Query(value = """
            SELECT f.id, f.name, f.description, f.image_url, f.display_order, f.status, f.parent_id,
                   (SELECT COUNT(*) FROM assessment_folder_mapping m
                      JOIN assessment a ON a.id = m.assessment_id
                     WHERE m.folder_id = f.id AND a.status <> 'DELETED') AS assessment_count
              FROM assessment_folder f
             WHERE f.institute_id = :instituteId
             ORDER BY f.display_order ASC, f.created_at ASC
            """, nativeQuery = true)
    List<Object[]> findAdminFolders(@Param("instituteId") String instituteId);

    /** Same columns as findAdminFolders, counting only assessments the learner can open. */
    @Query(value = """
            SELECT f.id, f.name, f.description, f.image_url, f.display_order, f.status, f.parent_id,
                   COUNT(DISTINCT a.id) AS assessment_count
              FROM assessment_folder f
              JOIN assessment_folder_mapping m ON m.folder_id = f.id
              JOIN assessment a ON a.id = m.assessment_id
             WHERE f.institute_id = :instituteId
               AND f.status = 'ACTIVE'
               AND a.status = 'PUBLISHED'
               AND (:checkTypes IS NULL OR a.assessment_type IN :assessmentTypes)
               AND (EXISTS (SELECT 1 FROM assessment_batch_registration abr
                             WHERE abr.assessment_id = a.id AND abr.batch_id IN :batchIds)
                    OR EXISTS (SELECT 1 FROM assessment_user_registration aur
                                WHERE aur.assessment_id = a.id AND aur.user_id IN :userIds))
             GROUP BY f.id, f.name, f.description, f.image_url, f.display_order, f.status, f.parent_id, f.created_at
             ORDER BY f.display_order ASC, f.created_at ASC
            """, nativeQuery = true)
    List<Object[]> findLearnerFolders(@Param("instituteId") String instituteId,
                                      @Param("batchIds") List<String> batchIds,
                                      @Param("userIds") List<String> userIds,
                                      @Param("checkTypes") Boolean checkTypes,
                                      @Param("assessmentTypes") List<String> assessmentTypes);

    @Query(value = """
            SELECT COUNT(DISTINCT a.id)
              FROM assessment a
              JOIN assessment_institute_mapping aim ON aim.assessment_id = a.id
             WHERE aim.institute_id = :instituteId
               AND a.status = 'PUBLISHED'
               AND (:checkTypes IS NULL OR a.assessment_type IN :assessmentTypes)
               AND (EXISTS (SELECT 1 FROM assessment_batch_registration abr
                             WHERE abr.assessment_id = a.id AND abr.batch_id IN :batchIds)
                    OR EXISTS (SELECT 1 FROM assessment_user_registration aur
                                WHERE aur.assessment_id = a.id AND aur.user_id IN :userIds))
               AND NOT EXISTS (SELECT 1 FROM assessment_folder_mapping m
                                 JOIN assessment_folder f ON f.id = m.folder_id
                                WHERE m.assessment_id = a.id AND f.status = 'ACTIVE')
            """, nativeQuery = true)
    Long countLearnerUnfiled(@Param("instituteId") String instituteId,
                             @Param("batchIds") List<String> batchIds,
                             @Param("userIds") List<String> userIds,
                             @Param("checkTypes") Boolean checkTypes,
                                      @Param("assessmentTypes") List<String> assessmentTypes);
}
