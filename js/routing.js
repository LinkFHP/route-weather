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

  /** 网页/徒步/骑行 → OSRM profile 名 */
  profileOf(mode) {
    if (mode === 'hike') return 'foot';
    if (mode === 'bike') return 'bike';
    return 'driving';
  },

  /**
   * 规划路径
   * @param {Array} pts [{name, lat, lon}] 第一个为起点，最后一个为终点，中间为途经点
   * @param {string} mode drive|hike|bike
   * @returns {Promise<{ok:boolean, distance:number, duration:number, coords:Array, approx:boolean, error?:string}>}
   */
  async fetchRoute(pts, mode) {
    if (!pts || pts.length < 2) return { ok: false, error: '至少需要起点和终点' };

    const profile = this.profileOf(mode);
    const coordStr = pts.map(p => `${p.lon},${p.lat}`).join(';');
    const key = 'rwc:route:' + profile + ':' + coordStr;

    // 缓存
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const { t, data } = JSON.parse(raw);
        if (Date.now() - t < this.CACHE_TTL) {
          return Object.assign({ ok: true, cached: true }, data);
        }
      }
    } catch (e) { /* ignore */ }

    const url = `${this.BASE}/${profile}/${coordStr}?overview=full&geometries=geojson&steps=false`;

    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const json = await res.json();
      if (json.code !== 'Ok' || !json.routes || !json.routes.length) {
        throw new Error(json.message || ('路由失败: ' + json.code));
      }
      const r = json.routes[0];
      const coords = r.geometry.coordinates.map(c => ({ lat: c[1], lon: c[0] }));
      const data = {
        distance: r.distance,     // 米
        duration: r.duration,     // 秒
        coords,
        approx: mode === 'hike' || mode === 'bike',
        profile,
      };
      try {
        localStorage.setItem(key, JSON.stringify({ t: Date.now(), data }));
      } catch (e) { /* 配额满忽略 */ }
      return Object.assign({ ok: true, cached: false }, data);
    } catch (e) {
      console.warn('路径规划失败：', e);
      return { ok: false, error: e.message || String(e) };
    }
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
