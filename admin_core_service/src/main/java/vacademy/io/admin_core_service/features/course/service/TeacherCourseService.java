package vacademy.io.admin_core_service.features.course.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.course.dto.AddCourseDTO;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.level.service.TeacherLevelService;
import vacademy.io.admin_core_service.features.packages.enums.PackageStatusEnum;
import vacademy.io.admin_core_service.features.packages.repository.PackageInstituteRepository;
import vacademy.io.admin_core_service.features.packages.repository.PackageRepository;
import vacademy.io.admin_core_service.features.packages.service.PackagePageContentService;
import vacademy.io.admin_core_service.features.session.dto.AddNewSessionDTO;
import vacademy.io.admin_core_service.features.session.service.TeacherSessionService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.Level;
import vacademy.io.common.institute.entity.PackageEntity;
import vacademy.io.common.institute.entity.PackageInstitute;
import vacademy.io.common.institute.entity.session.Session;

import java.util.stream.Collectors;
import org.springframework.util.StringUtils;
import java.util.Objects;

@Service
public class TeacherCourseService {

    @Autowired
    private PackageRepository packageRepository;

    @Autowired
    private PackageInstituteRepository packageInstituteRepository;

    @Autowired
    private InstituteRepository instituteRepository;

    @Autowired
    private TeacherLevelService teacherLevelService;

    @Autowired
    private TeacherSessionService teacherSessionService;

    @Autowired
    private PackagePageContentService packagePageContentService;

    public String addCourse(AddCourseDTO addCourseDTO, CustomUserDetails userDetails, String instituteId) {
        // Ensure status is set to DRAFT for teacher courses (approval workflow)
        if (!StringUtils.hasText(addCourseDTO.getStatus())) {
            addCourseDTO.setStatus(PackageStatusEnum.DRAFT.name());
        }
        
        // Set created_by_user_id from user context if not already set
        if (!StringUtils.hasText(addCourseDTO.getCreatedByUserId()) && userDetails != null) {
            addCourseDTO.setCreatedByUserId(userDetails.getId());
        }
        
        PackageEntity savedPackage = null;

        // Reject a malformed course_page_json (HTTP 400) before anything is written.
        PackagePageContentService.validate(addCourseDTO.getCoursePageJson());

        if (addCourseDTO.getNewCourse()) {
            PackageEntity packageEntity = getCourse(addCourseDTO, userDetails.getId()); // Pass user ID
            savedPackage = packageRepository.save(packageEntity);
            packagePageContentService.applyOnCreate(savedPackage.getId(), addCourseDTO.getCoursePageJson());
        } else {
            savedPackage = packageRepository.findById(addCourseDTO.getId())
                    .orElseThrow(() -> new VacademyException("Package not found"));
            
            // Verify teacher can edit this course
            if (!canTeacherEdit(savedPackage, userDetails.getId())) {
                throw new VacademyException("You don't have permission to edit this course");
            }
        }

        createPackageInstitute(savedPackage, instituteId);

        for(AddNewSessionDTO addNewSessionDTO : addCourseDTO.getSessions()) {
            teacherSessionService.addSession(savedPackage, addNewSessionDTO);
        }

        return savedPackage.getId();
    }

    private PackageInstitute createPackageInstitute(PackageEntity packageEntity, String instituteId) {
        PackageInstitute packageInstitute = new PackageInstitute();
        packageInstitute.setPackageEntity(packageEntity);
        packageInstitute.setInstituteEntity(instituteRepository.findById(instituteId)
                .orElseThrow(() -> new VacademyException("Institute not found with ID: " + instituteId)));
        return packageInstituteRepository.save(packageInstitute);
    }

    public PackageEntity getCourse(AddCourseDTO addCourseDTO, String teacherId) {
        PackageEntity packageEntity = new PackageEntity();
        packageEntity.setPackageName(addCourseDTO.getCourseName());
        packageEntity.setThumbnailFileId(addCourseDTO.getThumbnailFileId());
        
        // Set status from DTO or default to DRAFT for teacher approval workflow
        if (StringUtils.hasText(addCourseDTO.getStatus())) {
            packageEntity.setStatus(addCourseDTO.getStatus());
        } else {
            packageEntity.setStatus(PackageStatusEnum.DRAFT.name());
        }
        
        // Set created by user ID - prefer DTO value or use teacherId
        if (StringUtils.hasText(addCourseDTO.getCreatedByUserId())) {
            packageEntity.setCreatedByUserId(addCourseDTO.getCreatedByUserId());
        } else {
            packageEntity.setCreatedByUserId(teacherId);
        }
        
        // Set original course ID if this is a copy
        if (StringUtils.hasText(addCourseDTO.getOriginalCourseId())) {
            packageEntity.setOriginalCourseId(addCourseDTO.getOriginalCourseId());
        }
        
        // Set version number from DTO or default to 1
        if (addCourseDTO.getVersionNumber() != null) {
            packageEntity.setVersionNumber(addCourseDTO.getVersionNumber());
        } else {
            packageEntity.setVersionNumber(1);
        }
        
        packageEntity.setIsCoursePublishedToCatalaouge(addCourseDTO.getIsCoursePublishedToCatalaouge());
        packageEntity.setCoursePreviewImageMediaId(addCourseDTO.getCoursePreviewImageMediaId());
        packageEntity.setCourseBannerMediaId(addCourseDTO.getCourseBannerMediaId());
        packageEntity.setCourseMediaId(addCourseDTO.getCourseMediaId());
        packageEntity.setWhyLearn(addCourseDTO.getWhyLearnHtml());
        packageEntity.setWhoShouldLearn(addCourseDTO.getWhoShouldLearnHtml());
        packageEntity.setAboutTheCourse(addCourseDTO.getAboutTheCourseHtml());
        
        if (addCourseDTO.getTags() != null && !addCourseDTO.getTags().isEmpty()) {
            packageEntity.setTags(addCourseDTO.getTags().stream()
                    .filter(Objects::nonNull)
                    .filter(tag -> !tag.trim().isEmpty())
                    .collect(Collectors.joining(",")));
        }
        packageEntity.setCourseDepth(addCourseDTO.getCourseDepth());
        packageEntity.setCourseHtmlDescription(addCourseDTO.getCourseHtmlDescription());
        return packageEntity;
    }

    /**
     * Check if teacher can edit a course
     * - Course must be in DRAFT status
     * - Course must be created by the teacher
     */
    private boolean canTeacherEdit(PackageEntity course, String teacherId) {
        return PackageStatusEnum.DRAFT.name().equals(course.getStatus()) 
                && teacherId.equals(course.getCreatedByUserId());
    }

    /**
     * Update an existing course (only if teacher owns it and it's in DRAFT)
     */
    public String updateCourse(String courseId, AddCourseDTO addCourseDTO, CustomUserDetails user) {
        PackageEntity course = packageRepository.findById(courseId)
                .orElseThrow(() -> new VacademyException("Course not found"));

        if (!canTeacherEdit(course, user.getId())) {
            throw new VacademyException("You don't have permission to edit this course");
        }

        PackagePageContentService.validate(addCourseDTO.getCoursePageJson());
        updateCourseFields(course, addCourseDTO);
        packageRepository.save(course);
        packagePageContentService.applyOnUpdate(course.getId(), addCourseDTO.getCoursePageJson());
        
        return "Course updated successfully";
    }

    private void updateCourseFields(PackageEntity course, AddCourseDTO addCourseDTO) {
        if (addCourseDTO.getCourseName() != null) {
            course.setPackageName(addCourseDTO.getCourseName());
        }
        if (addCourseDTO.getThumbnailFileId() != null) {
            course.setThumbnailFileId(addCourseDTO.getThumbnailFileId());
        }
        if (addCourseDTO.getIsCoursePublishedToCatalaouge() != null) {
            course.setIsCoursePublishedToCatalaouge(addCourseDTO.getIsCoursePublishedToCatalaouge());
        }
        if (addCourseDTO.getCoursePreviewImageMediaId() != null) {
            course.setCoursePreviewImageMediaId(addCourseDTO.getCoursePreviewImageMediaId());
        }
        if (addCourseDTO.getCourseBannerMediaId() != null) {
            course.setCourseBannerMediaId(addCourseDTO.getCourseBannerMediaId());
        }
        if (addCourseDTO.getCourseMediaId() != null) {
            course.setCourseMediaId(addCourseDTO.getCourseMediaId());
        }
        if (addCourseDTO.getWhyLearnHtml() != null) {
            course.setWhyLearn(addCourseDTO.getWhyLearnHtml());
        }
        if (addCourseDTO.getWhoShouldLearnHtml() != null) {
            course.setWhoShouldLearn(addCourseDTO.getWhoShouldLearnHtml());
        }
        if (addCourseDTO.getAboutTheCourseHtml() != null) {
            course.setAboutTheCourse(addCourseDTO.getAboutTheCourseHtml());
        }
        if (addCourseDTO.getTags() != null && !addCourseDTO.getTags().isEmpty()) {
            course.setTags(addCourseDTO.getTags().stream()
                    .map(String::toLowerCase)
                    .map(String::trim)
                    .collect(Collectors.joining(",")));
        }
        if (addCourseDTO.getCourseDepth() != null) {
            course.setCourseDepth(addCourseDTO.getCourseDepth());
        }
        if (addCourseDTO.getCourseHtmlDescription() != null) {
            course.setCourseHtmlDescription(addCourseDTO.getCourseHtmlDescription());
        }
    }
}
