package vacademy.io.community_service.feature.appregistry.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import vacademy.io.community_service.feature.appregistry.entity.AppRegistration;

import java.util.List;

public interface AppRegistrationRepository extends JpaRepository<AppRegistration, String> {

    List<AppRegistration> findAllByOrderByNameAsc();

    List<AppRegistration> findAllByInstituteIdAndArchivedFalseOrderByNameAsc(String instituteId);
}
