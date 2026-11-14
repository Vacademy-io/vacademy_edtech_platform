package vacademy.io.community_service.feature.appregistry.build;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.RequestEntity;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestTemplate;

import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * GitHub side of the dashboard's iOS build: starts {@code ios-white-label-build.yml} and reads
 * back its runs, steps and the new-target PR.
 *
 * <p><b>One server-side token, not per-person GitHub logins.</b> Whoever presses "Build" on the
 * dashboard only needs their dashboard (super-admin) login; the dispatch goes out with
 * {@code APP_BUILD_GITHUB_TOKEN} — a fine-grained token limited to this one repository with
 * Actions read/write, Contents read and Pull requests read. It lives in the k8s secret, never in a
 * browser.
 *
 * <p><b>No callback from the runner.</b> The repository is public, so workflow inputs and logs
 * are public too; a callback token would have to travel through them. Instead the run is found
 * again by its run-name ({@code app:<registry id> … req:<request id>}) and its state is read from
 * the Actions API, and the uploaded binary is read from App Store Connect.
 */
@Slf4j
@Component
public class GitHubActionsClient {

    private static final String API = "https://api.github.com";

    private final String token;
    private final String repo;
    private final String workflow;
    private final String ref;
    private final RestTemplate restTemplate = BuildHttp.restTemplate();
    private final ObjectMapper objectMapper = new ObjectMapper();

    public GitHubActionsClient(@Value("${APP_BUILD_GITHUB_TOKEN:}") String token,
                               @Value("${appregistry.build.github-repo:Vacademy-io/vacademy_edtech_platform}") String repo,
                               @Value("${appregistry.build.workflow:ios-white-label-build.yml}") String workflow,
                               @Value("${appregistry.build.ref:main}") String ref) {
        this.token = token;
        this.repo = repo;
        this.workflow = workflow;
        this.ref = ref;
    }

    public boolean isConfigured() {
        return StringUtils.hasText(token);
    }

    public String repo() {
        return repo;
    }

    public String workflowUrl() {
        return "https://github.com/" + repo + "/actions/workflows/" + workflow;
    }

    /** @return the new run's id and page when GitHub returns them (newer API), else nulls. */
    public record Dispatch(Long runId, String htmlUrl) {
    }

    public Dispatch dispatch(Map<String, String> inputs) throws Exception {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("ref", ref);
        body.put("inputs", inputs);
        body.put("return_run_details", true);
        String path = "/repos/" + repo + "/actions/workflows/" + workflow + "/dispatches";
        ResponseEntity<String> response;
        try {
            response = exchange(HttpMethod.POST, path, objectMapper.writeValueAsString(body), null);
        } catch (HttpClientErrorException e) {
            // return_run_details is a newer field; if GitHub rejects it, start the run without it.
            // The run is still found by its run-name, only the immediate link is lost.
            if (e.getStatusCode().value() != 422 || !e.getResponseBodyAsString().contains("return_run_details")) {
                throw e;
            }
            body.remove("return_run_details");
            response = exchange(HttpMethod.POST, path, objectMapper.writeValueAsString(body), null);
        }
        if (response.getStatusCode() == HttpStatus.OK && StringUtils.hasText(response.getBody())) {
            JsonNode json = objectMapper.readTree(response.getBody());
            long runId = json.path("workflow_run_id").asLong(0);
            return new Dispatch(runId == 0 ? null : runId, json.path("html_url").asText(null));
        }
        return new Dispatch(null, null);
    }

    public record Run(long id, String title, String status, String conclusion, String htmlUrl,
                      String createdAt, String updatedAt) {
        public boolean active() {
            return !"completed".equals(status);
        }
    }

    /** Runs of the build workflow started for this registry app, newest first. */
    public List<Run> listRuns(String registryAppId, int max) throws Exception {
        JsonNode runs = getJson("/repos/" + repo + "/actions/workflows/" + workflow
                + "/runs?event=workflow_dispatch&per_page=60").path("workflow_runs");
        String marker = "app:" + registryAppId + " ";
        List<Run> out = new ArrayList<>();
        for (JsonNode run : runs) {
            String title = run.path("display_title").asText(run.path("name").asText(""));
            if (!title.contains(marker)) {
                continue;
            }
            out.add(new Run(run.path("id").asLong(), title, run.path("status").asText(""),
                    run.path("conclusion").asText(""), run.path("html_url").asText(""),
                    run.path("created_at").asText(""), run.path("updated_at").asText("")));
            if (out.size() >= max) {
                break;
            }
        }
        return out;
    }

    public record Step(String name, String status, String conclusion) {
    }

    public List<Step> steps(long runId) throws Exception {
        List<Step> out = new ArrayList<>();
        JsonNode jobs = getJson("/repos/" + repo + "/actions/runs/" + runId + "/jobs").path("jobs");
        if (jobs.isEmpty()) {
            return out;
        }
        for (JsonNode step : jobs.get(0).path("steps")) {
            String name = step.path("name").asText("");
            if (name.startsWith("Set up job") || name.startsWith("Post ") || name.startsWith("Complete job")) {
                continue;
            }
            out.add(new Step(name, step.path("status").asText(""), step.path("conclusion").asText("")));
        }
        return out;
    }

    public record PullRequest(int number, String htmlUrl, String state, boolean merged) {
    }

    /** The PR the workflow opens for a brand-new target (branch {@code ios-brand/<bundle id>}). */
    public PullRequest findTargetPr(String bundleId) throws Exception {
        String owner = repo.substring(0, repo.indexOf('/'));
        JsonNode prs = getJson("/repos/" + repo + "/pulls?state=all&per_page=1&head="
                + URLEncoder.encode(owner + ":ios-brand/" + bundleId, StandardCharsets.UTF_8));
        if (!prs.isArray() || prs.isEmpty()) {
            return null;
        }
        JsonNode pr = prs.get(0);
        return new PullRequest(pr.path("number").asInt(), pr.path("html_url").asText(""),
                pr.path("state").asText(""), StringUtils.hasText(pr.path("merged_at").asText("")));
    }

    /** @return whether the file on the build ref contains {@code needle}. */
    public boolean fileContains(String path, String needle) throws Exception {
        ResponseEntity<String> response = exchange(HttpMethod.GET,
                "/repos/" + repo + "/contents/" + path + "?ref=" + ref, null, "application/vnd.github.raw");
        return response.getBody() != null && response.getBody().contains(needle);
    }

    /* ------------------------------------------------------------------ internals */

    private JsonNode getJson(String path) throws Exception {
        return objectMapper.readTree(exchange(HttpMethod.GET, path, null, null).getBody());
    }

    private ResponseEntity<String> exchange(HttpMethod method, String path, String body, String accept) {
        HttpHeaders headers = new HttpHeaders();
        headers.set("Accept", accept != null ? accept : "application/vnd.github+json");
        headers.set("X-GitHub-Api-Version", "2022-11-28");
        if (StringUtils.hasText(token)) {
            headers.set("Authorization", "Bearer " + token);
        }
        if (body != null) {
            headers.set("Content-Type", "application/json");
        }
        try {
            return restTemplate.exchange(new RequestEntity<>(body, headers, method, URI.create(API + path)), String.class);
        } catch (HttpClientErrorException e) {
            log.warn("[GitHubActions] {} {} -> {} {}", method, path, e.getStatusCode(),
                    e.getResponseBodyAsString().length() > 300 ? e.getResponseBodyAsString().substring(0, 300)
                            : e.getResponseBodyAsString());
            throw e;
        }
    }
}
