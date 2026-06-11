

export default function SearchBar({ value, onChange, placeholder = 'Search datasets... housing, water, wildfire, census' }) {
  return (
    <div className="form-control w-full">
      <input
        type="search"
        className="input input-bordered input-lg w-full"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}
