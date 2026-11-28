package vacademy.io.admin_core_service.features.hr_employee.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.core.security.HrAccessGuard;
import vacademy.io.admin_core_service.features.hr_employee.dto.EmployeeDocumentDTO;
import vacademy.io.admin_core_service.features.hr_employee.entity.EmployeeDocument;
import vacademy.io.admin_core_service.features.hr_employee.entity.EmployeeProfile;
import vacademy.io.admin_core_service.features.hr_employee.enums.DocumentType;
import vacademy.io.admin_core_service.features.hr_employee.repository.EmployeeDocumentRepository;
import vacademy.io.admin_core_service.features.hr_employee.repository.EmployeeProfileRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;
import java.util.stream.Collectors;

@Service
public class EmployeeDocumentService {

    @Autowired
    private EmployeeDocumentRepository employeeDocumentRepository;

    @Autowired
    private EmployeeProfileRepository employeeProfileRepository;

    @Autowired
    private HrAccessGuard hrAccessGuard;

    @Transactional
    public String addDocument(String employeeId, EmployeeDocumentDTO dto, String instituteId) {
        EmployeeProfile employee = employeeProfileRepository.findById(employeeId)
                .orElseThrow(() -> new VacademyException("Employee not found"));
        hrAccessGuard.requireInstituteMatch(employee.getInstituteId(), instituteId, "Employee");

        if (!StringUtils.hasText(dto.getDocumentName())) {
            throw new VacademyException("Document name is required");
        }
        if (dto.getDocumentType() != null) {
            try {
                DocumentType.valueOf(dto.getDocumentType());
            } catch (IllegalArgumentException e) {
                throw new VacademyException("Invalid document type: " + dto.getDocumentType());
            }
        }

        EmployeeDocument document = new EmployeeDocument();
        document.setEmployee(employee);
        document.setDocumentType(dto.getDocumentType());
        document.setDocumentName(dto.getDocumentName());
        document.setFileId(dto.getFileId());
        document.setFileUrl(dto.getFileUrl());
        document.setExpiryDate(dto.getExpiryDate());
        document.setVerified(dto.getVerified() != null ? dto.getVerified() : false);
        document.setNotes(dto.getNotes());

        document = employeeDocumentRepository.save(document);
        return document.getId();
    }

    @Transactional(readOnly = true)
    public List<EmployeeDocumentDTO> getDocuments(String employeeId, String instituteId) {
        EmployeeProfile employee = employeeProfileRepository.findById(employeeId)
                .orElseThrow(() -> new VacademyException("Employee not found"));
        hrAccessGuard.requireInstituteMatch(employee.getInstituteId(), instituteId, "Employee");

        List<EmployeeDocument> documents = employeeDocumentRepository.findByEmployeeIdOrderByCreatedAtDesc(employeeId);

        return documents.stream()
                .map(this::toDTO)
                .collect(Collectors.toList());
    }

    @Transactional
    public void deleteDocument(String employeeId, String documentId, String instituteId) {
        EmployeeDocument document = employeeDocumentRepository.findById(documentId)
                .orElseThrow(() -> new VacademyException("Document not found"));
        hrAccessGuard.requireInstituteMatch(document.getEmployee().getInstituteId(), instituteId, "Document");
        if (!document.getEmployee().getId().equals(employeeId)) {
            throw new VacademyException("Document does not belong to this employee");
        }
        employeeDocumentRepository.delete(document);
    }

    private EmployeeDocumentDTO toDTO(EmployeeDocument document) {
        return EmployeeDocumentDTO.builder()
                .id(document.getId())
                .employeeId(document.getEmployee().getId())
                .documentType(document.getDocumentType())
                .documentName(document.getDocumentName())
                .fileId(document.getFileId())
                .fileUrl(document.getFileUrl())
                .expiryDate(document.getExpiryDate())
                .verified(document.getVerified())
                .notes(document.getNotes())
                .build();
    }
}
