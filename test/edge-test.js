/* ============================================================
 * 边界用例测试（合成数据，不联网）
 * 用法: node test/edge-test.js
 * ============================================================ */

const path = require('path');
global.todayStr = () => {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const { analyze, scoreHour, levelOf } = require(path.join(__dirname, '..', 'js', 'scoring.js'));

const DATE = '2030-01-01'; // 非今天，避免今日时刻过滤

/** 造一个点位序列；hourFn(k) 返回该小时的天气 */
function makeSeries(points, hourFn) {
  return points.map((p, pi) => ({
    name: p.name, lat: p.lat, lon: p.lon,
    hours: Array.from({ length: 24 }, (_, k) => {
      const base = hourFn(k, pi);
      return {
        time: `${DATE}T${String(k).padStart(2, '0')}:00`,
        hour: k,
        temp: base.temp ?? 18,
        appTemp: base.temp ?? 18,
        pp: base.pp ?? 0,
        precip: base.precip ?? 0,
        wind: base.wind ?? 5,
        dir: base.dir ?? 90,
        code: base.code ?? 0,
      };
    }),
  }));
}

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
}

const P3 = [
  { name: 'A', lat: 30, lon: 103 },
  { name: 'B', lat: 30.1, lon: 102.8 },
  { name: 'C', lat: 30.2, lon: 102.6 },
];

console.log('【用例1】理想天气 —— 应 100 分、窗存在');
{
  const s = makeSeries(P3, () => ({ temp: 20, pp: 0, precip: 0, wind: 5, code: 0 }));
  const r = analyze(s, [500, 800, 1200], DATE, 'drive');
  console.log(`  路线分=${r.routeScore} 等级=${r.level.text} 窗口=${r.window.exists ? r.window.startHour + '-' + r.window.endHour : '无'}`);
  check('路线分为 100', r.routeScore === 100, String(r.routeScore));
  check('等级为适宜', r.level.text === '适宜');
  check('存在最佳窗口', r.window.exists === true);
  check('窗口长度 ≤6h', (r.window.endHour - r.window.startHour) <= 6);
  check('无扣分项', r.points.every(p => p.deductions.length === 0));
}

console.log('\n【用例2】全天雷暴 —— 应无窗口、走降级分支');
{
  const s = makeSeries(P3, () => ({ temp: 18, pp: 95, precip: 9, wind: 30, code: 95 }));
  const r = analyze(s, [500, 800, 1200], DATE, 'drive');
  console.log(`  路线分=${r.routeScore} 等级=${r.level.text} 窗口存在=${r.window.exists}`);
  check('路线分 <40', r.routeScore < 40, String(r.routeScore));
  check('等级为不建议', r.level.text === '不建议');
  check('窗口不存在', r.window.exists === false);
  check('给出最接近时段', typeof r.window.nearestHour === 'number');
  check('给出瓶颈点位', typeof r.window.bottleneckName === 'string');
  check('建议中包含改期提示', r.advice.some(a => a.includes('改期')));
}

console.log('\n【用例3】只有上午安全 —— 窗口应落在上午');
{
  // 0-11 点好，12 点后雷暴
  const s = makeSeries(P3, (k) => (k < 12 ? { temp: 18, pp: 5, precip: 0, wind: 6, code: 1 }
                                          : { temp: 18, pp: 95, precip: 9, wind: 30, code: 95 }));
  const r = analyze(s, [500, 800, 1200], DATE, 'drive');
  console.log(`  窗口=${r.window.startHour}-${r.window.endHour} 评估时刻=${r.chosenHour}`);
  check('窗口存在', r.window.exists === true);
  check('窗口结束 ≤12 点', r.window.endHour <= 12, `${r.window.endHour}`);
  check('评估时刻在上午', r.chosenHour < 12, String(r.chosenHour));
}

console.log('\n【用例4】最差点位并列时取海拔更高者');
{
  // 三个点天气完全相同 → 分数相同 → 应选海拔最高的 C
  const s = makeSeries(P3, () => ({ temp: 18, pp: 50, precip: 1, wind: 20, code: 61 }));
  const r = analyze(s, [500, 800, 3000], DATE, 'drive');
  const worst = r.points[r.worstIndex];
  console.log(`  最差点=${worst.name} 海拔=${worst.elev} 分=${worst.score}`);
  check('最差点为海拔最高的 C', worst.name === 'C', worst.name);
}

console.log('\n【用例5】高海拔额外扣分');
{
  const low = scoreHour({ pp: 0, precip: 0, wind: 5, temp: 18, code: 0 }, 500);
  const high = scoreHour({ pp: 0, precip: 0, wind: 5, temp: 18, code: 0 }, 3500);
  console.log(`  500m=${low.score}分  3500m=${high.score}分`);
  check('高海拔得分更低', high.score < low.score);
  check('高海拔有扣分说明', high.deductions.some(d => d.label.includes('高海拔')));
}

console.log('\n【用例6】等级边界');
{
  const cases = [[100, '适宜'], [80, '适宜'], [79, '一般'], [60, '一般'], [59, '谨慎'], [40, '谨慎'], [39, '不建议'], [0, '不建议']];
  cases.forEach(([v, exp]) => check(`分数 ${v} → ${exp}`, levelOf(v).text === exp, levelOf(v).text));
}

console.log('\n【用例7】可解释性 —— 低于 80 分必须有扣分项');
{
  const s = makeSeries(P3, (k) => ({ temp: 18, pp: k < 12 ? 5 : 70, precip: k < 12 ? 0 : 3, wind: 8, code: k < 12 ? 1 : 63 }));
  const r = analyze(s, [500, 800, 1200], DATE, 'drive');
  const ok = r.points.every(p => p.score >= 80 || p.deductions.length > 0);
  check('所有 <80 分的点都有扣分项', ok);
  const allHourlyOk = r.points.every(p => p.hourly.every(h => h.score >= 80 || h.deductions.length > 0));
  check('逐小时也满足可解释性', allHourlyOk);
}

console.log('\n【用例8】今天 + 已过时刻应被过滤');
{
  const today = global.todayStr();
  const s = P3.map(p => ({
    name: p.name, lat: p.lat, lon: p.lon,
    hours: Array.from({ length: 24 }, (_, k) => ({
      time: `${today}T${String(k).padStart(2, '0')}:00`, hour: k,
      temp: 18, appTemp: 18, pp: 0, precip: 0, wind: 5, dir: 90, code: 0,
    })),
  }));
  const r = analyze(s, [500, 800, 1200], today, 'drive');
  const nowHour = new Date().getHours();
  if (nowHour > 0) {
    console.log(`  当前 ${nowHour} 点，剩余小时数=${r ? r.points[0].hourly.length : 'null'}`);
    if (r) check('已过时刻被过滤', r.points[0].hourly.every(h => h.hour >= nowHour));
    else check('已过时刻被过滤（无可评估时段时返回 null，可接受）', true);
  } else {
    console.log('  当前为 0 点，跳过');
  }
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
