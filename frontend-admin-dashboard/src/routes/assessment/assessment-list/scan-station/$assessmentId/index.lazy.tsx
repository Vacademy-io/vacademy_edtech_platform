import { createLazyFileRoute } from '@tanstack/react-router';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { ScanStationPage } from './-components/ScanStationPage';

export const Route = createLazyFileRoute('/assessment/assessment-list/scan-station/$assessmentId/')(
    {
        component: () => (
            <LayoutContainer>
                <ScanStationPage />
            </LayoutContainer>
        ),
    }
);
