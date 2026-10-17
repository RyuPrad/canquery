// Same rule as the server's related-guides block: guides about the same place
// first, then the same topic, newest first within each group.
export function relatedGuides(guides, article, limit = 3) {
  const score = other => (article.place && other.place === article.place ? 2 : 0) + (other.topic === article.topic ? 1 : 0);
  return guides.filter(other => other.id !== article.id && score(other) > 0)
    .sort((a, b) => score(b) - score(a) || b.published.localeCompare(a.published) || a.id.localeCompare(b.id))
    .slice(0, limit);
}
