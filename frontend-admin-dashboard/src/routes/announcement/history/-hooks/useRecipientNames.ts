import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getUserBasicDetails } from '@/services/get_user_basic_details';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { removeDefaultPrefix } from '@/utils/helpers/removeDefaultPrefix';
import type { AnnouncementRecipient } from '../-types';
import { humanize } from '../-utils/format';

// get-basic-details takes the id list as a POST body; keep each call bounded.
const CHUNK = 200;

/**
 * user id → full name, for ids the notification service stored without a name (system alerts such
 * as "New doubt raised" save only the user id). Unknown/deleted users are simply absent.
 */
export function useUserNames(ids: Array<string | null | undefined>) {
    const uniqueIds = useMemo(
        () => Array.from(new Set(ids.filter((id): id is string => !!id))).sort(),
        [ids]
    );
    const query = useQuery({
        queryKey: ['announcementHistoryUserNames', uniqueIds],
        queryFn: async () => {
            const names = new Map<string, string>();
            for (let i = 0; i < uniqueIds.length; i += CHUNK) {
                const rows = await getUserBasicDetails(uniqueIds.slice(i, i + CHUNK));
                rows.forEach((u) => {
                    if (u?.id && u.name?.trim()) names.set(u.id, u.name.trim());
                });
            }
            return names;
        },
        enabled: uniqueIds.length > 0,
        staleTime: 5 * 60 * 1000,
        refetchOnWindowFocus: false,
    });
    return { names: query.data ?? EMPTY, isLoading: query.isLoading && uniqueIds.length > 0 };
}

const EMPTY = new Map<string, string>();

// recipientName doubles as storage for exclusion / custom-field JSON on some rule types.
function readableName(name?: string) {
    const v = name?.trim();
    if (!v || v.startsWith('[') || v.startsWith('{')) return undefined;
    return v;
}

export type RecipientLabel = { name: string; kind: string; isUser: boolean };

/** Turns a stored recipient rule into what an admin can read: a person, a batch, a role, … */
export function useDescribeRecipient(userNames: Map<string, string>) {
    const { t } = useTranslation('announcementHistoryIndex');
    const getBatch = useInstituteDetailsStore((s) => s.getDetailsFromPackageSessionId);

    const batchName = useCallback(
        (packageSessionId?: string) => {
            if (!packageSessionId) return undefined;
            const details = getBatch({ packageSessionId });
            if (!details) return undefined;
            const pkg = removeDefaultPrefix(details.package_dto?.package_name || '');
            const level = details.level?.level_name;
            const cleanLevel = level && level !== 'DEFAULT' ? removeDefaultPrefix(level) : '';
            return (cleanLevel ? `${pkg} - ${cleanLevel}` : pkg) || undefined;
        },
        [getBatch]
    );

    return useCallback(
        (r: AnnouncementRecipient): RecipientLabel => {
            const type = r.recipientType ?? '';
            const kind = t(`recipientTypes.${type}`, { defaultValue: humanize(type) });
            switch (type) {
                case 'USER':
                    return {
                        name:
                            readableName(r.recipientName) ??
                            (r.recipientId ? userNames.get(r.recipientId) : undefined) ??
                            t('recipients.unknownUser'),
                        kind,
                        isUser: true,
                    };
                case 'PACKAGE_SESSION':
                case 'PACKAGE_SESSION_COMMA_SEPARATED_ORG_ROLES':
                    return {
                        name:
                            batchName(r.recipientId?.split(',')[0]) ??
                            readableName(r.recipientName) ??
                            t('recipients.unknownBatch'),
                        kind,
                        isUser: false,
                    };
                case 'ROLE':
                    return {
                        name: t(`roles.${r.recipientId}`, {
                            defaultValue: humanize(r.recipientId),
                        }),
                        kind,
                        isUser: false,
                    };
                default:
                    return { name: readableName(r.recipientName) ?? kind, kind, isUser: false };
            }
        },
        [t, userNames, batchName]
    );
}
