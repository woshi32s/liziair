import fs from "node:fs";
let s = fs.readFileSync("_b-spec/246.mjs", "utf8");
s = s.replace("ctx.globalAlpha = 0.62;", "ctx.globalAlpha = 0.34;");
s = s.replace("ctx.globalAlpha = 0.20;", "ctx.globalAlpha = 0.12;");
fs.writeFileSync("_b-spec/246.mjs", s); console.log("ok");
