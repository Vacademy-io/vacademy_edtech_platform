import { useEffect, useState } from "react";
import { Star } from "@phosphor-icons/react";
import { MyButton } from "@/components/design-system/button";
import { submitFeedback } from "@/services/feedback/submitFeedback";
import Swal from "sweetalert2";
import withReactContent from "sweetalert2-react-content";
import { Preferences } from "@capacitor/preferences";
import axios from "axios";
import { useRouter } from "@tanstack/react-router";
import { getUserId } from "@/utils/study-library/get-list-from-stores/getPackageSessionId";
import { urlInstituteDetails } from "@/constants/urls";
import { useTranslation } from "react-i18next";

const MySwal = withReactContent(Swal);

export default function FeedbackPage() {
  const { t } = useTranslation("studyContent");
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [comments, setComments] = useState("");
  const [loading, setLoading] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [packageSessionId, setPackageSessionId] = useState<string | null>(null);

  const router = useRouter();
  type SearchParams = { courseId?: string };
  const searchParams = router.state.location.search as SearchParams;
  const courseId = searchParams?.courseId ?? null;

  useEffect(() => {
    const fetchUserAndPackageSession = async () => {
      const id = await getUserId();
      setUserId(id);

      const instituteResult = await Preferences.get({ key: "InstituteId" });
      const instituteId = instituteResult.value;

      if (!instituteId || !courseId) {
        console.error("Missing instituteId or courseId");
        MySwal.fire(t("feedback.missingInfoTitle"), t("feedback.missingInstituteOrCourse"), "warning");
        return;
      }

      try {
        const response = await axios.get(`${urlInstituteDetails}/${instituteId}`);
        type BatchForSession = { id: string; package_dto?: { id?: string } | null };
        let batches = response.data?.batches_for_sessions as BatchForSession[] | undefined;

        // Fallback: if batches_for_sessions is missing, use the new course batches API
        if (!batches || batches.length === 0) {
          try {
            const { fetchBatchesForCourse } = await import("@/services/courseBatches");
            batches = await fetchBatchesForCourse(courseId);
          } catch {
            // Silent fallback failure
          }
        }

        const matched = batches?.find(
          (item) => item.package_dto?.id === courseId
        );

        if (matched?.id) {
          setPackageSessionId(matched.id);
        } else {
          console.error("❌ No matching packageSessionId found");
          MySwal.fire(t("feedback.errorTitle"), t("feedback.courseNotLinked"), "error");
        }
      } catch (error) {
        console.error("❌ Failed to fetch package session:", error);
        MySwal.fire(t("feedback.oopsTitle"), t("feedback.unableToFetchSession"), "error");
      }

      if (!id) {
        MySwal.fire(t("feedback.missingInfoTitle"), t("feedback.userIdMissing"), "warning");
      }
    };

    fetchUserAndPackageSession();
  }, [courseId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!userId || !packageSessionId) {
      await MySwal.fire(t("feedback.errorTitle"), t("feedback.cannotSubmit"), "error");
      return;
    }

    if (!rating) {
      await MySwal.fire(t("feedback.incompleteTitle"), t("feedback.selectRating"), "warning");
      return;
    }

    const payload = {
      id: "",
      points: rating,
      user_id: userId,
      likes: 0,
      dislikes: 0,
      source_id: packageSessionId,
      source_type: "PACKAGE_SESSION",
      text: comments,
      status: "PENDING",
    };

    try {
      setLoading(true);
      await submitFeedback(payload);

      await MySwal.fire({
        title: t("feedback.thankYouTitle"),
        text: t("feedback.thankYouText"),
        icon: "success",
        confirmButtonColor: "#2563eb", // design-lint-ignore: SweetAlert2 SDK color prop, not a Tailwind class
      });

      setRating(0);
      setComments("");
    } catch (error: unknown) {
      console.error("❌ Feedback API error:", error);
      const errorMessage = (() => {
        if (typeof error === "object" && error !== null && "response" in error) {
          const response = (error as { response?: { data?: { message?: string } } }).response;
          return response?.data?.message || t("feedback.somethingWentWrong");
        }
        return t("feedback.somethingWentWrong");
      })();
      await MySwal.fire(t("feedback.oopsTitle"), errorMessage, "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full min-h-[calc(100vh-150px)] bg-gradient-to-br px-6 py-10 overflow-y-auto"> {/* design-lint-ignore: viewport calc with fixed offset, no token equivalent */}
      <div className="mb-6 space-y-2">
        <h2 className="text-2xl font-bold">{t("feedback.heading")}</h2>
        <p className="text-base text-gray-600">
          {t("feedback.subheading")}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-8">
        <div className="space-y-2">
          <label className="block text-lg font-semibold text-gray-700">{t("feedback.overallRating")}</label>
          <div className="flex gap-2" role="radiogroup" aria-label={t("feedback.overallRatingAria")}>
            {[1, 2, 3, 4, 5].map((star) => (
              <Star
                key={star}
                className={`w-8 h-8 cursor-pointer transition-transform ${
                  (hover || rating) >= star ? "text-primary-300" : "text-gray-300"
                }`}
                tabIndex={0}
                role="radio"
                aria-checked={rating === star}
                aria-label={t("feedback.starCount", { count: star })}
                onMouseEnter={() => setHover(star)}
                onMouseLeave={() => setHover(0)}
                onClick={() => setRating(star)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setRating(star);
                  }
                }}
                fill={(hover || rating) >= star ? "currentColor" : "none"}
              />
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <label className="block text-lg font-semibold text-gray-700">{t("feedback.shareYourThoughts")}</label>
          <textarea
            value={comments}
            onChange={(e) => setComments(e.target.value)}
            placeholder={t("feedback.commentsPlaceholder")}
            className="w-full min-h-reg-150 p-4 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-200 resize-none"
          />
        </div>

        <MyButton
          buttonType="primary"
          layoutVariant="default"
          scale="medium"
          type="submit"
          disable={loading || rating === 0}
        >
          {loading ? t("feedback.submitting") : t("feedback.submit")}
        </MyButton>
      </form>
    </div>
  );
}
