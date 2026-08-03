// ============ 方块 / 物品定义 + 程序化像素纹理图集 ============
'use strict';

const TS = 16;            // 纹理尺寸
const ATLAS_COLS = 8, ATLAS_ROWS = 4;

// ---- 方块 id ----
const B = {
  AIR:0, GRASS:1, DIRT:2, STONE:3, COBBLE:4, PLANK:5, LOG:6, LEAVES:7,
  SAND:8, WATER:9, GLASS:10, SNOW:11, BEDROCK:12, COAL_ORE:13, IRON_ORE:14,
  ROSE:15, DANDELION:16, TALLGRASS:17, TNT:18, GLOWSTONE:19, ICE:20,
};
// ---- 物品 id（>=100）----
const ITEM = { STICK:100, COAL:101, CHARCOAL:102, PICK:103, AXE:104, SHOVEL:105, SWORD:106, FLINT:107, APPLE:108 };

// ---- 纹理 tile 编号 ----
const T = {
  GRASS_TOP:0, GRASS_SIDE:1, DIRT:2, STONE:3, LOG_SIDE:4, LOG_TOP:5, LEAVES:6, PLANK:7,
  SAND:8, WATER:9, GLASS:10, COBBLE:11, BEDROCK:12, SNOW:13, SNOW_SIDE:14, COAL:15,
  IRON:16, TNT_SIDE:17, TNT_TOP:18, ROSE:19, DANDELION:20, TALLGRASS:21, GLOW:22, ICE:23,
};

// tex: [top, bottom, side]
const BLOCKS = [];
function defBlock(id, key, name, o) { BLOCKS[id] = Object.assign({
  id, key, name, tex:[T.STONE,T.STONE,T.STONE], solid:true, opaque:true, cross:false,
  fluid:false, emissive:false, hard:1, req:null, needTool:false, drop:id, breakable:true,
}, o); }

defBlock(B.AIR,       'air',      '空气',    {solid:false, opaque:false, breakable:false});
defBlock(B.GRASS,     'grass',    '草方块',  {tex:[T.GRASS_TOP,T.DIRT,T.GRASS_SIDE], hard:0.8, req:'shovel', drop:B.DIRT});
defBlock(B.DIRT,      'dirt',     '泥土',    {tex:[T.DIRT,T.DIRT,T.DIRT], hard:0.75, req:'shovel'});
defBlock(B.STONE,     'stone',    '石头',    {tex:[T.STONE,T.STONE,T.STONE], hard:2.2, req:'pick', needTool:true, drop:B.COBBLE});
defBlock(B.COBBLE,    'cobble',   '圆石',    {tex:[T.COBBLE,T.COBBLE,T.COBBLE], hard:2.4, req:'pick', needTool:true});
defBlock(B.PLANK,     'plank',    '木板',    {tex:[T.PLANK,T.PLANK,T.PLANK], hard:1.4, req:'axe'});
defBlock(B.LOG,       'log',      '原木',    {tex:[T.LOG_TOP,T.LOG_TOP,T.LOG_SIDE], hard:1.6, req:'axe'});
defBlock(B.LEAVES,    'leaves',   '树叶',    {tex:[T.LEAVES,T.LEAVES,T.LEAVES], opaque:false, hard:0.3, req:'sword', drop:'leaf'});
defBlock(B.SAND,      'sand',     '沙子',    {tex:[T.SAND,T.SAND,T.SAND], hard:0.75, req:'shovel'});
defBlock(B.WATER,     'water',    '水',      {tex:[T.WATER,T.WATER,T.WATER], solid:false, opaque:false, fluid:true, breakable:false});
defBlock(B.GLASS,     'glass',    '玻璃',    {tex:[T.GLASS,T.GLASS,T.GLASS], opaque:false, hard:0.4, drop:null});
defBlock(B.SNOW,      'snow',     '雪块',    {tex:[T.SNOW,T.SNOW,T.SNOW_SIDE], hard:0.5, req:'shovel'});
defBlock(B.BEDROCK,   'bedrock',  '基岩',    {tex:[T.BEDROCK,T.BEDROCK,T.BEDROCK], hard:999, breakable:false});
defBlock(B.COAL_ORE,  'coal_ore', '煤矿石',  {tex:[T.COAL,T.COAL,T.COAL], hard:3, req:'pick', needTool:true, drop:ITEM.COAL});
defBlock(B.IRON_ORE,  'iron_ore', '铁矿石',  {tex:[T.IRON,T.IRON,T.IRON], hard:3.2, req:'pick', needTool:true});
defBlock(B.ROSE,      'rose',     '玫瑰花',  {tex:[T.ROSE,T.ROSE,T.ROSE], solid:false, opaque:false, cross:true, hard:0.05});
defBlock(B.DANDELION, 'dandelion','蒲公英',  {tex:[T.DANDELION,T.DANDELION,T.DANDELION], solid:false, opaque:false, cross:true, hard:0.05});
defBlock(B.TALLGRASS, 'tallgrass','草丛',    {tex:[T.TALLGRASS,T.TALLGRASS,T.TALLGRASS], solid:false, opaque:false, cross:true, hard:0.05, drop:null});
defBlock(B.TNT,       'tnt',      'TNT',     {tex:[T.TNT_TOP,T.TNT_TOP,T.TNT_SIDE], hard:0.1});
defBlock(B.GLOWSTONE, 'glow',     '荧光石',  {tex:[T.GLOW,T.GLOW,T.GLOW], emissive:true, hard:0.4});
defBlock(B.ICE,       'ice',      '冰块',    {tex:[T.ICE,T.ICE,T.ICE], opaque:false, hard:1, drop:null});

const ITEMS = [];
function defItem(id, name, o) { ITEMS[id] = Object.assign({ id, name, stack:99 }, o); }
defItem(ITEM.STICK,    '木棍',   {dropCol:[0.62,0.45,0.24]});
defItem(ITEM.COAL,     '煤炭',   {dropCol:[0.15,0.15,0.16]});
defItem(ITEM.CHARCOAL, '木炭',   {dropCol:[0.32,0.27,0.22]});
defItem(ITEM.PICK,     '木镐',   {stack:1, tool:'pick',   speed:4.5, dropCol:[0.75,0.66,0.45]});
defItem(ITEM.AXE,      '木斧',   {stack:1, tool:'axe',    speed:4.5, dropCol:[0.75,0.66,0.45]});
defItem(ITEM.SHOVEL,   '木铲',   {stack:1, tool:'shovel', speed:4.5, dropCol:[0.75,0.66,0.45]});
defItem(ITEM.SWORD,    '木剑',   {stack:1, tool:'sword',  speed:1.6, dropCol:[0.78,0.7,0.5]});
defItem(ITEM.FLINT,    '打火石', {stack:1});
defItem(ITEM.APPLE,    '苹果',   {food:4, dropCol:[0.88,0.22,0.18]});

function itemName(id) { return id < 100 ? BLOCKS[id].name : ITEMS[id].name; }
function isBlockItem(id) { return id < 100; }
// 创造模式可放置的方块列表
const CREATIVE_BLOCKS = [
  B.GRASS,B.DIRT,B.STONE,B.COBBLE,B.PLANK,B.LOG,B.LEAVES,B.SAND,B.GLASS,B.SNOW,
  B.COAL_ORE,B.IRON_ORE,B.BEDROCK,B.ROSE,B.DANDELION,B.TALLGRASS,B.TNT,B.GLOWSTONE,B.ICE,B.WATER,
];

// =====================================================================
//  纹理工集：运行时程序化生成 16x16 像素材质
// =====================================================================
class Atlas {
  constructor(seed) {
    this.rng = mulberry32(seed || 1337);
    this.canvas = document.createElement('canvas');
    this.canvas.width = ATLAS_COLS * TS;
    this.canvas.height = ATLAS_ROWS * TS;
    this.ctx = this.canvas.getContext('2d');
    this.tiles = {}; // tileId -> 独立 16x16 canvas（用于图标）
    this._genAll();
  }

  _tile(i, fn) {
    const c = document.createElement('canvas');
    c.width = c.height = TS;
    const ctx = c.getContext('2d');
    fn(ctx, this.rng);
    this.tiles[i] = c;
    const tx = (i % ATLAS_COLS) * TS, ty = ((i / ATLAS_COLS) | 0) * TS;
    this.ctx.drawImage(c, tx, ty);
  }

  uv(tile) {
    const tx = tile % ATLAS_COLS, ty = (tile / ATLAS_COLS) | 0;
    const e = 0.0012;
    const u0 = tx / ATLAS_COLS + e, u1 = (tx + 1) / ATLAS_COLS - e;
    const v1 = 1 - ty / ATLAS_ROWS - e, v0 = 1 - (ty + 1) / ATLAS_ROWS + e;
    return [u0, v0, u1, v1];
  }

  tileCanvas(tile) { return this.tiles[tile]; }

  _genAll() {
    const R = this.rng;
    const speckle = (ctx, r, g, b, v) => {
      for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) {
        const d = ((R() - 0.5) * 2 * v) | 0;
        ctx.fillStyle = `rgb(${r+d},${g+d},${b+d})`;
        ctx.fillRect(x, y, 1, 1);
      }
    };

    this._tile(T.GRASS_TOP, ctx => speckle(ctx, 106, 172, 64, 16));
    this._tile(T.DIRT, ctx => speckle(ctx, 134, 96, 67, 17));
    this._tile(T.GRASS_SIDE, (ctx) => {
      speckle(ctx, 134, 96, 67, 17);
      for (let x = 0; x < TS; x++) {
        const h = 2 + ((R() * 3) | 0);
        for (let y = 0; y < h; y++) {
          const d = ((R() - 0.5) * 26) | 0;
          ctx.fillStyle = `rgb(${100+d},${168+d},${60+d})`;
          ctx.fillRect(x, y, 1, 1);
        }
      }
    });
    this._tile(T.STONE, (ctx) => {
      speckle(ctx, 128, 128, 128, 11);
      for (let i = 0; i < 14; i++) {
        ctx.fillStyle = 'rgba(88,88,88,0.8)';
        ctx.fillRect((R()*TS)|0, (R()*TS)|0, 1 + (R()*2|0), 1);
      }
    });
    this._tile(T.LOG_SIDE, (ctx) => {
      for (let x = 0; x < TS; x++) {
        const base = (x % 4 === 0) ? 74 : 102;
        for (let y = 0; y < TS; y++) {
          const d = ((R() - 0.5) * 18) | 0;
          ctx.fillStyle = `rgb(${base+d},${(base*0.8|0)+d},${50+d})`;
          ctx.fillRect(x, y, 1, 1);
        }
      }
    });
    this._tile(T.LOG_TOP, (ctx) => {
      speckle(ctx, 100, 78, 48, 10);
      for (let r = 1; r < 8; r += 2) {
        ctx.fillStyle = 'rgb(168,136,88)';
        for (let i = 0; i < 40; i++) {
          const a = R() * Math.PI * 2;
          const x = (8 + Math.cos(a) * r) | 0, y = (8 + Math.sin(a) * r) | 0;
          if (x >= 0 && x < TS && y >= 0 && y < TS) ctx.fillRect(x, y, 1, 1);
        }
      }
    });
    this._tile(T.LEAVES, (ctx) => {
      for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) {
        if (R() < 0.14) continue; // 镂空
        const d = ((R() - 0.5) * 30) | 0;
        ctx.fillStyle = `rgb(${52+d},${118+d},${40+d})`;
        ctx.fillRect(x, y, 1, 1);
      }
    });
    this._tile(T.PLANK, (ctx) => {
      speckle(ctx, 168, 134, 82, 12);
      ctx.fillStyle = 'rgb(110,84,48)';
      for (const y of [3, 7, 11, 15]) ctx.fillRect(0, y, TS, 1);
      ctx.fillRect(4, 0, 1, 3); ctx.fillRect(11, 4, 1, 3); ctx.fillRect(2, 8, 1, 3); ctx.fillRect(13, 12, 1, 3);
    });
    this._tile(T.SAND, ctx => speckle(ctx, 219, 207, 163, 12));
    this._tile(T.WATER, (ctx) => {
      for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) {
        const d = ((R() - 0.5) * 22) | 0;
        const wave = (Math.sin((x + y * 2) * 0.9) > 0.55) ? 26 : 0;
        ctx.fillStyle = `rgba(${44+d+wave},${88+d+wave},${205+d},0.82)`;
        ctx.fillRect(x, y, 1, 1);
      }
    });
    this._tile(T.GLASS, (ctx) => {
      ctx.clearRect(0, 0, TS, TS);
      ctx.fillStyle = 'rgba(190,225,240,0.14)'; ctx.fillRect(0, 0, TS, TS);
      ctx.fillStyle = 'rgba(220,242,250,0.95)';
      ctx.fillRect(0, 0, TS, 1); ctx.fillRect(0, TS-1, TS, 1); ctx.fillRect(0, 0, 1, TS); ctx.fillRect(TS-1, 0, 1, TS);
      ctx.fillStyle = 'rgba(255,255,255,0.65)';
      ctx.fillRect(3, 2, 1, 4); ctx.fillRect(4, 2, 1, 2); ctx.fillRect(11, 8, 1, 4);
    });
    this._tile(T.COBBLE, (ctx) => {
      // voronoi 风格圆石
      const pts = []; for (let i = 0; i < 7; i++) pts.push([R()*TS, R()*TS]);
      for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) {
        let d1 = 1e9, d2 = 1e9;
        for (const p of pts) {
          const d = Math.hypot(x - p[0], y - p[1]);
          if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
        }
        const edge = (d2 - d1) < 1.1;
        const v = ((R() - 0.5) * 14) | 0;
        ctx.fillStyle = edge ? `rgb(${72+v},${72+v},${74+v})` : `rgb(${126+v},${126+v},${128+v})`;
        ctx.fillRect(x, y, 1, 1);
      }
    });
    this._tile(T.BEDROCK, (ctx) => {
      speckle(ctx, 70, 70, 72, 26);
      for (let i = 0; i < 20; i++) { ctx.fillStyle = 'rgb(38,38,40)'; ctx.fillRect((R()*TS)|0, (R()*TS)|0, 2, 1); }
    });
    this._tile(T.SNOW, ctx => speckle(ctx, 240, 246, 250, 7));
    this._tile(T.SNOW_SIDE, (ctx) => {
      speckle(ctx, 134, 96, 67, 17);
      for (let x = 0; x < TS; x++) {
        const h = 3 + ((R() * 2) | 0);
        for (let y = 0; y < h; y++) {
          const d = ((R() - 0.5) * 10) | 0;
          ctx.fillStyle = `rgb(${238+d},${244+d},${248+d})`;
          ctx.fillRect(x, y, 1, 1);
        }
      }
    });
    const oreTile = (ctx, r, g, b) => {
      speckle(ctx, 128, 128, 128, 11);
      for (let c = 0; c < 4; c++) {
        const cx = 2 + R() * 12, cy = 2 + R() * 12;
        for (let i = 0; i < 7; i++) {
          const x = (cx + (R() - 0.5) * 3) | 0, y = (cy + (R() - 0.5) * 3) | 0;
          const d = ((R() - 0.5) * 24) | 0;
          ctx.fillStyle = `rgb(${r+d},${g+d},${b+d})`;
          ctx.fillRect(x, y, 1 + (R() < 0.3 ? 1 : 0), 1);
        }
      }
    };
    this._tile(T.COAL, ctx => oreTile(ctx, 40, 40, 42));
    this._tile(T.IRON, ctx => oreTile(ctx, 216, 175, 147));
    this._tile(T.TNT_SIDE, (ctx) => {
      speckle(ctx, 198, 62, 48, 14);
      ctx.fillStyle = 'rgb(232,226,210)'; ctx.fillRect(0, 5, TS, 6);
      ctx.fillStyle = '#1a1a1a';
      ctx.font = 'bold 6px monospace'; ctx.textBaseline = 'middle';
      ctx.fillText('TNT', 2, 8.5);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      for (let x = 0; x < TS; x += 2) ctx.fillRect(x, 0, 1, 2);
    });
    this._tile(T.TNT_TOP, (ctx) => {
      speckle(ctx, 198, 62, 48, 14);
      ctx.fillStyle = 'rgb(120,34,26)';
      ctx.fillRect(0, 0, TS, 2); ctx.fillRect(0, TS-2, TS, 2); ctx.fillRect(0, 0, 2, TS); ctx.fillRect(TS-2, 0, 2, TS);
      ctx.fillStyle = 'rgb(60,44,30)'; ctx.fillRect(6, 6, 4, 4);
      ctx.fillStyle = 'rgb(20,20,20)'; ctx.fillRect(7, 7, 2, 2);
    });
    const flower = (ctx, petal) => {
      ctx.clearRect(0, 0, TS, TS);
      ctx.fillStyle = 'rgb(70,140,50)';
      ctx.fillRect(7, 8, 2, 8); ctx.fillRect(5, 11, 2, 1); ctx.fillRect(9, 13, 2, 1);
      for (const [dx, dy] of [[0,-2],[-2,0],[2,0],[0,2],[-1,-1],[1,-1],[-1,1],[1,1],[0,0]]) {
        const d = ((R() - 0.5) * 30) | 0;
        ctx.fillStyle = `rgb(${petal[0]+d},${petal[1]+d},${petal[2]+d})`;
        ctx.fillRect(7 + dx, 6 + dy, 2, 2);
      }
    };
    this._tile(T.ROSE, ctx => flower(ctx, [214, 44, 38]));
    this._tile(T.DANDELION, ctx => flower(ctx, [246, 208, 48]));
    this._tile(T.TALLGRASS, (ctx) => {
      ctx.clearRect(0, 0, TS, TS);
      for (let i = 0; i < 12; i++) {
        const x = 1 + ((R() * 14) | 0);
        const h = 5 + ((R() * 8) | 0);
        const d = ((R() - 0.5) * 34) | 0;
        ctx.fillStyle = `rgb(${76+d},${150+d},${54+d})`;
        for (let y = TS - h; y < TS; y++) ctx.fillRect(x + ((y - (TS - h)) > h/2 && R()<0.4 ? 1 : 0), y, 1, 1);
      }
    });
    this._tile(T.GLOW, (ctx) => {
      speckle(ctx, 226, 172, 92, 20);
      for (let i = 0; i < 26; i++) {
        ctx.fillStyle = R() < 0.5 ? 'rgb(255,232,150)' : 'rgb(166,106,40)';
        ctx.fillRect((R()*TS)|0, (R()*TS)|0, 1 + (R()*2|0), 1 + (R()*2|0));
      }
    });
    this._tile(T.ICE, (ctx) => {
      for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) {
        const d = ((R() - 0.5) * 16) | 0;
        ctx.fillStyle = `rgba(${158+d},${202+d},${240+d},0.88)`;
        ctx.fillRect(x, y, 1, 1);
      }
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      for (let i = 0; i < 8; i++) { const x = (R()*TS)|0, y=(R()*TS)|0; ctx.fillRect(x, y, 3, 1); }
    });
  }
}

// ---- 物品 / 方块图标 ----
const _iconCache = {};
function iconCanvas(id, atlas) {
  const k = id + '';
  if (_iconCache[k]) return _iconCache[k];
  let c;
  if (id < 100) {
    const tile = {
      [B.GRASS]: T.GRASS_SIDE, [B.DIRT]: T.DIRT, [B.STONE]: T.STONE, [B.COBBLE]: T.COBBLE,
      [B.PLANK]: T.PLANK, [B.LOG]: T.LOG_SIDE, [B.LEAVES]: T.LEAVES, [B.SAND]: T.SAND,
      [B.WATER]: T.WATER, [B.GLASS]: T.GLASS, [B.SNOW]: T.SNOW_SIDE, [B.BEDROCK]: T.BEDROCK,
      [B.COAL_ORE]: T.COAL, [B.IRON_ORE]: T.IRON, [B.ROSE]: T.ROSE, [B.DANDELION]: T.DANDELION,
      [B.TALLGRASS]: T.TALLGRASS, [B.TNT]: T.TNT_SIDE, [B.GLOWSTONE]: T.GLOW, [B.ICE]: T.ICE,
    }[id];
    c = atlas.tileCanvas(tile);
  } else {
    c = document.createElement('canvas'); c.width = c.height = 32;
    _drawItem(c.getContext('2d'), id);
  }
  _iconCache[k] = c;
  return c;
}

function _drawItem(ctx, id) {
  const wood = '#8a5f33', dark = '#5d3f20', head = '#c9a86b';
  ctx.save();
  ctx.translate(16, 16);
  const stick = (len = 22) => {
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = dark; ctx.fillRect(-2, -len/2, 5, len);
    ctx.fillStyle = wood; ctx.fillRect(-2, -len/2, 4, len);
    ctx.rotate(-Math.PI / 4);
  };
  switch (id) {
    case ITEM.STICK: stick(26); break;
    case ITEM.COAL: case ITEM.CHARCOAL: {
      const col = id === ITEM.COAL ? '#2c2c2e' : '#4a3f38';
      ctx.fillStyle = col;
      for (const [x, y, r] of [[-3,-2,6],[4,2,5],[-1,5,4],[3,-5,4]]) {
        ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
      }
      ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.beginPath(); ctx.arc(-4, -4, 3, 0, 7); ctx.fill();
      break;
    }
    case ITEM.PICK:
      stick(24);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = dark; ctx.fillRect(-13, -13, 26, 6);
      ctx.fillStyle = head; ctx.fillRect(-12, -12, 24, 4);
      ctx.fillRect(-13, -11, 3, 6); ctx.fillRect(10, -11, 3, 6);
      break;
    case ITEM.AXE:
      stick(24);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = dark; ctx.fillRect(-13, -13, 14, 14);
      ctx.fillStyle = head; ctx.fillRect(-12, -12, 12, 12);
      ctx.fillStyle = dark; ctx.fillRect(-6, -6, 6, 6);
      break;
    case ITEM.SHOVEL:
      stick(24);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = dark; ctx.beginPath(); ctx.ellipse(0, -11, 6.4, 8.4, 0, 0, 7); ctx.fill();
      ctx.fillStyle = head; ctx.beginPath(); ctx.ellipse(0, -11, 5, 7, 0, 0, 7); ctx.fill();
      break;
    case ITEM.SWORD:
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = head; ctx.fillRect(-2.4, -16, 4.8, 20);
      ctx.beginPath(); ctx.moveTo(-2.4, -16); ctx.lineTo(0, -20); ctx.lineTo(2.4, -16); ctx.fill();
      ctx.fillStyle = dark; ctx.fillRect(-6, 3, 12, 3);
      ctx.fillStyle = wood; ctx.fillRect(-2, 5, 4, 8);
      break;
    case ITEM.FLINT:
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = '#777'; ctx.fillRect(-2, -6, 4, 18);
      ctx.fillStyle = '#f80'; ctx.fillRect(-2, -10, 4, 4);
      ctx.fillStyle = '#fd3'; ctx.fillRect(-1, -9, 2, 2);
      break;
    case ITEM.APPLE:
      ctx.fillStyle = '#c0392b'; ctx.beginPath(); ctx.arc(1, 3, 10, 0, 7); ctx.fill();
      ctx.fillStyle = '#e74c3c'; ctx.beginPath(); ctx.arc(-2, 1, 8, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.beginPath(); ctx.arc(-5, -2, 3, 0, 7); ctx.fill();
      ctx.fillStyle = '#6d4520'; ctx.fillRect(-1.5, -13, 3, 8);
      ctx.fillStyle = '#4caf50'; ctx.beginPath(); ctx.ellipse(6, -10, 5.5, 2.8, -0.5, 0, 7); ctx.fill();
      break;
  }
  ctx.restore();
}
