package vacademy.io.admin_core_service.features.telleo.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PreDestroy;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.institute.setting_history.InstituteSettingWriter;
import vacademy.io.admin_core_service.features.capabilities.service.DisplaySettingsFormat;
import vacademy.io.admin_core_service.features.telephony.core.AiAgentAssistService;
import vacademy.io.admin_core_service.features.telephony.core.AiAgentService;
import vacademy.io.admin_core_service.features.telephony.core.AiAgentTestCallService;
import vacademy.io.admin_core_service.features.telephony.core.AiCallingSettingsMutator;
import vacademy.io.admin_core_service.features.telephony.core.TtsVoiceCatalog;
import vacademy.io.admin_core_service.features.telephony.core.dto.AiAgentDTO;
import vacademy.io.admin_core_service.features.telephony.core.dto.AiCallResponseDTO;
import vacademy.io.admin_core_service.features.telephony.enums.ProviderType;
import vacademy.io.admin_core_service.features.telleo.dto.TelleoAnswersDTO;
import vacademy.io.admin_core_service.features.telleo.dto.TelleoOnboardingStatusDTO;
import vacademy.io.admin_core_service.features.telleo.service.TelleoAgentDraftBuilder.AgentDraft;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.Institute;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;

/**
 * The step after a Telleo sign-up: the user answers a few business questions, and the account is
 * set up from them in three idempotent steps.
 * <ol>
 *   <li>line: the shared trial line ({@link TelleoLineService});</li>
 *   <li>settings: AI calling on Telleo's engine, and the four-page dashboard
 *       ({@link TelleoDisplaySettings});</li>
 *   <li>agent: a draft agent written from the answers, or a fixed template when the writer
 *       fails, made the account's default so the lead list's call button works.</li>
 * </ol>
 * Then "Call me now" rings the phone the user verified at sign-up.
 *
 * <p>The answers are saved before anything runs, so someone who leaves mid-way is still a lead
 * and resumes on their next login. A step that failed is retried by submitting again.
 */
@Slf4j
@Service
public class TelleoOnboardingService {

    public static final String NEW = "NEW";
    public static final String RUNNING = "RUNNING";
    public static final String READY = "READY";
    public static final String FAILED = "FAILED";
    static final String STEP_PENDING = "PENDING";
    static final String STEP_DONE = "DONE";
    static final String STEP_FAILED = "FAILED";

    /** A run older than this belongs to a pod that died mid-way and may be started again. */
    private static final int STALE_RUN_MINUTES = 10;
    private static final String ACTOR = "telleo-onboarding";

    private final NamedParameterJdbcTemplate jdbc;
    private final TelleoTrialService trialService;
    private final TelleoLineService lineService;
    private final AiCallingSettingsMutator settingsMutator;
    private final InstituteRepository instituteRepository;
    private final InstituteSettingWriter settingWriter;
    private final AiAgentAssistService assistService;
    private final AiAgentService agentService;
    private final AiAgentTestCallService testCallService;
    private final TransactionTemplate tx;
    private final ObjectMapper mapper = new ObjectMapper();
    /** Small and bounded: a draft can take a minute, and sign-ups are not bursty. */
    private final ExecutorService executor = Executors.newFixedThreadPool(2, r -> {
        Thread t = new Thread(r, "telleo-onboarding");
        t.setDaemon(true);
        return t;
    });

    public TelleoOnboardingService(NamedParameterJdbcTemplate jdbc, TelleoTrialService trialService,
                                   TelleoLineService lineService, AiCallingSettingsMutator settingsMutator,
                                   InstituteRepository instituteRepository, InstituteSettingWriter settingWriter,
                                   AiAgentAssistService assistService, AiAgentService agentService,
                                   AiAgentTestCallService testCallService, PlatformTransactionManager txManager) {
        this.jdbc = jdbc;
        this.trialService = trialService;
        this.lineService = lineService;
        this.settingsMutator = settingsMutator;
        this.instituteRepository = instituteRepository;
        this.settingWriter = settingWriter;
        this.assistService = assistService;
        this.agentService = agentService;
        this.testCallService = testCallService;
        this.tx = new TransactionTemplate(txManager);
    }

    @PreDestroy
    void shutdown() {
        executor.shutdownNow();
    }

    // ── Reads ───────────────────────────────────────────────────────────────────

    public TelleoOnboardingStatusDTO status(String instituteId) {
        TelleoTrialService.TrialInfo trial = requireTelleo(instituteId);
        Optional<Row> row = row(instituteId);
        TelleoOnboardingStatusDTO.TelleoOnboardingStatusDTOBuilder out = TelleoOnboardingStatusDTO.builder()
                .instituteId(instituteId)
                .verifiedPhone(trial.phoneE164())
                .trialEndsAt(trial.trialEndsAt() == null ? null : trial.trialEndsAt().toString());
        if (row.isEmpty()) {
            return out.status(NEW).lineStatus(STEP_PENDING).settingsStatus(STEP_PENDING)
                    .agentStatus(STEP_PENDING).build();
        }
        Row r = row.get();
        return out.status(r.stale() ? FAILED : r.status())
                .lineStatus(r.lineStatus())
                .settingsStatus(r.settingsStatus())
                .agentStatus(r.agentStatus())
                .agentId(r.agentId())
                .agentSource(r.agentSource())
                .error(r.stale() ? "Setting up took too long. Try again." : r.error())
                .answers(readAnswers(r.answers()))
                .build();
    }

    // ── Writes ──────────────────────────────────────────────────────────────────

    /** Saves the answers and starts (or resumes) setting the account up in the background. */
    public TelleoOnboardingStatusDTO submit(String instituteId, TelleoAnswersDTO answers) {
        requireTelleo(instituteId);
        TelleoAnswersDTO clean = TelleoAgentDraftBuilder.clean(answers);
        jdbc.update("""
                INSERT INTO telleo_onboarding (institute_id, answers) VALUES (:id, :a)
                ON CONFLICT (institute_id) DO UPDATE SET answers = EXCLUDED.answers, updated_at = now()
                """, new MapSqlParameterSource().addValue("id", instituteId).addValue("a", writeAnswers(clean)));
        start(instituteId);
        return status(instituteId);
    }

    /** Runs the steps that are not done yet with the saved answers. */
    public TelleoOnboardingStatusDTO retry(String instituteId) {
        requireTelleo(instituteId);
        if (row(instituteId).map(Row::answers).orElse(null) == null) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "Answer the questions first.");
        }
        start(instituteId);
        return status(instituteId);
    }

    /** "Call me now": the draft agent rings the phone verified at sign-up. */
    public AiCallResponseDTO callMe(String instituteId, String userName, String actorUserId) {
        TelleoTrialService.TrialInfo trial = requireTelleo(instituteId);
        String agentId = row(instituteId).map(Row::agentId).orElse(null);
        if (agentId == null || agentService.find(agentId, instituteId).isEmpty()) {
            throw new VacademyException(HttpStatus.CONFLICT, "Your agent is not ready yet.");
        }
        if (trial.phoneE164() == null) {
            throw new VacademyException(HttpStatus.CONFLICT, "No verified phone number on this account.");
        }
        return testCallService.place(instituteId, agentId,
                new AiAgentTestCallService.TestCallInput(trial.phoneE164(), userName, null), actorUserId);
    }

    // ── The run ─────────────────────────────────────────────────────────────────

    private void start(String instituteId) {
        // Claims the run: only one at a time per institute, unless the last one went stale.
        int claimed = jdbc.update("""
                UPDATE telleo_onboarding SET status = 'RUNNING', error = NULL, updated_at = now()
                 WHERE institute_id = :id
                   AND (status <> 'RUNNING' OR updated_at < now() - make_interval(mins => :stale))
                """, new MapSqlParameterSource().addValue("id", instituteId).addValue("stale", STALE_RUN_MINUTES));
        if (claimed == 0) return;
        try {
            executor.submit(() -> run(instituteId));
        } catch (RejectedExecutionException e) {
            finish(instituteId, FAILED, "The server is busy. Try again in a minute.");
        }
    }

    void run(String instituteId) {
        Row r = row(instituteId).orElse(null);
        if (r == null) return;
        TelleoAnswersDTO answers = readAnswers(r.answers());
        if (answers == null) {
            finish(instituteId, FAILED, "Answer the questions first.");
            return;
        }
        String firstError = null;

        if (!STEP_DONE.equals(r.lineStatus())) {
            firstError = step(instituteId, "line_status", () -> lineService.attachTrialLine(instituteId), firstError);
        }
        if (!STEP_DONE.equals(r.settingsStatus())) {
            firstError = step(instituteId, "settings_status", () -> applySettings(instituteId), firstError);
        }
        if (!STEP_DONE.equals(r.agentStatus()) || r.agentId() == null
                || agentService.find(r.agentId(), instituteId).isEmpty()) {
            firstError = step(instituteId, "agent_status", () -> createAgent(instituteId, answers), firstError);
        }
        finish(instituteId, firstError == null ? READY : FAILED, firstError);
    }

    private String step(String instituteId, String column, Runnable work, String firstError) {
        try {
            work.run();
            setStep(instituteId, column, STEP_DONE);
            return firstError;
        } catch (Exception e) {
            log.warn("[telleo] onboarding step {} failed for institute {}: {}", column, instituteId, e.getMessage());
            setStep(instituteId, column, STEP_FAILED);
            return firstError != null ? firstError : friendly(column, e);
        }
    }

    /** AI calling on Telleo's engine, and the four-page dashboard unless the admin already has one. */
    void applySettings(String instituteId) {
        InstituteSettingWriter.Actor actor = InstituteSettingWriter.Actor.platform(ACTOR, "Telleo onboarding");
        settingsMutator.update(instituteId, data -> {
            if (!data.hasNonNull("provider") || data.get("provider").asText().isBlank()) {
                data.put("provider", ProviderType.VACADEMY_AI);
            }
        }, actor);
        tx.executeWithoutResult(s -> {
            Institute institute = instituteRepository.findById(instituteId)
                    .orElseThrow(() -> new IllegalStateException("Institute not found"));
            Map<String, ?> existing = InstituteSettingWriter.settingNodes(institute.getSetting());
            if (!existing.containsKey(DisplaySettingsFormat.ADMIN_KEY)) {
                settingWriter.putSettingKey(institute, DisplaySettingsFormat.ADMIN_KEY,
                        TelleoDisplaySettings.adminEntry(), actor);
            }
        });
    }

    /** The draft agent, written from the answers; the template when the writer fails. */
    void createAgent(String instituteId, TelleoAnswersDTO a) {
        String company = instituteRepository.findById(instituteId).map(Institute::getInstituteName)
                .map(n -> n.replaceAll("[<>\\[\\]{}]", "").trim()).filter(n -> !n.isBlank()).orElse("our team");
        AgentDraft draft = null;
        String source = "TEMPLATE";
        try {
            String name = TelleoAgentDraftBuilder.agentName(a);
            Map<String, Object> result = assistService.draft(instituteId, TelleoAgentDraftBuilder.brief(a, company),
                    new AiAgentAssistService.AgentContext(name, a.getLanguage(), null,
                            a.getGoal().toLowerCase(), List.of(), List.of()));
            draft = TelleoAgentDraftBuilder.fromAssist(result, a, company);
            if (draft != null) source = "AI";
        } catch (Exception e) {
            log.info("[telleo] agent writer unavailable for institute {}, using the template: {}",
                    instituteId, e.getMessage());
        }
        if (draft == null) draft = TelleoAgentDraftBuilder.template(a, company);

        AiAgentDTO dto = new AiAgentDTO();
        dto.setInstituteId(instituteId);
        dto.setName(draft.name() + " (Draft)");
        dto.setEnabled(Boolean.TRUE);
        // Inbound needs a number of the account's own; trials have the shared line only.
        dto.setDirection("OUTBOUND");
        dto.setLanguage(a.getLanguage());
        dto.setTtsModel(TtsVoiceCatalog.NEW_AGENT_DEFAULT);
        dto.setVoice(TelleoAgentDraftBuilder.voiceFor(a.getLanguage(), a.getVoiceGender()));
        dto.setOpeningLine(draft.openingLine());
        dto.setSystemPrompt(draft.systemPrompt());
        dto.setExtractionQuestions(draft.extractionQuestions());
        dto.setDispositions(draft.dispositions());
        dto.setMaxCallMinutes(TelleoAgentDraftBuilder.TRIAL_MAX_CALL_MINUTES);
        AiAgentDTO saved = agentService.saveWithResult(dto, ACTOR).agent();

        // The registry bridge does not set the default, and with one agent and no numbers the
        // lead list's call button would otherwise dial with no campaign and fail.
        settingsMutator.update(instituteId, data -> {
            data.put("defaultCampaignId", saved.getId());
            if (!data.hasNonNull("provider") || data.get("provider").asText().isBlank()) {
                data.put("provider", ProviderType.VACADEMY_AI);
            }
        }, InstituteSettingWriter.Actor.platform(ACTOR, "Telleo onboarding: default agent"));

        jdbc.update("UPDATE telleo_onboarding SET agent_id = :a, agent_source = :s, updated_at = now() WHERE institute_id = :id",
                new MapSqlParameterSource().addValue("a", saved.getId()).addValue("s", source).addValue("id", instituteId));
        log.info("[telleo] draft agent {} ({}) created for institute {}", saved.getId(), source, instituteId);
    }

    // ── helpers ─────────────────────────────────────────────────────────────────

    private TelleoTrialService.TrialInfo requireTelleo(String instituteId) {
        return trialService.find(instituteId).orElseThrow(() ->
                new VacademyException(HttpStatus.NOT_FOUND, "This workspace was not created through Telleo sign-up."));
    }

    private record Row(String status, String lineStatus, String settingsStatus, String agentStatus,
                       String agentId, String agentSource, String error, String answers, boolean stale) {
    }

    private Optional<Row> row(String instituteId) {
        return jdbc.query("""
                SELECT status, line_status, settings_status, agent_status, agent_id, agent_source, error, answers,
                       (status = 'RUNNING' AND updated_at < now() - make_interval(mins => :stale)) AS stale
                  FROM telleo_onboarding WHERE institute_id = :id
                """, new MapSqlParameterSource().addValue("id", instituteId).addValue("stale", STALE_RUN_MINUTES),
                (rs, n) -> new Row(rs.getString("status"), rs.getString("line_status"),
                        rs.getString("settings_status"), rs.getString("agent_status"), rs.getString("agent_id"),
                        rs.getString("agent_source"), rs.getString("error"), rs.getString("answers"),
                        rs.getBoolean("stale")))
                .stream().findFirst();
    }

    private void setStep(String instituteId, String column, String value) {
        // column is one of three constants above, never user input.
        jdbc.update("UPDATE telleo_onboarding SET " + column + " = :v, updated_at = now() WHERE institute_id = :id",
                new MapSqlParameterSource().addValue("v", value).addValue("id", instituteId));
    }

    private void finish(String instituteId, String status, String error) {
        jdbc.update("UPDATE telleo_onboarding SET status = :s, error = :e, updated_at = now() WHERE institute_id = :id",
                new MapSqlParameterSource().addValue("s", status).addValue("e", error).addValue("id", instituteId));
    }

    private static String friendly(String column, Exception e) {
        return switch (column) {
            case "line_status" -> "We could not attach your trial calling line yet. Our team has been told; try again shortly.";
            case "settings_status" -> "We could not finish setting up your workspace. Try again.";
            default -> "We could not create your agent. Try again.";
        };
    }

    private String writeAnswers(TelleoAnswersDTO a) {
        try {
            return mapper.writeValueAsString(a);
        } catch (Exception e) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "Could not read your answers.");
        }
    }

    private TelleoAnswersDTO readAnswers(String json) {
        if (json == null || json.isBlank()) return null;
        try {
            return mapper.readValue(json, TelleoAnswersDTO.class);
        } catch (Exception e) {
            return null;
        }
    }
}
