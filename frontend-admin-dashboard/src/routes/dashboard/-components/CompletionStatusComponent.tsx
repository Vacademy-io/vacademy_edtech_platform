import { PolarGrid, PolarRadiusAxis, RadialBar, RadialBarChart } from 'recharts';
import { ChartConfig, ChartContainer } from '@/components/ui/chart';
import { useTheme } from '@/providers/theme/theme-provider';
import themeData from '@/constants/themes/theme.json';
import { useTranslation } from 'react-i18next';

export function CompletionStatusComponent({
    profileCompletionPercentage,
}: {
    profileCompletionPercentage: number;
}) {
    const { t } = useTranslation('dashboardCompletionStatusComponent');
    const chartConfig = {
        visitors: {
            label: t('visitorsLabel'),
            color: 'hsl(var(--primary-300))',
        },
    } satisfies ChartConfig;
    const { primaryColor } = useTheme();
    const color =
        themeData.themes.find((color) => color.code === primaryColor)?.colors['primary-500'] ||
        'var(--color-visitors)';
    const chartData = [
        {
            browser: 'visitors',
            visitors: profileCompletionPercentage,
            fill: color,
        },
    ];
    return (
        <ChartContainer config={chartConfig} className="h-24 w-20">
            <RadialBarChart
                data={chartData}
                startAngle={0}
                endAngle={profileCompletionPercentage * 4}
                innerRadius={30}
                outerRadius={50}
            >
                <PolarGrid
                    gridType="circle"
                    radialLines={false}
                    stroke="none"
                    className="first:fill-muted last:fill-background"
                    polarRadius={[35, 35]}
                />
                <RadialBar dataKey="visitors" background cornerRadius={10} />
                <PolarRadiusAxis tick={false} tickLine={false} axisLine={false} />
            </RadialBarChart>
        </ChartContainer>
    );
}
