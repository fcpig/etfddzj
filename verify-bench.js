// 验证：1) A股/美股池是否完整 2) 基准对比计算
const fs = require('fs');
const data = JSON.parse(fs.readFileSync('c:\\Users\\www\\.trae-cn\\work\\6a49c83c7cac454a2daea8b6\\etf-data.json', 'utf8'));

const accountPools = {
  "A股": ["510300", "159338", "511090", "518880", "513100", "513500", "513030", "513880", "513120", "164824", "510170"],
  "美股": ["VOO", "VTI", "VXUS", "VWO", "XLE", "BND", "TLT", "VNQ", "GLD"],
};

console.log('=== 池完整性检查 ===');
Object.entries(accountPools).forEach(([acc, tickers]) => {
  console.log(`\n${acc}账户 (${tickers.length} 个 ETF):`);
  tickers.forEach(tk => {
    const hasData = Boolean(data.series[tk]);
    console.log(`  ${tk}: ${hasData ? '有数据' : '缺数据!'}`);
  });
});

// 模拟 buildBenchmarkSeries
function buildBenchmarkSeries(ticker, dates) {
  const raw = data.series[ticker];
  if (!raw || !dates.length) return [];
  const map = new Map(raw);
  let lastVal = null;
  const aligned = dates.map(d => {
    if (map.has(d)) lastVal = map.get(d);
    return lastVal;
  });
  const firstIdx = aligned.findIndex(v => v != null);
  if (firstIdx < 0) return [];
  const base = aligned[firstIdx];
  return aligned.map(v => v == null ? null : (v / base) * 100);
}

// 组合 dates（全球均衡模板）
const dates = data.dates;
const holdings = [
  { ticker: 'VOO', weight: 28 },
  { ticker: 'VXUS', weight: 18 },
  { ticker: 'BND', weight: 24 },
  { ticker: 'GLD', weight: 10 },
  { ticker: 'VWO', weight: 20 },
];

// 简化 buildAlignedSeries
function buildAlignedSeries(holdings) {
  const weighted = holdings
    .filter(h => h.weight > 0 && data.series[h.ticker])
    .map(h => {
      const raw = data.series[h.ticker];
      const map = new Map(raw);
      let lastVal = null;
      const aligned = dates.map(d => { if (map.has(d)) lastVal = map.get(d); return lastVal; });
      const firstIdx = aligned.findIndex(v => v != null);
      const base = aligned[firstIdx];
      const norm = aligned.map(v => v == null ? null : (v / base) * 100);
      return { norm, weight: h.weight, firstIdx };
    });
  const startIdx = Math.max(...weighted.map(w => w.firstIdx));
  const series = [];
  for (let i = startIdx; i < dates.length; i++) {
    let sum = 0, total = 0;
    weighted.forEach(w => { const v = w.norm[i]; if (v != null) { sum += v * w.weight; total += w.weight; } });
    if (total > 0) series.push(sum / total);
  }
  return { dates: dates.slice(startIdx), series };
}

const { dates: pDates, series } = buildAlignedSeries(holdings);
const totalReturn = series[series.length-1] / series[0] - 1;

console.log('\n=== 基准对比 ===');
console.log(`组合近一年收益: ${(totalReturn*100).toFixed(2)}%`);

['VOO', 'BND'].forEach(bench => {
  const benchSeries = buildBenchmarkSeries(bench, pDates);
  if (benchSeries.length) {
    const benchEnd = benchSeries[benchSeries.length-1];
    const benchRet = benchEnd / 100 - 1;
    const diff = totalReturn - benchRet;
    console.log(`\n基准 ${bench}:`);
    console.log(`  基准收益: ${(benchRet*100).toFixed(2)}%`);
    console.log(`  组合${diff >= 0 ? '跑赢' : '落后'}: ${Math.abs(diff*100).toFixed(2)}%`);
    console.log(`  基准数据点: ${benchSeries.length}, 末值: ${benchEnd?.toFixed(2)}`);
  }
});
