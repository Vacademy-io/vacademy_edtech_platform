import { X } from '@phosphor-icons/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MultipleInputProps } from '../../-types/types';

export const MultipleInput = ({
    itemsList,
    onListChange,
    inputType,
    role,
    commaSeperatedType,
}: MultipleInputProps) => {
    const { t } = useTranslation('studyLibraryStudentSettingReportHelperComponent');
    const [input, setInput] = useState<string>('');
    const [list, setList] = useState<string[]>(itemsList);

    const isValidEmail = (email: string) => {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    };

    const isValidMobileNumber = (number: string) => {
        // Basic validation for mobile number (e.g., 10 digits, optional country code)
        const mobileNumberRegex = /^(\+?\d{1,3})?(\d{10})$/;
        return mobileNumberRegex.test(number);
    };

    const updateList = (updatedList: string[]) => {
        setList(updatedList);
        onListChange(role, commaSeperatedType, updatedList); // Notify parent about the change
    };

    const addItemsToList = () => {
        const trimmedInput = input.trim();

        if (
            trimmedInput !== '' &&
            ((inputType === 'email' && isValidEmail(trimmedInput)) ||
                (inputType === 'mobile' && isValidMobileNumber(trimmedInput))) &&
            !list.includes(trimmedInput)
        ) {
            updateList([...list, trimmedInput]);
            setInput('');
        }
    };

    const deleteItem = (item: string) => {
        updateList(list.filter((i) => i !== item));
    };

    return (
        <div className="ml-1">
            <div className="w-[350px]">
                <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && addItemsToList()}
                    placeholder={
                        inputType === 'email'
                            ? t('placeholderEmail')
                            : t('placeholderMobile')
                    }
                    className="!focus:outline-none !focus:ring-0 mb-2 w-full rounded-md border p-1 !outline-none"
                />
            </div>

            <div className="flex flex-wrap gap-2">
                {list?.map((item) => (
                    <div
                        key={item}
                        className="flex w-fit flex-row items-center gap-2 rounded-lg border px-3 py-1"
                    >
                        <div>
                            {inputType === 'mobile' && '+91 '}
                            {item}
                        </div>
                        <button
                            onClick={() => deleteItem(item)}
                            className="text-red-500 hover:text-red-700"
                        >
                            <X size={16} />
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
};
