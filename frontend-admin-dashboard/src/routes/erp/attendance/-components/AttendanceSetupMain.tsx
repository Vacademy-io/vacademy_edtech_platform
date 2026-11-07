import { useTranslation } from 'react-i18next';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useHrRole } from '@/hooks/use-hr-role';
import { HrNoAccessCard } from '@/routes/erp/people/-components/HrStates';
import { AttendanceConfigTab } from './AttendanceConfigTab';
import { HolidaysTab } from './HolidaysTab';
import { ShiftsTab } from './ShiftsTab';

/**
 * Everything the daily board reads before it can judge a day.
 *
 * The three tabs are the three inputs, in the order they matter: a shift says what
 * a working day looks like, the holiday calendar says which days aren't ones, and
 * the configuration says how the two are applied. They live together because a
 * change to any of them changes how the same check-in is classified.
 */
export const AttendanceSetupMain = () => {
    const { t } = useTranslation('erpAttendanceSetupMain');
    const { isHrAdmin, isHrStaff } = useHrRole();

    if (!isHrStaff) return <HrNoAccessCard />;

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
                <h2 className="text-h2-semibold text-foreground">{t('heading')}</h2>
                <p className="max-w-3xl text-body text-muted-foreground">{t('description')}</p>
            </div>

            <Tabs defaultValue="shifts" className="flex flex-col gap-2">
                <TabsList className="h-auto w-full flex-wrap justify-start sm:w-fit">
                    <TabsTrigger value="shifts">{t('tabs.shifts')}</TabsTrigger>
                    <TabsTrigger value="holidays">{t('tabs.holidays')}</TabsTrigger>
                    <TabsTrigger value="configuration">{t('tabs.configuration')}</TabsTrigger>
                </TabsList>

                <TabsContent value="shifts" className="mt-4">
                    <ShiftsTab isHrAdmin={isHrAdmin} />
                </TabsContent>
                <TabsContent value="holidays" className="mt-4">
                    <HolidaysTab isHrAdmin={isHrAdmin} />
                </TabsContent>
                <TabsContent value="configuration" className="mt-4">
                    <AttendanceConfigTab isHrAdmin={isHrAdmin} />
                </TabsContent>
            </Tabs>
        </div>
    );
};
