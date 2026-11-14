package vacademy.io.admin_core_service.features.learner.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.chapter.enums.ChapterStatus;
import vacademy.io.admin_core_service.features.institute_learner.enums.LearnerStatusEnum;
import vacademy.io.admin_core_service.features.learner.constants.AssessmentServerRouteConstants;
import vacademy.io.admin_core_service.features.learner.dto.LeanerDashBoardDetailDTO;
import vacademy.io.admin_core_service.features.module.enums.ModuleStatusEnum;
import vacademy.io.admin_core_service.features.notification_service.service.NotificationService;
import vacademy.io.admin_core_service.features.packages.enums.PackageSessionStatusEnum;
import vacademy.io.admin_core_service.features.packages.enums.PackageStatusEnum;
import vacademy.io.admin_core_service.features.packages.repository.PackageRepository;
import vacademy.io.admin_core_service.features.slide.enums.SlideStatus;
import vacademy.io.admin_core_service.features.slide.repository.SlideRepository;
import vacademy.io.admin_core_service.features.subject.enums.SubjectStatusEnum;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.core.internal_api_wrapper.InternalClientUtils;
import vacademy.io.common.exceptions.VacademyException;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URL;
import java.util.Date;
import java.util.List;
import java.util.Optional;

import org.springframework.web.multipart.MultipartFile;
import com.itextpdf.kernel.pdf.PdfDocument;
import com.itextpdf.kernel.pdf.PdfReader;
import com.itextpdf.kernel.pdf.PdfWriter;
import com.itextpdf.layout.Document;
import com.itextpdf.layout.element.AreaBreak;
import com.itextpdf.layout.element.Paragraph;
import com.itextpdf.layout.properties.AreaBreakType;

import vacademy.io.admin_core_service.features.institute_learner.entity.Student;
import vacademy.io.admin_core_service.features.institute_learner.repository.InstituteStudentRepository;
import vacademy.io.admin_core_service.features.institute.dto.settings.SettingDto;
import vacademy.io.admin_core_service.features.institute.service.setting.InstituteSettingService;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.media_service.service.MediaService;
import vacademy.io.common.institute.entity.Institute;
import vacademy.io.common.media.dto.FileDetailsDTO;

@Service
public class LearnerDashBoardService {

    private static final List<String> ACTIVE_LEARNERS = List.of(LearnerStatusEnum.ACTIVE.name());
    private static final List<String> ACTIVE_SUBJECTS = List.of(SubjectStatusEnum.ACTIVE.name());
    private static final List<String> ACTIVE_MODULES = List.of(ModuleStatusEnum.ACTIVE.name());
    private static final List<String> ACTIVE_CHAPTERS = List.of(ChapterStatus.ACTIVE.name());
    private static final List<String> VALID_SLIDE_STATUSES = List.of(SlideStatus.PUBLISHED.name(), SlideStatus.UNSYNC.name());
    @Autowired
    private SlideRepository slideRepository;
    @Autowired
    private PackageRepository packageRepository;
    @Autowired
    private InternalClientUtils internalClientUtils;
    @Autowired
    private NotificationService notificationService;
    @Autowired
    private InstituteSettingService instituteSettingService;
    @Autowired
    private InstituteStudentRepository instituteStudentRepository;
    @Autowired
    private InstituteRepository instituteRepository;
    @Autowired
    private MediaService mediaService;
    @Value("${spring.application.name}")
    private String clientName;
    @Value("${assessment.server.baseurl}")
    private String assessmentServerBaseUrl;

    @Cacheable(value = "learnerDashboard", key = "#user.userId + '_' + #instituteId + '_' + (#packageSessionId != null ? #packageSessionId.hashCode() : 'null')")
    public LeanerDashBoardDetailDTO getLearnerDashBoardDetail(String instituteId, List<String> packageSessionId, CustomUserDetails user) {
        SettingDto tncSetting = null;
        try {
            Optional<Institute> optInst = instituteRepository.findById(instituteId);
            if (optInst.isPresent()) {
                tncSetting = instituteSettingService.getSpecificSetting(optInst.get(), "STUDENT_TNC_SETTING");
            }
        } catch (Exception e) {}

        boolean isTncEnabled = false;
        String tncUrl = null;
        if (tncSetting != null && tncSetting.getData() != null) {
            if (tncSetting.getData() instanceof java.util.Map) {
                @SuppressWarnings("unchecked")
                java.util.Map<String, Object> dataMap = (java.util.Map<String, Object>) tncSetting.getData();
                if (dataMap.containsKey("settingEnabled")) {
                    isTncEnabled = Boolean.parseBoolean(dataMap.get("settingEnabled").toString());
                } else if (dataMap.containsKey("setting_enabled")) {
                    isTncEnabled = Boolean.parseBoolean(dataMap.get("setting_enabled").toString());
                }
                
                String fileMediaId = null;
                if (dataMap.containsKey("fileMediaId")) {
                    fileMediaId = dataMap.get("fileMediaId").toString();
                } else if (dataMap.containsKey("file_media_id")) {
                    fileMediaId = dataMap.get("file_media_id").toString();
                }
                if (fileMediaId != null && !fileMediaId.isEmpty()) {
                    tncUrl = mediaService.getFilePublicUrlById(fileMediaId);
                }
            }
        }

        boolean askForTnc = false;
        java.util.Date tncAcceptedDate = null;
        String tncFileUrl = null;
        if (isTncEnabled && tncUrl != null) {
            Optional<Student> optStudent = instituteStudentRepository.findTopByUserId(user.getUserId());
            if (optStudent.isPresent() && (optStudent.get().getTncAccepted() == null || !optStudent.get().getTncAccepted())) {
                askForTnc = true;
            } else if (optStudent.isPresent() && optStudent.get().getTncAccepted() != null && optStudent.get().getTncAccepted()) {
                tncAcceptedDate = optStudent.get().getTncAcceptedDate();
                String storedTncFileId = optStudent.get().getTncFileId();
                if (storedTncFileId != null && !storedTncFileId.isEmpty()) {
                    // tncFileId may hold either a stored URL (new flow) or a media file id (legacy)
                    if (storedTncFileId.startsWith("http://") || storedTncFileId.startsWith("https://")) {
                        tncFileUrl = storedTncFileId;
                    } else {
                        tncFileUrl = mediaService.getFilePublicUrlByIdWithoutExpiry(storedTncFileId);
                    }
                }
            }
        }

        List<String> validPackageSessionIds = (packageSessionId == null) ? List.of()
                : packageSessionId.stream().filter(id -> id != null && !id.isBlank()).collect(java.util.stream.Collectors.toList());

        // Count of accessible packages — restricted to ACTIVE package / ACTIVE|HIDDEN
        // package_session / ACTIVE mapping so the tile matches the "My Courses" cards
        // (a learner removed from every batch counts 0). Also excludes internal types
        // (DELIVERY_CHARGE, SECURITY_DEPOSIT); that filter stays here (not in the repo)
        // to keep the underlying query reusable by callers that need internal types.
        int visiblePackagesCount = packageRepository
                .findDistinctPackagesByUserIdAndInstituteId(
                        user.getUserId(),
                        instituteId,
                        List.of(PackageStatusEnum.ACTIVE.name()),
                        List.of(PackageSessionStatusEnum.ACTIVE.name(), PackageSessionStatusEnum.HIDDEN.name()),
                        List.of(LearnerStatusEnum.ACTIVE.name()))
                .stream()
                .filter(p -> {
                    String t = p.getPackageType();
                    return t == null || (!"DELIVERY_CHARGE".equals(t) && !"SECURITY_DEPOSIT".equals(t));
                })
                .toList()
                .size();

        return new LeanerDashBoardDetailDTO(
                visiblePackagesCount,
                0,
                validPackageSessionIds.isEmpty() ? List.of() : slideRepository.findRecentIncompleteSlides(
                        user.getUserId(),
                        instituteId,
                        validPackageSessionIds,
                        VALID_SLIDE_STATUSES,
                        VALID_SLIDE_STATUSES, 
                        ACTIVE_CHAPTERS,
                        ACTIVE_MODULES,
                        ACTIVE_SUBJECTS,
                        List.of(PackageSessionStatusEnum.ACTIVE.name(), PackageSessionStatusEnum.HIDDEN.name()),
                        ACTIVE_LEARNERS
                ),
                askForTnc,
                tncUrl,
                tncAcceptedDate,
                tncFileUrl
        );
    }


    private int getAssessmentCountForUser(CustomUserDetails user, String userId, String instituteId) {
        // Validate inputs
        if (userId == null || userId.isEmpty() || instituteId == null || instituteId.isEmpty()) {
            throw new IllegalArgumentException("userId and instituteId must not be null or empty");
        }

        // Construct the URL with query parameters
        String urlWithParams = AssessmentServerRouteConstants.GET_COUNT_OF_ASSESSMENTS_FOR_USER
                + "?userId=" + userId + "&instituteId=" + instituteId;

        // Make the HMAC-signed request
        ResponseEntity<String> response = internalClientUtils.makeHmacRequest(
                clientName,
                HttpMethod.GET.name(),
                assessmentServerBaseUrl,
                urlWithParams,
                null
        );


        // Parse the response
        try {
            ObjectMapper objectMapper = new ObjectMapper();
            return objectMapper.readValue(response.getBody(), new TypeReference<Integer>() {
            });
        } catch (JsonProcessingException e) {
            throw new VacademyException(HttpStatus.INTERNAL_SERVER_ERROR,
                    "Failed to retrieve assessment count: " + e.getMessage());
        }
    }

    public String acceptTnc(CustomUserDetails user, vacademy.io.admin_core_service.features.learner.dto.AcceptTncRequestDTO request) {
        Student student = instituteStudentRepository.findTopByUserId(user.getUserId())
               .orElseThrow(() -> new VacademyException("Student not found"));

        SettingDto tncSetting = null;
        try {
            Optional<Institute> optInst = instituteRepository.findById(request.getInstituteId());
            if (optInst.isPresent()) {
                tncSetting = instituteSettingService.getSpecificSetting(optInst.get(), "STUDENT_TNC_SETTING");
            }
        } catch (Exception e) {}

        String tncMediaId = null;
        if (tncSetting != null && tncSetting.getData() != null && tncSetting.getData() instanceof java.util.Map) {
            @SuppressWarnings("unchecked")
            java.util.Map<String, Object> dataMap = (java.util.Map<String, Object>) tncSetting.getData();
            if (dataMap.containsKey("fileMediaId")) {
                tncMediaId = dataMap.get("fileMediaId").toString();
            } else if (dataMap.containsKey("file_media_id")) {
                tncMediaId = dataMap.get("file_media_id").toString();
            }
        }

        if (tncMediaId == null || tncMediaId.isEmpty()) {
             throw new VacademyException("T&C Setting not configured");
        }
        
        String publicUrl = mediaService.getFilePublicUrlByIdWithoutExpiry(tncMediaId);
        
        try (InputStream in = new URL(publicUrl).openStream();
             ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            
            PdfReader reader = new PdfReader(in);
            PdfWriter writer = new PdfWriter(out);
            PdfDocument pdfDoc = new PdfDocument(reader, writer);
            
            // Append a new blank page exactly at the end
            int totalPages = pdfDoc.getNumberOfPages();
            com.itextpdf.kernel.pdf.PdfPage newPage = pdfDoc.addNewPage(totalPages + 1);
            
            // Draw on the newly appended page
            com.itextpdf.layout.Canvas canvas = new com.itextpdf.layout.Canvas(
                new com.itextpdf.kernel.pdf.canvas.PdfCanvas(newPage), 
                pdfDoc.getDefaultPageSize()
            );
            
            canvas.add(new Paragraph("Terms and Conditions Acceptance"));
            canvas.add(new Paragraph("Accepted by: " + request.getName()));
            canvas.add(new Paragraph("Accepted Account User ID: " + user.getUserId()));
            canvas.add(new Paragraph("Accepted Date: " + new Date().toString()));
            canvas.close();
            // Must close pdfDoc before reading bytes — this writes the xref table and trailer
            pdfDoc.close();

            byte[] fileBytes = out.toByteArray();
            
            MultipartFile multipartFile = new MultipartFile() {
                @Override
                public String getName() { return "file"; }
                @Override
                public String getOriginalFilename() { return "tnc_accepted_" + user.getUserId() + ".pdf"; }
                @Override
                public String getContentType() { return "application/pdf"; }
                @Override
                public boolean isEmpty() { return fileBytes.length == 0; }
                @Override
                public long getSize() { return fileBytes.length; }
                @Override
                public byte[] getBytes() throws IOException { return fileBytes; }
                @Override
                public InputStream getInputStream() throws IOException { return new ByteArrayInputStream(fileBytes); }
                @Override
                public void transferTo(java.io.File dest) throws IOException, IllegalStateException { }
            };
            
            FileDetailsDTO fileDetails = mediaService.uploadFileV2(multipartFile);

            // Store the public URL directly. Media service returns the correct public-bucket URL
            // in FileDetailsDTO.url at upload time; the get-public-url lookup endpoint is wired
            // to the wrong bucket for existing consumers, so we bypass it by persisting the URL.
            String publicSignedUrl = fileDetails.getUrl();
            student.setTncAccepted(true);
            student.setTncAcceptedDate(new Date());
            student.setTncFileId(publicSignedUrl);
            instituteStudentRepository.save(student);

            // Fetch notify_on_sign settings and process notifications
            if (tncSetting != null && tncSetting.getData() != null && tncSetting.getData() instanceof java.util.Map) {
                @SuppressWarnings("unchecked")
                java.util.Map<String, Object> dataMap = (java.util.Map<String, Object>) tncSetting.getData();
                boolean notifyOnSign = false;
                if (dataMap.containsKey("notify_on_sign")) {
                    notifyOnSign = Boolean.parseBoolean(dataMap.get("notify_on_sign").toString());
                } else if (dataMap.containsKey("notifyOnSign")) {
                    notifyOnSign = Boolean.parseBoolean(dataMap.get("notifyOnSign").toString());
                }

                if (notifyOnSign) {
                    Object emailsObj = dataMap.containsKey("notify_emails") ? dataMap.get("notify_emails") : dataMap.get("notifyEmails");
                    String emailStr = (emailsObj != null) ? emailsObj.toString() : "";
                    if (!emailStr.isEmpty()) {
                        String[] emailArr = emailStr.split(",");
                        String signedDocUrl = publicSignedUrl;
                        for (String email : emailArr) {
                            String emailText = email.trim();
                            if (!emailText.isEmpty()) {
                                try {
                                    vacademy.io.common.notification.dto.GenericEmailRequest req =
                                            new vacademy.io.common.notification.dto.GenericEmailRequest();
                                    req.setTo(emailText);
                                    req.setSubject("Student T&C Accepted: " + request.getName());
                                    req.setBody("<p>Student <b>" + request.getName() + "</b> (User ID: " + user.getUserId() + ") has accepted the Terms & Conditions.</p>" +
                                                "<p>You can view their digitally signed agreement here: <a href='" + signedDocUrl + "'>View Document</a>.</p>");
                                    notificationService.sendGenericHtmlMailViaUnified(req, request.getInstituteId());
                                } catch (Exception emailEx) {
                                    // Log but don't fail — student has already accepted; email is best-effort
                                    System.err.println("TnC notification email failed for " + emailText + ": " + emailEx.getMessage());
                                }
                            }
                        }
                    }
                }
            }

            return "T&C Accepted Successfully";
        } catch(Exception e) {
            throw new VacademyException("Failed to generate and upload T&C PDF: " + e.getMessage());
        }
    }
}
