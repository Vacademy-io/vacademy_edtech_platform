package vacademy.io.auth_service.feature.login_link.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import vacademy.io.auth_service.feature.login_link.entity.InstituteLoginLinkPolicy;

import java.util.Collection;

public interface InstituteLoginLinkPolicyRepository extends JpaRepository<InstituteLoginLinkPolicy, String> {

    @Query("SELECT COUNT(p) > 0 FROM InstituteLoginLinkPolicy p WHERE p.requireLoginCode = true AND p.instituteId IN :instituteIds")
    boolean anyRequiresLoginCode(@Param("instituteIds") Collection<String> instituteIds);

    java.util.List<InstituteLoginLinkPolicy> findByRequireLoginCodeTrueAndInstituteIdIn(Collection<String> instituteIds);
}
