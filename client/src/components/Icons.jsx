// Hand-rolled icon set (lucide-style strokes) - keeps the bundle free of an
// icon-library dependency. Every icon inherits `currentColor`.

function I({ children, size = 16, className = '', strokeWidth = 1.8, viewBox = '0 0 24 24' }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={viewBox}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

// The 11-point leaf from the federal flag (public domain), tightly framed.
export function MapleLeaf({ size = 16, className = '' }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="2690 250 4220 4330"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M4890 4430l-45-863a95 95 0 0 1 111-98l859 151-116-320a65 65 0 0 1 20-73l941-762-212-99a65 65 0 0 1-34-79l186-572-542 115a65 65 0 0 1-73-38l-105-247-423 454a65 65 0 0 1-111-57l204-1052-327 189a65 65 0 0 1-91-27l-332-652-332 652a65 65 0 0 1-91 27l-327-189 204 1052a65 65 0 0 1-111 57l-423-454-105 247a65 65 0 0 1-73 38l-542-115 186 572a65 65 0 0 1-34 79l-212 99 941 762a65 65 0 0 1 20 73l-116 320 859-151a95 95 0 0 1 111 98l-45 863z" />
    </svg>
  );
}

// GitHub mark (brand logo, conventionally filled).
export function GithubIcon({ size = 16, className = '' }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

export function SearchIcon(props) {
  return (
    <I {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.35-4.35" />
    </I>
  );
}

export function DatabaseIcon(props) {
  return (
    <I {...props}>
      <ellipse cx="12" cy="5" rx="8" ry="3" />
      <path d="M4 5v14c0 1.66 3.58 3 8 3s8-1.34 8-3V5" />
      <path d="M4 12c0 1.66 3.58 3 8 3s8-1.34 8-3" />
    </I>
  );
}

export function UnlockIcon(props) {
  return (
    <I {...props}>
      <rect x="3" y="11" width="18" height="10" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 9.9-1" />
    </I>
  );
}

export function LockIcon(props) {
  return (
    <I {...props}>
      <rect x="3" y="11" width="18" height="10" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </I>
  );
}

export function ChartIcon(props) {
  return (
    <I {...props}>
      <path d="M3 3v18h18" />
      <path d="M8 17v-5" />
      <path d="M13 17V8" />
      <path d="M18 17v-8" />
    </I>
  );
}

export function LineChartIcon(props) {
  return (
    <I {...props}>
      <path d="M3 3v18h18" />
      <path d="m7 14 4-4 3 3 5-6" />
    </I>
  );
}

export function TableIcon(props) {
  return (
    <I {...props}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 10h18" />
      <path d="M10 10v10" />
    </I>
  );
}

export function DownloadIcon(props) {
  return (
    <I {...props}>
      <path d="M12 3v12" />
      <path d="m7 11 5 5 5-5" />
      <path d="M5 21h14" />
    </I>
  );
}

export function ExternalIcon(props) {
  return (
    <I {...props}>
      <path d="M14 4h6v6" />
      <path d="M20 4 11 13" />
      <path d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5" />
    </I>
  );
}

export function ArrowLeftIcon(props) {
  return (
    <I {...props}>
      <path d="M19 12H5" />
      <path d="m12 19-7-7 7-7" />
    </I>
  );
}

export function ArrowRightIcon(props) {
  return (
    <I {...props}>
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </I>
  );
}

export function BuildingIcon(props) {
  return (
    <I {...props}>
      <rect x="5" y="3" width="14" height="18" rx="1.5" />
      <path d="M10 21v-4h4v4" />
      <path d="M9 7h2M13 7h2M9 11h2M13 11h2" />
    </I>
  );
}

export function CalendarIcon(props) {
  return (
    <I {...props}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M16 3v4M8 3v4M3 11h18" />
    </I>
  );
}

export function ZapIcon(props) {
  return (
    <I {...props}>
      <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z" />
    </I>
  );
}

export function SparklesIcon(props) {
  return (
    <I {...props}>
      <path d="M11 4 12.7 8.8 17.5 10.5 12.7 12.2 11 17 9.3 12.2 4.5 10.5 9.3 8.8 11 4z" />
      <path d="M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8L19 14z" />
    </I>
  );
}

export function CopyIcon(props) {
  return (
    <I {...props}>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </I>
  );
}

export function CheckIcon(props) {
  return (
    <I {...props}>
      <path d="M20 6 9 17l-5-5" />
    </I>
  );
}

export function GlobeIcon(props) {
  return (
    <I {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a13.5 13.5 0 0 1 3.5 9 13.5 13.5 0 0 1-3.5 9 13.5 13.5 0 0 1-3.5-9A13.5 13.5 0 0 1 12 3z" />
    </I>
  );
}

export function FileIcon(props) {
  return (
    <I {...props}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </I>
  );
}

export function PlayIcon(props) {
  return (
    <I {...props}>
      <path d="M7 4.5v15l12-7.5-12-7.5z" />
    </I>
  );
}

export function XIcon(props) {
  return (
    <I {...props}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </I>
  );
}
