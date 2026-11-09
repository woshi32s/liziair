import fs from "node:fs";
let s = fs.readFileSync("_b-spec/245.mjs", "utf8");
s = s.replace("float spread = exp(-max(sd, 0.0)/0.115);", "float spread = exp(-max(sd, 0.0)/0.021);");
s = s.replace("float heat = clamp(core*0.66 + spread*0.80, 0.0, 1.0);", "float heat = clamp(core*0.62 + spread*0.95, 0.0, 1.0);");
fs.writeFileSync("_b-spec/245.mjs", s);
let t = fs.readFileSync("_b-spec/244.mjs", "utf8");
t = t.replace("*exp(-pow(max(sdw - 0.02, 0.0)/0.05, 2.0));", "*exp(-pow(max(sdw - 0.012, 0.0)/0.017, 2.0));");
fs.writeFileSync("_b-spec/244.mjs", t);
console.log("ok");
