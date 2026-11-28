package vacademy.io.assessment_service.features.assessment.enums;

import java.util.List;

public enum AiEvaluationStatusEnum {
        PENDING, // Request queued
        DISPATCHED, // Claimed by a poller (or the direct path), about to be sent to ai_service
        STARTED, // Evaluation initiated
        PROCESSING, // Processing PDF with Mathpix
        EXTRACTING, // Extracting all answers (batch)
        EVALUATING, // Grading questions
        COMPLETED, // All done
        FAILED, // Error occurred
        CANCELLED; // Stopped by a teacher

        /**
         * "With the AI service now": counted against the lane caps, swept when silent.
         * GRADING and IN_PROGRESS are not written by this service but are kept so a
         * row in either state is never mistaken for an idle one.
         */
        public static final List<String> IN_FLIGHT = List.of(
                        DISPATCHED.name(), PROCESSING.name(), STARTED.name(), EXTRACTING.name(),
                        EVALUATING.name(), "GRADING", "IN_PROGRESS");

        /**
         * A live run for the attempt: queued or in flight. The single list every
         * "is a check already running?" decision reads (trigger idempotency, the
         * on-submit enqueuer, the completion notifier, the bulk-intake preview), so a
         * new state can never be added to one and forgotten in another.
         */
        public static final List<String> ACTIVE = List.copyOf(concat(List.of(PENDING.name()), IN_FLIGHT));

        /** Nothing further can happen to a process in one of these states. */
        public static final List<String> TERMINAL = List.of(COMPLETED.name(), FAILED.name(), CANCELLED.name());

        private static List<String> concat(List<String> a, List<String> b) {
                java.util.ArrayList<String> out = new java.util.ArrayList<>(a);
                out.addAll(b);
                return out;
        }
}
