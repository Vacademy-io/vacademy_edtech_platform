import { MyButton } from '@/components/design-system/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { FileCsv, FileDoc, Plus, StarFour } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';

interface QuizAddQuestionsDropdownProps {
    onManual: () => void;
    onDocument: () => void;
    onAI: () => void;
    onCSV: () => void;
}

const QuizAddQuestionsDropdown = ({
    onManual,
    onDocument,
    onAI,
    onCSV,
}: QuizAddQuestionsDropdownProps) => {
    const { t } = useTranslation('studyLibraryQuizAddQuestionsDropdown');

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <MyButton type="button" className="flex items-center gap-2">
                    <Plus size={16} />
                    {t('addQuestion')}
                </MyButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem
                    className="flex cursor-pointer items-center gap-2 py-2"
                    onClick={onManual}
                >
                    <Plus size={16} className="text-primary-500" />
                    <span>{t('addManually')}</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                    className="flex cursor-pointer items-center gap-2 py-2"
                    onClick={onDocument}
                >
                    <FileDoc size={16} className="text-primary-500" />
                    <span>{t('uploadDocument')}</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                    className="flex cursor-pointer items-center gap-2 py-2"
                    onClick={onAI}
                >
                    <StarFour size={16} weight="fill" className="text-primary-500" />
                    <span>{t('createWithAi')}</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                    className="flex cursor-pointer items-center gap-2 py-2"
                    onClick={onCSV}
                >
                    <FileCsv size={16} className="text-primary-500" />
                    <span>{t('uploadCsvExcel')}</span>
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
};

export default QuizAddQuestionsDropdown;
