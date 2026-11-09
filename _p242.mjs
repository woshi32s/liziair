import fs from "node:fs";
const p = "_b-spec/242.mjs";
let s = fs.readFileSync(p, "utf8");
const rep = (a, b) => { if (!s.includes(a)) throw new Error("miss: " + a.slice(0, 70)); s = s.split(a).join(b); };
rep("'  float pud = smoothstep(0.56, 0.72, pudN)*0.85;',", "'  float pud = smoothstep(0.60, 0.78, pudN)*0.55;',");
rep("vec2 tiltD = gA*0.030 + vec2(sand - 0.5, vn(uv*390.0 + 7.0) - 0.5)*0.055;",
    "vec2 tiltD = gA*0.016 + vec2(sand - 0.5, vn(uv*390.0 + 7.0) - 0.5)*0.030;");
rep("vec2 tilt = mix(tiltD, tiltW, wetA);",
    "vec2 pudTilt = vec2(vn(uv*1.15 + 5.0) - 0.5, vn(uv*0.95 - 8.0) - 0.5)*0.045;\n    '  vec2 tilt = mix(tiltD, pudTilt, pud);\n    '  tilt = mix(tilt, tiltW, film);");
fs.writeFileSync(p, s); console.log("ok");
