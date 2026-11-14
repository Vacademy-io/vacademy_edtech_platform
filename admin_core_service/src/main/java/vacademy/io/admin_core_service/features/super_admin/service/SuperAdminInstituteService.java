package vacademy.io.admin_core_service.features.super_admin.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.credits.client.CreditClient;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.super_admin.dto.InstituteDetailSummaryDTO;
import vacademy.io.admin_core_service.features.super_admin.dto.InstituteListItemDTO;
import vacademy.io.admin_core_service.features.super_admin.dto.PlatformDashboardDTO;
import vacademy.io.admin_core_service.features.super_admin.dto.SuperAdminPageResponse;
import vacademy.io.common.institute.entity.Institute;

import vacademy.io.common.exceptions.VacademyException;

import java.sql.Timestamp;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

@Slf4j
@Service
public class SuperAdminInstituteService {

    @Autowired
    private InstituteRepository instituteRepository;

    @Autowired
    private CreditClient creditClient;

    private static final Set<String> VALID_LEAD_TAGS = Set.of("PROD", "LEAD", "TEST", "FREE_TRIAL");

    @Transactional(readOnly = true)
    public SuperAdminPageResponse<InstituteListItemDTO> listAllInstitutes(
            String search, String leadTag, String sortBy, String sortDirection, int page, int size) {
        try {
            int offset = page * size;
            String safeSortBy = sortBy != null ? sortBy : "created_at";
            String safeSortDir = "ASC".equalsIgnoreCase(sortDirection) ? "ASC" : "DESC";

            List<Object[]> rows = instituteRepository.findAllInstitutesFiltered(
                    search, leadTag, safeSortBy, safeSortDir, size, offset);
            Long total = instituteRepository.countAllInstitutesFiltered(search, leadTag);

            List<InstituteListItemDTO> content = rows.stream()
                    .map(this::mapToInstituteListItemWithTag)
                    .toList();

            return SuperAdminPageResponse.<InstituteListItemDTO>builder()
                    .content(content)
                    .page(page)
                    .size(size)
                    .totalElements(total)
                    .totalPages((int) Math.ceil((double) total / size))
                    .build();
        } catch (Exception e) {
            log.error("Error listing institutes: {}", e.getMessage(), e);
            return SuperAdminPageResponse.<InstituteListItemDTO>builder()
                    .content(List.of())
                    .page(page)
                    .size(size)
                    .totalElements(0)
                    .totalPages(0)
                    .build();
        }
    }

    @Transactional(readOnly = true)
    @Cacheable(value = "superAdminInstituteDetail", key = "#instituteId")
    public InstituteDetailSummaryDTO getInstituteDetail(String instituteId) {
        try {
            Optional<Institute> optInstitute = instituteRepository.findById(instituteId);
            if (optInstitute.isEmpty()) {
                return null;
            }
            Institute inst = optInstitute.get();

            Integer emptyFields = instituteRepository.findCountForNullOrEmptyFields(instituteId);
            int profileCompletion = ((11 - (emptyFields != null ? emptyFields : 11)) * 100) / 11;

            Map<String, Object> creditBalance = null;
            try {
                creditBalance = creditClient.getBalance(instituteId);
            } catch (Exception e) {
                log.warn("Failed to fetch credit balance for institute {}: {}", instituteId, e.getMessage());
            }

            // Counts for this institute only: the search narrows the LATERAL counts to the
            // institutes matching its name. (An unfiltered call here used to count every
            // institute and discard the result.)
            List<Object[]> instRows = instituteRepository.findAllInstitutesWithCounts(inst.getInstituteName(), 1, 0);
            long studentCount = 0, courseCount = 0, batchCount = 0;
            // Use dedicated single-institute counts from the main list query
            for (Object[] row : instRows) {
                if (row[0] != null && row[0].toString().equals(instituteId)) {
                    studentCount = toLong(row[9]);
                    courseCount = toLong(row[10]);
                    batchCount = toLong(row[11]);
                    break;
                }
            }

            return InstituteDetailSummaryDTO.builder()
                    .id(inst.getId())
                    .name(inst.getInstituteName())
                    .email(inst.getEmail())
                    .mobileNumber(inst.getMobileNumber())
                    .city(inst.getCity())
                    .state(inst.getState())
                    .country(inst.getCountry())
                    .address(inst.getAddress())
                    .pinCode(inst.getPinCode())
                    .type(inst.getInstituteType())
                    .websiteUrl(inst.getWebsiteUrl())
                    .logoFileId(inst.getLogoFileId())
                    .subdomain(inst.getSubdomain())
                    .createdAt(inst.getCreatedAt())
                    .updatedAt(inst.getUpdatedAt())
                    .studentCount(studentCount)
                    .courseCount(courseCount)
                    .batchCount(batchCount)
                    .profileCompletionPercentage(profileCompletion)
                    .creditBalance(creditBalance)
                    .leadTag(inst.getLeadTag())
                    .build();
        } catch (Exception e) {
            log.error("Error getting institute detail for {}: {}", instituteId, e.getMessage(), e);
            return null;
        }
    }

    @Transactional(readOnly = true)
    @Cacheable(value = "superAdminPlatformDashboard")
    public PlatformDashboardDTO getPlatformDashboard() {
        try {
            return PlatformDashboardDTO.builder()
                    .totalInstitutes(safeCount(() -> instituteRepository.countTotalInstitutes()))
                    .totalStudents(safeCount(() -> instituteRepository.countTotalStudents()))
                    .totalCourses(safeCount(() -> instituteRepository.countTotalCourses()))
                    .totalBatches(safeCount(() -> instituteRepository.countTotalBatches()))
                    .institutesCreatedThisMonth(safeCount(() -> instituteRepository.countInstitutesCreatedThisMonth()))
                    .studentsEnrolledThisMonth(safeCount(() -> instituteRepository.countStudentsEnrolledThisMonth()))
                    .build();
        } catch (Exception e) {
            log.error("Error getting platform dashboard: {}", e.getMessage(), e);
            return PlatformDashboardDTO.builder()
                    .totalInstitutes(0L)
                    .totalStudents(0L)
                    .totalCourses(0L)
                    .totalBatches(0L)
                    .institutesCreatedThisMonth(0L)
                    .studentsEnrolledThisMonth(0L)
                    .build();
        }
    }

    private Long safeCount(java.util.function.Supplier<Long> supplier) {
        try {
            Long result = supplier.get();
            return result != null ? result : 0L;
        } catch (Exception e) {
            log.warn("Count query failed: {}", e.getMessage());
            return 0L;
        }
    }

    @Transactional
    public void updateLeadTag(String instituteId, String leadTag) {
        if (!VALID_LEAD_TAGS.contains(leadTag)) {
            throw new VacademyException("Invalid lead tag: " + leadTag + ". Must be one of: " + VALID_LEAD_TAGS);
        }
        int updated = instituteRepository.updateLeadTag(instituteId, leadTag);
        if (updated == 0) {
            throw new VacademyException("Institute not found: " + instituteId);
        }
    }

    private InstituteListItemDTO mapToInstituteListItem(Object[] row) {
        return InstituteListItemDTO.builder()
                .id(toString(row[0]))
                .name(toString(row[1]))
                .email(toString(row[2]))
                .city(toString(row[3]))
                .state(toString(row[4]))
                .type(toString(row[5]))
                .logoFileId(toString(row[6]))
                .subdomain(toString(row[7]))
                .createdAt(toDate(row[8]))
                .studentCount(toLong(row[9]))
                .courseCount(toLong(row[10]))
                .batchCount(toLong(row[11]))
                .build();
    }

    private InstituteListItemDTO mapToInstituteListItemWithTag(Object[] row) {
        return InstituteListItemDTO.builder()
                .id(toString(row[0]))
                .name(toString(row[1]))
                .email(toString(row[2]))
                .city(toString(row[3]))
                .state(toString(row[4]))
                .type(toString(row[5]))
                .logoFileId(toString(row[6]))
                .subdomain(toString(row[7]))
                .createdAt(toDate(row[8]))
                .studentCount(toLong(row[9]))
                .courseCount(toLong(row[10]))
                .batchCount(toLong(row[11]))
                .leadTag(toString(row[12]))
                .build();
    }

    private String toString(Object obj) {
        return obj != null ? obj.toString() : null;
    }

    private Date toDate(Object obj) {
        if (obj instanceof Timestamp ts) return new Date(ts.getTime());
        if (obj instanceof Date d) return d;
        return null;
    }

    private Long toLong(Object obj) {
        if (obj instanceof Number n) return n.longValue();
        return 0L;
    }
}
