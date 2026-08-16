import { readFileSync, writeFileSync } from "node:fs";

const path = "VIDEO-SHOOTING-SCRIPT.md";
const buf = readFileSync(path);
const text = buf.toString("utf8");
const lines = text.split("\n");

const hex = (s) => Buffer.from(s, "utf8").toString("hex").match(/../g).join(" ");

console.log("line 1  :", JSON.stringify(lines[0]));
console.log("  bytes :", hex(lines[0].slice(0, 14)));
console.log("line 176:", JSON.stringify(lines[175].slice(0, 24)));
console.log("  bytes :", hex(lines[175].slice(0, 14)));

// U+00E2 (â) appearing at all means double-encoding.
const suspect = [...text].filter((c) => c.charCodeAt(0) === 0x00e2).length;
console.log(`\nU+00E2 count: ${suspect}  ${suspect ? "-> DOUBLE-ENCODED" : "-> clean"}`);

if (suspect > 0) {
  const fixed = Buffer.from(text, "latin1").toString("utf8");
  writeFileSync(path, fixed, "utf8");
  const check = [...readFileSync(path, "utf8")].filter((c) => c.charCodeAt(0) === 0x00e2).length;
  console.log(`repaired -> U+00E2 count now ${check}`);
  console.log("line 1 now:", JSON.stringify(fixed.split("\n")[0]));
}
