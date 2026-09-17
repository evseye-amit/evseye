import type { SVGProps } from "react";

const paths = {
  eye: ["M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 12 2 12Z", "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z"],
  building: ["M3 21h18", "M5 21V7l7-4 7 4v14", "M9 10h2", "M13 10h2", "M9 14h2", "M13 14h2", "M10 21v-4h4v4"],
  phone: ["M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z", "M10 18h4"],
  shield: ["M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z", "m9 12 2 2 4-4"],
  dashboard: ["M3 3h8v8H3z", "M13 3h8v5h-8z", "M13 10h8v11h-8z", "M3 13h8v8H3z"],
  category: ["M3 4h8v7H3z", "M13 4h8v7h-8z", "M3 13h8v7H3z", "M13 13h8v7h-8z"],
  vehicle: ["M5 17h14l-1-7H6l-1 7Z", "m7 10 2-4h6l2 4", "M7 17v2", "M17 17v2", "M8 14h2", "M14 14h2"],
  factory: ["M3 21V9l6 3V9l6 3V5h6v16H3Z", "M7 16h2", "M12 16h2", "M17 16h2"],
  feature: ["M12 2 9.5 9.5 2 12l7.5 2.5L12 22l2.5-7.5L22 12l-7.5-2.5L12 2Z"],
  pricing: ["M12 2v20", "M17 6H9a3 3 0 0 0 0 6h6a3 3 0 0 1 0 6H6"],
  tiers: ["M4 19h4v-5H4z", "M10 19h4v-9h-4z", "M16 19h4V5h-4z"],
  package: ["M3 7 12 3l9 4-9 4-9-4Z", "M3 7v10l9 4 9-4V7", "M12 11v10"],
  packageFeature: ["M3 7 12 3l9 4-9 4-9-4Z", "M3 7v10l9 4 9-4V7", "M12 11v10", "M17 14h4", "M19 12v4"],
  users: ["M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2", "M9 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z", "M22 20v-2a4 4 0 0 0-3-3.87", "M16 2.13a4 4 0 0 1 0 7.75"],
  teamLead: ["M12 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z", "M7 19v-2a5 5 0 0 1 10 0v2H7Z", "M4 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z", "M20 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z", "M1 20v-3a3 3 0 0 1 3-3h1", "M23 20v-3a3 3 0 0 0-3-3h-1"],
  clusterManager: ["M12 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z", "M12 6v4", "M4 10h16", "M4 10v2", "M20 10v2", "M12 10v2", "M4 13a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z", "M12 13a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z", "M20 13a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z", "M1 22v-2a3 3 0 0 1 6 0v2H1Z", "M9 22v-2a3 3 0 0 1 6 0v2H9Z", "M17 22v-2a3 3 0 0 1 6 0v2h-6Z"],
  user: ["M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z", "M4 21v-2a8 8 0 0 1 16 0v2H4Z"],
  link: ["M10 13a5 5 0 0 0 7.54.54l2-2a5 5 0 0 0-7.07-7.07l-1.15 1.15", "M14 11a5 5 0 0 0-7.54-.54l-2 2a5 5 0 0 0 7.07 7.07l1.15-1.15"],
  allocation: ["M4 7h14", "m15 4 4-4-4-4", "M20 17H6", "m9 13-4 4 4 4"],
  camera: ["M3 7h4l2-3h6l2 3h4v13H3V7Z", "M12 11a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z"],
  iot: ["M12 19h.01", "M8 16a6 6 0 0 1 8 0", "M5 12a10 10 0 0 1 14 0", "M2 8a14 14 0 0 1 20 0"],
  battery: ["M3 7h16v10H3V7Z", "M21 10v4", "M10 9 7 13h4l-1 3 5-5h-4l1-2"],
  wallet: ["M3 6h16a2 2 0 0 1 2 2v12H3a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h15", "M21 11h-6a2 2 0 0 0 0 4h6", "M16 13h.01"],
  earnings: ["M3 17 9 11l4 4 8-8", "M16 7h5v5", "M3 21h18"],
  location: ["M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z", "M12 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z"],
  zone: ["M3 3h18v18H3z", "M7 7h10v10H7z", "M12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z"],
  reports: ["M4 3h12l4 4v14H4V3Z", "M16 3v5h4", "M8 16v2", "M12 13v5", "M16 11v7"],
  audit: ["M4 4h16v16H4z", "M8 9h8", "M8 13h8", "M8 17h5"],
  usage: ["M12 3a9 9 0 1 0 9 9", "M12 3v9l6 3", "M17 3h4v4"],
  chevron: ["m6 9 6 6 6-6"],
  arrowRight: ["M4 12h16", "m14 6 6 6-6 6"],
} as const;

export type IconName = keyof typeof paths;

export function UiIcon({ name, className = "", ...props }: SVGProps<SVGSVGElement> & { name: IconName }) {
  return (
    <svg
      aria-hidden="true"
      className={`ui-icon ${className}`.trim()}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      {...props}
    >
      {paths[name].map((d, index) => <path key={index} d={d} />)}
    </svg>
  );
}
