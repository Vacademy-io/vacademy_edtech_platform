import { Pie, PieChart } from "recharts";
import { useTranslation } from "react-i18next";
import {
    ChartConfig,
    ChartContainer,
    ChartTooltip,
    ChartTooltipContent,
} from "@/components/ui/chart";

interface MarksResponseDataInterface {
    correct: number;
    partiallyCorrect: number;
    wrongResponse: number;
    skipped: number;
}

export function MarksBreakdownComponent({ marksData }: { marksData: MarksResponseDataInterface }) {
    const { t } = useTranslation("testRecords");
    const chartConfig = {
        correct: {
            label: t("common.correct"),
            color: "hsl(var(--chart-1))",
        },
        partiallyCorrect: {
            label: t("marksBreakdown.partiallyCorrect"),
            color: "hsl(var(--chart-2))",
        },
        wrongResponse: {
            label: t("marksBreakdown.wrongResponse"),
            color: "hsl(var(--chart-3))",
        },
        skipped: {
            label: t("common.skipped"),
            color: "hsl(var(--chart-4))",
        },
    } satisfies ChartConfig;
    const chartData = [
        {
            responseType: "correct",
            value: marksData.correct,
            fill: "#97D4B4", // design-lint-ignore: chart series colors
        },
        {
            responseType: "partiallyCorrect",
            value: marksData.partiallyCorrect,
            fill: "#FFDD82", // design-lint-ignore: chart series colors
        },
        {
            responseType: "wrongResponse",
            value: marksData.wrongResponse,
            fill: "#F49898", // design-lint-ignore: chart series colors
        },
        {
            responseType: "skipped",
            value: marksData.skipped,
            fill: "#EEE", // design-lint-ignore: chart series colors
        },
    ];
    return (
        <ChartContainer config={chartConfig} className="mx-auto aspect-square h-reg-180">
            <PieChart>
                <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
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
