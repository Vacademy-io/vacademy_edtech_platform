package vacademy.io.admin_core_service.features.hr_attendance.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.core.security.HrAccessGuard;
import vacademy.io.admin_core_service.features.hr_attendance.dto.ShiftAssignDTO;
import vacademy.io.admin_core_service.features.hr_attendance.dto.ShiftDTO;
import vacademy.io.admin_core_service.features.hr_attendance.entity.EmployeeShiftMapping;
import vacademy.io.admin_core_service.features.hr_attendance.entity.Shift;
import vacademy.io.admin_core_service.features.hr_attendance.repository.EmployeeShiftMappingRepository;
import vacademy.io.admin_core_service.features.hr_attendance.repository.ShiftRepository;
import vacademy.io.admin_core_service.features.hr_employee.entity.EmployeeProfile;
import vacademy.io.admin_core_service.features.hr_employee.repository.EmployeeProfileRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@Service
public class ShiftService {

    @Autowired
    private ShiftRepository shiftRepository;

    @Autowired
    private EmployeeShiftMappingRepository employeeShiftMappingRepository;

    @Autowired
    private EmployeeProfileRepository employeeProfileRepository;

    @Autowired
    private HrAccessGuard hrAccessGuard;

    @Transactional
    public String createShift(ShiftDTO dto, String instituteId) {
        Shift shift = new Shift();
        shift.setInstituteId(instituteId);
        shift.setName(dto.getName());
        shift.setCode(dto.getCode());
        shift.setStartTime(dto.getStartTime());
        shift.setEndTime(dto.getEndTime());
        shift.setBreakDurationMin(dto.getBreakDurationMin());
        shift.setIsNightShift(dto.getIsNightShift());
        shift.setGracePeriodMin(dto.getGracePeriodMin());
        shift.setMinHoursFullDay(dto.getMinHoursFullDay());
        shift.setMinHoursHalfDay(dto.getMinHoursHalfDay());
        shift.setIsDefault(dto.getIsDefault());
        shift.setStatus(dto.getStatus() != null ? dto.getStatus() : "ACTIVE");

        Shift saved = shiftRepository.save(shift);
        return saved.getId();
    }

    @Transactional
    public String updateShift(String id, ShiftDTO dto, String instituteId) {
        Shift shift = shiftRepository.findById(id)
                .orElseThrow(() -> new VacademyException("Shift not found with id: " + id));
        hrAccessGuard.requireInstituteMatch(shift.getInstituteId(), instituteId, "Shift");

        if (dto.getName() != null) shift.setName(dto.getName());
        if (dto.getCode() != null) shift.setCode(dto.getCode());
        if (dto.getStartTime() != null) shift.setStartTime(dto.getStartTime());
        if (dto.getEndTime() != null) shift.setEndTime(dto.getEndTime());
        if (dto.getBreakDurationMin() != null) shift.setBreakDurationMin(dto.getBreakDurationMin());
        if (dto.getIsNightShift() != null) shift.setIsNightShift(dto.getIsNightShift());
        if (dto.getGracePeriodMin() != null) shift.setGracePeriodMin(dto.getGracePeriodMin());
        if (dto.getMinHoursFullDay() != null) shift.setMinHoursFullDay(dto.getMinHoursFullDay());
        if (dto.getMinHoursHalfDay() != null) shift.setMinHoursHalfDay(dto.getMinHoursHalfDay());
        if (dto.getIsDefault() != null) shift.setIsDefault(dto.getIsDefault());
        if (dto.getStatus() != null) shift.setStatus(dto.getStatus());

        shiftRepository.save(shift);
        return "Shift updated successfully";
    }

    @Transactional(readOnly = true)
    public List<ShiftDTO> getShifts(String instituteId) {
        List<Shift> shifts = shiftRepository.findByInstituteIdOrderByNameAsc(instituteId);
        return shifts.stream().map(this::toDTO).collect(Collectors.toList());
    }

    @Transactional
    public String assignShiftToEmployees(ShiftAssignDTO assignDTO, String instituteId) {
        if (assignDTO.getEmployeeIds() == null || assignDTO.getEmployeeIds().isEmpty()) {
            throw new VacademyException("No employees provided for shift assignment");
        }
        LocalDate effectiveFrom = assignDTO.getEffectiveFrom();
        if (effectiveFrom == null) {
            throw new VacademyException("Effective from date is required for shift assignment");
        }

        Shift shift = shiftRepository.findById(assignDTO.getShiftId())
                .orElseThrow(() -> new VacademyException("Shift not found with id: " + assignDTO.getShiftId()));
        hrAccessGuard.requireInstituteMatch(shift.getInstituteId(), instituteId, "Shift");

        // Batch-fetch and institute-check every employee before writing anything
        List<String> employeeIds = assignDTO.getEmployeeIds().stream().distinct().collect(Collectors.toList());
        Map<String, EmployeeProfile> employeeMap = employeeProfileRepository.findAllById(employeeIds).stream()
                .filter(e -> instituteId.equals(e.getInstituteId()))
                .collect(Collectors.toMap(EmployeeProfile::getId, e -> e));

        for (String employeeId : employeeIds) {
            EmployeeProfile employee = employeeMap.get(employeeId);
            if (employee == null) {
                throw new VacademyException("Employee not found with id: " + employeeId);
            }

            // Close any mapping still open on/after the new effective date, so exactly
            // one mapping is active per day (findActiveMapping expects a single row;
            // overlaps made check-in fail with a NonUniqueResultException).
            List<EmployeeShiftMapping> openMappings = employeeShiftMappingRepository
                    .findMappingsOpenOnOrAfter(employeeId, effectiveFrom);
            for (EmployeeShiftMapping openMapping : openMappings) {
                openMapping.setEffectiveTo(effectiveFrom.minusDays(1));
                employeeShiftMappingRepository.save(openMapping);
            }

            EmployeeShiftMapping mapping = new EmployeeShiftMapping();
            mapping.setEmployee(employee);
            mapping.setShift(shift);
            mapping.setEffectiveFrom(effectiveFrom);
            mapping.setEffectiveTo(assignDTO.getEffectiveTo());

            employeeShiftMappingRepository.save(mapping);
        }

        return "Shift assigned to " + employeeIds.size() + " employee(s) successfully";
    }

    private ShiftDTO toDTO(Shift shift) {
        ShiftDTO dto = new ShiftDTO();
        dto.setId(shift.getId());
        dto.setInstituteId(shift.getInstituteId());
        dto.setName(shift.getName());
        dto.setCode(shift.getCode());
        dto.setStartTime(shift.getStartTime());
        dto.setEndTime(shift.getEndTime());
        dto.setBreakDurationMin(shift.getBreakDurationMin());
        dto.setIsNightShift(shift.getIsNightShift());
        dto.setGracePeriodMin(shift.getGracePeriodMin());
        dto.setMinHoursFullDay(shift.getMinHoursFullDay());
        dto.setMinHoursHalfDay(shift.getMinHoursHalfDay());
        dto.setIsDefault(shift.getIsDefault());
        dto.setStatus(shift.getStatus());
        return dto;
    }
}
