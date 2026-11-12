'use strict';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const CAT_COLORS = {
  fastfood: '#f0a04b',
  milktea: '#cfa06a',
  bbq: '#d9654b',
  hotpot: '#d45a3e',
  japanese: '#6fae9f',
  noodle: '#d6a94b',
  burger: '#db8438',
  salad: '#7db478',
  dessert: '#d79aab',
  malatang: '#c95e3c',
  other: '#c9a227'
};

const FALLBACK_CATEGORIES = [
  { key: 'fastfood', name: '快餐简餐' },
  { key: 'milktea', name: '奶茶咖啡' },
  { key: 'bbq', name: '烧烤夜宵' },
  { key: 'hotpot', name: '火锅冒菜' },
  { key: 'japanese', name: '日料寿司' },
  { key: 'noodle', name: '面馆米粉' },
  { key: 'burger', name: '炸鸡汉堡' },
  { key: 'salad', name: '轻食沙拉' },
  { key: 'dessert', name: '甜品烘焙' },
  { key: 'malatang', name: '麻辣烫' }
];

const PROMO_LABEL = {
  full_reduction: '满减',
  new_user: '新客',
  voucher: '折扣',
  flash_sale: '秒杀'
};

const PROMO_ORDER = ['full_reduction', 'new_user', 'voucher', 'flash_sale'];

const state = {
  clientId: getClientId(),
  loc: { lat: 31.2304, lng: 121.4737, label: '上海 · 人民广场' },
  radius: 3000,
  category: 'all',
  q: '',
  types: new Set(),
  maxFee: '',
  minSaving: 0,
  sort: 'smart',
  view: 'nearby',
  merchants: [],
  byId: new Map(),
  stats: { count: 0, maxSaving: 0, expiringPromos: 0 },
  favorites: [],
  favIds: new Set(),
  reminders: [],
  modal: null,
  config: null,
  source: 'mock',
  fallbackReason: null
};

let dealsToken = 0;
let fetchTimer = null;

/* ---------- 工具 ---------- */

function getClientId() {
  try {
    let id = localStorage.getItem('xk.client');
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem('xk.client', id);
    }
    return id;
  } catch {
    return `anon-${Math.random().toString(36).slice(2, 12)}`;
  }
}

function esc(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[ch]));
}

function icon(name, cls = '') {
  return `<svg class="ic ${cls}"><use href="#i-${name}"></use></svg>`;
}

function catColor(merchant) {
  return CAT_COLORS[merchant.categoryKey] || CAT_COLORS.other;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function formatMoney(n) {
  const value = Math.round(Number(n) * 100) / 100;
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatDistance(m) {
  const meters = Number(m) || 0;
  return meters < 1000 ? `${meters}m` : `${(meters / 1000).toFixed(1)}km`;
}

function formatLeft(endsAt) {
  const ms = Date.parse(endsAt) - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return '已结束';
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 3600) {
    return `${pad(Math.floor(totalSec / 60))}:${pad(totalSec % 60)}`;
  }
  if (totalSec < 86400) {
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    return `${h}小时${pad(m)}分`;
  }
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  return `${d}天${h}小时`;
}

function formatDateTime(ms) {
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return '--';
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  const tomorrow = new Date(now.getTime() + 86400000);
  const isTomorrow = date.toDateString() === tomorrow.toDateString();
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (sameDay) return `今天 ${time}`;
  if (isTomorrow) return `明天 ${time}`;
  return `${date.getMonth() + 1}月${date.getDate()}日 ${time}`;
}

function nearestDiscount(merchant) {
  return merchant.discounts
    .filter((d) => Date.parse(d.endsAt) > Date.now())
    .sort((a, b) => Date.parse(a.endsAt) - Date.parse(b.endsAt))[0] || null;
}

function promoteChips(merchant) {
  return merchant.discounts.map((d) => {
    if (d.type === 'full_reduction') {
      const first = (d.tiers || [])[0];
      return first ? `满${first.threshold}减${first.amount}` : '店铺满减';
    }
    if (d.type === 'new_user') return `新客 -¥${d.amount}`;
    if (d.type === 'voucher') {
      const zhe = +(10 - d.rate * 10).toFixed(1);
      return `${zhe} 折券`;
    }
    if (d.type === 'flash_sale') return `秒杀 ¥${formatMoney(d.price)}`;
    return d.title;
  });
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    throw new Error((data && data.error) || `请求失败（${res.status}）`);
  }
  return data;
}

function toast(message, tone = '') {
  const root = $('#toastRoot');
  const el = document.createElement('div');
  el.className = `toast ${tone}`;
  el.innerHTML = message;
  root.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity .3s';
    setTimeout(() => el.remove(), 320);
  }, 4200);
}

function debounceFetch(delay = 220) {
  clearTimeout(fetchTimer);
  fetchTimer = setTimeout(loadDeals, delay);
}

/* ---------- 初始化 ---------- */

function init() {
  buildCategoryGrid();
  updateNotifyButton();
  bindEvents();
  loadConfig();
  loadDeals();
  loadFavorites();
  loadReminders();
  setInterval(tickCountdowns, 1000);
  setInterval(pollDueReminders, 20000);
  setTimeout(pollDueReminders, 3000);
}

async function loadConfig() {
  try {
    const cfg = await api('/api/config');
    state.config = cfg;
    if (Array.isArray(cfg.categories) && cfg.categories.length) {
      buildCategoryGrid(cfg.categories);
    }
    renderLocMenu(cfg.cities || []);
  } catch {
    renderLocMenu([
      { name: '上海 · 人民广场', lat: 31.2304, lng: 121.4737 },
      { name: '北京 · 国贸', lat: 39.9087, lng: 116.461 },
      { name: '广州 · 天河', lat: 23.1291, lng: 113.3245 },
      { name: '深圳 · 南山', lat: 22.5333, lng: 113.93 },
      { name: '成都 · 春熙路', lat: 30.657, lng: 104.08 },
      { name: '杭州 · 西湖', lat: 30.247, lng: 120.15 }
    ]);
  }
}

function buildCategoryGrid(categories = FALLBACK_CATEGORIES) {
  const grid = $('#catGrid');
  const chips = categories.map((cat) => {
    const color = CAT_COLORS[cat.key] || CAT_COLORS.other;
    const active = state.category === cat.key ? 'is-active' : '';
    return `<button class="cat-chip ${active}" data-cat="${esc(cat.key)}" style="--c:${color}">
      <i></i>${esc(cat.name)}
    </button>`;
  });
  grid.innerHTML = `<button class="cat-chip ${state.category === 'all' ? 'is-active' : ''}" data-cat="all" style="--c:#f4ead8">全部</button>${chips.join('')}`;
}

function renderLocMenu(cities) {
  const menu = $('#locMenu');
  menu.innerHTML =
    `<button data-geo>${icon('pin')} 使用浏览器定位</button><div class="loc-divider"></div>` +
    cities
      .map(
        (city) =>
          `<button data-city="${city.lat},${city.lng}" data-label="${esc(city.name)}">${esc(city.name)}</button>`
      )
      .join('');
}

/* ---------- 事件绑定 ---------- */

function bindEvents() {
  const locBtn = $('#locBtn');
  const locMenu = $('#locMenu');

  locBtn.addEventListener('click', () => {
    const open = !locMenu.hidden;
    locMenu.hidden = open;
    locBtn.setAttribute('aria-expanded', String(!open));
  });

  locMenu.addEventListener('click', (event) => {
    const geoBtn = event.target.closest('[data-geo]');
    if (geoBtn) {
      useGeolocation();
      return;
    }
    const cityBtn = event.target.closest('[data-city]');
    if (cityBtn) {
      const [lat, lng] = cityBtn.dataset.city.split(',').map(Number);
      changeLocation(lat, lng, cityBtn.dataset.label);
    }
  });

  document.addEventListener('click', (event) => {
    if (!event.target.closest('.loc-wrap')) {
      locMenu.hidden = true;
      locBtn.setAttribute('aria-expanded', 'false');
    }
  });

  $('#notifyBtn').addEventListener('click', enableNotifications);
  $('#refreshBtn').addEventListener('click', () => {
    loadDeals();
    toast('已刷新附近优惠');
  });

  const searchInput = $('#searchInput');
  searchInput.addEventListener('input', () => {
    state.q = searchInput.value.trim();
    debounceFetch(320);
  });

  const radiusRange = $('#radiusRange');
  radiusRange.addEventListener('input', () => {
    state.radius = Number(radiusRange.value);
    $('#radiusValue').textContent = `${(state.radius / 1000).toFixed(1)} km`;
    $('#radarRadius').textContent = `半径 ${(state.radius / 1000).toFixed(1)} km`;
    debounceFetch(260);
  });

  $('#catGrid').addEventListener('click', (event) => {
    const chip = event.target.closest('[data-cat]');
    if (!chip) return;
    state.category = chip.dataset.cat;
    $$('#catGrid .cat-chip').forEach((el) => {
      el.classList.toggle('is-active', el === chip);
    });
    loadDeals();
  });

  $('#typeGrid').addEventListener('change', () => {
    state.types = new Set(
      $$('#typeGrid input:checked').map((input) => input.value)
    );
    loadDeals();
  });

  $('#feeSelect').addEventListener('change', (event) => {
    state.maxFee = event.target.value;
    loadDeals();
  });

  const savingRange = $('#savingRange');
  savingRange.addEventListener('input', () => {
    state.minSaving = Number(savingRange.value);
    $('#savingValue').textContent = `¥${state.minSaving}`;
    debounceFetch(260);
  });

  $('#resetFilters').addEventListener('click', resetFilters);

  $('#sortRow').addEventListener('click', (event) => {
    const chip = event.target.closest('[data-sort]');
    if (!chip) return;
    state.sort = chip.dataset.sort;
    $$('#sortRow .sort-chip').forEach((el) => {
      el.classList.toggle('is-active', el === chip);
    });
    loadDeals();
  });

  $$('.view-tab').forEach((tab) => {
    tab.addEventListener('click', () => setView(tab.dataset.view));
  });

  $('#filterToggle').addEventListener('click', () => {
    $('#filterPanel').classList.add('is-open');
    document.body.classList.add('filter-open');
  });

  $('#filterClose').addEventListener('click', () => {
    closeFilters();
  });

  $('#dealGrid').addEventListener('click', (event) => {
    const fav = event.target.closest('[data-fav]');
    if (fav) {
      event.stopPropagation();
      toggleFavorite(fav.dataset.fav);
      return;
    }
    const retry = event.target.closest('[data-retry]');
    if (retry) {
      loadDeals();
      return;
    }
    const reset = event.target.closest('[data-reset-empty]');
    if (reset) {
      resetFilters();
      return;
    }
    const card = event.target.closest('.deal-card');
    if (card) openDetail(card.dataset.id);
  });

  $('#favoritesPane').addEventListener('click', handlePersonalClick);
  $('#remindersPane').addEventListener('click', handlePersonalClick);
  $('#radarDots').addEventListener('click', (event) => {
    const dot = event.target.closest('[data-merchant]');
    if (dot) openDetail(dot.dataset.merchant);
  });
  $('#expiringList').addEventListener('click', (event) => {
    const item = event.target.closest('[data-merchant]');
    if (item) openDetail(item.dataset.merchant);
  });

  const modalRoot = $('#modalRoot');
  modalRoot.addEventListener('click', (event) => {
    if (event.target.closest('[data-close]') || event.target.classList.contains('modal-backdrop')) {
      closeModal();
      return;
    }
    if (!state.modal) return;

    const addBtn = event.target.closest('[data-add]');
    if (addBtn) {
      addBtn.dataset.add.split(',').filter(Boolean).forEach((id) => {
        state.modal.cart.add(id);
      });
      syncDishCheckboxes();
      fetchBundle();
      return;
    }

    if (event.target.closest('[data-fav-modal]')) {
      toggleFavorite(state.modal.merchant.id);
      return;
    }

    const remindBtn = event.target.closest('[data-remind]');
    if (remindBtn) {
      createReminder(Number(remindBtn.dataset.remind));
    }
  });

  modalRoot.addEventListener('change', (event) => {
    const input = event.target.closest('input[data-dish]');
    if (!input || !state.modal) return;
    if (input.checked) {
      state.modal.cart.add(input.dataset.dish);
    } else {
      state.modal.cart.delete(input.dataset.dish);
    }
    fetchBundle();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeModal();
      closeFilters();
      locMenu.hidden = true;
    }
  });
}

function closeFilters() {
  $('#filterPanel').classList.remove('is-open');
  document.body.classList.remove('filter-open');
}

/* ---------- 数据加载 ---------- */

async function loadDeals() {
  const token = ++dealsToken;
  if (!state.merchants.length) renderSkeleton();

  const params = new URLSearchParams({
    lat: String(state.loc.lat),
    lng: String(state.loc.lng),
    radius: String(state.radius),
    category: state.category,
    q: state.q,
    types: Array.from(state.types).join(','),
    maxDeliveryFee: state.maxFee,
    minSaving: String(state.minSaving),
    sort: state.sort
  });

  try {
    const data = await api(`/api/deals?${params.toString()}`);
    if (token !== dealsToken) return;

    state.merchants = data.merchants;
    state.byId = new Map(data.merchants.map((m) => [m.id, m]));
    state.stats = data.stats;
    state.source = data.source;
    state.fallbackReason = data.fallbackReason;

    renderStats();
    renderDeals();
    renderRadar();
    renderExpiring();
    updateSourceBadge();
    updateCounts();
  } catch (err) {
    if (token !== dealsToken) return;
    $('#dealGrid').innerHTML = `
      <div class="empty">
        <h3>优惠加载失败</h3>
        <p>${esc(err.message)}</p>
        <button class="paper-btn" data-retry>重新加载</button>
      </div>`;
    toast(`加载失败：${esc(err.message)}`);
  }
}

async function loadFavorites(render = true) {
  try {
    const data = await api(`/api/favorites?clientId=${encodeURIComponent(state.clientId)}`);
    state.favorites = data.items || [];
    state.favIds = new Set(state.favorites.map((item) => item.merchantId));
    $('#favCount').textContent = String(state.favorites.length);
    syncFavButtons();
    if (render && state.view === 'favorites') renderFavorites();
  } catch {
    /* 静默失败，不打断主流程 */
  }
}

async function loadReminders(render = true) {
  try {
    const data = await api(`/api/reminders?clientId=${encodeURIComponent(state.clientId)}`);
    state.reminders = data.items || [];
    $('#remindCount').textContent = String(state.reminders.length);
    if (render && state.view === 'reminders') renderReminders();
  } catch {
    /* 静默失败 */
  }
}

/* ---------- 渲染：主列表 ---------- */

function renderStats() {
  $('#statCount').textContent = String(state.stats.count || 0);
  $('#statSaving').textContent = String(state.stats.maxSaving || 0);
  $('#statExpiring').textContent = String(state.stats.expiringPromos || 0);
  $('#filterCount').textContent = String(state.stats.count || 0);
}

function updateCounts() {
  const count = state.stats.count || 0;
  $('#resultCount').textContent = `共 ${count} 家 · ${(state.radius / 1000).toFixed(1)} km 内`;
  $('#filterCount').textContent = String(count);
}

function updateSourceBadge() {
  const badge = $('#sourceBadge');
  if (state.source === 'http') {
    badge.textContent = '实时数据';
    badge.classList.add('is-live');
    badge.title = '来自配置的真实数据接口';
  } else if (state.fallbackReason) {
    badge.textContent = '演示 · 兜底';
    badge.classList.remove('is-live');
    badge.title = `真实接口不可用：${state.fallbackReason}`;
  } else {
    badge.textContent = '演示数据';
    badge.classList.remove('is-live');
    badge.title = '本地生成的演示数据，可配置 DEALS_API_URL 接入真实接口';
  }
}

function merchantCard(merchant, index) {
  const color = catColor(merchant);
  const soon = nearestDiscount(merchant);
  const chips = promoteChips(merchant)
    .slice(0, 4)
    .map((chip) => `<span class="deal-chip" title="${esc(chip)}">${esc(chip)}</span>`)
    .join('');
  const isFav = state.favIds.has(merchant.id);

  return `<article class="deal-card" data-id="${esc(merchant.id)}" style="--i:${index}">
    <span class="cat-strip" style="background:${color}"></span>
    <div class="ticket-top">
      <span class="tile" style="background:${color}">${esc(merchant.categoryShort || merchant.category.slice(0, 2))}</span>
      <div class="ticket-title">
        <h3>${esc(merchant.name)}</h3>
        <p>${esc(merchant.category)} · 月售 ${merchant.monthlySales}</p>
      </div>
    </div>
    <div class="stamp"><span>最多省</span><b>¥${merchant.potentialSaving}</b></div>
    <div class="ticket-meta">
      <span class="star">${icon('star')}${merchant.rating}</span>
      <span>${icon('pin')}${formatDistance(merchant.distanceM)}</span>
      <span>${icon('clock')}${merchant.deliveryTimeMin}分钟</span>
      <button class="fav-mini ${isFav ? 'on' : ''}" data-fav="${esc(merchant.id)}" aria-label="收藏 ${esc(merchant.name)}">
        ${icon('heart')}
      </button>
    </div>
    <div class="deal-chips">${chips}</div>
    <div class="ticket-foot">
      <div class="foot-info">
        <p>起送 ¥${merchant.minOrder} · ${merchant.deliveryFee === 0 ? '免配送费' : `配送 ¥${merchant.deliveryFee}`}</p>
        ${soon ? `<p class="ends">${icon('clock')}最近优惠 <b data-ends="${soon.endsAt}">${formatLeft(soon.endsAt)}</b> 后结束</p>` : ''}
      </div>
      <button class="open-btn" data-open="${esc(merchant.id)}">看优惠 / 凑单</button>
    </div>
    <span class="barcode"></span>
  </article>`;
}

function renderDeals() {
  const grid = $('#dealGrid');
  if (!state.merchants.length) {
    grid.innerHTML = `
      <div class="empty">
        <h3>这一圈没翻到优惠</h3>
        <p>试着放宽距离、清掉筛选条件，或者换个品类看看。</p>
        <button class="paper-btn" data-reset-empty>清空筛选</button>
      </div>`;
    return;
  }
  grid.innerHTML = state.merchants.map((merchant, index) => merchantCard(merchant, index)).join('');
}

function renderSkeleton() {
  $('#dealGrid').innerHTML = Array.from({ length: 6 })
    .map(() => '<div class="skeleton"></div>')
    .join('');
}

/* ---------- 渲染：雷达与到期 ---------- */

function renderRadar() {
  const container = $('#radarDots');
  $('#radarRadius').textContent = `半径 ${(state.radius / 1000).toFixed(1)} km`;

  container.innerHTML = state.merchants
    .map((merchant) => {
      const ratio = Math.min(1, merchant.distanceM / Math.max(1, state.radius));
      const radiusPct = ratio * 42;
      const angle = (merchant.bearing * Math.PI) / 180;
      const x = 50 + radiusPct * Math.sin(angle);
      const y = 50 - radiusPct * Math.cos(angle);
      const soon = nearestDiscount(merchant);
      const label = `${merchant.name} · ${soon ? soon.title : merchant.category}`;
      return `<span class="radar-dot" data-merchant="${esc(merchant.id)}"
        style="left:${x.toFixed(2)}%;top:${y.toFixed(2)}%;--c:${catColor(merchant)}"
        title="${esc(label)}"></span>`;
    })
    .join('');
}

function renderExpiring() {
  const container = $('#expiringList');
  const entries = new Map();

  state.merchants.forEach((merchant) => {
    const discount = nearestDiscount(merchant);
    if (!discount) return;
    const current = entries.get(merchant.id);
    if (!current || Date.parse(discount.endsAt) < Date.parse(current.discount.endsAt)) {
      entries.set(merchant.id, { merchant, discount });
    }
  });

  const list = Array.from(entries.values())
    .sort((a, b) => Date.parse(a.discount.endsAt) - Date.parse(b.discount.endsAt))
    .slice(0, 6);

  if (!list.length) {
    container.innerHTML = '<p class="rail-note">附近暂时没有即将结束的优惠。</p>';
    return;
  }

  container.innerHTML = list
    .map(
      ({ merchant, discount }) => `
      <button class="expiring-item" data-merchant="${esc(merchant.id)}">
        <span class="exp-main">
          <span class="exp-name">${esc(merchant.name)}</span>
          <span class="exp-promo">${esc(discount.title)}</span>
        </span>
        <span class="exp-time" data-ends="${discount.endsAt}">${formatLeft(discount.endsAt)}</span>
      </button>`
    )
    .join('');
}

/* ---------- 渲染：收藏 / 提醒 ---------- */

function renderFavorites() {
  const pane = $('#favoritesPane');
  if (!state.favorites.length) {
    pane.innerHTML = `
      <div class="empty">
        <h3>还没有收藏</h3>
        <p>在优惠卡片右上角点一下爱心，想吃的店就留在这里。</p>
        <button class="paper-btn" data-switch-nearby>去逛逛附近优惠</button>
      </div>`;
    return;
  }

  pane.innerHTML = `
    <div class="pane-head"><h2>我的收藏</h2><span>${state.favorites.length} 家 · 优惠到期前回来看看</span></div>
    ${state.favorites
      .map(({ merchantId, snapshot }) => {
        const color = CAT_COLORS[snapshot.categoryKey] || CAT_COLORS.other;
        return `<div class="fav-row">
          <span class="tile" style="background:${color}">${esc(snapshot.categoryShort || snapshot.category.slice(0, 2))}</span>
          <div class="row-main">
            <h4>${esc(snapshot.name)}</h4>
            <p>${esc(snapshot.category)} · ${formatDistance(snapshot.distanceM)} · 最多省 ¥${snapshot.potentialSaving} · ${esc(snapshot.topDeal)}</p>
          </div>
          <div class="row-actions">
            <button class="paper-btn" data-viewmerchant="${esc(merchantId)}">看优惠</button>
            <button class="paper-btn danger" data-unfavrow="${esc(merchantId)}">移除</button>
          </div>
        </div>`;
      })
      .join('')}`;
}

function renderReminders() {
  const pane = $('#remindersPane');
  if (!state.reminders.length) {
    pane.innerHTML = `
      <div class="empty">
        <h3>还没有提醒</h3>
        <p>打开任意商家的优惠详情，点「结束前提醒我」，到点会在页面内提醒你。</p>
        <button class="paper-btn" data-switch-nearby>去找优惠</button>
      </div>`;
    return;
  }

  pane.innerHTML = `
    <div class="pane-head"><h2>我的提醒</h2><span>${state.reminders.length} 条 · 到点自动提醒</span></div>
    ${state.reminders
      .map(
        (reminder) => `
      <div class="rem-row">
        <span class="tile" style="background:var(--ember)">${esc((reminder.merchantName || '折').slice(0, 1))}</span>
        <div class="row-main">
          <h4>${esc(reminder.merchantName)}</h4>
          <p>${esc(reminder.promoTitle)}</p>
          <div class="rem-meta">
            <span>提醒 ${formatDateTime(reminder.remindAt)}</span>
            <span>优惠剩 <b data-ends="${new Date(reminder.endsAt).toISOString()}">${formatLeft(reminder.endsAt)}</b></span>
          </div>
        </div>
        <div class="row-actions">
          <button class="paper-btn" data-viewmerchant="${esc(reminder.merchantId)}">看优惠</button>
          <button class="paper-btn danger" data-unremind="${esc(reminder.id)}">取消</button>
        </div>
      </div>`
      )
      .join('')}`;
}

function handlePersonalClick(event) {
  const nearby = event.target.closest('[data-switch-nearby]');
  if (nearby) {
    setView('nearby');
    return;
  }

  const unremind = event.target.closest('[data-unremind]');
  if (unremind) {
    removeReminder(unremind.dataset.unremind);
    return;
  }

  const unfav = event.target.closest('[data-unfavrow]');
  if (unfav) {
    toggleFavorite(unfav.dataset.unfavrow);
    return;
  }

  const view = event.target.closest('[data-viewmerchant]');
  if (view) {
    openDetail(view.dataset.viewmerchant);
  }
}

/* ---------- 详情与凑单 ---------- */

async function openDetail(merchantId) {
  try {
    let merchant = state.byId.get(merchantId);
    if (!merchant) {
      const data = await api(
        `/api/merchants/${encodeURIComponent(merchantId)}?lat=${state.loc.lat}&lng=${state.loc.lng}`
      );
      merchant = data.merchant;
    }
    state.modal = { merchant, cart: new Set(), bundle: null, token: 0 };
    renderModal();
    document.body.classList.add('modal-open');
    fetchBundle();
  } catch (err) {
    toast(`打开失败：${esc(err.message)}`);
  }
}

function closeModal() {
  if (!state.modal) return;
  state.modal = null;
  $('#modalRoot').innerHTML = '';
  document.body.classList.remove('modal-open');
}

function renderModal() {
  const merchant = state.modal.merchant;
  const color = catColor(merchant);
  const sorted = merchant.discounts
    .slice()
    .sort(
      (a, b) =>
        PROMO_ORDER.indexOf(a.type) - PROMO_ORDER.indexOf(b.type)
    );

  const promoRows = sorted
    .map((discount) => {
      let note = '';
      if (discount.type === 'full_reduction') {
        const last = (discount.tiers || [])[(discount.tiers || []).length - 1];
        note = last ? `${discount.tiers.length} 档满减 · 最高减 ¥${last.amount}` : '';
      } else if (discount.type === 'new_user') {
        note = '仅限本店首单';
      } else if (discount.type === 'voucher') {
        note = `最高抵扣 ¥${discount.maxAmount}`;
      } else if (discount.type === 'flash_sale') {
        note = `原价 ¥${discount.original} · 限量`;
      }
      return `<li class="promo-item">
        <span class="promo-type">${PROMO_LABEL[discount.type] || '优惠'}</span>
        <div class="promo-body">
          <p class="promo-title">${esc(discount.title)}</p>
          ${note ? `<p class="promo-note">${esc(note)}</p>` : ''}
        </div>
        <span class="promo-left" data-ends="${discount.endsAt}">${formatLeft(discount.endsAt)}</span>
      </li>`;
    })
    .join('');

  $('#modalRoot').innerHTML = `
    <div class="modal-backdrop">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
        <button class="modal-close" data-close aria-label="关闭">${icon('close')}</button>
        <div class="modal-left">
          <span class="modal-cat-strip" style="background:${color}"></span>
          <span class="modal-kicker">DEAL TICKET · ${esc(merchant.category)}</span>
          <h2 id="modalTitle">${esc(merchant.name)}</h2>
          <p class="modal-sub">${esc(merchant.address)}</p>
          <div class="modal-facts">
            <span>评分 <b>${merchant.rating}</b></span>
            <span>月售 <b>${merchant.monthlySales}</b></span>
            <span>距离 <b>${formatDistance(merchant.distanceM)}</b></span>
            <span>配送 <b>${merchant.deliveryFee === 0 ? '免配送费' : `¥${merchant.deliveryFee}`}</b></span>
          </div>
          <div class="modal-section-title">本店可用优惠 <span>${merchant.discounts.length} 项</span></div>
          <ul class="promo-list">${promoRows}</ul>
        </div>
        <div class="modal-right">
          <div id="calcShell"></div>
        </div>
      </div>
    </div>`;

  renderCalcShell();
}

function renderCalcShell() {
  const shell = $('#calcShell');
  if (!shell || !state.modal) return;
  const merchant = state.modal.merchant;

  const dishRows = merchant.dishes
    .map((dish) => {
      const onSale = typeof dish.salePrice === 'number';
      const checked = state.modal.cart.has(dish.id) ? 'checked' : '';
      const price = onSale
        ? `<s>¥${formatMoney(dish.price)}</s><b>¥${formatMoney(dish.salePrice)}</b>`
        : `¥${formatMoney(dish.price)}`;
      return `<li>
        <label class="dish-row">
          <input type="checkbox" data-dish="${esc(dish.id)}" ${checked} />
          <span class="dish-name">${esc(dish.name)}${onSale ? '<em>秒杀</em>' : ''}</span>
          <span class="dish-price">${price}</span>
        </label>
      </li>`;
    })
    .join('');

  shell.innerHTML = `
    <div class="calc-head">
      <h3>凑单计算器</h3>
      <span>AUTO BUNDLE</span>
    </div>
    <p class="calc-tip">勾选想吃的菜，自动计算满减、用券和最优凑单方案。</p>
    <ul class="dish-list">${dishRows}</ul>
    <div id="calcResult"></div>`;

  renderCalcResult(state.modal.bundle);
}

function renderCalcResult(bundle, error) {
  const target = $('#calcResult');
  if (!target || !state.modal) return;
  const merchant = state.modal.merchant;

  if (error) {
    target.innerHTML = `<div class="calc-empty">凑单计算失败：${esc(error)}</div>`;
    return;
  }

  if (!bundle) {
    target.innerHTML = '<div class="calc-empty">正在计算最优凑单…</div>';
    return;
  }

  const fee = merchant.deliveryFee;
  const pay = Math.max(0, bundle.total - bundle.bill.total) + fee;

  const billRows = [
    ['商品小计', `¥${formatMoney(bundle.total)}`, ''],
    bundle.bill.fullReduction > 0
      ? ['满减优惠', `-¥${formatMoney(bundle.bill.fullReduction)}`, 'discount']
      : null,
    bundle.bill.newUser > 0
      ? ['新客立减', `-¥${formatMoney(bundle.bill.newUser)}`, 'discount']
      : null,
    bundle.bill.voucher > 0
      ? ['折扣券', `-¥${formatMoney(bundle.bill.voucher)}`, 'discount']
      : null,
    ['配送费', fee > 0 ? `+¥${formatMoney(fee)}` : '免配送费', '']
  ].filter(Boolean);

  let progress = '';
  if (bundle.nextTier) {
    const currentThreshold = bundle.currentTier ? bundle.currentTier.threshold : 0;
    const span = Math.max(1, bundle.nextTier.threshold - currentThreshold);
    const percent = Math.min(100, Math.max(4, ((bundle.total - currentThreshold) / span) * 100));
    progress = `<div class="progress-wrap">
      <div class="progress-text">
        <span>再凑 <b>¥${formatMoney(bundle.gap)}</b> 可享满 ${bundle.nextTier.threshold} 减 ${bundle.nextTier.amount}</span>
        <span>${Math.round(percent)}%</span>
      </div>
      <div class="progress-track"><div class="progress-fill" style="width:${percent}%"></div></div>
    </div>`;
  } else if (bundle.tiers.length) {
    progress = `<div class="progress-wrap">
      <div class="progress-text"><span>已享最高档满减，不用再凑了</span><span>100%</span></div>
      <div class="progress-track"><div class="progress-fill" style="width:100%"></div></div>
    </div>`;
  }

  const suggestions = bundle.suggestions.length
    ? `<div class="suggestions">${bundle.suggestions
        .map((item) => {
          const names = item.items.map((dish) => dish.name).join(' + ');
          return `<div class="suggest-card">
            <p>加购 ${esc(names)} <span>+¥${formatMoney(item.addCost)} · 享满 ${item.tier.threshold} 减 ${item.tier.amount} · 多省 ¥${formatMoney(item.gain)}</span></p>
            <button class="add-btn" data-add="${item.items.map((dish) => esc(dish.id)).join(',')}">+ 加购</button>
          </div>`;
        })
        .join('')}</div>`
    : '';

  const soon = nearestDiscount(merchant);
  const isFav = state.favIds.has(merchant.id);

  const actions = `<div class="calc-actions">
    <button class="solid-btn ${isFav ? 'is-fav' : ''}" data-fav-modal>
      ${icon('heart')} ${isFav ? '已收藏' : '收藏商家'}
    </button>
    ${soon ? `<button class="ghost-paper" data-remind="30">结束前 30 分钟提醒</button>
      <button class="ghost-paper" data-remind="60">结束前 1 小时提醒</button>` : ''}
  </div>`;

  target.innerHTML = `
    <div class="bill">
      ${billRows
        .map(
          ([label, value, cls]) =>
            `<div class="bill-row ${cls}"><span>${label}</span><b>${value}</b></div>`
        )
        .join('')}
      <div class="bill-row total"><span>预计实付</span><b>¥${formatMoney(pay)}</b></div>
    </div>
    ${progress}
    ${suggestions}
    ${actions}`;
}

function syncDishCheckboxes() {
  if (!state.modal) return;
  $$('#calcShell input[data-dish]').forEach((input) => {
    input.checked = state.modal.cart.has(input.dataset.dish);
  });
}

async function fetchBundle() {
  if (!state.modal) return;
  const token = ++state.modal.token;
  const merchantId = state.modal.merchant.id;
  const itemIds = Array.from(state.modal.cart);

  try {
    const bundle = await api('/api/bundle', {
      method: 'POST',
      body: { merchantId, itemIds }
    });
    if (!state.modal || state.modal.token !== token) return;
    state.modal.bundle = bundle;
    renderCalcResult(bundle);
  } catch (err) {
    if (state.modal && state.modal.token === token) {
      renderCalcResult(null, err.message);
    }
  }
}

/* ---------- 收藏 / 提醒操作 ---------- */

async function toggleFavorite(merchantId) {
  if (!merchantId) return;
  const isFav = state.favIds.has(merchantId);
  try {
    if (isFav) {
      await api(
        `/api/favorites?clientId=${encodeURIComponent(state.clientId)}&merchantId=${encodeURIComponent(merchantId)}`,
        { method: 'DELETE' }
      );
      toast('已取消收藏');
    } else {
      await api('/api/favorites', {
        method: 'POST',
        body: { clientId: state.clientId, merchantId }
      });
      toast('已收藏 · 优惠结束前记得回来看', 'is-ok');
    }
    await loadFavorites(true);
    if (state.modal && state.modal.merchant.id === merchantId) {
      renderCalcResult(state.modal.bundle);
    }
  } catch (err) {
    toast(`操作失败：${esc(err.message)}`);
  }
}

function syncFavButtons() {
  $$('[data-fav]').forEach((button) => {
    button.classList.toggle('on', state.favIds.has(button.dataset.fav));
  });
}

async function createReminder(offsetMinutes) {
  if (!state.modal) return;
  const merchant = state.modal.merchant;
  const soon = nearestDiscount(merchant);
  if (!soon) {
    toast('该店暂无进行中的优惠');
    return;
  }

  try {
    await api('/api/reminders', {
      method: 'POST',
      body: {
        clientId: state.clientId,
        merchantId: merchant.id,
        promoId: soon.id,
        offsetMinutes
      }
    });
    toast(
      `已设置提醒：<b>${esc(soon.title)}</b> 结束前 ${offsetMinutes} 分钟提醒你`,
      'is-ok'
    );
    loadReminders(true);
  } catch (err) {
    toast(`设置失败：${esc(err.message)}`);
  }
}

async function removeReminder(reminderId) {
  try {
    await api(
      `/api/reminders/${encodeURIComponent(reminderId)}?clientId=${encodeURIComponent(state.clientId)}`,
      { method: 'DELETE' }
    );
    toast('已取消该提醒');
    loadReminders(true);
  } catch (err) {
    toast(`取消失败：${esc(err.message)}`);
  }
}

async function pollDueReminders() {
  try {
    const data = await api(
      `/api/reminders/due?clientId=${encodeURIComponent(state.clientId)}`
    );
    (data.items || []).forEach((item) => {
      toast(`优惠快结束了：<b>${esc(item.merchantName)}</b>「${esc(item.promoTitle)}」`, 'is-ok');
      if ('Notification' in window && Notification.permission === 'granted') {
        try {
          new Notification('巷口折 · 优惠提醒', {
            body: `${item.merchantName}「${item.promoTitle}」即将结束`,
            tag: item.id
          });
        } catch {
          /* 忽略通知异常 */
        }
      }
    });
    if ((data.items || []).length) loadReminders(false);
  } catch {
    /* 静默 */
  }
}

async function enableNotifications() {
  if (!('Notification' in window)) {
    toast('当前浏览器不支持系统通知，页面内提醒仍然有效');
    return;
  }
  if (Notification.permission === 'granted') {
    toast('浏览器提醒已开启', 'is-ok');
    return;
  }
  try {
    const permission = await Notification.requestPermission();
    updateNotifyButton();
    toast(
      permission === 'granted'
        ? '浏览器提醒已开启'
        : '未获得通知权限，将只在页面内提醒'
    );
  } catch {
    toast('提醒权限请求失败');
  }
}

function updateNotifyButton() {
  const button = $('#notifyBtn');
  const granted = 'Notification' in window && Notification.permission === 'granted';
  button.classList.toggle('is-on', granted);
  const label = button.querySelector('span');
  if (label) label.textContent = granted ? '提醒已开启' : '开启提醒';
}

/* ---------- 位置 / 视图 / 筛选 ---------- */

function changeLocation(lat, lng, label) {
  state.loc = { lat, lng, label };
  $('#locLabel').textContent = label;
  $('#locMenu').hidden = true;
  $('#locBtn').setAttribute('aria-expanded', 'false');
  loadDeals();
  toast(`已切换到 ${esc(label)}`);
}

function useGeolocation() {
  if (!navigator.geolocation) {
    toast('当前浏览器不支持定位，请从城市列表中选择');
    return;
  }
  toast('正在获取你的位置…');
  navigator.geolocation.getCurrentPosition(
    (position) => {
      changeLocation(
        position.coords.latitude,
        position.coords.longitude,
        '我的位置'
      );
    },
    () => {
      toast('定位失败或未授权，已保留当前城市');
    },
    { timeout: 9000, maximumAge: 60000 }
  );
}

function setView(view) {
  state.view = view;
  $$('.view-tab').forEach((tab) => {
    const active = tab.dataset.view === view;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
  });

  $('#nearbyPane').hidden = view !== 'nearby';
  $('#sortRow').hidden = view !== 'nearby';
  $('#favoritesPane').hidden = view !== 'favorites';
  $('#remindersPane').hidden = view !== 'reminders';
  closeFilters();

  if (view === 'favorites') renderFavorites();
  if (view === 'reminders') renderReminders();
}

function resetFilters() {
  state.category = 'all';
  state.q = '';
  state.types = new Set();
  state.maxFee = '';
  state.minSaving = 0;
  state.radius = 3000;

  $('#searchInput').value = '';
  $('#radiusRange').value = '3000';
  $('#radiusValue').textContent = '3.0 km';
  $('#radarRadius').textContent = '半径 3.0 km';
  $('#savingRange').value = '0';
  $('#savingValue').textContent = '¥0';
  $('#feeSelect').value = '';
  $$('#typeGrid input').forEach((input) => {
    input.checked = false;
  });
  $$('#catGrid .cat-chip').forEach((chip) => {
    chip.classList.toggle('is-active', chip.dataset.cat === 'all');
  });

  loadDeals();
}

function tickCountdowns() {
  $$('[data-ends]').forEach((el) => {
    el.textContent = formatLeft(el.dataset.ends);
  });
}

init();
