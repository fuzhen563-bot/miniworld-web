// ============ 增强模块：相机视角 / 角色模型 / 手持物品 / 天空 / 音效 ============
'use strict';

// ---------------- 4x4 矩阵工具（column-major，与 mat4Look/mat4Perspective 一致） ----------------
function m4mul(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  }
  return o;
}
function m4translate(x, y, z) { const m = new Float32Array(16); m[0]=m[5]=m[10]=m[15]=1; m[12]=x; m[13]=y; m[14]=z; return m; }
function m4scale(x, y, z) { const m = new Float32Array(16); m[0]=x; m[5]=y; m[10]=z; m[15]=1; return m; }
function m4rotX(a) { const c=Math.cos(a), s=Math.sin(a), m=new Float32Array(16); m[0]=1; m[5]=c; m[6]=s; m[9]=-s; m[10]=c; m[15]=1; return m; }
function m4rotY(a) { const c=Math.cos(a), s=Math.sin(a), m=new Float32Array(16); m[0]=c; m[2]=-s; m[5]=1; m[8]=s; m[10]=c; m[15]=1; return m; }
function m4basis(x, y, z) { const m=new Float32Array(16); m[0]=x[0];m[1]=x[1];m[2]=x[2]; m[4]=y[0];m[5]=y[1];m[6]=y[2]; m[8]=z[0];m[9]=z[1];m[10]=z[2]; m[15]=1; return m; }

// ---------------- 第三人称相机（带墙体防穿） ----------------
function computeCameraEye(viewMode, player, world) {
  const eye = player.eye();
  if (viewMode === 0) return eye;
  const f = player.forward();
  const sign = viewMode === 1 ? -1 : 1; // 1=身后 2=面前
  const dir = { x: f.x * sign, y: f.y * sign, z: f.z * sign };
  let d = 4.5;
  for (let t = 0.35; t <= 4.5; t += 0.12) {
    const x = eye.x + dir.x * t, y = eye.y + dir.y * t, z = eye.z + dir.z * t;
    if (BLOCKS[world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z))].solid) {
      d = Math.max(0.5, t - 0.25); break;
    }
  }
  return { x: eye.x + dir.x * d, y: eye.y + dir.y * d, z: eye.z + dir.z * d };
}

// ---------------- 纯色盒子渲染器（角色/太阳/云） ----------------
class ColorBoxRenderer {
  constructor(gl) {
    this.gl = gl;
    const vs = `#version 300 es
      layout(location=0) in vec3 aPos;
      layout(location=1) in float aB;
      uniform mat4 uProj, uView, uModel;
      out float vB;
      void main(){ gl_Position = uProj * uView * uModel * vec4(aPos, 1.0); vB = aB; }`;
    const fs = `#version 300 es
      precision highp float;
      in float vB;
      uniform vec3 uColor; uniform float uAlpha; uniform vec3 uLight;
      out vec4 o;
      void main(){ o = vec4(uColor * vB * uLight, uAlpha); }`;
    this.prog = program(gl, vs, fs);
    this.loc = {
      proj: gl.getUniformLocation(this.prog, 'uProj'),
      view: gl.getUniformLocation(this.prog, 'uView'),
      model: gl.getUniformLocation(this.prog, 'uModel'),
      color: gl.getUniformLocation(this.prog, 'uColor'),
      alpha: gl.getUniformLocation(this.prog, 'uAlpha'),
      light: gl.getUniformLocation(this.prog, 'uLight'),
    };
    // 单位盒 0..1，每面不同亮度
    const P = [], BR = [];
    const face = (q, b) => { const idx = [0,1,2,0,2,3]; for (const i of idx) { P.push(...q[i]); BR.push(b); } };
    face([[0,0,0],[1,0,0],[1,1,0],[0,1,0]], 0.80); // -Z
    face([[1,0,1],[0,0,1],[0,1,1],[1,1,1]], 0.88); // +Z
    face([[0,0,0],[0,0,1],[0,1,1],[0,1,0]], 0.76); // -X
    face([[1,0,1],[1,0,0],[1,1,0],[1,1,1]], 0.76); // +X
    face([[0,1,1],[1,1,1],[1,1,0],[0,1,0]], 1.00); // +Y
    face([[0,0,0],[1,0,0],[1,0,1],[0,0,1]], 0.55); // -Y
    this.n = P.length / 3;
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    const vb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(P), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    const bb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, bb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(BR), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }

  drawBox(projMat, viewMat, model, color, alpha, light) {
    const gl = this.gl, L = this.loc;
    gl.useProgram(this.prog);
    gl.uniformMatrix4fv(L.proj, false, projMat);
    gl.uniformMatrix4fv(L.view, false, viewMat);
    gl.uniformMatrix4fv(L.model, false, model);
    gl.uniform3fv(L.color, color);
    gl.uniform1f(L.alpha, alpha);
    gl.uniform3fv(L.light, light);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, this.n);
  }
}

// ---------------- 角色模型（迷你世界 / MC 风格方块人） ----------------
class CharacterRenderer {
  constructor(gl) { this.box = new ColorBoxRenderer(gl); this.gl = gl; }

  // 绘制部件：pivot 在部件顶部中心（headTop=false 时 pivot 在底部）
  _part(proj, view, base, px, py, pz, w, h, d, rotX, color, light, headTop) {
    let m = m4mul(base, m4translate(px, py, pz));
    if (rotX) m = m4mul(m, m4rotX(rotX));
    if (headTop) m = m4mul(m, m4mul(m4translate(-w / 2, 0, -d / 2), m4scale(w, h, d)));
    else m = m4mul(m, m4mul(m4translate(-w / 2, -h, -d / 2), m4scale(w, h, d)));
    this.box.drawBox(proj, view, m, color, 1, light);
  }

  draw(projMat, viewMat, player, light) {
    const gl = this.gl;
    gl.disable(gl.CULL_FACE);
    // 行走摆动
    const spd = Math.hypot(player.vel.x, player.vel.z);
    const moving = player.onGround && spd > 0.6;
    const sw = moving ? Math.sin(player.walkPhase) * 0.72 : 0;
    const flySw = player.flying ? 0.25 : 0;
    const bob = moving ? Math.abs(Math.sin(player.walkPhase)) * 0.06 : 0;

    const skin = [0.86, 0.66, 0.47];
    const shirt = [0.24, 0.62, 0.60];
    const pants = [0.24, 0.30, 0.58];
    const shoe = [0.35, 0.35, 0.38];

    const base = m4mul(m4translate(player.pos.x, player.pos.y + bob, player.pos.z), m4rotY(player.yaw));

    // 腿（pivot 在髋部 y=0.75）
    this._part(projMat, viewMat, base, -0.115, 0.75, 0, 0.19, 0.72, 0.19, sw, pants, light);
    this._part(projMat, viewMat, base, 0.115, 0.75, 0, 0.19, 0.72, 0.19, -sw, pants, light);
    // 鞋（跟随腿）
    // 身体（pivot 底部 y=0.75，高 0.6）
    this._part(projMat, viewMat, base, 0, 0.75, 0, 0.46, 0.6, 0.25, 0, shirt, light, true);
    // 手臂（pivot 肩部 y=1.32）
    this._part(projMat, viewMat, base, -0.32, 1.33, 0, 0.17, 0.58, 0.17, -sw * 0.9 + flySw, skin, light);
    this._part(projMat, viewMat, base, 0.32, 1.33, 0, 0.17, 0.58, 0.17, sw * 0.9 + flySw, skin, light);
    // 头（pivot 底部 y=1.35，0.42 立方）
    this._part(projMat, viewMat, base, 0, 1.35, 0, 0.42, 0.42, 0.42, 0, skin, light, true);
    // 头发（头顶薄块）
    this._part(projMat, viewMat, base, 0, 1.71, 0, 0.44, 0.1, 0.44, 0, [0.3, 0.2, 0.12], light, true);
    // 眼睛（前面两个小黑块）——模型面向 -Z
    this._part(projMat, viewMat, base, -0.1, 1.55, -0.215, 0.07, 0.06, 0.02, 0, [0.12, 0.12, 0.2], light, true);
    this._part(projMat, viewMat, base, 0.1, 1.55, -0.215, 0.07, 0.06, 0.02, 0, [0.12, 0.12, 0.2], light, true);
    gl.enable(gl.CULL_FACE);
  }
}

// ---------------- 第一人称手持物品 ----------------
class HeldRenderer {
  constructor(gl, atlas) {
    this.gl = gl; this.atlas = atlas;
    const vs = `#version 300 es
      layout(location=0) in vec2 aPos;
      layout(location=1) in vec2 aUV;
      uniform vec2 uOff; uniform float uRot; uniform float uScale;
      out vec2 vUV;
      void main(){
        vec2 center = vec2(0.62, -0.55);
        vec2 p = (aPos - center) * uScale;
        float c = cos(uRot), s = sin(uRot);
        p = mat2(c, s, -s, c) * p + center + uOff;
        gl_Position = vec4(p, -0.5, 1.0);
        vUV = aUV;
      }`;
    const fs = `#version 300 es
      precision highp float;
      in vec2 vUV;
      uniform sampler2D uTex; uniform float uAlpha;
      out vec4 o;
      void main(){ vec4 t = texture(uTex, vUV); if (t.a < 0.1) discard; o = vec4(t.rgb, t.a * uAlpha); }`;
    this.prog = program(gl, vs, fs);
    this.loc = {
      off: gl.getUniformLocation(this.prog, 'uOff'),
      rot: gl.getUniformLocation(this.prog, 'uRot'),
      scale: gl.getUniformLocation(this.prog, 'uScale'),
      alpha: gl.getUniformLocation(this.prog, 'uAlpha'),
    };
    // 屏幕空间 quad（右下角）
    const S = 0.34;
    const cx = 0.62, cy = -0.55;
    const P = [cx, cy, cx + S, cy, cx + S, cy + S, cx, cy, cx + S, cy + S, cx, cy + S];
    const UV = [0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1];
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    const vb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(P), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const ub = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, ub);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(UV), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.tex = null; this.texId = -1;
  }

  _ensureTex(itemId) {
    if (this.texId === itemId && this.tex) return;
    const gl = this.gl;
    if (this.tex) gl.deleteTexture(this.tex);
    const cv = iconCanvas(itemId, this.atlas);
    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.texId = itemId;
  }

  draw(projMat, held, swingT, walkPhase) {
    if (!held) return;
    this._ensureTex(held.id);
    const gl = this.gl;
    gl.useProgram(this.prog);
    // 破坏摆动 + 行走晃动
    const swing = Math.sin(swingT * Math.PI) * 0.35;
    const wob = Math.sin(walkPhase * 2) * 0.012;
    gl.uniform2f(this.loc.off, 0.14 + swing * 0.3, -0.1 + swing * 0.5 + wob);
    gl.uniform1f(this.loc.rot, -0.35 + swing * 1.1);
    gl.uniform1f(this.loc.scale, 1.0 - swing * 0.25);
    gl.uniform1f(this.loc.alpha, 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST);
    gl.bindVertexArray(null);
  }
}

// ---------------- 天空：太阳 / 月亮 / 云 ----------------
class SkyRenderer {
  constructor(gl, seed) {
    this.box = new ColorBoxRenderer(gl);
    this.gl = gl;
    // 云：随机扁平盒子
    const rng = mulberry32(seed || 99);
    this.clouds = [];
    for (let i = 0; i < 26; i++) {
      this.clouds.push({
        x: rng() * 512 - 256, z: rng() * 512 - 256,
        w: 10 + rng() * 22, d: 8 + rng() * 16, h: 1.6 + rng() * 1.4,
        sp: 0.6 + rng() * 0.8,
      });
    }
    this.time = 0;
  }

  draw(projMat, viewMat, eye, yaw, pitch, tDay, sunLight) {
    const gl = this.gl;
    // 太阳/月亮方向：t=0 午夜，0.25 日出，0.5 正午
    const ang = (tDay - 0.25) * Math.PI * 2;
    const sd = [Math.cos(ang), Math.sin(ang), 0.18];
    const sl = Math.hypot(sd[0], sd[1], sd[2]);
    sd[0] /= sl; sd[1] /= sl; sd[2] /= sl;

    // 相机基向量
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const right = [cy, 0, sy];
    const up = [-sy * sp, cp, cy * sp];

    gl.disable(gl.CULL_FACE);
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    const drawDisc = (dir, dist, size, color, alpha) => {
      const cx = eye.x + dir[0] * dist, cyy = eye.y + dir[1] * dist, cz = eye.z + dir[2] * dist;
      // 朝向相机的薄片：用 right/up/dir 基向量旋转盒子
      const basis = m4basis(right, up, dir);
      let m = m4translate(cx, cyy, cz);
      m = m4mul(m, basis);
      m = m4mul(m, m4translate(-size / 2, -size / 2, -size / 2));
      m = m4mul(m, m4scale(size, size, size * 0.06));
      this.box.drawBox(projMat, viewMat, m, color, alpha, [1, 1, 1]);
    };

    // 太阳（暖黄，地平线附近偏橙）
    const duskK = Math.max(0, 1 - Math.abs(sd[1] + 0.08) * 5);
    const sunCol = [1, 0.95 - duskK * 0.35, 0.62 - duskK * 0.35];
    if (sd[1] > -0.12) {
      drawDisc(sd, 260, 22, sunCol, 0.95);
      drawDisc(sd, 260, 34, sunCol, 0.22); // 光晕
    }
    // 月亮
    const md = [-sd[0], -sd[1], -sd[2]];
    if (md[1] > -0.12) {
      drawDisc(md, 260, 14, [0.88, 0.9, 1.0], 0.9);
      drawDisc(md, 260, 22, [0.7, 0.75, 0.95], 0.15);
    }

    // 云（跟随玩家，缓慢漂移）
    this.time += 0.016;
    const range = 200;
    const bx = Math.floor(eye.x / range) * range, bz = Math.floor(eye.z / range) * range;
    for (const c of this.clouds) {
      let wx = bx + ((c.x + this.time * c.sp) % range + range) % range - range / 2;
      let wz = bz + (c.z % range + range) % range - range / 2;
      const m = m4mul(m4translate(wx, 108, wz), m4scale(c.w, c.h, c.d));
      const bright = 0.55 + 0.45 * Math.max(0, Math.min(1, (sunLight[0] + sunLight[1] + sunLight[2]) / 3 + 0.15));
      this.box.drawBox(projMat, viewMat, m, [1, 1, 1], 0.72, [bright, bright, bright]);
    }
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    gl.enable(gl.CULL_FACE);
  }
}

// ---------------- 音效（WebAudio 合成） ----------------
class SFX {
  constructor() { this.ctx = null; this.enabled = true; }
  ac() {
    if (!this.enabled) return null;
    if (!this.ctx) { try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; } }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }
  _noise(dur, freq, gain, delay) {
    const ctx = this.ac(); if (!ctx) return;
    const t0 = ctx.currentTime + (delay || 0);
    const buf = ctx.createBuffer(1, Math.max(1, ctx.sampleRate * dur), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource(); src.buffer = buf;
    const filt = ctx.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filt); filt.connect(g); g.connect(ctx.destination);
    src.start(t0); src.stop(t0 + dur + 0.02);
  }
  _tone(freq, dur, gain, type, delay) {
    const ctx = this.ac(); if (!ctx) return;
    const t0 = ctx.currentTime + (delay || 0);
    const osc = ctx.createOscillator(); osc.type = type || 'sine'; osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g); g.connect(ctx.destination);
    osc.start(t0); osc.stop(t0 + dur + 0.02);
  }
  dig() { this._noise(0.13, 900, 0.28); }
  place() { this._tone(160, 0.09, 0.22, 'square'); this._noise(0.05, 700, 0.12); }
  step() { this._noise(0.06, 480, 0.07); }
  jump() { this._tone(260, 0.12, 0.08, 'sine'); }
  hurt() { this._tone(130, 0.22, 0.3, 'sawtooth'); }
  boom() { this._noise(0.9, 320, 0.55); this._tone(52, 0.6, 0.45, 'sine'); }
  eat() { for (let i = 0; i < 4; i++) this._noise(0.07, 750, 0.16, i * 0.11); }
  pickup() { this._tone(760, 0.08, 0.1, 'sine'); this._tone(1140, 0.09, 0.09, 'sine', 0.06); }
  click() { this._tone(520, 0.05, 0.08, 'square'); }
  fizz() { this._noise(0.4, 2400, 0.12); }
}
