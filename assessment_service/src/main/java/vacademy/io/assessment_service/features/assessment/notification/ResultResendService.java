package vacademy.io.assessment_service.features.assessment.notification;

import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.assessment.repository.StudentAttemptRepository;
import vacademy.io.assessment_service.features.assessment.service.aireport.AiReportPdfService;
import vacademy.io.common.media.service.FileService;

import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Sends the result email and/or WhatsApp again for attempts whose results are already
 * released, using the report PDF stored at release time. For when a WhatsApp template is
 * approved after the release, or an email needs resending. Runs in the background.
 */
@Slf4j
@Service
public class ResultResendService {

    private static final int BATCH = 5;

    private final JdbcTemplate jdbc;
    private final StudentAttemptRepository attempts;
    private final ResultNotificationService notifications;
    private final AiReportPdfService aiReportPdfService;
    private final FileService fileService;
    private final vacademy.io.assessment_service.features.assessment.service.ReportPdfUploadService uploads;
    private final vacademy.io.assessment_service.features.assessment.manager.AssessmentParticipantsManager participants;
    private final Map<String, Map<String, Object>> jobs = new ConcurrentHashMap<>();

    public ResultResendService(JdbcTemplate jdbc, StudentAttemptRepository attempts, ResultNotificationService notifications,
                               AiReportPdfService aiReportPdfService, FileService fileService,
                               vacademy.io.assessment_service.features.assessment.service.ReportPdfUploadService uploads,
                               @org.springframework.context.annotation.Lazy
                               vacademy.io.assessment_service.features.assessment.manager.AssessmentParticipantsManager participants) {
        this.jdbc = jdbc;
        this.attempts = attempts;
        this.notifications = notifications;
        this.aiReportPdfService = aiReportPdfService;
        this.fileService = fileService;
        this.uploads = uploads;
        this.participants = participants;
    }

    /**
     * Builds one attempt's report fresh and sends the result email / WhatsApp only to the
     * given address and number (not the learner), so staff can see exactly what learners get.
     *
     * @param whatsappTemplate optional template name to try before it is bound (e.g. just approved)
     */
    public Map<String, Object> testSend(String assessmentId, String instituteId, String attemptId,
                                        String email, String phone, String whatsappTemplate) throws Exception {
        StudentAttempt real = attempts.findById(attemptId).orElseThrow(() -> new IllegalArgumentException("Attempt not found"));
        var realReg = real.getRegistration();
        if (realReg == null || realReg.getAssessment() == null || !assessmentId.equals(realReg.getAssessment().getId())) {
            throw new IllegalArgumentException("Attempt is not part of this assessment");
        }
        var detail = participants.createStudentReportDetailResponse(assessmentId, attemptId, instituteId);
        var rendered = aiReportPdfService.renderWithVariables(realReg.getUserId(), assessmentId, attemptId, instituteId,
                detail, null);
        String fileId = uploads.upload(rendered.pdf(), "result_test_" + attemptId + ".pdf", "ASSESSMENT_REPORT_TEST", assessmentId);

        // A detached copy addressed to the tester; nothing is saved.
        var reg = new vacademy.io.assessment_service.features.assessment.entity.AssessmentUserRegistration();
        reg.setUserId(realReg.getUserId());
        reg.setParticipantName(realReg.getParticipantName());
        reg.setUserEmail(email);
        reg.setPhoneNumber(phone);
        reg.setSource(realReg.getSource());
        StudentAttempt copy = new StudentAttempt();
        copy.setId(attemptId);
        copy.setRegistration(reg);
        copy.setReportPdfFileId(fileId);
        List<ResultNotificationService.Item> items = List.of(new ResultNotificationService.Item(copy, rendered.pdf(), rendered.variables()));

        ResultNotificationService.Templates t = notifications.resolve(instituteId, assessmentId);
        if (whatsappTemplate != null && !whatsappTemplate.isBlank()) {
            t = new ResultNotificationService.Templates(t.email(), Map.of("name", whatsappTemplate, "setting_json", "{\"language_code\":\"en\"}"));
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("pdf_bytes", rendered.pdf().length);
        out.put("email_template", t.email() == null ? "built-in" : t.email().get("name"));
        out.put("whatsapp_template", t.whatsapp() == null ? null : t.whatsapp().get("name"));
        if (email != null && !email.isBlank()) {
            notifications.sendEmails(items, assessmentId, instituteId, t);
            out.put("email_sent_to", email);
        }
        if (phone != null && !phone.isBlank()) {
            out.put("whatsapp_accepted", notifications.sendWhatsApps(items, assessmentId, instituteId, t));
        }
        out.put("variables", rendered.variables());
        return out;
    }

    public Map<String, Object> status(String jobId) {
        return jobs.get(jobId);
    }

    /**
     * @param email      send the result email again (with the stored PDF)
     * @param whatsapp   send the bound WhatsApp template
     * @param attemptIds when given, only these attempts; else every released attempt with a stored report
     * @param dryRun     count only
     */
    public Map<String, Object> start(String assessmentId, String instituteId, boolean email, boolean whatsapp,
                                     Set<String> attemptIds, boolean dryRun) {
        List<String> ids = jdbc.queryForList("""
                SELECT x.id FROM (
                    SELECT sa.id, sa.report_release_status, sa.report_pdf_file_id,
                           ROW_NUMBER() OVER (PARTITION BY aur.user_id ORDER BY sa.created_at DESC) AS rn
                    FROM student_attempt sa JOIN assessment_user_registration aur ON aur.id = sa.registration_id
                    WHERE aur.assessment_id = ? AND aur.institute_id = ? AND sa.status = 'ENDED' AND aur.status = 'ACTIVE'
                ) x
                WHERE x.rn = 1 AND x.report_release_status = 'RELEASED' AND x.report_pdf_file_id IS NOT NULL
                """, String.class, assessmentId, instituteId);
        if (attemptIds != null && !attemptIds.isEmpty()) ids = ids.stream().filter(attemptIds::contains).toList();
        ResultNotificationService.Templates templates = notifications.resolve(instituteId, assessmentId);

        Map<String, Object> job = new ConcurrentHashMap<>();
        String jobId = UUID.randomUUID().toString();
        job.put("job_id", jobId);
        job.put("assessment_id", assessmentId);
        job.put("eligible", ids.size());
        job.put("dry_run", dryRun);
        job.put("email", email);
        job.put("whatsapp", whatsapp);
        job.put("email_template", templates.email() == null ? "built-in" : templates.email().get("name") + " (" + templates.email().get("level") + ")");
        job.put("whatsapp_template", templates.whatsapp() == null ? "none bound" : templates.whatsapp().get("name") + " (" + templates.whatsapp().get("level") + ")");
        job.put("state", dryRun ? "DONE" : "RUNNING");
        jobs.put(jobId, job);
        if (dryRun) return job;

        final List<String> todo = ids;
        AtomicInteger done = new AtomicInteger(), emailed = new AtomicInteger(), whatsapped = new AtomicInteger(), failed = new AtomicInteger();
        job.put("done", done);
        job.put("emailed", emailed);
        job.put("whatsapp_sent", whatsapped);
        job.put("failed", failed);
        Thread t = new Thread(() -> {
            List<ResultNotificationService.Item> batch = new ArrayList<>();
            for (String id : todo) {
                try {
                    StudentAttempt attempt = attempts.findById(id).orElse(null);
                    if (attempt == null || attempt.getRegistration() == null) continue;
                    String userId = attempt.getRegistration().getUserId();
                    byte[] pdf = email ? fileService.getFileFromFileId(attempt.getReportPdfFileId()) : null;
                    Map<String, String> vars = aiReportPdfService.variables(userId, assessmentId, id, instituteId, null, null, null);
                    batch.add(new ResultNotificationService.Item(attempt, pdf, vars));
                } catch (Exception e) {
                    failed.incrementAndGet();
                    log.warn("[result-resend] attempt {} skipped: {}", id, e.getMessage());
                }
                if (batch.size() >= BATCH) flush(batch, assessmentId, instituteId, email, whatsapp, templates, emailed, whatsapped, done);
            }
            flush(batch, assessmentId, instituteId, email, whatsapp, templates, emailed, whatsapped, done);
            job.put("state", "DONE");
            log.info("[result-resend] job {} done: {}", jobId, job);
        }, "result-resend-" + jobId.substring(0, 8));
        t.setDaemon(true);
        t.start();
        return job;
    }

    private void flush(List<ResultNotificationService.Item> batch, String assessmentId, String instituteId, boolean email,
                       boolean whatsapp, ResultNotificationService.Templates templates, AtomicInteger emailed,
                       AtomicInteger whatsapped, AtomicInteger done) {
        if (batch.isEmpty()) return;
        if (email) {
            try {
                notifications.sendEmails(batch, assessmentId, instituteId, templates);
                emailed.addAndGet(batch.size());
            } catch (Exception e) {
                log.warn("[result-resend] email batch failed: {}", e.getMessage());
            }
        }
        if (whatsapp) {
            try {
                whatsapped.addAndGet(notifications.sendWhatsApps(batch, assessmentId, instituteId, templates));
            } catch (Exception e) {
                log.warn("[result-resend] WhatsApp batch failed: {}", e.getMessage());
            }
        }
        done.addAndGet(batch.size());
        batch.clear();
    }
}
