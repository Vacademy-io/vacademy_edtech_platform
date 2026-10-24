import { useEffect, useState } from "react";
import { getPublicUrl, getPublicUrlWithoutLogin } from "@/services/upload_file";

interface TeacherAvatarProps {
  /** Media file id from the course / institute Tutor Mode settings. */
  fileId?: string | null;
  name?: string;
  className?: string;
  /** Pulses while the teacher speaks. */
  speaking?: boolean;
}

/** The built-in teacher face: a friendly illustrated portrait. */
export const DefaultTeacherFace: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 96 96" role="img" aria-label="Teacher" className={className}>
    <circle cx="48" cy="48" r="48" className="fill-primary-100" />
    <path d="M22 44c0-16 12-27 26-27s26 11 26 27v6H22z" className="fill-neutral-800" />
    <circle cx="48" cy="50" r="19" className="fill-warning-100" />
    <path d="M31 47c2-10 9-15 17-15s15 5 17 15c-3-4-9-7-17-7s-14 3-17 7z" className="fill-neutral-800" />
    <circle cx="41" cy="52" r="2.2" className="fill-neutral-800" />
    <circle cx="55" cy="52" r="2.2" className="fill-neutral-800" />
    <path d="M41 60c2 3 5 4 7 4s5-1 7-4" className="fill-none stroke-neutral-800" strokeWidth="2" strokeLinecap="round" />
    <path d="M18 96c3-14 14-22 30-22s27 8 30 22z" className="fill-primary-500" />
    <circle cx="66" cy="36" r="3" className="fill-warning-300" />
  </svg>
);

/** The teacher's photo as a signed url ("" while resolving or when there is none). */
export function useTeacherPhotoUrl(fileId?: string | null): string {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let cancelled = false;
    if (!fileId) {
      setUrl("");
      return;
    }
    // The public demo has no auth cookie, so the signed-in route 401s there.
    getPublicUrl(fileId)
      .catch(() => getPublicUrlWithoutLogin(fileId))
      .then((u) => {
        if (!cancelled) setUrl(u || "");
      })
      .catch(() => {
        if (!cancelled) setUrl("");
      });
    return () => {
      cancelled = true;
    };
  }, [fileId]);
  return url;
}

/** Resolves the teacher's face file id to a signed url; falls back to the built-in face. */
export const TeacherAvatar: React.FC<TeacherAvatarProps> = ({ fileId, name, className, speaking }) => {
  const url = useTeacherPhotoUrl(fileId);
  return (
    <div
      className={`relative shrink-0 overflow-hidden rounded-full bg-primary-100 ${speaking ? "ring-4 ring-primary-200" : ""} ${className ?? "size-12"}`}
    >
      {url ? (
        <img src={url} alt={name ? `${name}, your teacher` : "Your teacher"} className="size-full object-cover" />
      ) : (
        <DefaultTeacherFace className="size-full" />
      )}
    </div>
  );
};
