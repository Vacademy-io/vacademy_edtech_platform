import type { TFunction } from 'i18next';
import { getActiveRoleDisplaySettingsKey } from '@/lib/auth/instituteUtils';
import { getInstituteId } from '@/constants/helper';
import { hasFacultyAssignedPermission } from '@/lib/auth/facultyAccessUtils';
import { DropdownItem } from '@/components/design-system/utils/types/dropdown-types';
import { ADMIN_DISPLAY_SETTINGS_KEY, TEACHER_DISPLAY_SETTINGS_KEY, CUSTOM_ROLE_DISPLAY_SETTINGS_KEY } from '@/types/display-settings';
import { getDisplaySettingsFromCache } from '@/services/display-settings';
import { getTokenDecodedData, getTokenFromCookie } from '@/lib/auth/sessionUtility';
import { TokenKey, Authority } from '@/constants/auth/tokens';

function buildBaseList(t: TFunction): DropdownItem[] {
    return [
        { label: t('studyLibrarySlidesMenuOptions:copyTo'), value: 'copy' },
        { label: t('studyLibrarySlidesMenuOptions:moveTo'), value: 'move' },
        { label: t('studyLibrarySlidesMenuOptions:dripConditions'), value: 'drip-conditions' },
        { label: t('studyLibrarySlidesMenuOptions:offlineAvailability'), value: 'offline-availability' },
        { label: t('studyLibrarySlidesMenuOptions:delete'), value: 'delete' },
    ];
}

export function getSlidesMenuOptions(t: TFunction): DropdownItem[] {
    const baseList = buildBaseList(t);
    try {
        const accessToken = getTokenFromCookie(TokenKey.accessToken);
        const tokenData = getTokenDecodedData(accessToken);
        const isAdmin =
            tokenData?.authorities &&
            Object.values(tokenData.authorities).some(
                (auth: Authority) => Array.isArray(auth?.roles) && auth.roles.includes('ADMIN')
            );
        const hasFaculty = hasFacultyAssignedPermission(getInstituteId());
    const roleKey = getActiveRoleDisplaySettingsKey();
        const settings = getDisplaySettingsFromCache(roleKey);
        const slideView = settings?.slideView;
        return baseList.filter((item) => {
            if (item.value === 'copy' && slideView?.showCopyTo === false) return false;
            if (item.value === 'move' && slideView?.showMoveTo === false) return false;
            if (item.value === 'delete' && slideView?.showDelete === false) return false;
            return true;
        });
    } catch {
        return baseList;
    }
}
