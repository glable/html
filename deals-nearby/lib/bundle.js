'use strict';

function effectivePrice(dish) {
  return typeof dish.salePrice === 'number' ? dish.salePrice : dish.price;
}

function tierFor(tiers, total) {
  return tiers
    .slice()
    .sort((a, b) => a.threshold - b.threshold)
    .reverse()
    .find((t) => t.threshold <= total) || null;
}

function nextTierFor(tiers, total) {
  return tiers
    .slice()
    .sort((a, b) => a.threshold - b.threshold)
    .find((t) => t.threshold > total) || null;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function analyzeBundle(merchant, itemIds = []) {
  const selectedIds = new Set(itemIds);
  const dishes = merchant.dishes.map((d) => ({
    id: d.id,
    name: d.name,
    price: d.price,
    salePrice: typeof d.salePrice === 'number' ? d.salePrice : null,
    effective: effectivePrice(d)
  }));

  const selected = dishes.filter((d) => selectedIds.has(d.id));
  const total = round2(selected.reduce((sum, d) => sum + d.effective, 0));

  const fullReduction = merchant.discounts.find((d) => d.type === 'full_reduction');
  const tiers = (fullReduction?.tiers || []).slice().sort((a, b) => a.threshold - b.threshold);
  const newUser = merchant.discounts.find((d) => d.type === 'new_user');
  const voucher = merchant.discounts.find((d) => d.type === 'voucher');

  function calcBill(value) {
    if (value <= 0) {
      return { fullReduction: 0, newUser: 0, voucher: 0, total: 0 };
    }
    const tier = tierFor(tiers, value);
    const newUserAmount = newUser && value >= 15 ? newUser.amount : 0;
    const voucherAmount = voucher
      ? Math.min(value * voucher.rate, voucher.maxAmount)
      : 0;
    const discount = Math.min(
      value,
      (tier?.amount || 0) + newUserAmount + voucherAmount
    );
    return {
      fullReduction: tier ? tier.amount : 0,
      newUser: round2(newUserAmount),
      voucher: round2(voucherAmount),
      total: round2(discount)
    };
  }

  const currentTier = tierFor(tiers, total);
  const nextTier = nextTierFor(tiers, total);
  const bill = calcBill(total);
  const pay = round2(total - bill.total);

  const suggestions = [];
  if (nextTier) {
    const available = dishes.filter((d) => !selectedIds.has(d.id));
    const combos = [];

    for (let a = 0; a < available.length; a++) {
      combos.push([available[a]]);
      for (let b = a + 1; b < available.length; b++) {
        combos.push([available[a], available[b]]);
        for (let c = b + 1; c < available.length; c++) {
          combos.push([available[a], available[b], available[c]]);
        }
      }
    }

    for (const combo of combos) {
      const addCost = round2(combo.reduce((sum, d) => sum + d.effective, 0));
      if (addCost <= 0 || addCost > 80) continue;
      const newTotal = round2(total + addCost);
      const tier = tierFor(tiers, newTotal);
      if (!tier || tier.threshold < nextTier.threshold) continue;
      const previousAmount = currentTier ? currentTier.amount : 0;
      const gain = round2(tier.amount - previousAmount);
      if (gain <= 0) continue;
      const nextBill = calcBill(newTotal);
      suggestions.push({
        items: combo.map((d) => ({ id: d.id, name: d.name, price: d.effective })),
        addCost,
        newTotal,
        tier,
        discount: nextBill,
        pay: round2(newTotal - nextBill.total),
        gain
      });
    }

    suggestions.sort((a, b) => {
      if (a.addCost !== b.addCost) return a.addCost - b.addCost;
      return b.gain - a.gain;
    });
  }

  const seen = new Set();
  const picked = [];
  for (const item of suggestions) {
    const key = item.items.map((d) => d.id).sort().join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(item);
    if (picked.length >= 4) break;
  }

  return {
    merchantId: merchant.id,
    dishes,
    selectedIds: selected.map((d) => d.id),
    total,
    tiers,
    currentTier,
    nextTier,
    gap: nextTier ? round2(nextTier.threshold - total) : 0,
    bill,
    pay,
    suggestions: picked
  };
}

module.exports = { analyzeBundle };
