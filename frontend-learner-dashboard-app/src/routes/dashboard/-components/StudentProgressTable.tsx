import { Badge } from "@/components/ui/badge";
import { useTranslation } from "react-i18next";
import { formatTimeFromMillis } from "@/helpers/formatTimeFromMiliseconds";
import { getTerminology } from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";
import { UserActivityArray } from "../-types/dashboard-data-types";
import dayjs from "dayjs";
import { TrendDown, TrendUp, Minus } from "@phosphor-icons/react";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface StudentProgress {
    date: string;
    time_spent: string;
    time_spent_batch: string;
    raw_date: string;
    status: string;
    user_millis: number;
    batch_millis: number;
    performance_trend: 'up' | 'down' | 'neutral';
}

export const StudentProgressTable = ({ userActivity }: { userActivity: UserActivityArray }) => {
    const { t } = useTranslation("dashboard");
    // Batch is institute-configurable naming; compose it, never bake it in.
    const batchTerm = getTerminology(ContentTerms.Batch, SystemTerms.Batch);
    // Transform API data for the table.
    // NOTE: `status` stays an untranslated internal discriminator ("Above" /
    // "Below" / "Average") — it drives comparisons below. Only the rendered
    // badge label is localized.
    const tableData: StudentProgress[] = userActivity.map((item) => {
        const userTime = item.time_spent_by_user_millis;
        const batchAvg = item.avg_time_spent_by_batch_millis;

        // Determine status based oncomparison with batch average
        let status = "Average";
        let performance_trend: 'up' | 'down' | 'neutral' = 'neutral';

        if (userTime > batchAvg * 1.2) {
            status = "Above";
            performance_trend = 'up';
        } else if (userTime < batchAvg * 0.8) {
            status = "Below";
            performance_trend = 'down';
        }

        return {
            raw_date: item.activity_date,
            date: dayjs(item.activity_date).format("MMM DD"),
            time_spent: formatTimeFromMillis(userTime),
            time_spent_batch: formatTimeFromMillis(batchAvg),
            status,
            user_millis: userTime,
            batch_millis: batchAvg,
            performance_trend
        };
    });

    // Sort by date, newest first
    tableData.sort((a, b) => new Date(b.raw_date).getTime() - new Date(a.raw_date).getTime());

    // Loading state
    if (!userActivity.length) {
        return (
            <div className="space-y-4">
                {[1, 2, 3].map((i) => (
                    <div key={i} className="flex items-center space-x-4 p-4 border rounded-lg">
                        <div className="w-16 h-4 bg-muted rounded animate-pulse"></div>
                        <div className="w-20 h-4 bg-muted rounded animate-pulse"></div>
                        <div className="w-20 h-4 bg-muted rounded animate-pulse"></div>
                        <div className="w-24 h-4 bg-muted rounded animate-pulse"></div>
                    </div>
                ))}
            </div>
        );
    }

    const getStatusBadge = (status: string) => {
        switch (status) {
            case "Above":
                return <Badge variant="outline" className="border-green-500/30 text-green-600 bg-green-500/5 hover:bg-green-500/10 [.ui-vibrant_&]:bg-green-100 [.ui-vibrant_&]:text-green-800 [.ui-play_&]:bg-play-success-soft [.ui-play_&]:text-play-success-soft-ink [.ui-play_&]:border-0 [.ui-play_&]:font-bold [.ui-play_&]:rounded-full"><TrendUp size={12} className="me-1" /> {t("progressTable.statusAbove")}</Badge>;
            case "Below":
                return <Badge variant="outline" className="border-red-500/30 text-red-600 bg-red-500/5 hover:bg-red-500/10 [.ui-vibrant_&]:bg-red-100 [.ui-vibrant_&]:text-red-800 [.ui-play_&]:bg-play-danger-soft [.ui-play_&]:text-play-danger-soft-ink [.ui-play_&]:border-0 [.ui-play_&]:font-bold [.ui-play_&]:rounded-full"><TrendDown size={12} className="me-1" /> {t("progressTable.statusBelow")}</Badge>;
            default:
                return <Badge variant="outline" className="text-muted-foreground [.ui-vibrant_&]:bg-gray-100 [.ui-vibrant_&]:text-gray-700 [.ui-play_&]:bg-play-ink/5 [.ui-play_&]:text-play-ink/60 [.ui-play_&]:border-0 [.ui-play_&]:font-bold [.ui-play_&]:rounded-full"><Minus size={12} className="me-1" /> {t("progressTable.statusAverage")}</Badge>;
        }
    };

    const getProgressBarColor = (percentage: number) => {
        if (percentage >= 120) return "bg-green-500 [.ui-vibrant_&]:bg-green-400 [.ui-play_&]:bg-play-success";
        if (percentage >= 100) return "bg-primary [.ui-vibrant_&]:bg-indigo-400 [.ui-play_&]:bg-play-info";
        if (percentage >= 80) return "bg-primary/70 [.ui-play_&]:bg-play-warn";
        return "bg-yellow-500 [.ui-vibrant_&]:bg-yellow-400 [.ui-play_&]:bg-play-danger";
    };

    return (
        <div className="space-y-6 relative overflow-hidden">
            {/* Summary Stats */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 relative">
                <Card className="shadow-none border-dashed bg-muted/30 [.ui-vibrant_&]:bg-gray-100/50 [.ui-play_&]:bg-white [.ui-play_&]:border [.ui-play_&]:border-solid [.ui-play_&]:border-border [.ui-play_&]:rounded-play-card-sm [.ui-play_&]:shadow-play-soft-card [.ui-cleaner-play_&]:border-solid [.ui-cleaner-play_&]:border-cp-border">
                    <CardContent className="p-card flex flex-col gap-1">
                        <span className="text-sm font-medium text-muted-foreground">
                            {t("progressTable.totalSessions")}
                        </span>
                        <div className="text-2xl font-bold tracking-tight">
                            {tableData.filter(row => row.user_millis > 0).length}
                        </div>
                    </CardContent>
                </Card>

                <Card className="shadow-none border-dashed bg-green-500/5 border-green-500/20 [.ui-vibrant_&]:bg-green-50 [.ui-vibrant_&]:border-green-200 [.ui-play_&]:bg-play-success-soft [.ui-play_&]:border [.ui-play_&]:border-solid [.ui-play_&]:border-border [.ui-play_&]:rounded-play-card-sm [.ui-play_&]:shadow-play-soft-card [.ui-cleaner-play_&]:border-solid [.ui-cleaner-play_&]:border-cp-border">
                    <CardContent className="p-card flex flex-col gap-1">
                        <span className="text-sm font-medium text-green-600 [.ui-vibrant_&]:text-green-700 [.ui-play_&]:text-play-success-soft-ink [.ui-play_&]:font-black">
                            {t("progressTable.aboveAverage")}
                        </span>
                        <div className="text-2xl font-bold text-foreground">
                            {tableData.filter(row => row.status === "Above").length}
                        </div>
                    </CardContent>
                </Card>

                <Card className="shadow-none border-dashed bg-primary/5 border-primary/20 [.ui-vibrant_&]:bg-primary/10 [.ui-vibrant_&]:border-primary/30 [.ui-play_&]:bg-play-accent-soft [.ui-play_&]:border [.ui-play_&]:border-solid [.ui-play_&]:border-border [.ui-play_&]:rounded-play-card-sm [.ui-play_&]:shadow-play-soft-card [.ui-cleaner-play_&]:border-solid [.ui-cleaner-play_&]:border-cp-border">
                    <CardContent className="p-card flex flex-col gap-1">
                        <span className="text-sm font-medium text-primary [.ui-vibrant_&]:text-primary-700 [.ui-play_&]:text-play-accent-soft-ink [.ui-play_&]:font-black">
                            {t("progressTable.consistency")}
                        </span>
                        <div className="text-2xl font-bold text-foreground">
                            {Math.round((tableData.filter(row => row.user_millis > 0).length / tableData.length) * 100)}%
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Desktop Table */}
            <div className="hidden sm:block rounded-md border shadow-sm [.ui-vibrant_&]:border-primary/10 [.ui-play_&]:bg-white [.ui-play_&]:border-border [.ui-play_&]:rounded-play-card-sm [.ui-play_&]:overflow-hidden [.ui-play_&]:shadow-play-soft-card [.ui-cleaner-play_&]:border-cp-border">
                <Table>
                    <TableHeader>
                        <TableRow className="bg-muted/40 hover:bg-muted/40 [.ui-vibrant_&]:bg-primary/5">
                            <TableHead className="w-44 font-semibold text-xs uppercase text-muted-foreground">
                                {t("progressTable.columnDate")}
                            </TableHead>
                            <TableHead className="font-semibold text-xs uppercase text-muted-foreground">
                                {t("progressTable.columnYourTime")}
                            </TableHead>
                            <TableHead className="font-semibold text-xs uppercase text-muted-foreground">
                                {t("progressTable.columnBatchAvg", { batch: batchTerm })}
                            </TableHead>
                            <TableHead className="text-end font-semibold text-xs uppercase text-muted-foreground">
                                {t("progressTable.columnStatus")}
                            </TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {tableData.map((row, index) => {
                            const percentage = row.batch_millis > 0 ? ((row.user_millis / row.batch_millis) * 100) : 100;
                            const isToday = dayjs(row.raw_date).isSame(dayjs(), 'day');

                            return (
                                <TableRow key={index} className={cn("transition-colors", isToday && "bg-muted/30 [.ui-vibrant_&]:bg-blue-50/50 [.ui-play_&]:bg-play-gold-soft")}>
                                    <TableCell>
                                        <div className="flex items-center gap-3">
                                            {isToday && <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />}
                                            <div className="flex flex-col">
                                                <span className="font-medium text-sm">{row.date}</span>
                                                <span className="text-xs text-muted-foreground">{dayjs(row.raw_date).format("dddd")}</span>
                                            </div>
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <div className="space-y-1.5 w-36">
                                            <div className="font-medium text-sm">{row.time_spent}</div>
                                            <div className="h-1.5 w-full bg-secondary rounded-full overflow-hidden">
                                                <div
                                                    className={cn(
                                                        "h-full rounded-full transition-all duration-500",
                                                        getProgressBarColor(percentage)
                                                    )}
                                                    style={{ width: `${Math.min(percentage, 100)}%` }}
                                                />
                                            </div>
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <span className="text-sm text-muted-foreground">{row.time_spent_batch}</span>
                                    </TableCell>
                                    <TableCell className="text-end">
                                        {getStatusBadge(row.status)}
                                    </TableCell>
                                </TableRow>
                            );
                        })}
                    </TableBody>
                </Table>
            </div>

            {/* Mobile Card View */}
            <div className="block sm:hidden space-y-3">
                {tableData.map((row, index) => {
                    const percentage = row.batch_millis > 0 ? ((row.user_millis / row.batch_millis) * 100) : 100;
                    return (
                        <Card key={index} className="shadow-none border">
                            <CardContent className="p-card space-y-3">
                                <div className="flex justify-between items-start">
                                    <div className="flex flex-col">
                                        <span className="font-semibold">{row.date}</span>
                                        <span className="text-xs text-muted-foreground">{dayjs(row.raw_date).format("dddd")}</span>
                                    </div>
                                    {getStatusBadge(row.status)}
                                </div>

                                <div className="space-y-2 pt-2">
                                    <div className="flex justify-between text-sm">
                                        <span className="text-muted-foreground">
                                            {t("progressTable.columnYourTime")}
                                        </span>
                                        <span className="font-medium">{row.time_spent}</span>
                                    </div>
                                    <div className="h-1.5 w-full bg-secondary rounded-full overflow-hidden">
                                        <div
                                            className={`h-full rounded-full ${getProgressBarColor(percentage)}`}
                                            style={{ width: `${Math.min(percentage, 100)}%` }}
                                        />
                                    </div>
                                    <div className="flex justify-between text-xs text-muted-foreground">
                                        <span>
                                            {t("progressTable.batchAvgValue", {
                                                batch: batchTerm,
                                                value: row.time_spent_batch,
                                            })}
                                        </span>
                                        <span>
                                            {t("progressTable.percentOfAvg", {
                                                percent: percentage.toFixed(0),
                                            })}
                                        </span>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    );
                })}
            </div>
        </div>
    );
};