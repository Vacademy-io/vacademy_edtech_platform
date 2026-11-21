/**
 * Authors on the public course page.
 *
 * `course-init` returns each batch's faculty as full UserDTOs — name, email,
 * the author-profile fields an admin fills in under Add Course > Add Authors
 * (`author_subtitle`, rich-text `author_description`), and a profile photo
 * file id. This module reduces that to what the page may show and decides
 * WHO is shown, so both rules are testable without rendering the page.
 */

import { authorRole } from "@/lib/course-author-role";

/** One author as the course page shows it. Deliberately no email: this is a
 *  public page, and a staff address is never part of the profile. */
export interface CourseAuthor {
    id: string;
    name: string;
    subtitle?: string;
    /** HTML from the admin's rich-text editor; sanitise on render. */
    description?: string;
    /** media-service file id of the author's profile photo. */
    profilePicId?: string;
    /** Display role in this course (Author / Instructor / Acharya …), as the admin typed it. */
    role?: string;
}

/** The subset of UserDTO this page reads. */
export interface RawCourseInstructor {
    id?: string | null;
    full_name?: string | null;
    author_subtitle?: string | null;
    author_description?: string | null;
    profile_pic_file_id?: string | null;
    role_label?: string | null;
}

const hasText = (html: string | null | undefined): boolean =>
    !!html &&
    html
        .replace(/<[^>]*>/g, "")
        .replace(/&nbsp;/gi, " ")
        .trim().length > 0;

/**
 * Faculty → authors. An untouched rich-text editor saves `<p></p>`, which is
 * "no bio", not a bio; a blank subtitle is likewise dropped so the card falls
 * back to the name alone. `unknownName` is the terminology-aware label for a
 * user record with no name.
 */
export const mapCourseAuthors = (
    instructors: ReadonlyArray<RawCourseInstructor> | null | undefined,
    unknownName: string,
): CourseAuthor[] =>
    (instructors ?? []).map((inst, idx) => ({
        id: inst.id || `author-${idx}`,
        name: inst.full_name?.trim() || unknownName,
        subtitle: inst.author_subtitle?.trim() || undefined,
        description: hasText(inst.author_description)
            ? inst.author_description!.trim()
            : undefined,
        profilePicId: inst.profile_pic_file_id || undefined,
        role: authorRole(inst),
    }));

/**
 * Student Display Settings > "Show All Teachers" (`courseDetails.showInstructors`)
 * decides whether the WHOLE roster is listed. Off — the default — still shows
 * the first author, as the overview always has, and with the full profile the
 * admin wrote for them. With no faculty at all, the hero's author name (which
 * has its own fallback) is the only thing left to show.
 */
export const visibleCourseAuthors = (
    authors: ReadonlyArray<CourseAuthor>,
    showAll: boolean,
    primaryName?: string | null,
): CourseAuthor[] => {
    if (showAll) return [...authors];
    if (authors[0]) return [authors[0]];
    return primaryName ? [{ id: "primary", name: primaryName }] : [];
};
