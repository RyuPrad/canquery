export function promotionProperties(element) {
  const data = element?.dataset;
  if (data?.promotion !== 'hello_mochi' || !['home_card', 'footer'].includes(data.promotionPlacement)) return {};
  return {
    promotion: 'hello_mochi',
    placement: data.promotionPlacement,
    language: data.promotionLanguage === 'fr' ? 'fr' : 'en',
  };
}
