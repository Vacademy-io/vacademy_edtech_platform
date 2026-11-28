package vacademy.io.admin_core_service.features.hr_employee.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.core.security.HrAccessGuard;
import vacademy.io.admin_core_service.features.hr_employee.dto.DepartmentDTO;
import vacademy.io.admin_core_service.features.hr_employee.entity.Department;
import vacademy.io.admin_core_service.features.hr_employee.repository.DepartmentRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;

@Service
public class DepartmentService {

    @Autowired
    private DepartmentRepository departmentRepository;

    @Autowired
    private HrAccessGuard hrAccessGuard;

    @Transactional
    public String addDepartment(DepartmentDTO dto, String instituteId) {
        if (!StringUtils.hasText(dto.getName())) {
            throw new VacademyException("Department name is required");
        }

        if (StringUtils.hasText(dto.getCode()) && departmentRepository.existsByInstituteIdAndCode(instituteId, dto.getCode())) {
            throw new VacademyException("Department code already exists for this institute");
        }

        Department department = new Department();
        department.setInstituteId(instituteId);
        department.setName(dto.getName());
        department.setCode(dto.getCode());
        department.setHeadUserId(dto.getHeadUserId());
        department.setDescription(dto.getDescription());
        department.setStatus(StringUtils.hasText(dto.getStatus()) ? dto.getStatus() : "ACTIVE");

        if (StringUtils.hasText(dto.getParentId())) {
            Department parent = departmentRepository.findById(dto.getParentId())
                    .orElseThrow(() -> new VacademyException("Parent department not found"));
            hrAccessGuard.requireInstituteMatch(parent.getInstituteId(), instituteId, "Parent department");
            department.setParent(parent);
        }

        department = departmentRepository.save(department);
        return department.getId();
    }

    @Transactional
    public String updateDepartment(String id, DepartmentDTO dto, String instituteId) {
        Department department = departmentRepository.findById(id)
                .orElseThrow(() -> new VacademyException("Department not found"));
        hrAccessGuard.requireInstituteMatch(department.getInstituteId(), instituteId, "Department");

        if (StringUtils.hasText(dto.getName())) {
            department.setName(dto.getName());
        }
        if (dto.getCode() != null) {
            department.setCode(dto.getCode());
        }
        if (dto.getHeadUserId() != null) {
            department.setHeadUserId(dto.getHeadUserId());
        }
        if (dto.getDescription() != null) {
            department.setDescription(dto.getDescription());
        }
        if (StringUtils.hasText(dto.getStatus())) {
            department.setStatus(dto.getStatus());
        }

        if (dto.getParentId() != null) {
            if (dto.getParentId().isEmpty()) {
                department.setParent(null);
            } else {
                validateNoCycle(id, dto.getParentId());
                Department parent = departmentRepository.findById(dto.getParentId())
                        .orElseThrow(() -> new VacademyException("Parent department not found"));
                hrAccessGuard.requireInstituteMatch(parent.getInstituteId(), instituteId, "Parent department");
                department.setParent(parent);
            }
        }

        departmentRepository.save(department);
        return department.getId();
    }

    @Transactional(readOnly = true)
    public List<DepartmentDTO> getDepartments(String instituteId) {
        List<Department> allDepartments = departmentRepository.findByInstituteIdOrderByNameAsc(instituteId);

        // Build a tree structure: group by parent id
        Map<String, List<Department>> childrenMap = allDepartments.stream()
                .filter(d -> d.getParent() != null)
                .collect(Collectors.groupingBy(d -> d.getParent().getId()));

        // Find root departments (no parent)
        List<Department> rootDepartments = allDepartments.stream()
                .filter(d -> d.getParent() == null)
                .collect(Collectors.toList());

        return rootDepartments.stream()
                .map(d -> buildDepartmentTree(d, childrenMap))
                .collect(Collectors.toList());
    }

    private DepartmentDTO buildDepartmentTree(Department department, Map<String, List<Department>> childrenMap) {
        DepartmentDTO dto = DepartmentDTO.builder()
                .id(department.getId())
                .name(department.getName())
                .code(department.getCode())
                .parentId(department.getParent() != null ? department.getParent().getId() : null)
                .headUserId(department.getHeadUserId())
                .description(department.getDescription())
                .status(department.getStatus())
                .build();

        List<Department> children = childrenMap.get(department.getId());
        if (children != null && !children.isEmpty()) {
            dto.setChildren(children.stream()
                    .map(child -> buildDepartmentTree(child, childrenMap))
                    .collect(Collectors.toList()));
        } else {
            dto.setChildren(new ArrayList<>());
        }

        return dto;
    }

    private void validateNoCycle(String departmentId, String newParentId) {
        Set<String> visited = new HashSet<>();
        visited.add(departmentId);
        String currentId = newParentId;
        while (currentId != null) {
            if (visited.contains(currentId)) {
                throw new VacademyException("Circular department hierarchy detected");
            }
            visited.add(currentId);
            Optional<Department> parent = departmentRepository.findById(currentId);
            currentId = parent.map(d -> d.getParent() != null ? d.getParent().getId() : null).orElse(null);
        }
    }

    @Transactional
    public void deactivateDepartment(String id, String instituteId) {
        Department department = departmentRepository.findById(id)
                .orElseThrow(() -> new VacademyException("Department not found"));
        hrAccessGuard.requireInstituteMatch(department.getInstituteId(), instituteId, "Department");

        department.setStatus("INACTIVE");
        departmentRepository.save(department);
    }
}
