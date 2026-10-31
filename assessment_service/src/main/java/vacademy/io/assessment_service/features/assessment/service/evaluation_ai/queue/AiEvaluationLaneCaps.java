package vacademy.io.assessment_service.features.assessment.service.evaluation_ai.queue;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import vacademy.io.assessment_service.features.assessment.enums.AiEvaluationLane;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * How much of each lane the queue may hand out (AI_EVALUATION_PUBLIC_API.md 11.2).
 *
 * <pre>
 * | Lane  | Lane cap                 | Per-institute cap              | Batch    | Interval |
 * | COPY  | 3 (ai_service pods x 3)  | lane cap - 1 once lane cap >= 4 | lane cap | 15 s     |
 * | TYPED | 12                       | 6                              | 12       | 5 s      |
 * </pre>
 *
 * The lane cap bounds what the AI pods see at once. The per-institute cap is what
 * makes it fair: one institute alone may use the lane up to that cap, and once the
 * COPY lane has 4+ slots one is always left for somebody else.
 *
 * Per-institute overrides (a contract that buys reserved capacity) come later from
 * {@code institute_api_access.copy_lane_cap / typed_lane_cap}; {@link #setOverride}
 * is the hook that feeds them in. Until then the map is empty and the defaults apply.
 */
@Component
public class AiEvaluationLaneCaps {

        /** Falls back to the old global max-in-flight, so existing env config keeps its meaning. */
        @Value("${assessment.ai-evaluation.copy-lane-cap:${assessment.ai-evaluation.max-in-flight:3}}")
        private int copyLaneCap;

        /** -1 = derived from the lane cap (see {@link #derivedInstituteCap}). */
        @Value("${assessment.ai-evaluation.copy-institute-cap:-1}")
        private int copyInstituteCap;

        /** -1 = the lane cap. The old poller-batch-size keeps working as a lower ceiling. */
        @Value("${assessment.ai-evaluation.poller-batch-size:-1}")
        private int copyBatch;

        @Value("${assessment.ai-evaluation.typed-lane-cap:12}")
        private int typedLaneCap;

        @Value("${assessment.ai-evaluation.typed-institute-cap:6}")
        private int typedInstituteCap;

        @Value("${assessment.ai-evaluation.typed-batch-size:-1}")
        private int typedBatch;

        private final Map<AiEvaluationLane, Map<String, Integer>> overrides = new ConcurrentHashMap<>();

        /** Spring: the caps come from the @Value fields. */
        @Autowired
        public AiEvaluationLaneCaps() {
        }

        /** For tests and for wiring without Spring. */
        public AiEvaluationLaneCaps(int copyLaneCap, int copyInstituteCap, int copyBatch,
                        int typedLaneCap, int typedInstituteCap, int typedBatch) {
                this.copyLaneCap = copyLaneCap;
                this.copyInstituteCap = copyInstituteCap;
                this.copyBatch = copyBatch;
                this.typedLaneCap = typedLaneCap;
                this.typedInstituteCap = typedInstituteCap;
                this.typedBatch = typedBatch;
        }

        /** Rows of this lane with the AI service at once, across every replica. */
        public int laneCap(AiEvaluationLane lane) {
                return Math.max(0, lane == AiEvaluationLane.TYPED ? typedLaneCap : copyLaneCap);
        }

        /** Default cap for one institute in this lane (before any override). */
        public int perInstituteCap(AiEvaluationLane lane) {
                int laneCap = laneCap(lane);
                int configured = lane == AiEvaluationLane.TYPED ? typedInstituteCap : copyInstituteCap;
                int cap = configured > 0 ? configured : derivedInstituteCap(laneCap);
                return Math.max(0, Math.min(cap, laneCap));
        }

        /** How many rows one tick may claim in this lane. */
        public int batch(AiEvaluationLane lane) {
                int laneCap = laneCap(lane);
                int configured = lane == AiEvaluationLane.TYPED ? typedBatch : copyBatch;
                return configured > 0 ? Math.min(configured, laneCap) : laneCap;
        }

        /**
         * lane cap - 1 once the lane has 4+ slots, else the whole lane: with 3 slots,
         * holding one back would leave a third of the capacity idle whenever only one
         * institute is waiting, which is most of the day.
         */
        public static int derivedInstituteCap(int laneCap) {
                return laneCap >= 4 ? laneCap - 1 : laneCap;
        }

        /** Per-institute caps that differ from the default, for the claim. Never null. */
        public Map<String, Integer> overrides(AiEvaluationLane lane) {
                Map<String, Integer> map = overrides.get(lane);
                return map == null ? Map.of() : Map.copyOf(map);
        }

        /** Hook for institute_api_access: set (cap >= 0) or clear (cap null) one institute's cap. */
        public void setOverride(AiEvaluationLane lane, String instituteId, Integer cap) {
                if (instituteId == null) {
                        return;
                }
                Map<String, Integer> map = overrides.computeIfAbsent(lane, k -> new ConcurrentHashMap<>());
                if (cap == null || cap < 0) {
                        map.remove(instituteId);
                } else {
                        map.put(instituteId, cap);
                }
        }
}
