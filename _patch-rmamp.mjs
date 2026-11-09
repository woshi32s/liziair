/* 一次性补丁：给 10 个机制的 mechStats() 加上 rmAmp（实际用的降幅系数），
   供 _check-a-discipline.mjs 自证 reduce 下真的降级。跑完即可删。 */
import fs from 'node:fs';
const ROOT = 'E:/DSHdesktop/work/music-player/_gen-a';
const AMP = { 200: 0.28, 201: 0.35, 202: 0.35, 203: 0.4, 204: 0.4, 205: 0.4, 206: 0.4, 207: 0.35, 208: 0.3, 209: 0.3 };
for (const no of Object.keys(AMP)) {
  const p = `${ROOT}/s${no}.js`;
  let s = fs.readFileSync(p, 'utf8');
  if (s.includes('rmAmp')) { console.log('skip', no); continue; }
  const needle = 'function mechStats() {\n  return {';
  if (!s.includes(needle)) { console.log('!! no mechStats in', no); continue; }
  s = s.replace(needle, `function mechStats() {\n  return {\n    rmAmp: RM ? ${AMP[no]} : 1,`);
  fs.writeFileSync(p, s);
  console.log('patched', no);
}
