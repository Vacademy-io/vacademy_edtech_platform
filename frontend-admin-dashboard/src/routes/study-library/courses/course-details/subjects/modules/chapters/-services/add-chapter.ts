import { useMutation, useQueryClient } from '@tanstack/react-query';
import i18next from 'i18next';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { Chapter } from '@/stores/study-library/use-modules-with-chapters-store';
import { ADD_CHAPTER } from '@/constants/urls';

export const useAddChapter = () => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({
            subjectId,
            moduleId,
            commaSeparatedPackageSessionIds,
            chapter,
        }: {
            subjectId: string;
            moduleId: string;
            commaSeparatedPackageSessionIds: string;
            chapter: Chapter;
        }) => {
            const payload = {
                id: chapter.id,
                chapter_name: chapter.chapter_name,
                status: chapter.status,
                file_id: chapter.file_id,
                description: chapter.description,
                // Backend uses 1-based ordering and, when chapter_order is null,
                // appends the new chapter to the end (maxOrder + 1). Callers pass
                // 0 as an "unset" sentinel; sending that literal 0 pins every new
                // chapter to order 0, so they tie at the top and shuffle. Convert
                // 0/falsy to null so the backend appends; keep any explicit order.
                chapter_order: chapter.chapter_order ? chapter.chapter_order : null,
            };

            try {
                const response = await authenticatedAxiosInstance.post(
                    `${ADD_CHAPTER}?subjectId=${subjectId}&moduleId=${moduleId}&commaSeparatedPackageSessionIds=${commaSeparatedPackageSessionIds}`,
                    payload
                );
                return response.data;
            } catch (error) {
                throw new Error(i18next.t('studyLibraryAddChapter:failedToAddChapter'));
            }
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['GET_MODULES_WITH_CHAPTERS'] });
            queryClient.invalidateQueries({ queryKey: ['GET_INIT_STUDY_LIBRARY'] });
            queryClient.invalidateQueries({ queryKey: ['GET_STUDENT_SUBJECTS_PROGRESS'] });
        },
    });
};
