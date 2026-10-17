/* ============================================================
 * 全国地名搜索（天地图地理编码）
 * ------------------------------------------------------------
 * 实测（2026-10-17）：
 *   · 接口 https://api.tianditu.gov.cn/geocoder
 *   · CORS: Access-Control-Allow-Origin: *  → 浏览器可直连
 *   · 返回 CGCS2000 坐标（与 WGS-84 基本一致，无需纠偏）
 *   · 实测可搜：天全县 / 四姑娘山 / 稻城亚丁 / 上海外滩 / 北京天安门 / 黄山风景区
 *
 * 设计要点：
 *   · 结果按关键词缓存，避免重复请求（天地图免费额度有限）
 *   · 返回 null 表示"请求出错"，[] 表示"确实没搜到"，两者要分开处理
 *   · 最少 2 个字才触发，防止每敲一个字母就发请求
 * ============================================================ */

const Geocode = {
  cache: new Map(),
  MAX_CACHE: 200,

  get enabled() {
    return typeof TIANDITU_KEY === 'string' && TIANDITU_KEY.length > 0;
  },

  /**
   * @param {string} keyword 地名
   * @returns {Promise<Array<{name,lat,lon}>|null>} null = 出错
   */
  async search(keyword) {
    const kw = (keyword || '').trim();
    if (!kw || kw.length < 2 || !this.enabled) return [];

    if (this.cache.has(kw)) return this.cache.get(kw);

    const ds = encodeURIComponent(JSON.stringify({ keyWord: kw }));
    const url = `https://api.tianditu.gov.cn/geocoder?ds=${ds}&tk=${TIANDITU_KEY}`;

    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const json = await res.json();

      // 天地图有时把结果放在 location，有时在 result.location
      const loc = json.location || (json.result && json.result.location);
      let out = [];
      if (loc) {
        const lat = Number(loc.lat);
        const lon = Number(loc.lon);
        if (isFinite(lat) && isFinite(lon) && lat !== 0 && lon !== 0) {
          out = [{
            name: (json.result && json.result.keyWord) || kw,
            lat,
            lon,
          }];
        }
      }

      if (this.cache.size >= this.MAX_CACHE) this.cache.clear();
      this.cache.set(kw, out);
      return out;
    } catch (e) {
      console.warn('[geocode] 地名搜索失败：', e);
      return null;
    }
  },
};
