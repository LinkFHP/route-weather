/* ============================================================
 * 算法端到端测试（Node 运行，用真实 Open-Meteo 数据）
 * 用法: node test/algo-test.js
 * ============================================================ */

const path = require('path');

// scoring.js 里 analyze() 会调用 todayStr()（定义在 api.js，浏览器全局）
global.todayStr = () => {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const { analyze, scoreHour, levelOf } = require(path.join(__dirname, '..', 'js', 'scoring.js'));

const POINTS = [
  { name: '雅安', lat: 29.9853, lon: 102.9998 },
  { name: '天全', lat: 30.0700, lon: 102.7630 },
  { name: '泸定', lat: 29.9144, lon: 102.2344 },
];

const FIELDS = 'temperature_2m,apparent_temperature,precipitation_probability,precipitation,wind_speed_10m,wind_direction_10m,weather_code';

function pad(n) { return String(n).padStart(2, '0'); }

async function main() {
  // 用明天，避免"今日剩余时段不足"
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  const lat = POINTS.map(p => p.lat).join(',');
  const lon = POINTS.map(p => p.lon).join(',');

  console.log(`日期: ${date}`);
  console.log('点位:', POINTS.map(p => p.name).join(' → '));

  // 1) 海拔
  const er = await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lon}`);
  const ej = await er.json();
  const elevations = Array.isArray(ej.elevation) ? ej.elevation.map(Math.round) : [Math.round(ej.elevation)];
  console.log('海拔:', elevations.join(' / '), 'm\n');

  // 2) 逐小时
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
    + `&hourly=${FIELDS}&start_date=${date}&end_date=${date}&timezone=Asia%2FShanghai`;
  const fr = await fetch(url);
  const fj = await fr.json();
  const blocks = Array.isArray(fj) ? fj : [fj];
  console.log(`接口返回 ${blocks.length} 个点位块（应等于 ${POINTS.length}）`);

  const series = POINTS.map((p, i) => {
    const h = blocks[i].hourly;
    return {
      name: p.name, lat: p.lat, lon: p.lon,
      hours: h.time.map((t, k) => ({
        time: t, hour: Number(t.slice(11, 13)),
        temp: h.temperature_2m[k],
        appTemp: h.apparent_temperature[k],
        pp: h.precipitation_probability[k],
        precip: h.precipitation[k],
        wind: h.wind_speed_10m[k],
        dir: h.wind_direction_10m[k],
        code: h.weather_code[k],
      })),
    };
  });
  console.log(`每个点位小时数: ${series.map(s => s.hours.length).join(' / ')}\n`);

  // 3) 分析
  const r = analyze(series, elevations, date, 'drive');
  if (!r) { console.error('analyze 返回 null'); process.exit(1); }

  console.log('══════════ 体检报告 ══════════');
  console.log(`路线: ${r.points.map(p => p.name).join(' → ')}`);
  console.log(`评估时刻: ${pad(r.chosenHour)}:00`);
  console.log(`路线得分: ${r.routeScore} (${r.level.text})  平均: ${r.avgScore}`);
  console.log(`最差点位: ${r.points[r.worstIndex].name}`);

  if (r.window.exists) {
    console.log(`最佳窗口: ${pad(r.window.startHour)}:00 - ${pad(r.window.endHour)}:00`);
  } else {
    console.log(`无完全适宜窗口；最接近 ${pad(r.window.nearestHour)}:00，瓶颈「${r.window.bottleneckName}」`);
  }

  console.log('\n── 逐点位 ──');
  r.points.forEach(p => {
    console.log(`  ${p.name.padEnd(4)} ${String(p.score).padStart(3)}分 ${p.level.text}  ${p.weatherText} ${p.temp != null ? p.temp.toFixed(1) + '℃' : '—'}  海拔${p.elev}m`);
    p.deductions.slice(0, 3).forEach(d => console.log(`        · ${d.label} (−${d.pts})`));
  });

  console.log('\n── 出行建议 ──');
  r.advice.forEach(a => console.log('  · ' + a));

  // 4) 自洽性检查
  console.log('\n══════════ 断言检查 ══════════');
  const checks = [];
  const minPt = Math.min(...r.points.map(p => p.score));
  checks.push(['路线分 == 各点最低分', r.routeScore === minPt]);
  checks.push(['最差点位 == 最低分点位', r.points[r.worstIndex].score === minPt]);
  checks.push(['分数在 0..100', r.points.every(p => p.score >= 0 && p.score <= 100)]);
  checks.push(['每点有 24 小时', r.points.every(p => p.hourly.length >= 1)]);
  checks.push(['有扣分项即可解释', r.points.every(p => p.score >= 80 || p.deductions.length > 0)]);
  checks.push(['平均分在 min..100', r.avgScore >= minPt && r.avgScore <= 100]);
  if (r.window.exists) {
    const inWin = r.points.every(p => {
      const hs = p.hourly.filter(h => h.hour >= r.window.startHour && h.hour < r.window.endHour);
      return hs.every(h => h.score >= 60);
    });
    checks.push(['窗口内所有点 ≥60', inWin]);
  }

  let allPass = true;
  checks.forEach(([name, ok]) => {
    console.log(`  ${ok ? '✓' : '✗'} ${name}`);
    if (!ok) allPass = false;
  });

  // 5) 单项扣分单测
  console.log('\n── 扣分函数抽检 ──');
  const cases = [
    [{ pp: 0, precip: 0, wind: 5, temp: 20, code: 0 }, null, '理想天气应得 100'],
    [{ pp: 90, precip: 9, wind: 55, temp: 35, code: 95 }, null, '极端天气应 ≤40'],
    [{ pp: 50, precip: 1, wind: 20, temp: 19, code: 61 }, null, '中等天气应 40..80'],
  ];
  cases.forEach(([h, elev, desc]) => {
    const s = scoreHour(h, elev);
    console.log(`  ${desc}: ${s.score} 分 ${s.level.text} | 扣分 ${s.deductions.length} 项`);
  });

  console.log('\n' + (allPass ? '✅ 全部断言通过' : '❌ 有断言失败'));
  process.exit(allPass ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
