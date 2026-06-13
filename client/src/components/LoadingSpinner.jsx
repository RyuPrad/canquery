export default function LoadingSpinner({ label }) {
  return (
    <div className="flex items-center justify-center gap-3 py-10 text-base-content/60">
      <span className="loading loading-spinner loading-md text-primary"></span>
      {label && <span className="text-sm">{label}</span>}
    </div>
  );
}
