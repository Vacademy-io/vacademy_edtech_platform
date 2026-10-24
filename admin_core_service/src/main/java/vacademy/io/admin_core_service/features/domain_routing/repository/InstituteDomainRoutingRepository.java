package vacademy.io.admin_core_service.features.domain_routing.repository;

import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.CrudRepository;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.domain_routing.entity.InstituteDomainRouting;

import java.util.List;
import java.util.Optional;

@Repository
public interface InstituteDomainRoutingRepository extends CrudRepository<InstituteDomainRouting, String> {

  List<InstituteDomainRouting> findByInstituteId(String instituteId);

  /**
   * Every institute that has at least one white-label host configured — i.e. the
   * only institutes whose {@code <role>_portal_base_url} columns a reconcile pass
   * could ever change. Ordered so a sweep that is cut short by its lock timeout
   * resumes over the same sequence rather than a random one.
   */
  @Query(value = """
      SELECT DISTINCT institute_id
      FROM institute_domain_routing
      WHERE institute_id IS NOT NULL
      ORDER BY institute_id
      """, nativeQuery = true)
  List<String> findDistinctInstituteIds();

  @Query(value = """
      SELECT *
      FROM institute_domain_routing
      WHERE LOWER(domain) = LOWER(:domain)
        AND (LOWER(subdomain) = LOWER(:subdomain) OR subdomain = '*')
      ORDER BY CASE WHEN subdomain = '*' THEN 1 ELSE 0 END DESC
      LIMIT 1
      """, nativeQuery = true)
  Optional<InstituteDomainRouting> resolveMapping(@Param("domain") String domain,
      @Param("subdomain") String subdomain);

  @Query(value = """
      SELECT *
      FROM institute_domain_routing
      WHERE institute_id = :instituteId
        AND role = :role
      LIMIT 1
      """, nativeQuery = true)
  Optional<InstituteDomainRouting> findByInstituteIdAndRole(@Param("instituteId") String instituteId,
      @Param("role") String role);

  @Query(value = """
      SELECT *
      FROM institute_domain_routing
      WHERE institute_id = :instituteId
        AND LOWER(domain) = LOWER(:domain)
        AND LOWER(subdomain) = LOWER(:subdomain)
        AND role = :role
      LIMIT 1
      """, nativeQuery = true)
  Optional<InstituteDomainRouting> findByInstituteIdAndDomainAndSubdomainAndRole(
      @Param("instituteId") String instituteId,
      @Param("domain") String domain,
      @Param("subdomain") String subdomain,
      @Param("role") String role);
}
