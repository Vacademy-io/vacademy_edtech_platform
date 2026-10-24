"use client";

import type React from "react";
import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { MyInput } from "@/components/design-system/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
// import { MyButton } from "@/components/design-system/button";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import authenticatedAxiosInstance from "@/lib/auth/axiosInstance";
import {
    SUBMIT_QUESTION_SLIDE_ANSWERS,
    GET_QUESTION_SLIDE_ACTIVITY_LOGS,
} from "@/constants/urls";
import { v4 as uuidv4 } from "uuid";
import { getUserId } from "@/constants/getUserId";
import { Textarea } from "@/components/ui/textarea";
import { useRouter } from "@tanstack/react-router";
import { useResolvedPackageSessionId } from "@/hooks/study-library/useResolvedPackageSessionId";
import { refreshProgressAfterSubmit } from "@/utils/study-library/tracking/refreshProgressAfterSubmit";
import { toast } from "sonner";
import { trackOrQueue, isNetworkError } from "@/lib/offline/events/track-or-queue";

interface Option {
    id: string;
    text: {
        content: string;
    };
    explanation_text_data: {
        content: string;
    };
}

interface SelectedOption {
    id: string;
    name: string;
}

interface QuestionSlideProps {
    questionData: {
        parent_rich_text: {
            content: string;
        };
        text_data: {
            content: string;
        };
        explanation_text_data: {
            content: string;
        };
        options: Option[];
        re_attempt_count: number;
        auto_evaluation_json: string;
        question_type: string;
        options_json?: string;
    };
    onSubmit: (
        questionId: string,
        selectedOption: string | string[]
    ) => Promise<{
        success: boolean;
        isCorrect?: boolean;
        correctOption?: string;
        explanation?: string;
        error?: string;
    }>;
}

interface QuestionResponseMap {
    [key: string]: {
        value: string | string[];
        type: string;
    };
}

const QuestionSlide = ({ questionData, onSubmit }: QuestionSlideProps) => {
    const { t } = useTranslation("libraryCommonB");
    const router = useRouter();
    const queryClient = useQueryClient();
    const { chapterId, moduleId, subjectId } = router.state.location.search;
    // Resolve the batch from the course being studied, not the single id cached
    // at login — otherwise a multi-batch learner's submission updates the wrong
    // package_session and their course progress never moves.
    const resolvePackageSessionId = useResolvedPackageSessionId();
    // const { activeItem } = useContentStore();
    const [selectedOptionsMap, setSelectedOptionsMap] = useState<
        Record<string, SelectedOption | null>
    >({});
    const [selectedMultiOptionsMap, setSelectedMultiOptionsMap] = useState<
        Record<string, SelectedOption[]>
    >({});
    const [inputValuesMap, setInputValuesMap] = useState<
        Record<string, string>
    >({});
    const [numericValuesMap, setNumericValuesMap] = useState<
        Record<string, string>
    >({});
    const [isSubmittingMap, setIsSubmittingMap] = useState<
        Record<string, boolean>
    >({});
    // Per-slide flag: has the learner submitted this question yet? Gates the
    // answer guidance so it can NEVER be read before an attempt is submitted.
    const [submittedMap, setSubmittedMap] = useState<Record<string, boolean>>(
        {}
    );
    // Per-slide flag controlling whether the (post-submit) answer guidance is
    // currently expanded. Auto-opened on submit; toggleable thereafter.
    const [showExplanationMap, setShowExplanationMap] = useState<
        Record<string, boolean>
    >({});
    // Normalized signature of the last-submitted answer per slide. Lets us keep
    // Submit disabled while the answer is unchanged (no duplicate submit) and
    // re-enable it as "Resubmit" once the learner edits their answer (retry).
    const [lastSubmittedSignatureMap, setLastSubmittedSignatureMap] = useState<
        Record<string, string>
    >({});
    const [isDecimal, setIsDecimal] = useState(false);
    const [maxDecimals, setMaxDecimals] = useState(0);
    // Synchronous in-flight guard, keyed by slideId. Blocks the rapid
    // double-click race where two clicks both fire before React re-renders and
    // sees the (async) isSubmitting=true — which would POST the answer twice.
    const submitInFlightRef = useRef<Record<string, boolean>>({});
    // Real time the learner has had this slide open (mount → submit) so the
    // reported "Time Spent" reflects actual engagement, not a fake 1 minute.
    const activityStartRef = useRef<number>(Date.now());
    // const [questionResponses, setQuestionResponses] =
    useState<QuestionResponseMap>({});

    const maxAttempts = questionData?.re_attempt_count || 1;
    const questionType = questionData?.question_type || "MCQS";

    // Get slideId from URL
    const urlParams = new URLSearchParams(window.location.search);
    const slideId = urlParams.get("slideId") || "unknown";
    const isSubmitting = isSubmittingMap[slideId] || false;

    // Get current slide's values
    const selectedOption = selectedOptionsMap[slideId] || null;
    const selectedOptions = selectedMultiOptionsMap[slideId] || [];
    const inputValue = inputValuesMap[slideId] || "";
    const numericValue = numericValuesMap[slideId] || "";
    const hasSubmitted = submittedMap[slideId] || false;
    const showExplanation = showExplanationMap[slideId] || false;

    // Build a normalized, comparable signature of the current answer so we can
    // tell whether it changed since the last submission. Shared by the
    // pre-fill (previous answer), the disabled state, and the button label.
    const buildAnswerSignature = (selected: SelectedOption[]): string => {
        switch (questionType) {
            case "MCQS":
            case "TRUE_FALSE":
                return selected[0]?.id || "";
            case "MCQM":
                return selected
                    .map((o) => o.id)
                    .sort()
                    .join(",");
            case "ONE_WORD":
            case "LONG_ANSWER":
            case "NUMERIC":
                return (selected[0]?.name ?? selected[0]?.id ?? "").trim();
            default:
                return "";
        }
    };
    const currentAnswerSignature = (() => {
        switch (questionType) {
            case "MCQS":
            case "TRUE_FALSE":
                return selectedOption?.id || "";
            case "MCQM":
                return selectedOptions
                    .map((o) => o.id)
                    .sort()
                    .join(",");
            case "ONE_WORD":
            case "LONG_ANSWER":
                return inputValue.trim();
            case "NUMERIC":
                return numericValue.trim();
            default:
                return "";
        }
    })();
    // True once submitted AND the answer is identical to what was submitted —
    // i.e. there is nothing new to send (blocks duplicate submits; "Resubmit"
    // re-enables the moment the learner edits their answer).
    const unchangedSinceSubmit =
        hasSubmitted &&
        currentAnswerSignature === (lastSubmittedSignatureMap[slideId] ?? "");

    // Submit question mutation
    const submitQuestionMutation = useMutation({
        mutationFn: async ({
            selectedOptions,
            questionName,
        }: {
            selectedOptions: SelectedOption[];
            questionName: string;
        }) => {
            const userId = await getUserId();

            const packageSessionId = await resolvePackageSessionId();

            if (!slideId || !userId || !packageSessionId) {
                throw new Error(
                    "Missing slideId or userId or !packageSessionId in URL"
                );
            }

            const payload = {
                id: uuidv4(),
                source_id: slideId,
                source_type: "QUESTION",
                user_id: userId,
                slide_id: slideId,
                start_time_in_millis: activityStartRef.current,
                end_time_in_millis: Date.now(),
                percentage_watched: 100,
                videos: [],
                documents: [],
                question_slides: [
                    {
                        id: uuidv4(),
                        attempt_number: maxAttempts,
                        question_name: questionName,
                        response_json: JSON.stringify({
                            questionName,
                            selectedOptions,
                        }),
                        response_status: "SUBMITTED",
                        marks: 0,
                    },
                ],
                assignment_slides: [],
                video_slides_questions: [],
                new_activity: true,
                concentration_score: {
                    id: uuidv4(),
                    concentration_score: 100,
                    tab_switch_count: 0,
                    pause_count: 0,
                    answer_times_in_seconds: [],
                },
            };

            const offlineQueued = await trackOrQueue({
                userId,
                eventType: "QUESTION",
                context: {
                    slideId,
                    chapterId: chapterId || "",
                    moduleId: moduleId || "",
                    subjectId: subjectId || "",
                    packageSessionId: packageSessionId || "",
                },
                payload,
            });
            if (offlineQueued) {
                return { offlineQueued: true as const };
            }

            try {
                return await authenticatedAxiosInstance.post(
                    SUBMIT_QUESTION_SLIDE_ANSWERS,
                    payload,
                    {
                        params: {
                            slideId,
                            chapterId: chapterId || "",
                            packageSessionId: packageSessionId || "",
                            moduleId: moduleId || "",
                            subjectId: subjectId || "",
                            userId,
                        },
                    }
                );
            } catch (error) {
                // Online-detection can lag reality (airplane mode mid-flight,
                // captive portals). A network-failed submit must never lose
                // the learner's answer — force it into the offline queue.
                if (isNetworkError(error)) {
                    await trackOrQueue({
                        userId,
                        eventType: "QUESTION",
                        context: {
                            slideId,
                            chapterId: chapterId || "",
                            moduleId: moduleId || "",
                            subjectId: subjectId || "",
                            packageSessionId: packageSessionId || "",
                        },
                        payload,
                        force: true,
                    });
                    return { offlineQueued: true as const };
                }
                throw error;
            }
        },
        onSuccess: (result) => {
            if (result && "offlineQueued" in result && result.offlineQueued) {
                toast.info(t("questionSlide.toast.savedOffline"));
            } else {
                console.log("Question answer submitted successfully");
            }
        },
        onError: (error: Error) => {
            console.error("Error submitting question answer:", error);
        },
    });

    // Parse auto evaluation JSON to find correct answer
    useEffect(() => {
        try {
            if (questionData?.auto_evaluation_json) {
                const evaluationData = JSON.parse(
                    questionData.auto_evaluation_json
                );

                if (questionType === "MCQS" || questionType === "TRUE_FALSE") {
                    // For multiple choice questions and true/false
                    if (evaluationData.data?.correctOptionIds) {
                        const correctId =
                            evaluationData.data.correctOptionIds[0];
                        setSelectedOptionsMap((prev) => ({
                            ...prev,
                            [slideId]: {
                                id: correctId,
                                name:
                                    questionData.options.find(
                                        (o) => o.id === correctId
                                    )?.text.content || "",
                            },
                        }));
                    } else {
                        // If not specified, assume first option is correct (for demo)
                        setSelectedOptionsMap((prev) => ({
                            ...prev,
                            [slideId]: {
                                id: questionData.options[0]?.id,
                                name:
                                    questionData.options[0]?.text.content || "",
                            },
                        }));
                    }
                } else if (questionType === "MCQM") {
                    // For multiple select questions
                    if (evaluationData.data?.correctOptionIds) {
                        setSelectedMultiOptionsMap((prev) => ({
                            ...prev,
                            [slideId]: evaluationData.data.correctOptionIds.map(
                                (id: string) => ({
                                    id,
                                    name:
                                        questionData.options.find(
                                            (o) => o.id === id
                                        )?.text.content || "",
                                })
                            ),
                        }));
                    }
                } else if (
                    questionType === "ONE_WORD" ||
                    questionType === "NUMERIC"
                ) {
                    // For one-word or numeric questions
                    if (evaluationData.data?.correctAnswer) {
                        setInputValuesMap((prev) => ({
                            ...prev,
                            [slideId]: evaluationData.data.correctAnswer,
                        }));
                    }
                }
            } else if (
                questionType === "MCQS" ||
                questionType === "TRUE_FALSE"
            ) {
                // Default to first option if no evaluation data
                setSelectedOptionsMap((prev) => ({
                    ...prev,
                    [slideId]: {
                        id: questionData.options[0]?.id,
                        name: questionData.options[0]?.text.content || "",
                    },
                }));
            }

            // Parse options_json for numeric type questions
            if (questionType === "NUMERIC" && questionData.options_json) {
                const options = JSON.parse(questionData.options_json);
                setIsDecimal(options.numeric_type === "DECIMAL");
                setMaxDecimals(options.decimals || 0);
            }
        } catch (error) {
            console.error("Error parsing JSON data:", error);
            if (questionType === "MCQS" || questionType === "TRUE_FALSE") {
                setSelectedOptionsMap((prev) => ({
                    ...prev,
                    [slideId]: {
                        id: questionData.options[0]?.id,
                        name: questionData.options[0]?.text.content || "",
                    },
                }));
            }
        }
    }, [questionData, questionType]);

    // Load the learner's previous answer for this slide (if any) so it is shown
    // pre-filled with the guidance available. They can edit it and resubmit
    // (retry). Best-effort: any failure just leaves the question blank.
    useEffect(() => {
        let cancelled = false;
        (async () => {
            if (!slideId || slideId === "unknown") return;
            try {
                const userId = await getUserId();
                if (!userId) return;
                const res = await authenticatedAxiosInstance.get(
                    GET_QUESTION_SLIDE_ACTIVITY_LOGS,
                    { params: { userId, slideId, pageNo: 0, pageSize: 10 } }
                );
                const logs = res.data?.content || [];
                const attempts = logs.flatMap(
                    (l: { question_slides?: unknown[] }) =>
                        (l.question_slides || []) as Array<{
                            attempt_number?: number;
                            response_json?: string;
                        }>
                );
                if (!attempts.length) return;
                // Pick the latest attempt.
                const latest = attempts.reduce((a, b) =>
                    (b.attempt_number ?? 0) >= (a.attempt_number ?? 0) ? b : a
                );
                const parsed = JSON.parse(latest.response_json || "{}");
                const selected: SelectedOption[] = Array.isArray(
                    parsed?.selectedOptions
                )
                    ? parsed.selectedOptions
                    : [];
                if (cancelled || !selected.length) return;

                // Pre-fill the matching answer state for this question type.
                // Each setter is guarded so it only fills an EMPTY field — if a
                // slow fetch resolves after the learner already started a new
                // answer, we must not clobber their in-progress input.
                const textAnswer = selected[0]?.name ?? selected[0]?.id ?? "";
                switch (questionType) {
                    case "MCQS":
                    case "TRUE_FALSE":
                        setSelectedOptionsMap((prev) =>
                            prev[slideId]
                                ? prev
                                : {
                                      ...prev,
                                      [slideId]: {
                                          id: selected[0].id,
                                          name: selected[0].name,
                                      },
                                  }
                        );
                        break;
                    case "MCQM":
                        setSelectedMultiOptionsMap((prev) =>
                            prev[slideId]?.length
                                ? prev
                                : {
                                      ...prev,
                                      [slideId]: selected.map((s) => ({
                                          id: s.id,
                                          name: s.name,
                                      })),
                                  }
                        );
                        break;
                    case "ONE_WORD":
                    case "LONG_ANSWER":
                        setInputValuesMap((prev) =>
                            prev[slideId]
                                ? prev
                                : { ...prev, [slideId]: textAnswer }
                        );
                        break;
                    case "NUMERIC":
                        setNumericValuesMap((prev) =>
                            prev[slideId]
                                ? prev
                                : { ...prev, [slideId]: textAnswer }
                        );
                        break;
                }
                // Mark as already submitted (guidance available) and record the
                // baseline so Submit stays disabled until they edit it.
                setSubmittedMap((prev) => ({ ...prev, [slideId]: true }));
                setLastSubmittedSignatureMap((prev) => ({
                    ...prev,
                    [slideId]: buildAnswerSignature(selected),
                }));
            } catch {
                /* no previous answer / fetch failed — leave blank */
            }
        })();
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [slideId, questionData?.id]);

    const handleOptionSelect = (optionId: string, optionName: string) => {
        if (isSubmitting) return;

        if (questionType === "MCQS" || questionType === "TRUE_FALSE") {
            setSelectedOptionsMap((prev) => ({
                ...prev,
                [slideId]: { id: optionId, name: optionName },
            }));
        } else if (questionType === "MCQM") {
            setSelectedMultiOptionsMap((prev) => {
                const currentOptions = prev[slideId] || [];
                const newOptions = currentOptions.some(
                    (opt) => opt.id === optionId
                )
                    ? currentOptions.filter((opt) => opt.id !== optionId)
                    : [...currentOptions, { id: optionId, name: optionName }];
                return {
                    ...prev,
                    [slideId]: newOptions,
                };
            });
        }
    };

    // Update handleInputChange to handle both input and textarea events
    const handleInputChange = (
        e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
    ) => {
        setInputValuesMap((prev) => ({
            ...prev,
            [slideId]: e.target.value,
        }));
    };

    // Handle numeric input changes
    const handleNumericChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;

        // Validate input based on numeric type (INTEGER or DECIMAL)
        if (isDecimal) {
            if (/^-?\d*\.?\d*$/.test(value)) {
                // Check decimal places don't exceed max
                if (value.includes(".")) {
                    const parts = value.split(".");
                    if (parts[1].length <= maxDecimals) {
                        setNumericValuesMap((prev) => ({
                            ...prev,
                            [slideId]: value,
                        }));
                    }
                } else {
                    setNumericValuesMap((prev) => ({
                        ...prev,
                        [slideId]: value,
                    }));
                }
            }
        } else {
            // Integer only
            if (/^-?\d*$/.test(value)) {
                setNumericValuesMap((prev) => ({
                    ...prev,
                    [slideId]: value,
                }));
            }
        }
    };

    // Handle keypad button press for numeric input
    const handleKeyPress = (key: string) => {
        if (key === "backspace") {
            setNumericValuesMap((prev) => ({
                ...prev,
                [slideId]: (prev[slideId] || "").slice(0, -1),
            }));
        } else if (key === "clear") {
            setNumericValuesMap((prev) => ({
                ...prev,
                [slideId]: "",
            }));
        } else if (key === "." && isDecimal && !numericValue.includes(".")) {
            setNumericValuesMap((prev) => ({
                ...prev,
                [slideId]: (prev[slideId] || "") + ".",
            }));
        } else if (/[0-9]/.test(key)) {
            setNumericValuesMap((prev) => {
                const currentValue = prev[slideId] || "";
                // If there's a decimal point, check we don't exceed max decimal places
                if (currentValue.includes(".")) {
                    const parts = currentValue.split(".");
                    if (parts[1].length >= maxDecimals) {
                        return prev;
                    }
                }
                return {
                    ...prev,
                    [slideId]: currentValue + key,
                };
            });
        }
    };

    const handleSubmit = async () => {
        // Block re-entry: already submitting, an unchanged answer (nothing new
        // to send), or a click already in flight for this slide (synchronous
        // ref catches the double-click race the async isSubmitting state misses).
        // NOTE: we do NOT block on hasSubmitted — editing the answer and
        // resubmitting (retry) is allowed.
        if (
            isSubmitting ||
            unchangedSinceSubmit ||
            submitInFlightRef.current[slideId]
        )
            return;

        // Check if we have a valid answer to submit
        if (
            ((questionType === "MCQS" || questionType === "TRUE_FALSE") &&
                !selectedOption) ||
            (questionType === "MCQM" && selectedOptions.length === 0) ||
            ((questionType === "ONE_WORD" || questionType === "LONG_ANSWER") &&
                !inputValue.trim()) ||
            (questionType === "NUMERIC" && !numericValue.trim())
        ) {
            return;
        }

        submitInFlightRef.current[slideId] = true;
        setIsSubmittingMap((prev) => ({
            ...prev,
            [slideId]: true,
        }));

        try {
            let submissionValue: string | string[];
            let optionsToSubmit: SelectedOption[] = [];

            // Prepare submission value based on question type
            if (questionType === "MCQS" || questionType === "TRUE_FALSE") {
                submissionValue = selectedOption?.id || "";
                optionsToSubmit = selectedOption ? [selectedOption] : [];
            } else if (questionType === "MCQM") {
                submissionValue = selectedOptions.map((opt) => opt.id);
                optionsToSubmit = selectedOptions;
            } else if (
                questionType === "ONE_WORD" ||
                questionType === "LONG_ANSWER" ||
                questionType === "NUMERIC"
            ) {
                submissionValue =
                    questionType === "NUMERIC"
                        ? numericValue.trim()
                        : inputValue.trim();
                optionsToSubmit = [
                    {
                        id: submissionValue,
                        name: submissionValue,
                    },
                ];
            } else {
                submissionValue = "";
            }

            // Submit to API (or durably queue it when offline)
            const submitResult = await submitQuestionMutation.mutateAsync({
                selectedOptions: optionsToSubmit,
                questionName: questionData.text_data.content,
            });
            const queuedOffline =
                (submitResult as { offlineQueued?: boolean } | undefined)
                    ?.offlineQueued === true;

            // Call the onSubmit function passed from parent
            await onSubmit(slideId, submissionValue);

            // Reconcile progress UI (chapter/module/course %) after the
            // async completion cascade lands. chapterId is from the route.
            //
            // Skipped for an offline-queued answer: this invalidates the
            // per-slide query, and offline that refetch resolves to nothing,
            // which remounts this component and wipes both the learner's typed
            // answer and the "Submitted" state — the answer was safely queued,
            // but the screen made it look like the submit never happened. The
            // server progress is reconciled by the sync flusher instead.
            if (chapterId && !queuedOffline) {
                void refreshProgressAfterSubmit(queryClient, chapterId);
            }
            if (queuedOffline) {
                toast.success("Answer saved — it will sync when you're back online");
            }

            // Keep the learner's answer on screen (do NOT clear it) and reveal
            // the answer guidance so they can self-check. These are formative
            // "Knowledge Check" questions — "look back, think again and retry",
            // not graded — so clearing the answer just hid what they wrote.
            // The guidance is gated on `submitted` so it can't be read before
            // an attempt; auto-expand it now.
            setSubmittedMap((prev) => ({ ...prev, [slideId]: true }));
            setShowExplanationMap((prev) => ({
                ...prev,
                [slideId]: true,
            }));
            // Record what was just submitted so Submit disables ("Submitted")
            // until the learner edits their answer, when it becomes "Resubmit".
            setLastSubmittedSignatureMap((prev) => ({
                ...prev,
                [slideId]: currentAnswerSignature,
            }));
        } catch (error) {
            console.error("Error in submission:", error);
        } finally {
            // Release the in-flight guard so a FAILED submit can be retried.
            // (A successful submit stays blocked via hasSubmitted.)
            submitInFlightRef.current[slideId] = false;
            setIsSubmittingMap((prev) => ({
                ...prev,
                [slideId]: false,
            }));
        }
    };

    // Render the appropriate question component based on question type
    const renderQuestionContent = () => {
        switch (questionType) {
            case "MCQS":
            case "TRUE_FALSE":
                return (
                    <div className="space-y-2 sm:space-y-3">
                        {questionData?.options?.map((option, index) => (
                            <div
                                key={option.id}
                                onClick={() =>
                                    handleOptionSelect(
                                        option.id,
                                        option.text.content
                                    )
                                }
                                className={`flex flex-row-reverse items-center justify-between rounded-md border p-3 w-full transition-all duration-200 hover:border-gray-400 ${
                                    selectedOption?.id === option.id
                                        ? "border-gray-600 bg-gray-50"
                                        : "border-gray-200"
                                }`}
                            >
                                <div className="relative flex items-center">
                                    <div
                                        className={`w-5 h-5 border rounded-md flex items-center justify-center transition-colors ${
                                            selectedOption?.id === option.id
                                                ? "bg-gray-800 border-gray-800"
                                                : "border-gray-300"
                                        }`}
                                    >
                                        {selectedOption?.id === option.id && (
                                            <span className="text-white text-sm">
                                                ✓
                                            </span>
                                        )}
                                    </div>
                                </div>

                                <label
                                    className={`flex-grow text-sm sm:text-base ${
                                        selectedOption?.id === option.id
                                            ? "font-medium text-gray-900"
                                            : "text-gray-700"
                                    }`}
                                >
                                    {questionType === "TRUE_FALSE" ? (
                                        <span
                                            dangerouslySetInnerHTML={{
                                                __html: option.text.content,
                                            }}
                                        />
                                    ) : (
                                        <>
                                            {String.fromCharCode(97 + index)}.{" "}
                                            <span
                                                dangerouslySetInnerHTML={{
                                                    __html: option.text.content,
                                                }}
                                            />
                                        </>
                                    )}
                                </label>
                            </div>
                        ))}
                    </div>
                );

            case "MCQM":
                return (
                    <div className="space-y-2 sm:space-y-3">
                        {questionData?.options?.map((option, index) => (
                            <div
                                key={option.id}
                                onClick={() =>
                                    handleOptionSelect(
                                        option.id,
                                        option.text.content
                                    )
                                }
                                className={`flex flex-row-reverse items-center justify-between rounded-md border p-3 w-full transition-all duration-200 hover:border-gray-400 ${
                                    selectedOptions.some(
                                        (opt) => opt.id === option.id
                                    )
                                        ? "border-gray-600 bg-gray-50"
                                        : "border-gray-200"
                                }`}
                            >
                                <div className="relative flex items-center">
                                    <div
                                        className={`w-5 h-5 border rounded-md flex items-center justify-center transition-colors ${
                                            selectedOptions.some(
                                                (opt) => opt.id === option.id
                                            )
                                                ? "bg-gray-800 border-gray-800"
                                                : "border-gray-300"
                                        }`}
                                    >
                                        {selectedOptions.some(
                                            (opt) => opt.id === option.id
                                        ) && (
                                            <span className="text-white text-sm">
                                                ✓
                                            </span>
                                        )}
                                    </div>
                                </div>

                                <label
                                    className={`flex-grow text-sm sm:text-base ${
                                        selectedOptions.some(
                                            (opt) => opt.id === option.id
                                        )
                                            ? "font-medium text-gray-900"
                                            : "text-gray-700"
                                    }`}
                                >
                                    {String.fromCharCode(97 + index)}.{" "}
                                    <span
                                        dangerouslySetInnerHTML={{
                                            __html: option.text.content,
                                        }}
                                    />
                                </label>
                            </div>
                        ))}
                    </div>
                );

            case "ONE_WORD":
                return (
                    <div className="w-full max-w-md mx-auto mt-2 sm:mt-4">
                        <MyInput
                            inputType="text"
                            input={inputValue}
                            onChangeFunction={handleInputChange}
                            inputPlaceholder={t("questionSlide.placeholders.oneWord")}
                            className="text-base sm:text-lg py-3 font-normal w-full border-gray-300 focus:border-gray-600 focus:ring-gray-600"
                            onCopy={(e) => e.preventDefault()}
                            onCut={(e) => e.preventDefault()}
                            onPaste={(e) => e.preventDefault()}
                        />
                    </div>
                );

            case "LONG_ANSWER":
                return (
                    <div className="w-full mt-2 sm:mt-4">
                        <Textarea
                            value={inputValue}
                            onChange={handleInputChange}
                            placeholder={t("questionSlide.placeholders.longAnswer")}
                            className="min-h-reg-150 sm:min-h-reg-200 text-base border-gray-300 focus:border-gray-600 focus:ring-gray-600"
                            onCopy={(e) => e.preventDefault()}
                            onCut={(e) => e.preventDefault()}
                            onPaste={(e) => e.preventDefault()}
                        />
                    </div>
                );

            case "NUMERIC":
                return (
                    <div className="space-y-3 sm:space-y-4 mt-4">
                        <div className="flex justify-center">
                            <MyInput
                                inputType="text"
                                input={numericValue}
                                onChangeFunction={handleNumericChange}
                                inputPlaceholder={
                                    isDecimal
                                        ? t("questionSlide.placeholders.decimal")
                                        : t("questionSlide.placeholders.integer")
                                }
                                inputMode="numeric"
                                className="text-base sm:text-lg py-3 font-normal w-full max-w-md border-gray-300 focus:border-gray-600 focus:ring-gray-600"
                                onCopy={(e) => e.preventDefault()}
                                onCut={(e) => e.preventDefault()}
                                onPaste={(e) => e.preventDefault()}
                            />
                        </div>

                        <Card className="max-w-md mx-auto bg-white shadow-sm">
                            <CardContent className="p-3">
                                <div className="grid grid-cols-3 gap-1.5">
                                    {[7, 8, 9, 4, 5, 6, 1, 2, 3].map((num) => (
                                        <Button
                                            key={num}
                                            variant="outline"
                                            className="h-12 text-base font-normal hover:bg-gray-100 border-gray-200"
                                            onClick={() =>
                                                handleKeyPress(num.toString())
                                            }
                                        >
                                            {num}
                                        </Button>
                                    ))}
                                    <Button
                                        variant="outline"
                                        className="h-12 text-base font-normal hover:bg-gray-100 border-gray-200"
                                        onClick={() => handleKeyPress("0")}
                                    >
                                        0
                                    </Button>
                                    {isDecimal && (
                                        <Button
                                            variant="outline"
                                            className="h-12 text-base font-normal hover:bg-gray-100 border-gray-200"
                                            onClick={() => handleKeyPress(".")}
                                            disabled={numericValue.includes(
                                                "."
                                            )}
                                        >
                                            .
                                        </Button>
                                    )}
                                    <Button
                                        variant="outline"
                                        className="h-12 text-base font-normal hover:bg-gray-100 border-gray-200"
                                        onClick={() =>
                                            handleKeyPress("backspace")
                                        }
                                    >
                                        ←
                                    </Button>
                                </div>

                                <div className="grid grid-cols-2 gap-1.5 mt-1.5">
                                    <Button
                                        variant="outline"
                                        className="h-12 text-base font-normal hover:bg-gray-100 border-gray-200"
                                        onClick={() => handleKeyPress("clear")}
                                    >
                                        {t("questionSlide.numericPad.clear")}
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                );

            default:
                return <p>{t("questionSlide.unsupportedType", { type: questionType })}</p>;
        }
    };

    // Update the isSubmitDisabled logic
    const isSubmitDisabled =
        isSubmitting ||
        unchangedSinceSubmit ||
        ((questionType === "MCQS" || questionType === "TRUE_FALSE") &&
            !selectedOption) ||
        (questionType === "MCQM" && selectedOptions.length === 0) ||
        ((questionType === "ONE_WORD" || questionType === "LONG_ANSWER") &&
            !inputValue.trim()) ||
        (questionType === "NUMERIC" && !numericValue.trim());

    return (
        <div className="w-full bg-white rounded-lg shadow-sm p-4 sm:p-6">
            <h2 className="text-lg sm:text-xl font-medium text-gray-900 mb-2 sm:mb-3">
                {t("questionSlide.questionLabel")}
            </h2>
            {/* Render the question's rich HTML on its own (NOT inside the <h2>):
                it can contain block content like ordered/bulleted lists, which
                are invalid in a heading and lose their markers/indentation
                without the `rich-text-content` list styles (index.css). */}
            <div
                className="rich-text-content text-base text-gray-800 mb-3 sm:mb-4"
                dangerouslySetInnerHTML={{
                    __html: questionData?.text_data?.content || "",
                }}
            />

            {/* Parent rich text content if available */}
            {questionData?.parent_rich_text?.content && (
                <div
                    className="rich-text-content mb-4 p-4 bg-gray-50 rounded-lg border border-gray-200"
                    dangerouslySetInnerHTML={{
                        __html: questionData.parent_rich_text.content,
                    }}
                />
            )}

            <div className="mt-4 sm:mt-6">
                <h3 className="text-base sm:text-lg font-medium text-gray-700 mb-2 sm:mb-3">
                    {questionType === "MCQS"
                        ? t("questionSlide.prompts.mcqs")
                        : questionType === "TRUE_FALSE"
                          ? t("questionSlide.prompts.trueFalse")
                          : questionType === "MCQM"
                            ? t("questionSlide.prompts.mcqm")
                            : questionType === "ONE_WORD"
                              ? t("questionSlide.prompts.oneWord")
                              : questionType === "LONG_ANSWER"
                                ? t("questionSlide.prompts.longAnswer")
                                : t("questionSlide.prompts.numeric")}
                </h3>

                {renderQuestionContent()}
            </div>

            <div className="mt-6 flex justify-center">
                <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={isSubmitDisabled}
                    className={`px-6 py-2.5 rounded-md text-sm sm:text-base font-medium transition-colors ${
                        isSubmitDisabled
                            ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                            : "bg-gray-900 text-white hover:bg-gray-800"
                    }`}
                >
                    {isSubmitting
                        ? t("questionSlide.buttons.submitting")
                        : unchangedSinceSubmit
                          ? t("questionSlide.buttons.submitted")
                          : hasSubmitted
                            ? t("questionSlide.buttons.resubmit")
                            : t("questionSlide.buttons.submit")}
                </button>
            </div>

            {/* Answer guidance (explanation_text_data). Locked until the learner
                submits — it can NEVER be read before an attempt. After submit it
                auto-expands and can be collapsed/re-opened for self-checking. */}
            {hasSubmitted &&
                questionData?.explanation_text_data?.content?.trim() && (
                <div className="mt-6 w-full">
                    <button
                        type="button"
                        onClick={() =>
                            setShowExplanationMap((prev) => ({
                                ...prev,
                                [slideId]: !showExplanation,
                            }))
                        }
                        className="text-sm font-medium text-primary-500 transition-colors hover:text-primary-400"
                    >
                        {showExplanation
                            ? t("questionSlide.explanation.hide")
                            : t("questionSlide.explanation.show")}
                    </button>

                    {showExplanation && (
                        <div
                            className="rich-text-content mt-3 rounded-lg border border-neutral-200 bg-neutral-50 p-4 text-neutral-700"
                            dangerouslySetInnerHTML={{
                                __html: questionData.explanation_text_data
                                    .content,
                            }}
                        />
                    )}
                </div>
            )}
        </div>
    );
};

export default QuestionSlide;