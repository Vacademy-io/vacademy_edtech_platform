package vacademy.io.admin_core_service.features.hr_attendance.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.core.security.HrAccessGuard;
import vacademy.io.admin_core_service.features.hr_attendance.dto.HolidayDTO;
import vacademy.io.admin_core_service.features.hr_attendance.entity.Holiday;
import vacademy.io.admin_core_service.features.hr_attendance.repository.HolidayRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.time.LocalDate;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

@Service
public class HolidayService {

    @Autowired
    private HolidayRepository holidayRepository;

    @Autowired
    private HrAccessGuard hrAccessGuard;

    @Transactional
    public String createHoliday(HolidayDTO dto, String instituteId) {
        if (dto.getDate() == null) {
            throw new VacademyException("Holiday date is required");
        }
        Holiday saved = holidayRepository.save(buildHoliday(dto, instituteId));
        return saved.getId();
    }

    @Transactional
    public String updateHoliday(String id, HolidayDTO dto, String instituteId) {
        Holiday holiday = holidayRepository.findById(id)
                .orElseThrow(() -> new VacademyException("Holiday not found with id: " + id));
        hrAccessGuard.requireInstituteMatch(holiday.getInstituteId(), instituteId, "Holiday");

        if (dto.getName() != null) holiday.setName(dto.getName());
        if (dto.getDate() != null) {
            holiday.setDate(dto.getDate());
            holiday.setYear(dto.getDate().getYear());
        }
        if (dto.getType() != null) holiday.setType(dto.getType());
        if (dto.getIsOptional() != null) holiday.setIsOptional(dto.getIsOptional());
        if (dto.getMaxOptionalAllowed() != null) holiday.setMaxOptionalAllowed(dto.getMaxOptionalAllowed());
        if (dto.getYear() != null) holiday.setYear(dto.getYear());
        if (dto.getDescription() != null) holiday.setDescription(dto.getDescription());

        holidayRepository.save(holiday);
        return "Holiday updated successfully";
    }

    @Transactional
    public void deleteHoliday(String id, String instituteId) {
        Holiday holiday = holidayRepository.findById(id)
                .orElseThrow(() -> new VacademyException("Holiday not found with id: " + id));
        hrAccessGuard.requireInstituteMatch(holiday.getInstituteId(), instituteId, "Holiday");
        holidayRepository.delete(holiday);
    }

    @Transactional(readOnly = true)
    public List<HolidayDTO> getHolidays(String instituteId, Integer year) {
        List<Holiday> holidays = holidayRepository.findByInstituteIdAndYearOrderByDateAsc(instituteId, year);
        return holidays.stream().map(this::toDTO).collect(Collectors.toList());
    }

    /**
     * Bulk create for the VALIDATED institute. Duplicate dates — within the batch
     * or already existing for the institute — are skipped and reported instead of
     * aborting mid-batch with a raw unique-constraint 500.
     */
    @Transactional
    public String bulkCreateHolidays(List<HolidayDTO> holidays, String instituteId) {
        if (holidays == null || holidays.isEmpty()) {
            throw new VacademyException("No holidays provided");
        }

        List<LocalDate> dates = holidays.stream()
                .map(HolidayDTO::getDate)
                .filter(d -> d != null)
                .distinct()
                .collect(Collectors.toList());

        Set<LocalDate> existingDates = holidayRepository.findByInstituteIdAndDateIn(instituteId, dates).stream()
                .map(Holiday::getDate)
                .collect(Collectors.toSet());

        Set<LocalDate> seenDates = new HashSet<>();
        int successCount = 0;
        int skippedCount = 0;

        for (HolidayDTO dto : holidays) {
            if (dto.getDate() == null) {
                throw new VacademyException("Holiday date is required for every entry");
            }
            if (existingDates.contains(dto.getDate()) || !seenDates.add(dto.getDate())) {
                skippedCount++;
                continue;
            }
            holidayRepository.save(buildHoliday(dto, instituteId));
            successCount++;
        }

        String result = successCount + " holiday(s) created successfully";
        if (skippedCount > 0) {
            result += ", " + skippedCount + " duplicate(s) skipped";
        }
        return result;
    }

    private Holiday buildHoliday(HolidayDTO dto, String instituteId) {
        Holiday holiday = new Holiday();
        holiday.setInstituteId(instituteId);
        holiday.setName(dto.getName());
        holiday.setDate(dto.getDate());
        holiday.setType(dto.getType());
        holiday.setIsOptional(dto.getIsOptional());
        holiday.setMaxOptionalAllowed(dto.getMaxOptionalAllowed());
        holiday.setYear(dto.getYear() != null ? dto.getYear() : dto.getDate().getYear());
        holiday.setDescription(dto.getDescription());
        return holiday;
    }

    private HolidayDTO toDTO(Holiday holiday) {
        HolidayDTO dto = new HolidayDTO();
        dto.setId(holiday.getId());
        dto.setInstituteId(holiday.getInstituteId());
        dto.setName(holiday.getName());
        dto.setDate(holiday.getDate());
        dto.setType(holiday.getType());
        dto.setIsOptional(holiday.getIsOptional());
        dto.setMaxOptionalAllowed(holiday.getMaxOptionalAllowed());
        dto.setYear(holiday.getYear());
        dto.setDescription(holiday.getDescription());
        return dto;
    }
}
