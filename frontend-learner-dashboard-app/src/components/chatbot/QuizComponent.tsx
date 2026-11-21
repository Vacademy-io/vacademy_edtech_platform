import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Clock, CheckCircle, XCircle, CaretRight } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { QuizData, QuizSubmission } from "./types";

interface QuizComponentProps {
  quizData: QuizData;
  onSubmit: (submission: QuizSubmission) => void;
  disabled?: boolean;
}

export const QuizComponent: React.FC<QuizComponentProps> = ({
  quizData,
  onSubmit,
  disabled = false,
}) => {
  const { t } = useTranslation("chatFeatureB");
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [startTime] = useState(Date.now());
  const [timeRemaining, setTimeRemaining] = useState<number | null>(
    quizData.time_limit_seconds || null
  );
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [isSubmitted, setIsSubmitted] = useState(false);

  // Timer countdown
  useEffect(() => {
    if (!quizData.time_limit_seconds || isSubmitted) return;

    const interval = setInterval(() => {
      setTimeRemaining((prev) => {
        if (prev === null || prev <= 0) {
          clearInterval(interval);
          // Auto-submit when time runs out
          if (prev === 0) handleSubmit();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quizData.time_limit_seconds, isSubmitted]);

  const handleOptionSelect = (questionId: string, optionIndex: number) => {
    if (isSubmitted || disabled) return;
    setAnswers((prev) => ({ ...prev, [questionId]: optionIndex }));
  };

  const handleSubmit = () => {
    if (isSubmitted) return;
    setIsSubmitted(true);
    
    const timeTaken = Math.floor((Date.now() - startTime) / 1000);
    onSubmit({
      quiz_id: quizData.quiz_id,
      answers,
      time_taken_seconds: timeTaken,
    });
  };

  const goToNextQuestion = () => {
    if (currentQuestion < quizData.questions.length - 1) {
      setCurrentQuestion(currentQuestion + 1);
    }
  };

  const goToPrevQuestion = () => {
    if (currentQuestion > 0) {
      setCurrentQuestion(currentQuestion - 1);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const answeredCount = Object.keys(answers).length;
  const allAnswered = answeredCount === quizData.total_questions;
  const currentQ = quizData.questions[currentQuestion];

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-gradient-to-br from-primary/5 to-primary/10 border border-primary/20 rounded-xl p-4 my-3"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-semibold text-foreground text-sm">
            {quizData.title}
          </h3>
          <p className="text-xs text-muted-foreground">
            {quizData.topic} • {quizData.total_questions} questions
          </p>
        </div>
        
        {timeRemaining !== null && (
          <div
            className={cn(
              "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium",
              timeRemaining <= 60
                ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                : "bg-primary/10 text-primary"
            )}
          >
            <Clock className="h-3 w-3" />
            {formatTime(timeRemaining)}
          </div>
        )}
      </div>

      {/* Progress dots */}
      <div className="flex items-center gap-1.5 mb-4">
        {quizData.questions.map((q, idx) => (
          <button
            key={q.id}
            onClick={() => setCurrentQuestion(idx)}
            className={cn(
              "w-6 h-6 rounded-full text-xs font-medium transition-all flex items-center justify-center",
              idx === currentQuestion
                ? "bg-primary text-primary-foreground scale-110"
                : answers[q.id] !== undefined
                ? "bg-green-500 text-white"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            )}
          >
            {answers[q.id] !== undefined ? (
              <CheckCircle className="h-3.5 w-3.5" />
            ) : (
              idx + 1
            )}
          </button>
        ))}
      </div>

      {/* Current Question */}
      <div className="bg-background rounded-lg p-4 mb-4">
        <div className="flex items-start gap-2 mb-3">
          <span className="bg-primary/10 text-primary text-xs font-bold px-2 py-0.5 rounded">
            {t("quiz.questionLabel", { number: currentQuestion + 1 })}
          </span>
        </div>
        
        <div className="prose prose-sm dark:prose-invert max-w-none mb-4">
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={[rehypeKatex]}
          >
            {currentQ.question}
          </ReactMarkdown>
        </div>

        {/* Options */}
        <div className="space-y-2">
          {currentQ.options.map((option, optIdx) => {
            const isSelected = answers[currentQ.id] === optIdx;
            return (
              <button
                key={optIdx}
                onClick={() => handleOptionSelect(currentQ.id, optIdx)}
                disabled={isSubmitted || disabled}
                className={cn(
                  "w-full text-start p-3 rounded-lg border-2 transition-all",
                  "hover:border-primary/50 hover:bg-primary/5",
                  isSelected
                    ? "border-primary bg-primary/10"
                    : "border-border bg-background",
                  (isSubmitted || disabled) && "cursor-not-allowed opacity-60"
                )}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={cn(
                      "w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0",
                      isSelected
                        ? "border-primary bg-primary"
                        : "border-muted-foreground/30"
                    )}
                  >
                    {isSelected && (
                      <div className="w-2 h-2 rounded-full bg-white" />
                    )}
                  </div>
                  <div className="prose prose-sm dark:prose-invert max-w-none flex-1">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm, remarkMath]}
                      rehypePlugins={[rehypeKatex]}
                    >
                      {option}
                    </ReactMarkdown>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Navigation & Submit */}
      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground">
          {t("quiz.answeredCount", { answered: answeredCount, total: quizData.total_questions })}
        </div>

        <div className="flex items-center gap-2">
          {currentQuestion > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={goToPrevQuestion}
              className="h-8"
            >
              {t("quiz.previous")}
            </Button>
          )}

          {currentQuestion < quizData.questions.length - 1 ? (
            <Button
              size="sm"
              onClick={goToNextQuestion}
              className="h-8"
            >
              {t("quiz.next")} <CaretRight className="h-4 w-4 ms-1" />
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={!allAnswered || isSubmitted || disabled}
              className="h-8 bg-green-600 hover:bg-green-700"
            >
              {isSubmitted ? t("quiz.submitted") : t("quiz.submitQuiz")}
            </Button>
          )}
        </div>
      </div>
    </motion.div>
  );
};
