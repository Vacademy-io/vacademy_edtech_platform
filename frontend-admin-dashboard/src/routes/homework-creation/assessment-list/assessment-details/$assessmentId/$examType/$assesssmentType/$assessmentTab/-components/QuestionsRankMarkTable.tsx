import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { AssessmentOverviewMarksRankInterface } from '@/types/assessment-overview';
import { useTranslation } from 'react-i18next';

const AssessmentDetailsRankMarkTable = ({
    marksRanksData,
}: {
    marksRanksData: AssessmentOverviewMarksRankInterface[];
}) => {
    const { t } = useTranslation('homeworkCreationQuestionsRankMarkTable');
    return (
        <div className="relative">
            <Table className="w-full table-auto">
                <TableHeader className="sticky top-0 z-10 bg-primary-100">
                    <TableRow className="w-full">
                        <TableHead className="w-1/4 rounded-tl-xl">{t('table.rank')}</TableHead>
                        <TableHead className="w-1/4">{t('table.marks')}</TableHead>
                        <TableHead className="w-1/4">{t('table.percentile')}</TableHead>
                        <TableHead className="w-1/4 rounded-tr-xl">
                            {t('table.participants')}
                        </TableHead>
                    </TableRow>
                </TableHeader>
            </Table>
            <div className="max-h-48 overflow-y-auto">
                <Table className="w-full table-auto">
                    <TableBody>
                        {marksRanksData?.map((item) => (
                            <TableRow key={item.rank}>
                                <TableCell className="w-1/4">{item.rank}</TableCell>
                                <TableCell className="w-1/4">
                                    {item.marks ? item.marks.toFixed(2) : 0}
                                </TableCell>
                                <TableCell className="w-1/4">{item.percentile}%</TableCell>
                                <TableCell className="w-1/4">{item.no_of_participants}</TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>
        </div>
    );
};

export default AssessmentDetailsRankMarkTable;
