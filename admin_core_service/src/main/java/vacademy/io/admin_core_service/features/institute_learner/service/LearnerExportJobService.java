package vacademy.io.admin_core_service.features.institute_learner.service;

import com.fasterxml.jackson.core.JsonGenerator;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PreDestroy;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.institute_learner.dto.StudentV2DTO;
import vacademy.io.admin_core_service.features.institute_learner.dto.student_list_dto.AllStudentV2Response;
import vacademy.io.admin_core_service.features.institute_learner.dto.student_list_dto.LearnerExportJobDTO;
import vacademy.io.admin_core_service.features.institute_learner.dto.student_list_dto.StudentListFilter;
import vacademy.io.admin_core_service.features.institute_learner.manager.StudentListManager;
import vacademy.io.admin_core_service.features.media_service.service.MediaService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ForbiddenException;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.media.dto.FileDetailsDTO;
import vacademy.io.common.media.dto.InMemoryMultipartFile;

import java.io.ByteArrayOutputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.zip.GZIPOutputStream;

/**
 * Learner-list export that runs on the server instead of the browser paging the list.
 *
 * The browser starts a job with the same filter body it sends to get/v2/all. A background
 * thread pages through StudentListManager.getLinkedStudentsV2 (same filters, same faculty
 * and sub-org scoping, same row shape) and writes the rows as one gzipped JSON array to the
 * private bucket. No gateway timeout applies to a background thread, so a slow page only
 * makes the job take longer. The browser polls the job and then builds the CSV from that
 * file with the existing client-side column logic, so the CSV looks the same as before.
 *
 * Job state lives in learner_export_job because the poll can land on any replica.
 */
@Slf4j
@Service
public class LearnerExportJobService {

    public static final String STATUS_QUEUED = "QUEUED";
    public static final String STATUS_RUNNING = "RUNNING";
    public static final String STATUS_COMPLETED = "COMPLETED";
    public static final String STATUS_FAILED = "FAILED";

    /** Rows per internal page. No gateway sits in between, so this can be larger than the UI page. */
    static final int PAGE_SIZE = 2000;
    /** Runaway-loop guard only (10M rows), not a row cap. */
    static final int MAX_PAGES = 5000;
    /** A RUNNING job writes progress every page. Silence this long means its replica died. */
    static final Duration RUNNING_STALE_AFTER = Duration.ofMinutes(10);
    /** A QUEUED job waits behind at most a couple of others before it starts. */
    static final Duration QUEUED_STALE_AFTER = Duration.ofMinutes(30);

    @Autowired
    private JdbcTemplate jdbcTemplate;
    @Autowired
    private ObjectMapper objectMapper;
    @Autowired
    private StudentListManager studentListManager;
    @Autowired
    private MediaService mediaService;
    @Autowired
    private InstituteAccessValidator instituteAccessValidator;

    /** Two exports at a time per replica, so a burst cannot crowd out the list queries. */
    private final ExecutorService executor = Executors.newFixedThreadPool(2, new java.util.concurrent.ThreadFactory() {
        private final AtomicInteger n = new AtomicInteger();

        @Override
        public Thread newThread(Runnable r) {
            Thread t = new Thread(r, "learner-export-" + n.incrementAndGet());
            t.setDaemon(true);
            return t;
        }
    });

    private final HttpClient httpClient = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(20))
            .followRedirects(HttpClient.Redirect.NORMAL)
            .build();

    @PreDestroy
    void shutdown() {
        executor.shutdownNow();
    }

    /** Validates access, stores the job and queues it. Runs on the request thread. */
    public LearnerExportJobDTO start(CustomUserDetails user, StudentListFilter filter) {
        if (filter == null || filter.getInstituteIds() == null || filter.getInstituteIds().isEmpty()
                || !StringUtils.hasText(filter.getInstituteIds().get(0))) {
            throw new VacademyException("institute_ids is required");
        }
        String instituteId = filter.getInstituteIds().get(0);
        instituteAccessValidator.requireStaffAccess(user, instituteId);

        String filterJson;
        try {
            filterJson = objectMapper.writeValueAsString(filter);
        } catch (Exception e) {
            throw new VacademyException("Could not read the export filters");
        }
        // Captured now: the background thread has no request to read the JWT from.
        Map<String, Object> jwtAuthorities = studentListManager.captureCallerJwtAuthorities();

        String jobId = UUID.randomUUID().toString();
        jdbcTemplate.update(
                "INSERT INTO learner_export_job (id, institute_id, requested_by, status, filter_json) "
                        + "VALUES (?, ?, ?, ?, ?)",
                jobId, instituteId, user.getUserId(), STATUS_QUEUED, filterJson);

        executor.submit(() -> run(jobId, user, filterJson, jwtAuthorities));
        return get(user, jobId);
    }

    /** Current state of a job. Only the person who started it can read it. */
    public LearnerExportJobDTO get(CustomUserDetails user, String jobId) {
        List<LearnerExportJobDTO> rows = jdbcTemplate.query(
                "SELECT id, requested_by, status, processed_rows, total_rows, file_id, error_message "
                        + "FROM learner_export_job WHERE id = ?",
                (rs, i) -> {
                    LearnerExportJobDTO dto = new LearnerExportJobDTO();
                    dto.setJobId(rs.getString("id"));
                    dto.setRequestedBy(rs.getString("requested_by"));
                    dto.setStatus(rs.getString("status"));
                    dto.setProcessedRows(rs.getInt("processed_rows"));
                    int total = rs.getInt("total_rows");
                    dto.setTotalRows(rs.wasNull() ? null : total);
                    dto.setFileReady(StringUtils.hasText(rs.getString("file_id")));
                    dto.setErrorMessage(rs.getString("error_message"));
                    return dto;
                },
                jobId);
        if (rows.isEmpty()) {
            throw new VacademyException("Export job not found");
        }
        LearnerExportJobDTO dto = rows.get(0);
        if (!user.isRootUser() && !dto.getRequestedBy().equals(user.getUserId())) {
            throw new ForbiddenException("Access denied: not your export");
        }
        markIfStale(dto);
        return dto;
    }

    /** The finished export as gzipped JSON bytes, fetched from the private bucket. */
    public byte[] download(CustomUserDetails user, String jobId) {
        LearnerExportJobDTO job = get(user, jobId);
        if (!STATUS_COMPLETED.equals(job.getStatus()) || !job.isFileReady()) {
            throw new VacademyException("Export is not ready yet");
        }
        String fileId = jdbcTemplate.queryForObject(
                "SELECT file_id FROM learner_export_job WHERE id = ?", String.class, jobId);
        String url = mediaService.getFileUrlById(fileId);
        if (!StringUtils.hasText(url)) {
            throw new VacademyException("Export file is missing");
        }
        try {
            HttpResponse<byte[]> response = httpClient.send(
                    HttpRequest.newBuilder(URI.create(url.trim())).timeout(Duration.ofMinutes(2)).GET().build(),
                    HttpResponse.BodyHandlers.ofByteArray());
            if (response.statusCode() / 100 != 2) {
                throw new VacademyException("Could not read the export file (" + response.statusCode() + ")");
            }
            return response.body();
        } catch (VacademyException e) {
            throw e;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new VacademyException("Could not read the export file");
        } catch (Exception e) {
            throw new VacademyException("Could not read the export file");
        }
    }

    /**
     * A job whose replica died never finishes, so a silent one is failed on read. The age
     * is compared inside Postgres (now() against updated_at, both database time) so a JVM
     * running in another time zone cannot misjudge it.
     */
    private void markIfStale(LearnerExportJobDTO dto) {
        if (!STATUS_RUNNING.equals(dto.getStatus()) && !STATUS_QUEUED.equals(dto.getStatus())) return;
        String message = "The export was interrupted. Please start it again.";
        int updated = jdbcTemplate.update(
                "UPDATE learner_export_job SET status = ?, error_message = ?, updated_at = now() "
                        + "WHERE id = ? AND ((status = ? AND updated_at < now() - make_interval(mins => ?)) "
                        + "OR (status = ? AND updated_at < now() - make_interval(mins => ?)))",
                STATUS_FAILED, message, dto.getJobId(),
                STATUS_RUNNING, (int) RUNNING_STALE_AFTER.toMinutes(),
                STATUS_QUEUED, (int) QUEUED_STALE_AFTER.toMinutes());
        if (updated > 0) {
            dto.setStatus(STATUS_FAILED);
            dto.setErrorMessage(message);
        }
    }

    /** The background work: page through the list, stream rows into gzipped JSON, upload. */
    void run(String jobId, CustomUserDetails user, String filterJson, Map<String, Object> jwtAuthorities) {
        try {
            int started = jdbcTemplate.update(
                    "UPDATE learner_export_job SET status = ?, updated_at = now() WHERE id = ? AND status = ?",
                    STATUS_RUNNING, jobId, STATUS_QUEUED);
            if (started == 0) {
                return; // already failed as stale while it waited
            }

            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            int written = 0;
            Long total = null;
            try (GZIPOutputStream gzip = new GZIPOutputStream(buffer);
                 JsonGenerator json = objectMapper.getFactory().createGenerator(gzip)) {
                json.writeStartArray();
                for (int pageNo = 0; pageNo < MAX_PAGES; pageNo++) {
                    // A fresh filter per page: getLinkedStudentsV2 rewrites the filter it is given
                    // (access scoping, custom-field sort, resolved id sets).
                    StudentListFilter pageFilter = objectMapper.readValue(filterJson, StudentListFilter.class);
                    final int page = pageNo;
                    AllStudentV2Response response = studentListManager.runWithCallerJwtAuthorities(
                            jwtAuthorities,
                            () -> studentListManager.getLinkedStudentsV2(user, pageFilter, page, PAGE_SIZE).getBody());
                    if (response == null) break;
                    List<StudentV2DTO> content = response.getContent() == null ? List.of() : response.getContent();
                    for (StudentV2DTO row : content) {
                        json.writeObject(row);
                    }
                    written += content.size();
                    total = response.getTotalElements();
                    jdbcTemplate.update(
                            "UPDATE learner_export_job SET processed_rows = ?, total_rows = ?, updated_at = now() "
                                    + "WHERE id = ?",
                            written, total.intValue(), jobId);
                    // Only the server last flag ends it. A page can be short mid-list.
                    if (response.isLast() || content.isEmpty()) break;
                }
                json.writeEndArray();
            }

            byte[] bytes = buffer.toByteArray();
            String fileName = "learner-export-" + jobId + ".json.gz";
            FileDetailsDTO stored = mediaService.uploadPrivateFileV2(
                    new InMemoryMultipartFile(fileName, fileName, "application/gzip", bytes));
            if (stored == null || !StringUtils.hasText(stored.getId())) {
                throw new IllegalStateException("upload returned no file id");
            }
            jdbcTemplate.update(
                    "UPDATE learner_export_job SET status = ?, file_id = ?, processed_rows = ?, total_rows = ?, "
                            + "updated_at = now(), completed_at = now() WHERE id = ?",
                    STATUS_COMPLETED, stored.getId(), written, total == null ? written : total.intValue(), jobId);
            log.info("Learner export {} done: {} rows, {} bytes gzipped", jobId, written, bytes.length);
        } catch (Exception e) {
            log.error("Learner export {} failed", jobId, e);
            jdbcTemplate.update(
                    "UPDATE learner_export_job SET status = ?, error_message = ?, updated_at = now() WHERE id = ?",
                    STATUS_FAILED, "The export failed on the server. Please try again.", jobId);
        }
    }
}
