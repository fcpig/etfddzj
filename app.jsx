
      const { useState, useEffect, useRef, useMemo, useCallback } = React;

      /* ============ 内嵌 ETF 历史数据（打包脚本会替换占位符） ============ */
      /* __ETF_DATA_PLACEHOLDER__ */

      /* ============ 组合走势计算 ============ */
      // 将 ETF_DATA 的 [[date, value], ...] 转为 map 并在统一日期轴上前向填充
      function buildAlignedSeries(holdings) {
        const dates = ETF_DATA.dates;
        const weighted = holdings
          .filter((h) => h.weight > 0 && ETF_DATA.series[h.ticker])
          .map((h) => {
            const raw = ETF_DATA.series[h.ticker];
            const map = new Map(raw);
            // 先把每个资产映射到统一日期轴
            let lastVal = null;
            const aligned = dates.map((d) => {
              if (map.has(d)) lastVal = map.get(d);
              return lastVal;
            });
            // 归一化为 100 起点（只保留起点之后有效的部分）
            const firstIdx = aligned.findIndex((v) => v != null);
            if (firstIdx < 0) return null;
            const base = aligned[firstIdx];
            const norm = aligned.map((v) => (v == null ? null : (v / base) * 100));
            return { norm, weight: h.weight, firstIdx };
          })
          .filter(Boolean);

        if (!weighted.length) return { dates, series: [] };

        // 所有资产都开始后的共同起点
        const startIdx = Math.max(...weighted.map((w) => w.firstIdx));
        // 加权合成
        const series = [];
        for (let i = startIdx; i < dates.length; i++) {
          let sum = 0;
          let total = 0;
          weighted.forEach((w) => {
            const v = w.norm[i];
            if (v != null) { sum += v * w.weight; total += w.weight; }
          });
          if (total > 0) series.push({ date: dates[i], value: sum / total });
        }
        return { dates: series.map((p) => p.date), series: series.map((p) => p.value) };
      }

      function calcStats(values) {
        if (values.length < 2) return { annual: 0, drawdown: 0, totalReturn: 0, vol: 0, color: "up" };
        const totalReturn = values[values.length - 1] / values[0] - 1;
        // 日收益率
        const rets = [];
        for (let i = 1; i < values.length; i++) {
          rets.push(values[i] / values[i - 1] - 1);
        }
        const avg = rets.reduce((a, b) => a + b, 0) / rets.length;
        const annual = Math.pow(1 + avg, 252) - 1;
        const variance = rets.reduce((s, r) => s + (r - avg) * (r - avg), 0) / rets.length;
        const vol = Math.sqrt(variance) * Math.sqrt(252);
        let peak = values[0], drawdown = 0;
        values.forEach((v) => {
          if (v > peak) peak = v;
          const dd = v / peak - 1;
          if (dd < drawdown) drawdown = dd;
        });
        return {
          annual,
          drawdown,
          totalReturn,
          vol,
          color: totalReturn >= 0 ? "up" : "down",
        };
      }

      // 绘制走势图：红涨绿跌（A 股配色）
      function drawCurve(canvas, values, color, benchmark) {
        if (!canvas || !values || values.length < 2) return;
        const ctx = canvas.getContext("2d");
        const dpr = window.devicePixelRatio || 1;
        const w = canvas.clientWidth || canvas.width;
        const h = canvas.clientHeight || canvas.height;
        if (canvas.width !== w * dpr) {
          canvas.width = w * dpr;
          canvas.height = h * dpr;
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        const stroke = color === "up" ? "#FF4D4F" : "#00B578";
        const fillA = color === "up" ? "rgba(255,77,79,0.18)" : "rgba(0,181,120,0.14)";
        const fillB = color === "up" ? "rgba(255,77,79,0.02)" : "rgba(0,181,120,0.01)";
        // 基准线参与范围计算
        const allVals = benchmark && benchmark.length ? [...values, ...benchmark.filter((v) => v != null)] : values;
        const min = Math.min(...allVals);
        const max = Math.max(...allVals);
        const padX = 8, padY = 14;
        const points = values.map((v, i) => ({
          x: padX + (i / (values.length - 1)) * (w - padX * 2),
          y: padY + ((max - v) / (max - min || 1)) * (h - padY * 2 - 8),
        }));
        const grad = ctx.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, fillA);
        grad.addColorStop(1, fillB);
        ctx.beginPath();
        points.forEach((p, i) => { i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y); });
        ctx.lineTo(points[points.length - 1].x, h);
        ctx.lineTo(points[0].x, h);
        ctx.closePath();
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.beginPath();
        points.forEach((p, i) => { i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y); });
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 2.5;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.stroke();
        // 基准虚线
        if (benchmark && benchmark.length === values.length) {
          const bpoints = benchmark.map((v, i) => v == null ? null : ({
            x: padX + (i / (values.length - 1)) * (w - padX * 2),
            y: padY + ((max - v) / (max - min || 1)) * (h - padY * 2 - 8),
          }));
          ctx.beginPath();
          let started = false;
          bpoints.forEach((p) => {
            if (!p) { started = false; return; }
            if (!started) { ctx.moveTo(p.x, p.y); started = true; } else { ctx.lineTo(p.x, p.y); }
          });
          ctx.strokeStyle = "#888";
          ctx.lineWidth = 1.5;
          ctx.setLineDash([5, 4]);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      // 基准序列：在指定 dates 上前向填充并归一化为 100 起点
      function buildBenchmarkSeries(ticker, dates) {
        const raw = ETF_DATA.series[ticker];
        if (!raw || !dates.length) return [];
        const map = new Map(raw);
        let lastVal = null;
        const aligned = dates.map((d) => {
          if (map.has(d)) lastVal = map.get(d);
          return lastVal;
        });
        const firstIdx = aligned.findIndex((v) => v != null);
        if (firstIdx < 0) return [];
        const base = aligned[firstIdx];
        return aligned.map((v) => (v == null ? null : (v / base) * 100));
      }

      function pctText(v) {
        const s = (v * 100).toFixed(1) + "%";
        return v >= 0 ? "+" + s : s;
      }

      /* ============ 数据层 ============ */
      const templates = [
        {
          name: "全球均衡",
          risk: "中低",
          desc: "美股 + 海外 + 新兴市场 + 债券 + 黄金，适合长期稳健配置。",
          items: [
            { ticker: "VOO", name: "标普500ETF", weight: 28, region: "美股ETF", market: "美股", tone: "blue" },
            { ticker: "VXUS", name: "全球除美国股票ETF", weight: 18, region: "美股ETF", market: "美股", tone: "purple" },
            { ticker: "BND", name: "美国全债市ETF", weight: 24, region: "美股ETF", market: "美股", tone: "green" },
            { ticker: "GLD", name: "黄金ETF", weight: 10, region: "美股ETF", market: "美股", tone: "gold" },
            { ticker: "VWO", name: "新兴市场股票ETF", weight: 20, region: "美股ETF", market: "美股", tone: "purple" },
          ],
        },
        {
          name: "经典60/40",
          risk: "中",
          desc: "股票 60% + 债券 40%，简单、传统、可解释。",
          items: [
            { ticker: "VOO", name: "标普500ETF", weight: 40, region: "美股ETF", market: "美股", tone: "blue" },
            { ticker: "VTI", name: "美国全市场ETF", weight: 20, region: "美股ETF", market: "美股", tone: "purple" },
            { ticker: "BND", name: "美国全债市ETF", weight: 30, region: "美股ETF", market: "美股", tone: "green" },
            { ticker: "GLD", name: "黄金ETF", weight: 10, region: "美股ETF", market: "美股", tone: "gold" },
            { ticker: "VXUS", name: "全球除美国股票ETF", weight: 0, region: "美股ETF", market: "美股", tone: "purple" },
          ],
        },
        {
          name: "耶鲁模式",
          risk: "中高",
          desc: "权益、REITs、长债、黄金分散配置，强调另类资产和长期纪律。",
          items: [
            { ticker: "VOO", name: "标普500ETF", weight: 22, region: "美股ETF", market: "美股", tone: "blue" },
            { ticker: "VXUS", name: "全球除美国股票ETF", weight: 16, region: "美股ETF", market: "美股", tone: "purple" },
            { ticker: "VNQ", name: "美国REIT房地产ETF", weight: 12, region: "美股ETF", market: "美股", tone: "green" },
            { ticker: "TLT", name: "20+年美国长期国债ETF", weight: 20, region: "美股ETF", market: "美股", tone: "green" },
            { ticker: "GLD", name: "黄金ETF", weight: 30, region: "美股ETF", market: "美股", tone: "gold" },
          ],
        },
        {
          name: "主权基金",
          risk: "中",
          desc: "全球权益 60%、债券 30%、房地产 10%，超长期视角。",
          items: [
            { ticker: "VTI", name: "美国全市场ETF", weight: 35, region: "美股ETF", market: "美股", tone: "blue" },
            { ticker: "VXUS", name: "全球除美国股票ETF", weight: 25, region: "美股ETF", market: "美股", tone: "purple" },
            { ticker: "BND", name: "美国全债市ETF", weight: 30, region: "美股ETF", market: "美股", tone: "green" },
            { ticker: "VNQ", name: "美国REIT房地产ETF", weight: 10, region: "美股ETF", market: "美股", tone: "green" },
            { ticker: "GLD", name: "黄金ETF", weight: 0, region: "美股ETF", market: "美股", tone: "gold" },
          ],
        },
        {
          name: "A股平衡",
          risk: "中",
          desc: "沪深300 + A500 + 国债 + 黄金，适合A股账户。",
          items: [
            { ticker: "510300", name: "沪深300ETF", weight: 32, region: "A股ETF", market: "A股", tone: "blue" },
            { ticker: "159338", name: "中证A500ETF", weight: 18, region: "A股ETF", market: "A股", tone: "purple" },
            { ticker: "511090", name: "30年期国债ETF", weight: 25, region: "A股ETF", market: "A股", tone: "green" },
            { ticker: "518880", name: "黄金ETF", weight: 15, region: "A股ETF", market: "A股", tone: "gold" },
            { ticker: "513500", name: "标普500ETF", weight: 10, region: "A股ETF", market: "A股", tone: "purple" },
          ],
        },
      ];

      const notices = [
        { type: "热门", time: "昨天 20:38", title: "为什么今天组合小幅回撤，但不需要手动干预", body: "美股权益下跌时，债券和黄金正在做缓冲。均衡配置的价值不是每天都涨，而是让你更容易长期拿住。" },
        { type: "调仓", time: "昨天 10:12", title: "组合偏离目标 5.2%，建议用新增资金补低配资产", body: "当前美国权益略高于目标，新增资金优先进入 BND 和 GLD，可以减少卖出带来的摩擦成本。" },
        { type: "观点", time: "07/03", title: "长期配置不是预测市场，而是提前承认自己预测不准", body: "全球、股票、债券、黄金一起放进组合，是为了不把结果押在单一市场或单一判断上。" },
      ];

      const panelTabs = [
        { id: "adjust", label: "调节ETF比例" },
        { id: "import", label: "导入大师比例" },
        { id: "save", label: "确认保存" },
        { id: "backtest", label: "一年回测" },
      ];

      const accountPools = {
        "A股": ["510300", "159338", "511090", "518880", "513100", "513500", "513030", "513880", "513120", "164824", "510170"],
        "美股": ["VOO", "VTI", "VXUS", "VWO", "XLE", "BND", "TLT", "VNQ", "GLD"],
      };

      /* ============ 纯函数工具层 ============ */
      function determineStyle(items) {
        const equity = items.filter((i) => !["BND", "TLT", "GLD", "511090", "518880"].includes(i.ticker)).reduce((s, i) => s + i.weight, 0);
        if (equity >= 70) return "进攻型";
        if (equity >= 45) return "均衡型";
        return "防守型";
      }

      function buildWarnings(weights) {
        const items = weights.filter((i) => i.weight > 0);
        const biggest = [...items].sort((a, b) => b.weight - a.weight)[0];
        const high = weights.filter((i) => i.weight >= 35);
        const total = weights.reduce((s, i) => s + i.weight, 0);
        const style = determineStyle(items);
        const summary = total === 100
          ? `当前组合偏${style}，核心仓位是 ${biggest?.ticker || "ETF"}。`
          : `当前组合合计 ${total}%，建议先调到 100% 再保存。`;
        const tips = high.length
          ? `其中 ${high.map((i) => i.ticker).join("、")} 比例较高，已经接近核心仓位上限。`
          : "比例分布比较均匀，没有明显单一资产过重。";
        return { style, summary: `${summary}${tips}` };
      }

      function marketLabel(item) {
        return item.market === "A股" ? "A股ETF" : "美股ETF";
      }

      // ETF 元数据表（独立于模板，覆盖所有 accountPools 中的代码）
      const ETF_META = {
        VOO:    { ticker: "VOO",    name: "标普500ETF",            market: "美股", region: "美股ETF", tone: "blue"   },
        VTI:    { ticker: "VTI",    name: "美国全市场ETF",          market: "美股", region: "美股ETF", tone: "purple" },
        VXUS:   { ticker: "VXUS",   name: "全球除美国股票ETF",      market: "美股", region: "美股ETF", tone: "purple" },
        VWO:    { ticker: "VWO",    name: "新兴市场股票ETF",        market: "美股", region: "美股ETF", tone: "purple" },
        XLE:    { ticker: "XLE",    name: "能源板块ETF",            market: "美股", region: "美股ETF", tone: "gold"   },
        BND:    { ticker: "BND",    name: "美国全债市ETF",          market: "美股", region: "美股ETF", tone: "green"  },
        TLT:    { ticker: "TLT",    name: "20+年美国长期国债ETF",    market: "美股", region: "美股ETF", tone: "green"  },
        VNQ:    { ticker: "VNQ",    name: "美国REIT房地产ETF",      market: "美股", region: "美股ETF", tone: "green"  },
        GLD:    { ticker: "GLD",    name: "黄金ETF",                market: "美股", region: "美股ETF", tone: "gold"   },
        "510300": { ticker: "510300", name: "沪深300ETF",           market: "A股", region: "A股ETF", tone: "blue"   },
        "159338": { ticker: "159338", name: "中证A500ETF",          market: "A股", region: "A股ETF", tone: "purple" },
        "511090": { ticker: "511090", name: "30年期国债ETF",         market: "A股", region: "A股ETF", tone: "green"  },
        "518880": { ticker: "518880", name: "黄金ETF",              market: "A股", region: "A股ETF", tone: "gold"   },
        "513100": { ticker: "513100", name: "纳指ETF",              market: "A股", region: "A股ETF", tone: "blue"   },
        "513500": { ticker: "513500", name: "标普500ETF",           market: "A股", region: "A股ETF", tone: "purple" },
        "513030": { ticker: "513030", name: "德国DAX ETF",          market: "A股", region: "A股ETF", tone: "blue"   },
        "513880": { ticker: "513880", name: "日经225 ETF",          market: "A股", region: "A股ETF", tone: "purple" },
        "513120": { ticker: "513120", name: "港股创新药ETF",        market: "A股", region: "A股ETF", tone: "purple" },
        "164824": { ticker: "164824", name: "印度基金LOF",          market: "A股", region: "A股ETF", tone: "blue"   },
        "510170": { ticker: "510170", name: "大宗商品ETF",          market: "A股", region: "A股ETF", tone: "gold"   },
      };

      function currentPool(account) {
        return accountPools[account]
          .map((ticker) => ETF_META[ticker])
          .filter(Boolean);
      }

      function selectedItems(weights) {
        return weights.filter((i) => i.weight > 0);
      }

      function buildSnapshot(weights, templateIndex) {
        const items = weights.filter((i) => i.weight > 0).map((i) => ({ ...i }));
        const total = weights.reduce((s, i) => s + i.weight, 0);
        const largest = [...items].sort((a, b) => b.weight - a.weight)[0];
        const style = determineStyle(items);
        const warnings = buildWarnings(weights);
        // 计算组合一年走势
        const { dates, series } = buildAlignedSeries(items);
        const stats = calcStats(series);
        return {
          name: templates[templateIndex].name,
          style,
          items,
          total,
          dates,
          series,
          stats,
          returnText: pctText(stats.annual),
          totalReturnText: pctText(stats.totalReturn),
          drawdownText: (stats.drawdown * 100).toFixed(1) + "%",
          volText: (stats.vol * 100).toFixed(1) + "%",
          largest: largest?.name || "ETF组合",
          warnings,
        };
      }

      function MiniChart({ holdings, height = 110 }) {
        const canvasRef = useRef(null);
        const data = useMemo(() => buildAlignedSeries(holdings), [holdings]);
        useEffect(() => {
          if (canvasRef.current) {
            drawCurve(canvasRef.current, data.series, data.series.length >= 2 && data.series[data.series.length-1] >= data.series[0] ? "up" : "down");
          }
        }, [data]);
        return <canvas ref={canvasRef} style={{ width: "100%", height, display: "block" }} />;
      }

      /* ============ 通用组件 ============ */
      function StatusBar({ battery, bellOff }) {
        return (
          <header className="statusbar">
            <span>5:14</span>
            <span className="status-icons">
              {bellOff && <i data-lucide="bell-off"></i>}
              <b>5G</b>
              <i data-lucide="signal"></i>
              <b className="battery">{battery}</b>
            </span>
          </header>
        );
      }

      function MiniLogo() {
        return <img className="mini-logo" src="./logo透明背景.png" alt="Bobby" />;
      }

      /* ============ 各页面组件 ============ */
      function HomeScreen({ active, onNav }) {
        return (
          <section className={`screen ${active ? "active" : ""}`} data-screen="home">
            <StatusBar battery={58} bellOff />
            <div className="search-row">
              <button className="icon-btn" aria-label="搜索"><i data-lucide="search"></i></button>
              <button className="icon-btn" aria-label="扫描"><i data-lucide="scan-line"></i></button>
              <MiniLogo />
            </div>
            <section className="hero">
              <h1>大道至简<br />均衡配置</h1>
              <p>Bobby帮你配置、解释、回测并提醒调仓</p>
              <div className="mascot">
                <img src="./logo透明背景.png" alt="Bobby" />
              </div>
              <button className="btn full soft" onClick={() => onNav("builder")}><i data-lucide="sparkles"></i>开始配置</button>
              <button className="btn full outline" style={{ marginTop: 16 }} onClick={() => onNav("overview")}>查看我的组合</button>
            </section>
            <section className="section">
              <h2>功能入口</h2>
              <button className="signal green" onClick={() => onNav("builder")}>
                <span>#AI组合配置</span><span className="go"><i data-lucide="chevron-right"></i></span>
              </button>
              <button className="signal red" onClick={() => onNav("notify")}>
                <span>#智能通知与调仓</span><span className="go"><i data-lucide="chevron-right"></i></span>
              </button>
            </section>
          </section>
        );
      }

      function OverviewScreen({ active, snapshot, onNav }) {
        const items = snapshot.items;
        return (
          <section className={`screen ${active ? "active" : ""}`} data-screen="overview">
            <StatusBar battery={59} />
            <div className="page-head">
              <h1>组合</h1>
              <button className="icon-btn"><i data-lucide="book-open"></i></button>
              <button className="icon-btn"><i data-lucide="share"></i></button>
              <MiniLogo />
            </div>
            <section className="section">
              <div className="summary-card">
                <div className="summary-row">
                  <div><span>近一年收益</span><b style={{ color: snapshot.stats.color === "up" ? "#FF4D4F" : "#00B578" }}>{snapshot.totalReturnText}</b></div>
                  <div><span>最大回撤</span><b>{snapshot.drawdownText}</b></div>
                  <div><span>风险</span><b>{snapshot.style}</b></div>
                </div>
                <div style={{ marginTop: 14 }}>
                  <MiniChart holdings={items} height={120} />
                </div>
                <p>数据来自内嵌的 ETF 历史行情（{snapshot.dates[0]} ~ {snapshot.dates[snapshot.dates.length-1]}），按持仓权重加权合成。当前组合由 {items.length} 只 ETF 构成，系统会按偏离度、定期规则和波动状态推送提醒。</p>
              </div>
            </section>
            <section className="section">
              <div className="section-head">
                <h2>当前持仓</h2>
                <button className="btn soft" style={{ minHeight: 42, fontSize: 15 }} onClick={() => onNav("builder")}>调整</button>
              </div>
              <div className="asset-list">
                {items.map((item) => (
                  <article className="asset-row" key={item.ticker}>
                    <div className="asset-top">
                      <span className={`ticker ${item.tone}`}>{item.ticker.slice(0, 1)}</span>
                      <div>
                        <h3>{item.ticker} · {item.name}</h3>
                        <p>{item.region}</p>
                      </div>
                      <b className="pct">{item.weight}%</b>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          </section>
        );
      }

      function BuilderBacktestPanel({ snapshot }) {
        const canvasRef = useRef(null);
        const [bench, setBench] = useState("none");

        const benchSeries = useMemo(() => {
          if (bench === "none" || !snapshot.dates.length) return [];
          return buildBenchmarkSeries(bench, snapshot.dates);
        }, [bench, snapshot.dates]);

        useEffect(() => {
          if (canvasRef.current && snapshot.series.length) {
            drawCurve(canvasRef.current, snapshot.series, snapshot.stats.color, benchSeries);
          }
        }, [snapshot, benchSeries]);

        const annualTxt = snapshot.returnText;
        const ddTxt = snapshot.drawdownText;
        let summary = snapshot.items.length > 0
          ? `基于内嵌的一年 ETF 历史数据（${snapshot.dates[0] || "--"} ~ ${snapshot.dates[snapshot.dates.length-1] || "--"}），这套组合的年化收益率约 ${annualTxt}，最大回撤约 ${ddTxt}。`
          : "请先在调节比例页添加 ETF，再查看回测结果。";
        if (snapshot.items.length > 0 && bench !== "none" && benchSeries.length) {
          const benchEnd = benchSeries[benchSeries.length - 1];
          if (benchEnd != null) {
            const benchRet = benchEnd / 100 - 1;
            const diff = snapshot.stats.totalReturn - benchRet;
            const benchName = ETF_META[bench]?.name || bench;
            summary += ` 同期 ${benchName} 收益 ${pctText(benchRet)}，组合${diff >= 0 ? "跑赢" : "落后"} ${Math.abs(diff * 100).toFixed(1)}%。`;
          }
        }

        return (
          <>
            <div className="section-head">
              <h2 style={{ fontSize: 20 }}>一年回测</h2>
              <span className="muted">按持仓权重加权合成</span>
            </div>
            <div className="analysis-card">
              <h3>历史组合效果</h3>
              <p>{summary}</p>
            </div>
            <div className="chart-panel">
              <canvas ref={canvasRef} style={{ width: "100%", height: 260, display: "block" }}></canvas>
            </div>
            <div className="bench-tabs">
              <button className={bench === "none" ? "active" : ""} onClick={() => setBench("none")}>无基准</button>
              <button className={bench === "VOO" ? "active" : ""} onClick={() => setBench("VOO")}>基准：股ETF(标普500)</button>
              <button className={bench === "BND" ? "active" : ""} onClick={() => setBench("BND")}>基准：债ETF(全债市)</button>
            </div>
          </>
        );
      }

      function BuilderScreen({ active, weights, templateIndex, panel, account, saved,
        setPanel, setAccount, applyTemplate, handleToggle, handleWeight, handleConfirmSave, snapshot }) {
        const template = templates[templateIndex];
        const total = weights.reduce((s, i) => s + i.weight, 0);
        const warnings = buildWarnings(weights);
        const pool = currentPool(account);

        return (
          <section className={`screen ${active ? "active" : ""}`} data-screen="builder">
            <StatusBar battery={58} />
            <div className="page-head single-right">
              <h1>修改我的组合</h1>
              <button className="icon-btn"><i data-lucide="settings"></i></button>
            </div>
            <nav className="tabs">
              {panelTabs.map((tab) => (
                <button key={tab.id} className={panel === tab.id ? "active" : ""} onClick={() => setPanel(tab.id)}>{tab.label}</button>
              ))}
            </nav>
            <section className="section">
              {panel === "adjust" && (
                <>
                  <div className="section-head">
                    <h2 style={{ fontSize: 20 }}>调节 ETF 比例</h2>
                    <span className="muted">合计 {total}%</span>
                  </div>
                  <div className="account-switch">
                    <button className={account === "A股" ? "active" : ""} onClick={() => setAccount("A股")}>A股账户</button>
                    <button className={account === "美股" ? "active" : ""} onClick={() => setAccount("美股")}>美股账户</button>
                  </div>
                  <div className="analysis-card" style={{ marginBottom: 14 }}>
                    <h3>组合提示</h3>
                    <p>{warnings.summary}</p>
                  </div>
                  <div className="analysis-card" style={{ marginBottom: 14 }}>
                    <h3>{account} ETF 池</h3>
                    <p>当前只显示 {account} 可用 ETF，支持增删后再保存。</p>
                  </div>
                  <div className="asset-list">
                    {pool.map((item) => {
                      const current = weights.find((e) => e.ticker === item.ticker);
                      const activeETF = Boolean(current && current.weight > 0);
                      const weight = current ? current.weight : 0;
                      return (
                        <article className="asset-row" key={item.ticker}>
                          <div className="asset-top">
                            <span className={`ticker ${item.tone}`}>{item.ticker.slice(0, 1)}</span>
                            <div>
                              <h3>{item.ticker} · {item.name}</h3>
                              <p>{marketLabel(item)} · {item.region}</p>
                            </div>
                            <b className="pct">{weight}%</b>
                          </div>
                          <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 10 }}>
                            <button className={`btn ${activeETF ? "outline" : "primary"}`} style={{ minHeight: 34, fontSize: 13, padding: "0 12px" }} onClick={() => handleToggle(item.ticker)}>
                              {activeETF ? "移除" : "添加"}
                            </button>
                            <input type="range" min="0" max="50" step="1" value={weight} disabled={!activeETF} onChange={(e) => handleWeight(item.ticker, e.target.value)} />
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </>
              )}
              {panel === "import" && (
                <>
                  <div className="section-head">
                    <h2 style={{ fontSize: 20 }}>导入大师比例</h2>
                    <span className="muted">一键套用</span>
                  </div>
                  <div className="template-list">
                    {templates.map((tpl, index) => (
                      <button key={index} className={`template-card ${index === templateIndex ? "active" : ""}`} onClick={() => applyTemplate(index)}>
                        <h3>{tpl.name}</h3>
                        <p>{tpl.desc}</p>
                        <div className="meta">
                          <span className="chip">{tpl.risk} 风格</span>
                          <span className="chip">{tpl.items.filter((i) => i.weight > 0).length} 只 ETF</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </>
              )}
              {panel === "save" && (
                <>
                  <div className="section-head">
                    <h2 style={{ fontSize: 20 }}>确认保存</h2>
                    <span className="muted">我的组合配置</span>
                  </div>
                  <div className="save-card">
                    <h3>{saved?.name || template.name}</h3>
                    <p className="save-note">点击确认后，这套比例会保存为"我的组合配置"。系统会按当前权重给出风格建议，并提示比例过高的资产。</p>
                    <div className="save-result">
                      <strong>{warnings.style}</strong>
                      <p>{warnings.summary}</p>
                    </div>
                  </div>
                </>
              )}
              {panel === "backtest" && (
                <BuilderBacktestPanel snapshot={snapshot} />
              )}
            </section>
            {panel === "save" && (
              <div className="builder-savebar">
                <div className="total-bar">
                  <div>
                    <strong>确认保存</strong>
                    <span>保存为我的组合配置</span>
                  </div>
                  <button className="btn primary" onClick={handleConfirmSave}>确认保存</button>
                </div>
              </div>
            )}
          </section>
        );
      }

      function AnalysisScreen({ active, weights, onNav }) {
        const items = selectedItems(weights);
        const largest = [...items].sort((a, b) => b.weight - a.weight)[0];
        const defensive = items.filter((i) => ["BND", "TLT", "GLD", "511090", "518880"].includes(i.ticker)).reduce((s, i) => s + i.weight, 0);
        const equity = Math.max(0, 100 - defensive);
        return (
          <section className={`screen ${active ? "active" : ""}`} data-screen="analysis">
            <StatusBar battery={59} />
            <div className="center-head page-head">
              <h1>配置分析</h1>
              <button className="icon-btn" onClick={() => onNav("builder")}><i data-lucide="chevron-left"></i></button>
              <button className="icon-btn"><i data-lucide="share"></i></button>
              <MiniLogo />
            </div>
            <section className="section">
              <div className="analysis-card">
                <h3>你买的是什么</h3>
                <p>你不是只买一只基金，而是把 {items.length} 个方向装进同一个篮子。当前核心是 {largest?.name || "ETF组合"}，负责组合的主要增长来源。</p>
              </div>
              <button className="ai-strip" onClick={() => onNav("backtest")}><i data-lucide="trending-up"></i> 查看历史回测</button>
              <div className="analysis-card">
                <h3>底层资产汇总</h3>
                <p>权益约 {equity}%，防御资产约 {defensive}%。股票负责增长，债券和黄金负责在波动时降低组合情绪压力。</p>
              </div>
              <div className="analysis-card" style={{ marginTop: 14, background: "#fff8f1" }}>
                <h3>AI 提醒</h3>
                <p>{equity > 70 ? "权益比例偏高，适合能承受较大波动的用户。若想更稳，可以提高债券或黄金比例。" : "当前结构偏均衡，重点不是短线预测，而是减少用户在波动中手动干预的冲动。"}</p>
              </div>
            </section>
            <section className="section">
              <h2>资产分布</h2>
              <div className="asset-list">
                {items.map((item) => (
                  <article className="asset-row" key={item.ticker}>
                    <div className="asset-top">
                      <span className={`ticker ${item.tone}`}>{item.ticker.slice(0, 1)}</span>
                      <div>
                        <h3>{item.region}</h3>
                        <p>{item.ticker} · {item.name}</p>
                      </div>
                      <b className="pct">{item.weight}%</b>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          </section>
        );
      }

      function BacktestScreen({ active, snapshot, onNav }) {
        const canvasRef = useRef(null);
        const [bench, setBench] = useState("none");

        const benchSeries = useMemo(() => {
          if (bench === "none" || !snapshot.dates.length) return [];
          return buildBenchmarkSeries(bench, snapshot.dates);
        }, [bench, snapshot.dates]);

        useEffect(() => {
          if (active && canvasRef.current && snapshot.series.length) {
            drawCurve(canvasRef.current, snapshot.series, snapshot.stats.color, benchSeries);
          }
        }, [active, snapshot, benchSeries]);

        const up = snapshot.stats.color === "up";
        const retColor = up ? "#FF4D4F" : "#00B578";
        const ddColor = "#00B578";
        const volColor = "#7209F6";
        const retIcon = up ? "▲" : "▼";

        // 基准对比信息
        let benchInfo = null;
        if (bench !== "none" && benchSeries.length) {
          const benchEnd = benchSeries[benchSeries.length - 1];
          if (benchEnd != null) {
            const benchRet = benchEnd / 100 - 1;
            const diff = snapshot.stats.totalReturn - benchRet;
            const benchName = ETF_META[bench]?.name || bench;
            benchInfo = { name: benchName, ret: benchRet, diff };
          }
        }

        return (
          <section className={`screen ${active ? "active" : ""}`} data-screen="backtest">
            <StatusBar battery={58} />
            <div className="topbar">
              <button className="icon-btn" onClick={() => onNav("analysis")}><i data-lucide="chevron-left"></i></button>
              <div style={{ marginRight: "auto" }}>
                <b>组合回测</b>
                <div className="muted">{snapshot.dates[0]} ~ {snapshot.dates[snapshot.dates.length-1]}</div>
              </div>
              <button className="icon-btn"><i data-lucide="search"></i></button>
              <button className="icon-btn dark"><i data-lucide="check"></i></button>
              <button className="icon-btn"><i data-lucide="share"></i></button>
            </div>
            <section className="section">
              <h2 style={{ fontSize: 42, marginBottom: 4 }}>历史表现</h2>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <strong style={{ fontSize: 54, color: retColor }}>{snapshot.totalReturnText}</strong>
                <span className="muted">近一年收益</span>
              </div>
              <p style={{ margin: 0, fontSize: 22, fontWeight: 950 }}>
                <span style={{ color: retColor }}>{retIcon} <b>{snapshot.returnText}</b></span>
                <span style={{ marginLeft: 8 }}>年化收益</span>
              </p>
              <p style={{ margin: "6px 0 0", fontSize: 22, fontWeight: 950 }}>
                <span style={{ color: ddColor }}>▼ <b>{snapshot.drawdownText}</b></span>
                <span style={{ marginLeft: 8 }}>最大回撤</span>
              </p>
              <p style={{ margin: "6px 0 0", fontSize: 22, fontWeight: 950 }}>
                <span style={{ color: volColor }}>■ <b>{snapshot.volText}</b></span>
                <span style={{ marginLeft: 8 }}>年化波动率</span>
              </p>
              {benchInfo && (
                <div className="bench-info">
                  <span>基准 {benchInfo.name}：<b style={{ color: benchInfo.ret >= 0 ? "#FF4D4F" : "#00B578" }}>{pctText(benchInfo.ret)}</b></span>
                  <span style={{ marginLeft: 12, color: benchInfo.diff >= 0 ? "#FF4D4F" : "#00B578" }}>
                    组合{benchInfo.diff >= 0 ? "跑赢" : "落后"} {Math.abs(benchInfo.diff * 100).toFixed(1)}%
                  </span>
                </div>
              )}
              <div className="chart-panel">
                <canvas ref={canvasRef} style={{ width: "100%", height: 260, display: "block" }}></canvas>
              </div>
              <div className="bench-tabs">
                <button className={bench === "none" ? "active" : ""} onClick={() => setBench("none")}>无基准</button>
                <button className={bench === "VOO" ? "active" : ""} onClick={() => setBench("VOO")}>股ETF</button>
                <button className={bench === "BND" ? "active" : ""} onClick={() => setBench("BND")}>债ETF</button>
              </div>
              <div className="time-tabs">
                <button className="active">1年</button><button>3年</button><button>5年</button><button>10年</button>
                <button><i data-lucide="chart-candlestick"></i></button>
              </div>
            </section>
            <section className="section">
              <button className="signal green" onClick={() => onNav("notify")}>
                <span>#开启波动安抚通知</span><span className="go"><i data-lucide="chevron-right"></i></span>
              </button>
              <button className="signal red" onClick={() => onNav("rebalance")}>
                <span>#设置自动调仓规则</span><span className="go"><i data-lucide="chevron-right"></i></span>
              </button>
            </section>
          </section>
        );
      }

      function RebalanceScreen({ active, onNav }) {
        const [rules, setRules] = useState([
          { title: "偏离 5% 自动提醒", desc: "组合偏离目标比例时提示", on: true },
          { title: "每 30 天定期再平衡", desc: "适合长期持有用户", on: true },
          { title: "仅提醒不自动交易", desc: "保留用户最终确认", on: true },
          { title: "0损耗配平 - 投入", desc: "新增资金优先补低配资产", on: false },
          { title: "0损耗配平 - 提取", desc: "取出资金优先卖超配资产", on: false },
        ]);
        const toggle = (idx) => setRules((prev) => prev.map((r, i) => (i === idx ? { ...r, on: !r.on } : r)));
        return (
          <section className={`screen ${active ? "active" : ""}`} data-screen="rebalance">
            <StatusBar battery={59} />
            <div className="page-head">
              <h1>调仓规则</h1>
              <button className="icon-btn" onClick={() => onNav("backtest")}><i data-lucide="x"></i></button>
            </div>
            <section className="section">
              <div className="rules">
                {rules.map((rule, idx) => (
                  <div className="rule" key={idx}>
                    <div>
                      <strong>{rule.title}</strong>
                      <span>{rule.desc}</span>
                    </div>
                    <span className={`switch ${rule.on ? "on" : ""}`} role="switch" aria-checked={rule.on} onClick={() => toggle(idx)}></span>
                  </div>
                ))}
              </div>
              <button className="btn full primary" style={{ marginTop: 20 }} onClick={() => onNav("overview")}>确认组合</button>
            </section>
          </section>
        );
      }

      function NotifyScreen({ active }) {
        return (
          <section className={`screen ${active ? "active" : ""}`} data-screen="notify">
            <StatusBar battery={59} />
            <div className="page-head single-right">
              <h1>智能通知</h1>
              <button className="icon-btn"><i data-lucide="settings"></i></button>
            </div>
            <section className="section">
              <div className="notice-list">
                {notices.map((item, idx) => (
                  <article className="notice-card" key={idx}>
                    <div className="meta"><span className="flame">♜</span><b>{item.type}</b><span>· {item.time}</span></div>
                    <h3>{item.title}</h3>
                    <button className="ai-strip"><i data-lucide="sparkles"></i> Bobby策略解读</button>
                    <p>{item.body}</p>
                  </article>
                ))}
              </div>
            </section>
          </section>
        );
      }

      function ImportScreen({ active }) {
        return (
          <section className={`screen ${active ? "active" : ""}`} data-screen="import">
            <StatusBar battery={57} />
            <div className="page-head">
              <h1>导入</h1>
              <button className="icon-btn"><i data-lucide="settings"></i></button>
            </div>
            <section className="section">
              <div className="import-box">
                <div>
                  <i><span data-lucide="image-up"></span></i>
                  <h2>导入已有持仓</h2>
                  <p>截图识别能力已预留，Demo 中展示识别入口与组合优化路径。</p>
                  <button className="btn primary">上传截图</button>
                </div>
              </div>
            </section>
            <section className="section">
              <h2>识别后会生成</h2>
              <div className="analysis-card">
                <h3>AI整理持仓</h3>
                <p>把用户已有 ETF 拆成地区、资产类别、风险敞口，并给出是否需要补齐债券、黄金或海外资产的建议。</p>
              </div>
            </section>
          </section>
        );
      }

      function BottomNav({ current, onNav }) {
        const items = [
          { id: "home", icon: "home", label: "探索" },
          { id: "overview", icon: "pie-chart", label: "组合" },
          { id: "builder", icon: "bot", label: "修改组合" },
          { id: "import", icon: "scan-line", label: "导入" },
          { id: "notify", icon: "bell", label: "通知" },
        ];
        return (
          <nav className="bottom-nav">
            {items.map((item) => (
              <button key={item.id} className={current === item.id ? "active" : ""} onClick={() => onNav(item.id)}>
                <i data-lucide={item.icon}></i>
                <span>{item.label}</span>
              </button>
            ))}
          </nav>
        );
      }

      /* ============ 主应用 ============ */
      function App() {
        const [currentScreen, setCurrentScreen] = useState("home");
        const [templateIndex, setTemplateIndex] = useState(0);
        const [weights, setWeights] = useState(templates[0].items.map((i) => ({ ...i })));
        const [panel, setPanel] = useState("adjust");
        const [account, setAccount] = useState("美股");
        const [saved, setSaved] = useState(null);

        const go = useCallback((screen) => {
          setCurrentScreen(screen);
        }, []);

        const handleSetAccount = useCallback((acc) => {
          setAccount(acc);
          setWeights((prev) => {
            const pool = currentPool(acc);
            const next = [];
            pool.forEach((item) => {
              const existing = prev.find((e) => e.ticker === item.ticker);
              next.push(existing ? { ...item, weight: existing.weight } : { ...item, weight: 0 });
            });
            return next.length ? next : prev;
          });
        }, []);

        const applyTemplate = useCallback((index) => {
          setTemplateIndex(index);
          setWeights(templates[index].items.map((i) => ({ ...i })));
          setPanel("adjust");
        }, []);

        const handleToggle = useCallback((ticker) => {
          setWeights((prev) => prev.map((item) => (item.ticker === ticker ? { ...item, weight: item.weight > 0 ? 0 : 12 } : item)));
        }, []);

        const handleWeight = useCallback((ticker, value) => {
          setWeights((prev) => prev.map((item) => (item.ticker === ticker ? { ...item, weight: Number(value) } : item)));
        }, []);

        const liveSnapshot = useMemo(() => buildSnapshot(weights, templateIndex), [weights, templateIndex]);
        const displaySnapshot = saved || liveSnapshot;

        const handleConfirmSave = useCallback(() => {
          setSaved(buildSnapshot(weights, templateIndex));
        }, [weights, templateIndex]);

        // 每次渲染后刷新 Lucide 图标
        useEffect(() => {
          if (window.lucide) window.lucide.createIcons();
        });

        return (
          <main className="phone" aria-label="大道至简 均衡配置 Demo">
            <HomeScreen active={currentScreen === "home"} onNav={go} />
            <OverviewScreen active={currentScreen === "overview"} snapshot={displaySnapshot} onNav={go} />
            <BuilderScreen
              active={currentScreen === "builder"}
              weights={weights}
              templateIndex={templateIndex}
              panel={panel}
              account={account}
              saved={saved}
              setPanel={setPanel}
              setAccount={handleSetAccount}
              applyTemplate={applyTemplate}
              handleToggle={handleToggle}
              handleWeight={handleWeight}
              handleConfirmSave={handleConfirmSave}
              snapshot={liveSnapshot}
            />
            <AnalysisScreen active={currentScreen === "analysis"} weights={weights} onNav={go} />
            <BacktestScreen active={currentScreen === "backtest"} snapshot={displaySnapshot} onNav={go} />
            <RebalanceScreen active={currentScreen === "rebalance"} onNav={go} />
            <NotifyScreen active={currentScreen === "notify"} />
            <ImportScreen active={currentScreen === "import"} />
            <BottomNav current={currentScreen} onNav={go} />
            <span className="home-indicator"></span>
          </main>
        );
      }

      ReactDOM.createRoot(document.getElementById("root")).render(<App />);
    