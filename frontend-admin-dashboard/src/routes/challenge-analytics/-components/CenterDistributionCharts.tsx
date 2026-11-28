import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartContainer, ChartTooltip } from '@/components/ui/chart';
import {
    Bar,
    BarChart,
    XAxis,
    YAxis,
    CartesianGrid,
    Cell,
    ResponsiveContainer,
    PieChart,
    Pie,
    Legend,
    Tooltip,
} from 'recharts';
import { MapPin } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';

// Categorical palette for the center charts. recharts needs literal color strings
// (it cannot consume Tailwind classes), so the hex list is isolated here.
const COLORS = [
    '#10B981', '#3B82F6', '#8B5CF6', '#F59E0B', // design-lint-ignore: chart palette
    '#EF4444', '#EC4899', '#06B6D4', '#84CC16', // design-lint-ignore: chart palette
    '#F97316', '#6366F1', '#14B8A6', '#A855F7', // design-lint-ignore: chart palette
];

const chartConfig = {
    users: { label: 'Users', color: 'hsl(var(--primary))' },
};

export interface CenterDistributionDatum {
    name: string;
    users: number;
    interactions: number;
    optedOut: number;
}

interface CenterDistributionChartsProps {
    data: CenterDistributionDatum[];
    /** Tooltip label for the primary count (e.g. "Enrolled" or "Leads"). */
    usersLabel?: string;
    /** Tooltip label for the interactions count (e.g. "Interactions" or "Messaged"). */
    interactionsLabel?: string;
}

/**
 * "Center Distribution" card — a horizontal bar (users per center) + a donut
 * (share per center). Shared so the Zoho and Facebook center views look identical.
 */
export function CenterDistributionCharts({
    data,
    usersLabel,
    interactionsLabel,
}: CenterDistributionChartsProps) {
    const { t, i18n } = useTranslation('challengeAnalyticsCenterDistributionCharts');

    if (!data || data.length === 0) {
        return null;
    }

    const resolvedUsersLabel = usersLabel ?? t('usersLabelDefault');
    const resolvedInteractionsLabel = interactionsLabel ?? t('interactionsLabelDefault');

    const centers = [...data].sort((a, b) => b.users - a.users);
    // Grow the chart so every center fits (≈34px per row).
    const barChartHeight = Math.max(280, centers.length * 34);

    const pieData = centers
        .filter((item) => item.users > 0)
        .map((item, index) => ({
            name: item.name,
            value: item.users,
            fill: COLORS[index % COLORS.length],
        }));

    return (
        <Card className="shadow-sm">
            <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                    <div className="bg-primary/10 rounded-lg p-2">
                        <MapPin className="text-primary size-5" weight="fill" />
                    </div>
                    <div>
                        <CardTitle className="text-base font-semibold">
                            {t('title')}
                        </CardTitle>
                        <p className="text-xs text-gray-500">{t('subtitle')}</p>
                    </div>
                </div>
            </CardHeader>
            <CardContent>
                <div className="grid gap-6 lg:grid-cols-2">
                    {/* Bar chart */}
                    <div>
                        <h4 className="mb-3 text-sm font-medium text-gray-700">{t('barChartHeading')}</h4>
                        <ChartContainer
                            config={chartConfig}
                            className="aspect-auto w-full"
                            style={{ height: barChartHeight }}
                        >
                            <BarChart
                                data={centers}
                                layout="vertical"
                                margin={{ top: 5, right: 30, left: 10, bottom: 5 }}
                            >
                                <CartesianGrid strokeDasharray="3 3" horizontal vertical={false} />
                                <XAxis type="number" tick={{ fontSize: 11 }} />
                                <YAxis
                                    type="category"
                                    dataKey="name"
                                    tick={{ fontSize: 11 }}
                                    width={130}
                                    interval={0}
                                />
                                <ChartTooltip
                                    content={({ active, payload }) => {
                                        if (active && payload?.length) {
                                            const d = payload[0]?.payload as
                                                | CenterDistributionDatum
                                                | undefined;
                                            return (
                                                <div className="rounded-lg border bg-white px-3 py-2 shadow-lg">
                                                    <p className="font-medium">{d?.name}</p>
                                                    <p className="mt-1 text-sm">
                                                        {resolvedUsersLabel}:{' '}
                                                        <strong>{d?.users}</strong>
                                                    </p>
                                                    <p className="text-sm">
                                                        {resolvedInteractionsLabel}:{' '}
                                                        <strong>{d?.interactions}</strong>
                                                    </p>
                                                    <p className="text-sm">
                                                        {t('optOuts')}: <strong>{d?.optedOut}</strong>
                                                    </p>
                                                </div>
                                            );
                                        }
                                        return null;
                                    }}
                                />
                                <Bar dataKey="users" radius={[0, 4, 4, 0]} barSize={20}>
                                    {centers.map((_, i) => (
                                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ChartContainer>
                    </div>

                    {/* Pie chart */}
                    <div>
                        <h4 className="mb-3 text-sm font-medium text-gray-700">{t('pieChartHeading')}</h4>
                        <ResponsiveContainer width="100%" height={320}>
                            <PieChart margin={{ top: 8, right: 12, bottom: 8, left: 12 }}>
                                <Pie
                                    data={pieData}
                                    cx="50%"
                                    cy="45%"
                                    innerRadius={45}
                                    outerRadius={72}
                                    paddingAngle={2}
                                    dataKey="value"
                                    label={({ name, percent }) =>
                                        `${name}: ${(percent * 100).toFixed(0)}%`
                                    }
                                    labelLine
                                >
                                    {pieData.map((entry, i) => (
                                        <Cell key={i} fill={entry.fill} />
                                    ))}
                                </Pie>
                                <Tooltip
                                    formatter={(v: number) => [
                                        v.toLocaleString(i18n.language),
                                        resolvedUsersLabel,
                                    ]}
                                />
                                <Legend
                                    layout="horizontal"
                                    align="center"
                                    verticalAlign="bottom"
                                    wrapperStyle={{ fontSize: '11px' }}
                                />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}
