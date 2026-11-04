import { type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { MagnifyingGlass, X } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyDropdown } from '@/components/design-system/dropdown';
import { MyInput } from '@/components/design-system/input';
import { DIFFICULTIES, QUESTION_TYPES } from './library-constants';

/** Dropdown value for "no filter": an empty value would read as nothing selected. */
const ANY = '__any__';

/** Search, difficulty and type on one row. Each part shows only if its handler is given. */
export const LibraryFilterBar = ({
    search,
    onSearchChange,
    onSearchApply,
    difficulty,
    onDifficultyChange,
    questionType,
    onQuestionTypeChange,
    onClear,
}: {
    search?: string;
    onSearchChange?: (value: string) => void;
    onSearchApply?: () => void;
    difficulty?: string;
    onDifficultyChange?: (value: string) => void;
    questionType: string;
    onQuestionTypeChange: (value: string) => void;
    /** Present only while a filter is set. */
    onClear?: () => void;
}) => {
    const { t } = useTranslation('assessmentQuestionLibrary');
    return (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            {onSearchChange && (
                <div className="flex min-w-0 flex-1 items-center gap-2 sm:min-w-60">
                    <div className="min-w-0 flex-1">
                        <MyInput
                            inputType="text"
                            inputPlaceholder={t('filters.search')}
                            input={search ?? ''}
                            onChangeFunction={(e) => onSearchChange(e.target.value)}
                            onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
                                if (e.key === 'Enter') {
                                    // Enter would otherwise submit the test form around this dialog.
                                    e.preventDefault();
                                    onSearchApply?.();
                                }
                            }}
                            className="sm:w-full"
                        />
                    </div>
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="medium"
                        layoutVariant="icon"
                        aria-label={t('filters.searchButton')}
                        onClick={() => onSearchApply?.()}
                    >
                        <MagnifyingGlass size={16} />
                    </MyButton>
                </div>
            )}
            {onDifficultyChange && (
                <MyDropdown
                    currentValue={
                        difficulty ? t(`difficulty.${difficulty}`) : t('filters.difficulty')
                    }
                    dropdownList={[
                        { label: t('filters.any'), value: ANY },
                        ...DIFFICULTIES.map((level) => ({
                            label: t(`difficulty.${level}`),
                            value: level,
                        })),
                    ]}
                    handleChange={(value) => onDifficultyChange(value === ANY ? '' : value)}
                    className="w-full text-body sm:w-40"
                />
            )}
            <MyDropdown
                currentValue={questionType ? t(`types.${questionType}`) : t('filters.type')}
                dropdownList={[
                    { label: t('filters.any'), value: ANY },
                    ...QUESTION_TYPES.map((type) => ({
                        label: t(`types.${type}`),
                        value: type,
                    })),
                ]}
                handleChange={(value) => onQuestionTypeChange(value === ANY ? '' : value)}
                className="w-full text-body sm:w-44"
            />
            {onClear && (
                <MyButton
                    type="button"
                    buttonType="text"
                    scale="medium"
                    className="gap-1 sm:min-w-0"
                    onClick={onClear}
                >
                    <X size={14} />
                    {t('filters.clear')}
                </MyButton>
            )}
        </div>
    );
};
