function seoRange(doc) {
  const nodes = Array.from(doc.head.childNodes);
  const start = nodes.find(node => node.nodeType === 8 && node.data.trim() === 'seo:start');
  const end = nodes.find(node => node.nodeType === 8 && node.data.trim() === 'seo:end');
  if (!start || !end || nodes.indexOf(start) >= nodes.indexOf(end)) return null;
  return { start, end, nodes: nodes.slice(nodes.indexOf(start) + 1, nodes.indexOf(end)) };
}

// Only the server-owned SEO block is copied. Analytics, assets, CSP and other
// head elements remain owned by the original document.
export function readSeoElements(html, responseUrl) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const range = seoRange(doc);
  if (!range) throw new Error('Missing SEO block');
  const elements = range.nodes.filter(node => {
    if (node.nodeType !== 1) return false;
    if (node.tagName === 'TITLE') return true;
    if (node.tagName === 'LINK') return node.getAttribute('rel') === 'canonical' ||
      (node.getAttribute('rel') === 'alternate' && ['en-CA', 'fr-CA', 'x-default'].includes(node.getAttribute('hreflang')));
    if (node.tagName === 'META') {
      return /^(description|robots|twitter:.+)$/.test(node.getAttribute('name') || '') ||
        /^og:/.test(node.getAttribute('property') || '');
    }
    return node.tagName === 'SCRIPT' && node.getAttribute('type') === 'application/ld+json';
  });
  const titles = elements.filter(node => node.tagName === 'TITLE');
  const canonicals = elements.filter(node => node.tagName === 'LINK' && node.getAttribute('rel') === 'canonical');
  if (titles.length !== 1 || !titles[0].textContent.trim() || canonicals.length !== 1) {
    throw new Error('Invalid SEO identity');
  }
  const canonical = new URL(canonicals[0].getAttribute('href'), responseUrl);
  if (!['http:', 'https:'].includes(canonical.protocol) ||
      canonical.pathname !== new URL(responseUrl).pathname) {
    throw new Error('SEO response belongs to a different page');
  }
  return elements.map(node => {
    if (node.tagName === 'LINK' && node.getAttribute('rel') === 'alternate' &&
        new URL(node.getAttribute('href'), responseUrl).origin !== canonical.origin) {
      throw new Error('Invalid alternate origin');
    }
    const copy = document.createElement(node.tagName.toLowerCase());
    for (const name of ['name', 'content', 'property', 'rel', 'href', 'hreflang', 'type']) {
      if (node.hasAttribute(name)) copy.setAttribute(name, node.getAttribute(name));
    }
    if (node.tagName === 'SCRIPT') JSON.parse(node.textContent);
    copy.textContent = node.textContent;
    return copy;
  });
}

export function replaceSeoHead(elements) {
  const range = seoRange(document);
  if (!range) return;
  const fragment = document.createDocumentFragment();
  for (const element of elements) fragment.append(element);
  for (const node of range.nodes) node.remove();
  range.end.before(fragment);
}

export function clearRouteHead(pathname, siteOrigin) {
  const title = document.createElement('title');
  title.textContent = 'CanQuery';
  const canonical = document.createElement('link');
  canonical.rel = 'canonical';
  canonical.href = new URL(pathname, siteOrigin).href;
  // A failed metadata fetch cannot justify retaining another entity's schema
  // or declaring the current, potentially valid page permanently missing.
  replaceSeoHead([title, canonical]);
}
