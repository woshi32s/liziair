import fs from "node:fs";
// 更严的 lint：以 ' 开头的行必须以 ', 或 ' 结尾
const ids = process.argv.slice(2).length ? process.argv.slice(2) : fs.readdirSync("_b-spec").filter(f=>f.endsWith(".mjs")).map(f=>f.slice(0,-4)).sort();
let bad = 0;
for (const id of ids) {
  const p = "_b-spec/" + id + ".mjs";
  const lines = fs.readFileSync(p, "utf8").split("\n");
  lines.forEach((l, i) => {
    const t = l.trim();
    if (t.startsWith("'") && !t.endsWith("',") && !t.endsWith("'")) { console.log(`${id}:${i+1} 未收尾: ${t.slice(0,70)}`); bad++; }
  });
}
console.log(bad ? `!! ${bad} 处` : "lint ok");
