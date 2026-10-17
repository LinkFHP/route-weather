/* ============================================================
 * 本机存储（localStorage）
 * ------------------------------------------------------------
 * 隐私：行程数据仅存本机，不上传服务器；不采集身份信息。
 * ============================================================ */

const STORE_KEY = 'rwc:history';
const STORE_MAX = 20;

function loadHistory() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

function saveHistory(list) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(list.slice(0, STORE_MAX)));
  } catch (e) {
    console.warn('保存失败（可能存储已满）：', e);
  }
}

/** 新增或覆盖同一点位组合+日期的行程 */
function upsertTrip(trip) {
  const list = loadHistory();
  const sig = tripSignature(trip);
  const idx = list.findIndex(t => tripSignature(t) === sig);
  if (idx >= 0) list.splice(idx, 1);
  list.unshift(trip);
  saveHistory(list);
  return list;
}

function removeTrip(id) {
  const list = loadHistory().filter(t => t.id !== id);
  saveHistory(list);
  return list;
}

function getTrip(id) {
  return loadHistory().find(t => t.id === id) || null;
}

function tripSignature(trip) {
  return trip.date + '|' + (trip.points || []).map(p => p.name + p.lat + p.lon).join('-');
}

function newTripId() {
  return 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
