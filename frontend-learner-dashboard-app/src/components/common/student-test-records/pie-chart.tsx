import { PieChart as RechartsPieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import { useTranslation } from "react-i18next";

interface PieChartProps {
    data: {
        name: string;
        value: number;
        marks?: string | number;
        color: string;
    }[];
    width: number;
    height: number;
}

export function PieChart({ data, width, height }: PieChartProps) {
    const { t } = useTranslation("testRecords");
    return (
        <div className="flex flex-col items-center gap-10">
            <div style={{ width, height }}>
                <ResponsiveContainer>
                    <RechartsPieChart>
                        <Pie
                            data={data}
                            cx="50%"
                            cy="40%" // Adjusted to center the pie chart vertically
                            innerRadius={48}
                            outerRadius={80}
                            dataKey="value"
                        >
                            {data.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={entry.color} />
                            ))}
                        </Pie>
                    </RechartsPieChart>
                </ResponsiveContainer>
            </div>
            <div className="flex flex-col gap-4">
                {data && data.length > 0 ? (
                    data.map((obj, key) => (
                        <div key={key} className="flex items-center gap-4">
                            <div
                                style={{ backgroundColor: obj.color }}
                                className="size-6 rounded-full"
                            ></div>
                            <div className="flex items-center gap-2 text-subtitle">
                                <div>{obj.name}:</div>
                                <div>
                                    {obj.value}
                                    {obj.marks && ` (${obj.marks})`}
                                </div>
                            </div>
                        </div>
                    ))
                ) : (
                    <p className="py-4 text-center text-subtitle">{t("pieChart.noData")}</p>
                )}
            </div>
        </div>
    );
}
