'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const { loadDeals } = require('./lib/providers');
const { getMerchantById, CATEGORIES } = require('./lib/providers/mock');
const merchantCache = require('./lib/cache');
const { filterDeals, sortDeals, buildStats } = require('./lib/query');
const { analyzeBundle } = require('./lib/bundle');
const store = require('./lib/store');

const PORT = Number(process.env.PORT) || 4173;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');

const DEFAULT_CENTER = { lat: 31.2304, lng: 121.4737 };

const CITIES = [
  { name: '上海 · 人民广场', lat: 31.2304, lng: 121.4737 },
  { name: '北京 · 国贸', lat: 39.9087, lng: 116.461 },
  { name: '广州 · 天河', lat: 23.1291, lng: 113.3245 },
  { name: '深圳 · 南山', lat: 22.5333, lng: 113.93 },
  { name: '成都 · 春熙路', lat: 30.657, lng: 104.08 },
  { name: '杭州 · 西湖', lat: 30.247, lng: 120.15 }
];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function sendText(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      data += chunk;
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error('请求体不是合法 JSON'));
      }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res, pathname) {
  let relative = pathname === '/' ? '/index.html' : pathname;
  try {
    relative = decodeURIComponent(relative);
  } catch {
    return sendText(res, 400, 'Bad path');
  }

  const filePath = path.normalize(path.join(PUBLIC_DIR, relative));
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) {
    return sendText(res, 403, 'Forbidden');
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      return sendText(res, 404, 'Not found');
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': 'no-cache'
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

function numberParam(params, key, fallback) {
  const raw = params.get(key);
  const n = Number(raw);
  return raw !== null && Number.isFinite(n) ? n : fallback;
}

function resolveMerchant(id) {
  return merchantCache.get(id) || getMerchantById(id);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  try {
    if (pathname === '/api/config' && req.method === 'GET') {
      return sendJson(res, 200, {
        dataSource: (process.env.DATA_SOURCE || 'auto').toLowerCase(),
        hasRemote: Boolean(process.env.DEALS_API_URL),
        sourceLabel: process.env.DEALS_API_URL ? '真实接口 + 演示兜底' : '内置演示数据',
        cities: CITIES,
        categories: CATEGORIES.map((c) => ({ key: c.key, name: c.name })),
        serverTime: Date.now()
      });
    }

    if (pathname === '/api/deals' && req.method === 'GET') {
      const lat = numberParam(url.searchParams, 'lat', DEFAULT_CENTER.lat);
      const lng = numberParam(url.searchParams, 'lng', DEFAULT_CENTER.lng);
      const radius = Math.min(
        10000,
        Math.max(200, numberParam(url.searchParams, 'radius', 3000))
      );

      const loaded = await loadDeals({ lat, lng, radius });
      const filtered = filterDeals(loaded.merchants, {
        radius,
        category: url.searchParams.get('category') || 'all',
        q: url.searchParams.get('q') || '',
        maxDeliveryFee: url.searchParams.get('maxDeliveryFee') || '',
        minSaving: numberParam(url.searchParams, 'minSaving', 0),
        types: url.searchParams.get('types') || ''
      });

      const sort = url.searchParams.get('sort') || 'smart';
      const merchants = sortDeals(filtered, sort, radius);

      return sendJson(res, 200, {
        source: loaded.source,
        fallbackReason: loaded.fallbackReason,
        generatedAt: Date.now(),
        center: { lat, lng },
        radius,
        sort,
        total: merchants.length,
        stats: buildStats(merchants),
        merchants
      });
    }

    const merchantMatch = /^\/api\/merchants\/([^/]+)$/.exec(pathname);
    if (merchantMatch && req.method === 'GET') {
      const merchant = resolveMerchant(merchantMatch[1]);
      if (!merchant) return sendJson(res, 404, { error: '商家不存在或已下线' });

      const lat = numberParam(url.searchParams, 'lat', NaN);
      const lng = numberParam(url.searchParams, 'lng', NaN);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        const { haversine, bearing } = require('./lib/geo');
        merchant.distanceM = Math.round(haversine(lat, lng, merchant.lat, merchant.lng));
        merchant.bearing = Math.round(bearing(lat, lng, merchant.lat, merchant.lng) * 10) / 10;
      }
      return sendJson(res, 200, { merchant });
    }

    if (pathname === '/api/bundle' && req.method === 'POST') {
      const body = await readBody(req);
      const merchant = resolveMerchant(body.merchantId);
      if (!merchant) return sendJson(res, 404, { error: '商家不存在或已下线' });
      const itemIds = Array.isArray(body.itemIds) ? body.itemIds.map(String) : [];
      return sendJson(res, 200, analyzeBundle(merchant, itemIds));
    }

    if (pathname === '/api/favorites') {
      const clientId = url.searchParams.get('clientId');
      if (req.method === 'GET') {
        if (!clientId) return sendJson(res, 400, { error: '缺少 clientId' });
        return sendJson(res, 200, { items: store.listFavorites(clientId) });
      }
      if (req.method === 'POST') {
        const body = await readBody(req);
        if (!body.clientId || !body.merchantId) {
          return sendJson(res, 400, { error: '缺少 clientId 或 merchantId' });
        }
        const merchant = resolveMerchant(body.merchantId);
        if (!merchant) return sendJson(res, 404, { error: '商家不存在或已下线' });
        const item = store.addFavorite(body.clientId, merchant);
        return sendJson(res, 200, { item });
      }
      if (req.method === 'DELETE') {
        if (!clientId) return sendJson(res, 400, { error: '缺少 clientId' });
        const merchantId = url.searchParams.get('merchantId');
        if (!merchantId) return sendJson(res, 400, { error: '缺少 merchantId' });
        const removed = store.removeFavorite(clientId, merchantId);
        return sendJson(res, 200, { removed });
      }
    }

    if (pathname === '/api/reminders' && req.method === 'GET') {
      const clientId = url.searchParams.get('clientId');
      if (!clientId) return sendJson(res, 400, { error: '缺少 clientId' });
      return sendJson(res, 200, { items: store.listReminders(clientId) });
    }

    if (pathname === '/api/reminders' && req.method === 'POST') {
      const body = await readBody(req);
      if (!body.clientId || !body.merchantId) {
        return sendJson(res, 400, { error: '缺少 clientId 或 merchantId' });
      }
      const merchant = resolveMerchant(body.merchantId);
      if (!merchant) return sendJson(res, 404, { error: '商家不存在或已下线' });

      const now = Date.now();
      const upcoming = merchant.discounts
        .filter((d) => Date.parse(d.endsAt) > now)
        .sort((a, b) => Date.parse(a.endsAt) - Date.parse(b.endsAt));

      const discount = body.promoId
        ? merchant.discounts.find((d) => d.id === body.promoId)
        : upcoming[0];

      if (!discount) return sendJson(res, 400, { error: '该商家暂无进行中的优惠' });

      const reminder = store.addReminder({
        clientId: body.clientId,
        merchant,
        discount,
        offsetMinutes: body.offsetMinutes
      });
      return sendJson(res, 200, { item: reminder });
    }

    const reminderMatch = /^\/api\/reminders\/([^/]+)$/.exec(pathname);
    if (reminderMatch && req.method === 'DELETE') {
      const clientId = url.searchParams.get('clientId');
      if (!clientId) return sendJson(res, 400, { error: '缺少 clientId' });
      const removed = store.removeReminder(clientId, reminderMatch[1]);
      return sendJson(res, 200, { removed });
    }

    if (pathname === '/api/reminders/due' && req.method === 'GET') {
      const clientId = url.searchParams.get('clientId');
      if (!clientId) return sendJson(res, 400, { error: '缺少 clientId' });
      return sendJson(res, 200, { items: store.dueReminders(clientId) });
    }

    if (pathname.startsWith('/api/')) {
      return sendJson(res, 404, { error: '接口不存在' });
    }

    return serveStatic(req, res, pathname);
  } catch (err) {
    console.error('[api]', err);
    return sendJson(res, 500, { error: err.message || '服务器内部错误' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[巷口折] 服务已启动: http://localhost:${PORT}`);
  console.log(`[巷口折] 数据源: ${process.env.DATA_SOURCE || 'auto'}${process.env.DEALS_API_URL ? ' / ' + process.env.DEALS_API_URL : ' / 内置演示数据'}`);
});
