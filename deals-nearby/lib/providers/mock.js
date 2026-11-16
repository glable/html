'use strict';

const { hashString, mulberry32, pick } = require('../random');
const { offsetPoint, haversine, bearing } = require('../geo');

const CATEGORIES = [
  {
    key: 'fastfood',
    name: '快餐简餐',
    short: '快餐',
    suffixes: ['快餐', '小碗菜', '食堂', '盖码饭'],
    dishes: ['招牌卤肉饭', '香煎鸡腿饭', '番茄牛腩饭', '照烧鸡排饭', '梅菜扣肉饭', '每日例汤']
  },
  {
    key: 'milktea',
    name: '奶茶咖啡',
    short: '茶咖',
    suffixes: ['茶事', '咖啡', '奶铺', '茶铺'],
    dishes: ['生椰拿铁', '芋泥波波奶茶', '茉莉奶绿', '焦糖玛奇朵', '手打柠檬茶', '美式咖啡']
  },
  {
    key: 'bbq',
    name: '烧烤夜宵',
    short: '烧烤',
    suffixes: ['烧烤', '夜宵铺', '烤场', '小酒馆'],
    dishes: ['羊肉串 10 串', '烤鸡翅', '蒜香烤茄子', '爆炒花甲', '冰镇毛豆', '烤韭菜']
  },
  {
    key: 'hotpot',
    name: '火锅冒菜',
    short: '火锅',
    suffixes: ['冒菜', '火锅', '烫捞', '市井火锅'],
    dishes: ['麻辣烫小份', '肥牛卷', '手打虾滑', '宽粉', '冒毛肚', '油豆皮']
  },
  {
    key: 'japanese',
    name: '日料寿司',
    short: '日料',
    suffixes: ['寿司', '食堂', '居酒屋', '料理'],
    dishes: ['三文鱼寿司', '炙烤鳗鱼饭', '味噌汤', '天妇罗拼盘', '蟹柳沙拉', '厚蛋烧']
  },
  {
    key: 'noodle',
    name: '面馆米粉',
    short: '面馆',
    suffixes: ['面馆', '米粉铺', '小面', '手工面'],
    dishes: ['红烧牛肉面', '酸辣粉', '葱油拌面', '番茄鸡蛋面', '螺蛳粉', '炸酱面']
  },
  {
    key: 'burger',
    name: '炸鸡汉堡',
    short: '炸鸡',
    suffixes: ['炸鸡', '汉堡', '炸物社', '鸡排店'],
    dishes: ['香辣鸡腿堡', '吮指鸡块', '黄金薯条', '冰可乐', '鸡肉卷', '奥尔良烤翅']
  },
  {
    key: 'salad',
    name: '轻食沙拉',
    short: '轻食',
    suffixes: ['轻食', '沙拉所', '能量碗', '健康餐'],
    dishes: ['鸡胸肉沙拉', '牛油果碗', '全麦三明治', '低脂酸奶', '藜麦饭', '烤南瓜']
  },
  {
    key: 'dessert',
    name: '甜品烘焙',
    short: '甜品',
    suffixes: ['甜品', '烘焙', '糖水铺', '蛋糕房'],
    dishes: ['提拉米苏', '黄油可颂', '巴斯克蛋糕', '奶油泡芙', '葡式蛋挞', '杨枝甘露']
  },
  {
    key: 'malatang',
    name: '麻辣烫',
    short: '麻辣烫',
    suffixes: ['麻辣烫', '烫捞', '冒菜', '辣卤'],
    dishes: ['麻辣烫自选', '肥牛片', '脆藕片', '方便面', '鹌鹑蛋', '千叶豆腐']
  }
];

const PREFIXES = [
  '巷口', '老张', '阿嬷', '深夜', '三味', '小满', '山野', '锅气',
  '拾光', '无名', '半里', '楼下', '南门', '七分', '一口', '阿匠'
];

const STREETS = ['中山路', '人民路', '解放路', '建设路', '和平街', '长安街', '南京路', '文化路', '望春街', '槐树巷'];

const TIER_SETS = [
  [{ threshold: 20, amount: 4 }, { threshold: 35, amount: 8 }, { threshold: 55, amount: 14 }],
  [{ threshold: 25, amount: 5 }, { threshold: 40, amount: 10 }, { threshold: 65, amount: 18 }],
  [{ threshold: 18, amount: 3 }, { threshold: 30, amount: 7 }, { threshold: 50, amount: 13 }],
  [{ threshold: 30, amount: 6 }, { threshold: 50, amount: 12 }],
  [{ threshold: 22, amount: 5 }, { threshold: 38, amount: 9 }, { threshold: 60, amount: 16 }]
];

const PRICE_POOL = [9, 12, 14, 16, 18, 22, 26, 28, 32, 36, 38];

function iso(ms) {
  return new Date(ms).toISOString();
}

function buildName(rng, category, index, used) {
  const prefix = pick(rng, PREFIXES);
  const suffix = pick(rng, category.suffixes);
  let name = `${prefix}${suffix}`;
  if (used.has(name)) {
    name = `${name} · ${['二店', '三店', '巷子店'][index % 3]}`;
  }
  used.add(name);
  return name;
}

function buildDiscounts(rng, dishes, minOrder, baseNow) {
  const discounts = [];
  const minute = 60000;

  const tiers = pick(rng, TIER_SETS).map((t) => ({ ...t }));
  discounts.push({
    id: 'fr',
    type: 'full_reduction',
    title: tiers.map((t) => `满${t.threshold}减${t.amount}`).join(' / '),
    tiers,
    endsAt: iso(baseNow + pick(rng, [180, 360, 720, 1440, 2880]) * minute)
  });

  if (rng() < 0.62) {
    const amount = pick(rng, [4, 5, 6, 8, 10]);
    discounts.push({
      id: 'nu',
      type: 'new_user',
      title: `新客立减 ${amount} 元`,
      amount,
      endsAt: iso(baseNow + pick(rng, [90, 180, 480, 720]) * minute)
    });
  }

  if (rng() < 0.36) {
    const rate = pick(rng, [0.1, 0.12, 0.15]);
    const maxAmount = pick(rng, [8, 10, 15]);
    const zhe = +(10 - rate * 10).toFixed(1);
    discounts.push({
      id: 'vc',
      type: 'voucher',
      title: `${zhe} 折券 · 最高减 ¥${maxAmount}`,
      rate,
      maxAmount,
      endsAt: iso(baseNow + pick(rng, [90, 180, 480, 900]) * minute)
    });
  }

  if (rng() < 0.42) {
    const dish = dishes[Math.floor(rng() * dishes.length)];
    const salePrice = Math.max(3, Math.round(dish.price * (0.4 + rng() * 0.25) * 10) / 10);
    dish.salePrice = salePrice;
    discounts.push({
      id: 'fs',
      type: 'flash_sale',
      title: `秒杀 · ${dish.name} ¥${salePrice}`,
      dishId: dish.id,
      price: salePrice,
      original: dish.price,
      endsAt: iso(baseNow + pick(rng, [40, 70, 110, 200]) * minute)
    });
  }

  // 让满减门槛与起送价更匹配
  for (const d of discounts) {
    if (d.type === 'full_reduction' && d.tiers[0].threshold < minOrder) {
      d.tiers[0].threshold = minOrder + 2;
      d.title = d.tiers.map((t) => `满${t.threshold}减${t.amount}`).join(' / ');
    }
  }

  return discounts;
}

function computePotentialSaving(merchant) {
  const baseTotal = merchant.minOrder + 10;
  const fr = merchant.discounts.find((d) => d.type === 'full_reduction');
  const nu = merchant.discounts.find((d) => d.type === 'new_user');
  const vc = merchant.discounts.find((d) => d.type === 'voucher');
  const fs = merchant.discounts.find((d) => d.type === 'flash_sale');

  const tier = (fr?.tiers || [])
    .slice()
    .sort((a, b) => a.threshold - b.threshold)
    .reverse()
    .find((t) => t.threshold <= baseTotal);

  const voucherSaving = vc ? Math.min(baseTotal * vc.rate, vc.maxAmount) : 0;
  const flashSaving = fs ? Math.max(0, fs.original - fs.price) : 0;
  const saving =
    (tier?.amount || 0) + (nu?.amount || 0) + voucherSaving + flashSaving;

  merchant.potentialSaving = Math.round(saving);
  merchant.savingRate = Math.round(
    (saving / Math.max(1, baseTotal + merchant.deliveryFee)) * 100
  );
  return merchant;
}

function generateMerchants(lat, lng, now = Date.now()) {
  const lat100 = Math.round(lat * 100);
  const lng100 = Math.round(lng * 100);
  const gridLat = lat100 / 100;
  const gridLng = lng100 / 100;
  const baseNow = Math.floor(now / 900000) * 900000;
  const used = new Set();
  const list = [];

  for (let i = 0; i < 26; i++) {
    const rng = mulberry32(hashString(`${lat100}:${lng100}:${i}`));
    const category = CATEGORIES[i % CATEGORIES.length];
    const name = buildName(rng, category, i, used);

    const distance = Math.round(140 + Math.sqrt(rng()) * 2860);
    const brg = rng() * 360;
    const point = offsetPoint(gridLat, gridLng, distance, brg);
    const actualDistance = Math.round(haversine(lat, lng, point.lat, point.lng));
    const actualBearing = Math.round(bearing(lat, lng, point.lat, point.lng) * 10) / 10;

    const deliveryFee = pick(rng, [0, 0, 1, 2, 3, 4, 5]);
    const minOrder = pick(rng, [15, 18, 20, 22, 25, 28, 30]);

    const dishCount = 5 + Math.floor(rng() * 2);
    const dishes = [];
    const usedDishes = new Set();
    for (let d = 0; d < dishCount; d++) {
      let dishName = pick(rng, category.dishes);
      let guard = 0;
      while (usedDishes.has(dishName) && guard < 12) {
        dishName = pick(rng, category.dishes);
        guard++;
      }
      usedDishes.add(dishName);
      dishes.push({
        id: `d${d}`,
        name: dishName,
        price: pick(rng, PRICE_POOL)
      });
    }

    const discounts = buildDiscounts(rng, dishes, minOrder, baseNow);

    const merchant = {
      id: `mk_${lat100.toString(36)}_${lng100.toString(36)}_${i}`,
      name,
      category: category.name,
      categoryKey: category.key,
      categoryShort: category.short,
      rating: +(3.9 + rng() * 1.0).toFixed(1),
      monthlySales: 180 + Math.floor(rng() * 8800),
      distanceM: actualDistance,
      bearing: actualBearing,
      lat: +point.lat.toFixed(6),
      lng: +point.lng.toFixed(6),
      deliveryFee,
      minOrder,
      deliveryTimeMin: 15 + Math.floor(rng() * 35),
      address: `${pick(rng, STREETS)} ${100 + Math.floor(rng() * 800)} 号`,
      tags: [],
      dishes,
      discounts,
      source: 'mock'
    };

    if (deliveryFee === 0) merchant.tags.push('免配送费');
    if (rng() > 0.68) merchant.tags.push('品牌店');
    if (rng() > 0.78) merchant.tags.push('准时宝');

    list.push(computePotentialSaving(merchant));
  }

  return list;
}

function getMerchantById(id) {
  const match = /^mk_(-?[0-9a-z]+)_(-?[0-9a-z]+)_(\d+)$/.exec(String(id || ''));
  if (!match) return null;
  const lat100 = parseInt(match[1], 36);
  const lng100 = parseInt(match[2], 36);
  const index = Number(match[3]);
  if (!Number.isFinite(lat100) || !Number.isFinite(lng100) || !Number.isFinite(index)) {
    return null;
  }
  const list = generateMerchants(lat100 / 100, lng100 / 100);
  return list.find((m) => m.id === id) || null;
}

module.exports = { generateMerchants, getMerchantById, CATEGORIES };
