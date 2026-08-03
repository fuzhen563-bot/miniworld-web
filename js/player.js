// ============ 玩家：物理 / 碰撞 / 射线 ============
'use strict';

const P_HALF_W = 0.3, P_HEIGHT = 1.8, P_EYE = 1.62;

class Player {
  constructor(world) {
    this.world = world;
    this.pos = { x: 8, y: 60, z: 8 };
    this.vel = { x: 0, y: 0, z: 0 };
    this.yaw = 0; this.pitch = 0;
    this.onGround = false;
    this.flying = false;
    this.walkPhase = 0;
    this.peakY = 60;
    this.hp = 20;
    this.food = 20;           // 饥饿值 0..20
    this.foodTimer = 0;
    this.dead = false;
    this.onDamage = null; // (amount, cause)
  }

  eye() { return { x: this.pos.x, y: this.pos.y + P_EYE, z: this.pos.z }; }
  forward() {
    const cp = Math.cos(this.pitch);
    return { x: Math.sin(this.yaw) * cp, y: Math.sin(this.pitch), z: -Math.cos(this.yaw) * cp };
  }

  _solidAt(x, y, z) {
    return BLOCKS[this.world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z))].solid;
  }

  _collides(px, py, pz) {
    const x0 = Math.floor(px - P_HALF_W), x1 = Math.floor(px + P_HALF_W);
    const y0 = Math.floor(py), y1 = Math.floor(py + P_HEIGHT - 0.001);
    const z0 = Math.floor(pz - P_HALF_W), z1 = Math.floor(pz + P_HALF_W);
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++)
        for (let z = z0; z <= z1; z++)
          if (BLOCKS[this.world.getBlock(x, y, z)].solid) return true;
    return false;
  }

  inWater() {
    const w = this.world;
    return w.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y + 0.4), Math.floor(this.pos.z)) === B.WATER
        || w.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y + 1.2), Math.floor(this.pos.z)) === B.WATER;
  }
  eyeInWater() {
    const e = this.eye();
    return this.world.getBlock(Math.floor(e.x), Math.floor(e.y), Math.floor(e.z)) === B.WATER;
  }

  damage(n, cause) {
    if (this.dead) return;
    this.hp = Math.max(0, this.hp - n);
    if (this.onDamage) this.onDamage(n, cause);
    if (this.hp <= 0) this.dead = true;
  }

  update(dt, input, mode) {
    if (this.dead) return;
    const water = this.inWater();
    if (this.flying && mode !== 'creative') this.flying = false;
    const speed = this.flying ? 12 : (input.sprint ? 6.8 : 4.4) * (water ? 0.55 : 1);

    // 水平移动
    let wx = 0, wz = 0;
    if (input.f) { wx += Math.sin(this.yaw); wz -= Math.cos(this.yaw); }
    if (input.b) { wx -= Math.sin(this.yaw); wz += Math.cos(this.yaw); }
    if (input.r) { wx += Math.cos(this.yaw); wz += Math.sin(this.yaw); }
    if (input.l) { wx -= Math.cos(this.yaw); wz -= Math.sin(this.yaw); }
    const len = Math.hypot(wx, wz);
    if (len > 0) { wx /= len; wz /= len; }

    const k = this.flying ? Math.min(1, dt * 10) : (this.onGround ? Math.min(1, dt * 14) : Math.min(1, dt * 3.2));
    this.vel.x += (wx * speed - this.vel.x) * k;
    this.vel.z += (wz * speed - this.vel.z) * k;
    const spd = Math.hypot(this.vel.x, this.vel.z);
    if (this.onGround && spd > 0.5) this.walkPhase += dt * spd * 2.4;

    // 垂直
    if (this.flying) {
      const vy = (input.jump ? 10 : 0) + (input.down ? -10 : 0);
      this.vel.y += (vy - this.vel.y) * Math.min(1, dt * 10);
    } else if (water) {
      if (input.jump) this.vel.y += (3.2 - this.vel.y) * Math.min(1, dt * 8);
      else this.vel.y -= 6 * dt;
      this.vel.y = Math.max(-3.4, Math.min(3.4, this.vel.y));
    } else {
      this.vel.y -= 24 * dt;
      this.vel.y = Math.max(-48, this.vel.y);
      if (input.jump && this.onGround) { this.vel.y = 8.3; this.onGround = false; }
    }

    // 逐轴碰撞解算：向目标逐步步进，碰到即停（贴墙平滑移动）
    const wasGround = this.onGround;
    this.onGround = false;
    const EPS = 1e-4;

    // X
    let tx = this.pos.x + this.vel.x * dt;
    if (this._collides(tx, this.pos.y, this.pos.z)) {
      const st = Math.sign(this.vel.x) * 0.05;
      while (!this._collides(this.pos.x + st, this.pos.y, this.pos.z) &&
             Math.sign(tx - (this.pos.x + st)) === Math.sign(st) &&
             Math.abs(tx - this.pos.x) > EPS) this.pos.x += st;
      this.vel.x = 0;
    } else this.pos.x = tx;
    // Z
    let tz = this.pos.z + this.vel.z * dt;
    if (this._collides(this.pos.x, this.pos.y, tz)) {
      const st = Math.sign(this.vel.z) * 0.05;
      while (!this._collides(this.pos.x, this.pos.y, this.pos.z + st) &&
             Math.sign(tz - (this.pos.z + st)) === Math.sign(st) &&
             Math.abs(tz - this.pos.z) > EPS) this.pos.z += st;
      this.vel.z = 0;
    } else this.pos.z = tz;
    // Y
    let ty = this.pos.y + this.vel.y * dt;
    if (this._collides(this.pos.x, ty, this.pos.z)) {
      const st = Math.sign(this.vel.y) * 0.05;
      while (!this._collides(this.pos.x, this.pos.y + st, this.pos.z) &&
             Math.sign(ty - (this.pos.y + st)) === Math.sign(st) &&
             Math.abs(ty - this.pos.y) > EPS) this.pos.y += st;
      if (this.vel.y < 0) {
        // 落地：摔落伤害（落水免伤）
        this.onGround = true;
        if (!this.flying && !wasGround) {
          const fall = this.peakY - this.pos.y;
          const landBlock = this.world.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y + 0.2), Math.floor(this.pos.z));
          if (fall > 3.6 && !water && landBlock !== B.WATER) this.damage(Math.floor((fall - 3) * 1.1), 'fall');
        }
        this.peakY = this.pos.y;
      }
      this.vel.y = 0;
    } else {
      this.pos.y = ty;
      if (!this.flying && this.vel.y > 0) this.peakY = Math.max(this.peakY, this.pos.y);
    }

    if (this.onGround || this.flying || water) this.peakY = this.pos.y;
    if (this.pos.y < -12) this.damage(100, 'void');

    // 饥饿消耗与回血
    this.foodTimer += dt * (spd > 0.5 ? 1 : 0.4);
    if (this.foodTimer > 6) {
      this.foodTimer = 0;
      if (this.food > 0) this.food--;
    }
    if (this.food <= 0) {
      // 饿肚子：独立计时，每 4 秒扣 1 血
      this.starveTimer = (this.starveTimer || 0) + dt;
      if (this.starveTimer > 4) { this.starveTimer = 0; this.damage(1, 'starve'); }
    } else {
      this.starveTimer = 0;
    }
    if (this.food >= 16 && this.hp < 20) {
      this.healTimer = (this.healTimer || 0) + dt;
      if (this.healTimer > 3) { this.healTimer = 0; this.hp = Math.min(20, this.hp + 1); }
    } else {
      this.healTimer = 0;
    }
  }

  teleport(x, y, z) {
    this.pos = { x, y, z };
    this.vel = { x: 0, y: 0, z: 0 };
    this.peakY = y;
    this.dead = false;
  }
}

// ---- DDA 射线检测 ----
function raycast(world, o, dir, maxD) {
  let x = Math.floor(o.x), y = Math.floor(o.y), z = Math.floor(o.z);
  const sx = dir.x > 0 ? 1 : -1, sy = dir.y > 0 ? 1 : -1, sz = dir.z > 0 ? 1 : -1;
  const tdx = Math.abs(1 / dir.x), tdy = Math.abs(1 / dir.y), tdz = Math.abs(1 / dir.z);
  let tmx = dir.x !== 0 ? (sx > 0 ? (x + 1 - o.x) : (o.x - x)) * tdx : Infinity;
  let tmy = dir.y !== 0 ? (sy > 0 ? (y + 1 - o.y) : (o.y - y)) * tdy : Infinity;
  let tmz = dir.z !== 0 ? (sz > 0 ? (z + 1 - o.z) : (o.z - z)) * tdz : Infinity;
  let nx = 0, ny = 0, nz = 0, t = 0;

  for (let i = 0; i < 256 && t <= maxD; i++) {
    const id = world.getBlock(x, y, z);
    const def = BLOCKS[id];
    if ((def.solid || def.cross) && id !== B.AIR) {
      return { x, y, z, nx, ny, nz, dist: t, id };
    }
    if (tmx < tmy && tmx < tmz) { x += sx; t = tmx; tmx += tdx; nx = -sx; ny = 0; nz = 0; }
    else if (tmy < tmz) { y += sy; t = tmy; tmy += tdy; nx = 0; ny = -sy; nz = 0; }
    else { z += sz; t = tmz; tmz += tdz; nx = 0; ny = 0; nz = -sz; }
  }
  return null;
}
