import fs from "node:fs";
const p = "_b-spec/240.mjs";
let s = fs.readFileSync(p, "utf8");
const rep = (a, b) => { if (!s.includes(a)) throw new Error("miss: " + a.slice(0, 60)); s = s.split(a).join(b); };
rep("plateAlpha: 0.93,", "plateAlpha: 0.97,");
rep("'  col += u_ac*rim*0.055*(0.35 + 0.65*d1);',", "'  col += u_ac*rim*0.030*(0.35 + 0.65*d1);',");
rep("'  col += vec3(0.34,0.26,0.16)*h*h*0.11*(0.4 + 0.6*d1);',", "'  col += vec3(0.30,0.24,0.15)*h*h*0.075*(0.4 + 0.6*d1);',");
rep("g.globalAlpha = 0.40;\n  g.fillStyle = '#04070a';\n  g.filter = 'blur(' + (fs * 0.024).toFixed(1) + 'px)';",
    "g.globalAlpha = 0.55;\n  g.fillStyle = '#04070a';\n  g.filter = 'blur(' + (fs * 0.014).toFixed(1) + 'px)';");
fs.writeFileSync(p, s); console.log("ok");
