import { Link } from 'react-router-dom';

export default function Navbar() {
  return (
    <header className="navbar bg-base-200 sticky top-0 z-30 shadow">
      <div className="flex-1">
        <Link to="/" className="text-xl font-bold tracking-tight px-2">
          <span>open</span>
          <span className="text-[#d52b1e]">canada</span>
        </Link>
      </div>
      <nav className="flex gap-1 items-center">
        <Link to="/" className="btn btn-ghost btn-sm">Datasets</Link>
        <Link to="/organizations" className="btn btn-ghost btn-sm">Organizations</Link>
        <Link to="/docs" className="btn btn-ghost btn-sm">API docs</Link>
        <a
          href="https://open.canada.ca/data/en/dataset"
          target="_blank"
          rel="noreferrer"
          className="btn btn-ghost btn-sm opacity-60"
        >
          open.canada.ca
        </a>
      </nav>
    </header>
  );
}
