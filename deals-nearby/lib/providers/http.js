'use strict';

const { haversine, bearing } = require('../geo');
const { hashString } = require('../random');

const VALID_TYPES = new Set(['full_reduction', 'new_user', 'voucher', 'flash_sale']);

function normalizeDiscount(raw, index) {
  if (!raw || !raw.type) return null;
  if (!VALID_TYPES.has(raw.type)) return null;

  const endsAt = raw.endsAt || raw.endTime || raw.expiresAt;
  const discount = {
    id: String(raw.id || `${raw.type}_${index}`),
    type: raw.type,
    title: String(raw.title || '').slice(0, 120) || raw.type,
    endsAt: endsAt ? new Date(endsAt).toISOString() : new Date(Date.now() + 6 * 3600e3).toISOString()
  };

  if (raw.type === 'full_reduction' && Array.isArray(raw.tiers)) {
    discount.tiers = raw.tiers
      .map((t) => ({ threshold: Number(t.threshold), amount: Number(t.amount) }))
      .filter((t) => Number.isFinite(t.threshold) && Number.isFinite(t.amount))
      .sort((a, b) => a.threshold - b.threshold);
    if (!discount.tiers.length) return null;
  }
  if (raw.type === 'new_user') discount.amount = Number(raw.amount) || 0;
  if (raw.type === 'voucher') {
    discount.rate = Number(raw.rate) || 0;
    discount.maxAmount = Number(raw.maxAmount) || 10;
  }
  if (raw.type === 'flash_sale') {
    discount.price = Number(raw.price) || 0;
    discount.original = Number(raw.original) || discount.price;
    discount.dishId = raw.dishId ? String(raw.dishId) : undefined;
  }
  return discount;
}

function normalizeMerchant(raw, center) {
  if (!raw || !raw.name) return null;

  const lat = Number(raw.lat);
  const lng = Number(raw.lng);
  const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);

  const distanceM = Number.isFinite(Number(raw.distanceM))
    ? Math.round(Number(raw.distanceM))
    : hasCoords
      ? Math.round(haversine(center.lat, center.lng, lat, lng))
      : 99999;

  const brg = Number.isFinite(Number(raw.bearing))
    ? Number(raw.bearing)
    : hasCoords
      ? Math.round(bearing(center.lat, center.lng, lat, lng) * 10) / 10
      : 0;

  const dishes = Array.isArray(raw.dishes)
    ? raw.dishes
        .map((d, i) => ({
          id: String(d.id || `d${i}`),
          name: String(d.name || `菜品 ${i + 1}`),
          price: Number(d.price) || 0,
          salePrice: d.salePrice != null ? Number(d.salePrice) : undefined
        }))
        .filter((d) => d.price > 0)
    : [];

  const discounts = Array.isArray(raw.discounts)
    ? raw.discounts.map(normalizeDiscount).filter(Boolean)
    : [];

  const fullReduction = discounts.find((d) => d.type === 'full_reduction');
  const baseTotal = (Number(raw.minOrder) || 20) + 10;
  const tier = (fullReduction?.tiers || [])
    .slice()
    .reverse()
    .find((t) => t.threshold <= baseTotal);
  const newUser = discounts.find((d) => d.type === 'new_user');
  const voucher = discounts.find((d) => d.type === 'voucher');
  const flash = discounts.find((d) => d.type === 'flash_sale');
  const potentialSaving = Math.round(
    (tier?.amount || 0) +
      (newUser?.amount || 0) +
      (voucher ? Math.min(baseTotal * voucher.rate, voucher.maxAmount) : 0) +
      (flash ? Math.max(0, flash.original - flash.price) : 0)
  );

  return {
    id: String(raw.id || `ext_${hashString(`${raw.name}:${lat}:${lng}`)}`),
    name: String(raw.name).slice(0, 60),
    category: String(raw.category || '其他'),
    categoryKey: String(raw.categoryKey || 'other'),
    categoryShort: String(raw.categoryShort || String(raw.category || '其他').slice(0, 2)),
    rating: Math.min(5, Math.max(0, Number(raw.rating) || 4.5)),
    monthlySales: Number(raw.monthlySales) || 0,
    distanceM,
    bearing: brg,
    lat: hasCoords ? lat : undefined,
    lng: hasCoords ? lng : undefined,
    deliveryFee: Number(raw.deliveryFee) || 0,
    minOrder: Number(raw.minOrder) || 0,
    deliveryTimeMin: Number(raw.deliveryTimeMin) || 30,
    address: String(raw.address || ''),
    tags: Array.isArray(raw.tags) ? raw.tags.slice(0, 3).map(String) : [],
    dishes,
    discounts,
    potentialSaving,
    savingRate: Math.round((potentialSaving / Math.max(1, baseTotal)) * 100),
    source: 'http'
  };
}

async function fetchDeals({ lat, lng, radius }) {
  const endpoint = process.env.DEALS_API_URL;
  if (!endpoint) throw new Error('DEALS_API_URL 未配置');

  const url = new URL(endpoint);
  url.searchParams.set('lat', String(lat));
  url.searchParams.set('lng', String(lng));
  url.searchParams.set('radius', String(radius));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);

  try {
    const headers = { Accept: 'application/json' };
    if (process.env.DEALS_API_KEY) {
      headers.Authorization = `Bearer ${process.env.DEALS_API_KEY}`;
    }
    const res = await fetch(url, { headers, signal: controller.signal });
    if (!res.ok) throw new Error(`上游接口返回 ${res.status}`);
    const data = await res.json();
    const rawList = Array.isArray(data)
      ? data
      : Array.isArray(data.merchants)
        ? data.merchants
        : Array.isArray(data.data)
          ? data.data
          : [];
    return rawList
      .map((item) => normalizeMerchant(item, { lat, lng }))
      .filter(Boolean);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { fetchDeals };
