import type { Control } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { ChartBar } from '@phosphor-icons/react';
import type { ComposerForm } from '../forms/composer-schema';
import { loose, type ItemPath } from './item-fields';
import { OptionListEditor, PromptField } from './QuestionEditor';

/**
 * A poll: the question and 2–6 choices. There is no right answer, so no key, bonus or
 * reveal; everyone who votes earns the completion points and sees how others voted.
 */
export function PollEditor({ control, name }: { control: Control<ComposerForm>; name: ItemPath }) {
    const { t } = useTranslation('engagement');
    const c = loose(control);
    return (
        <div className="flex flex-col gap-4">
            <PromptField control={c} name={name} placeholder={t('items.poll.promptPlaceholder')} />
            <OptionListEditor control={c} name={name} mode="poll" />
            <p className="flex items-start gap-2 rounded-md bg-neutral-50 px-3 py-2 text-caption text-neutral-600">
                <ChartBar size={16} className="mt-0.5 shrink-0 text-primary-500" aria-hidden />
                <span>{t('items.poll.note')}</span>
            </p>
        </div>
    );
}
