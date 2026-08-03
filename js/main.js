// ============ 主程序：WebGL 渲染 + 游戏循环 + UI ============
'use strict';

// ---------------- WebGL 基础 ----------------
const VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec2 aUV;
layout(location=2) in vec4 aCol;
uniform mat4 uProj, uView;
uniform float uTime;
uniform float uWaterFlag;
out vec2 vUV; out vec4 vCol; out float vDist;
void main(){
  vec3 p = aPos;
  if (uWaterFlag > 0.5)
    p.y += sin(uTime * 2.2 + p.x * 0.9 + p.z * 1.3) * 0.028;
  vec4 vp = uView * vec4(p, 1.0);
  vDist = length(vp.xyz);
  gl_Position = uProj * vp;
  vUV = aUV; vCol = aCol;
}`;

const FS = `#version 300 es
precision highp float;
in vec2 vUV; in vec4 vCol; in float vDist;
uniform sampler2D uTex;
uniform vec3 uSun;
uniform vec3 uFog; uniform float uFogNear; uniform float uFogFar;
uniform float uAlpha; uniform vec3 uEmis;
out vec4 outColor;
void main(){
  vec4 t = texture(uTex, vUV);
  if (t.a < 0.12) discard;
  float shade = vCol.r;
  vec3 c = t.rgb * (uSun * shade + uEmis);
  float fogF = clamp((vDist - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
  fogF = fogF * fogF;
  c = mix(c, uFog, fogF);
  outColor = vec4(c, t.a * uAlpha);
}`;

const LINE_VS = `#version 300 es
layout(location=0) in vec3 aPos;
uniform mat4 uProj, uView;
void main(){ gl_Position = uProj * uView * vec4(aPos, 1.0); }`;
const LINE_FS = `#version 300 es
precision highp float;
uniform vec4 uColor;
out vec4 o;
void main(){ o = uColor; }`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}
function program(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}

function mat4Perspective(fov, aspect, near, far) {
  const f = 1 / Math.tan(fov / 2), nf = 1 / (near - far);
  return new Float32Array([f/aspect,0,0,0, 0,f,0,0, 0,0,(far+near)*nf,-1, 0,0,2*far*near*nf,0]);
}
function mat4Look(eye, yaw, pitch) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const f = [sy*cp, sp, -cy*cp];
  const r = [cy, 0, sy];
  const u = [-sy*sp, cp, cy*sp];
  return new Float32Array([
    r[0], u[0], -f[0], 0,
    r[1], u[1], -f[1], 0,
    r[2], u[2], -f[2], 0,
    -(r[0]*eye[0]+r[1]*eye[1]+r[2]*eye[2]),
    -(u[0]*eye[0]+u[1]*eye[1]+u[2]*eye[2]),
     (f[0]*eye[0]+f[1]*eye[1]+f[2]*eye[2]), 1]);
}

// ---------------- 主状态 ----------------
const $ = s => document.querySelector(s);
const canvas = $('#game');
let gl, atlas, world, player, mesher;
let seed = 20260214;
let mode = 'creative';        // creative | survival
let gameTime = 36000;         // 0..120000 ticks；36000 ≈ 早上 8 点（t=0 为午夜）
const DAY_LEN = 120000;
let running = false, paused = false, deadShown = false;
let input = { f:0, b:0, l:0, r:0, jump:0, sprint:0, down:0 };
let lastWTime = 0;

const chunkMeshes = new Map(); // key -> {opq,trans,VAOs...}
let meshBudget = 4;
let wireVAO, wireIdxCount = 0, selVAO, selBuf, selIdxCount = 0;
let fogNear = 90, fogFar = 160;

// 增强模块状态
let viewMode = 0;   // 0=第一人称 1=第三人称身后 2=第三人称面前
let charR = null, heldR = null, skyR = null, sfx = null;
let swingT = 0;     // 破坏/使用摆动计时 0..1
let eatT = 0;       // 进食长按计时
let stepAcc = 0, lastGrounded = true;
let dmgFlash = 0;   // 受伤红屏计时

// 特效
let particles = [];
let drops = [];
const pPart = { pos: [], uv: [], col: [], idx: [] };
const pDrop = { pos: [], uv: [], col: [], idx: [] };
let vaoPart, vaoDrop, vaoPartN = 0, vaoDropN = 0;

// 破坏进度
const breaking = { x:0, y:0, z:0, t:0, total:1 };

// UI 状态
let uiOpen = null; // null | 'craft' | 'bag' | 'controls'
let bagCursor = null; // { id, n } 光标物品
let smeltBuf = { input: null, out: null };
let saveTimer = 0, fpsTimer = 0, fpsShown = 0, frameCount = 0;

// ---------------- 启动 ----------------
function initGL() {
  gl = canvas.getContext('webgl2', { antialias: true });
  if (!gl) { alert('需要 WebGL2 支持，请更换浏览器'); throw new Error('no webgl2'); }

  window.mainProg = program(gl, VS, FS);
  window.lineProg = program(gl, LINE_VS, LINE_FS);

  // 纹理
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); // canvas y 向下，必须翻转才能与 uv() 的 v=1-row 约定一致
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas.canvas);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); // 不开 mipmap，避免图块间颜色渗透
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  window.atlasTex = tex;

  // 线框盒
  const E = 0.003;
  const c = [ [0-E,0-E,0-E],[1+E,0-E,0-E],[1+E,0-E,1+E],[0-E,0-E,1+E],
              [0-E,1+E,0-E],[1+E,1+E,0-E],[1+E,1+E,1+E],[0-E,1+E,1+E] ];
  const edges = [0,1,1,2,2,3,3,0,4,5,5,6,6,7,7,4,0,4,1,5,2,6,3,7];
  const lp = [];
  for (const i of edges) lp.push(...c[i]);
  wireVAO = gl.createVertexArray();
  gl.bindVertexArray(wireVAO);
  const wb = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, wb);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(lp), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  wireIdxCount = edges.length;

  // 选中目标盒（带破坏进度纹理面，动态）
  selVAO = gl.createVertexArray();
  gl.bindVertexArray(selVAO);
  selBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, selBuf);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 12);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 20, 0); // 用 pos 的低三位当颜色不行——单独填充
  gl.bindVertexArray(null);
  selIdxCount = 0;

  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.CULL_FACE);
  gl.cullFace(gl.BACK);
}

// ---------------- 天空 / 雾 ----------------
function skyColors(t) {
  // t: 0..DAY_LEN
  const ang = t / DAY_LEN * Math.PI * 2;
  const sunH = Math.sin(ang - Math.PI * 0.5); // 正午最高
  const dayness = smooth01((sunH + 0.12) / 0.35);
  const dusk = Math.max(0, 1 - Math.abs(sunH + 0.05) * 6);
  const top = mix3([0.035,0.04,0.10], [0.36,0.62,0.95], dayness);
  const bot = mix3([0.05,0.055,0.12], [0.68,0.83,0.98], dayness);
  const orange = [0.98,0.55,0.28];
  for (let i = 0; i < 3; i++) bot[i] = bot[i] * (1 - dusk * 0.6) + orange[i] * dusk * 0.6;
  const fog = bot.map(v => v * 0.96);
  const sunAmb = mix3([0.13,0.15,0.24], [1,1,1], dayness);
  return { top, bot, fog, sunAmb, dayness, sunH };
}
function mix3(a, b, k) { return [a[0]+(b[0]-a[0])*k, a[1]+(b[1]-a[1])*k, a[2]+(b[2]-a[2])*k]; }
function smooth01(x) { x = Math.max(0, Math.min(1, x)); return x*x*(3-2*x); }

// ---------------- 网格管理 ----------------
function chunkKey(cx, cz) { return cx + ',' + cz; }

function uploadGeom(g, waterFlag) {
  if (!g || g.idx.length === 0) return null;
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const vb = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vb);
  // 交错: pos3 uv2 col4 -> 简化为三个缓冲
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(g.pos), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  const ub = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, ub);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(g.uv), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
  const cb = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, cb);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(g.col), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 0, 0);
  const ib = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(g.idx), gl.STATIC_DRAW);
  gl.bindVertexArray(null);
  return { vao, n: g.idx.length, bufs: [vb, ub, cb, ib] };
}

function deleteMesh(m) {
  if (!m) return;
  for (const part of [m.opq, m.trans]) {
    if (!part) continue;
    gl.deleteVertexArray(part.vao);
    for (const b of part.bufs) gl.deleteBuffer(b);
  }
}

function rebuildChunk(cx, cz) {
  const chunk = world.getChunk(cx, cz);
  if (!chunk || chunk.state < 1) return;
  const key = chunkKey(cx, cz);
  const old = chunkMeshes.get(key);
  if (old) deleteMesh(old);
  const geo = mesher.build(world, chunk);
  chunkMeshes.set(key, { opq: uploadGeom(geo.opq, 0), trans: uploadGeom(geo.trans, 1) });
}

function updateChunks() {
  const pcx = Math.floor(player.pos.x / CHUNK), pcz = Math.floor(player.pos.z / CHUNK);
  const R = 11;
  let genBudget = 3; // 每帧最多新装饰 3 个区块，避免卡顿
  // 生成：从内向外螺旋
  outer:
  for (let r = 0; r <= R; r++) {
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      const cx = pcx + dx, cz = pcz + dz;
      const c = world.getChunk(cx, cz);
      if (!c || c.state < 2) {
        if (genBudget-- <= 0) break outer;
        world.ensureDecorated(cx, cz);
      }
    }
  }
  // 重建脏块（有预算）
  let built = 0;
  for (const [, c] of world.chunks) {
    if (c.dirty.size === 0) continue;
    if (built >= meshBudget) break;
    if (Math.abs(c.cx - pcx) > R || Math.abs(c.cz - pcz) > R) continue;
    rebuildChunk(c.cx, c.cz);
    c.dirty.clear();
    built++;
  }
  // 删除远处网格
  for (const [key, m] of chunkMeshes) {
    const [cx, cz] = key.split(',').map(Number);
    if (Math.abs(cx - pcx) > R + 2 || Math.abs(cz - pcz) > R + 2) {
      deleteMesh(m);
      chunkMeshes.delete(key);
    }
  }
  meshBudget = 4;
}

// ---------------- 渲染 ----------------
function drawChunkPass(camMat, projMat, sun, fogC, emis) {
  const P = window.mainProg;
  gl.useProgram(P);
  gl.uniformMatrix4fv(gl.getUniformLocation(P, 'uProj'), false, projMat);
  gl.uniformMatrix4fv(gl.getUniformLocation(P, 'uView'), false, camMat);
  gl.uniform3fv(gl.getUniformLocation(P, 'uSun'), sun);
  gl.uniform3fv(gl.getUniformLocation(P, 'uFog'), fogC);
  gl.uniform1f(gl.getUniformLocation(P, 'uFogNear'), fogNear);
  gl.uniform1f(gl.getUniformLocation(P, 'uFogFar'), fogFar);
  gl.uniform3fv(gl.getUniformLocation(P, 'uEmis'), emis);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, window.atlasTex);
  gl.uniform1i(gl.getUniformLocation(P, 'uTex'), 0);
  gl.uniform1f(gl.getUniformLocation(P, 'uTime'), performance.now() / 1000);
}

function render() {
  const nw = Math.floor(innerWidth * (window.dpr || 1));
  const nh = Math.floor(innerHeight * (window.dpr || 1));
  if (canvas.width !== nw || canvas.height !== nh) { canvas.width = nw; canvas.height = nh; }
  const w = nw, h = nh;
  gl.viewport(0, 0, w, h);

  const sky = skyColors(gameTime % DAY_LEN);
  // 光照：环境光 + 定向光，夜间变暗蓝
  const d = sky.dayness;
  const sun = mix3([0.16, 0.18, 0.28], [1.08, 1.05, 0.98], d);
  const fogC = sky.fog;
  const emis = [0.05, 0.055, 0.09];

  gl.clearColor(sky.top[0], sky.top[1], sky.top[2], 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  // 相机（视角切换）
  const eye = computeCameraEye(viewMode, player, world);
  const projMat = mat4Perspective(1.32, w / h, 0.08, 400);
  const camMat = mat4Look([eye.x, eye.y, eye.z], player.yaw, player.pitch);

  // 天空（太阳/月亮/云）
  skyR.draw(projMat, camMat, eye, player.yaw, player.pitch, (gameTime % DAY_LEN) / DAY_LEN, sun);

  // 不透明
  drawChunkPass(camMat, projMat, sun, fogC, emis);
  gl.uniform1f(gl.getUniformLocation(window.mainProg, 'uAlpha'), 1);
  gl.uniform1f(gl.getUniformLocation(window.mainProg, 'uWaterFlag'), 0);
  gl.disable(gl.BLEND);
  for (const [, m] of chunkMeshes) if (m.opq) { gl.bindVertexArray(m.opq.vao); gl.drawElements(gl.TRIANGLES, m.opq.n, gl.UNSIGNED_INT, 0); }

  // 角色（第三人称）
  if (viewMode !== 0) charR.draw(projMat, camMat, player, sun);

  // 粒子 / 掉落物（不透明小方块，同 atlas）
  drawParticles(camMat, projMat, sun, fogC);

  // 选中框 + 破坏覆盖
  drawSelection(camMat, projMat);

  // 半透明
  drawChunkPass(camMat, projMat, sun, fogC, emis);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.depthMask(false);
  gl.uniform1f(gl.getUniformLocation(window.mainProg, 'uAlpha'), 1);
  gl.uniform1f(gl.getUniformLocation(window.mainProg, 'uWaterFlag'), 1);
  for (const [, m] of chunkMeshes) if (m.trans) { gl.bindVertexArray(m.trans.vao); gl.drawElements(gl.TRIANGLES, m.trans.n, gl.UNSIGNED_INT, 0); }
  gl.depthMask(true);
  gl.disable(gl.BLEND);

  // 第一人称手持物品
  if (viewMode === 0) {
    const held = inv.held();
    heldR.draw(projMat, held, swingT, player.walkPhase);
  }

  // 水下遮罩
  drawWaterOverlay(sky);
}

function drawWaterOverlay(sky) {
  if (overlayCv.width !== innerWidth || overlayCv.height !== innerHeight) {
    overlayCv.width = innerWidth; overlayCv.height = innerHeight;
  }
  const c2d = overlayCtx;
  c2d.clearRect(0, 0, overlayCv.width, overlayCv.height);
  if (player.eyeInWater()) {
    c2d.fillStyle = 'rgba(16,60,140,0.45)';
    c2d.fillRect(0, 0, overlayCv.width, overlayCv.height);
  }
  // 受伤红闪
  if (dmgFlash > 0) {
    c2d.fillStyle = `rgba(190,0,0,${Math.min(0.42, dmgFlash)})`;
    c2d.fillRect(0, 0, overlayCv.width, overlayCv.height);
  } else if (player.hp <= 6 && mode === 'survival' && !player.dead) {
    const g = c2d.createRadialGradient(overlayCv.width/2, overlayCv.height/2, overlayCv.height*0.32,
      overlayCv.width/2, overlayCv.height/2, overlayCv.height*0.72);
    g.addColorStop(0, 'rgba(160,0,0,0)');
    g.addColorStop(1, 'rgba(160,0,0,0.5)');
    c2d.fillStyle = g;
    c2d.fillRect(0, 0, overlayCv.width, overlayCv.height);
  }
  const t = (gameTime % DAY_LEN) / DAY_LEN;
  const dayness = sky.dayness;
  if (dayness < 0.45) {
    c2d.fillStyle = `rgba(8,10,30,${(0.45 - dayness) * 0.5})`;
    c2d.fillRect(0, 0, overlayCv.width, overlayCv.height);
  }
}

function drawSelection(camMat, projMat) {
  const hit = raycast(world, player.eye(), player.forward(), 5.5);
  if (!hit) { gl.bindVertexArray(null); return; }
  // 线框
  const L = window.lineProg;
  gl.useProgram(L);
  gl.uniformMatrix4fv(gl.getUniformLocation(L, 'uProj'), false, projMat);
  const eye = player.eye();
  const vm = mat4Look([eye.x - hit.x, eye.y - hit.y, eye.z - hit.z], player.yaw, player.pitch);
  gl.uniformMatrix4fv(gl.getUniformLocation(L, 'uView'), false, vm);
  gl.uniform4f(gl.getUniformLocation(L, 'uColor'), 0.05, 0.05, 0.05, 1);
  gl.bindVertexArray(wireVAO);
  gl.drawArrays(gl.LINES, 0, wireIdxCount);

  // 破坏进度覆盖（生存模式）
  if (mode === 'survival' && breaking.t > 0.05 && breaking.x === hit.x && breaking.y === hit.y && breaking.z === hit.z) {
    const crackAlpha = buildCrackQuad(hit);
    const P = window.mainProg;
    gl.useProgram(P);
    gl.uniformMatrix4fv(gl.getUniformLocation(P, 'uProj'), false, projMat);
    gl.uniformMatrix4fv(gl.getUniformLocation(P, 'uView'), false, vm);
    gl.uniform3f(gl.getUniformLocation(P, 'uSun'), 0, 0, 0);
    gl.uniform3f(gl.getUniformLocation(P, 'uFog'), 0, 0, 0);
    gl.uniform1f(gl.getUniformLocation(P, 'uFogNear'), 1);
    gl.uniform1f(gl.getUniformLocation(P, 'uFogFar'), 2);
    gl.uniform3f(gl.getUniformLocation(P, 'uEmis'), 0, 0, 0);
    gl.uniform1f(gl.getUniformLocation(P, 'uAlpha'), crackAlpha);
    gl.uniform1f(gl.getUniformLocation(P, 'uWaterFlag'), 0);
    gl.bindVertexArray(selVAO);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.drawArrays(gl.TRIANGLES, 0, selIdxCount);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }
  gl.bindVertexArray(null);
}

function buildCrackQuad(hit) {
  // 用主贴图最右上一块"暗色"拼出裂纹：直接用纯黑半透明 quad 覆盖朝向玩家的面
  const eye = player.eye();
  let fx = Math.sign(Math.round(eye.x - (hit.x + 0.5))) || 0;
  let fy = Math.sign(Math.round(eye.y - (hit.y + 0.5))) || 0;
  let fz = Math.sign(Math.round(eye.z - (hit.z + 0.5))) || 0;
  if (fx === 0 && fy === 0 && fz === 0) fy = 1;
  // 选主轴
  const ax = Math.abs(eye.x - (hit.x + 0.5)), ay = Math.abs(eye.y - (hit.y + 0.5)), az = Math.abs(eye.z - (hit.z + 0.5));
  fx = fy = fz = 0;
  if (ax >= ay && ax >= az) fx = Math.sign(eye.x - (hit.x + 0.5));
  else if (ay >= az) fy = Math.sign(eye.y - (hit.y + 0.5));
  else fz = Math.sign(eye.z - (hit.z + 0.5));

  const E = 0.006;
  let q;
  if (fy === 1) q = [[-E,1+E,-E],[1+E,1+E,-E],[1+E,1+E,1+E],[-E,1+E,1+E]];
  else if (fy === -1) q = [[-E,-E,-E],[1+E,-E,-E],[1+E,-E,1+E],[-E,-E,1+E]];
  else if (fx === 1) q = [[1+E,-E,-E],[1+E,-E,1+E],[1+E,1+E,1+E],[1+E,1+E,-E]];
  else if (fx === -1) q = [[-E,-E,-E],[-E,-E,1+E],[-E,1+E,1+E],[-E,1+E,-E]];
  else if (fz === 1) q = [[-E,-E,1+E],[1+E,-E,1+E],[1+E,1+E,1+E],[-E,1+E,1+E]];
  else q = [[-E,-E,-E],[1+E,-E,-E],[1+E,1+E,-E],[-E,1+E,-E]];
  const idx = [0,1,2,0,2,3];
  const data = [];
  const frac = Math.min(1, breaking.t / breaking.total);
  for (const i of idx) data.push(q[i][0], q[i][1], q[i][2], 0, 0, 0.08, 0.08, 0.08, 1);
  gl.bindVertexArray(selVAO);
  gl.bindBuffer(gl.ARRAY_BUFFER, selBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.DYNAMIC_DRAW);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 36, 0);
  gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 36, 12);
  gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 36, 20);
  selIdxCount = 6;
  return 0.15 + frac * 0.55; // alpha 随进度增强
}

// ---------------- 粒子 / 掉落物 ----------------
function spawnBlockParticles(x, y, z, id) {
  const def = BLOCKS[id];
  const tile = def.cross ? def.tex[0] : def.tex[2];
  const [u0, v0, u1, v1] = atlas.uv(tile);
  for (let i = 0; i < 12; i++) {
    particles.push({
      x: x + Math.random(), y: y + Math.random(), z: z + Math.random(),
      vx: (Math.random() - 0.5) * 4.5, vy: Math.random() * 5.2, vz: (Math.random() - 0.5) * 4.5,
      u: u0 + Math.random() * (u1 - u0), v: v0 + Math.random() * (v1 - v0),
      life: 0.5 + Math.random() * 0.4,
    });
  }
}

function spawnDrop(id, x, y, z) {
  drops.push({ id, x, y, z, vx: (Math.random()-0.5)*1.6, vy: 3 + Math.random()*1.4, vz: (Math.random()-0.5)*1.6, t: 0 });
}

function updateEffects(dt) {
  // 粒子
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.vy -= 16 * dt;
    p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    if (BLOCKS[world.getBlock(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z))].solid) {
      p.vy *= -0.3; p.vx *= 0.6; p.vz *= 0.6;
      p.y += p.vy * dt * 2;
    }
    p.life -= dt;
    if (p.life <= 0) particles.splice(i, 1);
  }
  // 掉落物
  for (let i = drops.length - 1; i >= 0; i--) {
    const d = drops[i];
    d.t += dt;
    d.vy -= 18 * dt;
    d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
    d.vx *= 0.98; d.vz *= 0.98;
    if (BLOCKS[world.getBlock(Math.floor(d.x), Math.floor(d.y - 0.1), Math.floor(d.z))].solid) {
      if (d.vy < 0) d.vy = 0;
      d.y = Math.floor(d.y - 0.1) + 1.02;
    }
    // 拾取
    const dx = d.x - player.pos.x, dy = d.y - (player.pos.y + 0.9), dz = d.z - player.pos.z;
    if (d.t > 0.4 && dx*dx + dy*dy + dz*dz < 1.7) {
      const left = inv.add(d.id, 1);
      if (left === 0) {
        drops.splice(i, 1);
        toast(`拾取 ${itemName(d.id)}`);
        sfx.pickup();
      }
    }
    if (d.t > 90) drops.splice(i, 1);
  }
}

function drawParticles(camMat, projMat, sun, fogC) {
  // 粒子
  pPart.pos.length = 0; pPart.uv.length = 0; pPart.col.length = 0; pPart.idx.length = 0;
  for (const p of particles) {
    const size = 0.075;
    const du = 0.008, dv = 0.008;
    const quads = [[true], [false]];
    for (const [xy] of quads) {
      const base = pPart.pos.length / 3;
      if (xy) {
        pPart.pos.push(p.x-size,p.y-size,p.z, p.x+size,p.y-size,p.z, p.x+size,p.y+size,p.z, p.x-size,p.y+size,p.z);
      } else {
        pPart.pos.push(p.x,p.y-size,p.z-size, p.x,p.y-size,p.z+size, p.x,p.y+size,p.z+size, p.x,p.y+size,p.z-size);
      }
      pPart.uv.push(p.u-du,p.v-dv, p.u+du,p.v-dv, p.u+du,p.v+dv, p.u-du,p.v+dv);
      pPart.col.push(1,1,1,0, 1,1,1,0, 1,1,1,0, 1,1,1,0);
      pPart.idx.push(base, base+1, base+2, base, base+2, base+3);
    }
  }
  // 掉落物
  pDrop.pos.length = 0; pDrop.uv.length = 0; pDrop.col.length = 0; pDrop.idx.length = 0;
  const t = performance.now() / 1000;
  for (const d of drops) {
    const def = BLOCKS[d.id];
    const tile = def.cross ? def.tex[0] : def.tex[2];
    const [u0, v0, u1, v1] = atlas.uv(tile);
    const size = 0.16;
    const bob = Math.sin(t * 3 + d.x * 5) * 0.06;
    for (const xy of [true, false]) {
      const base = pDrop.pos.length / 3;
      const y = d.y + bob;
      if (xy) {
        pDrop.pos.push(d.x-size,y-size,d.z, d.x+size,y-size,d.z, d.x+size,y+size,d.z, d.x-size,y+size,d.z);
      } else {
        pDrop.pos.push(d.x,y-size,d.z-size, d.x,y-size,d.z+size, d.x,y+size,d.z+size, d.x,y+size,d.z-size);
      }
      pDrop.uv.push(u0,v0, u1,v0, u1,v1, u0,v1);
      pDrop.col.push(1,1,1,0, 1,1,1,0, 1,1,1,0, 1,1,1,0);
      pDrop.idx.push(base, base+1, base+2, base, base+2, base+3);
    }
  }
  const P = window.mainProg;
  gl.useProgram(P);
  gl.uniformMatrix4fv(gl.getUniformLocation(P, 'uProj'), false, projMat);
  gl.uniformMatrix4fv(gl.getUniformLocation(P, 'uView'), false, camMat);
  gl.uniform3fv(gl.getUniformLocation(P, 'uSun'), sun);
  gl.uniform3f(gl.getUniformLocation(P, 'uFog'), fogC[0], fogC[1], fogC[2]);
  gl.uniform1f(gl.getUniformLocation(P, 'uFogNear'), fogNear * 2);
  gl.uniform1f(gl.getUniformLocation(P, 'uFogFar'), fogFar * 3);
  gl.uniform3f(gl.getUniformLocation(P, 'uEmis'), 0.05, 0.05, 0.08);
  gl.uniform1f(gl.getUniformLocation(P, 'uAlpha'), 1);
  gl.uniform1f(gl.getUniformLocation(P, 'uWaterFlag'), 0);
  gl.disable(gl.CULL_FACE);
  for (const [geom, key] of [[pPart, 'p'], [pDrop, 'd']]) {
    if (geom.idx.length === 0) continue;
    let vao = key === 'p' ? vaoPart : vaoDrop;
    if (!vao) {
      vao = gl.createVertexArray();
      vao.__vb = gl.createBuffer(); vao.__ub = gl.createBuffer(); vao.__cb = gl.createBuffer(); vao.__ib = gl.createBuffer();
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, vao.__vb);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, vao.__ub);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, vao.__cb);
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, vao.__ib);
      if (key === 'p') vaoPart = vao; else vaoDrop = vao;
    }
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vao.__vb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(geom.pos), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, vao.__ub);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(geom.uv), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, vao.__cb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(geom.col), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, vao.__ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(geom.idx), gl.DYNAMIC_DRAW);
    gl.drawElements(gl.TRIANGLES, geom.idx.length, gl.UNSIGNED_INT, 0);
  }
  gl.enable(gl.CULL_FACE);
}

// ---------------- 交互：破坏 / 放置 ----------------
function currentTool() {
  const s = inv.held();
  return s && s.id >= 100 ? ITEMS[s.id] : null;
}

let warnT = 0;
function tryBreak() {
  const hit = raycast(world, player.eye(), player.forward(), 5.5);
  if (!hit) return false;
  const def = BLOCKS[hit.id];
  if (!def.breakable) return false;
  const tool = currentTool();

  if (mode === 'creative') {
    doBreak(hit);
    return true;
  }
  // 生存：工具与进度（石头/矿石必须用对应工具）
  if (def.needTool && (!tool || tool.tool !== def.req)) {
    if (performance.now() - warnT > 900) {
      toast(`需要${def.req === 'pick' ? '镐' : def.req === 'axe' ? '斧' : '铲'}才能采集 ${def.name}`);
      warnT = performance.now();
    }
    return false;
  }
  const speed = (tool && tool.tool === def.req) ? tool.speed : (tool && tool.tool === 'sword' ? 1.6 : 1);
  breaking.total = def.hard / speed;
  breaking.x = hit.x; breaking.y = hit.y; breaking.z = hit.z;
  return 'holding';
}

function doBreak(hit) {
  const def = BLOCKS[hit.id];
  world.setBlock(hit.x, hit.y, hit.z, B.AIR);
  spawnBlockParticles(hit.x, hit.y, hit.z, hit.id);
  if (mode === 'survival') {
    if (hit.id === B.LEAVES) {
      if (Math.random() < 0.12) spawnDrop(ITEM.APPLE, hit.x + 0.5, hit.y + 0.3, hit.z + 0.5);
    } else if (def.drop != null) {
      spawnDrop(def.drop, hit.x + 0.5, hit.y + 0.3, hit.z + 0.5);
    }
  }
  breaking.t = 0;
  swingT = 1;
  sfx.dig();
}

function tryPlace(interact) {
  const hit = raycast(world, player.eye(), player.forward(), 5.5);
  if (!hit) return;
  // 右键点燃 TNT
  if (hit.id === B.TNT && interact) {
    const s = inv.held();
    if (mode === 'creative' || (s && s.id === ITEM.FLINT)) {
      igniteTNT(hit.x, hit.y, hit.z);
      return;
    }
  }
  if (mode === 'creative' && interact && hit.id === B.TNT) return;
  const s = inv.held();
  if (!s) return;
  const px = hit.x + hit.nx, py = hit.y + hit.ny, pz = hit.z + hit.nz;
  if (py < 1 || py >= WHEIGHT - 1) return;
  const cur = world.getBlock(px, py, pz);
  if (cur !== B.AIR && !BLOCKS[cur].fluid && !BLOCKS[cur].cross) return;
  if (s.id >= 100) return; // 物品不能放置
  // 不能放进玩家身体
  const def = BLOCKS[s.id];
  if (def.solid && blockIntersectsPlayer(px, py, pz)) return;
  world.setBlock(px, py, pz, s.id);
  swingT = 1;
  sfx.place();
  if (mode === 'survival') {
    s.n--;
    if (s.n <= 0) inv.hotbar[inv.sel] = null;
    refreshHotbar();
  }
}

function blockIntersectsPlayer(x, y, z) {
  const p = player.pos;
  return x < p.x + P_HALF_W && x + 1 > p.x - P_HALF_W &&
         y < p.y + P_HEIGHT && y + 1 > p.y &&
         z < p.z + P_HALF_W && z + 1 > p.z - P_HALF_W;
}

function igniteTNT(x, y, z) {
  world.setBlock(x, y, z, B.AIR, { quiet: true });
  world.scheduleTNT(x, y, z, 1.6);
  toast('嘶嘶嘶… 💣');
  sfx.fizz();
}

function explode(x, y, z, power) {
  const r = power;
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
    if (dx*dx + dy*dy + dz*dz > r * r + 1) continue;
    const wx = x + dx, wy = y + dy, wz = z + dz;
    const id = world.getBlock(wx, wy, wz);
    const def = BLOCKS[id];
    if (id === B.AIR || id === B.BEDROCK || def.fluid) continue;
    if (id === B.TNT) { world.setBlock(wx, wy, wz, B.AIR, { quiet: true }); world.scheduleTNT(wx, wy, wz, 0.12 + Math.random() * 0.35); continue; }
    world.setBlock(wx, wy, wz, B.AIR, { quiet: true });
    if (Math.random() < 0.4) spawnBlockParticles(wx, wy, wz, id);
  }
  sfx.boom();
  spawnBlockParticles(x, y, z, B.COBBLE);
  for (let i = 0; i < 20; i++) particles.push({
    x: x + (Math.random()-0.5), y: y + (Math.random()-0.5), z: z + (Math.random()-0.5),
    vx: (Math.random()-0.5) * 9, vy: Math.random() * 9, vz: (Math.random()-0.5) * 9,
    u: 0.9, v: 0.9, life: 0.7,
  });
  // 玩家伤害
  const dx = player.pos.x - x, dy = player.pos.y + 0.9 - y, dz = player.pos.z - z;
  const dist = Math.hypot(dx, dy, dz);
  if (dist < r + 3.5 && mode === 'survival') {
    const dmg = Math.round((r + 3.5 - dist) * 2.2);
    if (dmg > 0) player.damage(dmg, 'tnt');
  }
}

// ---------------- 输入 ----------------
let mouseL = false, mouseR = false;
let lastSpaceTime = 0;

function setupInput() {
  document.addEventListener('keydown', e => {
    if (!running) return;
    if (e.code === 'Escape') { e.preventDefault(); if (uiOpen) closeUI(); else togglePause(); return; }
    if (uiOpen) { uiKey(e); return; }
    if (paused || player.dead) return;
    switch (e.code) {
      case 'KeyW': input.f = 1;
        if (!e.repeat && performance.now() - lastWTime < 280) input.sprint = 1;
        if (!e.repeat) lastWTime = performance.now(); break;
      case 'KeyS': input.b = 1; break;
      case 'KeyA': input.l = 1; break;
      case 'KeyD': input.r = 1; break;
      case 'Space': input.jump = 1; e.preventDefault();
        if (!e.repeat && player.onGround) sfx.jump();
        if (mode === 'creative') {
          const now = performance.now();
          if (now - lastSpaceTime < 280) {
            player.flying = !player.flying;
            player.vel.y = 0;
            toast(player.flying ? '飞行开启（C 下降）' : '飞行关闭');
          }
          lastSpaceTime = now;
        }
        break;
      case 'ShiftLeft': case 'ShiftRight': input.sprint = 1; break;
      case 'KeyC': input.down = 1; break;
      case 'Digit1': case 'Digit2': case 'Digit3': case 'Digit4': case 'Digit5':
      case 'Digit6': case 'Digit7': case 'Digit8': case 'Digit9':
        inv.sel = +e.code.slice(5) - 1; refreshHotbar(); sfx.click(); break;
      case 'KeyF': toggleMode(); break;
      case 'KeyV': viewMode = (viewMode + 1) % 3;
        toast(['第一人称视角', '第三人称（身后）', '第三人称（正面）'][viewMode]); sfx.click(); break;
      case 'KeyT': openUI('craft'); break;
      case 'KeyE': case 'KeyB': openUI(mode === 'creative' ? 'bag' : 'craft'); break;
    }
  });
  document.addEventListener('keyup', e => {
    switch (e.code) {
      case 'KeyW': input.f = 0; input.sprint = 0; break;
      case 'KeyS': input.b = 0; break;
      case 'KeyA': input.l = 0; break;
      case 'KeyD': input.r = 0; break;
      case 'Space': input.jump = 0; break;
      case 'ShiftLeft': case 'ShiftRight': input.sprint = 0; break;
      case 'KeyC': input.down = 0; break;
    }
  });

  canvas.addEventListener('mousedown', e => {
    if (!running || uiOpen || paused || player.dead) return;
    if (document.pointerLockElement !== canvas) { canvas.requestPointerLock(); return; }
    if (e.button === 0) { mouseL = true; }
    else if (e.button === 2) {
      mouseR = true;
      const held = inv.held();
      if (held && held.id === ITEM.APPLE && mode === 'survival' && player.food < 20) {
        eatT = 0.001; // 开始长按进食
      } else {
        tryPlace(true);
      }
    }
    else if (e.button === 1) { // 中键：创造模式取方块
      e.preventDefault();
      if (mode === 'creative') {
        const hit = raycast(world, player.eye(), player.forward(), 5.5);
        if (hit && hit.id !== B.AIR) { inv.hotbar[inv.sel] = { id: hit.id, n: 1 }; refreshHotbar(); }
      }
    }
  });
  canvas.addEventListener('mouseup', e => {
    if (e.button === 0) { mouseL = false; breaking.t = 0; }
    if (e.button === 2) { mouseR = false; eatT = 0; }
  });
  document.addEventListener('mousemove', e => {
    if (document.pointerLockElement !== canvas || paused || uiOpen || player.dead) return;
    player.yaw += e.movementX * 0.0026;
    player.pitch -= e.movementY * 0.0026;
    const lim = Math.PI / 2 - 0.01;
    player.pitch = Math.max(-lim, Math.min(lim, player.pitch));
  });
  document.addEventListener('wheel', e => {
    if (!running || uiOpen) return;
    if (bagCursor) {
      const d = e.deltaY > 0 ? -1 : 1;
      bagCursor.n = Math.max(1, Math.min(inv.maxStack(bagCursor.id), bagCursor.n + d));
      renderCraftUI();
      return;
    }
    inv.sel = (inv.sel + (e.deltaY > 0 ? 1 : 8)) % 9;
    refreshHotbar();
    sfx.click();
  }, { passive: true });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement !== canvas && running && !uiOpen && !paused && !player.dead) {
      togglePause(true);
    }
  });

  // 界面点击
  $('#btn-close-craft').onclick = closeUI;
  $('#btn-close-ctl').onclick = closeUI;
  $('#crafting').addEventListener('mousedown', e => { if (e.target === $('#crafting')) closeUI(); });
  $('#controls').addEventListener('mousedown', e => { if (e.target === $('#controls')) closeUI(); });
  document.querySelectorAll('.tab').forEach(b => b.onclick = () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.toggle('on', x === b));
    $('#tab-craft').classList.toggle('hidden', b.dataset.tab !== 'craft');
    $('#tab-cook').classList.toggle('hidden', b.dataset.tab !== 'cook');
  });
}

function uiKey(e) {
  if (e.code === 'Escape') { closeUI(); return; }
  if (e.code === 'KeyT' || e.code === 'KeyE' || e.code === 'KeyB') { closeUI(); }
}

// ---------------- UI ----------------
let toastTimer = null;
function toast(msg) {
  const el = $('#hint-line');
  el.textContent = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.textContent = '左键破坏 · 右键放置 · F 切换模式 · T 合成'; }, 2600);
}

function iconURL(id) { return iconCanvas(id, atlas).toDataURL(); }

function renderHotbar() {
  document.querySelectorAll('.hslot').forEach((el, i) => {
    const s = inv.hotbar[i];
    const it = el.querySelector('.it'), cnt = el.querySelector('.cnt');
    if (s) {
      it.style.backgroundImage = `url(${iconURL(s.id)})`;
      cnt.textContent = s.n > 1 ? s.n : '';
    } else { it.style.backgroundImage = ''; cnt.textContent = ''; }
    el.classList.toggle('sel', i === inv.sel);
  });
}
function refreshHotbar() { renderHotbar(); }

function updateHUD() {
  // 心
  document.querySelectorAll('#hearts .hb').forEach((el, i) => {
    const hp = Math.max(0, Math.min(2, player.hp - i * 2));
    el.style.setProperty('--hp', hp / 2);
    el.style.opacity = player.hp > i * 2 ? 1 : 0.25;
  });
  // 饥饿
  document.querySelectorAll('#food span').forEach((el, i) => {
    el.classList.toggle('off', player.food <= i);
  });
  const survLike = mode === 'survival';
  $('#hearts').style.visibility = survLike ? 'visible' : 'hidden';
  $('#food').style.visibility = survLike ? 'visible' : 'hidden';
  // 时钟
  const t = gameTime % DAY_LEN;
  const day = Math.floor(gameTime / DAY_LEN) + 1;
  const night = t > DAY_LEN * 0.5;
  $('#clock-icon').textContent = night ? '🌙' : '☀️';
  $('#clock-day').textContent = `第 ${day} 天 · ${night ? '夜晚' : '白天'}`;
  $('#pos-line').textContent = `XYZ: ${player.pos.x.toFixed(1)} / ${player.pos.y.toFixed(1)} / ${player.pos.z.toFixed(1)}`;
  $('#fps-line').textContent = `${fpsShown} FPS · ${world.chunks.size} 区块`;
  $('#mode-label').textContent = mode === 'creative' ? '创造模式' : '生存模式';
}

// ---- 合成界面 ----
function openUI(kind) {
  uiOpen = kind;
  document.exitPointerLock();
  $('#crafting').classList.toggle('hidden', kind !== 'craft' && kind !== 'bag');
  $('#controls').classList.toggle('hidden', kind !== 'controls');
  if (kind === 'craft' || kind === 'bag') renderCraftUI();
}
function closeUI() {
  // 光标物品放回背包
  if (bagCursor) { inv.add(bagCursor.id, bagCursor.n); bagCursor = null; }
  uiOpen = null;
  $('#crafting').classList.add('hidden');
  $('#controls').classList.add('hidden');
  renderCraftUI();
  refreshHotbar();
  if (running && !paused && !player.dead) canvas.requestPointerLock();
}

function slotEl(id, n, title) {
  const d = document.createElement('div');
  d.className = 'slot';
  d.title = title || itemName(id);
  const it = document.createElement('div'); it.className = 'it';
  it.style.backgroundImage = `url(${iconURL(id)})`;
  const cnt = document.createElement('div'); cnt.className = 'cnt';
  cnt.textContent = n > 1 ? n : '';
  d.append(it, cnt);
  return d;
}

function renderCraftUI() {
  if (!uiOpen || (uiOpen !== 'craft' && uiOpen !== 'bag')) return;
  // 配方 / 创造取物
  const box = $('#recipes');
  box.innerHTML = '';
  if (mode === 'creative') {
    for (const id of CREATIVE_BLOCKS.concat([ITEM.PICK, ITEM.AXE, ITEM.SHOVEL, ITEM.SWORD, ITEM.FLINT, ITEM.STICK, ITEM.COAL, ITEM.CHARCOAL])) {
      const el = document.createElement('div');
      el.className = 'recipe can';
      el.innerHTML = `<div class="r-item"><div class="it" style="background-image:url(${iconURL(id)})"></div></div>
        <div><div class="r-name">${itemName(id)}</div><div class="r-cost">点击放入选中快捷栏</div></div>`;
      el.onclick = () => {
        inv.hotbar[inv.sel] = { id, n: isBlockItem(id) ? 99 : 1 };
        refreshHotbar();
        toast(`已获得 ${itemName(id)}`);
      };
      box.appendChild(el);
    }
  } else {
    for (const r of RECIPES) {
    const can = r.cost.every(([id, n]) => inv.count(id) >= n);
    const el = document.createElement('div');
    el.className = 'recipe ' + (can ? 'can' : 'no');
    el.innerHTML = `<div class="r-item"><div class="it" style="background-image:url(${iconURL(r.out[0])})"></div>${r.out[1] ? `<div class="cnt">${r.out[1]}</div>` : ''}</div>
      <div><div class="r-name">${r.name}</div><div class="r-cost">${r.cost.map(([id, n]) => `${itemName(id)}×${n}`).join(' + ') || '熔炼（需煤炭）'}</div></div>
      <div class="r-arrow">⬅</div>`;
    el.onclick = () => {
      if (!can) { toast('材料不足'); return; }
      for (const [id, n] of r.cost) inv.take(id, n);
      inv.add(r.out[0], r.out[1]);
      toast(`已合成 ${r.name}`);
      renderCraftUI(); refreshHotbar();
    };
    box.appendChild(el);
    }
  }
  // 背包（含快捷栏）
  const bag = $('#craft-bag');
  bag.innerHTML = '';
  const all = inv.allSlots();
  all.forEach((s, i) => {
    if (!s) {
      const d = document.createElement('div'); d.className = 'slot';
      d.onclick = () => { if (bagCursor) putCursor(i); };
      bag.appendChild(d);
      return;
    }
    const el = slotEl(s.id, s.n);
    el.onclick = () => {
      const arr = i < 9 ? inv.hotbar : inv.bag;
      const idx = i < 9 ? i : i - 9;
      if (bagCursor) {
        if (bagCursor.id === s.id) {
          const add = Math.min(inv.maxStack(s.id) - s.n, bagCursor.n);
          s.n += add; bagCursor.n -= add;
          if (bagCursor.n <= 0) bagCursor = null;
        } else { const t = arr[idx]; arr[idx] = bagCursor; bagCursor = t; }
      } else {
        bagCursor = s; arr[idx] = null;
      }
      renderCraftUI(); refreshHotbar();
    };
    el.oncontextmenu = e => {
      e.preventDefault();
      if (!bagCursor) {
        bagCursor = { id: s.id, n: 1 };
        s.n--; if (s.n <= 0) { const arr = i < 9 ? inv.hotbar : inv.bag; arr[i < 9 ? i : i - 9] = null; }
      } else if (bagCursor.id === s.id && s.n < inv.maxStack(s.id)) {
        s.n++; bagCursor.n--;
        if (bagCursor.n <= 0) bagCursor = null;
      }
      renderCraftUI(); refreshHotbar();
    };
    bag.appendChild(el);
  });
  // 熔炼
  renderSmelt();
}

function putCursor(i) {
  const arr = i < 9 ? inv.hotbar : inv.bag;
  const idx = i < 9 ? i : i - 9;
  arr[idx] = bagCursor; bagCursor = null;
  renderCraftUI(); refreshHotbar();
}

function renderSmelt() {
  const inEl = $('#smelt-input'), outEl = $('#smelt-out');
  inEl.querySelector('.it').style.backgroundImage = smeltBuf.input ? `url(${iconURL(smeltBuf.input.id)})` : '';
  inEl.querySelector('.cnt').textContent = smeltBuf.input ? smeltBuf.input.n : '';
  outEl.querySelector('.it').style.backgroundImage = smeltBuf.out ? `url(${iconURL(smeltBuf.out.id)})` : '';
  outEl.querySelector('.cnt').textContent = smeltBuf.out ? smeltBuf.out.n : '';
  const st = $('#smelt-status');
  if (!smeltBuf.input) st.textContent = '把原料（沙子 / 圆石 / 原木）从背包点击放入左侧“原料”格。';
  else if (!SMELT_MAP[smeltBuf.input.id]) st.textContent = '该物品无法熔炼。';
  else if (inv.count(ITEM.COAL) < 1 && inv.count(ITEM.CHARCOAL) < 1) st.textContent = '缺少燃料（煤炭 / 木炭）。';
  else st.textContent = `熔炼中：${itemName(smeltBuf.input.id)} → ${itemName(SMELT_MAP[smeltBuf.input.id])}…`;
}

function setupCraftEvents() {
  $('#smelt-input').onclick = () => {
    if (bagCursor) {
      if (smeltBuf.input && smeltBuf.input.id !== bagCursor.id) return;
      if (!SMELT_MAP[bagCursor.id]) { toast('无法熔炼'); return; }
      if (!smeltBuf.input) smeltBuf.input = { id: bagCursor.id, n: 0 };
      smeltBuf.input.n += bagCursor.n; bagCursor = null;
      renderCraftUI();
    } else if (smeltBuf.input) {
      bagCursor = smeltBuf.input; smeltBuf.input = null;
      renderCraftUI();
    }
  };
  $('#smelt-out').onclick = () => {
    if (smeltBuf.out) {
      const left = inv.add(smeltBuf.out.id, smeltBuf.out.n);
      if (left === 0) smeltBuf.out = null; else smeltBuf.out.n = left;
      renderCraftUI(); refreshHotbar();
    }
  };
}

let smeltTick = 0;
function tickSmelt(dt) {
  if (!smeltBuf.input || !SMELT_MAP[smeltBuf.input.id]) return;
  const fuel = inv.count(ITEM.COAL) > 0 ? ITEM.COAL : ITEM.CHARCOAL;
  if (inv.count(fuel) < 1) return;
  smeltTick += dt;
  if (smeltTick >= 1.2) {
    smeltTick = 0;
    smeltBuf.input.n--;
    inv.take(fuel, 1);
    const out = SMELT_MAP[smeltBuf.input.id];
    if (!smeltBuf.out) smeltBuf.out = { id: out, n: 0 };
    smeltBuf.out.n++;
    if (smeltBuf.input.n <= 0) smeltBuf.input = null;
    if (uiOpen === 'craft' || uiOpen === 'bag') renderSmelt();
  }
}

// ---------------- 游戏流程 ----------------
function newGame(m) {
  mode = m;
  seed = (Math.random() * 0x7fffffff) | 0;
  world = new World(new TerrainGen(seed));
  player = new Player(world);
  inv = new Inventory();
  particles = []; drops = [];
  for (const mesh of chunkMeshes.values()) deleteMesh(mesh);
  chunkMeshes.clear();
  gameTime = 36000;
  if (m === 'survival') {
    // 生存模式白手起家
  } else {
    CREATIVE_BLOCKS.slice(0, 9).forEach((id, i) => { if (i < 9) inv.hotbar[i] = { id, n: 1 }; });
  }
  // 出生点
  spawnPlayer();
  startGame();
}

function spawnPlayer() {
  let sx = 8, sz = 8, sy = 0;
  for (let r = 0; r < 6; r++) {
    const x = 8 + ((Math.random() - 0.5) * 2 * r * 24) | 0;
    const z = 8 + ((Math.random() - 0.5) * 2 * r * 24) | 0;
    world.ensureDecorated(Math.floor(x / CHUNK), Math.floor(z / CHUNK));
    const y = world.surfaceAt(x, z);
    if (world.getBlock(x, y - 1, z) !== B.WATER && y < WHEIGHT - 4) {
      sx = x; sz = z; sy = y; break;
    }
  }
  if (!sy) sy = world.surfaceAt(8, 8);
  // 预生成出生点周围 5x5 区块，避免落地穿模
  const pcx = Math.floor(sx / CHUNK), pcz = Math.floor(sz / CHUNK);
  for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) world.ensureDecorated(pcx + dx, pcz + dz);
  sy = world.surfaceAt(sx, sz);
  player.teleport(sx + 0.5, sy + 0.1, sz + 0.5);
}

function startGame() {
  running = true; paused = false; deadShown = false;
  player.hp = 20; player.dead = false;
  if (player.food === undefined) player.food = 20;
  breaking.t = 0;
  dmgFlash = 0;
  player.onDamage = (n, cause) => {
    dmgFlash = Math.min(0.5, 0.18 + n * 0.05);
    sfx.hurt();
    if (cause === 'fall') toast('摔得好疼！');
  };
  $('#menu').classList.add('hidden');
  $('#pause').classList.add('hidden');
  $('#death').classList.add('hidden');
  $('#hud').classList.remove('hidden');
  refreshHotbar();
  canvas.requestPointerLock();
  saveTimer = 0;
}

function togglePause(force) {
  if (!running || player.dead) return;
  paused = force === undefined ? !paused : force;
  $('#pause').classList.toggle('hidden', !paused);
  if (!paused) canvas.requestPointerLock(); else document.exitPointerLock();
}

function toggleMode() {
  mode = mode === 'creative' ? 'survival' : 'creative';
  if (mode === 'creative') {
    player.flying = true;
    player.hp = 20;
    CREATIVE_BLOCKS.slice(0, 9).forEach((id, i) => { inv.hotbar[i] = { id, n: 1 }; });
    inv.bag.fill(null);
  } else {
    player.flying = false;
    inv.hotbar.fill(null); inv.bag.fill(null);
  }
  refreshHotbar();
  toast(mode === 'creative' ? '创造模式：飞行开启，双击跳/蹲(C)升降' : '生存模式：小心！');
}

function die() {
  if (deadShown) return;
  deadShown = true;
  document.exitPointerLock();
  $('#death').classList.remove('hidden');
}

function respawn() {
  player.hp = 20; player.dead = false; deadShown = false;
  if (mode === 'survival') player.food = 20;
  dmgFlash = 0;
  $('#death').classList.add('hidden');
  spawnPlayer();
  canvas.requestPointerLock();
}

function toMenu(saveFirst) {
  if (saveFirst) saveGame();
  running = false; paused = false; deadShown = false;
  $('#hud').classList.add('hidden');
  $('#pause').classList.add('hidden');
  $('#death').classList.add('hidden');
  $('#menu').classList.remove('hidden');
  document.exitPointerLock();
  updateMenuButtons();
}

// ---------------- 存档 ----------------
function rleEncode(col) {
  let s = '', i = 0;
  while (i < col.length) {
    let j = i;
    while (j < col.length && col[j] === col[i] && j - i < 127) j++;
    s += String.fromCharCode(j - i) + String.fromCharCode(col[i]);
    i = j;
  }
  return btoa(s);
}
function rleDecode(str) {
  const s = atob(str);
  const col = new Uint8Array(WHEIGHT);
  let p = 0;
  for (let i = 0; i < s.length && p < WHEIGHT; i += 2) {
    const n = s.charCodeAt(i), v = s.charCodeAt(i + 1);
    for (let k = 0; k < n && p < WHEIGHT; k++) col[p++] = v;
  }
  return col;
}

function saveGame() {
  try {
    const chunks = [];
    for (const [, c] of world.chunks) {
      const cols = {};
      for (const [k, col] of c.cols) cols[k] = rleEncode(col);
      chunks.push({ x: c.cx, z: c.cz, s: c.state, cols });
    }
    const data = {
      v: 3, seed: world.gen.seed, chunks,
      mode, gameTime, viewMode,
      player: { pos: player.pos, yaw: player.yaw, pitch: player.pitch, hp: player.hp, food: player.food, fly: player.flying },
      inv: inv.serialize(),
      smelt: smeltBuf,
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch (e) { console.warn('保存失败', e); toast('保存失败（存储空间不足）'); }
}

function hasSave() { return !!localStorage.getItem(SAVE_KEY); }

function loadGame() {
  try {
    const data = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (!data || data.v !== 3) return false;
    world = new World(new TerrainGen(data.seed));
    // 载入区块（RLE 解码）
    for (const cd of data.chunks) {
      const c = world.getOrCreateChunk(cd.x, cd.z);
      c.state = 2; // 已装饰，避免重新长树
      for (const k in cd.cols) c.cols.set(+k, rleDecode(cd.cols[k]));
      c.dirty.add(-1); // 需要重建网格
    }
    player = new Player(world);
    player.pos = data.player.pos; player.yaw = data.player.yaw; player.pitch = data.player.pitch;
    player.hp = data.player.hp || 20; player.food = data.player.food !== undefined ? data.player.food : 20; player.flying = data.player.fly;
    viewMode = data.viewMode || 0;
    player.peakY = player.pos.y;
    inv = new Inventory();
    inv.restore(data.inv);
    smeltBuf = data.smelt || { input: null, out: null };
    mode = data.mode || 'survival';
    gameTime = data.gameTime || 36000;
    particles = []; drops = [];
    for (const m of chunkMeshes.values()) deleteMesh(m);
    chunkMeshes.clear();
    startGame();
    return true;
  } catch (e) { console.warn('读档失败', e); return false; }
}

// ---------------- 主循环 ----------------
let lastT = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - lastT) / 1000 || 0.016);
  lastT = now;

  if (running && !paused && !player.dead) {
    gameTime += dt * 100; // 1 现实秒 = 100 tick，一天 = 20 分钟

    player.update(dt, input, mode);
    updateChunks();
    updateEffects(dt);
    tickSmelt(dt);

    // 动效计时器
    if (swingT > 0) swingT = Math.max(0, swingT - dt * 3.2);
    if (dmgFlash > 0) dmgFlash = Math.max(0, dmgFlash - dt * 2.2);

    // 脚步声
    const pspd = Math.hypot(player.vel.x, player.vel.z);
    if (player.onGround && pspd > 2) {
      stepAcc += dt * pspd;
      if (stepAcc > 2.6) { stepAcc = 0; sfx.step(); }
    }
    if (!lastGrounded && player.onGround && player.vel.y === 0) { /* 落地（声音在伤害判定侧）*/ }
    lastGrounded = player.onGround;

    // 长按右键进食
    if (eatT > 0 && mouseR) {
      eatT += dt;
      if (eatT >= 1.1) {
        eatT = 0;
        const s = inv.held();
        if (s && s.id === ITEM.APPLE && player.food < 20) {
          player.food = Math.min(20, player.food + 4);
          s.n--; if (s.n <= 0) inv.hotbar[inv.sel] = null;
          refreshHotbar();
          sfx.eat();
          toast('啃了一口苹果 🍎');
        }
      }
    }

    // 长按左键
    if (mouseL && !uiOpen) {
      if (mode === 'creative') { tryBreak(); }
      else {
        const r = tryBreak();
        if (r === 'holding') {
          const hit = raycast(world, player.eye(), player.forward(), 5.5);
          if (hit && hit.x === breaking.x && hit.y === breaking.y && hit.z === breaking.z) {
            breaking.t += dt;
            if (breaking.t >= breaking.total) doBreak(hit);
          } else breaking.t = 0;
        }
      }
    }
    // TNT
    world.updateTNT(dt, (x, y, z) => explode(x, y, z, 4));

    if (player.dead) { die(); saveGame(); }

    // 自动保存
    saveTimer += dt;
    if (saveTimer > 30) { saveTimer = 0; saveGame(); }
  }

  frameCount++;
  fpsTimer += dt;
  if (fpsTimer >= 1) { fpsShown = frameCount; frameCount = 0; fpsTimer = 0; }

  render();
  updateHUD();
}

// ---------------- 菜单 ----------------
let inv; // 全局背包
function updateMenuButtons() {
  $('#btn-new').disabled = false;
  $('#btn-new-surv').disabled = false;
  $('#btn-load').classList.toggle('hidden', !hasSave());
  $('#btn-load').disabled = !hasSave();
}

function boot() {
  overlayCv = document.createElement('canvas');
  overlayCv.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:6';
  document.body.appendChild(overlayCv);
  overlayCtx = overlayCv.getContext('2d');

  atlas = new Atlas(1337);
  mesher = new Mesher(atlas);
  inv = new Inventory();

  initGL(); // 必须先创建 gl 上下文，渲染器依赖它
  charR = new CharacterRenderer(gl);
  heldR = new HeldRenderer(gl, atlas);
  skyR = new SkyRenderer(gl, 42);
  sfx = new SFX();

  world = new World(new TerrainGen(seed));
  player = new Player(world);

  setupInput();
  setupCraftEvents();

  $('#btn-new').onclick = () => newGame('creative');
  $('#btn-new-surv').onclick = () => newGame('survival');
  $('#btn-load').onclick = () => loadGame();
  $('#btn-ctl').onclick = () => { $('#controls').classList.remove('hidden'); };
  $('#btn-resume').onclick = () => togglePause(false);
  $('#btn-pmode').onclick = () => { toggleMode(); };
  $('#btn-psave').onclick = () => { saveGame(); toast('已保存 ✓'); };
  $('#btn-pmain').onclick = () => toMenu(true);
  $('#btn-respawn').onclick = respawn;
  $('#btn-dmain').onclick = () => toMenu(false);

  document.querySelectorAll('.hslot').forEach(el => {
    el.onmouseenter = () => {
      const s = inv.hotbar[+el.dataset.i];
      if (s) toast(itemName(s.id));
    };
  });

  window.dpr = Math.min(1.5, devicePixelRatio || 1);
  updateMenuButtons();
  $('#load-status').textContent = '就绪。选择模式开始冒险！';
  requestAnimationFrame(frame);
}

let overlayCv, overlayCtx;
window.addEventListener('load', boot);
window.addEventListener('beforeunload', () => { if (running) saveGame(); });
