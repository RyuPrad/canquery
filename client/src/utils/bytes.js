// Human sizes for progress text: decimal units, one decimal above kilobytes.
export function formatBytes(bytes, lang = 'en') {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value < 0) return '';
  const locale = lang === 'fr' ? 'fr-CA' : 'en-CA';
  const unit =
    value >= 1e9
      ? ['GB', 'Go', 1e9]
      : value >= 1e6
        ? ['MB', 'Mo', 1e6]
        : value >= 1e3
          ? ['KB', 'ko', 1e3]
          : null;
  if (!unit) return new Intl.NumberFormat(locale).format(value) + (lang === 'fr' ? ' o' : ' B');
  const number = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  }).format(value / unit[2]);
  return number + ' ' + (lang === 'fr' ? unit[1] : unit[0]);
}
