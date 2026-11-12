'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'store.json');

const DEFAULT_STATE = { favorites: {}, reminders: [] };

let state = null;
let saveTimer = null;

function load() {
  if (state) return;
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    state = {
      favorites: parsed.favorites && typeof parsed.favorites === 'object' ? parsed.favorites : {},
      reminders: Array.isArray(parsed.reminders) ? parsed.reminders : []
    };
  } catch {
    state = JSON.parse(JSON.stringify(DEFAULT_STATE));
  }
}

function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2), 'utf8');
    } catch (err) {
      console.warn('[store] 写入失败:', err.message);
    }
  }, 60);
}

function cleanClientId(clientId) {
  return String(clientId || '').slice(0, 80);
}

function listFavorites(clientId) {
  load();
  const id = cleanClientId(clientId);
  return (state.favorites[id] || []).slice().sort((a, b) => b.addedAt - a.addedAt);
}

function addFavorite(clientId, merchant) {
  load();
  const id = cleanClientId(clientId);
  if (!id) throw new Error('缺少 clientId');
  const list = state.favorites[id] || (state.favorites[id] = []);
  const existing = list.find((item) => item.merchantId === merchant.id);
  if (existing) return existing;

  const soonest = merchant.discounts
    .map((d) => d.endsAt)
    .filter(Boolean)
    .sort()[0];

  const item = {
    merchantId: merchant.id,
    addedAt: Date.now(),
    snapshot: {
      id: merchant.id,
      name: merchant.name,
      category: merchant.category,
      categoryKey: merchant.categoryKey,
      categoryShort: merchant.categoryShort,
      rating: merchant.rating,
      distanceM: merchant.distanceM,
      deliveryFee: merchant.deliveryFee,
      minOrder: merchant.minOrder,
      potentialSaving: merchant.potentialSaving,
      topDeal: merchant.discounts[0]?.title || '',
      soonestEndsAt: soonest || null,
      address: merchant.address
    }
  };
  list.unshift(item);
  scheduleSave();
  return item;
}

function removeFavorite(clientId, merchantId) {
  load();
  const id = cleanClientId(clientId);
  const list = state.favorites[id];
  if (!list) return false;
  const index = list.findIndex((item) => item.merchantId === merchantId);
  if (index === -1) return false;
  list.splice(index, 1);
  scheduleSave();
  return true;
}

function listReminders(clientId) {
  load();
  const id = cleanClientId(clientId);
  return state.reminders
    .filter((r) => r.clientId === id)
    .slice()
    .sort((a, b) => a.remindAt - b.remindAt);
}

function addReminder({ clientId, merchant, discount, offsetMinutes }) {
  load();
  const id = cleanClientId(clientId);
  if (!id) throw new Error('缺少 clientId');

  const endsAt = Date.parse(discount.endsAt);
  const now = Date.now();
  if (!Number.isFinite(endsAt) || endsAt <= now) {
    throw new Error('该优惠已结束，换一个优惠试试');
  }

  const offset = Math.max(1, Math.min(24 * 60, Number(offsetMinutes) || 60));
  const remindAt = Math.max(now + 15000, endsAt - offset * 60000);

  const duplicate = state.reminders.find(
    (r) =>
      r.clientId === id &&
      r.merchantId === merchant.id &&
      r.promoId === discount.id &&
      !r.notified
  );

  if (duplicate) {
    duplicate.remindAt = remindAt;
    duplicate.endsAt = endsAt;
    duplicate.offsetMinutes = offset;
    scheduleSave();
    return duplicate;
  }

  const reminder = {
    id: crypto.randomUUID(),
    clientId: id,
    merchantId: merchant.id,
    merchantName: merchant.name,
    promoId: discount.id,
    promoTitle: discount.title,
    endsAt,
    remindAt,
    offsetMinutes: offset,
    notified: false,
    createdAt: now
  };
  state.reminders.push(reminder);
  scheduleSave();
  return reminder;
}

function removeReminder(clientId, reminderId) {
  load();
  const id = cleanClientId(clientId);
  const index = state.reminders.findIndex(
    (r) => r.id === reminderId && r.clientId === id
  );
  if (index === -1) return false;
  state.reminders.splice(index, 1);
  scheduleSave();
  return true;
}

function dueReminders(clientId) {
  load();
  const id = cleanClientId(clientId);
  const now = Date.now();
  const due = state.reminders.filter(
    (r) => r.clientId === id && !r.notified && r.remindAt <= now
  );
  if (due.length) {
    due.forEach((r) => {
      r.notified = true;
      r.notifiedAt = now;
    });
    scheduleSave();
  }
  return due.map((r) => ({
    id: r.id,
    merchantId: r.merchantId,
    merchantName: r.merchantName,
    promoTitle: r.promoTitle,
    endsAt: r.endsAt,
    remindAt: r.remindAt
  }));
}

module.exports = {
  listFavorites,
  addFavorite,
  removeFavorite,
  listReminders,
  addReminder,
  removeReminder,
  dueReminders
};
