const fs = require('fs');
const babel = require('@babel/core');

const htmlPath = 'c:\\Users\\www\\Desktop\\大道至简\\md-demo.html';
const jsxPath = 'c:\\Users\\www\\.trae-cn\\work\\6a49c83c7cac454a2daea8b6\\app.jsx';
const dataPath = 'c:\\Users\\www\\.trae-cn\\work\\6a49c83c7cac454a2daea8b6\\etf-data.json';

// 读取 JSX 源码（含标记占位符）
let code = fs.readFileSync(jsxPath, 'utf8');

// 注入 ETF 历史数据到源码头部
const etfData = fs.readFileSync(dataPath, 'utf8').trim();
code = code.replace('/* __ETF_DATA_PLACEHOLDER__ */', 'const ETF_DATA = ' + etfData + ';');
console.log('app.jsx after data inject length:', code.length);

// classic runtime 编译，避免 import 语句
const result = babel.transformSync(code, {
  presets: [['@babel/preset-react', { runtime: 'classic' }]],
  sourceType: 'module',
  filename: 'app.jsx'
});
const compiled = result.code;

if (/\bimport\s/.test(compiled) || /\bexport\s/.test(compiled)) {
  console.error('ERROR: compiled code contains import/export');
  process.exit(1);
}
console.log('compiled length:', compiled.length);

// 组装 HTML：保留 CSS/CDN，替换主脚本
let html = fs.readFileSync(htmlPath, 'utf8');
html = html.replace(/<script src="https:\/\/unpkg\.com\/@babel\/standalone\/babel\.min\.js"><\/script>\n?\s*/, '');
html = html.replace(/<script>\s*const\s*\{[\s\S]*?createRoot\([\s\S]*?<\/script>\s*/, '');
html = html.replace(/<script>\s*const\s*\{\s*useState[\s\S]*?createRoot\([\s\S]*?<\/script>\s*/, '');
html = html.replace('</body>', '    <script>\n' + compiled + '\n    </script>\n  </body>');

fs.writeFileSync(htmlPath, html, 'utf8');
console.log('Built md-demo.html OK. total length:', html.length);
