import { readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";

const DATA_FILE = new URL("../data/wohnungen.json", import.meta.url);

function runScript(path) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path], { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`${path} endete mit Exit-Code ${code}`)));
  });
}

async function main() {
  const before = JSON.parse(await readFile(DATA_FILE, "utf8"));
  const nonEwgApartments = (before.apartments || []).filter((item) => item.sourceId && item.sourceId !== "ewg-dresden");

  await runScript(new URL("./import-ewg-wohnungen.mjs", import.meta.url).pathname);

  const afterEwg = JSON.parse(await readFile(DATA_FILE, "utf8"));
  const ewgApartments = (afterEwg.apartments || []).filter((item) => !item.sourceId || item.sourceId === "ewg-dresden");
  await writeFile(DATA_FILE, `${JSON.stringify({ ...afterEwg, apartments: [...ewgApartments, ...nonEwgApartments] }, null, 2)}\n`, "utf8");

  await runScript(new URL("./import-immowelt-wohnungen.mjs", import.meta.url).pathname);
}

main().catch((error) => {
  console.error(`Gesamtimport fehlgeschlagen: ${error.message}`);
  process.exitCode = 1;
});
