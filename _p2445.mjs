import fs from "node:fs";
for (const id of ["244", "245"]) {
  const p = `_b-spec/${id}.mjs`;
  let s = fs.readFileSync(p, "utf8");
  const a = "  if (tc.x < 0.002 || tc.x > 0.998 || tc.y < 0.002 || tc.y > 0.998) return 127.0*u_gk;";
  const b = "  if (tc.x < 0.002 || tc.x > 0.998 || tc.y < 0.002 || tc.y > 0.998) return 9.0;";
  if (!s.includes(a)) throw new Error("miss gsd in " + id);
  s = s.split(a).join(b);
  fs.writeFileSync(p, s);
  console.log("patched", id);
}
