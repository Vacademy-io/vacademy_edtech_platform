import { Preferences } from "@capacitor/preferences";
import { fetchStudentDetails } from "@/services/studentDetails";
import {
    getTokenDecodedData,
    getTokenFromStorage,
} from "@/lib/auth/sessionUtility";
import { TokenKey } from "@/constants/auth/tokens";

const FRESH_BATCH_IDS_TIMEOUT_MS = 8000;

export const getPackageSessionId = async () => {
    const USER_ID_KEY = 'StudentDetails';
    const userDetailsStr = await Preferences.get({ key: USER_ID_KEY });
    const userDetails = userDetailsStr.value ? JSON.parse(userDetailsStr.value) : null;
    const package_session_id = userDetails?.package_session_id || null;
    return package_session_id;
};

// Get all batch IDs for users enrolled in multiple batches
export const getAllPackageSessionIds = async (): Promise<string[]> => {
    try {
        // First try to get from students array (which contains all enrollments)
        const studentsStr = await Preferences.get({ key: 'students' });
        if (studentsStr.value) {
            const students = JSON.parse(studentsStr.value);
            if (Array.isArray(students) && students.length > 0) {
                const batchIds = students
                    .map((s: any) => s.package_session_id)
                    .filter((id: string) => id && id.trim() !== '');
                return batchIds;
            }
        }

        // Fallback: try sessionList
        const sessionListStr = await Preferences.get({ key: 'sessionList' });
        if (sessionListStr.value) {
            const sessions = JSON.parse(sessionListStr.value);
            if (Array.isArray(sessions) && sessions.length > 0) {
                const batchIds = sessions
                    .map((s: any) => s.id)
                    .filter((id: string) => id && id.trim() !== '');
                return batchIds;
            }
        }

        // Final fallback: single StudentDetails
        const userDetailsStr = await Preferences.get({ key: 'StudentDetails' });
        if (userDetailsStr.value) {
            const userDetails = JSON.parse(userDetailsStr.value);
            const package_session_id = userDetails?.package_session_id;
            if (package_session_id && package_session_id.trim() !== '') {
                return [package_session_id];
            }
        }

        return [];
    } catch (error) {
        console.error('Error getting all package session IDs:', error);
        return [];
    }
};

type EnrollmentRow = { package_session_id?: string | null };

const hasBatchId = (row: EnrollmentRow | null | undefined): row is { package_session_id: string } =>
    typeof row?.package_session_id === 'string' && row.package_session_id.trim() !== '';

// Adds rows to the saved "students" list. Only extends a list login already
// saved (an array); existing rows are never changed or removed.
const appendToSavedStudents = async (rows: EnrollmentRow[]): Promise<void> => {
    try {
        const { value } = await Preferences.get({ key: 'students' });
        const current: unknown = value ? JSON.parse(value) : null;
        if (!Array.isArray(current)) return;
        const saved = new Set(current.map((s: EnrollmentRow) => s?.package_session_id));
        const extra = rows.filter((r) => !saved.has(r.package_session_id));
        if (extra.length === 0) return;
        const next = JSON.stringify([...current, ...extra]);
        await Preferences.set({ key: 'students', value: next });
        try {
            localStorage.setItem('students', next);
        } catch {
            // best effort, mirrors the login-time sync
        }
    } catch (error) {
        console.warn('Could not update the saved enrollment list:', error);
    }
};

// Enrollment rows the server has that are missing from savedIds, for the
// institute the saved list belongs to (StudentDetails.institute_id, written
// with it at login). Any failure returns [] so callers keep the saved ids.
const fetchEnrollmentsMissingFrom = async (savedIds: string[]): Promise<EnrollmentRow[]> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        const { value } = await Preferences.get({ key: 'StudentDetails' });
        const instituteId: unknown = value ? JSON.parse(value)?.institute_id : null;
        const accessToken = await getTokenFromStorage(TokenKey.accessToken);
        const userId = getTokenDecodedData(accessToken)?.user;
        if (typeof instituteId !== 'string' || !instituteId || !userId) return [];

        const response = await Promise.race([
            fetchStudentDetails(instituteId, userId),
            new Promise<never>((_, reject) => {
                timer = setTimeout(
                    () => reject(new Error('Student details request timed out')),
                    FRESH_BATCH_IDS_TIMEOUT_MS
                );
            }),
        ]);
        // 200 = one row per enrollment in this institute, the same list login
        // saves. 201 = no enrollment rows here, so nothing to add.
        if (response.status !== 200 || !Array.isArray(response.data)) return [];

        const known = new Set(savedIds);
        const missing: EnrollmentRow[] = [];
        for (const row of response.data as EnrollmentRow[]) {
            if (!hasBatchId(row) || known.has(row.package_session_id)) continue;
            known.add(row.package_session_id);
            missing.push(row);
        }
        return missing;
    } catch (error) {
        console.warn('Could not check for new enrollments, using the saved list:', error);
        return [];
    } finally {
        if (timer) clearTimeout(timer);
    }
};

// Batch ids for the live class screens. The saved "students" list behind
// getAllPackageSessionIds is written only at login/signup, so a course joined
// after that login was missing and its classes were never fetched.
// onIds first gets the saved ids, exactly as before. If the server lists a
// course the saved ids lack, onIds is called again with the saved ids plus
// those courses, and they are appended to the saved list. Nothing is removed,
// and on any failure the saved ids simply stay.
export const loadPackageSessionIds = async (
    onIds: (ids: string[]) => void
): Promise<void> => {
    const savedIds = await getAllPackageSessionIds();
    onIds(savedIds);

    const missing = await fetchEnrollmentsMissingFrom(savedIds);
    if (missing.length === 0) return;
    await appendToSavedStudents(missing);
    onIds([...savedIds, ...missing.map((row) => row.package_session_id as string)]);
};

export const getUserId = async () => {
    const USER_ID_KEY = 'StudentDetails';
    const userDetailsStr = await Preferences.get({ key: USER_ID_KEY });
    const userDetails = userDetailsStr.value ? JSON.parse(userDetailsStr.value) : null;
    const user_id = userDetails?.user_id || null;
    return user_id;
};

export const getInstituteId = async () => {
    const INSTITUTE_ID_KEY = 'InstituteDetails';
    const instituteDetailsStr = await Preferences.get({ key: INSTITUTE_ID_KEY });
    const instituteDetails = instituteDetailsStr.value ? JSON.parse(instituteDetailsStr.value) : null;
    const institute_id = instituteDetails?.id || null;
    return institute_id;
};