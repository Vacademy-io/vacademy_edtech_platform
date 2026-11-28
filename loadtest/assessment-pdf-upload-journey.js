/**
 * k6 load test: PDF answer-sheet exam journey (MANUAL evaluation).
 *
 * Differs from assessment-exam-journey.js in what happens at the end: instead
 * of answering questions inline, each learner uploads an answer-sheet PDF and
 * submits it for human/AI evaluation. That pulls two more services into the
 * exam path:
 *
 *   login (auth) -> preview + start (assessment)
 *     -> POST /media-service/get-signed-url      (media: presign + DB write)
 *     -> PUT   <presigned S3 url>                (bytes go DIRECT to S3 —
 *                                                 they never touch our servers)
 *     -> POST /media-service/acknowledge         (media: DB write)
 *     -> POST /assessment/learner/manual-status/submit
 *
 * IMPORTANT for reading the results: `s3_put_ms` measures the TEST MACHINE's
 * uplink to AWS, not platform capacity. Only the *_ms metrics for login,
 * preview, start, signed_url, acknowledge and submit describe our platform.
 * Thresholds are set on those alone, deliberately.
 *
 * Requires ./answer-sheet.pdf (any valid PDF; size only affects the S3 leg).
 *
 *   k6 run assessment-pdf-upload-journey.js \
 *     -e INSTITUTE_ID=... -e ASSESSMENT_ID=<MANUAL assessment> \
 *     -e SECTION_ID=... -e SET_ID=... -e BATCH_IDS=... \
 *     -e VUS=1000 -e LOGIN_WINDOW=600 -e START_WINDOW=180 -e EXAM_MINUTES=8
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { b64decode } from 'k6/encoding';
import { Trend, Rate, Counter } from 'k6/metrics';

const BASE = __ENV.BASE_URL || 'https://backend-stage.vacademy.io';
const INSTITUTE_ID = __ENV.INSTITUTE_ID;
const ASSESSMENT_ID = __ENV.ASSESSMENT_ID;
const SECTION_ID = __ENV.SECTION_ID;
const SET_ID = __ENV.SET_ID;
const BATCH_IDS = __ENV.BATCH_IDS || '';
const USER_PREFIX = __ENV.USER_PREFIX || 'loadtest';
const PASSWORD = __ENV.PASSWORD || 'LoadTest@123';
const VUS = Number(__ENV.VUS || 50);
const USER_COUNT = Number(__ENV.USER_COUNT || 1000);
const LOGIN_WINDOW = Number(__ENV.LOGIN_WINDOW || 300);
const START_WINDOW = Number(__ENV.START_WINDOW || 120);
const EXAM_MINUTES = Number(__ENV.EXAM_MINUTES || 8);

// Binary open() is required for a multipart/raw PUT body.
const pdf = open('./answer-sheet.pdf', 'b');

export const options = {
    scenarios: {
        exam: {
            executor: 'per-vu-iterations',
            vus: VUS,
            iterations: 1,
            maxDuration: `${LOGIN_WINDOW + START_WINDOW + EXAM_MINUTES * 60 + 900}s`,
            gracefulStop: '180s',
        },
    },
    // Platform steps only — s3_put_ms is deliberately absent (see header).
    thresholds: {
        'login_ms': ['p(95)<3000'],
        'start_ms': ['p(95)<5000'],
        'signed_url_ms': ['p(95)<3000'],
        'acknowledge_ms': ['p(95)<3000'],
        'submit_ms': ['p(95)<8000'],
    },
};

const loginMs = new Trend('login_ms');
const previewMs = new Trend('preview_ms');
const startMs = new Trend('start_ms');
const signedUrlMs = new Trend('signed_url_ms');
const s3PutMs = new Trend('s3_put_ms');
const ackMs = new Trend('acknowledge_ms');
const submitMs = new Trend('submit_ms');
const journeyFailed = new Rate('journey_failed');
const stepFailures = new Counter('step_failures');

function jsonHeaders(token) {
    const h = { 'Content-Type': 'application/json' };
    if (token) h['Authorization'] = `Bearer ${token}`;
    if (INSTITUTE_ID) h['clientId'] = INSTITUTE_ID;
    return h;
}

function fail(step, res) {
    stepFailures.add(1, { step });
    console.error(`VU${__VU} ${step} failed: ${res ? res.status : 'n/a'} ${res ? String(res.body).slice(0, 220) : ''}`);
    journeyFailed.add(1);
}

export function setup() {
    if (VUS > USER_COUNT) throw new Error(`VUS=${VUS} exceeds USER_COUNT=${USER_COUNT} seeded learners`);
    if (!SECTION_ID || !SET_ID) throw new Error('SECTION_ID and SET_ID are required (MANUAL assessment)');
}

export default function () {
    const username = `${USER_PREFIX}${String(__VU).padStart(4, '0')}`;

    sleep(Math.random() * LOGIN_WINDOW);

    let res = http.post(`${BASE}/auth-service/learner/v1/login`, JSON.stringify({
        user_name: username, password: PASSWORD,
        client_name: 'ADMIN_PORTAL', institute_id: INSTITUTE_ID,
    }), { headers: jsonHeaders(null), tags: { step: 'login' } });
    loginMs.add(res.timings.duration);
    if (!check(res, { 'login 200': (r) => r.status === 200 })) return fail('login', res);
    const token = res.json().accessToken;
    if (!token) return fail('login-token', res);
    const claims = JSON.parse(b64decode(token.split('.')[1], 'rawurl', 's'));
    const userId = claims.user;

    sleep(Math.random() * START_WINDOW);

    res = http.post(`${BASE}/assessment-service/assessment/learner/assessment-start-preview` +
        `?assessment_id=${ASSESSMENT_ID}&instituteId=${INSTITUTE_ID}` + (BATCH_IDS ? `&batch_ids=${BATCH_IDS}` : ''),
        JSON.stringify({ username, user_id: userId, email: `${username}@vacademy.com`, full_name: `Load Test ${username}` }),
        { headers: jsonHeaders(token), tags: { step: 'preview' } });
    previewMs.add(res.timings.duration);
    if (!check(res, { 'preview 200': (r) => r.status === 200 })) return fail('preview', res);
    const preview = res.json();
    const attemptId = preview.attempt_id;
    const registrationId = preview.assessment_user_registration_id || null;
    if (!attemptId) return fail('preview-attemptId', res);
    const questionIds = [];
    for (const s of (preview.section_dtos || [])) {
        for (const q of (s.question_preview_dto_list || [])) if (q.question_id) questionIds.push(q.question_id);
    }

    res = http.post(`${BASE}/assessment-service/assessment/learner/assessment-start-assessment`,
        JSON.stringify({ assessment_id: ASSESSMENT_ID, attempt_id: attemptId, user_registration_id: registrationId }),
        { headers: jsonHeaders(token), tags: { step: 'start' } });
    startMs.add(res.timings.duration);
    const startOk = res.status === 200 || String(res.body).toLowerCase().includes('already live');
    if (!check(res, { 'start usable': () => startOk })) return fail('start', res);

    // Candidate works through the paper on paper, then uploads near the end.
    sleep(EXAM_MINUTES * 60 * (0.7 + Math.random() * 0.3));

    // --- Upload: presign -> direct-to-S3 PUT -> acknowledge ---
    res = http.post(`${BASE}/media-service/get-signed-url`, JSON.stringify({
        file_name: 'answer_sheet.pdf', file_type: 'application/pdf',
        source: 'LOADTEST_ANSWER_SHEET', source_id: attemptId,
    }), { headers: jsonHeaders(token), tags: { step: 'signed_url' } });
    signedUrlMs.add(res.timings.duration);
    if (!check(res, { 'signed url 200': (r) => r.status === 200 })) return fail('signed_url', res);
    const fileId = res.json().id;
    const putUrl = res.json().url;

    res = http.put(putUrl, pdf, { headers: { 'Content-Type': 'application/pdf' }, tags: { step: 's3_put' } });
    s3PutMs.add(res.timings.duration);
    if (!check(res, { 's3 put 200': (r) => r.status === 200 })) return fail('s3_put', res);

    res = http.post(`${BASE}/media-service/acknowledge`,
        JSON.stringify({ file_id: fileId, user_id: userId }),
        { headers: jsonHeaders(token), tags: { step: 'acknowledge' } });
    ackMs.add(res.timings.duration);
    if (!check(res, { 'acknowledge 200': (r) => r.status === 200 })) return fail('acknowledge', res);

    // --- Submit the answer sheet (camelCase inside json_content: the manual
    // parser uses a plain ObjectMapper, unlike the snake_case request wrapper) ---
    const attemptData = JSON.stringify({
        attemptId: attemptId,
        clientLastSync: new Date().toISOString(),
        fileId: fileId,
        setId: SET_ID,
        assessment: { timeElapsedInSeconds: EXAM_MINUTES * 60 },
        sections: [{
            sectionId: SECTION_ID,
            sectionDurationLeftInSeconds: 0,
            timeElapsedInSeconds: EXAM_MINUTES * 60,
            questions: questionIds.map((q) => ({
                questionId: q, isMarkedForReview: false, isVisited: true,
                questionDurationLeftInSeconds: 0, timeTakenInSeconds: 100,
            })),
        }],
    });
    res = http.post(`${BASE}/assessment-service/assessment/learner/manual-status/submit` +
        `?assessmentId=${ASSESSMENT_ID}&instituteId=${INSTITUTE_ID}&attemptId=${attemptId}`,
        JSON.stringify({ json_content: attemptData, set_id: SET_ID }),
        { headers: jsonHeaders(token), tags: { step: 'submit' } });
    submitMs.add(res.timings.duration);
    if (!check(res, { 'submit 200': (r) => r.status === 200 })) return fail('submit', res);

    journeyFailed.add(0);
}
