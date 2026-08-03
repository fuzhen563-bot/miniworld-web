// ============ 地形生成 ============
'use strict';

const CHUNK = 16, WHEIGHT = 96, SEA = 30;

class TerrainGen {
  constructor(seed) {
    this.seed = seed;
    this.rng = mulberry32(seed ^ 0x9e3779b9);
    this.contN = makeNoise2D(seed * 3 + 1);
    this.cont = makeFBM(this.contN, 4, 2.0, 0.5);
    this.mountN = makeNoise2D(seed * 7 + 2);
    this.mount = makeFBM(this.mountN, 4, 2.0, 0.5);
    this.caveN = makeNoise2D(seed * 11 + 3);
    this.sandN = makeNoise2D(seed * 13 + 4);
    this.tempN = makeNoise2D(seed * 17 + 5);
    this.treeN = makeNoise2D(seed * 19 + 6);
    this._cache = new Map(); // "cx,cz" -> height/terrain 数据
  }

  heightAt(wx, wz) {
    const c = this.cont(wx / 220, wz / 220);           // 0..1
    const m = this.mount(wx / 95, wz / 95);
    let h = SEA - 5 + c * 26 + Math.pow(m, 3.2) * 52;
    return Math.max(3, Math.min(WHEIGHT - 10, Math.round(h)));
  }

  _chunkInfo(cx, cz) {
    const key = cx + ',' + cz;
    let info = this._cache.get(key);
    if (!info) {
      const H = new Int16Array(CHUNK * CHUNK);
      const T2 = new Uint8Array(CHUNK * CHUNK); // 0 普通 1 沙地 2 雪
      for (let z = 0; z < CHUNK; z++) for (let x = 0; x < CHUNK; x++) {
        const wx = cx * CHUNK + x, wz = cz * CHUNK + z;
        const h = this.heightAt(wx, wz);
        H[z * CHUNK + x] = h;
        const t = this.tempN(wx / 190, wz / 190);
        T2[z * CHUNK + x] = t > 0.68 ? 2 : (h <= SEA + 1 ? 1 : 0);
      }
      info = { H, T2 };
      this._cache.set(key, info);
      if (this._cache.size > 300) this._cache.clear();
    }
    return info;
  }

  // 单个世界坐标的石头地形（不含表面覆盖、树、矿）——用于列生成时的快速判断
  solidColInfo(cx, cz) { return this._chunkInfo(cx, cz); }

  isCave(wx, y, wz) {
    if (y <= 4 || y >= WHEIGHT - 2) return false;
    const v1 = this.caveN(wx / 26, y / 15);
    const v2 = this.caveN(wz / 26 + 300, y / 15 + 300);
    if (Math.abs(v1 - 0.5) < 0.052 && Math.abs(v2 - 0.5) < 0.052) return true;
    // 大洞
    const b = this.mountN(wx / 40, wz / 40);
    if (y > 5 && y < 26 && Math.abs(this.caveN(wx / 17 + 77, wz / 17 + 77) - 0.5) < 0.028 + b * 0.01) return true;
    return false;
  }

  fillColumn(cx, cz, lx, lz, col, rng) {
    const info = this._chunkInfo(cx, cz);
    const i = lz * CHUNK + lx;
    const wx = cx * CHUNK + lx, wz = cz * CHUNK + lz;
    const h = info.H[i], terr = info.T2[i];
    const snowy = terr === 2, sandy = terr === 1;

    for (let y = 0; y < WHEIGHT; y++) {
      let id = B.AIR;
      if (y === 0) id = B.BEDROCK;
      else if (this.isCave(wx, y, wz) && y < h) id = B.AIR;
      else if (y < h - 3) id = B.STONE;
      else if (y < h) id = sandy ? B.SAND : B.DIRT;
      else if (y === h) id = snowy ? B.SNOW : (sandy ? B.SAND : B.GRASS);
      else if (y <= SEA && y > h) id = B.WATER;
      col[y] = id;
    }
    // 矿石
    for (let y = 1; y < h - 1; y++) {
      if (col[y] !== B.STONE) continue;
      const o = this.mountN(wx / 7 + y * 0.37, wz / 7 - y * 0.53);
      if (o > 0.82 && y < 26) col[y] = B.IRON_ORE;
      else if (o > 0.775 && y < 52) col[y] = B.COAL_ORE;
    }
    return h;
  }

  treeAt(wx, wz) {
    const v = this.treeN(wx * 0.618, wz * 0.618);
    if (v > 0.94) return { dx: 0, dz: 0 }; // 单棵树
    // 小簇：两棵靠近的树
    if (v > 0.912 && v <= 0.94 && this.treeN(wx * 1.31 + 500, wz * 1.31) > 0.6) return { dx: 0, dz: 0 };
    return null;
  }

  // 生成树（可越界，world 负责路由到正确 chunk 列）
  buildTree(world, wx, wz, h, rng) {
    const ground = world.getBlock(wx, h, wz);
    if (ground !== B.GRASS && ground !== B.SNOW) return;
    const th = 4 + ((rng() * 3) | 0);
    for (let y = h + 1; y <= h + th; y++) world.setTreeBlock(wx, y, wz, B.LOG);
    const top = h + th;
    for (let dy = -2; dy <= 1; dy++) {
      const r = dy >= 0 ? 1 : 2;
      for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
        if (dy <= -1 && Math.abs(dx) === r && Math.abs(dz) === r && rng() < 0.6) continue;
        const ly = top + dy;
        if (ly < 2 || ly >= WHEIGHT - 1) continue;
        if (world.getBlock(wx + dx, ly, wz + dz) === B.AIR)
          world.setTreeBlock(wx + dx, ly, wz + dz, B.LEAVES);
      }
    }
    if (world.getBlock(wx, top + 2, wz) === B.AIR) world.setTreeBlock(wx, top + 2, wz, B.LEAVES);
  }

  decorate(world, cx, cz) {
    const info = this._chunkInfo(cx, cz);
    const rng = mulberry32((cx * 341873128713 + cz * 132897987541 + this.seed) >>> 0);
    // 树
    for (let z = -1; z <= CHUNK; z++) for (let x = -1; x <= CHUNK; x++) {
      const wx = cx * CHUNK + x, wz = cz * CHUNK + z;
      if (this.treeAt(wx, wz)) {
        const i = Math.max(0, Math.min(CHUNK - 1, z)) * CHUNK + Math.max(0, Math.min(CHUNK - 1, x));
        this.buildTree(world, wx, wz, info.H[i], rng);
      }
    }
    // 花草（仅本 chunk 内）
    for (let z = 0; z < CHUNK; z++) for (let x = 0; x < CHUNK; x++) {
      const wx = cx * CHUNK + x, wz = cz * CHUNK + z;
      const i = z * CHUNK + x;
      const h = info.H[i];
      const below = world.getBlock(wx, h, wz);
      if (below !== B.GRASS || world.getBlock(wx, h + 1, wz) !== B.AIR) continue;
      const r = rng();
      if (r < 0.09) world.setTreeBlock(wx, h + 1, wz, B.TALLGRASS);
      else if (r < 0.099) world.setTreeBlock(wx, h + 1, wz, B.DANDELION);
      else if (r < 0.106) world.setTreeBlock(wx, h + 1, wz, B.ROSE);
    }
  }
}
