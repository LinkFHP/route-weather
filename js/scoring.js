/* ============================================================
 * 评分算法 —— 可解释、可复现
 * ------------------------------------------------------------
 * 原则：不可解释即不输出。任何分数都必须能列出扣分原因。
 * 详见《路线天气体检_MVP技术方案与评分算法细则.md》第三节
 * ============================================================ */

/* ---------------- WMO 天气码 ---------------- */

const WMO = {
  0:  { zh: '晴',       sev: 0 },
  1:  { zh: '少云',     sev: 0 },
  2:  { zh: '多云',     sev: 0 },
  3:  { zh: '阴',       sev: 0 },
  45: { zh: '雾',       sev: 10 },
  48: { zh: '雾凇',     sev: 10 },
  51: { zh: '小毛毛雨', sev: 3 },
  53: { zh: '毛毛雨',   sev: 6 },
  55: { zh: '大毛毛雨', sev: 10 },
  56: { zh: '冻毛毛雨', sev: 20 },
  57: { zh: '强冻毛毛雨', sev: 20 },
  61: { zh: '小雨',     sev: 5 },
  63: { zh: '中雨',     sev: 12 },
  65: { zh: '大雨',     sev: 20 },
  66: { zh: '冻雨',     sev: 20 },
  67: { zh: '强冻雨',   sev: 20 },
  71: { zh: '小雪',     sev: 10 },
  73: { zh: '中雪',     sev: 15 },
  75: { zh: '大雪',     sev: 20 },
  77: { zh: '米雪',     sev: 10 },
  80: { zh: '阵雨',     sev: 8 },
  81: { zh: '中阵雨',   sev: 15 },
  82: { zh: '强阵雨',   sev: 20 },
  85: { zh: '小阵雪',   sev: 12 },
  86: { zh: '大阵雪',   sev: 20 },
  95: { zh: '雷暴',     sev: 25 },
  96: { zh: '雷暴伴冰雹', sev: 25 },
  99: { zh: '强雷暴伴冰雹', sev: 25 },
};

function wmoText(code) {
  if (code === null || code === undefined) return '未知';
  return (WMO[code] || { zh: '未知', sev: 0 }).zh;
}

function wmoSev(code) {
  if (code === null || code === undefined) return 0;
  return (WMO[code] || { sev: 0 }).sev;
}

/* ---------------- 等级 ---------------- */

function levelOf(score) {
  if (score >= 80) return { key: 'good',   text: '适宜',   icon: '🟢', short: '适合出行' };
  if (score >= 60) return { key: 'fair',   text: '一般',   icon: '🟡', short: '可以出行，注意天气变化' };
  if (score >= 40) return { key: 'caution',text: '谨慎',   icon: '🟠', short: '谨慎出行' };
  return               { key: 'bad',   text: '不建议', icon: '🔴', short: '不建议出行' };
}

/* ---------------- 单项扣分 ---------------- */

function dedPrecipProb(pp) {
  if (pp === null) return { pts: 0, label: null };
  let pts = 0;
  if (pp > 80) pts = 35;
  else if (pp > 60) pts = 22;
  else if (pp > 40) pts = 12;
  else if (pp > 20) pts = 5;
  return { pts, label: `降水概率 ${Math.round(pp)}%` };
}

function dedPrecip(mm) {
  if (mm === null) return { pts: 0, label: null };
  let pts = 0;
  if (mm > 8) pts = 35;
  else if (mm > 2.5) pts = 20;
  else if (mm > 0.5) pts = 10;
  else if (mm > 0) pts = 3;
  return { pts, label: `降水量 ${mm.toFixed(1)} mm/h` };
}

function dedWind(w) {
  if (w === null) return { pts: 0, label: null };
  let pts = 0;
  if (w > 50) pts = 30;
  else if (w > 40) pts = 20;
  else if (w > 29) pts = 12;
  else if (w > 18) pts = 5;
  return { pts, label: `风速 ${Math.round(w)} km/h` };
}

function dedTemp(t) {
  if (t === null) return { pts: 0, label: null };
  const COMFORT_LO = 12, COMFORT_HI = 26;
  let dev = 0;
  if (t < COMFORT_LO) dev = COMFORT_LO - t;
  else if (t > COMFORT_HI) dev = t - COMFORT_HI;
  let pts = Math.min(20, Math.floor(dev / 5) * 5);
  return { pts, label: pts > 0 ? `气温偏离舒适区 ${t.toFixed(1)}℃` : null };
}

function dedFreezing(t) {
  if (t === null) return { pts: 0, label: null };
  if (t < 0) return { pts: 10, label: `气温 ${t.toFixed(1)}℃（结冰风险）` };
  return { pts: 0, label: null };
}

function dedWeather(code) {
  const pts = wmoSev(code);
  return { pts, label: pts > 0 ? `天气现象「${wmoText(code)}」` : null };
}

function dedAltitude(elev) {
  if (elev === null || elev === undefined) return { pts: 0, label: null };
  if (elev > 3000) return { pts: 5, label: `高海拔 ${elev} m` };
  return { pts: 0, label: null };
}

/* ---------------- 单小时评分 ---------------- */

/**
 * @param {object} h 归一化后的小时数据
 * @param {number|null} elev 海拔
 * @returns {{score:number, level:object, deductions:Array<{pts:number,label:string}>}}
 */
function scoreHour(h, elev) {
  const items = [
    dedPrecipProb(h.pp),
    dedPrecip(h.precip),
    dedWind(h.wind),
    dedTemp(h.temp),
    dedFreezing(h.temp),
    dedWeather(h.code),
    dedAltitude(elev),
  ];

  const deductions = items
    .filter(d => d.pts > 0 && d.label)
    .map(d => ({ pts: d.pts, label: d.label }))
    .sort((a, b) => b.pts - a.pts);

  const total = items.reduce((s, d) => s + d.pts, 0);
  const score = Math.max(0, Math.round(100 - total));

  return { score, level: levelOf(score), deductions };
}

/* ---------------- 逐小时矩阵 + 路线分析 ---------------- */

/**
 * @param {Array} series  fetchHourly 返回的 series
 * @param {Array} elevations  与 series 等长
 * @param {string} dateStr
 * @param {string} mode  drive|hike|bike
 */
function analyze(series, elevations, dateStr, mode) {
  const nHours = Math.min(...series.map(s => s.hours.length));
  if (!nHours || nHours <= 0) return null;

  // 逐点逐小时评分
  const points = series.map((s, pi) => {
    const elev = elevations[pi];
    const hourly = [];
    for (let k = 0; k < s.hours.length; k++) {
      const h = s.hours[k];
      const sc = scoreHour(h, elev);
      hourly.push({
        hour: h.hour, time: h.time, score: sc.score, level: sc.level,
        deductions: sc.deductions,
        temp: h.temp, pp: h.pp, precip: h.precip, wind: h.wind, code: h.code,
      });
    }
    return { name: s.name, lat: s.lat, lon: s.lon, elev, hourly };
  });

  // 若出行日期是今天，只保留当前时刻之后的小时
  const isToday = dateStr === todayStr();
  const nowHour = new Date().getHours();
  points.forEach(p => {
    p.hourly = p.hourly.filter(x => (isToday ? x.hour >= nowHour : true));
  });

  const len = Math.min(...points.map(p => p.hourly.length));
  if (len <= 0) return null;

  // 每个小时索引上的路线分（短板原则）
  const routeByIndex = [];
  for (let i = 0; i < len; i++) {
    const scores = points.map(p => p.hourly[i].score);
    routeByIndex.push(Math.min(...scores));
  }

  // 最佳出发窗口：所有点同时 ≥60 且连续 ≥2 小时
  // 但若合格时段长达十几小时，"出发窗口"就失去意义 —— 因此取其中最优质的一段（上限 6 小时）
  const TH = 60, MIN_LEN = 2, MAX_WINDOW = 6;

  // 先找出所有合格的连续段
  const runs = [];
  let cur = null;
  for (let i = 0; i < len; i++) {
    if (routeByIndex[i] >= TH) {
      if (!cur) cur = { start: i, end: i };
      else cur.end = i;
    } else {
      if (cur && cur.end - cur.start + 1 >= MIN_LEN) runs.push(cur);
      cur = null;
    }
  }
  if (cur && cur.end - cur.start + 1 >= MIN_LEN) runs.push(cur);

  // 在每个合格段内滑窗，取评分最优且长度不超过 MAX_WINDOW 的子段
  let best = null;
  for (const run of runs) {
    const runLen = run.end - run.start + 1;
    const winLen = Math.min(runLen, MAX_WINDOW);
    for (let s = run.start; s + winLen - 1 <= run.end; s++) {
      const e = s + winLen - 1;
      let sum = 0, mn = 101;
      for (let i = s; i <= e; i++) { sum += routeByIndex[i]; if (routeByIndex[i] < mn) mn = routeByIndex[i]; }
      const avg = sum / winLen;
      const cand = { start: s, end: e, avg, min: mn };
      // 排序：先看窗口内平均分，再看窗口内最低分，再看更早开始
      if (!best
        || cand.avg > best.avg + 1e-9
        || (Math.abs(cand.avg - best.avg) < 1e-9 && cand.min > best.min)
        || (Math.abs(cand.avg - best.avg) < 1e-9 && cand.min === best.min && cand.start < best.start)) {
        best = cand;
      }
    }
  }

  // 记录合格时段的总体情况，用于报告说明
  const qualifyHours = routeByIndex.filter(s => s >= TH).length;

  // 选定"评估时刻"：有窗口取窗口起点；无窗口取路线分最高的时刻
  let chosenIndex, window;
  if (best) {
    chosenIndex = best.start;
    window = {
      exists: true,
      startHour: points[0].hourly[best.start].hour,
      endHour: points[0].hourly[best.end].hour + 1,
      routeScoreAtStart: routeByIndex[best.start],
      avg: Math.round(best.avg),
      min: best.min,
      qualifyHours,
      capped: qualifyHours > MAX_WINDOW,
    };
  } else {
    let maxI = 0;
    for (let i = 1; i < len; i++) if (routeByIndex[i] > routeByIndex[maxI]) maxI = i;
    chosenIndex = maxI;
    // 降级：给出"最接近时段"与瓶颈点位
    const worstIdx = argmin(points.map(p => p.hourly[maxI].score));
    window = {
      exists: false,
      nearestHour: points[0].hourly[maxI].hour,
      nearestEndHour: points[0].hourly[maxI].hour + 1,
      routeScoreAtNearest: routeByIndex[maxI],
      bottleneckName: points[worstIdx].name,
    };
  }

  // 选定时刻的逐点结果
  const atMoment = points.map(p => ({
    name: p.name,
    lat: p.lat,
    lon: p.lon,
    elev: p.elev,
    score: p.hourly[chosenIndex].score,
    level: p.hourly[chosenIndex].level,
    deductions: p.hourly[chosenIndex].deductions,
    temp: p.hourly[chosenIndex].temp,
    code: p.hourly[chosenIndex].code,
    weatherText: wmoText(p.hourly[chosenIndex].code),
    pp: p.hourly[chosenIndex].pp,
    hourly: p.hourly,
  }));

  const routeScore = Math.min(...atMoment.map(p => p.score));
  const avgScore = Math.round(atMoment.reduce((s, p) => s + p.score, 0) / atMoment.length);
  const worstIdx = argmin(atMoment.map(p => p.score), atMoment.map(p => p.elev));
  const routeLevel = levelOf(routeScore);

  return {
    date: dateStr,
    mode: mode || 'drive',
    chosenHour: points[0].hourly[chosenIndex].hour,
    points: atMoment,
    routeScore,
    avgScore,
    level: routeLevel,
    worstIndex: worstIdx,
    window,
    advice: buildAdvice(atMoment, window, mode),
  };
}

/** 取最小值的索引；并列时取海拔更高者 */
function argmin(scores, elevs) {
  let idx = 0;
  for (let i = 1; i < scores.length; i++) {
    if (scores[i] < scores[idx]) idx = i;
    else if (scores[i] === scores[idx] && elevs && elevs[i] != null && elevs[idx] != null) {
      if (elevs[i] > elevs[idx]) idx = i;
    }
  }
  return idx;
}

/* ---------------- 出行准备建议 ---------------- */

function buildAdvice(points, window, mode) {
  const out = [];
  const maxPP = Math.max(...points.map(p => p.pp ?? 0));
  const maxCode = Math.max(...points.map(p => wmoSev(p.code) ?? 0));
  const minTemp = Math.min(...points.filter(p => p.temp != null).map(p => p.temp));
  const maxWind = Math.max(...points.map(p => p.wind ?? 0));

  if (maxPP >= 50) out.push('带上雨具，建议穿防水鞋');
  if (maxCode >= 25) out.push('⚠️ 有雷暴预报，尽量上午通过，避开午后');
  if (isFinite(minTemp) && minTemp < 10) out.push('最低气温低于 10℃，加带一件保暖外套');
  if (points.some(p => p.elev != null && p.elev > 2500)) out.push('高海拔点位明显更冷，注意保暖与高反');
  if (maxWind > 29) out.push('注意大风，固定好帽子与随身物品');
  if (mode === 'hike') out.push('徒步请预留下山时间，确保天黑前通过最差点位');
  if (mode === 'bike') out.push('骑行注意侧风，下坡路段控制车速');

  if (!window.exists) {
    const worstName = points[argmin(points.map(p => p.score))].name;
    out.push(`今日无完全适宜窗口，建议改期；如必须出行，缩短行程至「${worstName}」之前`);
  } else {
    out.push(`建议在 ${String(window.startHour).padStart(2, '0')}:00–${String(window.endHour).padStart(2, '0')}:00 之间出发`);
    if (window.capped) {
      out.push(`当天共有约 ${window.qualifyHours} 个时段达到「一般」以上，以上为其中最优的 ${window.endHour - window.startHour} 小时`);
    }
  }
  return out;
}

/* ============================================================
 * 导航模式：沿路采样 + 按「到达时刻」逐点评分
 * ------------------------------------------------------------
 * 与点位模式的核心区别：
 *   点位模式   —— 所有点位用同一个时刻的天气
 *   导航模式   —— 第 i 个采样点用「预计到达那一刻」的天气
 *   例：成都→稻城 7.9 小时，第 8 个点到达时已是 8 小时后，
 *       用出发时刻的天气去评估它是错的。
 * ============================================================ */

/** 取某采样点序列的第 idx 小时（idx 可跨日，0..47） */
function hourAt(p, idx) {
  if (!p.hours || !p.hours.length) return null;
  return p.hours[Math.max(0, Math.min(p.hours.length - 1, idx))];
}

/**
 * 计算某个出发时刻下，每个采样点的分数与到达时刻
 * @returns {{entries:Array, min:number, avg:number, valid:boolean}}
 */
function scoreAtDeparture(samples, series, elevations, durationSec, departHour) {
  const entries = [];
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    // 到达该点的时刻 = 出发时刻 + 行程进度 × 总时长
    const arriveAbs = departHour + (s.ratio * durationSec) / 3600;
    const idx = Math.round(arriveAbs);
    const h = hourAt(series[i], idx);
    if (!h) return { entries: [], min: 0, avg: 0, valid: false };

    const sc = scoreHour(h, elevations[i]);
    entries.push({
      name: s.name,
      lat: s.lat, lon: s.lon,
      cumKm: s.cumKm,
      ratio: s.ratio,
      arriveAbs,
      arriveIdx: idx,
      hours: series[i].hours,
      hour: ((idx % 24) + 24) % 24,
      dayOffset: Math.floor(idx / 24),
      score: sc.score,
      level: sc.level,
      deductions: sc.deductions,
      temp: h.temp,
      code: h.code,
      pp: h.pp,
      precip: h.precip,
      wind: h.wind,
      weatherText: wmoText(h.code),
    });
  }
  const scores = entries.map(e => e.score);
  return {
    entries,
    min: Math.min(...scores),
    avg: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
    valid: true,
  };
}

/**
 * 推荐出发时刻：遍历 0–23 点出发，取「全程最低分」最高的那个。
 * 注意这是"最稳"的出发时刻，不一定全天分数最高——安全场景要保守。
 */
function findBestDeparture(samples, series, elevations, durationSec) {
  let best = null;
  for (let h = 0; h < 24; h++) {
    const r = scoreAtDeparture(samples, series, elevations, durationSec, h);
    if (!r.valid) continue;
    if (!best || r.min > best.min || (r.min === best.min && h < best.hour)) {
      best = { hour: h, min: r.min, avg: r.avg };
    }
  }
  return best;
}

/**
 * @param {Array} series     每个采样点的逐小时数据（48 小时，不按"今天"过滤）
 * @param {Array} elevations 海拔
 * @param {Array} samples    [{lat, lon, ratio, cumKm, name}]
 * @param {object} route     {distance(米), duration(秒), approx, profile}
 * @param {number} departHour 出发时刻 0–23；传 -1 表示自动取推荐时刻
 * @param {string} dateStr
 * @param {string} mode
 */
function analyzeNavigation(series, elevations, samples, route, departHour, dateStr, mode) {
  const durationSec = route.duration;
  const auto = departHour == null || departHour < 0;

  const bestDep = findBestDeparture(samples, series, elevations, durationSec);
  const useHour = auto && bestDep ? bestDep.hour : departHour;

  const res = scoreAtDeparture(samples, series, elevations, durationSec, useHour);
  if (!res.valid) return null;

  const points = res.entries;
  const routeScore = res.min;
  const avgScore = res.avg;
  const worstIndex = argmin(points.map(p => p.score), points.map(p => p.elev));
  const routeLevel = levelOf(routeScore);

  // 风险路段统计
  const risky = points.filter(p => p.score < 60);
  const cautionCount = points.filter(p => p.score >= 40 && p.score < 60).length;
  const badCount = points.filter(p => p.score < 40).length;

  return {
    mode: 'nav',
    date: dateStr,
    travelMode: mode,
    departureHour: useHour,
    autoDeparture: auto,
    recommendedHour: bestDep ? bestDep.hour : null,
    recommendedMin: bestDep ? bestDep.min : null,
    route: {
      distanceKm: route.distance / 1000,
      durationMin: route.duration / 60,
      approx: !!route.approx,
      profile: route.profile,
      arriveHour: useHour + route.duration / 3600,
    },
    points,
    routeScore,
    avgScore,
    level: routeLevel,
    worstIndex,
    riskyCount: risky.length,
    cautionCount,
    badCount,
    advice: buildNavAdvice(points, route, useHour, mode),
  };
}

function buildNavAdvice(points, route, departHour, mode) {
  const out = [];
  const maxPP = Math.max(...points.map(p => p.pp ?? 0));
  const hasStorm = points.some(p => wmoSev(p.code) >= 25);
  const maxElev = Math.max(...points.filter(p => p.elev != null).map(p => p.elev));
  const minTemp = Math.min(...points.filter(p => p.temp != null).map(p => p.temp));
  const worst = points[argmin(points.map(p => p.score))];

  const pad2 = n => String(n).padStart(2, '0');
  const arriveH = departHour + route.duration / 3600;
  out.push(`建议 ${pad2(Math.floor(departHour))}:00 出发，预计 ${pad2(Math.floor(arriveH % 24))}:${pad2(Math.round((arriveH % 1) * 60))} 抵达终点`);

  if (worst && worst.score < 60) {
    out.push(`风险最高路段在第 ${points.indexOf(worst) + 1} 个采样点附近（${worst.cumKm.toFixed(0)} km 处），预计 ${pad2(worst.hour)}:00 到达`);
  }
  if (maxPP >= 50) out.push('沿途有较高降水概率，注意山路湿滑');
  if (hasStorm) out.push('⚠️ 沿途有雷暴预报，山区避免午后通过');
  if (maxElev > 3000) out.push(`途经海拔 ${maxElev} m 的路段，明显更冷，注意保暖与高反`);
  if (isFinite(minTemp) && minTemp < 0) out.push('部分路段气温低于 0℃，注意路面结冰');
  if (mode === 'hike') out.push('徒步请按实际步行速度重新估算抵达时间，当前时长为公路网估算');
  if (route.approx) out.push('⚠️ 徒步/骑行时长按公路网估算，与实际步行/骑行速度差异较大');
  if (route.duration / 3600 > 4) out.push('全程超过 4 小时，建议中途安排休息并复核后段天气');
  out.push('时长按路网限速估算，山区实际车速通常更慢，建议按抵达时间预留 20–30% 余量');
  return out;
}

/* ---------------- 导出（供 node 测试） ---------------- */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { scoreHour, levelOf, analyze, analyzeNavigation, findBestDeparture, wmoText, WMO };
}
