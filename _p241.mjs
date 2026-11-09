import fs from "node:fs";
const p = "_b-spec/241.mjs";
let s = fs.readFileSync(p, "utf8");
const rep = (a, b) => { if (!s.includes(a)) throw new Error("miss: " + a.slice(0, 70)); s = s.split(a).join(b); };
rep("vec4 A = facet((uv + sheet*0.18)*13.0 + 2.0);", "vec4 A = facet((uv + sheet*0.30)*6.0 + 2.0);");
rep("vec4 B = facet((uv + sheet*0.18)*37.0 - 5.0);", "vec4 B = facet((uv + sheet*0.30)*15.0 - 5.0);");
rep("vec2 nxy = sheet + sheet2 + A.xy*0.62 + B.xy*0.30;", "vec2 nxy = sheet*1.25 + sheet2 + A.xy*0.72 + B.xy*0.20;");
rep("float edA = smoothstep(0.070, 0.0, A.z)*mix(1.0, 0.06, flat_);", "float edA = smoothstep(0.085, 0.0, A.z)*mix(1.0, 0.06, flat_);");
rep("float edB = smoothstep(0.055, 0.0, B.z)*mix(1.0, 0.03, flat_);", "float edB = smoothstep(0.045, 0.0, B.z)*mix(1.0, 0.03, flat_);");
rep("c *= 1.0 - 0.26*edA - 0.14*edB;", "c *= 1.0 - 0.16*edA - 0.08*edB;");
rep("c += vec3(0.98,0.99,1.0)*(edA*0.30 + edB*0.14)*(0.35 + 0.65*max(N.y*0.5+0.5, 0.0));",
    "c += vec3(0.98,0.99,1.0)*(edA*0.22 + edB*0.10)*(0.35 + 0.65*max(N.y*0.5+0.5, 0.0));");
rep("c += vec3(1.00,0.98,0.93)*pow(w, 30.0)*2.10;", "c += vec3(1.00,0.98,0.93)*pow(w, 9.0)*0.95;");
rep("c += vec3(0.80,0.86,1.00)*pow(w, 6.0)*0.26;", "c += vec3(0.84,0.89,1.00)*pow(w, 3.0)*0.30;");
rep("c += vec3(0.72,0.80,0.96)*pow(w2, 52.0)*0.72;", "c += vec3(0.72,0.80,0.96)*pow(w2, 26.0)*0.55;");
rep("c *= 1.0 - 0.40*ao;", "c *= 1.0 - 0.34*ao;");
rep("c *= 1.0 + 0.22*flat_*u_st;", "c *= 1.0 + 0.30*flat_;");
fs.writeFileSync(p, s); console.log("ok");
