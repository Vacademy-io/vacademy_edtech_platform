import { DoubtType } from '../-types/add-doubt-type';
import { Dispatch, SetStateAction } from 'react';
import { toast } from 'sonner';
import { UseMutationResult } from '@tanstack/react-query';
import { AxiosResponse } from 'axios';
import type { TFunction } from 'i18next';

export const handleAddReply = async ({
    replyData,
    addReply,
    setReply,
    setShowInput,
    refetch,
    id,
    t,
}: {
    replyData: DoubtType;
    addReply: UseMutationResult<AxiosResponse<DoubtType>, Error, DoubtType>;
    setReply?: Dispatch<SetStateAction<string>>;
    setShowInput?: Dispatch<SetStateAction<boolean>>;
    refetch?: () => void;
    id?: string;
    t: TFunction;
}) => {
    if (id) {
        replyData.id = id;
    }
    addReply.mutate(replyData, {
        onSuccess: () => {
            if (setReply) setReply('');
            if (setShowInput) setShowInput(false);
            if (refetch) refetch();
        },
        onError: () => {
            toast.error(t('studyLibraryHandleAddReply:toast.errorAddingDoubt'));
        },
    });
};
