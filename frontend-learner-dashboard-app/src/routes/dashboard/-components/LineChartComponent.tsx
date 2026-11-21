import { ChartConfig, ChartContainer, ChartTooltip } from "@/components/ui/chart";
import { LineChart, CartesianGrid, XAxis, YAxis, Line, ResponsiveContainer } from "recharts";
import dayjs from "dayjs";
import { useTranslation } from "react-i18next";
import { UserActivityArray } from "../-types/dashboard-data-types";
import { formatTimeFromMillis, millisToMinutes } from "@/helpers/formatTimeFromMiliseconds";
import { Badge } from "@/components/ui/badge";
import { Calendar, Clock, TrendUp, Users } from "@phosphor-icons/react";
import { usePlayTheme } from "@/hooks/use-play-theme";
import { useCleanerPlayTheme } from "@/hooks/use-cleaner-play-theme";
import { cn } from "@/lib/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";
import { getTerminology } from "@/components/common/layout-container/sidebar/utils";

export interface ChartDataType {
    activity_date: string;
    avg_daily_time_minutes: number;
    avg_daily_time_minutes_batch: number;
    time_spent_by_user_millis: number;
    avg_time_spent_by_batch_millis: number;
}

export const LineChartComponent = ({ userActivity }: { userActivity: UserActivityArray }) => {
    const { t } = useTranslation("dashboard");
    const isPlay = usePlayTheme();
    const isCleanerPlay = useCleanerPlayTheme();
    const batchLabel = getTerminology(ContentTerms.Batch, SystemTerms.Batch);

    // Truly empty (API returned no rows): a friendly note beats bare axes.
    if (!userActivity.length) {
        return (
            <div className={cn(
                "rounded-lg border border-border bg-muted/40 p-6 text-center sm:rounded-xl",
                isCleanerPlay && "!border-cp-border !bg-cp-bg-deep",
                isPlay && "!bg-white/60 !border-transparent"
            )}>
                <p className="text-sm font-medium text-muted-foreground">
                    {t("activityChart.emptyMessage")}
                </p>
            </div>
        );
    }

    // ONE data accent: the learner's own line. The batch comparison line is
    // neutral in every mode so the chart reads "you vs a quiet reference".
    const userLineColor = isPlay ? "var(--play-c-info)" : "hsl(var(--primary))";
    const batchLineColor = isPlay ? "var(--play-c-muted)" : "hsl(var(--muted-foreground))";
    const gridColor = isPlay ? "var(--play-c-surface)" : "hsl(var(--border))";
    const bgColor = "hsl(var(--background))";

    const chartConfig = {
        avg_daily_time_minutes: {
            label: t("activityChart.yourTime"),
            color: "hsl(var(--primary))",
        },
        avg_daily_time_minutes_batch: {
            label: t("activityChart.batchAverage", { batch: batchLabel }),
            color: "hsl(var(--muted-foreground))",
        },
    } satisfies ChartConfig;

    // Transform API data to chart data format and preserve original millisecond values
    const chartData = userActivity.map(item => ({
        activity_date: item.activity_date,
        avg_daily_time_minutes: millisToMinutes(item.time_spent_by_user_millis),
        avg_daily_time_minutes_batch: millisToMinutes(item.avg_time_spent_by_batch_millis),
        time_spent_by_user_millis: item.time_spent_by_user_millis,
        avg_time_spent_by_batch_millis: item.avg_time_spent_by_batch_millis
    }));

    // Sort data by date to ensure correct order
    chartData.sort((a, b) => new Date(a.activity_date).getTime() - new Date(b.activity_date).getTime());

    // Calculate performance metrics
    const totalUserTime = chartData.reduce((acc, curr) => acc + curr.avg_daily_time_minutes, 0);
    const totalBatchTime = chartData.reduce((acc, curr) => acc + curr.avg_daily_time_minutes_batch, 0);
    const avgUserTime = totalUserTime / chartData.length;
    const avgBatchTime = totalBatchTime / chartData.length;
    const performanceRatio = avgBatchTime > 0 ? (avgUserTime / avgBatchTime) : 0;

    // Honesty gate: only judge the learner when there is activity to judge.
    const hasActivity = chartData.some(d => d.time_spent_by_user_millis > 0);

    const getPerformanceStatus = () => {
        if (!hasActivity) {
            // New learner with zero recorded activity: neutral, no warning color.
            return {
                text: t("activityChart.status.justStarting"),
                color: "bg-muted/60 text-muted-foreground border-border [.ui-play_&]:bg-play-surface [.ui-play_&]:text-play-ink [.ui-play_&]:border-transparent",
            };
        }
        if (performanceRatio >= 1.2) return { text: t("activityChart.status.excellent"), color: "bg-success-50 text-success-700 border-success-200 [.ui-vibrant_&]:bg-success-100" };
        if (performanceRatio >= 1.0) return { text: t("progressTable.aboveAverage"), color: "bg-success-50 text-success-600 border-success-200 [.ui-vibrant_&]:bg-success-100" };
        if (performanceRatio >= 0.8) return { text: t("activityChart.status.onTrack"), color: "bg-info-50 text-info-700 border-info-200 [.ui-vibrant_&]:bg-info-100" };
        return { text: t("activityChart.status.needsFocus"), color: "bg-warning-50 text-warning-700 border-warning-200 [.ui-vibrant_&]:bg-warning-100" };
    };

    const performanceStatus = getPerformanceStatus();

    return (
        <div className="space-y-3 sm:space-y-5">
            {/* Enhanced Header with Performance Metrics */}
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-stack sm:gap-4">
                <div className="flex items-center space-x-3">
                    <div className={cn(
                        "p-2 bg-primary/10 rounded-lg [.ui-play_&]:bg-play-surface [.ui-play_&]:rounded-xl",
                        isCleanerPlay && "!bg-cp-sage-tint !rounded-xl"
                    )}>
                        <TrendUp size={18} className={cn(
                            "text-primary [.ui-play_&]:text-play-ink",
                            isCleanerPlay && "!text-cp-sage"
                        )} />
                    </div>
                    <div className="min-w-0">
                        <h3 className={cn(
                            "text-base sm:text-lg font-semibold text-foreground [.ui-play_&]:font-black [.ui-play_&]:text-play-ink",
                            isCleanerPlay && "cp-heading !text-body"
                        )}>{t("activityChart.title")}</h3>
                        <p className={cn(
                            "text-xs sm:text-sm text-muted-foreground flex items-center space-x-1",
                            isCleanerPlay && "cp-muted !text-caption"
                        )}>
                            <Calendar size={12} className="flex-shrink-0" />
                            <span>{t("activityChart.subtitle")}</span>
                        </p>
                    </div>
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center space-y-2 sm:space-y-0 sm:space-x-3">
                    <Badge className={`${performanceStatus.color} border text-xs sm:text-sm font-medium px-2 sm:px-3 py-1 [.ui-play_&]:font-black [.ui-play_&]:rounded-full [.ui-play_&]:shadow-play-badge`}>
                        {performanceStatus.text}
                    </Badge>
                    {hasActivity && chartData.length > 0 && (
                        <div className={cn(
                            "hidden md:flex items-center space-x-4 bg-muted/40 rounded-lg px-3 sm:px-4 py-2 border border-border [.ui-play_&]:rounded-xl",
                            isCleanerPlay && "!bg-cp-bg-deep !border-cp-border !rounded-xl"
                        )}>
                            <div className="flex items-center space-x-2 text-xs sm:text-sm">
                                <div className="w-2 sm:w-3 h-2 sm:h-3 rounded-full bg-primary [.ui-play_&]:bg-play-info"></div>
                                <span className="text-foreground font-medium tabular-nums [.ui-play_&]:text-play-ink">
                                    {t("activityChart.avgLabel", { time: formatTimeFromMillis(avgUserTime * 60 * 1000, 'minutes') })}
                                </span>
                            </div>
                            <div className="w-px h-3 sm:h-4 bg-border"></div>
                            <div className="flex items-center space-x-2 text-xs sm:text-sm">
                                <Users size={12} className="text-muted-foreground" />
                                <span className="text-foreground font-medium tabular-nums [.ui-play_&]:text-play-ink">
                                    {formatTimeFromMillis(avgBatchTime * 60 * 1000, 'minutes')}
                                </span>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Enhanced Legend */}
            <div className={cn(
                "flex flex-wrap items-center gap-3 sm:gap-4 p-3 sm:p-4 bg-muted/40 rounded-lg sm:rounded-xl border border-border [.ui-play_&]:rounded-xl",
                isCleanerPlay && "!bg-cp-bg-deep !border-cp-border"
            )}>
                <div className="flex items-center space-x-2">
                    <div className="w-3 sm:w-4 h-0.5 sm:h-1 rounded-full bg-primary [.ui-play_&]:bg-play-info"></div>
                    <span className="text-xs sm:text-sm font-medium text-foreground [.ui-play_&]:text-play-ink">{t("activityChart.yourStudyTime")}</span>
                </div>
                <div className="flex items-center space-x-2">
                    <div className="w-3 sm:w-4 h-0.5 sm:h-1 rounded-full bg-muted-foreground [.ui-play_&]:bg-play-muted"></div>
                    <span className="text-xs sm:text-sm font-medium text-foreground [.ui-play_&]:text-play-ink">{t("activityChart.batchAverage", { batch: batchLabel })}</span>
                </div>
                <div className="ms-auto flex items-center space-x-1 text-xs text-muted-foreground">
                    <Clock size={10} className="sm:w-3 sm:h-3" />
                    <span>{t("activityChart.realTimeData")}</span>
                </div>
            </div>

            {/* Enhanced Chart Container */}
            <div className="relative w-full max-w-full overflow-hidden">
                {/* Background pattern */}
                <div className="absolute inset-0 rounded-lg sm:rounded-xl bg-transparent"></div>

                <div className={cn(
                    "relative bg-white/50 backdrop-blur-sm rounded-lg sm:rounded-xl border border-gray-200/40 p-2 sm:p-4 overflow-hidden w-full max-w-full [.ui-play_&]:bg-white [.ui-play_&]:border-play-surface [.ui-play_&]:rounded-xl",
                    isCleanerPlay && "!bg-cp-surface !border-cp-border"
                )}>
                    <ResponsiveContainer width="100%" height={280}>
                        <ChartContainer config={chartConfig} className="w-full h-full overflow-hidden">
                            <LineChart
                                data={chartData}
                                margin={{
                                    left: 0,
                                    right: 0,
                                    bottom: 20,
                                    top: 5,
                                }}
                                className="w-full h-full"
                            >
                                {/* Gradients removed */}

                                <CartesianGrid
                                    vertical={false}
                                    strokeDasharray="3 3"
                                    stroke={gridColor}
                                    opacity={0.3}
                                    className="animate-gentle-pulse"
                                />

                                <XAxis
                                    dataKey="activity_date"
                                    tickLine={false}
                                    axisLine={false}
                                    tickMargin={4}
                                    tick={{
                                        fontSize: 9,
                                        fill: 'hsl(var(--muted-foreground))',
                                        fontWeight: 500
                                    }}
                                    tickFormatter={(value) => dayjs(value).format("MMM DD")}
                                    interval={'preserveStartEnd'}
                                    angle={-35}
                                    textAnchor="end"
                                    height={40}
                                />

                                <YAxis
                                    tickLine={false}
                                    axisLine={false}
                                    tickMargin={4}
                                    width={35}
                                    tick={{
                                        fontSize: 8,
                                        fill: 'hsl(var(--muted-foreground))',
                                        fontWeight: 500
                                    }}
                                    tickFormatter={(value) => {
                                        const milliseconds = value * 60 * 1000;
                                        return formatTimeFromMillis(milliseconds, 'minutes');
                                    }}
                                />

                                <ChartTooltip
                                    cursor={{
                                        stroke: userLineColor,
                                        strokeDasharray: '4 4',
                                        strokeWidth: 2,
                                        opacity: 0.6
                                    }}
                                    content={({ active, payload, label }) => {
                                        if (active && payload && payload.length) {
                                            return (
                                                <div className="bg-background/95 backdrop-blur-sm border border-border rounded-lg sm:rounded-xl p-3 sm:p-4 shadow-lg max-w-xs">
                                                    <div className="flex items-center space-x-2 mb-2 sm:mb-3">
                                                        <Calendar size={12} className="text-muted-foreground flex-shrink-0" />
                                                        <p className="text-xs sm:text-sm font-semibold text-foreground">
                                                            {dayjs(label).format("dddd, MMM DD")}
                                                        </p>
                                                    </div>
                                                    <div className="space-y-1 sm:space-y-2">
                                                        {payload.map((entry, index) => {
                                                            const dataKey = entry.dataKey;
                                                            const originalMillis = dataKey === "avg_daily_time_minutes"
                                                                ? payload[0]?.payload?.time_spent_by_user_millis || 0
                                                                : payload[0]?.payload?.avg_time_spent_by_batch_millis || 0;

                                                            return (
                                                                <div key={`item-${index}`} className="flex items-center justify-between space-x-3 sm:space-x-4">
                                                                    <div className="flex items-center space-x-2">
                                                                        {/* Inline style allowed: swatch mirrors the dynamic recharts series color */}
                                                                        <div
                                                                            className="w-2 h-2 sm:w-3 sm:h-3 rounded-full shadow-sm"
                                                                            style={{ backgroundColor: entry.color }}
                                                                        />
                                                                        <span className="text-xs sm:text-sm text-muted-foreground font-medium">
                                                                            {entry.name}
                                                                        </span>
                                                                    </div>
                                                                    <span className="text-xs sm:text-sm font-semibold text-foreground tabular-nums">
                                                                        {formatTimeFromMillis(originalMillis, 'full')}
                                                                    </span>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>

                                                    {/* Performance indicator: only judge days the learner actually studied */}
                                                    {payload.length >= 2 && payload[0]?.value !== undefined && payload[1]?.value !== undefined && (payload[0]?.payload?.time_spent_by_user_millis || 0) > 0 && (
                                                        <div className="mt-2 sm:mt-3 pt-2 border-t border-border">
                                                            <div className="flex items-center justify-between text-xs">
                                                                <span className="text-muted-foreground">{t("activityChart.performanceVsBatch", { batch: batchLabel })}</span>
                                                                <span className={`font-semibold ${(payload[0].value || 0) >= (payload[1].value || 0) ? 'text-success-600' : 'text-muted-foreground'
                                                                    }`}>
                                                                    {(payload[0].value || 0) >= (payload[1].value || 0) ? t("activityChart.above") : t("activityChart.below")}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        }
                                        return null;
                                    }}
                                />

                                {/* Batch Average Line (neutral reference, background) */}
                                <Line
                                    dataKey="avg_daily_time_minutes_batch"
                                    type="monotone"
                                    name={t("activityChart.batchAverage", { batch: batchLabel })}
                                    stroke={batchLineColor}
                                    strokeWidth={2}
                                    strokeDasharray="6 4"
                                    dot={{
                                        fill: batchLineColor,
                                        r: 3,
                                        strokeWidth: 2,
                                        stroke: bgColor
                                    }}
                                    activeDot={{
                                        r: 5,
                                        stroke: batchLineColor,
                                        strokeWidth: 3,
                                        fill: bgColor,
                                        className: "animate-gentle-pulse"
                                    }}
                                />

                                {/* User Time Line (the single data accent, foreground) */}
                                <Line
                                    dataKey="avg_daily_time_minutes"
                                    type="monotone"
                                    name={t("activityChart.yourTime")}
                                    stroke={userLineColor}
                                    strokeWidth={isPlay ? 4 : 3}
                                    fill="none"
                                    dot={{
                                        fill: userLineColor,
                                        r: isPlay ? 5 : 4,
                                        strokeWidth: 3,
                                        stroke: bgColor
                                    }}
                                    activeDot={{
                                        r: isPlay ? 8 : 6,
                                        stroke: userLineColor,
                                        strokeWidth: 3,
                                        fill: bgColor,
                                        className: "animate-gentle-pulse"
                                    }}
                                />
                            </LineChart>
                        </ChartContainer>
                    </ResponsiveContainer>
                </div>
            </div>

            {/* Performance Insights: quiet neutral tiles when there is activity,
                a friendly note (no zeros, no judgment) when there is none yet */}
            {chartData.length > 0 && (
                hasActivity ? (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-stack sm:gap-4">
                        <div className={cn(
                            "bg-muted/40 rounded-lg p-3 sm:p-4 border border-border [.ui-play_&]:rounded-xl",
                            isCleanerPlay && "!bg-cp-bg-deep !border-cp-border !rounded-xl"
                        )}>
                            <div className="flex items-center space-x-2 mb-1">
                                <TrendUp size={14} className="text-muted-foreground" />
                                <span className="text-xs sm:text-sm font-semibold text-foreground [.ui-play_&]:font-black [.ui-play_&]:text-play-ink">{t("progressTable.consistency")}</span>
                            </div>
                            <p className="text-sm font-bold text-foreground tabular-nums [.ui-play_&]:text-play-ink">
                                {t("activityChart.activeDays", { active: chartData.filter(d => d.avg_daily_time_minutes > 0).length, total: chartData.length })}
                            </p>
                        </div>

                        <div className={cn(
                            "bg-muted/40 rounded-lg p-3 sm:p-4 border border-border [.ui-play_&]:rounded-xl",
                            isCleanerPlay && "!bg-cp-bg-deep !border-cp-border !rounded-xl"
                        )}>
                            <div className="flex items-center space-x-2 mb-1">
                                <Clock size={14} className="text-muted-foreground" />
                                <span className="text-xs sm:text-sm font-semibold text-foreground [.ui-play_&]:font-black [.ui-play_&]:text-play-ink">{t("activityChart.peakDay")}</span>
                            </div>
                            <p className="text-sm font-bold text-foreground tabular-nums [.ui-play_&]:text-play-ink">
                                {formatTimeFromMillis(Math.max(...chartData.map(d => d.time_spent_by_user_millis)), 'minutes')}
                            </p>
                        </div>

                        <div className={cn(
                            "bg-muted/40 rounded-lg p-3 sm:p-4 border border-border [.ui-play_&]:rounded-xl",
                            isCleanerPlay && "!bg-cp-bg-deep !border-cp-border !rounded-xl"
                        )}>
                            <div className="flex items-center space-x-2 mb-1">
                                <Users size={14} className="text-muted-foreground" />
                                <span className="text-xs sm:text-sm font-semibold text-foreground [.ui-play_&]:font-black [.ui-play_&]:text-play-ink">{t("activityChart.vsBatch", { batch: batchLabel })}</span>
                            </div>
                            <p className={cn(
                                "text-sm font-bold tabular-nums",
                                performanceRatio >= 1
                                    ? "text-success-600 [.ui-play_&]:text-play-success-deep"
                                    : "text-foreground [.ui-play_&]:text-play-ink"
                            )}>
                                {t("activityChart.percentDifference", {
                                    percent: `${performanceRatio > 1 ? '+' : ''}${((performanceRatio - 1) * 100).toFixed(0)}`,
                                })}
                            </p>
                        </div>
                    </div>
                ) : (
                    <div className={cn(
                        "rounded-lg sm:rounded-xl border border-border bg-muted/40 p-4 text-center [.ui-play_&]:rounded-xl",
                        isCleanerPlay && "!bg-cp-bg-deep !border-cp-border !rounded-xl"
                    )}>
                        <p className="text-sm font-medium text-muted-foreground">
                            {t("activityChart.emptyMessage")}
                        </p>
                    </div>
                )
            )}
        </div>
    );
};
