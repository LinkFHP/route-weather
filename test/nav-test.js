/* ============================================================
 * 导航模式测试（合成数据，不联网）
 * 用法: node test/nav-test.js
 * ============================================================ */

const path = require('path');
const { GEO } = require(path.join(__dirname, '..', 'js', 'routing.js'));
const { analyzeNavigation, findBestDeparture } = require(path.join(__dirname, '..', 'js', 'scoring.js'));

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${extra !== undefined ? ' — ' + extra : ''}`); }
}

/* ---------- 用例1：等距采样 ---------- */
console.log('【用例1】沿路径等距采样');
{
  // 一条自西向东的直线，几何点疏密故意不均
  const coords = [
    { lat: 30, lon: 100.0 },
    { lat: 30, lon: 100.01 },
    { lat: 30, lon: 100.02 },
    { lat: 30, lon: 101.0 },
    { lat: 30, lon: 102.0 },
  ];
  const s = GEO.sampleAlong(coords, 5);
  console.log('  采样点数:', s.length);
  s.forEach(p => console.log(`    ratio=${p.ratio.toFixed(2)} 累积 ${p.cumKm.toFixed(1)} km`));
  check('返回 5 个点', s.length === 5);
  check('首点 ratio=0', s[0].ratio === 0);
  check('末点 ratio=1', s[4].ratio === 1);
  check('首点经度≈100.0', Math.abs(s[0].lon - 100.0) < 1e-6, s[0].lon);
  check('末点经度≈102.0', Math.abs(s[4].lon - 102.0) < 1e-6, s[4].lon);
  // 等距：相邻累积里程差近似相等
  const gaps = [];
  for (let i = 1; i < s.length; i++) gaps.push(s[i].cumKm - s[i - 1].cumKm);
  const maxGap = Math.max(...gaps), minGap = Math.min(...gaps);
  console.log(`  相邻间距 min=${minGap.toFixed(2)} max=${maxGap.toFixed(2)} km`);
  check('相邻间距近似相等', (maxGap - minGap) / maxGap < 0.02, `${minGap.toFixed(2)} vs ${maxGap.toFixed(2)}`);
}

/* ---------- 构造天气序列 ---------- */
const PAD = n => String(n).padStart(2, '0');
function makeSeries(nSamples, hourFn, hours = 48) {
  const out = [];
  for (let i = 0; i < nSamples; i++) {
    const hoursArr = [];
    for (let k = 0; k < hours; k++) {
      const w = hourFn(k, i);
      hoursArr.push({
        time: `2030-01-01T${PAD(k % 24)}:00`, hour: k % 24,
        temp: w.temp ?? 18, appTemp: w.temp ?? 18,
        pp: w.pp ?? 0, precip: w.precip ?? 0,
        wind: w.wind ?? 5, dir: 90, code: w.code ?? 0,
      });
    }
    out.push({ name: `点${i + 1}`, lat: 30 + i * 0.1, lon: 101, hours: hoursArr });
  }
  return out;
}

const SAMPLES = [0, 1, 2, 3, 4, 5].map(i => ({
  name: `点${i + 1}`, lat: 30 + i * 0.1, lon: 101,
  ratio: i / 5, cumKm: i * 20,
}));
const ELEVS = SAMPLES.map(() => 800);
const ROUTE_8H = { distance: 120000, duration: 8 * 3600, approx: false, profile: 'driving' };

/* ---------- 用例2：到达时刻偏移（核心） ---------- */
console.log('\n【用例2】每个采样点应按「到达时刻」取天气，而不是统一用出发时刻');
{
  // 0–3 时雷暴，4 时起放晴
  const storm = { pp: 95, precip: 9, wind: 30, code: 95, temp: 12 };
  const clear = { pp: 0, precip: 0, wind: 5, code: 0, temp: 20 };
  const series = makeSeries(6, k => (k < 4 ? storm : clear));

  const r = analyzeNavigation(series, ELEVS, SAMPLES, ROUTE_8H, 0, '2030-01-01', 'drive');
  console.log('  出发 00:00，总时长 8h');
  r.points.forEach(p => console.log(
    `    ${p.name} ratio=${p.ratio.toFixed(1)} 到达 ${PAD(p.hour)}:00(+${p.dayOffset}天) ${p.score}分 ${p.level.text}`));

  check('首个采样点（刚出发）分数很低', r.points[0].score < 40, r.points[0].score);
  check('末个采样点（8h 后）分数很高', r.points[5].score > 80, r.points[5].score);
  check('末点到达小时 = 8', r.points[5].hour === 8, r.points[5].hour);
  check('末点 dayOffset = 0', r.points[5].dayOffset === 0, r.points[5].dayOffset);
  check('路线分 = 各点最低分', r.routeScore === Math.min(...r.points.map(p => p.score)));
  check('大部分采样点分数应高于首点', r.points.filter(p => p.score > 80).length >= 3,
    r.points.filter(p => p.score > 80).length);
}

/* ---------- 用例3：跨零点到达 ---------- */
console.log('\n【用例3】出发太晚，后段到达时刻跨过零点');
{
  const series = makeSeries(6, () => ({ pp: 0, precip: 0, wind: 5, code: 0, temp: 18 }));
  const r = analyzeNavigation(series, ELEVS, SAMPLES, ROUTE_8H, 20, '2030-01-01', 'drive');
  console.log('  出发 20:00，总时长 8h');
  r.points.forEach(p => console.log(
    `    ${p.name} 到达 ${PAD(p.hour)}:00 (+${p.dayOffset}天)`));
  check('末点到达小时 = 4', r.points[5].hour === 4, r.points[5].hour);
  check('末点 dayOffset = 1（跨日）', r.points[5].dayOffset === 1, r.points[5].dayOffset);
  check('跨日仍能取到数据（未越界）', r.points[5].score >= 0);
}

/* ---------- 用例4：推荐出发时刻 ---------- */
console.log('\n【用例4】推荐出发时刻应避开雷暴窗口');
{
  const storm = { pp: 95, precip: 9, wind: 30, code: 95, temp: 12 };
  const clear = { pp: 0, precip: 0, wind: 5, code: 0, temp: 20 };
  const series = makeSeries(6, k => (k < 4 ? storm : clear));

  const best = findBestDeparture(SAMPLES, series, ELEVS, ROUTE_8H.duration);
  console.log(`  推荐出发 ${PAD(best.hour)}:00，全程最低分 ${best.min}`);
  check('推荐时刻 ≥ 3（避开 0–3 时雷暴）', best.hour >= 3, best.hour);
  check('推荐时刻的最低温饱分高于 0 点出发', best.min > 0, best.min);

  const auto = analyzeNavigation(series, ELEVS, SAMPLES, ROUTE_8H, -1, '2030-01-01', 'drive');
  console.log(`  自动模式选用 ${PAD(auto.departureHour)}:00（推荐 ${PAD(auto.recommendedHour)}:00）`);
  check('传 -1 时自动采用推荐时刻', auto.departureHour === best.hour, `${auto.departureHour} vs ${best.hour}`);
  check('标记为自动', auto.autoDeparture === true);
}

/* ---------- 用例5：徒步/骑行需标注为近似 ---------- */
console.log('\n【用例5】徒步/骑行的路径为近似');
{
  const series = makeSeries(6, () => ({ pp: 0, precip: 0, wind: 5, code: 0, temp: 18 }));
  const approxRoute = { distance: 120000, duration: 8 * 3600, approx: true, profile: 'foot' };
  const r = analyzeNavigation(series, ELEVS, SAMPLES, approxRoute, 8, '2030-01-01', 'hike');
  const hasWarn = r.advice.some(a => a.includes('公路网估算'));
  console.log('  提示:', r.advice.find(a => a.includes('公路网')) || '(无)');
  check('approx=true 时给出估算提示', hasWarn);
  check('route.approx 透传', r.route.approx === true);
}

/* ---------- 用例6：风险路段统计 ---------- */
console.log('\n【用例6】风险路段计数');
{
  // 第 0、1 个点在雷暴窗口内
  const storm = { pp: 95, precip: 9, wind: 30, code: 95, temp: 12 };
  const clear = { pp: 0, precip: 0, wind: 5, code: 0, temp: 20 };
  const series = makeSeries(6, k => (k < 4 ? storm : clear));
  const r = analyzeNavigation(series, ELEVS, SAMPLES, ROUTE_8H, 0, '2030-01-01', 'drive');
  console.log(`  低于 60 分的采样点: ${r.riskyCount} 个（其中 <40: ${r.badCount}）`);
  check('riskyCount = 分数<60 的点数', r.riskyCount === r.points.filter(p => p.score < 60).length);
  check('badCount = 分数<40 的点数', r.badCount === r.points.filter(p => p.score < 40).length);
  check('riskyCount > 0（本例确实有风险段）', r.riskyCount > 0);
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
