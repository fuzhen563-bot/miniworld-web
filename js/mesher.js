// ============ 区块网格生成：面剔除 / AO 简化着色 / 水面 ============
'use strict';

const FACES = [
  { dir: [1, 0, 0],  corners: [[1,0,1],[1,0,0],[1,1,0],[1,1,1]] }, // +X
  { dir: [-1, 0, 0], corners: [[0,0,0],[0,0,1],[0,1,1],[0,1,0]] }, // -X
  { dir: [0, 1, 0],  corners: [[0,1,1],[1,1,1],[1,1,0],[0,1,0]] }, // +Y
  { dir: [0, -1, 0], corners: [[0,0,0],[1,0,0],[1,0,1],[0,0,1]] }, // -Y
  { dir: [0, 0, 1],  corners: [[0,0,1],[1,0,1],[1,1,1],[0,1,1]] }, // +Z
  { dir: [0, 0, -1], corners: [[1,0,0],[0,0,0],[0,1,0],[1,1,0]] }, // -Z
];
const FACE_UV = [[0,0],[1,0],[1,1],[0,1]];
const FACE_SHADE = [0.62, 0.62, 1.0, 0.5, 0.8, 0.8];

class Mesher {
  constructor(atlas) { this.atlas = atlas; }

  // 生成一个 chunk 的几何：返回 { opq:{pos,uv,col,idx}, trans:{...} }
  build(world, chunk) {
    const atlas = this.atlas;
    const ox = chunk.cx * CHUNK, oz = chunk.cz * CHUNK;
    const opq = { pos: [], uv: [], col: [], idx: [] };
    const trans = { pos: [], uv: [], col: [], idx: [] };

    const pushFace = (g, bx, by, bz, fi, tile, bright, emis, hTop) => {
      const f = FACES[fi];
      const [u0, v0, u1, v1] = atlas.uv(tile);
      const base = g.pos.length / 3;
      for (let i = 0; i < 4; i++) {
        const c = f.corners[i];
        let cy = c[1]; if (cy === 1) cy = hTop;
        g.pos.push(bx + c[0], by + cy, bz + c[2]);
        const p = FACE_UV[i];
        g.uv.push(u0 + (u1 - u0) * p[0], v0 + (v1 - v0) * p[1]);
        g.col.push(bright, bright, bright, emis ? 1 : 0);
      }
      g.idx.push(base, base+1, base+2, base, base+2, base+3);
    };

    const pushCross = (g, bx, by, bz, tile, bright) => {
      const [u0, v0, u1, v1] = atlas.uv(tile);
      const quads = [
        [[0.10,0,0.10],[0.90,0,0.90],[0.90,1,0.90],[0.10,1,0.10]],
        [[0.90,0,0.10],[0.10,0,0.90],[0.10,1,0.90],[0.90,1,0.10]],
      ];
      for (const q of quads) {
        const base = g.pos.length / 3;
        for (let i = 0; i < 4; i++) {
          g.pos.push(bx + q[i][0], by + q[i][1], bz + q[i][2]);
          const p = FACE_UV[i];
          g.uv.push(u0 + (u1 - u0) * p[0], v0 + (v1 - v0) * p[1]);
          g.col.push(bright, bright, bright, 0);
        }
        // 双面（背面剔除下两个绕向都要）
        g.idx.push(base, base+1, base+2, base, base+2, base+3);
        g.idx.push(base+2, base+1, base, base+3, base+2, base);
      }
    };

    // ---- 邻居列缓存，避免逐方块 Map/字符串查找 ----
    const cx = chunk.cx, cz = chunk.cz;
    const nbr = {
      xm: world.getChunk(cx - 1, cz), xp: world.getChunk(cx + 1, cz),
      zm: world.getChunk(cx, cz - 1), zp: world.getChunk(cx, cz + 1),
    };
    const getCol = (lx, lz) => {
      if (lx >= 0 && lx < CHUNK && lz >= 0 && lz < CHUNK) return chunk.cols.get((lx << 4) | lz) || null;
      if (lx === -1) return nbr.xm ? (nbr.xm.cols.get(((CHUNK - 1) << 4) | lz) || null) : null;
      if (lx === CHUNK) return nbr.xp ? (nbr.xp.cols.get(lz) || null) : null;
      if (lz === -1) return nbr.zm ? (nbr.zm.cols.get((lx << 4) | (CHUNK - 1)) || null) : null;
      if (lz === CHUNK) return nbr.zp ? (nbr.zp.cols.get((lx << 4) | 0) || null) : null;
      return null;
    };
    const blockAt = (lx, y, lz) => {
      if (y < 0 || y >= WHEIGHT) return B.AIR;
      const c = getCol(lx, lz);
      return c ? c[y] : B.AIR;
    };

    for (let lz = 0; lz < CHUNK; lz++) {
      for (let lx = 0; lx < CHUNK; lx++) {
        const col = chunk.cols.get(world.colKey(lx, lz));
        if (!col) continue;
        const wx = ox + lx, wz = oz + lz;
        for (let y = 0; y < WHEIGHT; y++) {
          const id = col[y];
          if (id === B.AIR) continue;
          const def = BLOCKS[id];
          if (def.cross) { pushCross(opq, wx, y, wz, def.tex[2], 0.92); continue; }

          if (def.fluid) {
            const above = blockAt(lx, y + 1, lz);
            const hTop = above === B.WATER ? 1 : 0.875;
            // 顶面
            if (above !== B.WATER && !BLOCKS[above].opaque)
              pushFace(trans, wx, y, wz, 2, def.tex[0], 1.0, false, hTop);
            // 底面
            const below = y > 0 ? col[y - 1] : B.BEDROCK;
            if (below !== B.WATER && !BLOCKS[below].opaque)
              pushFace(trans, wx, y, wz, 3, def.tex[0], 0.55, false, 1);
            // 侧面
            for (const fi of [0, 1, 4, 5]) {
              const nb = blockAt(lx + FACES[fi].dir[0], y, lz + FACES[fi].dir[2]);
              if (nb !== B.WATER && !BLOCKS[nb].opaque)
                pushFace(trans, wx, y, wz, fi, def.tex[0], FACE_SHADE[fi], false, hTop);
            }
            continue;
          }

          const emis = def.emissive;
          for (let fi = 0; fi < 6; fi++) {
            const d = FACES[fi].dir;
            const nb = d[1] !== 0
              ? (y + d[1] >= 0 && y + d[1] < WHEIGHT ? col[y + d[1]] : B.AIR)
              : blockAt(lx + d[0], y, lz + d[2]);
            const nd = BLOCKS[nb];
            if (nd.opaque) continue;      // 被实心方块挡住
            if (nb === id) continue;        // 同类透明/树叶不互相画面
            const bright = emis ? 1.0 : FACE_SHADE[fi];
            pushFace(opq, wx, y, wz, fi, def.tex[fi === 2 ? 0 : fi === 3 ? 1 : 2], bright, emis, 1);
          }
        }
      }
    }
    return { opq, trans };
  }
}
