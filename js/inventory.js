// ============ 背包系统 ============
'use strict';

class Inventory {
  constructor() {
    this.hotbar = new Array(9).fill(null);
    this.bag = new Array(27).fill(null);
    this.sel = 0;
  }

  held() { return this.hotbar[this.sel]; }

  maxStack(id) {
    if (id < 100) return 99;
    return ITEMS[id].stack || 99;
  }

  count(id) {
    let n = 0;
    for (const s of this.hotbar) if (s && s.id === id) n += s.n;
    for (const s of this.bag) if (s && s.id === id) n += s.n;
    return n;
  }

  take(id, n) {
    const slots = this.hotbar.concat(this.bag);
    for (let i = 0; i < slots.length && n > 0; i++) {
      const s = slots[i];
      if (s && s.id === id) {
        const d = Math.min(s.n, n);
        s.n -= d; n -= d;
        if (s.n <= 0) {
          const real = i < 9 ? this.hotbar : this.bag;
          real[i < 9 ? i : i - 9] = null;
        }
      }
    }
    return n === 0;
  }

  // 返回未放入的数量
  add(id, n) {
    const max = this.maxStack(id);
    const groups = [this.hotbar, this.bag];
    for (const g of groups) {
      for (let i = 0; i < g.length && n > 0; i++) {
        const s = g[i];
        if (s && s.id === id && s.n < max) {
          const d = Math.min(max - s.n, n);
          s.n += d; n -= d;
        }
      }
    }
    for (const g of groups) {
      for (let i = 0; i < g.length && n > 0; i++) {
        if (!g[i]) {
          const d = Math.min(max, n);
          g[i] = { id, n: d };
          n -= d;
        }
      }
    }
    return n;
  }

  allSlots() { return this.hotbar.concat(this.bag); }

  serialize() {
    const enc = a => a.map(s => s ? [s.id, s.n] : 0);
    return { hotbar: enc(this.hotbar), bag: enc(this.bag), sel: this.sel };
  }
  restore(d) {
    const dec = a => a.map(s => (s && s !== 0) ? { id: s[0], n: s[1] } : null);
    this.hotbar = dec(d.hotbar);
    this.bag = dec(d.bag);
    this.sel = d.sel || 0;
  }
}

// ---- 配方 ----
const RECIPES = [
  { name: '木板 ×4',   out: [B.PLANK, 4],       cost: [[B.LOG, 1]] },
  { name: '木棍 ×4',   out: [ITEM.STICK, 4],    cost: [[B.PLANK, 2]] },
  { name: '木镐',      out: [ITEM.PICK, 1],     cost: [[B.PLANK, 3], [ITEM.STICK, 2]] },
  { name: '木斧',      out: [ITEM.AXE, 1],      cost: [[B.PLANK, 3], [ITEM.STICK, 2]] },
  { name: '木铲',      out: [ITEM.SHOVEL, 1],   cost: [[B.PLANK, 1], [ITEM.STICK, 2]] },
  { name: '木剑',      out: [ITEM.SWORD, 1],    cost: [[B.PLANK, 2], [ITEM.STICK, 1]] },
  { name: 'TNT',       out: [B.TNT, 1],         cost: [[B.SAND, 4], [ITEM.COAL, 1]] },
  { name: '荧光石',    out: [B.GLOWSTONE, 1],   cost: [[B.COBBLE, 2], [ITEM.COAL, 1], [B.SAND, 2]] },
  { name: '玻璃（熔炼）', out: [B.GLASS, 0],    cost: [], smelt: true },
];
// 熔炼表：原料 -> 产物（消耗 1 煤炭 / 件）
const SMELT_MAP = { [B.SAND]: B.GLASS, [B.COBBLE]: B.STONE, [B.LOG]: ITEM.CHARCOAL };
