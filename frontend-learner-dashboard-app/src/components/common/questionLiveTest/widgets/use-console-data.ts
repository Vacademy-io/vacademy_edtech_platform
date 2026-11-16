import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Preferences } from "@capacitor/preferences";
import { safeParse } from "@/lib/storage";
import { useAssessmentStore } from "@/stores/assessment-store";
import { getPublicUrl } from "@/services/upload_file";
import { handleGetPublicInstituteDetails } from "@/components/common/layout-container/services/navbar-services";
import { getInstituteLogoQuery } from "@/services/institute-logo";
import { useLiveTestUi } from "../live-test-ui-context";
import {
  paletteEntries,
  statusCounts,
  type PaletteEntry,
  type StatusCounts,
} from "./palette-logic";

/** Questions of a section (the open one by default). */
export function useSectionQuestions(sectionIndex?: number) {
  const assessment = useAssessmentStore((s) => s.assessment);
  const currentSection = useAssessmentStore((s) => s.currentSection);
  const index = sectionIndex ?? currentSection;
  return useMemo(
    () => assessment?.section_dtos?.[index]?.question_preview_dto_list ?? [],
    [assessment, index],
  );
}

/**
 * The palette's chips for the theme's scope (open section, or the whole
 * paper on layouts whose palette covers every question).
 */
export function usePaletteEntries(): PaletteEntry[] {
  const { examTheme } = useLiveTestUi();
  const scope = examTheme.palette.countsScope;
  const assessment = useAssessmentStore((s) => s.assessment);
  const currentSection = useAssessmentStore((s) => s.currentSection);
  return useMemo(
    () => paletteEntries(assessment?.section_dtos ?? [], scope, currentSection),
    [assessment, scope, currentSection],
  );
}

/** Legend counts over the palette's chips (same scope as the chips). */
export function usePaletteCounts(): StatusCounts {
  const entries = usePaletteEntries();
  const questionStates = useAssessmentStore((s) => s.questionStates);
  return useMemo(
    () => statusCounts(entries.map((entry) => entry.question), questionStates),
    [entries, questionStates],
  );
}

/**
 * The institute's name and logo for the banner slot (the same public
 * details and cached logo the app header uses). Never an exam body's mark.
 */
export function useInstituteBrand(): { name: string; logoUrl: string } {
  const { data: details } = useQuery(handleGetPublicInstituteDetails());
  const { data: logoUrl } = useQuery(
    getInstituteLogoQuery(details?.institute_logo_file_id ?? null),
  );
  return {
    name: typeof details?.institute_name === "string" ? details.institute_name : "",
    logoUrl: typeof logoUrl === "string" ? logoUrl : "",
  };
}

/** The learner's name and photo for the candidate box. */
export function useCandidate(): { name: string; photoUrl: string } {
  const [student, setStudent] = useState<{ name: string; faceFileId: string | null }>({
    name: "",
    faceFileId: null,
  });
  useEffect(() => {
    let alive = true;
    void Preferences.get({ key: "StudentDetails" }).then(({ value }) => {
      if (!alive) return;
      const parsed = safeParse<{ full_name?: string; face_file_id?: string | null } | null>(
        value,
        null,
      );
      setStudent({
        name: parsed?.full_name?.trim() ?? "",
        faceFileId: parsed?.face_file_id || null,
      });
    });
    return () => {
      alive = false;
    };
  }, []);
  const { data: photoUrl } = useQuery({
    queryKey: ["exam-candidate-photo", student.faceFileId],
    queryFn: async () => (student.faceFileId ? await getPublicUrl(student.faceFileId) : ""),
    enabled: Boolean(student.faceFileId),
    staleTime: 1000 * 60 * 60,
  });
  return { name: student.name, photoUrl: typeof photoUrl === "string" ? photoUrl : "" };
}
