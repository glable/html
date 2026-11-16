'use strict';

const { generateMerchants } = require('./mock');
const httpProvider = require('./http');
const cache = require('../cache');

async function loadDeals({ lat, lng, radius }) {
  const mode = (process.env.DATA_SOURCE || 'auto').toLowerCase();
  const hasRemote = Boolean(process.env.DEALS_API_URL);

  if (mode === 'mock' || (mode === 'auto' && !hasRemote)) {
    const merchants = generateMerchants(lat, lng);
    cache.remember(merchants);
    return { source: 'mock', merchants, fallbackReason: null };
  }

  try {
    const merchants = await httpProvider.fetchDeals({ lat, lng, radius });
    cache.remember(merchants);
    return { source: 'http', merchants, fallbackReason: null };
  } catch (err) {
    if (mode === 'http') throw new Error(`真实数据源不可用：${err.message}`);
    const merchants = generateMerchants(lat, lng);
    cache.remember(merchants);
    return {
      source: 'mock',
      merchants,
      fallbackReason: err.message
    };
  }
}

module.exports = { loadDeals };
