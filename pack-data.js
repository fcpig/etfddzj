// 将 ETF 历史数据 CSV 解析为 {ticker: [{date, value}, ...]}，并输出精简 JSON
// 使用复权收盘价，取最近 ~1 年；日期按字典序，前端按日期并集前向填充后加权合成。
const fs = require('fs');
const path = require('path');

const DATA_DIR = 'c:\\Users\\www\\Desktop\\大道至简\\ETF历史数据';
const OUT = 'c:\\Users\\www\\.trae-cn\\work\\6a49c83c7cac454a2daea8b6\\etf-data.json';

const tickers = [
  'VOO','VTI','VXUS','VWO','XLE','BND','TLT','VNQ','GLD',
  '510300','159338','511090','518880','513100','513500',
  '513030','513880','513120','164824','510170'
];

function findFile(ticker) {
  const files = fs.readdirSync(DATA_DIR).filter(f => f.startsWith(ticker + '_'));
  return files[0] ? path.join(DATA_DIR, files[0]) : null;
}

function parseCSV(fp) {
  const text = fs.readFileSync(fp, 'utf8').replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/).filter(Boolean);
  const headers = lines[0].split(',');
  const dateIdx = headers.indexOf('日期');
  const adjIdx = headers.indexOf('复权收盘价');
  const closeIdx = headers.indexOf('收盘价');
  const valIdx = adjIdx >= 0 ? adjIdx : closeIdx;
  return lines.slice(1).map(line => {
    const cols = line.split(',');
    return { d: cols[dateIdx], v: +Number(cols[valIdx]).toFixed(4) };
  }).filter(r => isFinite(r.v) && r.v > 0 && /^\d{4}-\d{2}-\d{2}$/.test(r.d));
}

const data = {};
const dateSet = new Set();
for (const tk of tickers) {
  const fp = findFile(tk);
  if (!fp) { console.warn('MISSING:', tk); continue; }
  const rows = parseCSV(fp).slice(-260); // 多取一点以便前端对齐
  // 按日期去重（保留最后）
  const map = new Map();
  for (const r of rows) map.set(r.d, r.v);
  const sorted = [...map.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1).map(([d, v]) => [d, v]);
  data[tk] = sorted;
  sorted.forEach(([d]) => dateSet.add(d));
}

// 统一日期数组：从最早起点到最晚终点
const allDates = [...dateSet].sort();

fs.writeFileSync(OUT, JSON.stringify({ dates: allDates, series: data }));
console.log('wrote', OUT, 'dates:', allDates.length, 'tickers:', Object.keys(data).length, 'size KB:', (fs.statSync(OUT).size/1024).toFixed(1));
console.log('date range:', allDates[0], '~', allDates[allDates.length-1]);
