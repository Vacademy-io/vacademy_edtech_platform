import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useSuspenseQuery } from '@tanstack/react-query';
import { useInstituteQuery } from '@/services/student-list-section/getInstituteDetails';
import { useTranslation } from 'react-i18next';
import DashboardAnalyticsWidgets from './DashboardAnalyticsWidgets';

interface UserAnalyticsTabProps {
    existingContent?: React.ReactNode;
}

export default function UserAnalyticsTab({ existingContent }: UserAnalyticsTabProps) {
    const { t } = useTranslation('dashboardUserAnalyticsTab');
    const { data: instituteDetails } = useSuspenseQuery(useInstituteQuery());
    const instituteId = instituteDetails?.id || '';

    console.log('UserAnalyticsTab - instituteId:', instituteId);

    return (
        <div className="w-full space-y-6">
            {/* Existing Dashboard Content */}
            {existingContent || (
                <Card className="mb-4">
                    <CardHeader>
                        <CardTitle>{t('overview.title')}</CardTitle>
                        <CardDescription>{t('overview.subtitle')}</CardDescription>
                    </CardHeader>
                </Card>
            )}

            {/* Analytics Widgets Section */}
            <DashboardAnalyticsWidgets />
        </div>
    );
}
