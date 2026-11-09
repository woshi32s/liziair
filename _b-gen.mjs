/** 形态生成器：把 _b-spec/<id>.mjs 的机制代码拼进 _b-tpl.html，产出 public/stages/<num>-<slug>.html
 *  用法：node _b-gen.mjs [211 212 ...] */
import fs from 'node:fs';
import path from 'node:path';

const tpl = fs.readFileSync('_b-tpl.html', 'utf8');
const args = process.argv.slice(2);
const ids = args.length ? args
  : fs.readdirSync('_b-spec').filter((f) => f.endsWith('.mjs')).map((f) => f.slice(0, -4)).sort();

for (const id of ids) {
  const mod = await import('file:///' + path.resolve('_b-spec', id + '.mjs').replace(/\\/g, '/'));
  const S = mod.default;
  const fsSrc = '[\n' + S.fs.map((l) => '  ' + JSON.stringify(l)).join(',\n') + '\n].join("\\n")';
  let out = tpl;
  const put = (k, v) => { out = out.split(k).join(v); };
  put('__TITLE__', S.title);
  put('__DOC__', S.doc);
  put('__FS__', fsSrc);
  put('__PLATE__', S.plate || '  /* 无凸版：字完全由着色器画 */');
  put('__POST__', S.post || '');
  put('__ACCBASE__', JSON.stringify(S.accent));
  put('__FIBERS__', String(!!S.fibers));
  put('__MOTES__', String(!!S.motes));
  put('__PLATEBLEND__', S.plateBlend || 'source-over');
  put('__PLATEALPHA__', String(S.plateAlpha == null ? 1 : S.plateAlpha));
  if (/__[A-Z]+__/.test(out)) {
    console.error('!! 模板占位符没替换干净:', out.match(/__[A-Z]+__/g));
    process.exit(1);
  }
  const file = path.join('public/stages', `${S.num}-${S.slug}.html`);
  fs.writeFileSync(file, out);
  console.log('wrote', file, out.length);
}
