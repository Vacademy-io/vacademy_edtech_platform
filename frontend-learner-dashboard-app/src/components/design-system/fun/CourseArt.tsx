import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { courseColourClass } from "./course-palette";
import { FinishedTick } from "./FinishedTick";

/** The first user-perceived character of a name (a Devanagari syllable stays whole). */
export function firstGrapheme(name: string | null | undefined): string {
  const text = (name ?? "").trim();
  if (!text) return "";
  const Segmenter = (Intl as { Segmenter?: typeof Intl.Segmenter }).Segmenter;
  if (Segmenter) {
    const first = new Segmenter(undefined, { granularity: "grapheme" }).segment(text)[Symbol.iterator]().next();
    if (!first.done) return first.value.segment.toLocaleUpperCase();
  }
  return Array.from(text)[0]!.toLocaleUpperCase();
}

/**
 * A course's picture in the Fun skin. Courses have no subject or icon field, so:
 * the uploaded course image on the course tint when there is one, else the plain
 * shape (deco circle and a white rounded square holding the first letter) on the
 * course colour. Drawings are never picked from the course name.
 *
 * OWNER DEFAULT (unconfirmed): image when there is one, else shape + first letter.
 *
 * Decorative: the course name is always written next to it. Size it with a class.
 */
export function CourseArt({
  courseId,
  name,
  imageUrl,
  finished,
  className,
  children,
}: {
  /** The course (package) id: see courseColourIndex. */
  courseId: string;
  name: string;
  imageUrl?: string | null;
  /** A finished course: the green tick in the corner. It keeps its own colour. */
  finished?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [imageUrl]);
  const showImage = Boolean(imageUrl) && !failed;
  return (
    <div
      className={cn("fun-course-art", courseColourClass(courseId), showImage && "fun-course-art--image", className)}
      data-fun-art={showImage ? "image" : "shape"}
    >
      {showImage ? (
        <img
          className="fun-course-art__image"
          src={imageUrl!}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
        />
      ) : (
        <>
          <span className="fun-course-art__deco" aria-hidden="true" />
          <span className="fun-course-art__mark" aria-hidden="true">
            {firstGrapheme(name)}
          </span>
        </>
      )}
      {finished ? <FinishedTick /> : null}
      {children}
    </div>
  );
}
