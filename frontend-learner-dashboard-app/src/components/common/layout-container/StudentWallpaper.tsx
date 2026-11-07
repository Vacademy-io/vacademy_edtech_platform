import type { ResolvedStudentWallpaper } from "@/lib/student-layout";

/**
 * Institute-uploaded page wallpaper (Settings → Student Display → Layout).
 * A fixed layer painted before the page column; the column turns transparent
 * while it shows, and cards stay white on top of it. The optional overlay
 * tint keeps text readable on busy images.
 */
export function StudentWallpaper({
  wallpaper,
}: {
  wallpaper: ResolvedStudentWallpaper;
}) {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0">
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: `url("${wallpaper.imageUrl.replace(/["\\\n\r]/g, "")}")` }} // design-lint-ignore: institute-uploaded image URL
      />
      {wallpaper.overlayColor && wallpaper.overlayOpacity > 0 && (
        <div
          className="absolute inset-0"
          style={{ backgroundColor: wallpaper.overlayColor, opacity: wallpaper.overlayOpacity }} // design-lint-ignore: institute-chosen overlay tint
        />
      )}
    </div>
  );
}
