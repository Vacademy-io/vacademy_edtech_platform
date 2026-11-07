import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { Pie, PieChart } from "recharts";
import { useTranslation } from "react-i18next";

interface ResponseData {
  attempted: number;
  skipped: number;
}

export function ResponseBreakdownComponent({
  responseData,
}: {
  responseData: ResponseData;
}) {
  const { t } = useTranslation("testRecords");
  const chartConfig = {
    correct: {
      label: t("common.correct"),
      color: "hsl(var(--chart-1))",
    },
    skipped: {
      label: t("common.skipped"),
      color: "hsl(var(--chart-4))",
    },
  } satisfies ChartConfig;
  const chartData = [
    {
      responseType: "Attempted",
      value: responseData.attempted,
      fill: "#97D4B4", // design-lint-ignore: chart series colors
    },
    {
      responseType: "skipped",
      value: responseData.skipped,
      fill: "#EEE", // design-lint-ignore: chart series colors
    },
  ];
  return (
    <ChartContainer
      config={chartConfig}
      className="mx-auto aspect-square h-reg-180"
    >
      <PieChart>
        <ChartTooltip
          cursor={false}
          content={<ChartTooltipContent hideLabel />}
        />
        <Pie
          data={chartData}
          dataKey="value"
          nameKey="responseType"
          innerRadius={42}
          strokeWidth={2}
        />
      </PieChart>
    </ChartContainer>
  );
}

import { parseHtmlToString } from "@/lib/utils";
import type { TFunction } from "i18next";

// Function to render student response based on question type
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const renderStudentResponse = (review: any, t: TFunction) => {
  console.log("review ", review);
  if (!review.student_response_options) return <p>{t("questionResponseRenderer.noResponse")}</p>;

  try {
    // Parse the JSON string
    const responseData =
      typeof review.student_response_options === "string"
        ? JSON.parse(review.student_response_options)
        : review.student_response_options;
    console.log("responseData ", responseData);
    console.log("review.question_type ", review.question_type);
    console.log("review.student_response_options ", responseData.responseData);
    switch (review.question_type) {
      case "ONE_WORD":
        return <p>{responseData.responseData?.answer || t("questionResponseRenderer.noResponse")}</p>;

      case "LONG_ANSWER":
        return <p>{responseData.responseData?.answer || t("questionResponseRenderer.noResponse")}</p>;

      case "NUMERIC":
        return (
          <p>
            {responseData.responseData?.validAnswer?.toString() ||
              t("questionResponseRenderer.noResponse")}
          </p>
        );

      case "MCQS":
      case "TRUE_FALSE":
        if (responseData.responseData?.optionIds?.length) {
          return <p>{responseData.responseData.optionIds.join(", ")}</p>;
        }
        return <p>{t("questionResponseRenderer.noOptionSelected")}</p>;

      case "MCQM":
        if (responseData.responseData?.optionIds?.length) {
          return <p>{responseData.responseData.optionIds.join(", ")}</p>;
        }
        return <p>{t("questionResponseRenderer.noOptionsSelected")}</p>;

      default:
        if (Array.isArray(review.student_response_options)) {
          return review.student_response_options.map(
            (option: any, idx: number) => (
              <p key={idx}>{parseHtmlToString(option.option_name)}</p>
            )
          );
        }
        return (
          <p>{JSON.stringify(responseData.responseData) || t("questionResponseRenderer.noResponse")}</p>
        );
    }
  } catch (error) {
    console.error("Error parsing student response:", error);
    return <p>{t("responseBreakdown.errorDisplayingResponseWithError", { error: String(error) })}</p>;
  }
};

// Function to render correct answer based on question type
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const renderCorrectAnswer = (review: any, t: TFunction) => {
  if (!review.correct_options) return <p>{t("questionResponseRenderer.noCorrectAnswerProvided")}</p>;

  try {
    // Parse the JSON string
    const correctData =
      typeof review.correct_options === "string"
        ? JSON.parse(review.correct_options)
        : review.correct_options;

    switch (review.question_type) {
      case "ONE_WORD":
        return <p>{correctData.data?.answer || t("questionResponseRenderer.noAnswerProvided")}</p>;

      case "LONG_ANSWER":
        if (correctData.data?.answer?.content) {
          return <p>{parseHtmlToString(correctData.data.answer.content)}</p>;
        }
        return <p>{t("questionResponseRenderer.noAnswerProvided")}</p>;

      case "NUMERIC":
        if (correctData.data?.validAnswers?.length) {
          return <p>{correctData.data.validAnswers.join(" or ")}</p>;
        }
        return <p>{t("questionResponseRenderer.noAnswerProvided")}</p>;

      case "MCQS":
      case "MCQM":
      case "TRUE_FALSE":
        if (correctData.data?.correctOptionIds?.length) {
          return <p>{correctData.data.correctOptionIds.join(", ")}</p>;
        }
        return <p>{t("questionResponseRenderer.noCorrectOptionsProvided")}</p>;

      default:
        if (Array.isArray(review.correct_options)) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return review.correct_options.map((option: any, idx: number) => (
            <p key={idx}>{parseHtmlToString(option.option_name)}</p>
          ));
        }
        return (
          <p>{JSON.stringify(correctData.data) || t("questionResponseRenderer.noAnswerProvided")}</p>
        );
    }
  } catch (error) {
    console.error("Error parsing correct answer:", error);
    return <p>{t("responseBreakdown.errorDisplayingCorrectAnswerWithError", { error: String(error) })}</p>;
  }
};
