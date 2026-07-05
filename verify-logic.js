// 验证组合走势计算逻辑:不同权重应产生不同结果
const fs = require('fs');
const data = JSON.parse(fs.readFileSync('c:\\Users\\www\\.trae-cn\\work\\6a49c83c7cac454a2daea8b6\\etf-data.json', 'utf8'));
console.log('ETF_DATA loaded: dates=' + data.dates.length + ' tickers=' + Object.keys(data.series).length);
console.log('date range:', data.dates[0], '~', data.dates[data.dates.length-1]);

// 复刻 app.jsx 的 buildAlignedSeries
function buildAlignedSeries(holdings) {
  const dates = data.dates;
  const weighted = holdings
    .filter((h) => h.weight > 0 && data.series[h.ticker])
    .map((h) => {
      const raw = data.series[h.ticker];
      const map = new Map(raw);
      let lastVal = null;
      const aligned = dates.map((d) => {
        if (map.has(d)) lastVal = map.get(d);
        return lastVal;
      });
      const firstIdx = aligned.findIndex((v) => v != null);
      if (firstIdx < 0) return null;
      const base = aligned[firstIdx];
      const norm = aligned.map((v) => (v == null ? null : (v / base) * 100));
      return { norm, weight: h.weight, firstIdx };
    })
    .filter(Boolean);
  if (!weighted.length) return { dates, series: [] };
  const startIdx = Math.max(...weighted.map((w) => w.firstIdx));
  const series = [];
  for (let i = startIdx; i < dates.length; i++) {
    let sum = 0, total = 0;
    weighted.forEach((w) => {
      const v = w.norm[i];
      if (v != null) { sum += v * w.weight; total += w.weight; }
    });
    if (total > 0) series.push(sum / total);
  }
  return { dates, series };
}

function calcStats(values) {
  if (values.length < 2) return { annual: 0, drawdown: 0, totalReturn: 0, vol: 0 };
  const totalReturn = values[values.length - 1] / values[0] - 1;
  const rets = [];
  for (let i = 1; i < values.length; i++) rets.push(values[i] / values[i - 1] - 1);
  const avg = rets.reduce((a, b) => a + b, 0) / rets.length;
  const annual = Math.pow(1 + avg, 252) - 1;
  const variance = rets.reduce((s, r) => s + (r - avg) * (r - avg), 0) / rets.length;
  const vol = Math.sqrt(variance) * Math.sqrt(252);
  let peak = values[0], drawdown = 0;
  values.forEach((v) => { if (v > peak) peak = v; const dd = v / peak - 1; if (dd < drawdown) drawdown = dd; });
  return { annual, drawdown, totalReturn, vol };
}

// 模板0:全球均衡
const tpl0 = [
  { ticker: 'VOO', weight: 28 },
  { ticker: 'VXUS', weight: 18 },
  { ticker: 'BND', weight: 24 },
  { ticker: 'GLD', weight: 10 },
  { ticker: 'VWO', weight: 20 },
];
// 调整:VOO 提到 45,VXUS 降到 5,其他不变(模拟滑块拖动)
const tpl0Adjusted = [
  { ticker: 'VOO', weight: 45 },
  { ticker: 'VXUS', weight: 5 },
  { ticker: 'BND', weight: 24 },
  { ticker: 'GLD', weight: 10 },
  { ticker: 'VWO', weight: 20 },
];
// 模板2:耶鲁模式(含 TLT)
const tpl2 = [
  { ticker: 'VOO', weight: 22 },
  { ticker: 'VXUS', weight: 16 },
  { ticker: 'VNQ', weight: 12 },
  { ticker: 'TLT', weight: 20 },
  { ticker: 'GLD', weight: 30 },
];

const tests = [
  { name: '全球均衡(原)', holdings: tpl0 },
  { name: '全球均衡(VOO↑VXUS↓)', holdings: tpl0Adjusted },
  { name: '耶鲁模式', holdings: tpl2 },
];

console.log('\n=== 组合走势计算验证 ===');
tests.forEach((t) => {
  const { dates, series } = buildAlignedSeries(t.holdings);
  const s = calcStats(series);
  console.log(`\n[${t.name}]`);
  console.log(`  数据点: ${series.length}, 日期: ${dates[0]} ~ ${dates[dates.length-1]}`);
  console.log(`  起点值: ${series[0]?.toFixed(2)}, 终点值: ${series[series.length-1]?.toFixed(2)}`);
  console.log(`  近一年收益: ${(s.totalReturn*100).toFixed(2)}%`);
  console.log(`  年化收益: ${(s.annual*100).toFixed(2)}%`);
  console.log(`  最大回撤: ${(s.drawdown*100).toFixed(2)}%`);
  console.log(`  年化波动率: ${(s.vol*100).toFixed(2)}%`);
  const finite = isFinite(s.annual) && isFinite(s.drawdown) && isFinite(s.vol) && isFinite(s.totalReturn);
  console.log(`  数值有效: ${finite ? 'YES' : 'NO (NaN/Infinity!)'}`);
});

// 确认不同权重产生不同结果
const r1 = calcStats(buildAlignedSeries(tpl0).series);
const r2 = calcStats(buildAlignedSeries(tpl0Adjusted).series);
const r3 = calcStats(buildAlignedSeries(tpl2).series);
console.log('\n=== 联动验证 ===');
console.log('全球均衡 vs 调整后  annual 是否不同:', r1.annual !== r2.annual, `(${(r1.annual*100).toFixed(2)}% vs ${(r2.annual*100).toFixed(2)}%)`);
console.log('全球均衡 vs 耶鲁    annual 是否不同:', r1.annual !== r3.annual, `(${(r1.annual*100).toFixed(2)}% vs ${(r3.annual*100).toFixed(2)}%)`);
console.log('所有数值有限且互不相同:', isFinite(r1.annual) && r1.annual !== r2.annual && r1.annual !== r3.annual && r2.annual !== r3.annual ? 'PASS' : 'FAIL');
