/* ============================================================
 * Open-Meteo 数据层
 * ------------------------------------------------------------
 * 实测事实（2026-10-17）：
 *  · CORS: Access-Control-Allow-Origin: * → 浏览器可直连，无需后端
 *  · 多坐标一次请求：3 组经纬度 → 返回 3 个对象，各含 24 小时
 *  · 必须带 timezone=Asia/Shanghai，否则逐小时错位 8 小时
 *  · 许可：CC BY 4.0，必须署名（见 index.html 报告页底部）
 * ============================================================ */

const API = {
  FORECAST: 'https://api.open-meteo.com/v1/forecast',
  ELEVATION: 'https://api.open-meteo.com/v1/elevation',
  CACHE_TTL: 60 * 60 * 1000, // 1 小时
};

const HOURLY_FIELDS = [
  'temperature_2m',
  'apparent_temperature',
  'precipitation_probability',
  'precipitation',
  'wind_speed_10m',
  'wind_direction_10m',
  'weather_code',
].join(',');

/* ---------------- 缓存 ---------------- */

function cacheKey(prefix, obj) {
  return 'rwc:' + prefix + ':' + JSON.stringify(obj);
}

function readCache(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { t, data } = JSON.parse(raw);
    if (Date.now() - t > API.CACHE_TTL) return null;
    return { data, stale: false, at: t };
  } catch { return null; }
}

function readCacheStale(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { t, data } = JSON.parse(raw);
    return { data, stale: true, at: t };
  } catch { return null; }
}

function writeCache(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify({ t: Date.now(), data }));
  } catch { /* 配额满则忽略 */ }
}

/* ---------------- 海拔 ---------------- */

async function fetchElevations(points) {
  const lat = points.map(p => p.lat).join(',');
  const lon = points.map(p => p.lon).join(',');
  const key = cacheKey('elev', [lat, lon]);

  const hit = readCache(key);
  if (hit) return hit.data;

  try {
    const res = await fetch(`${API.ELEVATION}?latitude=${lat}&longitude=${lon}`);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    let arr = json.elevation;
    if (!Array.isArray(arr)) arr = [arr];
    const out = arr.map(v => (typeof v === 'number' ? Math.round(v) : null));
    writeCache(key, out);
    return out;
  } catch (e) {
    // 降级：返回 null，评分里做高海拔判断会跳过
    console.warn('海拔获取失败，已降级：', e);
    return points.map(() => null);
  }
}

/* ---------------- 逐小时预报 ---------------- */

/**
 * @param {Array} points  [{name, lat, lon}]
 * @param {string} dateStr 'YYYY-MM-DD'
 * @param {number} days 取几天（导航模式需要 2 天，因为到达时刻可能跨零点）
 * @returns {Promise<{ok:boolean, stale:boolean, at:number, series:Array}>}
 *   series[i] = { name, lat, lon, hours: [{time, hour, temp, appTemp, pp, precip, wind, dir, code}] }
 */
async function fetchHourly(points, dateStr, days) {
  days = days || 1;
  const endDate = days > 1 ? addDays(dateStr, days - 1) : dateStr;
  const lat = points.map(p => p.lat).join(',');
  const lon = points.map(p => p.lon).join(',');
  const key = cacheKey('fc', [lat, lon, dateStr, days]);

  const hit = readCache(key);
  if (hit) return { ok: true, stale: false, at: hit.at, series: normalizeSeries(hit.data, points) };

  const url = `${API.FORECAST}?latitude=${lat}&longitude=${lon}`
    + `&hourly=${HOURLY_FIELDS}`
    + `&start_date=${dateStr}&end_date=${endDate}`
    + `&timezone=Asia%2FShanghai`;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    writeCache(key, json);
    return { ok: true, stale: false, at: Date.now(), series: normalizeSeries(json, points) };
  } catch (e) {
    console.warn('预报获取失败：', e);
    // 降级 1：用过期缓存
    const stale = readCacheStale(key);
    if (stale) {
      return { ok: true, stale: true, at: stale.at, series: normalizeSeries(stale.data, points) };
    }
    return { ok: false, stale: true, at: null, series: [] };
  }
}

/** 统一多坐标（数组）与单坐标（对象）两种返回结构 */
function normalizeSeries(json, points) {
  const blocks = Array.isArray(json) ? json : [json];
  return points.map((p, i) => {
    const b = blocks[i] || blocks[0] || {};
    const h = b.hourly || {};
    const times = h.time || [];
    const hours = times.map((t, k) => ({
      time: t,
      hour: Number(t.slice(11, 13)),
      temp: num(h.temperature_2m, k),
      appTemp: num(h.apparent_temperature, k),
      pp: num(h.precipitation_probability, k),
      precip: num(h.precipitation, k),
      wind: num(h.wind_speed_10m, k),
      dir: num(h.wind_direction_10m, k),
      code: num(h.weather_code, k),
    }));
    return { name: p.name, lat: p.lat, lon: p.lon, hours };
  });
}

function num(arr, i) {
  if (!arr || arr[i] === null || arr[i] === undefined) return null;
  return arr[i];
}

/* ---------------- 日期工具 ---------------- */

function todayStr() {
  return fmtDate(new Date());
}

function fmtDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return fmtDate(d);
}
