import type { NoteColor } from "@/lib/notes/types";

/** Tailwind needs whole class names, so each colour lists its own. */
export const NOTE_BAND: Record<NoteColor, string> = {
  yellow: "bg-warning-300",
  green: "bg-success-300",
  blue: "bg-info-300",
  pink: "bg-danger-300",
};

export const NOTE_DOT: Record<NoteColor, string> = {
  yellow: "bg-warning-400",
  green: "bg-success-400",
  blue: "bg-info-400",
  pink: "bg-danger-400",
};

export const NOTE_EDGE: Record<NoteColor, string> = {
  yellow: "border-warning-400",
  green: "border-success-400",
  blue: "border-info-400",
  pink: "border-danger-400",
};

export const noteColorOf = (color?: string | null): NoteColor =>
  color === "green" || color === "blue" || color === "pink" ? color : "yellow";
