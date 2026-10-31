package vacademy.io.assessment_service.features.assessment.enums;

/**
 * The queue an AI evaluation waits in (V52). Handwritten copies take minutes of OCR
 * and vision on the shared AI pods; typed long answers take seconds. Sharing one
 * FIFO meant a typed answer waited behind a whole bulk upload, so each has its own
 * lane with its own caps (AI_EVALUATION_PUBLIC_API.md 11.2).
 */
public enum AiEvaluationLane {
        COPY,
        TYPED;

        public static AiEvaluationLane of(boolean typed) {
                return typed ? TYPED : COPY;
        }
}
