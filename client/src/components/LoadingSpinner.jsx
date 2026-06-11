export default function LoadingSpinner({ label }) {
  return (
    <div className="flex items-center justify-center gap-3 py-10 text-base-content/70">
      <span className="loading loading-spinner loading-md text-[#d52b1e]"></span>
      {label && <span>{label}</span>}
    </div>
  );
}
