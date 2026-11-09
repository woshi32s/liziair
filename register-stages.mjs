/**
 * 生成 STAGES 注册表并写进 app.js。
 * 001-010 用**手工维护**的名字和描述（它们比自动提取的好），
 * 011 之后从每个文件的开头注释里自动提取机制描述。
 * 只注册磁盘上真实存在的文件，可以反复跑。
 */
import fs from 'node:fs';

const DIR = 'E:/DSHdesktop/work/music-player/public/stages';
const APP = 'E:/DSHdesktop/work/music-player/public/app.js';

/* 001-010：手工维护，不要被自动提取覆盖 */
const CURATED = [
  { id: '001', name: '粒子歌词', desc: '粒子在不同地方聚成词，镜头移过去', url: 'stages/001-particle-lyrics.html' },
  { id: '002', name: '星际歌词', desc: '一路飞过去，一句一句穿过', url: 'stages/002-starfield-lyrics.html' },
  { id: '003', name: '萤火虫歌词', desc: '光绘：字是长曝光显影出来的', url: 'stages/003-firefly-lyrics.html' },
  { id: '004', name: '沙粒歌词', desc: '重力：沙从上落下堆成字，唱完塌掉', url: 'stages/004-sand-lyrics.html' },
  { id: '005', name: '粒子文字', desc: '原地重构：不散开，直接变成下一句', url: 'stages/005-particle-morph.html' },
  { id: '006', name: '风之图', desc: '字形轮廓当轨道，粒子沿链跑；背景风绕开文字', url: 'stages/006-wind-lyrics.html' },
  { id: '007', name: '铁屑磁场', desc: '靠朝向显形：铁屑转向对齐笔画', url: 'stages/007-magnetic-lyrics.html' },
  { id: '008', name: '静雪', desc: '雪碰到笔画就粘住，唱完被横风吹散', url: 'stages/008-snow-lyrics.html' },
  { id: '009', name: '形态演化', desc: '粒子沿对数螺线盘旋进去成字', url: 'stages/009-vortex-lyrics.html' },
  { id: '010', name: '余烬', desc: '字是上升气流里的驻波，一直在被重建', url: 'stages/010-embers-lyrics.html' },
];

/* 源作品中文名（011 之后用） */
const ZH = {
  '011': '等离子体', '012': '光行洞穴', '013': '水波涟漪', '014': '万花筒', '015': '液态金属',
  '016': '极光', '017': '特鲁谢光轨', '018': '无限缩放', '019': '墨云', '020': '网格地平线',
  '021': '动态字体', '022': '乱码解码', '023': '轮廓脉冲', '024': '字幕墙', '025': '字符相机',
  '026': '翻页牌', '027': '代码雨', '028': '波形文字', '029': '渐变遮罩', '030': '故障标题',
  '031': 'CSS 立方体', '032': '新拟态面板', '033': '加载动画', '034': 'CSS 日落', '035': '黏稠按钮',
  '036': '倾斜卡片', '037': '漂浮画廊', '038': 'CSS 沙漏', '039': '形变团块', '040': '等距房间',
  '041': '万花尺', '042': '叶序', '043': '利萨如曲线', '044': '摩尔纹', '045': '泰森多边形',
  '046': '双曲空间', '047': '傅里叶绘图', '048': '谢尔宾斯基', '049': '双摆', '050': '超公式',
  '051': 'L 系统树', '052': '元胞自动机', '053': '生命轨迹', '054': '噪声山脉', '055': '递归方块',
  '056': '行进地形', '057': '特鲁谢圆点', '058': '闪电', '059': '珊瑚生长', '060': '星系',
  '061': '布料', '062': '弹簧链', '063': '丝带', '064': '球池', '065': '多米诺',
  '066': '印章工厂', '067': '颜料流动', '068': '弹性网格', '069': '碎裂', '070': '重力沙盒',
};

/** 从文件里抽出开头那段注释，取第一行有内容的作为机制描述 */
function extractDesc(text) {
  const i = text.indexOf('"use strict";');
  if (i < 0) return '';
  const j = text.indexOf('/*', i);
  if (j < 0) return '';
  const k = text.indexOf('*/', j);
  if (k < 0) return '';
  for (const raw of text.slice(j + 2, k).split('\n')) {
    let line = raw.trim().replace(/^[=*·\s]+/, '').replace(/[=\s]+$/, '');
    if (!line) continue;
    line = line.replace(/^\d{3}\s*[·:：]?\s*/, '').replace(/^[^—]{0,30}——\s*/, '');
    // 去掉 markdown 加粗标记，菜单里不渲染
    line = line.replace(/\*\*/g, '');
    if (line.length < 6) continue;
    return line.slice(0, 40);
  }
  return '';
}

const files = fs.readdirSync(DIR).filter((f) => /^\d{3}-.+\.html$/.test(f)).sort();
const syntaxBad = [];
const auto = [];

for (const f of files) {
  const id = f.slice(0, 3);
  if (CURATED.some((c) => c.id === id)) continue;      // 001-010 跳过
  const text = fs.readFileSync(DIR + '/' + f, 'utf8');
  const m = text.match(/<script>\s*([\s\S]*?)<\/script>\s*<\/body>/);
  if (!m) syntaxBad.push(id + '(找不到脚本)');
  else { try { new Function(m[1]); } catch (e) { syntaxBad.push(id + '(' + e.message.slice(0, 40) + ')'); } }
  auto.push({ id, name: ZH[id] || id, desc: extractDesc(text) || (ZH[id] || id), url: 'stages/' + f });
}

console.log('手工维护 ' + CURATED.length + ' 项，自动注册 ' + auto.length + ' 项，共 ' + (CURATED.length + auto.length) + ' 项');
console.log('语法问题: ' + (syntaxBad.length ? syntaxBad.join(' | ') : '无'));

const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const lines = ['  const STAGES = [', "    { id: 'classic', name: '传统播放器', desc: '大封面 + 歌词面板', url: null },"];
for (const e of CURATED.concat(auto)) {
  lines.push("    { id: '" + e.id + "', name: '" + esc(e.name) + "', desc: '" + esc(e.desc) + "', url: '" + e.url + "' },");
}
lines.push('  ];');

let app = fs.readFileSync(APP, 'utf8');
const start = app.indexOf('  const STAGES = [');
const end = app.indexOf('\n  ];', start);
if (start < 0 || end < 0) { console.log('★ 没定位到 STAGES 数组'); process.exit(1); }
fs.writeFileSync(APP, app.slice(0, start) + lines.join('\n') + app.slice(end + 4));

console.log('');
console.log('抽样:');
for (const e of CURATED.slice(5, 8).concat(auto.slice(0, 3)).concat(auto.slice(-3))) {
  console.log('  ' + e.id + '  ' + e.name.padEnd(11) + ' ' + e.desc);
}