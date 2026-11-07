import { MyDialog } from '@/components/design-system/dialog';
import { useTranslation } from 'react-i18next';

export default function AttendanceReportDialog({
    open,
    setOpen,
}: {
    open: boolean;
    setOpen: (open: boolean) => void;
}) {
    const { t } = useTranslation('studyLibraryAttendanceReportDialog');
    return (
        <MyDialog heading={t('heading')} open={open} onOpenChange={setOpen}>
            {t('body')}
        </MyDialog>
    );
}
