/* ============================================================
 * 内置点位库
 * ------------------------------------------------------------
 * 坐标已通过 Open-Meteo Elevation API 校验过海拔合理性（见 README）。
 * 本期内置川西/川北主要城镇与景区点位 —— 因 Open-Meteo 地理编码
 * 对县级地名无效（实测「天全县」「泸定县」均无结果），故用点位库。
 *
 * elev: 可选。若填写则优先使用，否则调用 Elevation API 取 DEM 海拔。
 *       山区陡谷中 DEM 可能读到坡面而非聚落，必要时可在此覆盖。
 * ============================================================ */

const POINT_LIBRARY = [
  // ---- 成都周边 ----
  { name: '成都',       lat: 30.5728, lon: 104.0668, region: '成都周边' },
  { name: '都江堰',     lat: 31.0025, lon: 103.6191, region: '成都周边' },
  { name: '汶川',       lat: 31.4769, lon: 103.5904, region: '成都周边' },
  { name: '青城山',     lat: 30.9025, lon: 103.5680, region: '成都周边' },

  // ---- 川西环线 ----
  { name: '雅安',       lat: 29.9853, lon: 102.9998, region: '川西环线' },
  { name: '天全',       lat: 30.0700, lon: 102.7630, region: '川西环线' },
  { name: '二郎山',     lat: 29.9800, lon: 102.6200, region: '川西环线' },
  { name: '泸定',       lat: 29.9144, lon: 102.2344, region: '川西环线' },
  { name: '康定',       lat: 30.0499, lon: 101.9630, region: '川西环线' },
  { name: '新都桥',     lat: 30.0600, lon: 101.5000, region: '川西环线' },
  { name: '丹巴',       lat: 30.8798, lon: 101.8907, region: '川西环线' },
  { name: '四姑娘山',   lat: 31.0800, lon: 102.8700, region: '川西环线' },
  { name: '海螺沟',     lat: 29.6400, lon: 102.1100, region: '川西环线' },
  { name: '石棉',       lat: 29.2330, lon: 102.3590, region: '川西环线' },
  { name: '马尔康',     lat: 31.9000, lon: 102.2200, region: '川西环线' },

  // ---- 川藏南线延伸 ----
  { name: '理塘',       lat: 30.0000, lon: 100.2700, region: '川藏南线' },
  { name: '稻城',       lat: 29.0400, lon: 100.3000, region: '川藏南线' },
  { name: '巴塘',       lat: 30.0050, lon: 99.1050,  region: '川藏南线' },

  // ---- 川北 ----
  { name: '松潘',       lat: 32.6530, lon: 103.5980, region: '川北' },
  { name: '九寨沟',     lat: 33.2600, lon: 103.9200, region: '川北' },
  { name: '黄龙',       lat: 32.7500, lon: 103.8200, region: '川北' },

  // ---- 攀西 ----
  { name: '西昌',       lat: 27.8940, lon: 102.2640, region: '攀西' },
  { name: '冕宁',       lat: 28.5500, lon: 102.1700, region: '攀西' },
];

const REGIONS = ['全部', '成都周边', '川西环线', '川藏南线', '川北', '攀西'];

/** 示例路线：雅安 → 天全 → 泸定（产品设计文档中的示例） */
const DEMO_ROUTE = ['雅安', '天全', '泸定'];

function findPointByName(name) {
  return POINT_LIBRARY.find(p => p.name === name) || null;
}

function searchPoints(keyword, region) {
  const kw = (keyword || '').trim();
  return POINT_LIBRARY.filter(p => {
    const okRegion = !region || region === '全部' || p.region === region;
    const okKw = !kw || p.name.includes(kw) || p.region.includes(kw);
    return okRegion && okKw;
  });
}
