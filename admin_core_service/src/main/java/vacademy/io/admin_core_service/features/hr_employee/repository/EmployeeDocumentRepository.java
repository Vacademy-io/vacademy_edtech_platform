package vacademy.io.admin_core_service.features.hr_employee.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.hr_employee.entity.EmployeeDocument;

import java.util.List;

@Repository
public interface EmployeeDocumentRepository extends JpaRepository<EmployeeDocument, String> {

    List<EmployeeDocument> findByEmployeeIdOrderByCreatedAtDesc(String employeeId);

    List<EmployeeDocument> findByEmployeeIdAndDocumentType(String employeeId, String documentType);

    /**
     * Document-expiry reminder sweep (DocumentExpiryJob): candidates in a broad
     * window, exact 30/7-day matching done per institute TZ by the job. The
     * employee is fetch-joined because the job runs outside any session and
     * must read employee/institute fields.
     */
    @org.springframework.data.jpa.repository.Query(
            "SELECT d FROM EmployeeDocument d JOIN FETCH d.employee WHERE d.expiryDate BETWEEN :start AND :end")
    List<EmployeeDocument> findExpiringBetweenWithEmployee(
            @org.springframework.data.repository.query.Param("start") java.time.LocalDate start,
            @org.springframework.data.repository.query.Param("end") java.time.LocalDate end);
}
