import fs from "node:fs";
let s = fs.readFileSync("_b-spec/247.mjs", "utf8");
s = s.replace("float trans = exp(-2.55*sootD);", "float trans = exp(-3.10*sootD);");
s = s.replace("col += vec3(0.085,0.075,0.070)*(1.0 - sootD)*0.55;", "col += vec3(0.070,0.062,0.058)*(1.0 - sootD)*0.42;");
s = s.replace("col += vec3(0.055,0.045,0.038)*(1.0 - sootD*0.6);", "col += vec3(0.040,0.033,0.028)*(1.0 - sootD*0.6);");
fs.writeFileSync("_b-spec/247.mjs", s); console.log("ok");
