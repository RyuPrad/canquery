export function businessPrice(price, lang = 'en') {
  if (price?.currency !== 'cad' || price.interval !== 'month' || !Number.isSafeInteger(price.amount) || price.amount <= 0) return null;
  const amount = (price.amount / 100).toLocaleString(lang === 'fr' ? 'fr-CA' : 'en-CA', {
    minimumFractionDigits: price.amount % 100 ? 2 : 0, maximumFractionDigits: 2,
  });
  return lang === 'fr' ? `${amount} $ CA` : `CA$${amount}`;
}

export function currentTermsVersion(plans) {
  const value = plans?.terms_version;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
}
