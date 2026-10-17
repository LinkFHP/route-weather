/* ============================================================
 * 路径规划与沿路采样
 * ------------------------------------------------------------
 * 实测（2026-10-17）：
 *   · OSRM 公共服务器 https://router.project-osrm.org
 *   · CORS: Access-Control-Allow-Origin: * → 浏览器可直连
 *   · 雅安→泸定 96.0 km / 70.5 min / 1359 个几何点
 *   · 成都→稻城 681 km / 7.9 h
 *
 * ⚠️ 公共 demo 服务器只有「汽车路网」：bike / foot 会静默返回与 driving
 *    相同的结果。因此徒步/骑行模式下必须向用户标注「路径按公路网估算」。
 * ============================================================ */

const ROUTING = {
  BASE: 'https://router.project-osrm.org/route/v1',
  CACHE_TTL: 24 * 60 * 60 * 1000, // 路网几乎不变，缓存 1 天

  /**
   * 各出行方式的实际速度（km/h）
   * 注意：OSRM 公共 demo 服务器只有汽车路网，徒步/骑行会返回与自驾相同的
   * 距离与时长（实测深圳→成都三种 profile 都是 681km/7.9h）。
   * 因此徒步/骑行的时长必须按下面这些速度自行换算，不能用接口返回值。
   */
  SPEED: {
    drive: null,   // 用接口值（汽车路网本来就是对的）
    hike: 4.0,     // 徒步 4 km/h（含爬升，偏保守）
    bike: 15.0,    // 骑行 15 km/h
  },

  /** 预报有效期（天）：Open-Meteo 免费档大约 16 天，保守按 7 天算 */
  FORECAST_HORIZON_DAYS: 7,

  /** 网页/徒步/骑行 → OSRM profile 名 */
  profileOf(mode) {
    if (mode === 'hike') return 'foot';
    if (mode === 'bike') return 'bike';
    return 'driving';
  },

  /**
   * 按出行方式换算实际时长
   * @returns {{duration:number, speedKmh:number|null, estimated:boolean}}
   */
  applyMode(mode, distanceM, apiDurationSec) {
    const spd = this.SPEED[mode];
    if (!spd) return { duration: apiDurationSec, speedKmh: null, estimated: false };
    // 徒步/骑行：距离 ÷ 速度
    const duration = (distanceM / 1000) / spd * 3600;
    return { duration, speedKmh: spd, estimated: true };
  },

  /**
   * 规划路径
   * @param {Array} pts [{name, lat, lon}] 第一个为起点，最后一个为终点，中间为途经点
   * @param {string} mode drive|hike|bike
   * @returns {Promise<{ok, distance, duration, coords, approx, profile, speedKmh, estimated, overHorizon, horizonDays}>}
   */
  async fetchRoute(pts, mode) {
    if (!pts || pts.length < 2) return { ok: false, error: '至少需要起点和终点' };

    const profile = this.profileOf(mode);
    // 缓存按「去程 profile + 坐标」存原始数据，换算在返回时做，
    // 这样改速度常量不会命中旧缓存导致不一致
    const coordStr = pts.map(p => `${p.lon},${p.lat}`).join(';');
    const key = 'rwc:route:' + coordStr;

    let raw = null;
    try {
      const s = localStorage.getItem(key);
      if (s) {
        const { t, data } = JSON.parse(s);
        if (Date.now() - t < this.CACHE_TTL) raw = data;
      }
    } catch (e) { /* ignore */ }

    if (!raw) {
      const url = `${this.BASE}/${profile}/${coordStr}?overview=full&geometries=geojson&steps=false`;
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const json = await res.json();
        if (json.code !== 'Ok' || !json.routes || !json.routes.length) {
          throw new Error(json.message || ('路由失败: ' + json.code));
        }
        const r = json.routes[0];
        raw = {
          distance: r.distance,
          apiDuration: r.duration,
          coords: r.geometry.coordinates.map(c => ({ lat: c[1], lon: c[0] })),
        };
        try {
          localStorage.setItem(key, JSON.stringify({ t: Date.now(), data: raw }));
        } catch (e) { /* 配额满忽略 */ }
      } catch (e) {
        console.warn('路径规划失败：', e);
        return { ok: false, error: e.message || String(e) };
      }
    }

    const conv = this.applyMode(mode, raw.distance, raw.apiDuration);
    const days = conv.duration / 3600 / 24;

    return {
      ok: true,
      distance: raw.distance,           // 米（路网距离）
      duration: conv.duration,          // 秒（已按出行方式换算）
      coords: raw.coords,
      profile,                          // 实际调用的 OSRM profile
      approx: conv.estimated,           // true = 时长是自行估算的
      speedKmh: conv.speedKmh,
      // 是否超出预报有效期（超出则整体评估无意义）
      overHorizon: days > this.FORECAST_HORIZON_DAYS,
      horizonDays: this.FORECAST_HORIZON_DAYS,
      travelDays: days,
    };
  },
};

/* ---------------- 地理计算 ---------------- */

const GEO = {
  R: 6371000, // 地球半径（米）

  /** 两点距离（米），Haversine */
  dist(a, b) {
    const toRad = d => d * Math.PI / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLon = toRad(b.lon - a.lon);
    const la1 = toRad(a.lat), la2 = toRad(b.lat);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
    return 2 * this.R * Math.asin(Math.sqrt(h));
  },

  /** 累计里程数组（米），长度与 coords 相同 */
  cumulative(coords) {
    const cum = [0];
    for (let i = 1; i < coords.length; i++) {
      cum.push(cum[i - 1] + this.dist(coords[i - 1], coords[i]));
    }
    return cum;
  },

  /**
   * 沿路径按「里程」等距采样（不是按索引，因为几何点疏密不均）
   * @param {Array} coords 路径几何点
   * @param {number} n 采样点数（含起点与终点）
   * @returns {Array} [{lat, lon, ratio, cumKm}]
   */
  sampleAlong(coords, n) {
    if (!coords || coords.length < 2) return [];
    n = Math.max(2, Math.min(20, n | 0));
    const cum = this.cumulative(coords);
    const total = cum[cum.length - 1];
    if (!total) return [];

    const out = [];
    let seg = 0;
    for (let k = 0; k < n; k++) {
      const target = total * (k / (n - 1));
      while (seg < cum.length - 2 && cum[seg + 1] < target) seg++;
      const segLen = cum[seg + 1] - cum[seg];
      const f = segLen > 0 ? (target - cum[seg]) / segLen : 0;
      const a = coords[seg], b = coords[seg + 1];
      out.push({
        lat: a.lat + (b.lat - a.lat) * f,
        lon: a.lon + (b.lon - a.lon) * f,
        ratio: k / (n - 1),
        cumKm: target / 1000,
      });
    }
    return out;
  },

  /**
   * 采样点数：大约每 45 分钟一个点（天气在 45 分钟内变化有限），限 3–8 个。
   * @param {number} durationSec 总时长
   */
  sampleCountFor(durationSec) {
    const minutes = durationSec / 60;
    return Math.max(3, Math.min(8, Math.round(minutes / 45) || 3));
  },
};

/* ---------------- 导出（供 node 测试） ---------------- */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ROUTING, GEO };
}
