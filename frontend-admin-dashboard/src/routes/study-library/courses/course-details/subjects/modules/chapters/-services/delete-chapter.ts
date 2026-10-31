import { DELETE_CHAPTER } from '@/constants/urls';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import i18next from 'i18next';

export const useDeleteChapter = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async ({
            moduleId,
            subjectId,
            packageSessionIds,
            chapterIds,
        }: {
            moduleId: string;
            subjectId: string;
            packageSessionIds: string;
            chapterIds: string[];
        }) => {
            try {
                const response = await authenticatedAxiosInstance.post(
                    `${DELETE_CHAPTER}?moduleId=${moduleId}&subjectId=${subjectId}&packageSessionIds=${packageSessionIds}`,
                    chapterIds
                );
                toast.success(i18next.t('studyLibraryDeleteChapter:deleteSuccess'));
                return response.data;
            } catch (error) {
                toast.error(i18next.t('studyLibraryDeleteChapter:deleteFailed'));
                throw new Error(i18next.t('studyLibraryDeleteChapter:deleteFailed'));
            }
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['GET_MODULES_WITH_CHAPTERS'] });
            queryClient.invalidateQueries({ queryKey: ['GET_INIT_STUDY_LIBRARY'] });
            queryClient.invalidateQueries({ queryKey: ['GET_STUDENT_SUBJECTS_PROGRESS'] });
        },
    });
};
