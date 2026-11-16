'use strict';

const MAX_ENTRIES = 800;
const cache = new Map();

function remember(merchants) {
  for (const merchant of merchants) {
    if (!merchant || !merchant.id) continue;
    if (cache.has(merchant.id)) cache.delete(merchant.id);
    cache.set(merchant.id, merchant);
  }
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
}

function get(id) {
  return cache.get(String(id)) || null;
}

module.exports = { remember, get };
