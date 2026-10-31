package vacademy.io.admin_core_service.features.faculty.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.BeanUtils;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.faculty.dto.FacultyRoleLabelRow;
import vacademy.io.admin_core_service.features.faculty.repository.FacultySubjectPackageSessionMappingRepository;
import vacademy.io.common.auth.dto.UserDTO;

import java.util.*;

/**
 * Per-course display role of authors (Author / Instructor / Facilitator / an institute's own
 * word such as Acharya), stored as role_label on the faculty mapping rows. Read paths that
 * list a course's instructors call {@link #labelsByPackage} once for the page and
 * {@link #withRoleLabels} per course, so the label reaches the admin, the learner app, the
 * public website and the catalogue API through the same instructor objects.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class CourseRoleLabelService {

    static final int MAX_LENGTH = 100;

    private final FacultySubjectPackageSessionMappingRepository facultyRepository;

    /** Trimmed label, or null when blank. Longer input is cut to the column size. */
    public static String normalize(String label) {
        if (!StringUtils.hasText(label)) {
            return null;
        }
        String trimmed = label.trim();
        return trimmed.length() > MAX_LENGTH ? trimmed.substring(0, MAX_LENGTH) : trimmed;
    }

    /**
     * packageId -> (userId -> label) for the given courses. An error is logged and the labels
     * are dropped (pages fall back to the naming term). Inside a caller's transaction a SQL
     * error still aborts that transaction on Postgres, so this is not a guard for a missing
     * column: V607 must run first, which Flyway does at startup.
     */
    public Map<String, Map<String, String>> labelsByPackage(Collection<String> packageIds) {
        Map<String, Map<String, String>> out = new HashMap<>();
        if (packageIds == null) {
            return out;
        }
        Set<String> ids = new HashSet<>();
        for (String id : packageIds) {
            if (StringUtils.hasText(id)) {
                ids.add(id);
            }
        }
        if (ids.isEmpty()) {
            return out;
        }
        try {
            for (FacultyRoleLabelRow row : facultyRepository.findRoleLabelsByPackageIds(ids)) {
                if (row.getPackageId() != null && row.getUserId() != null && row.getRoleLabel() != null) {
                    out.computeIfAbsent(row.getPackageId(), k -> new HashMap<>())
                            .put(row.getUserId(), row.getRoleLabel());
                }
            }
        } catch (Exception e) {
            log.warn("Failed to load course role labels for {} courses: {}", ids.size(), e.getMessage());
        }
        return out;
    }

    /**
     * The instructors with role_label set where this course has one. Labelled users are
     * copies: one UserDTO is shared by every course on the page, and the same person can
     * be Acharya in one course and Instructor in the next.
     */
    public List<UserDTO> withRoleLabels(List<UserDTO> instructors, Map<String, String> labelsByUser) {
        if (instructors == null || instructors.isEmpty() || labelsByUser == null || labelsByUser.isEmpty()) {
            return instructors;
        }
        List<UserDTO> out = new ArrayList<>(instructors.size());
        for (UserDTO user : instructors) {
            String label = user == null || user.getId() == null ? null : labelsByUser.get(user.getId());
            if (label == null) {
                out.add(user);
                continue;
            }
            UserDTO copy = new UserDTO();
            BeanUtils.copyProperties(user, copy);
            copy.setRoleLabel(label);
            out.add(copy);
        }
        return out;
    }
}
