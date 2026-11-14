import { useQuery } from '@tanstack/react-query';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { TRAINING_VIDEOS_BASE_URL } from '@/constants/urls';

export interface TrainingVideoDto {
    id: string;
    title: string;
    description: string | null;
    fileId: string | null;
    fileUrl: string;
    /** Breadcrumb segments, e.g. ["LMS","Course creation","AI based course"]. */
    modulePath: string[];
    /** Extra search words (synonyms, Hinglish, old names) set from the health dashboard. */
    keywords?: string[];
    /** Step number inside its section; null = unordered. */
    sortOrder?: number | null;
    active: boolean;
    createdAt: string;
    updatedAt: string;
}

/**
 * Active training videos for the Assist Dock "Training" popup. Pass enabled=false until the
 * popup is actually open — same deferral as the roadmap body, since the dock mounts on every
 * admin page and almost nobody opens the popup.
 */
export function useTrainingVideos(enabled = true) {
    return useQuery({
        queryKey: ['training-videos'],
        queryFn: async () =>
            (await authenticatedAxiosInstance.get<TrainingVideoDto[]>(TRAINING_VIDEOS_BASE_URL))
                .data,
        staleTime: 5 * 60 * 1000,
        enabled,
    });
}
