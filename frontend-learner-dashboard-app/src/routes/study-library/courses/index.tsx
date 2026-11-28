import { createFileRoute } from "@tanstack/react-router";
import CourseCatalougePage from "./-component/CourseCatalougePage";
import { LayoutContainer } from "@/components/common/layout-container/layout-container";
import { useEffect } from "react";
import { useNavHeadingStore } from "@/stores/layout-container/useNavHeadingStore";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";
import { getTerminologyPlural } from "@/components/common/layout-container/sidebar/utils";
/** The longest course tag the server accepts (link targets allow 255 characters). */
const MAX_TAG_LENGTH = 255;

export interface CoursesSearch {
    /** Open the catalogue narrowed to this course tag (links from the learner home). */
    tag?: string;
}

export const Route = createFileRoute("/study-library/courses/")({
    component: RouteComponent,
    validateSearch: (search: Record<string, unknown>): CoursesSearch => {
        const tag = typeof search.tag === "string" ? search.tag.trim().slice(0, MAX_TAG_LENGTH) : "";
        return tag ? { tag } : {};
    },
});

function RouteComponent() {
    const { setNavHeading } = useNavHeadingStore();
    const { tag } = Route.useSearch();

    useEffect(() => {
        setNavHeading(
            getTerminologyPlural(ContentTerms.Course, SystemTerms.Course)
        );
    }, []);

    return (
        <LayoutContainer>
            <CourseCatalougePage initialTag={tag} />
        </LayoutContainer>
    );
}
