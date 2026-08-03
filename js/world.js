// ============ 世界：区块存储 / 方块读写 / 存档 ============
'use strict';

const SAVE_KEY = 'miniworld.save.v3';

class World {
  constructor(gen) {
    this.gen = gen;
    this.chunks = new Map();      // "cx,cz" -> chunk
    this.listeners = [];          // 方块变更监听（粒子 / 掉落物）
  }

  _key(cx, cz) { return cx + ',' + cz; }

  getChunk(cx, cz) { return this.chunks.get(this._key(cx, cz)); }

  getOrCreateChunk(cx, cz) {
    let c = this.chunks.get(this._key(cx, cz));
    if (!c) {
      c = { cx, cz, cols: new Map(), state: 0, dirty: new Set(), tnt: new Map() };
      this.chunks.set(this._key(cx, cz), c);
    }
    return c;
  }

  colKey(lx, lz) { return (lx << 4) | lz; }

  _ensureCol(chunk, lx, lz) {
    const k = this.colKey(lx, lz);
    let col = chunk.cols.get(k);
    if (!col) {
      col = new Uint8Array(WHEIGHT);
      this.gen.fillColumn(chunk.cx, chunk.cz, lx, lz, col, null);
      chunk.cols.set(k, col);
      chunk.dirty.add(k);
    }
    return col;
  }

  // 保证某区块所有列已生成并完成装饰（会连带邻居填充，供树木跨块）
  ensureDecorated(cx, cz) {
    const c = this.getOrCreateChunk(cx, cz);
    if (c.state >= 2) return c;
    if (c.state === 0) {
      for (let z = 0; z < CHUNK; z++) for (let x = 0; x < CHUNK; x++) this._ensureCol(c, x, z);
      c.state = 1;
    }
    // 先保证四邻居已填充（树叶跨界）
    for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const n = this.getOrCreateChunk(cx + dx, cz + dz);
      if (n.state === 0) {
        for (let z = 0; z < CHUNK; z++) for (let x = 0; x < CHUNK; x++) this._ensureCol(n, x, z);
        n.state = 1;
      }
    }
    this.gen.decorate(this, cx, cz);
    c.state = 2;
    c.dirty.add(-1); // 全部重绘
    for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const n = this.getChunk(cx + dx, cz + dz);
      if (n) n.dirty.add(-1);
    }
    return c;
  }

  getBlock(wx, y, wz) {
    if (y < 0 || y >= WHEIGHT) return B.AIR;
    const cx = Math.floor(wx / CHUNK), cz = Math.floor(wz / CHUNK);
    const c = this.getChunk(cx, cz);
    if (!c) return B.AIR;
    const lx = wx - cx * CHUNK, lz = wz - cz * CHUNK;
    const col = c.cols.get(this.colKey(lx, lz));
    return col ? col[y] : B.AIR;
  }

  setBlock(wx, y, wz, id, opts) {
    if (y < 0 || y >= WHEIGHT) return;
    const cx = Math.floor(wx / CHUNK), cz = Math.floor(wz / CHUNK);
    const c = this.getOrCreateChunk(cx, cz);
    const lx = wx - cx * CHUNK, lz = wz - cz * CHUNK;
    const k = this.colKey(lx, lz);
    const col = this._ensureCol(c, lx, lz);
    if (col[y] === id) return;
    col[y] = id;
    c.dirty.add(k);
    if (lx === 0) { const n = this.getChunk(cx - 1, cz); if (n) n.dirty.add(this.colKey(CHUNK - 1, lz)); }
    if (lx === CHUNK - 1) { const n = this.getChunk(cx + 1, cz); if (n) n.dirty.add(this.colKey(0, lz)); }
    if (lz === 0) { const n = this.getChunk(cx, cz - 1); if (n) n.dirty.add(this.colKey(lx, CHUNK - 1)); }
    if (lz === CHUNK - 1) { const n = this.getChunk(cx, cz + 1); if (n) n.dirty.add(this.colKey(lx, 0)); }
    if (!opts || !opts.quiet) for (const f of this.listeners) f(wx, y, wz, id);
  }

  // 树木装饰专用（目标列可能未生成，直接单列补齐）
  setTreeBlock(wx, y, wz, id) {
    if (y < 0 || y >= WHEIGHT) return;
    const cx = Math.floor(wx / CHUNK), cz = Math.floor(wz / CHUNK);
    const c = this.getOrCreateChunk(cx, cz);
    const lx = wx - cx * CHUNK, lz = wz - cz * CHUNK;
    const col = this._ensureCol(c, lx, lz);
    if (col[y] === B.AIR) col[y] = id;
    c.dirty.add(this.colKey(lx, lz));
  }

  // 玩家附近地表高度（用于出生 / 重生）
  surfaceAt(wx, wz) {
    for (let y = WHEIGHT - 2; y > 0; y--) {
      const id = this.getBlock(wx, y, wz);
      if (id !== B.AIR && id !== B.WATER) return y + 1;
    }
    return SEA + 2;
  }

  // TNT 定时
  scheduleTNT(wx, y, wz, delay) {
    const cx = Math.floor(wx / CHUNK), cz = Math.floor(wz / CHUNK);
    const c = this.getOrCreateChunk(cx, cz);
    c.tnt.set(this.colKey(wx - cx * CHUNK, wz - cz * CHUNK) + ':' + y, { x: wx, y, z: wz, t: delay });
  }

  updateTNT(dt, explodeFn) {
    for (const [key, c] of this.chunks) {
      if (c.tnt.size === 0) continue;
      for (const [k, b] of c.tnt) {
        b.t -= dt;
        if (b.t <= 0) { c.tnt.delete(k); explodeFn(b.x, b.y, b.z); }
      }
    }
  }

  // ---------------- 存档 ----------------
  serialize() {
    const chunks = [];
    for (const [, c] of this.chunks) {
      const cols = {};
      for (const [k, col] of c.cols) {
        let s = '';
        for (let i = 0; i < col.length; i++) s += String.fromCharCode(col[i]);
        cols[k] = btoa(s);
      }
      chunks.push({ x: c.cx, z: c.cz, s: c.state, cols });
    }
    return { v: 3, seed: this.gen.seed, chunks };
  }

  load(data) {
    this.chunks.clear();
    for (const cd of data.chunks) {
      const c = this.getOrCreateChunk(cd.x, cd.z);
      c.state = Math.max(1, cd.s || 1);
      for (const k in cd.cols) {
        const s = atob(cd.cols[k]);
        const col = new Uint8Array(WHEIGHT);
        for (let i = 0; i < WHEIGHT && i < s.length; i++) col[i] = s.charCodeAt(i);
        c.cols.set(+k, col);
      }
    }
  }

  // 卸载远处区块释放内存
  gc(px, pz, keepRadius) {
    const pcx = Math.floor(px / CHUNK), pcz = Math.floor(pz / CHUNK);
    for (const [key, c] of this.chunks) {
      if (Math.abs(c.cx - pcx) > keepRadius || Math.abs(c.cz - pcz) > keepRadius) {
        this.chunks.delete(key);
      }
    }
  }
}
