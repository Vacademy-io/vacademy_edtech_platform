import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
    Certificate,
    ChartLineUp,
    Clock,
    HourglassMedium,
    Users,
} from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import type { CourseCertificateDashboard } from '../../-services/course-certificates';

interface CertificateStatsCardsProps {
    data: CourseCertificateDashboard | undefined;
    isLoading: boolean;
}

export const CertificateStatsCards = ({ data, isLoading }: CertificateStatsCardsProps) => {
    const { t } = useTranslation('studyLibraryCertificateStatsCards');

    if (isLoading) {
        return (
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
                {Array.from({ length: 5 }).map((_, i) => (
                    <Card key={i}>
                        <CardHeader className="pb-2">
                            <Skeleton className="h-4 w-24" />
                        </CardHeader>
                        <CardContent>
                            <Skeleton className="h-8 w-12" />
                        </CardContent>
                    </Card>
                ))}
            </div>
        );
    }

    if (!data) return null;

    const threshold = data.threshold_percent;
    // The "close to the threshold" band the spec asked for: within 10 points
    // below the bar, e.g. 70-79 when the threshold is 80.
    const nearFloor = Math.max(0, threshold - 10);

    const cards = [
        {
            title: t('totalEnrolled.title'),
            value: data.total_enrolled,
            subtitle: t('totalEnrolled.subtitle'),
            icon: <Users className="size-5 text-neutral-500" />,
        },
        {
            title: t('certificatesGenerated.title'),
            value: data.certificates_generated,
            subtitle: t('certificatesGenerated.subtitle'),
            icon: <Certificate className="size-5 text-success-500" />,
        },
        {
            title: t('certificatesPending.title'),
            value: data.certificates_pending,
            subtitle: t('certificatesPending.subtitle'),
            icon: <Clock className="size-5 text-neutral-500" />,
        },
        {
            title: t('awaitingGeneration.title'),
            value: data.completed_awaiting_certificate,
            subtitle: t('awaitingGeneration.subtitle', { threshold }),
            icon: <HourglassMedium className="size-5 text-warning-500" />,
        },
        {
            title: t('closeToThreshold.title'),
            value: data.near_threshold,
            subtitle: t('closeToThreshold.subtitle', {
                nearFloor,
                thresholdMinusOne: threshold - 1,
            }),
            icon: <ChartLineUp className="size-5 text-info-500" />,
        },
    ];

    return (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            {cards.map((card) => (
                <Card key={card.title}>
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-caption font-medium text-neutral-500">
                            {card.title}
                        </CardTitle>
                        {card.icon}
                    </CardHeader>
                    <CardContent>
                        <div className="text-h3 font-semibold text-neutral-700">{card.value}</div>
                        <p className="text-caption text-neutral-400">{card.subtitle}</p>
                    </CardContent>
                </Card>
            ))}
        </div>
    );
};
