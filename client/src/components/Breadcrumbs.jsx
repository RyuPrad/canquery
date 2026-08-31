import { Link } from 'react-router-dom';
import { ArrowRightIcon } from './Icons.jsx';

export default function Breadcrumbs({ items, label, className = '' }) {
  const visible = (items || []).filter(item => item && item.label);
  return (
    <nav
      className={'flex flex-wrap items-center gap-1.5 text-xs text-base-content/45 ' + className}
      aria-label={label}
    >
      {visible.map((item, index) => {
        const current = index === visible.length - 1;
        return (
          <span key={(item.to || 'current') + '-' + index} className="inline-flex items-center gap-1.5">
            {index > 0 && <ArrowRightIcon size={10} />}
            {!current && item.to ? (
              <Link to={item.to} className="hover:text-base-content">{item.label}</Link>
            ) : (
              <span className="text-base-content/70" aria-current={current ? 'page' : undefined}>
                {item.label}
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
