import { MarkAsResolved } from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-components/doubt-resolution/MarkAsResolved';
import { Doubt } from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-types/get-doubts-type';
import { useState, useRef, useEffect } from 'react';
import { CaretDown } from '@phosphor-icons/react';
import { getUserId, isUserAdmin } from '@/utils/userDetails';
import { useTranslation } from 'react-i18next';

export const MarkResolutionDropdown = ({
    resolved,
    handleDoubtResolve,
    doubt,
}: {
    resolved: boolean;
    handleDoubtResolve: (value: boolean) => void;
    doubt: Doubt;
}) => {
    const { t } = useTranslation('studyLibraryMarkAsResolvedCell');
    const isAdmin = isUserAdmin();
    const userId = getUserId();
    const canResolve =
        isAdmin || doubt.all_doubt_assignee.some((assignee) => assignee.id == userId);

    const [open, setOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setOpen(false);
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, []);

    return canResolve ? (
        <div className="relative inline-block" ref={dropdownRef}>
            <button
                onClick={() => setOpen((prev) => !prev)}
                className={`flex cursor-pointer items-center gap-1 rounded-xl border px-2 py-1 text-caption font-semibold ${
                    resolved
                        ? 'border-success-500 bg-green-50 text-green-700'
                        : 'border-danger-500 bg-red-50 text-red-700'
                }`}
            >
                {resolved ? t('resolved') : t('unresolved')}{' '}
                <span className="text-caption">
                    <CaretDown />
                </span>
            </button>
            {open && (
                <div className="absolute left-0 top-[110%] z-50 min-w-[120px] rounded-lg bg-white shadow-md">
                    <div
                        onClick={() => {
                            setOpen(false);
                            if (resolved) handleDoubtResolve(false);
                        }}
                        className={` w-full rounded-lg py-2 text-center hover:bg-neutral-50 ${!resolved ? 'bg-danger-100 text-danger-700' : 'bg-white text-neutral-600'} ${resolved ? 'cursor-pointer' : 'cursor-default'}`}
                    >
                        {t('unresolved')}
                    </div>
                    <div
                        onClick={() => {
                            setOpen(false);
                            if (!resolved) handleDoubtResolve(true);
                        }}
                        className={`w-full rounded-lg py-2  text-center ${
                            resolved
                                ? 'bg-green-50 font-semibold text-success-700'
                                : 'hover:bg-gray-50'
                        } ${!resolved ? 'cursor-pointer' : 'cursor-default'}`}
                    >
                        {t('resolved')}
                    </div>
                </div>
            )}
        </div>
    ) : (
        <button
            onClick={() => setOpen((prev) => !prev)}
            className={`flex cursor-pointer items-center gap-1 rounded-xl border px-2 py-1 text-caption font-semibold ${
                resolved
                    ? 'border-success-500 bg-green-50 text-green-700'
                    : 'border-danger-500 bg-red-50 text-red-700'
            }`}
        >
            {resolved ? t('resolved') : t('unresolved')}
        </button>
    );
};

export const MarkAsResolvedCell = ({ doubt, refetch }: { doubt: Doubt; refetch: () => void }) => {
    return <MarkAsResolved doubt={doubt} refetch={refetch} />;
};
