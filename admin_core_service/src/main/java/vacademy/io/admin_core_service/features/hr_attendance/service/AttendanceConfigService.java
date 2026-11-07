package vacademy.io.admin_core_service.features.hr_attendance.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.hr_attendance.dto.AttendanceConfigDTO;
import vacademy.io.admin_core_service.features.hr_attendance.entity.AttendanceConfig;
import vacademy.io.admin_core_service.features.hr_attendance.enums.AttendanceMode;
import vacademy.io.admin_core_service.features.hr_attendance.repository.AttendanceConfigRepository;
import vacademy.io.admin_core_service.features.hr_attendance.util.HrTimeUtil;
import vacademy.io.common.exceptions.VacademyException;

import java.time.ZoneId;
import java.util.Optional;

@Service
public class AttendanceConfigService {

    @Autowired
    private AttendanceConfigRepository attendanceConfigRepository;

    /**
     * Upserts the config for the VALIDATED institute. The instituteId inside the
     * DTO is deliberately ignored — trusting it allowed overwriting another
     * institute's config (cross-tenant write).
     */
    @Transactional
    public AttendanceConfigDTO saveConfig(AttendanceConfigDTO dto, String instituteId) {
        AttendanceConfig config;

        Optional<AttendanceConfig> existing = attendanceConfigRepository.findByInstituteId(instituteId);
        if (existing.isPresent()) {
            config = existing.get();
        } else {
            config = new AttendanceConfig();
            config.setInstituteId(instituteId);
        }

        config.setMode(dto.getMode());
        // Timezone: validate when supplied; keep the existing value (or the
        // Asia/Kolkata default for new configs) when absent.
        if (dto.getTimezone() != null && !dto.getTimezone().isBlank()) {
            String tz = dto.getTimezone().trim();
            try {
                ZoneId.of(tz);
            } catch (Exception e) {
                throw new VacademyException("Invalid timezone: " + tz);
            }
            config.setTimezone(tz);
        } else if (config.getTimezone() == null) {
            config.setTimezone(HrTimeUtil.DEFAULT_TIMEZONE);
        }
        config.setAutoCheckoutEnabled(dto.getAutoCheckoutEnabled());
        config.setAutoCheckoutTime(dto.getAutoCheckoutTime());
        config.setGeoFenceEnabled(dto.getGeoFenceEnabled());
        config.setGeoFenceLat(dto.getGeoFenceLat());
        config.setGeoFenceLng(dto.getGeoFenceLng());
        config.setGeoFenceRadiusM(dto.getGeoFenceRadiusM());
        config.setIpRestrictionEnabled(dto.getIpRestrictionEnabled());
        config.setAllowedIps(dto.getAllowedIps());
        config.setOvertimeEnabled(dto.getOvertimeEnabled());
        config.setOvertimeThresholdMin(dto.getOvertimeThresholdMin());
        config.setHalfDayThresholdMin(dto.getHalfDayThresholdMin());
        config.setWeekendDays(dto.getWeekendDays());
        config.setSettings(dto.getSettings());

        AttendanceConfig saved = attendanceConfigRepository.save(config);
        return toDTO(saved);
    }

    /**
     * Never having configured attendance is a starting state, not an error, so
     * an institute with no row gets the defaults the settings screen should open
     * on. The absent {@code id} is what tells a caller it is unsaved.
     */
    @Transactional(readOnly = true)
    public AttendanceConfigDTO getConfig(String instituteId) {
        return attendanceConfigRepository.findByInstituteId(instituteId)
                .map(this::toDTO)
                .orElseGet(() -> defaultConfig(instituteId));
    }

    private AttendanceConfigDTO defaultConfig(String instituteId) {
        AttendanceConfigDTO dto = new AttendanceConfigDTO();
        dto.setInstituteId(instituteId);
        dto.setMode(AttendanceMode.TIME_TRACKING.name());
        dto.setTimezone(HrTimeUtil.DEFAULT_TIMEZONE);
        dto.setAutoCheckoutEnabled(false);
        dto.setGeoFenceEnabled(false);
        dto.setIpRestrictionEnabled(false);
        dto.setOvertimeEnabled(false);
        return dto;
    }

    private AttendanceConfigDTO toDTO(AttendanceConfig config) {
        AttendanceConfigDTO dto = new AttendanceConfigDTO();
        dto.setId(config.getId());
        dto.setInstituteId(config.getInstituteId());
        dto.setMode(config.getMode());
        dto.setTimezone(config.getTimezone());
        dto.setAutoCheckoutEnabled(config.getAutoCheckoutEnabled());
        dto.setAutoCheckoutTime(config.getAutoCheckoutTime());
        dto.setGeoFenceEnabled(config.getGeoFenceEnabled());
        dto.setGeoFenceLat(config.getGeoFenceLat());
        dto.setGeoFenceLng(config.getGeoFenceLng());
        dto.setGeoFenceRadiusM(config.getGeoFenceRadiusM());
        dto.setIpRestrictionEnabled(config.getIpRestrictionEnabled());
        dto.setAllowedIps(config.getAllowedIps());
        dto.setOvertimeEnabled(config.getOvertimeEnabled());
        dto.setOvertimeThresholdMin(config.getOvertimeThresholdMin());
        dto.setHalfDayThresholdMin(config.getHalfDayThresholdMin());
        dto.setWeekendDays(config.getWeekendDays());
        dto.setSettings(config.getSettings());
        return dto;
    }
}
