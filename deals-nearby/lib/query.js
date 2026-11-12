'use strict';

function toNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function matchesQuery(merchant, q) {
  if (!q) return true;
  const haystack = [
    merchant.name,
    merchant.category,
    merchant.address,
    ...merchant.tags,
    ...merchant.dishes.map((d) => d.name),
    ...merchant.discounts.map((d) => d.title)
  ]
    .join(' ')
    .toLowerCase();
  return haystack.includes(q.toLowerCase());
}

function filterDeals(merchants, params) {
  const radius = toNumber(params.radius, 3000);
  const maxDeliveryFee =
    params.maxDeliveryFee === undefined || params.maxDeliveryFee === ''
      ? null
      : toNumber(params.maxDeliveryFee, null);
  const minSaving = toNumber(params.minSaving, 0);
  const category = String(params.category || 'all');
  const types = String(params.types || '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  const q = String(params.q || '').trim();

  return merchants.filter((merchant) => {
    if (merchant.distanceM > radius) return false;
    if (category !== 'all' && merchant.categoryKey !== category) return false;
    if (maxDeliveryFee !== null && merchant.deliveryFee > maxDeliveryFee) return false;
    if (merchant.potentialSaving < minSaving) return false;
    if (types.length) {
      const hasType = merchant.discounts.some((d) => types.includes(d.type));
      if (!hasType) return false;
    }
    if (!matchesQuery(merchant, q)) return false;
    return true;
  });
}

function sortDeals(merchants, sort, radius) {
  const list = merchants.slice();
  const maxSaving = Math.max(1, ...list.map((m) => m.potentialSaving));
  const maxSales = Math.max(1, ...list.map((m) => m.monthlySales));

  const scoreOf = (m) =>
    (m.potentialSaving / maxSaving) * 0.45 +
    (1 - Math.min(m.distanceM / Math.max(1, radius), 1)) * 0.3 +
    ((m.rating - 3.5) / 1.5) * 0.15 +
    (m.monthlySales / maxSales) * 0.1;

  const comparators = {
    distance: (a, b) => a.distanceM - b.distanceM,
    saving: (a, b) => b.potentialSaving - a.potentialSaving,
    rating: (a, b) => b.rating - a.rating || a.distanceM - b.distanceM,
    sales: (a, b) => b.monthlySales - a.monthlySales,
    smart: (a, b) => scoreOf(b) - scoreOf(a)
  };

  list.sort(comparators[sort] || comparators.smart);
  list.forEach((m) => {
    m.dealScore = Math.round(scoreOf(m) * 1000) / 1000;
  });
  return list;
}

function buildStats(merchants, now = Date.now()) {
  const expiringPromos = merchants
    .flatMap((m) => m.discounts)
    .filter((d) => {
      const endsAt = Date.parse(d.endsAt);
      return Number.isFinite(endsAt) && endsAt > now && endsAt - now <= 6 * 3600e3;
    }).length;

  const maxSaving = merchants.reduce((max, m) => Math.max(max, m.potentialSaving), 0);
  const avgDeliveryFee = merchants.length
    ? Math.round(
        (merchants.reduce((sum, m) => sum + m.deliveryFee, 0) / merchants.length) * 10
      ) / 10
    : 0;

  return {
    count: merchants.length,
    maxSaving,
    expiringPromos,
    avgDeliveryFee
  };
}

module.exports = { filterDeals, sortDeals, buildStats };
