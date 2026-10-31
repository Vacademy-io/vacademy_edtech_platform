package vacademy.io.assessment_service.features.assessment.manager;

import com.itextpdf.html2pdf.ConverterProperties;
import com.itextpdf.html2pdf.HtmlConverter;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.io.InputStreamResource;
import org.springframework.data.domain.Pageable;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import vacademy.io.assessment_service.features.assessment.dto.AssessmentUserFilter;
import vacademy.io.assessment_service.features.assessment.dto.LeaderBoardDto;
import vacademy.io.assessment_service.features.assessment.dto.ParticipantsDetailsDto;
import vacademy.io.assessment_service.features.assessment.dto.admin_get_dto.request.RespondentFilter;
import vacademy.io.assessment_service.features.assessment.dto.admin_get_dto.response.MarksRankDto;
import vacademy.io.assessment_service.features.assessment.dto.admin_get_dto.response.RespondentListDto;
import vacademy.io.assessment_service.features.assessment.dto.admin_get_dto.response.StudentReportOverallDetailDto;
import vacademy.io.assessment_service.features.assessment.dto.export.LeaderboardExportDto;
import vacademy.io.assessment_service.features.assessment.dto.export.MarkRankExportDto;
import vacademy.io.assessment_service.features.assessment.dto.export.ParticipantsDetailExportDto;
import vacademy.io.assessment_service.features.assessment.dto.export.RespondentExportDto;
import vacademy.io.assessment_service.features.assessment.dto.export.ResultExportColumnsDto;
import vacademy.io.assessment_service.features.assessment.dto.export.ResultExportRowDto;
import vacademy.io.assessment_service.features.assessment.dto.export.AiStudentReportStatusDto;
import vacademy.io.assessment_service.features.assessment.dto.batch_pending.EnrolledLearnerDto;
import vacademy.io.assessment_service.features.assessment.dto.export.zip.*;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentCustomField;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentReportExportItem;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentReportExportJob;
import vacademy.io.assessment_service.features.assessment.entity.Section;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentUserRegistration;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.enums.AssessmentVisibility;
import vacademy.io.assessment_service.features.assessment.enums.ReportExportJobStatus;
import vacademy.io.assessment_service.features.assessment.enums.UserRegistrationFilterEnum;
import vacademy.io.assessment_service.features.assessment.enums.UserRegistrationSources;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentCustomFieldRepository;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentInstituteMappingRepository;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentReportExportItemRepository;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentReportExportJobRepository;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentRepository;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentUserRegistrationRepository;
import vacademy.io.assessment_service.features.assessment.repository.SectionRepository;
import vacademy.io.assessment_service.features.assessment.repository.StudentAttemptRepository;
import vacademy.io.assessment_service.features.assessment.service.HtmlBuilderService;
import vacademy.io.assessment_service.features.assessment.service.StudentReportAnalyticsService;
import vacademy.io.assessment_service.features.assessment.client.AiServiceCreditClient;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentClassAiAnalysis;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentClassAiAnalysisRepository;
import vacademy.io.assessment_service.features.assessment.service.ClassAiInsightsAggregator;
import vacademy.io.assessment_service.features.assessment.service.ClassAiNarrativeService;
import vacademy.io.assessment_service.features.assessment.service.ClassAiReportGenerationService;
import vacademy.io.assessment_service.features.assessment.service.ReportPdfUploadService;
import vacademy.io.assessment_service.features.assessment.service.ClassAiReportHtmlBuilder;
import vacademy.io.assessment_service.features.assessment.service.TeacherAiReportHtmlBuilder;
import vacademy.io.assessment_service.features.assessment.service.export.ReportExportJobFactory;
import vacademy.io.assessment_service.features.assessment.service.export.ReportExportProperties;
import vacademy.io.assessment_service.features.assessment.service.export.ReportZipAssemblyService;
import vacademy.io.assessment_service.features.assessment.service.export.ReportZipExportService;
import vacademy.io.assessment_service.features.client.AdminCoreServiceClient;
import vacademy.io.assessment_service.features.learner_assessment.dto.ReportClassContext;
import vacademy.io.assessment_service.features.learner_assessment.dto.context.SectionAggregateSnapshot;
import vacademy.io.assessment_service.features.learner_assessment.dto.QuestionClassStatsDto;
import vacademy.io.assessment_service.features.learner_assessment.dto.StudentComparisonDto;
import vacademy.io.assessment_service.features.learner_assessment.repository.QuestionWiseMarksRepository;
import vacademy.io.assessment_service.features.learner_assessment.service.LearnerReportService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.core.utils.DataToCsvConverter;
import vacademy.io.common.core.utils.DateUtil;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.media.service.FileService;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.*;
import java.util.Optional;
import java.util.TimeZone;

@Component
@lombok.extern.slf4j.Slf4j
public class AdminExportManager {

    // Fixed columns of the result CSV, before any registration-form columns.
    // Identity and contact first, then the result columns. Phone Number / Username / Batch
    // were added so a mark sheet can be cross-referenced and learners contacted without a
    // second export; every one of them is optional in the Export CSV dialog, so anyone who
    // wants the older, narrower sheet just unticks them.
    private static final List<String> RESULT_EXPORT_BASE_HEADERS = List.of(
            "Name", "Email", "Phone Number", "Username", "Batch",
            "Marks Obtained", "Total Marks", "Percentage", "Rank", "Duration", "Attempt Date");

    // The "not attempted" sheet: contact details and nothing else. Marks, rank, percentage
    // and attempt date would every one of them be blank for a learner who never started,
    // so offering them would only invite the reader to believe they scored zero.
    private static final List<String> NOT_ATTEMPTED_EXPORT_HEADERS = List.of(
            "Name", "Email", "Phone Number", "Username", "Batch");

    // Several answer rows can exist for one field (e.g. a multi-select), so they
    // are joined into a single cell rather than silently dropping all but one.
    private static final String MULTI_ANSWER_SEPARATOR = "; ";

    @Autowired
    StudentAttemptRepository studentAttemptRepository;

    @Autowired
    AssessmentUserRegistrationRepository assessmentUserRegistrationRepository;

    @Autowired
    vacademy.io.assessment_service.features.assessment.service.batch_pending.NotAttemptedLearnerService notAttemptedLearnerService;

    @Autowired
    AssessmentCustomFieldRepository assessmentCustomFieldRepository;

    @Autowired
    AssessmentInstituteMappingRepository assessmentInstituteMappingRepository;

    @Autowired
    HtmlBuilderService htmlBuilderService;

    @Autowired
    AssessmentParticipantsManager assessmentParticipantsManager;

    @Autowired
    AssessmentRepository assessmentRepository;

    @Autowired
    SectionRepository sectionRepository;

    @Autowired
    AdminCoreServiceClient adminCoreServiceClient;

    @Autowired
    LearnerReportService learnerReportService;

    @Autowired
    vacademy.io.assessment_service.features.assessment.service.ReportPdfRenderService reportPdfRenderService;

    @Autowired
    AssessmentReportExportJobRepository reportExportJobRepository;

    @Autowired
    AssessmentReportExportItemRepository reportExportItemRepository;

    @Autowired
    ReportExportJobFactory reportExportJobFactory;

    @Autowired
    ReportZipExportService reportZipExportService;

    @Autowired
    ReportZipAssemblyService reportZipAssemblyService;

    @Autowired
    ReportExportProperties reportExportProperties;

    @Autowired
    FileService fileService;

    @Autowired
    StudentReportAnalyticsService studentReportAnalyticsService;

    @Autowired
    TeacherAiReportHtmlBuilder teacherAiReportHtmlBuilder;

    @Autowired
    QuestionWiseMarksRepository questionWiseMarksRepository;

    @Autowired
    ClassAiReportHtmlBuilder classAiReportHtmlBuilder;

    @Autowired
    ClassAiInsightsAggregator classAiInsightsAggregator;

    @Autowired
    ClassAiNarrativeService classAiNarrativeService;

    @Autowired
    AiServiceCreditClient aiServiceCreditClient;

    @Autowired
    AssessmentClassAiAnalysisRepository classAiAnalysisRepository;

    @Autowired
    ReportPdfUploadService reportPdfUploadService;

    @Autowired
    vacademy.io.assessment_service.features.assessment.service.aireport.AiReportPdfService aiReportPdfService;

    @Autowired
    ClassAiReportGenerationService classAiReportGenerationService;

    /**
     * Rank of each row by the platform rule (StudentAttemptRepository: DENSE_RANK over marks
     * DESC, time taken ASC, nulls last), so a sheet shows the same rank as the learner's report:
     * equal marks are split by who finished faster, and only an exact tie on both shares a rank.
     * Ranks are returned in the input order; the rows themselves are not reordered.
     */
    static int[] platformRanks(List<Double> marks, List<Long> seconds) {
        Comparator<Integer> order = Comparator
                .comparing((Integer i) -> marks.get(i), Comparator.nullsLast(Comparator.<Double>reverseOrder()))
                .thenComparing(i -> seconds.get(i), Comparator.nullsLast(Comparator.<Long>naturalOrder()));
        List<Integer> idx = new ArrayList<>();
        for (int i = 0; i < marks.size(); i++) idx.add(i);
        idx.sort(order);
        int[] ranks = new int[marks.size()];
        int rank = 0;
        Integer prev = null;
        for (Integer i : idx) {
            if (prev == null || order.compare(prev, i) != 0) rank++;
            ranks[i] = rank;
            prev = i;
        }
        return ranks;
    }

    public static String convertToReadableTime(Long timeInSeconds) {
        if (Objects.isNull(timeInSeconds) || timeInSeconds < 0) {
            return "Invalid Input";
        }

        long hours = timeInSeconds / 3600;
        long minutes = (timeInSeconds % 3600) / 60;
        long seconds = timeInSeconds % 60;

        StringBuilder result = new StringBuilder();
        if (hours > 0) {
            result.append(hours).append(" hr ");
        }
        if (minutes > 0) {
            result.append(minutes).append(" min ");
        }
        if (seconds > 0 || result.isEmpty()) { // Always show at least seconds if the input is 0
            result.append(seconds).append(" sec");
        }

        return result.toString().trim();
    }

    public ResponseEntity<byte[]> getLeaderBoardCsvExport(CustomUserDetails user, String assessmentId, String instituteId) {

        List<LeaderBoardDto> leaderBoardDtos = studentAttemptRepository.findLeaderBoardForAssessmentAndInstituteId(assessmentId, instituteId, List.of("ACTIVE"));
        List<LeaderboardExportDto> leaderboardCsvDtos = createCsvDtoFromLeaderboardDto(leaderBoardDtos);
        return DataToCsvConverter.convertListToCsv(leaderboardCsvDtos);

    }

    private List<LeaderboardExportDto> createCsvDtoFromLeaderboardDto(List<LeaderBoardDto> leaderBoardDtos) {
        List<LeaderboardExportDto> response = new ArrayList<>();
        leaderBoardDtos.forEach(leaderBoardDto -> {
            response.add(LeaderboardExportDto.builder()
                    .Marks(leaderBoardDto.getAchievedMarks())
                    .Rank(leaderBoardDto.getRank())
                    .ParticipantsName(leaderBoardDto.getStudentName())
                    .Percentile(leaderBoardDto.getPercentile())
                    .TimeTaken(convertToReadableTime(leaderBoardDto.getCompletionTimeInSeconds()))
                    .build());
        });

        return response;
    }

    public ResponseEntity<InputStreamResource> getLeaderboardPdfExport(CustomUserDetails user, String assessmentId, String instituteId) {
        Optional<Assessment> assessmentOptional = assessmentRepository.findById(assessmentId);
        if (assessmentOptional.isEmpty()) throw new VacademyException("Assessment Not Found");

        List<LeaderBoardDto> leaderBoardDtos = studentAttemptRepository.findLeaderBoardForAssessmentAndInstituteId(assessmentId, instituteId, List.of("ACTIVE"));
        List<LeaderboardExportDto> leaderboardCsvDtos = createCsvDtoFromLeaderboardDto(leaderBoardDtos);
        return DataToCsvConverter.buildPdfResponse(assessmentOptional.get().getName().toUpperCase(), "LEADERBOARD", leaderboardCsvDtos, "leaderboard");
    }

    public ResponseEntity<byte[]> getMarksRankCsvExport(CustomUserDetails user, String assessmentId, String instituteId) {
        List<MarksRankDto> marksRankDtos = studentAttemptRepository.findMarkRankForAssessment(assessmentId, instituteId);
        List<MarkRankExportDto> markRankExportDtos = createMarkRankExportDto(marksRankDtos);
        return DataToCsvConverter.convertListToCsv(markRankExportDtos);
    }

    private List<MarkRankExportDto> createMarkRankExportDto(List<MarksRankDto> marksRankDtos) {
        List<MarkRankExportDto> response = new ArrayList<>();
        marksRankDtos.forEach(marksRankDto -> {
            response.add(MarkRankExportDto.builder()
                    .marks(marksRankDto.getMarks())
                    .rank(marksRankDto.getRank())
                    .noOfParticipants(marksRankDto.getNoOfParticipants())
                    .percentile(marksRankDto.getPercentile()).build());
        });

        return response;
    }

    public ResponseEntity<InputStreamResource> getMarksRankPdfExport(CustomUserDetails user, String assessmentId, String instituteId) {
        Optional<Assessment> assessmentOptional = assessmentRepository.findById(assessmentId);
        if (assessmentOptional.isEmpty()) throw new VacademyException("Assessment Not Found");

        List<MarksRankDto> marksRankDtos = studentAttemptRepository.findMarkRankForAssessment(assessmentId, instituteId);
        List<MarkRankExportDto> markRankExportDtos = createMarkRankExportDto(marksRankDtos);
        return DataToCsvConverter.buildPdfResponse(assessmentOptional.get().getName().toUpperCase(), "MARK-RANK LEADERBOARD", markRankExportDtos, "mark_rank");
    }

    public ResponseEntity<byte[]> getRegisteredCsvExport(CustomUserDetails user, String instituteId, String assessmentId, AssessmentUserFilter filter) {
        if (Objects.isNull(filter)) throw new VacademyException("Invalid Request");

        // "Not attempted" is not a slice of the attempt tables at all — a batch-enrolled
        // learner has no registration row until they start — so it gets its own sheet
        // rather than being squeezed through the result export below.
        if (isPendingAttempt(filter) && UserRegistrationSources.BATCH_PREVIEW_REGISTRATION.name()
                .equals(filter.getRegistrationSource())) {
            return handleNotAttemptedCsvExport(instituteId, assessmentId, filter);
        }

        // Empty registration_source means "all sources" — used by the result
        // export feature to get every participant regardless of how they enrolled.
        if (filter.getRegistrationSource() == null || filter.getRegistrationSource().isEmpty()) {
            return handleCaseForAllSourcesResultExport(instituteId, assessmentId, filter.getCustomFieldIds());
        }

        // Determine whether to fetch participants for an open or closed assessment
        if (AssessmentVisibility.PUBLIC.name().equals(filter.getAssessmentType())) {
            return handleCaseForPublicAssessment(instituteId, assessmentId, filter);
        } else {
            return handleCaseForPrivateAssessment(instituteId, assessmentId, filter);
        }
    }

    private ResponseEntity<byte[]> handleCaseForPrivateAssessment(String instituteId, String assessmentId, AssessmentUserFilter filter) {
        // Validate the filter
        if (Objects.isNull(filter)) {
            throw new VacademyException("Invalid Filter Request");
        }

        List<ParticipantsDetailsDto> participantsDetailsDtos = new ArrayList<>();

        // Check if the assessment attempt is pending
        if (isPendingAttempt(filter)) {
            participantsDetailsDtos = assessmentUserRegistrationRepository
                    .findUserRegistrationWithFilterAdminPreRegistrationAndPendingExport(
                            assessmentId, instituteId, filter.getStatus(),
                            filter.getRegistrationSource());

        } else {
            // If no results are found, perform a broader search
            participantsDetailsDtos = assessmentUserRegistrationRepository
                    .findUserRegistrationWithFilterForSourceExport(
                            assessmentId, instituteId, filter.getStatus(),
                            filter.getAttemptType(), filter.getRegistrationSource());
        }

        // Convert the retrieved data into the required response format
        return DataToCsvConverter.convertListToCsv(createExportDtoFromParticipantsDto(participantsDetailsDtos));
    }

    private ResponseEntity<byte[]> handleCaseForPublicAssessment(String instituteId, String assessmentId, AssessmentUserFilter filter) {
        if (Objects.isNull(filter)) throw new VacademyException("Invalid Filter Request");

        List<ParticipantsDetailsDto> participantsDetailsDtos = new ArrayList<>();
        Pageable pageable = null;

        //Handle Case for BATCH REGISTRATION
        if (UserRegistrationSources.BATCH_PREVIEW_REGISTRATION.name().equals(filter.getRegistrationSource())) {
            participantsDetailsDtos = handleCaseForBatchRegistration(assessmentId, instituteId, filter);
        }
        //Handle Case for ADMIN PRE REGISTRATION
        else if (UserRegistrationSources.ADMIN_PRE_REGISTRATION.name().equals(filter.getRegistrationSource())) {
            participantsDetailsDtos = handleCaseForAdminPreRegistration(assessmentId, instituteId, filter);
        } else throw new VacademyException("Invalid Source Request");

        return DataToCsvConverter.convertListToCsv(createExportDtoFromParticipantsDto(participantsDetailsDtos));
    }

    private List<ParticipantsDetailExportDto> createExportDtoFromParticipantsDto(List<ParticipantsDetailsDto> participantsDetailsDtos) {
        return createExportDtoFromParticipantsDtoWithTotalMarks(participantsDetailsDtos, null);
    }

    private List<ParticipantsDetailExportDto> createExportDtoFromParticipantsDtoWithTotalMarks(
            List<ParticipantsDetailsDto> participantsDetailsDtos, Double totalMarks) {
        List<ParticipantsDetailExportDto> response = new ArrayList<>();
        // Several of these queries list learners by name, so the row number is not a rank.
        int[] ranks = platformRanks(
                participantsDetailsDtos.stream().map(ParticipantsDetailsDto::getScore).toList(),
                participantsDetailsDtos.stream().map(ParticipantsDetailsDto::getDuration).toList());
        for (int i = 0; i < participantsDetailsDtos.size(); i++) {
            ParticipantsDetailsDto dto = participantsDetailsDtos.get(i);
            Double obtained = dto.getScore();
            String pct = (totalMarks != null && totalMarks > 0 && obtained != null)
                    ? String.format("%.2f%%", (obtained / totalMarks) * 100)
                    : "";
            String durationFormatted = dto.getDuration() != null
                    ? convertToReadableTime(dto.getDuration())
                    : "";
            response.add(ParticipantsDetailExportDto.builder()
                    .name(dto.getStudentName())
                    .email(dto.getUserEmail() != null ? dto.getUserEmail() : "")
                    .marksObtained(obtained)
                    .totalMarks(totalMarks)
                    .percentage(pct)
                    .rank(ranks[i])
                    .duration(durationFormatted)
                    .attemptDate(dto.getAttemptDate())
                    .build());
        }
        return response;
    }

    // Fetch ALL participants across every registration source and build an
    // enriched result CSV: Name, Email, Marks Obtained, Total Marks, Percentage,
    // Rank, Duration, Attempt Date (converted to IST), followed by one column per
    // requested registration-form custom field — the details external participants
    // filled in when they registered for a public assessment.
    private ResponseEntity<byte[]> handleCaseForAllSourcesResultExport(String instituteId, String assessmentId,
                                                                       List<String> requestedCustomFieldIds) {
        List<ResultExportRowDto> participants = assessmentUserRegistrationRepository
                .findAllEndedParticipantsForResultExport(assessmentId, instituteId);

        List<ExportCustomFieldColumn> customColumns =
                resolveExportCustomFieldColumns(assessmentId, requestedCustomFieldIds);

        StringBuilder csv = new StringBuilder();
        csv.append(String.join(",", RESULT_EXPORT_BASE_HEADERS));
        customColumns.forEach(column -> csv.append(",").append(escapeCsvField(column.header())));
        csv.append("\n");

        if (participants.isEmpty()) {
            return ResponseEntity.ok()
                    .header("Content-Disposition", "attachment; filename=\"results.csv\"")
                    .header("Content-Type", "text/plain")
                    .body(csv.toString().getBytes(StandardCharsets.UTF_8));
        }

        // registrationId -> (customFieldId -> answer). One query for the whole
        // assessment instead of one per participant.
        Map<String, Map<String, String>> answersByRegistration = customColumns.isEmpty()
                ? Map.of()
                : loadCustomFieldAnswers(assessmentId, instituteId);

        // Compute total marks from section configuration.
        List<Section> sections = sectionRepository.findByAssessmentIdAndStatusNotIn(
                assessmentId, List.of("DELETED"));
        double totalMarks = sections.stream()
                .mapToDouble(s -> s.getTotalMarks() != null ? s.getTotalMarks() : 0.0)
                .sum();

        // Date formatter — converts UTC Date to IST for display.
        SimpleDateFormat sdf = new SimpleDateFormat("dd MMM yyyy hh:mm a");
        sdf.setTimeZone(TimeZone.getTimeZone("Asia/Kolkata"));

        // One lookup for every batch in the sheet rather than one per row.
        Map<String, String> batchNames = adminCoreServiceClient.getBatchNames(
                participants.stream().map(ResultExportRowDto::getBatchId)
                        .filter(Objects::nonNull).distinct().sorted().toList());

        // Rows arrive in rank order (ORDER BY in query); the rank itself is the platform's, so
        // learners with equal marks are split by time taken, exactly as on their report.
        int[] ranks = platformRanks(
                participants.stream().map(ResultExportRowDto::getRankMarks).toList(),
                participants.stream().map(ResultExportRowDto::getDuration).toList());
        for (int i = 0; i < participants.size(); i++) {
            ResultExportRowDto p = participants.get(i);
            Double obtained = p.getScore() != null ? p.getScore() : 0.0;
            String pct = totalMarks > 0
                    ? String.format("%.2f%%", (obtained / totalMarks) * 100)
                    : "";
            String duration = p.getDuration() != null ? convertToReadableTime(p.getDuration()) : "";
            String attemptDate = p.getAttemptDate() != null ? sdf.format(p.getAttemptDate()) : "";
            String email = p.getUserEmail() != null ? p.getUserEmail() : "";
            String name = p.getStudentName() != null ? p.getStudentName() : "";
            String phone = p.getPhoneNumber() != null ? p.getPhoneNumber() : "";
            String username = p.getUsername() != null ? p.getUsername() : "";
            String batch = resolveBatchName(batchNames, p.getBatchId());

            csv.append(escapeCsvField(name)).append(",")
                    .append(escapeCsvField(email)).append(",")
                    .append(escapeCsvField(phone)).append(",")
                    .append(escapeCsvField(username)).append(",")
                    .append(escapeCsvField(batch)).append(",")
                    .append(obtained).append(",")
                    .append(totalMarks).append(",")
                    .append(pct).append(",")
                    .append(ranks[i]).append(",")
                    .append(escapeCsvField(duration)).append(",")
                    .append(escapeCsvField(attemptDate));

            Map<String, String> answers = answersByRegistration
                    .getOrDefault(p.getRegistrationId(), Map.of());
            for (ExportCustomFieldColumn column : customColumns) {
                csv.append(",").append(escapeCsvField(answers.get(column.fieldId())));
            }
            csv.append("\n");
        }

        return ResponseEntity.ok()
                .header("Content-Disposition", "attachment; filename=\"results.csv\"")
                .header("Content-Type", "text/plain")
                .body(csv.toString().getBytes(StandardCharsets.UTF_8));
    }

    /**
     * CSV of the batch-enrolled learners who never attempted — the Pending tab's export.
     *
     * <p>Shares {@link NotAttemptedLearnerService} with the tab itself, so the file and the
     * screen always name the same learners. It honours the batch chips and name search on
     * the filter, so the sheet matches what the admin was looking at when they clicked.
     *
     * <p>Emits the header row even when nobody is pending: a file with just headers says
     * "everyone attempted", whereas an empty file looks like the export failed.
     */
    private ResponseEntity<byte[]> handleNotAttemptedCsvExport(String instituteId, String assessmentId,
                                                               AssessmentUserFilter filter) {
        List<EnrolledLearnerDto> learners = notAttemptedLearnerService
                .findNotAttempted(assessmentId, instituteId, filter);

        Map<String, String> batchNames = adminCoreServiceClient.getBatchNames(
                learners.stream().map(EnrolledLearnerDto::getPackageSessionId)
                        .filter(Objects::nonNull).distinct().sorted().toList());

        StringBuilder csv = new StringBuilder(String.join(",", NOT_ATTEMPTED_EXPORT_HEADERS));
        csv.append("\n");

        for (EnrolledLearnerDto learner : learners) {
            String batch = resolveBatchName(batchNames, learner.getPackageSessionId());
            csv.append(escapeCsvField(learner.getFullName())).append(",")
                    .append(escapeCsvField(learner.getEmail())).append(",")
                    .append(escapeCsvField(learner.getMobileNumber())).append(",")
                    .append(escapeCsvField(learner.getUsername())).append(",")
                    .append(escapeCsvField(batch))
                    .append("\n");
        }

        return ResponseEntity.ok()
                .header("Content-Disposition", "attachment; filename=\"not-attempted.csv\"")
                .header("Content-Type", "text/plain")
                .body(csv.toString().getBytes(StandardCharsets.UTF_8));
    }

    /**
     * Batch display name for a row, or a blank cell when the row has no batch.
     *
     * <p>The null check is not defensive padding: the all-sources result sheet includes
     * open-registration participants, whose {@code source_id} is not a batch at all, so
     * this is called with null on real data. {@code Map.of()} — what the name lookup
     * returns when admin_core is unreachable — throws NullPointerException on a null key
     * rather than missing, so probing the map first would crash the whole export.
     *
     * <p>Falls back to the raw id when the name cannot be resolved: an unresolved batch id
     * is still more use to an admin than an empty cell.
     */
    private static String resolveBatchName(Map<String, String> batchNames, String batchId) {
        if (batchId == null || batchId.isBlank()) {
            return "";
        }
        return batchNames.getOrDefault(batchId, batchId);
    }

    /**
     * Columns the result CSV can carry for this assessment — the fixed result
     * columns plus every active registration-form field. Feeds the Export CSV
     * dialog's tick-list, which starts with everything ticked.
     */
    public ResponseEntity<ResultExportColumnsDto> getResultExportColumns(CustomUserDetails user, String instituteId,
                                                                         String assessmentId,
                                                                         boolean notAttempted) {
        // Reject an assessment that demonstrably belongs to another institute.
        // A handful of live assessments pre-date the mapping table and have no
        // mapping row at all — those stay exportable, scoped like the CSV itself
        // by the institute on their registration rows.
        if (assessmentInstituteMappingRepository.findByAssessmentIdAndInstituteId(assessmentId, instituteId).isEmpty()
                && assessmentInstituteMappingRepository.findTopByAssessmentId(assessmentId).isPresent()) {
            throw new VacademyException("Assessment Not Found");
        }

        // The "not attempted" sheet describes learners with no registration row, so the
        // registration-form fields below would every one of them be blank. Offering them
        // would be a tick-list of empty columns.
        if (notAttempted) {
            return ResponseEntity.ok(ResultExportColumnsDto.builder()
                    .baseColumns(NOT_ATTEMPTED_EXPORT_HEADERS)
                    .customFields(List.of())
                    .build());
        }

        List<AssessmentCustomField> customFields = assessmentCustomFieldRepository
                .findActiveFieldsByAssessmentId(assessmentId);
        List<String> columnLabels = buildCustomFieldHeaders(customFields);

        List<ResultExportColumnsDto.CustomFieldColumn> columns = new ArrayList<>();
        for (int i = 0; i < customFields.size(); i++) {
            AssessmentCustomField field = customFields.get(i);
            columns.add(ResultExportColumnsDto.CustomFieldColumn.builder()
                    .id(field.getId())
                    .fieldName(field.getFieldName())
                    .fieldKey(field.getFieldKey())
                    .fieldType(field.getFieldType())
                    .fieldOrder(field.getFieldOrder())
                    .isMandatory(field.getIsMandatory())
                    .columnLabel(columnLabels.get(i))
                    .build());
        }

        return ResponseEntity.ok(ResultExportColumnsDto.builder()
                .baseColumns(RESULT_EXPORT_BASE_HEADERS)
                .customFields(columns)
                .build());
    }

    /** One registration-form column of the CSV: which field fills it, and its header. */
    private record ExportCustomFieldColumn(String fieldId, String header) {
    }

    /**
     * Registration-form columns to append. A null id list means "every active
     * field" (so an older client that doesn't send a selection still gets the
     * full data), an empty list means the admin unticked all of them.
     * <p>
     * Headers are always computed over the assessment's full field list, then
     * filtered — otherwise unticking one field could rename another's column
     * (drop the first "Email" field and the second stops needing its "(Form 2)"
     * suffix), and the header would no longer match what the dialog promised.
     */
    private List<ExportCustomFieldColumn> resolveExportCustomFieldColumns(String assessmentId,
                                                                          List<String> requestedCustomFieldIds) {
        if (requestedCustomFieldIds != null && requestedCustomFieldIds.isEmpty()) {
            return List.of();
        }
        List<AssessmentCustomField> activeFields = assessmentCustomFieldRepository
                .findActiveFieldsByAssessmentId(assessmentId);
        List<String> headers = buildCustomFieldHeaders(activeFields);
        Set<String> requested = requestedCustomFieldIds == null
                ? null
                : new HashSet<>(requestedCustomFieldIds);

        List<ExportCustomFieldColumn> columns = new ArrayList<>();
        for (int i = 0; i < activeFields.size(); i++) {
            AssessmentCustomField field = activeFields.get(i);
            if (requested == null || requested.contains(field.getId())) {
                columns.add(new ExportCustomFieldColumn(field.getId(), headers.get(i)));
            }
        }
        return columns;
    }

    /**
     * Column titles for the custom fields, kept unique and distinct from the
     * fixed result columns — a form asking for "Email" would otherwise produce
     * two identically named columns and confuse the spreadsheet reader.
     */
    private List<String> buildCustomFieldHeaders(List<AssessmentCustomField> customFields) {
        Set<String> used = new HashSet<>();
        RESULT_EXPORT_BASE_HEADERS.forEach(header -> used.add(header.toLowerCase()));

        List<String> headers = new ArrayList<>();
        for (AssessmentCustomField field : customFields) {
            String base = (field.getFieldName() != null && !field.getFieldName().isBlank())
                    ? field.getFieldName().trim()
                    : (field.getFieldKey() != null ? field.getFieldKey() : "Field");
            String candidate = base;
            if (used.contains(candidate.toLowerCase())) {
                candidate = base + " (Form)";
            }
            int suffix = 2;
            while (used.contains(candidate.toLowerCase())) {
                candidate = base + " (Form " + suffix + ")";
                suffix++;
            }
            used.add(candidate.toLowerCase());
            headers.add(candidate);
        }
        return headers;
    }

    private Map<String, Map<String, String>> loadCustomFieldAnswers(String assessmentId, String instituteId) {
        Map<String, Map<String, String>> answersByRegistration = new HashMap<>();
        assessmentUserRegistrationRepository.findCustomFieldAnswersForAssessment(assessmentId, instituteId)
                .forEach(row -> {
                    if (row.getRegistrationId() == null || row.getFieldId() == null) return;
                    String answer = row.getAnswer() != null ? row.getAnswer().trim() : "";
                    if (answer.isEmpty()) return;
                    answersByRegistration
                            .computeIfAbsent(row.getRegistrationId(), key -> new HashMap<>())
                            .merge(row.getFieldId(), answer,
                                    (existing, incoming) -> existing + MULTI_ANSWER_SEPARATOR + incoming);
                });
        return answersByRegistration;
    }

    private String escapeCsvField(String value) {
        if (value == null) return "";
        // Wrap in quotes if the value contains comma, quote, or newline.
        if (value.contains(",") || value.contains("\"") || value.contains("\n")) {
            return "\"" + value.replace("\"", "\"\"") + "\"";
        }
        return value;
    }

    private List<ParticipantsDetailsDto> handleCaseForAdminPreRegistration(String assessmentId, String instituteId, AssessmentUserFilter filter) {
        List<ParticipantsDetailsDto> ParticipantsDetailsDtos = new ArrayList<>();


        // Check if the attempt type is "PENDING"
        if (isPendingAttempt(filter)) {
            // If no results found, search for admin pre-registered and pending users
            ParticipantsDetailsDtos = assessmentUserRegistrationRepository
                    .findUserRegistrationWithFilterAdminPreRegistrationAndPendingExport(
                            assessmentId, instituteId, filter.getStatus(),
                            filter.getRegistrationSource());

        } else {
            // If no results found, search for users based on status, attempt type, and registration source
            ParticipantsDetailsDtos = assessmentUserRegistrationRepository
                    .findUserRegistrationWithFilterForSourceExport(
                            assessmentId, instituteId, filter.getStatus(),
                            filter.getAttemptType(), filter.getRegistrationSource());
        }

        // Return the filtered list of registered users
        return ParticipantsDetailsDtos;
    }

    private List<ParticipantsDetailsDto> handleCaseForBatchRegistration(String assessmentId, String instituteId, AssessmentUserFilter filter) {
        List<ParticipantsDetailsDto> ParticipantsDetailsDto = new ArrayList<>();
        if (isPendingAttempt(filter)) {
            // Unreachable: getRegisteredCsvExport intercepts pending + batch and serves it
            // from handleNotAttemptedCsvExport, which is the only path that can answer it
            // (the set lives in admin_core, not in this database). Kept as a guard so a
            // future caller reaching here gets an empty list rather than the attempted rows.
        } else {
            //Handle Case for Attempted case i.e LIVE,PREVIEW,ENDED
            ParticipantsDetailsDto = assessmentUserRegistrationRepository.findUserRegistrationWithFilterForBatchForExport(assessmentId, instituteId, filter.getBatches(), filter.getStatus(), filter.getAttemptType());
        }

        return ParticipantsDetailsDto;
    }

    private boolean isPendingAttempt(AssessmentUserFilter filter) {
        // Return false if the filter or its attempt types are missing
        if (Objects.isNull(filter) || Objects.isNull(filter.getAttemptType())) {
            return false;
        }

        // Check if the only attempt type in the filter is "PENDING"
        return filter.getAttemptType().size() == 1 &&
                UserRegistrationFilterEnum.PENDING.name().equals(filter.getAttemptType().get(0));
    }

    public ResponseEntity<InputStreamResource> getRegisteredPdfExport(CustomUserDetails user, String instituteId, String assessmentId, AssessmentUserFilter filter) {
        if (Objects.isNull(filter)) throw new VacademyException("Invalid Request");

        // Determine whether to fetch participants for an open or closed assessment
        if (AssessmentVisibility.PUBLIC.name().equals(filter.getAssessmentType())) {
            return handleCaseForPublicAssessmentPdfExport(instituteId, assessmentId, filter);
        } else {
            return handleCaseForPrivateAssessmentPdfExport(instituteId, assessmentId, filter);
        }
    }

    private ResponseEntity<InputStreamResource> handleCaseForPrivateAssessmentPdfExport(String instituteId, String assessmentId, AssessmentUserFilter filter) {
        // Validate the filter
        if (Objects.isNull(filter)) {
            throw new VacademyException("Invalid Filter Request");
        }
        Optional<Assessment> assessmentOptional = assessmentRepository.findById(assessmentId);
        if (assessmentOptional.isEmpty()) throw new VacademyException("Assessment Not Found");

        List<ParticipantsDetailsDto> participantsDetailsDtos = new ArrayList<>();

        // Check if the assessment attempt is pending
        if (isPendingAttempt(filter)) {
            participantsDetailsDtos = assessmentUserRegistrationRepository
                    .findUserRegistrationWithFilterAdminPreRegistrationAndPendingExport(
                            assessmentId, instituteId, filter.getStatus(),
                            filter.getRegistrationSource());

        } else {
            // If no results are found, perform a broader search
            participantsDetailsDtos = assessmentUserRegistrationRepository
                    .findUserRegistrationWithFilterForSourceExport(
                            assessmentId, instituteId, filter.getStatus(),
                            filter.getAttemptType(), filter.getRegistrationSource());
        }


        // Convert the retrieved data into the required response format
        return DataToCsvConverter.buildPdfResponse(assessmentOptional.get().getName().toUpperCase(), "PARTICIPANTS LIST", createExportDtoFromParticipantsDto(participantsDetailsDtos), "participants");
    }

    private ResponseEntity<InputStreamResource> handleCaseForPublicAssessmentPdfExport(String instituteId, String assessmentId, AssessmentUserFilter filter) {
        if (Objects.isNull(filter)) throw new VacademyException("Invalid Filter Request");

        Optional<Assessment> assessmentOptional = assessmentRepository.findById(assessmentId);
        if (assessmentOptional.isEmpty()) throw new VacademyException("Assessment Not Found");

        List<ParticipantsDetailsDto> participantsDetailsDtos = new ArrayList<>();

        //Handle Case for BATCH REGISTRATION
        if (UserRegistrationSources.BATCH_PREVIEW_REGISTRATION.name().equals(filter.getRegistrationSource())) {
            participantsDetailsDtos = handleCaseForBatchRegistration(assessmentId, instituteId, filter);
        }
        //Handle Case for ADMIN PRE REGISTRATION
        else if (UserRegistrationSources.ADMIN_PRE_REGISTRATION.name().equals(filter.getRegistrationSource())) {
            participantsDetailsDtos = handleCaseForAdminPreRegistration(assessmentId, instituteId, filter);
        } else throw new VacademyException("Invalid Source Request");

        return DataToCsvConverter.buildPdfResponse(assessmentOptional.get().getName().toUpperCase(), "PARTICIPANTS LIST", createExportDtoFromParticipantsDto(participantsDetailsDtos), "participants");
    }

    public ResponseEntity<byte[]> getRespondentListCsvExport(CustomUserDetails user, String instituteId, String sectionId, String questionId, String assessmentId, RespondentFilter filter) {
        if (Objects.isNull(filter)) throw new VacademyException("Invalid Request");

        List<RespondentListDto> responses = null;
        responses = assessmentUserRegistrationRepository
                .findRespondentListForAssessmentWithFilterExport(assessmentId, questionId, filter.getAssessmentVisibility(), filter.getStatus(), filter.getRegistrationSource(), filter.getRegistrationSourceId());

        List<RespondentExportDto> exportDtos = createRespondentExportDto(responses);

        return DataToCsvConverter.convertListToCsv(exportDtos);

    }

    public ResponseEntity<InputStreamResource> getRespondentListPdfExport(CustomUserDetails user, String instituteId, String sectionId, String questionId, String assessmentId, RespondentFilter filter) {
        if (Objects.isNull(filter)) throw new VacademyException("Invalid Request");

        Optional<Assessment> assessmentOptional = assessmentRepository.findById(assessmentId);
        if (assessmentOptional.isEmpty()) throw new VacademyException("Assessment Not Found");

        List<RespondentListDto> responses = null;
        responses = assessmentUserRegistrationRepository
                .findRespondentListForAssessmentWithFilterExport(assessmentId, questionId, filter.getAssessmentVisibility(), filter.getStatus(), filter.getRegistrationSource(), filter.getRegistrationSourceId());

        List<RespondentExportDto> exportDtos = createRespondentExportDto(responses);

        return DataToCsvConverter.buildPdfResponse(assessmentOptional.get().getName().toUpperCase(), "RESPONDENT LIST", exportDtos, "respondent");

    }

    private List<RespondentExportDto> createRespondentExportDto(List<RespondentListDto> responses) {
        List<RespondentExportDto> respondentExportDtos = new ArrayList<>();
        responses.forEach(response -> {
            respondentExportDtos.add(RespondentExportDto.builder()
                    .responseTime(convertToReadableTime(response.getResponseTimeInSeconds()))
                    .participantName(response.getParticipantName())
                    .status(response.getStatus()).build());
        });

        return respondentExportDtos;
    }

    public ResponseEntity<byte[]> getQuestionInsightsExport(CustomUserDetails user, String assessmentId, String instituteId, String sectionIds) {
        List<String> allSectionIds = Arrays.asList(sectionIds.split(","));
        return createPdfForQuestionInsights(user, allSectionIds, assessmentId, instituteId);
    }

    private ResponseEntity<byte[]> createPdfForQuestionInsights(CustomUserDetails user, List<String> allSectionIds, String assessmentId, String instituteId) {
        String questionInsightsHtml = htmlBuilderService.getQuestionInsightsHtml(user, allSectionIds, assessmentId, instituteId);

        ByteArrayOutputStream pdfOutputStream = new ByteArrayOutputStream();
        ConverterProperties converterProperties = new ConverterProperties();
        HtmlConverter.convertToPdf(questionInsightsHtml, pdfOutputStream, converterProperties);

        // Return as downloadable PDF
        byte[] pdfBytes = pdfOutputStream.toByteArray();
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=questionInsights.pdf")
                .contentType(MediaType.APPLICATION_PDF)
                .body(pdfBytes);
    }

    public ResponseEntity<byte[]> getStudentReportPdf(CustomUserDetails user, String assessmentId, String attemptId, String instituteId) {
        StudentReportOverallDetailDto studentReportOverallDetailDto = assessmentParticipantsManager.createStudentReportDetailResponse(assessmentId, attemptId, instituteId);

        Optional<Assessment> assessmentOptional = assessmentRepository.findById(assessmentId);
        if (assessmentOptional.isEmpty()) throw new VacademyException("Assessment Not Found");

        // One report per student, identical to the learner's copy: the AI report once it
        // exists, else the normal report, wrapped in the assessment's report-profile pages.
        String studentUserId = resolveAttemptUserId(attemptId);
        byte[] pdfBytes;
        try {
            pdfBytes = aiReportPdfService.renderStudentReport(studentUserId, assessmentId, attemptId, instituteId,
                    studentReportOverallDetailDto, null, () -> {
                        StudentComparisonDto comparison = null;
                        try {
                            comparison = learnerReportService.buildComparisonData(studentUserId, assessmentId, attemptId, instituteId);
                        } catch (Exception ignored) {
                        }
                        ReportClassContext ctx = learnerReportService.loadClassContext(assessmentId, instituteId);
                        return reportPdfRenderService.render(studentReportOverallDetailDto, comparison, ctx);
                    });
        } catch (Exception e) {
            log.error("Student report PDF failed for attempt {}", attemptId, e);
            throw new VacademyException("Failed to generate report PDF");
        }
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=studentReport.pdf")
                .contentType(MediaType.APPLICATION_PDF)
                .body(pdfBytes);
    }

    // ==================================================================
    // AI diagnostic report (teacher copy)
    // ==================================================================

    /**
     * Whether the AI report for one attempt is ready, needs generating (i.e.
     * costs AI credits), or can never exist for this attempt.
     *
     * <p>Read-only and free — the admin menu calls it before offering the
     * download so the teacher is told which of the three they are looking at.
     */
    public AiStudentReportStatusDto getAiStudentReportStatus(CustomUserDetails user, String assessmentId,
                                                             String attemptId, String instituteId) {
        String studentUserId = resolveAttemptUserId(attemptId);
        if (studentUserId == null) {
            return AiStudentReportStatusDto.builder()
                    .status(AiStudentReportStatusDto.STATUS_UNSUPPORTED)
                    .available(false)
                    .requiresGeneration(false)
                    .message("This attempt is not linked to a learner, so it cannot be analysed.")
                    .build();
        }

        String processedJson = adminCoreServiceClient.getProcessedAIReport(studentUserId, assessmentId);
        if (processedJson != null && !processedJson.isBlank()) {
            return AiStudentReportStatusDto.builder()
                    .status(AiStudentReportStatusDto.STATUS_AVAILABLE)
                    .available(true)
                    .requiresGeneration(false)
                    .message("AI analysis is ready.")
                    .build();
        }
        return AiStudentReportStatusDto.builder()
                .status(AiStudentReportStatusDto.STATUS_NOT_GENERATED)
                .available(false)
                .requiresGeneration(true)
                .message("The AI analysis for this attempt has not been generated yet. "
                        + "Downloading it will use your institute's AI credits.")
                .build();
    }

    /**
     * The teacher's AI diagnostic PDF for one attempt.
     *
     * <p>Insights are produced once per learner + assessment by admin_core and
     * cached there, so the credit cost lands on the first download only — every
     * later download of the same attempt re-renders the stored analysis for
     * free. When {@code generateIfMissing} is false the call never triggers an
     * LLM run and fails instead, which is what a bulk/automated caller wants.
     *
     * <p>admin_core keys insights on (user, assessment) and hands back the
     * newest row, so on a re-attempted assessment this renders the analysis of
     * the learner's most recent submission even if an older {@code attemptId}
     * is passed. The marks, sections and question table always come from the
     * attempt asked for.
     */
    public ResponseEntity<byte[]> getAiStudentReportPdf(CustomUserDetails user, String assessmentId,
                                                        String attemptId, String instituteId,
                                                        boolean generateIfMissing) {
        Assessment assessment = assessmentRepository.findById(assessmentId)
                .orElseThrow(() -> new VacademyException("Assessment Not Found"));

        StudentAttempt attempt = studentAttemptRepository.findById(attemptId)
                .orElseThrow(() -> new VacademyException("Attempt Not Found"));
        AssessmentUserRegistration registration = attempt.getRegistration();
        String studentUserId = registration != null ? registration.getUserId() : null;
        if (studentUserId == null) {
            throw new VacademyException("This attempt is not linked to a learner, so it cannot be analysed.");
        }

        String processedJson = adminCoreServiceClient.getProcessedAIReport(studentUserId, assessmentId);
        if ((processedJson == null || processedJson.isBlank()) && generateIfMissing) {
            processedJson = generateAiInsights(studentUserId, assessmentId);
        }
        if (processedJson == null || processedJson.isBlank()) {
            throw new VacademyException("AI analysis is not available for this attempt yet.");
        }

        StudentReportOverallDetailDto detail =
                assessmentParticipantsManager.createStudentReportDetailResponse(assessmentId, attemptId, instituteId);

        // The same AI report the learner sees (2026-10 design). The teacher layout below is
        // only the fallback if that render fails.
        if (aiReportPdfService.isEnabled()) {
            try {
                byte[] pdf = aiReportPdfService.renderStudentReport(studentUserId, assessmentId, attemptId, instituteId,
                        detail, processedJson, null);
                return ResponseEntity.ok()
                        .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=ai-student-report.pdf")
                        .contentType(MediaType.APPLICATION_PDF)
                        .body(pdf);
            } catch (Exception e) {
                log.error("[ai-report] student AI report failed for attempt {}, using the teacher layout", attemptId, e);
            }
        }

        // Class comparison is best-effort: a report without rank/percentile is
        // still a usable diagnostic, an exception here would give the teacher
        // nothing at all.
        StudentComparisonDto comparison = null;
        try {
            comparison = learnerReportService.buildComparisonData(studentUserId, assessmentId, attemptId, instituteId);
        } catch (Exception e) {
            log.warn("AI report: could not build comparison data for attempt {}: {}", attemptId, e.getMessage());
        }

        ReportClassContext ctx = learnerReportService.loadClassContext(assessmentId, instituteId);

        StudentReportAnalyticsService.StudentReportAnalytics analytics = null;
        try {
            Double totalMarks = comparison != null && comparison.getTotalMarks() != null
                    ? comparison.getTotalMarks() : ctx.getTotalMarks();
            analytics = studentReportAnalyticsService.compute(assessmentId, instituteId, attemptId,
                    ctx.getFullLeaderboard(), detail, totalMarks,
                    !"MANUAL".equalsIgnoreCase(assessment.getEvaluationType()));
        } catch (Exception e) {
            log.warn("AI report: could not compute class analytics for attempt {}: {}", attemptId, e.getMessage());
        }

        String html = teacherAiReportHtmlBuilder.build(TeacherAiReportHtmlBuilder.Input.builder()
                .assessmentName(ctx.getAssessmentName() != null ? ctx.getAssessmentName() : assessment.getName())
                .processedJson(processedJson)
                .reportDetail(detail)
                .comparison(comparison)
                .analytics(analytics)
                .branding(ctx.getBranding())
                .studentName(resolveStudentName(registration, ctx, attemptId))
                .registrationUsername(registration != null ? registration.getUsername() : null)
                .userEmail(registration != null ? registration.getUserEmail() : null)
                .evaluationType(assessment.getEvaluationType())
                .examDate(assessment.getBoundStartTime())
                .assessmentDurationMinutes(assessment.getDuration())
                .attemptId(attemptId)
                .insightsGeneratedAt(new Date())
                .classCorrectPercentByQuestion(classCorrectPercentByQuestion(assessmentId, instituteId))
                .build());

        ByteArrayOutputStream out = new ByteArrayOutputStream();
        HtmlConverter.convertToPdf(html, out, new ConverterProperties());

        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=ai-student-report.pdf")
                .contentType(MediaType.APPLICATION_PDF)
                .body(out.toByteArray());
    }

    /**
     * The ONE AI diagnostic report for a whole assessment.
     *
     * <p><b>Charged once, then free.</b> The first generation makes a real model
     * call and deducts the institute's AI credits; the result is stored and every
     * later download re-serves it for nothing. A deliberate {@code regenerate}
     * charges again — that is the point of an explicit Refresh.
     *
     * <p>The order below is load-bearing and must not be rearranged:
     * <b>claim (own transaction) -> model -> persist -> charge</b>. Claiming
     * first is what stops two admins clicking together from making two
     * real-money model calls; charging last is what stops a billing blip from
     * destroying a report the institute can already read.
     */
    public ResponseEntity<byte[]> getAiAssessmentReportPdf(CustomUserDetails user, String assessmentId,
                                                           String instituteId, boolean generate,
                                                           boolean regenerate, String versionId) {
        Assessment assessment = assessmentRepository.findById(assessmentId)
                .orElseThrow(() -> new VacademyException("Assessment Not Found"));

        // Downloading a specific past version from the history list. Always
        // free — it was paid for when it was generated.
        if (versionId != null && !versionId.isBlank()) {
            AssessmentClassAiAnalysis version = classAiAnalysisRepository.findById(versionId)
                    .filter(v -> assessmentId.equals(v.getAssessmentId())
                            && instituteId.equals(v.getInstituteId()))
                    .orElseThrow(() -> new VacademyException("That report version was not found"));
            byte[] bytes = version.getPdfFileId() != null
                    ? downloadStoredReport(version.getPdfFileId()) : null;
            if (bytes == null) {
                bytes = renderPdf(buildClassReportHtml(assessment, assessmentId, instituteId,
                        version.getAnalysisJson()));
            }
            return pdfResponse(bytes, assessment.getName());
        }

        // ---- already generated? serve it, free ----
        Optional<AssessmentClassAiAnalysis> existing =
                classAiReportGenerationService.find(assessmentId, instituteId);
        if (!regenerate && existing.isPresent() && existing.get().isReady()
                && existing.get().getPdfFileId() != null) {
            byte[] stored = downloadStoredReport(existing.get().getPdfFileId());
            if (stored != null) {
                return pdfResponse(stored, assessment.getName());
            }
            // The stored file is gone (media expiry, a bad key). analysis_json is
            // the source of truth, so re-render rather than re-charging.
            log.warn("Stored class AI report unreadable for {} — re-rendering from analysis_json", assessmentId);
            byte[] rebuilt = renderPdf(buildClassReportHtml(assessment, assessmentId, instituteId,
                    existing.get().getAnalysisJson()));
            return pdfResponse(rebuilt, assessment.getName());
        }

        if (existing.isPresent() && existing.get().isGenerating()) {
            throw new VacademyException("This report is already being generated. "
                    + "Try again in a moment — it will not be charged twice.");
        }
        if (!generate) {
            throw new VacademyException("No AI report has been generated for this assessment yet.");
        }

        // ---- quote, and refuse only on a definite shortfall ----
        AiServiceCreditClient.CreditEstimate estimate = aiServiceCreditClient.estimate(instituteId);
        if (Boolean.FALSE.equals(estimate.sufficient())) {
            throw new VacademyException("Your institute does not have enough AI credits for this report. "
                    + "Top up AI credits and try again.");
        }

        // ---- claim: exactly one caller proceeds ----
        Optional<AssessmentClassAiAnalysis> claimed = classAiReportGenerationService.claim(
                assessmentId, instituteId, user != null ? user.getUserId() : null,
                estimate.credits(), regenerate);
        if (claimed.isEmpty()) {
            throw new VacademyException("This report is already being generated. "
                    + "Try again in a moment — it will not be charged twice.");
        }
        AssessmentClassAiAnalysis row = claimed.get();

        try {
            // ---- the one paid call ----
            ClassAiNarrativeService.Narrative narrative = classAiNarrativeService.generate(
                    buildClassFacts(assessmentId, instituteId), assessment.getName(), instituteId);

            byte[] pdf = renderPdf(buildClassReportHtml(assessment, assessmentId, instituteId,
                    narrative.json()));

            String fileId = null;
            try {
                fileId = reportPdfUploadService.upload(pdf, "AI_Report_" + assessmentId + ".pdf",
                        "ASSESSMENT_CLASS_AI_REPORT", assessmentId);
            } catch (Exception e) {
                // Storage is a convenience; analysis_json is the source of truth
                // and the PDF is re-renderable from it.
                log.warn("Could not store the class AI report PDF for {}: {}", assessmentId, e.getMessage());
            }

            // ---- persist BEFORE charging; this one must rethrow ----
            classAiReportGenerationService.persistReady(row, narrative.json(), fileId,
                    computeContentFingerprint(assessmentId, instituteId), narrative.model());

            // ---- charge LAST, never rethrows ----
            classAiReportGenerationService.charge(row);

            return pdfResponse(pdf, assessment.getName());
        } catch (Exception e) {
            // Release the claim so the teacher can retry. Nothing was charged.
            classAiReportGenerationService.markFailed(row.getId());
            if (e instanceof VacademyException ve) throw ve;
            log.error("Class AI report generation failed for {}", assessmentId, e);
            throw new VacademyException("The AI report could not be generated. Please try again.");
        }
    }

    /** Whether a report exists, when it was made, and what a new one would cost. */
    public Map<String, Object> getAiAssessmentReportStatus(CustomUserDetails user, String assessmentId,
                                                           String instituteId) {
        Optional<AssessmentClassAiAnalysis> existing =
                classAiReportGenerationService.find(assessmentId, instituteId);
        AiServiceCreditClient.CreditEstimate estimate = aiServiceCreditClient.estimate(instituteId);

        Map<String, Object> out = new LinkedHashMap<>();
        boolean ready = existing.isPresent() && existing.get().isReady();
        out.put("available", ready);
        out.put("generating", existing.isPresent() && existing.get().isGenerating());
        out.put("generated_at", ready ? existing.get().getGeneratedAt() : null);
        // Stale = results changed after this was generated. Surfaced, never
        // auto-refreshed: regenerating spends the institute's money, so it stays
        // an explicit choice.
        out.put("stale", ready && isReportStale(existing.get(), assessmentId, instituteId));
        // Every past generation, newest first — a paid Refresh supersedes rather
        // than destroys, so a version already shared with staff stays available.
        out.put("history", classAiReportGenerationService.history(assessmentId, instituteId).stream()
                .map(h -> {
                    Map<String, Object> item = new LinkedHashMap<>();
                    item.put("id", h.getId());
                    item.put("generated_at", h.getGeneratedAt());
                    item.put("current", h.getSupersededAt() == null);
                    return item;
                }).toList());
        out.put("credits_required", estimate.credits());
        out.put("current_balance", estimate.currentBalance());
        out.put("sufficient", estimate.sufficient());
        return out;
    }

    /**
     * Detects "the results changed since this report was made".
     *
     * <p>Hashes a VALUE, not a timestamp: {@code student_attempt.updated_at} and
     * {@code question_wise_marks.updated_at} are both write-blocked with no
     * trigger, so a re-evaluation moves no timestamp at all and any time-based
     * check would never fire.
     */
    private boolean isReportStale(AssessmentClassAiAnalysis row, String assessmentId, String instituteId) {
        String now = computeContentFingerprint(assessmentId, instituteId);
        return now != null && row.getContentFingerprint() != null
                && !now.equals(row.getContentFingerprint());
    }

    private String computeContentFingerprint(String assessmentId, String instituteId) {
        try {
            List<LeaderBoardDto> rows = learnerReportService.loadClassContext(assessmentId, instituteId)
                    .getFullLeaderboard();
            if (rows == null) return null;
            // Sorted per-attempt marks, rounded. A bare SUM is float-fragile and
            // misses two learners' marks swapping without changing the total.
            String basis = rows.stream()
                    .filter(Objects::nonNull)
                    .map(r -> r.getAttemptId() + ":"
                            + (r.getAchievedMarks() == null ? "" : Math.round(r.getAchievedMarks() * 100.0)))
                    .sorted()
                    .collect(java.util.stream.Collectors.joining(","));
            java.security.MessageDigest md = java.security.MessageDigest.getInstance("SHA-256");
            byte[] hash = md.digest(basis.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder();
            for (byte b : hash) hex.append(String.format("%02x", b));
            return hex.toString();
        } catch (Exception e) {
            log.warn("Could not fingerprint assessment {} for staleness: {}", assessmentId, e.getMessage());
            return null;
        }
    }

    private byte[] downloadStoredReport(String fileId) {
        try {
            return fileService.getFileFromFileId(fileId);
        } catch (Exception e) {
            log.warn("Could not read stored class AI report {}: {}", fileId, e.getMessage());
            return null;
        }
    }

    private ResponseEntity<byte[]> pdfResponse(byte[] pdf, String assessmentName) {
        String safeName = (assessmentName != null ? assessmentName : "assessment")
                .replaceAll("[^A-Za-z0-9._-]+", "_");
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION,
                        "attachment; filename=AI_Report_" + safeName + ".pdf")
                .contentType(MediaType.APPLICATION_PDF)
                .body(pdf);
    }

    /** The compact facts blob the model reasons over — never raw learner data. */
    private Map<String, Object> buildClassFacts(String assessmentId, String instituteId) {
        ReportClassContext ctx = learnerReportService.loadClassContext(assessmentId, instituteId);
        List<LeaderBoardDto> leaderboard = ctx.getFullLeaderboard() != null
                ? ctx.getFullLeaderboard() : List.of();
        ClassAiInsightsAggregator.ClassInsights insights = classAiInsightsAggregator.aggregate(
                adminCoreServiceClient.getProcessedAIReportsForAssessment(assessmentId));
        Double totalMarks = ctx.getTotalMarks();

        Map<String, Object> facts = new LinkedHashMap<>();
        facts.put("total_marks", totalMarks);
        facts.put("learners_attempted", leaderboard.size());
        facts.put("class_average", ctx.getOverview() != null ? ctx.getOverview().getAverageMarks() : null);
        facts.put("highest", ctx.getHighestMarks());
        facts.put("lowest", ctx.getLowestMarks());
        facts.put("score_bands", buildScoreBands(leaderboard, totalMarks).stream()
                .map(b -> Map.of("range", b.getLabel(), "learners", b.getStudentCount())).toList());
        facts.put("sections", buildSectionRows(assessmentId, instituteId, ctx).stream()
                .map(sec -> Map.of("name", nvlStr(sec.getName()),
                        "out_of", nvlNum(sec.getTotalMarks()),
                        "class_average", nvlNum(sec.getAverageMarks()),
                        "accuracy_percent", nvlNum(sec.getAverageAccuracy()))).toList());
        facts.put("topics", insights.getTopics().stream()
                .map(t -> Map.of("topic", t.getTopic(),
                        "class_accuracy_percent", t.getClassAccuracy(),
                        "learners_weak", t.getWeakLearners(),
                        "learners_covered", t.getLearnersCovering())).toList());
        facts.put("blooms", insights.getBlooms().entrySet().stream()
                .collect(java.util.stream.Collectors.toMap(Map.Entry::getKey,
                        e -> Map.of("correct", e.getValue()[0], "asked", e.getValue()[1]))));
        facts.put("shared_misconceptions", insights.getMisconceptions().stream()
                .map(m -> Map.of("question", nvlStr(m.getQuestionSummary()),
                        "learners_affected", m.getAffectedLearners(),
                        "wrong_answer", nvlStr(m.getWrongAnswer()),
                        "correct_answer", nvlStr(m.getCorrectAnswer()),
                        "why", nvlStr(m.getMisconception()))).toList());
        facts.put("learner_analyses_available", insights.getAnalysedLearners());
        return facts;
    }

    /** Builds the report HTML around a generated (or previously stored) narrative. */
    private String buildClassReportHtml(Assessment assessment, String assessmentId, String instituteId,
                                        String narrativeJson) {
        ReportClassContext ctx = learnerReportService.loadClassContext(assessmentId, instituteId);
        List<LeaderBoardDto> leaderboard = ctx.getFullLeaderboard() != null
                ? ctx.getFullLeaderboard() : List.of();
        ClassAiInsightsAggregator.ClassInsights insights = classAiInsightsAggregator.aggregate(
                adminCoreServiceClient.getProcessedAIReportsForAssessment(assessmentId));
        Double totalMarks = ctx.getTotalMarks();

        String narrative = null;
        String areas = null;
        String bloomsReading = null;
        List<ClassAiReportHtmlBuilder.ActionStep> plan = new ArrayList<>();
        try {
            if (narrativeJson != null && !narrativeJson.isBlank()) {
                com.fasterxml.jackson.databind.JsonNode n = new ObjectMapper().readTree(narrativeJson);
                narrative = n.path("performance_analysis").asText(null);
                areas = n.path("areas_of_improvement").asText(null);
                bloomsReading = n.path("blooms_reading").asText(null);
                for (com.fasterxml.jackson.databind.JsonNode step : n.path("action_plan")) {
                    plan.add(ClassAiReportHtmlBuilder.ActionStep.builder()
                            .priority(step.path("priority").asInt(0))
                            .topic(step.path("topic").asText(""))
                            .suggestion(step.path("suggestion").asText(""))
                            .estimatedTime(step.path("estimated_time").asText(""))
                            .affectedStudents(step.has("affected_students")
                                    ? step.path("affected_students").asInt() : null)
                            .build());
                }
            }
        } catch (Exception e) {
            log.warn("Could not read the stored narrative for {}: {}", assessmentId, e.getMessage());
        }

        return classAiReportHtmlBuilder.build(ClassAiReportHtmlBuilder.Input.builder()
                .assessmentName(ctx.getAssessmentName() != null ? ctx.getAssessmentName() : assessment.getName())
                .examDate(assessment.getBoundStartTime())
                .generatedAt(new Date())
                .branding(ctx.getBranding())
                .overview(buildClassOverview(ctx, leaderboard, totalMarks, assessment))
                .distribution(buildScoreBands(leaderboard, totalMarks))
                .sections(buildSectionRows(assessmentId, instituteId, ctx))
                .topics(buildTopicRows(insights))
                .blooms(insights.getBlooms())
                .misconceptions(buildMisconceptions(insights))
                .roster(buildRoster(leaderboard, totalMarks))
                .actionPlan(plan)
                .narrative(narrative)
                .areasOfImprovement(areas)
                .bloomsReading(bloomsReading)
                .topicSource(ClassAiReportHtmlBuilder.TopicSource.AI)
                .aiUnavailable(narrative == null || narrative.isBlank())
                .build());
    }

    private static String nvlStr(String v) {
        return v == null ? "" : v;
    }

    private static Object nvlNum(Double v) {
        return v == null ? 0 : v;
    }

    private byte[] renderPdf(String html) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        HtmlConverter.convertToPdf(html, out, new ConverterProperties());
        return out.toByteArray();
    }

    private ClassAiReportHtmlBuilder.ClassOverview buildClassOverview(ReportClassContext ctx,
                                                                      List<LeaderBoardDto> leaderboard,
                                                                      Double totalMarks,
                                                                      Assessment assessment) {
        List<Double> marks = leaderboard.stream()
                .map(LeaderBoardDto::getAchievedMarks)
                .filter(Objects::nonNull)
                .sorted()
                .toList();
        Double median = marks.isEmpty() ? null : marks.get(marks.size() / 2);
        Double average = marks.isEmpty() ? null
                : Math.round(marks.stream().mapToDouble(Double::doubleValue).average().orElse(0) * 10.0) / 10.0;

        Long participants = ctx.getOverview() != null ? ctx.getOverview().getTotalParticipants() : null;
        Double avgDuration = ctx.getOverview() != null ? ctx.getOverview().getAverageDuration() : null;

        return ClassAiReportHtmlBuilder.ClassOverview.builder()
                .totalRegistered(participants != null ? participants.intValue() : leaderboard.size())
                .attempted(leaderboard.size())
                .notAttempted(participants != null ? Math.max(0, participants.intValue() - leaderboard.size()) : 0)
                .totalMarks(totalMarks)
                .averageMarks(average)
                .medianMarks(median)
                .highestMarks(ctx.getHighestMarks())
                .lowestMarks(ctx.getLowestMarks())
                .averageAccuracy(ctx.getClassAccuracy())
                .averageDurationSeconds(avgDuration != null ? Math.round(avgDuration) : null)
                .durationMinutes(assessment.getDuration())
                .build();
    }

    /** Five equal mark bands — enough shape to read the distribution, few enough to label. */
    private List<ClassAiReportHtmlBuilder.ScoreBand> buildScoreBands(List<LeaderBoardDto> leaderboard,
                                                                     Double totalMarks) {
        if (leaderboard.isEmpty() || totalMarks == null || totalMarks <= 0) {
            return List.of();
        }
        int bands = 5;
        int[] counts = new int[bands];
        for (LeaderBoardDto row : leaderboard) {
            double m = row.getAchievedMarks() != null ? row.getAchievedMarks() : 0;
            int idx = (int) Math.min(bands - 1, Math.max(0, (m / totalMarks) * bands));
            counts[idx]++;
        }
        List<ClassAiReportHtmlBuilder.ScoreBand> out = new ArrayList<>();
        for (int i = 0; i < bands; i++) {
            long lo = Math.round(totalMarks * i / bands);
            long hi = Math.round(totalMarks * (i + 1) / bands);
            out.add(ClassAiReportHtmlBuilder.ScoreBand.builder()
                    .label(lo + "-" + hi).studentCount(counts[i]).build());
        }
        return out;
    }

    private List<ClassAiReportHtmlBuilder.SectionRow> buildSectionRows(String assessmentId,
                                                                       String instituteId,
                                                                       ReportClassContext ctx) {
        List<ClassAiReportHtmlBuilder.SectionRow> out = new ArrayList<>();
        if (ctx.getSections() == null) return out;
        Map<String, SectionAggregateSnapshot> agg = ctx.getSectionAggregation() != null
                ? ctx.getSectionAggregation() : Map.of();
        for (var section : ctx.getSections()) {
            SectionAggregateSnapshot a = agg.get(section.id());
            Double sectionTotal = section.totalMarks();
            Double avg = a != null ? a.avgMarks() : null;
            out.add(ClassAiReportHtmlBuilder.SectionRow.builder()
                    .name(section.name())
                    .totalMarks(sectionTotal)
                    .averageMarks(avg)
                    .highestMarks(a != null ? a.maxMarks() : null)
                    .averageAccuracy(sectionTotal != null && sectionTotal > 0 && avg != null
                            ? Math.round(avg / sectionTotal * 1000.0) / 10.0 : null)
                    .build());
        }
        return out;
    }

    private List<ClassAiReportHtmlBuilder.TopicRow> buildTopicRows(
            ClassAiInsightsAggregator.ClassInsights insights) {
        List<ClassAiReportHtmlBuilder.TopicRow> out = new ArrayList<>();
        for (var t : insights.getTopics()) {
            double acc = t.getClassAccuracy();
            out.add(ClassAiReportHtmlBuilder.TopicRow.builder()
                    .topic(t.getTopic())
                    .questionCount(t.getQuestionCount())
                    .classAccuracy(acc)
                    .weakStudentCount(t.getWeakLearners())
                    .totalStudents(t.getLearnersCovering())
                    .masteryLabel(acc < 40 ? "Beginner" : acc < 70 ? "Developing"
                            : acc < 85 ? "Proficient" : "Expert")
                    .build());
        }
        return out;
    }

    private List<ClassAiReportHtmlBuilder.Misconception> buildMisconceptions(
            ClassAiInsightsAggregator.ClassInsights insights) {
        List<ClassAiReportHtmlBuilder.Misconception> out = new ArrayList<>();
        for (var m : insights.getMisconceptions()) {
            out.add(ClassAiReportHtmlBuilder.Misconception.builder()
                    .questionSummary(m.getQuestionSummary())
                    .affectedStudents(m.getAffectedLearners())
                    .wrongAnswer(m.getWrongAnswer())
                    .correctAnswer(m.getCorrectAnswer())
                    .misconception(m.getMisconception())
                    .remediation(m.getRemediation())
                    .build());
        }
        return out;
    }

    private List<ClassAiReportHtmlBuilder.StudentRow> buildRoster(List<LeaderBoardDto> leaderboard,
                                                                  Double totalMarks) {
        List<ClassAiReportHtmlBuilder.StudentRow> out = new ArrayList<>();
        for (LeaderBoardDto row : leaderboard) {
            Double marks = row.getAchievedMarks();
            out.add(ClassAiReportHtmlBuilder.StudentRow.builder()
                    .name(row.getStudentName())
                    .marks(marks)
                    .percentage(marks != null && totalMarks != null && totalMarks > 0
                            ? Math.round(marks / totalMarks * 1000.0) / 10.0 : null)
                    .rank(row.getRank())
                    .attempted(true)
                    .weakSections(List.of())
                    .weakTopics(List.of())
                    .build());
        }
        return out;
    }

    /**
     * Runs admin_core's on-demand analysis and translates its outcome into
     * something a teacher can act on. Every failure mode gets its own message:
     * "out of credits" is a billing action, "still generating" is a wait, and
     * "no submission data" is neither.
     */
    private String generateAiInsights(String studentUserId, String assessmentId) {
        AdminCoreServiceClient.AiReportGenerationResult result =
                adminCoreServiceClient.generateAiReportOnDemand(studentUserId, assessmentId);

        if (result.isProcessed()) {
            return result.processedJson();
        }
        if (result.isOutOfCredits()) {
            throw new VacademyException("Your institute has run out of AI credits, so this report could not be "
                    + "generated. Top up AI credits and try again.");
        }
        if (result.isNotFound()) {
            throw new VacademyException("No analysable submission was captured for this attempt, so an AI report "
                    + "cannot be generated for it.");
        }
        if (AdminCoreServiceClient.AiReportGenerationResult.STATUS_GENERATING.equalsIgnoreCase(result.status())) {
            throw new VacademyException("The AI analysis is still being generated. Try the download again in a "
                    + "minute — it will not be charged twice.");
        }
        throw new VacademyException("The AI analysis could not be generated for this attempt. Please try again.");
    }

    /**
     * How much of the cohort got each question right, as a percentage.
     *
     * <p>One aggregate query over {@code question_wise_marks} — the same one the
     * v2 report's easy-miss analysis runs, but kept whole here: the teacher
     * report classifies every question row, not only the ones that cross a
     * threshold. Best-effort; an empty map simply drops the column.
     */
    private Map<String, Double> classCorrectPercentByQuestion(String assessmentId, String instituteId) {
        Map<String, Double> out = new HashMap<>();
        try {
            List<QuestionClassStatsDto> stats =
                    questionWiseMarksRepository.findQuestionClassStatsForAssessment(assessmentId, instituteId);
            if (stats == null) {
                return out;
            }
            for (QuestionClassStatsDto stat : stats) {
                if (stat == null || stat.getQuestionId() == null) continue;
                long total = stat.getTotalCount() != null ? stat.getTotalCount() : 0L;
                if (total <= 0) continue;
                long correct = stat.getCorrectCount() != null ? stat.getCorrectCount() : 0L;
                out.put(stat.getQuestionId(), Math.round(correct * 1000.0 / total) / 10.0);
            }
        } catch (Exception e) {
            log.warn("AI report: could not load per-question class stats for assessment {}: {}",
                    assessmentId, e.getMessage());
        }
        return out;
    }

    /** Registration name first; the cohort leaderboard is the only other place a display name exists. */
    private String resolveStudentName(AssessmentUserRegistration registration, ReportClassContext ctx, String attemptId) {
        if (registration != null && registration.getParticipantName() != null
                && !registration.getParticipantName().isBlank()) {
            return registration.getParticipantName();
        }
        if (ctx == null || ctx.getFullLeaderboard() == null || attemptId == null) {
            return null;
        }
        return ctx.getFullLeaderboard().stream()
                .filter(row -> row != null && attemptId.equals(row.getAttemptId()))
                .map(LeaderBoardDto::getStudentName)
                .filter(name -> name != null && !name.isBlank())
                .findFirst()
                .orElse(null);
    }

    private String resolveAttemptUserId(String attemptId) {
        try {
            return studentAttemptRepository.findById(attemptId)
                    .map(StudentAttempt::getRegistration)
                    .map(AssessmentUserRegistration::getUserId)
                    .orElse(null);
        } catch (Exception e) {
            log.warn("Could not resolve the learner for attempt {}: {}", attemptId, e.getMessage());
            return null;
        }
    }

    // ==================================================================
    // Bulk Assessment Report Export (ZIP) — 6 orchestration methods (PR4)
    // ==================================================================

    private static final List<String> IN_FLIGHT_STATUSES =
            List.of(ReportExportJobStatus.PENDING.name(), ReportExportJobStatus.IN_PROGRESS.name());

    public ReportZipInitiateResponse initiateReportZipExport(CustomUserDetails user, ReportZipInitiateRequest req) {
        if (req == null || req.getAssessmentId() == null || req.getInstituteId() == null) {
            throw new VacademyException("Invalid Request");
        }

        // Double-click Initiate dedup: return the existing job rather than starting a second one.
        Optional<AssessmentReportExportJob> existing = reportExportJobRepository
                .findFirstByInstituteIdAndAssessmentIdAndCreatedByUserIdAndStatusInOrderByCreatedAtDesc(
                        req.getInstituteId(), req.getAssessmentId(), user.getUserId(), IN_FLIGHT_STATUSES);
        if (existing.isPresent()) {
            AssessmentReportExportJob job = existing.get();
            return ReportZipInitiateResponse.builder()
                    .jobId(job.getId())
                    .totalCount(job.getTotalCount())
                    .alreadyRunning(true)
                    .status(job.getStatus())
                    .build();
        }

        String requestJson;
        try {
            requestJson = new ObjectMapper().writeValueAsString(req);
        } catch (Exception e) {
            requestJson = null;
        }

        AssessmentReportExportJob job = reportExportJobFactory.createJob(user, req, user.getUserId(), requestJson);
        final String jobId = job.getId();

        // Dispatch deferred to afterCommit (precedent: AiEvaluationService) — the
        // worker's claimForRun races the INSERT on a different connection
        // otherwise, and always loses.
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    reportZipExportService.run(jobId, false);
                }
            });
        } else {
            reportZipExportService.run(jobId, false);
        }

        return ReportZipInitiateResponse.builder()
                .jobId(jobId)
                .totalCount(job.getTotalCount())
                .alreadyRunning(false)
                .status(job.getStatus())
                .build();
    }

    public ReportZipStatusResponse getReportZipExportStatus(CustomUserDetails user, String jobId, String instituteId) {
        AssessmentReportExportJob job = loadJobForInstitute(jobId, instituteId);

        List<AssessmentReportExportItem> items = reportExportItemRepository.findByJobIdOrderByCreatedAt(jobId);
        int remainingCount = (int) items.stream()
                .filter(i -> "PENDING".equals(i.getStatus())
                        || ("FAILED".equals(i.getStatus()) && (i.getRetryCount() == null || i.getRetryCount() < reportExportProperties.getMaxRetry())))
                .count();

        // LIVE progress, derived from item rows — NOT the job-row counters.
        // Each item result commits in its own REQUIRES_NEW transaction as it
        // happens, but the job counters are only checkpointed per BATCH: a
        // 3-student export is a single batch, so the counters jump 0 → 3 in
        // one write and the progress bar never moves. The items are already
        // loaded here, so deriving costs nothing extra.
        int liveCompleted = (int) items.stream().filter(i -> "DONE".equals(i.getStatus())).count();
        int liveFailed = (int) items.stream().filter(i -> "FAILED".equals(i.getStatus())).count();
        int liveSkipped = (int) items.stream().filter(i -> "SKIPPED".equals(i.getStatus())).count();

        // Stale IN_PROGRESS job (pod crash / dev restart) — write back so it
        // becomes claimable again; claimForRun does not accept IN_PROGRESS.
        // Two tiers, because "how long is suspicious" depends on where the
        // worker died:
        //  - Items still processable → generous window (worker may be mid-batch).
        //  - Nothing left to process → the worker was only assembling/finalizing,
        //    which is bounded by assembly-timeout. A restart between the last
        //    checkpoint and finalizeJob otherwise leaves the job frozen at
        //    "IN_PROGRESS, N of N completed" for the full stale window.
        if (ReportExportJobStatus.IN_PROGRESS.name().equals(job.getStatus()) && job.getUpdatedAt() != null) {
            long secondsSinceUpdate = (DateUtil.getCurrentUtcTime().getTime() - job.getUpdatedAt().getTime()) / 1000;
            boolean phaseADone = remainingCount == 0;
            long staleAfterSeconds = phaseADone
                    ? reportExportProperties.getAssemblyTimeoutSeconds()
                    : reportExportProperties.getStaleJobMinutes() * 60L;
            if (secondsSinceUpdate > staleAfterSeconds) {
                ReportExportJobStatus recovered;
                if (phaseADone && job.getOutputFileId() != null && liveFailed == 0) {
                    // Everything rendered and a ZIP exists — the worker died
                    // after doing all the work. This IS a completed export.
                    recovered = ReportExportJobStatus.COMPLETED;
                } else if (liveCompleted > 0) {
                    recovered = ReportExportJobStatus.PARTIAL;
                } else {
                    recovered = ReportExportJobStatus.FAILED;
                }
                job.setStatus(recovered.name());
                if (recovered != ReportExportJobStatus.COMPLETED) {
                    job.setErrorMessage("Worker appears to have terminated mid-run (no progress for "
                            + (secondsSinceUpdate / 60) + " min)");
                }
                job.setUpdatedAt(DateUtil.getCurrentUtcTime());
                job = reportExportJobRepository.save(job);
            }
        }
        boolean assemblable = items.stream().anyMatch(i -> "DONE".equals(i.getStatus()) && i.getFileId() != null);
        boolean resumable = Set.of(ReportExportJobStatus.PARTIAL.name(), ReportExportJobStatus.FAILED.name(),
                ReportExportJobStatus.CANCELLED.name()).contains(job.getStatus()) && remainingCount > 0;

        // Batched: this runs on every 2s poll, so a per-item findById would be
        // N queries per poll — one findAllById keeps it at a single query.
        List<AssessmentReportExportItem> doneItems = items.stream()
                .filter(i -> "DONE".equals(i.getStatus()) && i.getProcessedAt() != null)
                .toList();
        Map<String, Date> attemptUpdatedAt = new HashMap<>();
        if (!doneItems.isEmpty()) {
            studentAttemptRepository.findAllById(doneItems.stream()
                            .map(AssessmentReportExportItem::getAttemptId).toList())
                    .forEach(a -> {
                        if (a.getUpdatedAt() != null) attemptUpdatedAt.put(a.getId(), a.getUpdatedAt());
                    });
        }
        int staleItemCount = (int) doneItems.stream()
                .filter(i -> {
                    Date updated = attemptUpdatedAt.get(i.getAttemptId());
                    return updated != null && updated.after(i.getProcessedAt());
                })
                .count();

        List<ReportZipFailureDto> failures = items.stream()
                .filter(i -> "FAILED".equals(i.getStatus()))
                .limit(50)
                .map(i -> ReportZipFailureDto.builder()
                        .attemptId(i.getAttemptId())
                        .studentName(i.getStudentName())
                        .reason(i.getErrorMessage())
                        .retryCount(i.getRetryCount() != null ? i.getRetryCount() : 0)
                        .build())
                .toList();

        String downloadUrl = resolveDownloadUrl(job.getOutputFileId());

        return ReportZipStatusResponse.builder()
                .jobId(job.getId())
                .status(job.getStatus())
                .totalCount(job.getTotalCount())
                .completedCount(liveCompleted)
                .failedCount(liveFailed)
                .skippedCount(liveSkipped)
                .downloadUrl(downloadUrl)
                .outputFileName(job.getOutputFileName())
                .outputSizeBytes(job.getOutputSizeBytes())
                .errorMessage(job.getErrorMessage())
                .resumeCount(job.getResumeCount())
                .resumable(resumable)
                .remainingCount(remainingCount)
                .assemblable(assemblable)
                .staleItemCount(staleItemCount)
                .contextDrift(Boolean.TRUE.equals(job.getContextDrift()))
                .startedAt(job.getStartedAt())
                .completedAt(job.getCompletedAt())
                .updatedAt(job.getUpdatedAt())
                .failures(failures)
                .build();
    }

    public ReportZipContinueResponse continueReportZipExport(CustomUserDetails user, String jobId, String instituteId) {
        AssessmentReportExportJob job = loadJobForInstitute(jobId, instituteId);
        if (ReportExportJobStatus.IN_PROGRESS.name().equals(job.getStatus())
                || ReportExportJobStatus.COMPLETED.name().equals(job.getStatus())) {
            throw new VacademyException("Job " + jobId + " is " + job.getStatus() + " and cannot be continued");
        }

        int claimed = reportExportJobRepository.claimForRun(jobId,
                List.of(ReportExportJobStatus.PARTIAL.name(), ReportExportJobStatus.FAILED.name(),
                        ReportExportJobStatus.CANCELLED.name()));
        if (claimed == 0) {
            // Another thread/click already claimed it — return current state, not an error.
            AssessmentReportExportJob current = reportExportJobRepository.findById(jobId)
                    .orElseThrow(() -> new VacademyException("Export job not found: " + jobId));
            return ReportZipContinueResponse.builder()
                    .jobId(jobId)
                    .status(current.getStatus())
                    .remainingCount(reportExportItemRepository.findProcessable(jobId, reportExportProperties.getMaxRetry()).size())
                    .alreadyRunning(true)
                    .build();
        }

        // Re-fetch: claimForRun's native UPDATE just changed `status` in the DB
        // underneath the `job` entity loaded above (by loadJobForInstitute, in
        // its own earlier transaction). Saving the stale in-memory `job` here
        // would silently overwrite status back to its pre-claim value.
        AssessmentReportExportJob claimedJob = reportExportJobRepository.findById(jobId)
                .orElseThrow(() -> new VacademyException("Export job not found: " + jobId));
        claimedJob.setResumeCount((claimedJob.getResumeCount() == null ? 0 : claimedJob.getResumeCount()) + 1);
        reportExportJobRepository.save(claimedJob);

        // The endpoint already claimed the job above — the worker must NOT
        // re-claim (ARCHITECTURE.md §10 scenario (b): it would always lose that
        // race against itself).
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    reportZipExportService.run(jobId, true);
                }
            });
        } else {
            reportZipExportService.run(jobId, true);
        }

        int remaining = reportExportItemRepository.findProcessable(jobId, reportExportProperties.getMaxRetry()).size();
        return ReportZipContinueResponse.builder()
                .jobId(jobId)
                .status(ReportExportJobStatus.IN_PROGRESS.name())
                .remainingCount(remaining)
                .alreadyRunning(false)
                .build();
    }

    public ReportZipAssembleResponse assembleReportZipExport(CustomUserDetails user, String jobId, String instituteId) {
        loadJobForInstitute(jobId, instituteId); // ownership check
        ReportZipAssembleResponse response = reportZipAssemblyService.assemble(jobId);
        AssessmentReportExportJob job = reportExportJobRepository.findById(jobId).orElse(null);

        // If this assembly just covered EVERY item of a job stuck IN_PROGRESS
        // (worker killed between the last checkpoint and finalizeJob — e.g. a
        // restart), settle the status here instead of leaving the admin's
        // dialog polling a job that will never finalize itself. A live worker
        // can't be racing us: it only assembles after its items are done, and
        // it would then write the same terminal status.
        if (job != null && ReportExportJobStatus.IN_PROGRESS.name().equals(job.getStatus())) {
            long processable = reportExportItemRepository.findProcessable(jobId, reportExportProperties.getMaxRetry()).size();
            if (processable == 0) {
                boolean allDone = !response.isPartial()
                        && (job.getFailedCount() == null || job.getFailedCount() == 0);
                job.setStatus((allDone ? ReportExportJobStatus.COMPLETED : ReportExportJobStatus.PARTIAL).name());
                job.setCompletedAt(DateUtil.getCurrentUtcTime());
                job.setUpdatedAt(DateUtil.getCurrentUtcTime());
                job = reportExportJobRepository.save(job);
            }
        }

        String downloadUrl = job != null ? resolveDownloadUrl(job.getOutputFileId()) : null;
        response.setDownloadUrl(downloadUrl);
        return response;
    }

    public ReportZipRecentResponse getRecentReportZipExports(CustomUserDetails user, String assessmentId, String instituteId, int limit) {
        int pageSize = limit > 0 ? limit : 5;
        List<AssessmentReportExportJob> jobs = reportExportJobRepository
                .findByAssessmentIdAndInstituteIdOrderByCreatedAtDesc(assessmentId, instituteId,
                        org.springframework.data.domain.PageRequest.of(0, pageSize))
                .getContent();

        List<ReportZipJobSummaryDto> summaries = jobs.stream().map(job -> {
            int remaining = (int) reportExportItemRepository.findByJobIdOrderByCreatedAt(job.getId()).stream()
                    .filter(i -> "PENDING".equals(i.getStatus())
                            || ("FAILED".equals(i.getStatus()) && (i.getRetryCount() == null || i.getRetryCount() < reportExportProperties.getMaxRetry())))
                    .count();
            boolean resumable = Set.of(ReportExportJobStatus.PARTIAL.name(), ReportExportJobStatus.FAILED.name(),
                    ReportExportJobStatus.CANCELLED.name()).contains(job.getStatus()) && remaining > 0;
            boolean assemblable = job.getCompletedCount() != null && job.getCompletedCount() > 0;
            return ReportZipJobSummaryDto.builder()
                    .jobId(job.getId())
                    .status(job.getStatus())
                    .totalCount(job.getTotalCount())
                    .completedCount(job.getCompletedCount())
                    .failedCount(job.getFailedCount())
                    .outputFileName(job.getOutputFileName())
                    .downloadUrl(resolveDownloadUrl(job.getOutputFileId()))
                    .resumable(resumable)
                    .assemblable(assemblable)
                    .createdAt(job.getCreatedAt())
                    .completedAt(job.getCompletedAt())
                    .createdByUserId(job.getCreatedByUserId())
                    .build();
        }).toList();

        return ReportZipRecentResponse.builder().jobs(summaries).build();
    }

    public ReportZipCancelResponse cancelReportZipExport(CustomUserDetails user, String jobId, String instituteId) {
        AssessmentReportExportJob job = loadJobForInstitute(jobId, instituteId);
        if (Set.of(ReportExportJobStatus.COMPLETED.name(), ReportExportJobStatus.FAILED.name(),
                ReportExportJobStatus.CANCELLED.name()).contains(job.getStatus())) {
            throw new VacademyException("Job " + jobId + " is already terminal (" + job.getStatus() + ")");
        }
        job.setStatus(ReportExportJobStatus.CANCELLED.name());
        job.setUpdatedAt(DateUtil.getCurrentUtcTime());
        reportExportJobRepository.save(job);
        return ReportZipCancelResponse.builder()
                .jobId(jobId)
                .status(ReportExportJobStatus.CANCELLED.name())
                .cancelled(true)
                .build();
    }

    private AssessmentReportExportJob loadJobForInstitute(String jobId, String instituteId) {
        AssessmentReportExportJob job = reportExportJobRepository.findById(jobId)
                .orElseThrow(() -> new VacademyException("Export job not found: " + jobId));
        if (!job.getInstituteId().equals(instituteId)) {
            throw new VacademyException("Export job does not belong to this institute");
        }
        return job;
    }

    // Resolved fresh on every call — the media service hardcodes a 1-day
    // presign expiry (plan C10), so a stored URL would silently expire.
    private String resolveDownloadUrl(String outputFileId) {
        if (outputFileId == null) return null;
        try {
            return fileService.getPublicUrlForFileId(outputFileId);
        } catch (Exception e) {
            log.warn("[report-export] Failed to resolve download URL for file {}: {}", outputFileId, e.getMessage());
            return null;
        }
    }
}
