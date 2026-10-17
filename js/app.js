/* ============================================================
 * 应用层：视图路由、点位编辑、报告渲染
 * ============================================================ */

const state = {
  view: 'home',
  date: todayStr(),
  mode: 'drive',
  checkMode: 'point',   // point | nav
  departHour: -1,       // -1 = 自动推荐
  points: [],           // [{name, lat, lon}]
  currentReport: null,
  expandIdx: -1,
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

/* ---------------- 视图切换 ---------------- */

function showView(name) {
  state.view = name;
  $$('.view').forEach(v => v.classList.remove('active'));
  $('#view-' + name).classList.add('active');
  const titles = { home: '路线天气体检', create: '新建行程', report: '体检报告' };
  $('#topTitle').textContent = titles[name] || '路线天气体检';
  window.scrollTo({ top: 0 });
  // 地图容器刚显示时尺寸为 0，必须等布局完成后再初始化/重算
  if (name === 'create') {
    requestAnimationFrame(() => {
      ensureCreateMap();
      MapCtl.refresh('create');
    });
  }
  if (name === 'report') MapCtl.refresh('report');
}

/* ---------------- Toast ---------------- */

let toastTimer = null;
function toast(msg, ms = 2200) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), ms);
}

/** 立刻收起提示（切换出行方式时用，避免残留旧文案） */
function hideToast() {
  clearTimeout(toastTimer);
  const el = $('#toast');
  if (el) el.classList.add('hidden');
}

/* ============================================================
 * 首页
 * ============================================================ */

function renderHome() {
  const list = loadHistory();
  const listEl = $('#historyList');

  if (!list.length) {
    $('#homeEmpty').classList.remove('hidden');
    $('#homeList').classList.add('hidden');
    return;
  }
  $('#homeEmpty').classList.add('hidden');
  $('#homeList').classList.remove('hidden');

  listEl.innerHTML = list.map(t => {
    const lv = levelOf(t.routeScore ?? 0);
    return `
      <div class="card trip" data-id="${t.id}">
        <div class="trip-main">
          <div class="trip-route">${escapeHtml(t.routeName)}</div>
          <div class="trip-meta">${t.date} · ${modeText(t.mode)}</div>
        </div>
        <div class="trip-score">
          <div class="score-num ${lv.key}">${t.routeScore}</div>
          <div class="score-lv ${lv.key}">${lv.text}</div>
        </div>
      </div>`;
  }).join('');

  $$('#historyList .trip').forEach(el => {
    el.addEventListener('click', () => openTrip(el.dataset.id));
  });
}

function modeText(m) {
  return ({ drive: '自驾', hike: '徒步', bike: '骑行' })[m] || '自驾';
}

/* ============================================================
 * 创建行程
 * ============================================================ */

function initCreate() {
  const d = $('#inpDate');
  d.value = state.date;
  d.min = todayStr();
  d.max = addDays(todayStr(), 15);
  d.addEventListener('change', () => { state.date = d.value; });

  $$('#segMode button').forEach(b => {
    b.addEventListener('click', () => {
      $$('#segMode button').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      state.mode = b.dataset.mode;
      // 徒步/骑行：OSRM 公共服务器只有汽车路网，必须提前告知
      // 注意要点明是「哪种方式」的估算，且切回自驾时不应残留提示
      const spd = ROUTING.SPEED[state.mode];
      if (spd) {
        const label = state.mode === 'hike' ? '徒步' : '骑行';
        toast(`${label}模式：路线按公路网规划，时长按 ${spd} km/h 估算`, 3200);
      } else {
        hideToast();   // 切回自驾时立刻收起旧提示
      }
    });
  });

  $('#btnAddPoint').addEventListener('click', () => openSheet());
  $('#btnDemo').addEventListener('click', () => {
    state.points = DEMO_ROUTE.map(n => findPointByName(n)).filter(Boolean)
      .map(p => ({ name: p.name, lat: p.lat, lon: p.lon }));
    renderPointList();
    toast('已载入示例路线：雅安 → 天全 → 泸定');
  });

  $('#btnAddCoord').addEventListener('click', () => {
    const lat = parseFloat($('#inpLat').value);
    const lon = parseFloat($('#inpLon').value);
    const name = ($('#inpName').value || '').trim();
    if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      toast('请输入有效的纬度和经度'); return;
    }
    if (state.points.length >= 5) { toast('最多 5 个点位'); return; }
    state.points.push({ name: name || `点位${state.points.length + 1}`, lat, lon });
    $('#inpLat').value = ''; $('#inpLon').value = ''; $('#inpName').value = '';
    renderPointList();
    toast('已添加');
  });

  $('#btnCheckup').addEventListener('click', runCheckup);

  // 体检模式切换
  $$('#segCheckMode button').forEach(b => {
    b.addEventListener('click', () => {
      $$('#segCheckMode button').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      state.checkMode = b.dataset.check;
      applyCheckModeUI();
    });
  });

  // 出发时刻下拉
  const sel = $('#selDepart');
  sel.innerHTML = '<option value="-1">自动推荐</option>'
    + Array.from({ length: 24 }, (_, h) =>
        `<option value="${h}">${String(h).padStart(2, '0')}:00</option>`).join('');
  sel.addEventListener('change', () => { state.departHour = Number(sel.value); });

  applyCheckModeUI();
  renderPointList();
}

/** 根据体检模式切换界面文案与可见字段 */
function applyCheckModeUI() {
  const nav = state.checkMode === 'nav';
  $('#fieldDepart').classList.toggle('hidden', !nav);
  $('#modeDesc').textContent = nav
    ? '先规划路径，再沿路等距采样，按「预计到达该点的那一刻」的天气逐点评分。'
    : '按你输入的固定点位评估，所有点位取同一时刻的天气。';
  $('#btnCheckup').textContent = nav ? '导航并体检' : '开始体检';
  const lbl = document.querySelector('#pointList')?.closest('.field')?.querySelector('label');
  if (lbl) {
    lbl.innerHTML = nav
      ? '起点与终点 <span class="small">（中间可加途经点，最多 5 个）</span>'
      : '路线点位 <span class="small">（起点 → 途经点 → 终点，最多 5 个）</span>';
  }
}

/** 新建页地图是惰性的：只在视图可见时创建/重建，避免在 display:none 容器上初始化 Leaflet */
let createMapDirty = true;
let lastCreateSig = '';

function markCreateMapDirty() {
  createMapDirty = true;
  if (state.view === 'create') ensureCreateMap();
}

function ensureCreateMap() {
  if (state.view !== 'create') return;
  const sig = state.points.map(p => `${p.lat},${p.lon}`).join('|');
  if (!createMapDirty && MapCtl.create && sig === lastCreateSig) return;
  createMapDirty = false;
  lastCreateSig = sig;

  MapCtl.renderCreate('createMap', state.points.map(p => ({ name: p.name, lat: p.lat, lon: p.lon })), (lat, lon) => {
    if (state.points.length >= 5) { toast('最多 5 个点位'); return; }
    state.points.push({ name: `点位${state.points.length + 1}`, lat, lon });
    renderPointList();
    toast('已在地图上添加点位');
  });
}

function renderPointList() {
  const el = $('#pointList');
  if (!state.points.length) {
    el.innerHTML = `<div class="empty-inline">还没有点位，点「载入示例路线」或「添加点位」</div>`;
    return;
  }
  el.innerHTML = state.points.map((p, i) => {
    const role = i === 0 ? '起点' : (i === state.points.length - 1 ? '终点' : '途经');
    const roleCls = i === 0 ? 'start' : (i === state.points.length - 1 ? 'end' : 'mid');
    return `
      <div class="pt-row">
        <span class="pt-role ${roleCls}">${role}</span>
        <span class="pt-name">${escapeHtml(p.name)}</span>
        <span class="pt-coord">${p.lat.toFixed(2)}, ${p.lon.toFixed(2)}</span>
        <button class="pt-del" data-i="${i}" aria-label="删除">✕</button>
      </div>`;
  }).join('');

  $$('#pointList .pt-del').forEach(b => {
    b.addEventListener('click', () => {
      state.points.splice(Number(b.dataset.i), 1);
      renderPointList();
    });
  });
  markCreateMapDirty();
}
/* ---------------- 点位选择弹层 ---------------- */

let sheetRegion = '全部';

function openSheet() {
  if (state.points.length >= 5) { toast('最多 5 个点位'); return; }
  $('#sheet').classList.remove('hidden');
  $('#sheetSearch').value = '';
  const rb = $('#sheetRemote');
  if (rb) rb.innerHTML = '';
  remoteToken++;
  renderSheetRegions();
  renderSheetList();
}

function closeSheet() {
  $('#sheet').classList.add('hidden');
  clearTimeout(remoteTimer);
  remoteToken++;
  const rb = $('#sheetRemote');
  if (rb) rb.innerHTML = '';
}

/* ---------------- 全国地名搜索（天地图） ---------------- */

let remoteToken = 0;
let remoteTimer = null;
const REMOTE_MIN_LEN = 2;

/** 输入变化时做防抖，避免每敲一个字就发请求（天地图免费额度有限） */
function scheduleRemoteSearch() {
  clearTimeout(remoteTimer);
  const box = $('#sheetRemote');
  if (!box) return;

  const kw = ($('#sheetSearch').value || '').trim();

  if (kw.length < REMOTE_MIN_LEN) {
    box.innerHTML = '';
    remoteToken++;
    return;
  }
  if (!Geocode.enabled) {
    box.innerHTML = '';
    return;
  }

  box.innerHTML = `<div class="remote-hint">正在搜索「${escapeHtml(kw)}」…</div>`;
  remoteTimer = setTimeout(() => runRemoteSearch(kw), 450);
}

async function runRemoteSearch(kw) {
  const box = $('#sheetRemote');
  if (!box) return;
  const my = ++remoteToken;
  const list = await Geocode.search(kw);
  if (my !== remoteToken || !box.isConnected) return;

  if (list === null) {
    box.innerHTML = `<div class="remote-hint err">地名搜索失败（网络或额度限制）。可在下面选内置点位，或用「手动输入坐标」。</div>`;
    return;
  }
  if (!list.length) {
    box.innerHTML = `<div class="remote-hint">没搜到「${escapeHtml(kw)}」，试试更完整的名称（如「稻城亚丁」「上海外滩」）</div>`;
    return;
  }

  box.innerHTML = `<div class="remote-title">全国搜索 · 天地图</div>` + list.map((it, i) => `
    <div class="remote-item" data-i="${i}">
      <span class="ri-dot"></span>
      <span class="ri-name">${escapeHtml(it.name)}</span>
      <span class="ri-coord">${it.lat.toFixed(3)}, ${it.lon.toFixed(3)}</span>
      <span class="ri-add">添加</span>
    </div>`).join('');

  $$('#sheetRemote .remote-item').forEach(el => {
    el.addEventListener('click', () => {
      const it = list[Number(el.dataset.i)];
      if (!it) return;
      if (state.points.length >= 5) { toast('最多 5 个点位'); return; }
      state.points.push({ name: it.name, lat: it.lat, lon: it.lon });
      renderPointList();
      closeSheet();
      toast('已添加：' + it.name);
    });
  });
}

function renderSheetRegions() {
  $('#sheetRegions').innerHTML = REGIONS.map(r =>
    `<button class="chip ${r === sheetRegion ? 'on' : ''}" data-r="${r}">${r}</button>`
  ).join('');
  $$('#sheetRegions .chip').forEach(b => {
    b.addEventListener('click', () => {
      sheetRegion = b.dataset.r;
      renderSheetRegions();
      renderSheetList();
    });
  });
}

function renderSheetList() {
  const kw = $('#sheetSearch').value;
  const items = searchPoints(kw, sheetRegion);
  const el = $('#sheetList');
  if (!items.length) { el.innerHTML = `<div class="empty-inline">没有匹配的点位</div>`; return; }

  el.innerHTML = items.map(p => {
    const used = state.points.some(x => x.name === p.name);
    return `<div class="sheet-item ${used ? 'used' : ''}" data-name="${escapeHtml(p.name)}">
      <span class="si-name">${escapeHtml(p.name)}</span>
      <span class="si-region">${p.region}</span>
      ${used ? '<span class="si-used">已选</span>' : ''}
    </div>`;
  }).join('');

  $$('#sheetList .sheet-item').forEach(el2 => {
    el2.addEventListener('click', () => {
      const name = el2.dataset.name;
      const p = findPointByName(name);
      if (!p) return;
      if (state.points.length >= 5) { toast('最多 5 个点位'); return; }
      state.points.push({ name: p.name, lat: p.lat, lon: p.lon });
      renderPointList();
      closeSheet();
      toast('已添加：' + p.name);
    });
  });
}

/* ============================================================
 * 执行体检
 * ============================================================ */

function skeletonHtml(msg) {
  return `
    <div class="card skeleton">
      <div class="sk-line sk-map"></div>
      <div class="sk-line sk-score"></div>
      <div class="sk-line" style="width:78%"></div>
      <div class="sk-line" style="width:54%"></div>
    </div>
    <div class="card skeleton">
      <div class="sk-line" style="width:40%"></div>
      <div class="sk-line"></div>
      <div class="sk-line" style="width:66%"></div>
    </div>
    <p class="hint">${escapeHtml(msg)}</p>`;
}

function errHtml(title, sub) {
  return `
    <div class="errbox">
      <p>😕 ${escapeHtml(title)}</p>
      <p class="small">${escapeHtml(sub || '')}</p>
      <button class="btn btn-ghost" onclick="showView('create')">返回修改</button>
    </div>`;
}

/** 统一入口：按体检模式分发 */
async function runCheckup() {
  if (state.points.length < 2) { toast('至少需要 2 个点位（起点和终点）'); return; }
  if (state.checkMode === 'nav') return checkupNavigation();
  return checkupPoints();
}

/* ---------------- 点位模式 ---------------- */

async function checkupPoints() {
  const btn = $('#btnCheckup');
  btn.disabled = true;
  btn.textContent = '体检中…';
  showView('report');
  $('#reportBody').innerHTML = skeletonHtml(`正在获取 ${state.points.length} 个点位的逐小时预报…`);

  try {
    const [series, elevations] = await Promise.all([
      fetchHourly(state.points, state.date),
      fetchElevations(state.points),
    ]);

    if (!series.ok || !series.series.length) {
      $('#reportBody').innerHTML = `
        <div class="errbox">
          <p>😕 暂时取不到天气数据</p>
          <p class="small">可能是网络问题，或该日期超出预报范围（通常未来 16 天内）。</p>
          <button class="btn btn-ghost" onclick="showView('create')">返回修改</button>
        </div>`;
      return;
    }

    const report = analyze(series.series, elevations, state.date, state.mode);
    if (!report) {
      $('#reportBody').innerHTML = `
        <div class="errbox">
          <p>😕 该日期已无可用时段</p>
          <p class="small">如果选的是今天，今日剩余时段可能不足。请换个日期试试。</p>
          <button class="btn btn-ghost" onclick="showView('create')">返回修改</button>
        </div>`;
      return;
    }

    report.stale = series.stale;
    report.fetchedAt = series.at;
    state.currentReport = report;
    state.expandIdx = -1;
    renderReport(report, series.stale);

    // 存入本机历史
    const trip = {
      id: newTripId(),
      date: state.date,
      mode: state.mode,
      points: state.points.slice(),
      routeName: state.points.map(p => p.name).join(' → '),
      routeScore: report.routeScore,
      worstName: report.points[report.worstIndex].name,
      worstElev: report.points[report.worstIndex].elev,
      advice: report.advice,
      window: report.window,
      savedAt: Date.now(),
    };
    upsertTrip(trip);
  } catch (e) {
    console.error(e);
    $('#reportBody').innerHTML = `
      <div class="errbox">
        <p>😕 出错了</p>
        <p class="small">${escapeHtml(String(e.message || e))}</p>
        <pre class="errstack">${escapeHtml(String(e.stack || '').split('\n').slice(0, 8).join('\n'))}</pre>
        <button class="btn btn-ghost" onclick="showView('create')">返回修改</button>
      </div>`;
  } finally {
    btn.disabled = false;
    applyCheckModeUI();
  }
}

/* ---------------- 导航模式 ---------------- */

async function checkupNavigation() {
  const btn = $('#btnCheckup');
  btn.disabled = true;
  btn.textContent = '规划中…';
  showView('report');
  $('#reportBody').innerHTML = skeletonHtml('正在规划路径…');

  try {
    // 1) 路径规划
    const route = await ROUTING.fetchRoute(state.points, state.mode);
    if (!route.ok) {
      $('#reportBody').innerHTML = errHtml('路径规划失败',
        route.error || '请确认起点与终点之间有可行道路，或稍后重试。');
      return;
    }

    // 1.5) 行程超出预报有效期 → 评估本身没有意义，直接拦下
    if (route.overHorizon) {
      const days = route.travelDays;
      const dist = (route.distance / 1000).toFixed(0);
      const spd = route.speedKmh ? `（按 ${route.speedKmh} km/h 估算）` : '';
      $('#reportBody').innerHTML = `
        <div class="errbox">
          <p>😕 这趟行程超出了天气预报的有效范围</p>
          <p class="small">
            ${modeText(state.mode)}模式 · 路网距离约 ${dist} km${spd}<br>
            预计需要约 <b>${days < 10 ? days.toFixed(1) : Math.round(days)} 天</b>，
            而本作品的评估只使用未来 ${route.horizonDays} 天的预报。
          </p>
          <p class="small" style="margin-top:12px">
            等你走到终点时，天气早已完全不同，这份体检没有参考意义。<br>
            建议：<b>换一条短一些的路线</b>，或改用<b>自驾</b>出行方式。
          </p>
          <button class="btn btn-ghost" onclick="showView('create')">返回修改</button>
        </div>`;
      return;
    }

    // 2) 沿路等距采样
    const n = GEO.sampleCountFor(route.duration);
    const raw = GEO.sampleAlong(route.coords, n);
    if (!raw.length) {
      $('#reportBody').innerHTML = errHtml('采样失败', '未能从路径中取到采样点。');
      return;
    }

    const first = state.points[0].name;
    const last = state.points[state.points.length - 1].name;
    const samples = raw.map((s, i) => ({
      lat: s.lat, lon: s.lon, ratio: s.ratio, cumKm: s.cumKm,
      name: i === 0 ? first
        : i === raw.length - 1 ? last
        : `途采${i}（${s.cumKm.toFixed(0)} km）`,
    }));

    $('#reportBody').innerHTML = skeletonHtml(
      `已规划 ${(route.distance / 1000).toFixed(0)} km / 约 ${(route.duration / 60).toFixed(0)} 分钟，`
      + `正在获取 ${samples.length} 个采样点的逐小时预报…`);

    // 3) 取两天数据（到达时刻可能跨零点）
    const pts = samples.map(s => ({ name: s.name, lat: s.lat, lon: s.lon }));
    const [series, elevations] = await Promise.all([
      fetchHourly(pts, state.date, 2),
      fetchElevations(pts),
    ]);
    if (!series.ok || !series.series.length) {
      $('#reportBody').innerHTML = errHtml('暂时取不到天气数据',
        '可能是网络问题，或该日期超出预报范围（通常未来 16 天内）。');
      return;
    }

    // 4) 按到达时刻逐点评分
    const report = analyzeNavigation(series.series, elevations, samples, route,
      state.departHour, state.date, state.mode);
    if (!report) {
      $('#reportBody').innerHTML = errHtml('数据不足', '该出发时刻附近没有可用的逐小时预报。');
      return;
    }

    report.stale = series.stale;
    report.fetchedAt = series.at;
    report.routeCoords = route.coords;
    state.currentReport = report;
    state.expandIdx = -1;
    renderNavReport(report, series.stale);

    upsertTrip({
      id: newTripId(),
      checkMode: 'nav',
      date: state.date,
      mode: state.mode,
      points: state.points.slice(),
      routeName: state.points.map(p => p.name).join(' → '),
      routeScore: report.routeScore,
      distanceKm: report.route.distanceKm,
      departureHour: report.departureHour,
      savedAt: Date.now(),
    });
  } catch (e) {
    console.error(e);
    $('#reportBody').innerHTML = errHtml('出错了', String(e.message || e));
  } finally {
    btn.disabled = false;
    applyCheckModeUI();
  }
}

/* ============================================================
 * 导航模式报告渲染
 * ============================================================ */

function renderNavReport(r, stale) {
  const lv = r.level;
  const p2 = n => String(Math.floor(n)).padStart(2, '0');
  const routeName = state.points.map(p => p.name).join(' → ');
  const worst = r.points[r.worstIndex];

  const arriveH = r.route.arriveHour;
  // 先把总分钟数取整，再拆成时/分，避免出现 13:60 这种非法时间
  const arriveTotalMin = Math.round(arriveH * 60);
  const arriveHM = Math.floor(arriveTotalMin / 60);
  const arriveClock = `${p2(arriveHM % 24)}:${p2(arriveTotalMin % 60)}`;
  // 具体日期：出发日为基准，加上跨过的天数
  const arriveDayOffset = Math.floor(arriveHM / 24);
  const arriveDate = addDays(r.date, arriveDayOffset);
  const arriveWeek = weekOf(arriveDate);
  const dayTag = arriveDayOffset === 0 ? '' : (arriveDayOffset === 1 ? ' · 次日' : ` · 第 ${arriveDayOffset + 1} 天`);
  const arriveText = `${arriveDate.replace(/-/g, '/')} ${arriveWeek} ${arriveClock}${dayTag}`;

  $('#reportBody').innerHTML = `
    <div class="card map-card">
      <div class="map-wrap">
        <div id="navMap" class="map map-report"></div>
        <button class="map-toggle" id="mapToggle" type="button">地形</button>
      </div>
      <div class="map-hint">连线为规划路径；圆点为沿路等距采样点，颜色 = 预计到达那一刻的适宜度 · 底图 © OpenStreetMap contributors</div>
    </div>

    <div class="card summary ${lv.key}">
      <div class="sum-date">${r.date} · ${modeText(r.travelMode)} · 导航模式</div>
      <div class="sum-route">${escapeHtml(routeName)}</div>

      <div class="sum-hero">
        <div class="sum-score ${lv.key}">${r.routeScore}</div>
        <div class="sum-lv">
          <div class="sum-lv-icon">${lv.icon}</div>
          <div class="sum-lv-text ${lv.key}">${lv.text}</div>
          <div class="sum-lv-short">${lv.short}</div>
        </div>
      </div>

      <div class="kv"><span class="kv-k">路网距离</span>
        <span class="kv-v strong">${r.route.distanceKm.toFixed(0)} km</span></div>
      <div class="kv"><span class="kv-k">预计时长${r.route.speedKmh ? `（按 ${r.route.speedKmh} km/h）` : ''}</span>
        <span class="kv-v">${fmtDuration(r.route.durationMin)}</span></div>
      <div class="kv"><span class="kv-k">出发时刻</span>
        <span class="kv-v strong">${p2(r.departureHour)}:00${r.autoDeparture ? '（自动推荐）' : ''}</span></div>
      <div class="kv"><span class="kv-k">预计抵达</span>
        <span class="kv-v">${arriveText}</span></div>
      <div class="kv"><span class="kv-k">风险采样点</span>
        <span class="kv-v">${r.riskyCount} / ${r.points.length} 个低于 60 分</span></div>
      <div class="kv"><span class="kv-k">最差路段</span>
        <span class="kv-v">${escapeHtml(worst.name)} · ${p2(worst.hour)}:00 到达 · ${worst.score} 分</span></div>

      <div class="explain">
        路线得分取<b>各采样点中的最低分</b>——整条行程的安全性由最差的那一段决定。<br>
        每个采样点用的是<b>预计到达该点的那一刻</b>的天气，而不是出发时刻的天气。
      </div>

      ${r.autoDeparture && r.recommendedHour != null && r.recommendedHour !== r.departureHour
        ? `<div class="kv-note neutral">推荐出发时刻 ${p2(r.recommendedHour)}:00（全程最低分 ${r.recommendedMin}）</div>` : ''}
      ${stale ? `<div class="warn">⚠️ 数据可能已过期（离线缓存），请联网后重试</div>` : ''}
      ${r.route.approx ? `<div class="warn">⚠️ 本版路径按<b>公路网</b>规划。徒步/骑行路线与真实步道、绿道不同，时长按 <b>${r.route.speedKmh} km/h</b> 估算，仅供参考。</div>` : ''}
    </div>

    <h2 class="sec-title">沿程 ${r.points.length} 个采样点（按预计到达时刻）</h2>
    <div id="pointCards">
      ${r.points.map((p, i) => renderNavPointCard(p, i, r.expandIdx === i)).join('')}
    </div>

    <h2 class="sec-title">出行准备</h2>
    <div class="card advice">
      ${r.advice.map(a => `<div class="advice-item">· ${escapeHtml(a)}</div>`).join('')}
    </div>

    <div class="card boundary">
      <div class="bd-title">⚠️ 使用边界</div>
      <div class="bd-item">路径由公开路网服务规划，<b>天气评估仅针对沿路等距采样点</b>，采样点之间的小段不在评估范围内。</div>
      <div class="bd-item">到达时刻按<b>平均速度估算</b>，未考虑堵车、休息、封路等实际情况。</div>
      <div class="bd-item">路网限速估算偏乐观，<b>山区实际车速通常更慢</b>，建议按抵达时刻预留 20–30% 余量。</div>
      <div class="bd-item">结果为基于公开气象预报的<b>参考性评估</b>，<b>不构成安全保证</b>，不替代官方预警与现场判断。</div>
      <div class="bd-item">预报来自全球模型，<b>山区局地精度有限</b>。</div>
    </div>

    <div class="card source">
      <div class="src-line">天气数据：<a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo.com</a>（CC BY 4.0）</div>
      <div class="src-line">路径规划：<a href="https://project-osrm.org/" target="_blank" rel="noopener">OSRM</a>（公共 demo 服务，路网数据 © OpenStreetMap contributors）</div>
      <div class="src-line">适宜度评分与行程结论由本作品计算生成</div>
      <div class="src-line">更新时间：${r.fetchedAt ? new Date(r.fetchedAt).toLocaleString('zh-CN', { hour12: false }) : '—'}</div>
    </div>

    <div class="row-btns end">
      <button class="btn btn-ghost" onclick="showView('home')">回到首页</button>
      <button class="btn btn-ghost" onclick="showView('create')">再体检一条</button>
    </div>
    <div class="bottom-space"></div>
  `;

  // 展开/收起
  $$('#pointCards .pt-card-head').forEach(h => {
    h.addEventListener('click', () => {
      const i = Number(h.dataset.i);
      state.expandIdx = state.expandIdx === i ? -1 : i;
      renderNavReport(r, stale);
    });
  });

  // 底图切换
  const mapToggle = $('#mapToggle');
  if (mapToggle) {
    mapToggle.addEventListener('click', () => {
      const name = MapCtl.toggleLayer();
      if (!name) return;
      const other = TILE_LAYERS.find(t => t.name !== name);
      mapToggle.textContent = other ? other.name : '底图';
      toast('已切换到「' + name + '」底图');
    });
  }

  // 地图：绘制规划路径 + 采样点（地图失败绝不能影响整页）
  try {
    MapCtl.renderNavigation('navMap', r.routeCoords, r.points, (i) => {
      MapCtl.highlight(i);
      const card = document.querySelector(`#pointCards .pt-card[data-i="${i}"]`);
      if (card) {
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        card.classList.remove('flash');
        void card.offsetWidth;
        card.classList.add('flash');
      }
    });
  } catch (e) {
    console.warn('[map] 导航地图渲染失败：', e);
    const wrap = document.querySelector('#navMap')?.parentElement;
    if (wrap) wrap.innerHTML = '<div class="map-fail"><div class="mf-title">地图渲染失败</div>'
      + '<div class="mf-sub">浏览器可能不支持某些地图特性。天气数据与评分不受影响。</div></div>';
  }

  runDiag();
}

function renderNavPointCard(p, i, expanded) {
  const lv = p.level;
  const p2 = n => String(Math.floor(n)).padStart(2, '0');
  const arriveLabel = `${p2(p.hour)}:00` + (p.dayOffset > 0 ? '<sup>次日</sup>' : '');

  const dedHtml = p.deductions.length
    ? p.deductions.slice(0, 3).map(d => `<span class="ded">${escapeHtml(d.label)}（−${d.pts}）</span>`).join('')
    : `<span class="ded none">无明显扣分项</span>`;

  return `
    <div class="card pt-card" data-i="${i}">
      <div class="pt-card-head" data-i="${i}">
        <div class="pc-left">
          <span class="pc-idx">${i + 1}</span>
          <div>
            <div class="pc-name">${escapeHtml(p.name)}</div>
            <div class="pc-meta">${p.weatherText}${p.temp != null ? ' · ' + p.temp.toFixed(1) + '℃' : ''}${p.elev != null ? ' · ' + p.elev + 'm' : ''}</div>
          </div>
        </div>
        <div class="pc-right">
          <span class="pc-score ${lv.key}">${p.score}</span>
          <span class="pc-lv ${lv.key}">${lv.text}</span>
          <span class="pc-caret">${expanded ? '▲' : '▼'}</span>
        </div>
      </div>

      <div class="pc-arrive">
        <span class="arr-time">预计 ${arriveLabel} 到达</span>
        <span class="arr-km">距起点 ${p.cumKm.toFixed(0)} km</span>
      </div>

      <div class="pc-deds">${dedHtml}</div>

      ${expanded ? renderNavHourly(p) : renderMiniBarOf(centerHours(p), true)}
    </div>`;
}

/** 取"到达时刻"前后共 13 小时用于小时条 */
function centerHours(p) {
  const c = p.arriveIdx || 0;
  const out = [];
  for (let k = c - 6; k <= c + 6; k++) {
    const h = p.hours[k];
    if (!h) continue;
    out.push({
      hour: h.hour,
      time: h.time,
      level: levelOf(scoreHourCache(h)),
      score: scoreHourCache(h),
      center: k === c,
    });
  }
  return out;
}

/** 小时条缓存，避免重复计算 */
const __shCache = new WeakMap();
function scoreHourCache(h) {
  if (__shCache.has(h)) return __shCache.get(h);
  // 该点海拔未知时用 null，只影响海拔扣分
  const s = scoreHour(h, null).score;
  __shCache.set(h, s);
  return s;
}

function renderNavHourly(p) {
  const hours = centerHours(p);
  return `
    <div class="hourly-table">
      <div class="ht-scroll">
        ${hours.map(h => `
          <div class="ht-col ${h.center ? 'ht-center' : ''}">
            <div class="ht-score ${h.level.key}">${h.score}</div>
            <div class="ht-hour">${String(h.hour).padStart(2, '0')}</div>
          </div>`).join('')}
      </div>
      <div class="ht-legend">以预计到达时刻为中心前后各 6 小时（竖线为中心时刻）</div>
    </div>`;
}

/* ============================================================
 * 点位模式报告渲染
 * ============================================================ */

function renderReport(r, stale) {
  const routeName = r.points.map(p => p.name).join(' → ');
  const worst = r.points[r.worstIndex];
  const lv = r.level;

  let windowHtml;
  if (r.window.exists) {
    windowHtml = `
      <div class="kv">
        <span class="kv-k">建议出发窗口</span>
        <span class="kv-v strong">${pad(r.window.startHour)}:00 – ${pad(r.window.endHour)}:00</span>
      </div>
      ${r.window.capped ? `<div class="kv-note neutral">当天约 ${r.window.qualifyHours} 个时段达「一般」以上，以上为其中最优的一段</div>` : ''}`;
  } else {
    windowHtml = `
      <div class="kv">
        <span class="kv-k">今日无完全适宜窗口</span>
        <span class="kv-v">最接近：${pad(r.window.nearestHour)}:00（全线最低 ${r.window.routeScoreAtNearest} 分）</span>
      </div>
      <div class="kv-note">瓶颈在「${escapeHtml(r.window.bottleneckName)}」，建议改期或缩短行程</div>`;
  }

  $('#reportBody').innerHTML = `
    <div class="card map-card">
      <div class="map-wrap">
        <div id="reportMap" class="map map-report"></div>
        <button class="map-toggle" id="mapToggle" type="button">地形</button>
      </div>
      <div class="map-hint">点击地图上的点位可跳转到对应卡片 · 底图 © OpenStreetMap contributors</div>
    </div>

    <div class="card summary ${lv.key}">
      <div class="sum-date">${r.date} · ${modeText(r.mode)}</div>
      <div class="sum-route">${escapeHtml(routeName)}</div>

      <div class="sum-hero">
        <div class="sum-score ${lv.key}">${r.routeScore}</div>
        <div class="sum-lv">
          <div class="sum-lv-icon">${lv.icon}</div>
          <div class="sum-lv-text ${lv.key}">${lv.text}</div>
          <div class="sum-lv-short">${lv.short}</div>
        </div>
      </div>

      ${windowHtml}

      <div class="kv">
        <span class="kv-k">最差点位</span>
        <span class="kv-v">${escapeHtml(worst.name)}${worst.elev != null ? `（海拔 ${worst.elev} m）` : ''} · ${worst.score} 分</span>
      </div>
      <div class="kv">
        <span class="kv-k">各点平均</span>
        <span class="kv-v">${r.avgScore} 分</span>
      </div>

      <div class="explain">
        路线得分取各点位中的<b>最低分</b>——一个人可以在 ${r.avgScore} 分的路上走，
        但整条行程的安全性由最差的那一段决定。
      </div>

      ${stale ? `<div class="warn">⚠️ 数据可能已过期（离线缓存），请联网后重试</div>` : ''}
    </div>

    <h2 class="sec-title">逐点位 · ${pad(r.chosenHour)}:00 时刻</h2>
    <div id="pointCards">
      ${r.points.map((p, i) => renderPointCard(p, i, r.expandIdx === i)).join('')}
    </div>

    <h2 class="sec-title">出行准备</h2>
    <div class="card advice">
      ${r.advice.map(a => `<div class="advice-item">· ${escapeHtml(a)}</div>`).join('')}
    </div>

    <div class="card boundary">
      <div class="bd-title">⚠️ 使用边界</div>
      <div class="bd-item">本报告仅评估你输入的 <b>${r.points.length} 个点位</b>，点位之间的路段不在评估范围内。</div>
      <div class="bd-item">结果为基于公开气象预报的<b>参考性评估</b>，<b>不构成安全保证</b>，不替代官方预警信息与现场判断。</div>
      <div class="bd-item">预报数据来自全球模型，<b>山区局地精度有限</b>。</div>
    </div>

    <div class="card source">
      <div class="src-line">
        天气数据来源：<a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo.com</a>（CC BY 4.0）
      </div>
      <div class="src-line">适宜度评分与行程结论由本作品计算生成</div>
      <div class="src-line">更新时间：${r.fetchedAt ? new Date(r.fetchedAt).toLocaleString('zh-CN', { hour12: false }) : '—'}</div>
      <div class="src-line dim">预报数据缓存 1 小时</div>
    </div>

    <div class="row-btns end">
      <button class="btn btn-ghost" onclick="showView('home')">回到首页</button>
      <button class="btn btn-ghost" onclick="showView('create')">再体检一条</button>
    </div>
    <div class="bottom-space"></div>
  `;

  // 绑定展开/收起
  $$('#pointCards .pt-card-head').forEach(h => {
    h.addEventListener('click', () => {
      const i = Number(h.dataset.i);
      state.expandIdx = state.expandIdx === i ? -1 : i;
      renderReport(r, stale);
    });
  });

  // 地图：路线可视化 + 点击点位联动卡片（地图失败绝不能影响整页）
  try {
    MapCtl.renderReport('reportMap', r.points.map((p, i) => Object.assign({}, p, { __i: i })), (i) => {
      MapCtl.highlight(i);
      const card = document.querySelector(`#pointCards .pt-card[data-i="${i}"]`);
      if (card) {
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        card.classList.remove('flash');
        void card.offsetWidth;
        card.classList.add('flash');
      }
    });
  } catch (e) {
    console.warn('[map] 地图渲染失败：', e);
    const wrap = document.querySelector('#reportMap')?.parentElement;
    if (wrap) wrap.innerHTML = '<div class="map-fail"><div class="mf-title">地图渲染失败</div>'
      + '<div class="mf-sub">浏览器可能不支持某些地图特性。天气数据与评分不受影响。</div></div>';
  }

  // 底图切换（按钮始终显示"另一张图"的名字）
  const mapToggle = $('#mapToggle');
  if (mapToggle) {
    mapToggle.addEventListener('click', () => {
      const name = MapCtl.toggleLayer();
      if (!name) return;
      const other = TILE_LAYERS.find(t => t.name !== name);
      mapToggle.textContent = other ? other.name : '底图';
      toast('已切换到「' + name + '」底图');
    });
  }

  runDiag();
}

function renderPointCard(p, i, expanded) {
  const lv = p.level;

  const dedHtml = p.deductions.length
    ? p.deductions.slice(0, 3).map(d => `<span class="ded">${escapeHtml(d.label)}（−${d.pts}）</span>`).join('')
    : `<span class="ded none">无明显扣分项</span>`;

  return `
    <div class="card pt-card" data-i="${i}">
      <div class="pt-card-head" data-i="${i}">
        <div class="pc-left">
          <span class="pc-idx">${i + 1}</span>
          <div>
            <div class="pc-name">${escapeHtml(p.name)}</div>
            <div class="pc-meta">${p.weatherText}${p.temp != null ? ' · ' + p.temp.toFixed(1) + '℃' : ''}${p.elev != null ? ' · ' + p.elev + 'm' : ''}</div>
          </div>
        </div>
        <div class="pc-right">
          <span class="pc-score ${lv.key}">${p.score}</span>
          <span class="pc-lv ${lv.key}">${lv.text}</span>
          <span class="pc-caret">${expanded ? '▲' : '▼'}</span>
        </div>
      </div>

      <div class="pc-deds">${dedHtml}</div>

      ${expanded ? renderHourly(p) : renderMiniBar(p)}
    </div>`;
}

/** 小时条（点位模式用）：p 是带 hourly 的点位 */
function renderMiniBar(p) {
  return renderMiniBarOf(p.hourly, false);
}

/** 小时条（通用）：hours 为 [{level, hour, score}]，center 为是否高亮到达时刻 */
function renderMiniBarOf(hours, showCenter) {
  return `<div class="hourbar mini">${hours.map(h =>
    `<span class="hb-cell ${h.level.key}${showCenter && h.center ? ' hb-center' : ''}" title="${String(h.hour).padStart(2, '0')}:00 ${h.score}分"></span>`
  ).join('')}</div>`;
}

function renderHourly(p) {
  return `
    <div class="hourly-table">
      <div class="ht-scroll">
        ${p.hourly.map(h => `
          <div class="ht-col">
            <div class="ht-score ${h.level.key}">${h.score}</div>
            <div class="ht-hour">${pad(h.hour)}</div>
            <div class="ht-temp">${h.temp != null ? Math.round(h.temp) + '°' : '—'}</div>
            <div class="ht-pp">${h.pp != null ? h.pp + '%' : '—'}</div>
          </div>`).join('')}
      </div>
      <div class="ht-legend">上排：适宜度　中排：时刻　下排：气温 / 降水概率</div>
    </div>`;
}

/* ---------------- 历史行程 ---------------- */

function openTrip(id) {
  const t = getTrip(id);
  if (!t) return;
  state.date = t.date;
  state.mode = t.mode;
  state.points = t.points.map(p => ({ name: p.name, lat: p.lat, lon: p.lon }));
  $('#inpDate').value = t.date;
  $$('#segMode button').forEach(b => b.classList.toggle('on', b.dataset.mode === t.mode));
  renderPointList();
  showView('report');
  runCheckup();
}

/* ---------------- 工具 ---------------- */

function pad(n) { return String(n).padStart(2, '0'); }

/** 'YYYY-MM-DD' → '周五' */
function weekOf(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d)) return '';
  return '周' + ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
}

/** 分钟 → "3 小时 20 分" / "2 天 5 小时" */
function fmtDuration(minutes) {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} 分钟`;
  if (m < 24 * 60) return `${Math.floor(m / 60)} 小时 ${m % 60} 分`;
  const d = Math.floor(m / (24 * 60));
  const h = Math.floor((m % (24 * 60)) / 60);
  return `${d} 天 ${h} 小时`;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------------- 启动 ---------------- */

document.addEventListener('DOMContentLoaded', () => {
  // 底图被自动切换时给个提示（手动切换自己会 toast）
  window.__onMapLayerChange = (name) => {
    if (name) toast('底图已自动切换为「' + name + '」');
  };

  initCreate();
  $('#btnNew').addEventListener('click', () => {
    state.points = [];
    renderPointList();
    showView('create');
  });
  $('#sheetClose').addEventListener('click', closeSheet);
  $('#sheetSearch').addEventListener('input', () => {
    renderSheetList();
    scheduleRemoteSearch();
  });
  $('#sheet').addEventListener('click', e => {
    if (e.target.id === 'sheet') closeSheet();
  });
  renderHome();
  showView('home');

  // ---------------- 直链参数 ----------------
  const params = new URLSearchParams(location.search);

  // 常见城市坐标兜底（内置点位库只有川西，直链里常用到这些）
  const EXTRA_CITIES = {
    '深圳': [22.5431, 114.0579], '广州': [23.1291, 113.2644], '成都': [30.5728, 104.0668],
    '重庆': [29.5630, 106.5516], '北京': [39.9042, 116.4074], '上海': [31.2304, 121.4737],
    '西安': [34.3416, 108.9398], '昆明': [25.0389, 102.7183], '武汉': [30.5928, 114.3055],
    '杭州': [30.2741, 120.1551], '兰州': [36.0611, 103.8343], '西宁': [36.6171, 101.7782],
    '拉萨': [29.6520, 91.1721], '贵阳': [26.6470, 106.6302], '长沙': [28.2282, 112.9388],
  };

  function resolveName(name) {
    const p = findPointByName(name);
    if (p) return { name: p.name, lat: p.lat, lon: p.lon };
    const c = EXTRA_CITIES[name];
    if (c) return { name, lat: c[0], lon: c[1] };
    return null;
  }

  /** 解析 ?pts= 列表；库里找不到的先跳过（下面会尝试在线搜） */
  function loadNames(str) {
    return (str || '').split(/[,，、]/).map(s => s.trim()).filter(Boolean)
      .map(resolveName).filter(Boolean);
  }

  // ?pts=雅安,天全,泸定 指定点名
  const fromPts = loadNames(params.get('pts'));
  if (fromPts.length >= 2) state.points = fromPts;

  // ?nav=1 进入导航模式；?depart=6 指定出发时刻
  if (params.get('nav') === '1') {
    state.checkMode = 'nav';
    $$('#segCheckMode button').forEach(b => b.classList.toggle('on', b.dataset.check === 'nav'));
    applyCheckModeUI();
  }
  if (params.get('depart') !== null && params.get('depart') !== '') {
    const h = Number(params.get('depart'));
    if (h >= -1 && h < 24) {
      state.departHour = h;
      $('#selDepart').value = String(h);
    }
  }

  const setDate = () => {
    const d = params.get('date') || addDays(todayStr(), 1);
    state.date = d;
    $('#inpDate').value = d;
  };

  // ?mode=hike|bike|drive 指定出行方式（便于演示与测试）
  const mq = params.get('mode');
  if (mq && ['drive', 'hike', 'bike'].includes(mq)) {
    state.mode = mq;
    $$('#segMode button').forEach(b => b.classList.toggle('on', b.dataset.mode === mq));
  }

  // ?view=create 直接进新建页
  if (params.get('view') === 'create') {
    if (!state.points.length) state.points = loadNames(DEMO_ROUTE.join(','));
    setDate();
    renderPointList();
    showView('create');
  }

  // ?demo=1 自动跑一次体检，便于演示与分享
  if (params.get('demo') === '1') {
    if (!state.points.length) state.points = loadNames(DEMO_ROUTE.join(','));
    setDate();
    renderPointList();
    showView('create');
    runCheckup();
  }

  // ?sheet=1 直接打开点位选择弹层（便于演示与截图核对层叠顺序）
  // 可选 &q=稻城亚丁 预填搜索词，直接触发全国地名搜索
  if (params.get('sheet') === '1') {
    if (!state.points.length) state.points = loadNames(DEMO_ROUTE.join(','));
    setDate();
    renderPointList();
    showView('create');
    setTimeout(() => {
      openSheet();
      const q = params.get('q');
      if (q) {
        $('#sheetSearch').value = q;
        renderSheetList();
        scheduleRemoteSearch();
      }
    }, 250);
  }

  // 诊断模式：?demo=1&diag=1 —— 报告渲染完成后，把溢出元素显示在顶部横幅
  if (params.get('diag') === '1') {
    window.__diag = true;
  }
});

/** 报告渲染后调用：找出超出视口的元素 */
function runDiag() {
  if (!window.__diag) return;
  const old = document.getElementById('diagBox');
  if (old) old.remove();

  const vw = window.innerWidth;
  const wide = Array.from(document.querySelectorAll('body *'))
    .map(n => ({ n, r: n.getBoundingClientRect() }))
    .filter(o => o.r.right > vw + 0.5 && o.r.width > 0)
    .sort((a, b) => b.r.right - a.r.right)
    .slice(0, 8)
    .map(o => `${o.n.tagName}.${(o.n.className || '').toString().trim().split(' ')[0]} r=${Math.round(o.r.right)} w=${Math.round(o.r.width)}`);

  const box = document.createElement('div');
  box.id = 'diagBox';
  box.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:#000;color:#0f0;'
    + 'font:16px/1.35 monospace;padding:6px;white-space:pre-wrap;max-height:45vh;overflow:auto';
  box.textContent = `vw=${vw} docSW=${document.documentElement.scrollWidth} bodySW=${document.body.scrollWidth} mainW=${Math.round(document.querySelector('main').getBoundingClientRect().width)}\n`
    + (wide.length ? wide.join('\n') : '(无溢出元素)');
  document.body.appendChild(box);
}
