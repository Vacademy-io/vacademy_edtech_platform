import { useTranslation } from 'react-i18next';
import { ArrowCounterClockwise } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { Textarea } from '@/components/ui/textarea';

/** What a paper carries when the teacher has not written their own. */
export const DEFAULT_INSTRUCTIONS = [
    'All questions are compulsory.',
    'Marks for each question are indicated against it.',
    'Read each question carefully before answering.',
    'Draw neat, labelled diagrams wherever necessary.',
    'Write your answers clearly and neatly in the answer sheet.',
];

export const toInstructionLines = (text: string): string[] =>
    text
        .split('\n')
        .map((line) => line.replace(/^\s*\(?[ivx\d]+[).]\s*/i, '').trim())
        .filter(Boolean);

interface InstructionsEditorProps {
    value: string[];
    onChange: (next: string[]) => void;
    disabled?: boolean;
}

/**
 * "General Instructions" as the teacher wants them printed — one line per
 * instruction, numbered (i), (ii)… on the sheet. Starts from the platform
 * defaults so a paper is never printed without any, and the defaults are one
 * click away after editing.
 */
export const InstructionsEditor = ({
    value,
    onChange,
    disabled = false,
}: InstructionsEditorProps) => {
    const { t } = useTranslation('knowledgeBaseTestDetails');
    return (
        <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
                <span className="text-subtitle font-regular text-neutral-600">
                    {t('instructions.label')}
                </span>
                <MyButton
                    type="button"
                    buttonType="text"
                    scale="small"
                    disable={disabled}
                    onClick={() => onChange([...DEFAULT_INSTRUCTIONS])}
                >
                    <ArrowCounterClockwise className="mr-1 size-3.5" />
                    {t('instructions.reset')}
                </MyButton>
            </div>
            <Textarea
                value={value.join('\n')}
                onChange={(e) => onChange(e.target.value.split('\n'))}
                onBlur={(e) => onChange(toInstructionLines(e.target.value))}
                rows={Math.min(8, Math.max(4, value.length + 1))}
                disabled={disabled}
                placeholder={DEFAULT_INSTRUCTIONS.join('\n')}
            />
            <span className="text-caption text-neutral-400">{t('instructions.help')}</span>
        </div>
    );
};
