import fs from "node:fs";
let s = fs.readFileSync("_b-spec/248.mjs", "utf8");
const rep = (a, b) => { if (!s.includes(a)) throw new Error("miss: " + a.slice(0, 70)); s = s.split(a).join(b); };
rep("float a0 = 1.02 + vn(uv*0.55 + 2.0)*0.62 + vn(uv*1.70 - 3.0)*0.20;",
`float sy = -0.02 + 0.05*sin(uv.x*0.55 + 0.4);
    '  float above = step(sy, uv.y);
    '  float aNoise = (vn(uv*0.55 + 2.0) - 0.5)*0.30 + (vn(uv*1.70 - 3.0) - 0.5)*0.12;
    '  float aUp = 0.92 + aNoise;
    '  float aDn = -0.92 + aNoise;
    '  float a0 = mix(aDn, aUp, above);`);
rep("float ang = mix(a0, 1.02 + 0.10*vn(uv*2.0), flat_*0.92);", "float ang = mix(a0, 0.06 + 0.10*vn(uv*2.0), flat_*0.92);");
rep("vec2 L = vec2(cos(1.02 + uv.x*0.30 + uv.y*0.16 + t*0.02), sin(1.02 + uv.x*0.30 + uv.y*0.16 + t*0.02));",
    "vec2 L = vec2(cos(0.92 + uv.x*0.34 + uv.y*0.18 + t*0.02), sin(0.92 + uv.x*0.34 + uv.y*0.18 + t*0.02));");
/* 羽轴：一条暗脊 + 两侧亮边 */
rep("vec3 col = base + irid*pow(fil, 1.05)*0.62;",
`vec3 col = base + irid*pow(fil, 1.05)*0.62;
    /* 羽轴：一根粗的轴，两侧的羽枝从它上面长出来；轴是骨白的，带一点高光 */
    '  float shaft = exp(-pow((uv.y - sy)/0.013, 2.0));
    '  float shaftHl = exp(-pow((uv.y - sy + 0.008)/0.006, 2.0));
    '  col = mix(col, vec3(0.30,0.30,0.28) + vec3(0.35,0.34,0.30)*shaftHl, shaft*0.80*(1.0 - flat_*0.55));`);
fs.writeFileSync("_b-spec/248.mjs", s); console.log("ok");
