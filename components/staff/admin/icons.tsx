// Line icons for the admin area (24px grid, 1.75 stroke, currentColor). Drawn here rather than pulled from an icon package so the admin
// shell adds no dependency. Decorative by default: pair each with a visible label.

import type { SVGProps } from "react";

export type AdminIconName =
  | "overview"
  | "classes"
  | "workouts"
  | "members"
  | "attendance"
  | "messages"
  | "library"
  | "catalog"
  | "finances"
  | "reports"
  | "exports"
  | "changes"
  | "staff"
  | "food"
  | "flag"
  | "bug"
  | "search"
  | "menu"
  | "close"
  | "logout"
  | "member-view"
  | "arrow-up"
  | "arrow-down"
  | "chevron-right"
  | "alert"
  | "calendar"
  | "settings"
  | "spark"
  | "clock";

const PATHS: Record<AdminIconName, string[]> = {
  overview: ["M4 4h7v7H4z", "M13 4h7v4h-7z", "M13 10h7v10h-7z", "M4 13h7v7H4z"],
  classes: ["M4 6h16v14H4z", "M4 10h16", "M8 3v4", "M16 3v4", "M8 14h3", "M8 17h6"],
  workouts: ["M6.5 7v10", "M17.5 7v10", "M3.5 9.5v5", "M20.5 9.5v5", "M6.5 12h11"],
  members: ["M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z", "M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6", "M16 4.5a3.5 3.5 0 0 1 0 6.5", "M18 14.5c1.8.8 3 2.9 3 5.5"],
  attendance: ["M5 4h14v17H5z", "M9 2.5v3", "M15 2.5v3", "M8.5 13l2.5 2.5 4.5-5"],
  messages: ["M4 5h16v11H9l-5 4z", "M8 9.5h8", "M8 12.5h5"],
  library: ["M5 4h4v16H5z", "M10 4h4v16h-4z", "M15.5 4.5l3.5 1-4 15-3.5-1"],
  catalog: ["M3 6h18v12H3z", "M3 10h18", "M7 14.5h4"],
  finances: ["M12 3v18", "M16.5 7.5c-.6-1.5-2.3-2.5-4.5-2.5-2.5 0-4.5 1.3-4.5 3.2 0 4.3 9 2.3 9 6.6 0 1.9-2 3.2-4.5 3.2-2.2 0-4-1-4.6-2.6"],
  reports: ["M4 20h16", "M7 16v-5", "M12 16V6", "M17 16v-8"],
  exports: ["M12 4v11", "M7.5 10.5L12 15l4.5-4.5", "M4 19h16"],
  changes: ["M12 7v5l3 2", "M12 21a9 9 0 1 0-9-9", "M3 12V7", "M3 12h5"],
  staff: ["M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z", "M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8", "M15.5 17.5l1.5 1.5 3-3"],
  food: ["M7 3v7a2 2 0 0 0 4 0V3", "M9 10v11", "M16.5 3c-1.9 0-3 2.5-3 6 0 2 1 3 3 3v9"],
  flag: ["M5 21V4", "M5 4h12l-2 4 2 4H5"],
  bug: ["M8 9a4 4 0 0 1 8 0v5a4 4 0 0 1-8 0z", "M12 10v8", "M4 12h4", "M16 12h4", "M5 7l3 2", "M19 7l-3 2", "M5 19l3-2", "M19 19l-3-2"],
  search: ["M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z", "M20 20l-4-4"],
  menu: ["M4 7h16", "M4 12h16", "M4 17h16"],
  close: ["M6 6l12 12", "M18 6L6 18"],
  logout: ["M15 4h4v16h-4", "M10 8l-4 4 4 4", "M6 12h11"],
  "member-view": ["M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z", "M5 21c0-3.9 3.1-7 7-7s7 3.1 7 7"],
  "arrow-up": ["M7 14l5-5 5 5"],
  "arrow-down": ["M7 10l5 5 5-5"],
  "chevron-right": ["M9.5 6l6 6-6 6"],
  alert: ["M12 4l9 16H3z", "M12 10v4", "M12 17h.01"],
  calendar: ["M4 6h16v14H4z", "M4 10h16", "M8 3v4", "M16 3v4"],
  settings: ["M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z", "M19.4 13.5a7.6 7.6 0 0 0 0-3l2-1.5-2-3.5-2.4.9a7.5 7.5 0 0 0-2.6-1.5L14 2.5h-4l-.4 2.4A7.5 7.5 0 0 0 7 6.4l-2.4-.9-2 3.5 2 1.5a7.6 7.6 0 0 0 0 3l-2 1.5 2 3.5 2.4-.9a7.5 7.5 0 0 0 2.6 1.5l.4 2.4h4l.4-2.4a7.5 7.5 0 0 0 2.6-1.5l2.4.9 2-3.5z"],
  spark: ["M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z", "M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z"],
  clock: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "M12 7v5l3 2"],
};

export function AdminIcon({ name, className = "h-5 w-5", ...rest }: { name: AdminIconName } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
      {...rest}
    >
      {PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
