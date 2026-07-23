import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const DATA_FILE = new URL("../data/wohnungen.json", import.meta.url);
const SOURCE_ID = "immowelt";
const SEARCHES = [
  { district: "Johannstadt", url: "https://www.immowelt.de/suche/mieten/wohnung/guenstig/behindertengerecht/dresden-01067/johannstadt-nord-1307/nbh2de91302418" },
  { district: "Gorbitz", url: "https://www.immowelt.de/suche/mieten/wohnung/guenstig/behindertengerecht/dresden-01067/gorbitz-sud-1169/nbh2de91302420" },
];

const A_TERMS = ["barrierefrei", "rollstuhlgerecht", "rollstuhlgeeignet", "behindertengerecht"];
const B_TERMS = ["barrierearm", "seniorengerecht", "seniorenfreundlich", "stufenlos", "schwellenlos", "schwellenarm", "bodengleiche dusche", "aufzug"];
const TAUSCH_TERMS = /tauschwohnung|wohnungstausch|tauschangebot|zum tausch|tauschobjekt/i;
const BAD_TITLE_TERMS = /auf karte anzeigen|weitere ergebnisse|inserieren ab|barrierefreie\s*\/\s*behindertengerechte wohnungen mieten|entdecke weitere ergebnisse/i;

function today() { return new Date().toISOString().slice(0, 10); }

function cleanText(value = "") {
  return String(value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&auml;/gi, "ä").replace(/&ouml;/gi, "ö").replace(/&uuml;/gi, "ü")
    .replace(/&Auml;/g, "Ä").replace(/&Ouml;/g, "Ö").replace(/&Uuml;/g, "Ü")
    .replace(/&szlig;/gi, "ß")
    .replace(/\\u([0-9a-f]{4})/gi, (_, code) => String.fromCharCode(Number.parseInt(code, 16)))
    .replace(/\\\//g, "/")
    .replace(/\s+/g, " ")
    .trim();
}

function parseNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const match = String(value).match(/\d{1,5}(?:\.\d{3})*(?:,\d{1,2})?|\d{1,5}(?:\.\d{1,2})?/);
  if (!match) return null;
  const raw = match[0];
  const number = Number(raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw);
  return Number.isFinite(number) ? number : null;
}

function stableId(url) { return `immowelt-${createHash("sha256").update(url).digest("hex").slice(0, 12)}`; }

function normalizeUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(String(value).replace(/\\u002F/g, "/").replace(/\\\//g, "/"), "https://www.immowelt.de");
    if (!/(^|\.)immowelt\.de$/i.test(url.hostname)) return null;
    const expose = url.pathname.match(/\/expose\/([a-z0-9-]+)/i);
    return expose ? `https://www.immowelt.de/expose/${expose[1]}` : null;
  } catch { return null; }
}

function classify(text) {
  const normalized = text.toLowerCase();
  const a = A_TERMS.filter((term) => normalized.includes(term));
  if (a.length) return { category: "A", label: "ausdrücklich als barrierefrei oder rollstuhlgerecht beschrieben", matches: a };
  const b = B_TERMS.filter((term) => normalized.includes(term));
  return { category: "B", label: "über die Immowelt-Suche für barrierefreie beziehungsweise behindertengerechte Wohnungen gefunden; genaue Prüfung erforderlich", matches: b.length ? b : ["Zuordnung durch die Immowelt-Suchkategorie"] };
}

function nearestContainer(html, index) {
  for (const tag of ["article", "li", "section"]) {
    const start = html.lastIndexOf(`<${tag}`, index);
    const end = html.indexOf(`</${tag}>`, index);
    if (start >= 0 && end > index && end - start < 30000) return html.slice(start, end + tag.length + 3);
  }
  return html.slice(Math.max(0, index - 2500), Math.min(html.length, index + 3500));
}

function parseMoney(text, labels) {
  for (const label of labels) {
    const patterns = [
      new RegExp(`(\\d{2,5}(?:\\.\\d{3})*(?:,\\d{1,2})?)\\s*€\\s*${label}`, "i"),
      new RegExp(`${label}\\s*(\\d{2,5}(?:\\.\\d{3})*(?:,\\d{1,2})?)\\s*€`, "i"),
    ];
    for (const pattern of patterns) {
      const value = parseNumber(text.match(pattern)?.[1]);
      if (value !== null) return value;
    }
  }
  return null;
}

function titleFromBlock(block, rooms, district) {
  const headings = [...block.matchAll(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/gi)]
    .map((match) => cleanText(match[1]))
    .filter((value) => value.length >= 8 && value.length <= 180 && !BAD_TITLE_TERMS.test(value));
  const title = headings.find((value) => /wohnung|apartment|wohnen|erstbezug|neubau|miete/i.test(value));
  return title || `${rooms ? `${rooms}-Zimmer-Wohnung` : "Wohnung"} in ${district}`;
}

function parseSearchPage(html, district, previousByUrl) {
  const results = [];
  const seen = new Set();
  const links = [...html.matchAll(/(?:href=|\"(?:url|href)\"\s*:\s*)["']([^"']*\/expose\/[a-z0-9-]+[^"']*)["']/gi)];

  for (const match of links) {
    const url = normalizeUrl(match[1]);
    if (!url || seen.has(url)) continue;
    seen.add(url);

    const block = nearestContainer(html, match.index ?? 0);
    const text = cleanText(block);
    if (!text || TAUSCH_TERMS.test(text)) continue;

    const belongs = district === "Johannstadt" ? /johannstadt|01307|01309/i.test(text) : /gorbitz|01169/i.test(text);
    if (!belongs) continue;
    if (district === "Johannstadt" && /cott(a|e)|01157/i.test(text)) continue;

    const rooms = parseNumber(text.match(/(\d(?:[,.]5)?)\s*Zimmer/i)?.[1]);
    const areaSqm = parseNumber(text.match(/(\d{1,3}(?:[,.]\d{1,2})?)\s*m(?:²|2)/i)?.[1]);
    const netColdRent = parseMoney(text, ["Kaltmiete", "Nettokaltmiete"])
      ?? parseNumber(text.match(/(\d{2,5}(?:\.\d{3})*(?:,\d{1,2})?)\s*€/i)?.[1]);
    const warmRent = parseMoney(text, ["Warmmiete", "Gesamtmiete"]);
    const factsFound = [rooms, areaSqm, netColdRent].filter((value) => value !== null).length;
    if (factsFound < 2) continue;

    const title = titleFromBlock(block, rooms, district);
    if (BAD_TITLE_TERMS.test(title) || /[<>]|\\"|\.6\.6 0 1/i.test(title)) continue;

    const locationMatch = text.match(/([A-ZÄÖÜ][A-Za-zÄÖÜäöüß .-]+(?:straße|str\.|ring|weg|platz|allee|hof)\s*\d+[a-z]?)\s*,?\s*(01\d{3})/i);
    const accessibility = classify(text);
    const previous = previousByUrl.get(url);

    results.push({
      id: stableId(url), dataStatus: "live", title, district,
      location: locationMatch ? `${locationMatch[1]}, ${locationMatch[2]} Dresden` : `${district}, Dresden`,
      distanceMeters: null, rooms, areaSqm, netColdRent,
      coldOperatingCosts: null, grossColdRent: null, heatingCosts: null, warmRent,
      accessibilityCategory: accessibility.category,
      accessibilityLabel: accessibility.label,
      accessibilityFeatures: accessibility.matches.map((term) => `Im Angebot erkannt: ${term}`),
      wbs: /\bwbs\b|wohnberechtigungsschein/i.test(text) ? "erforderlich" : "unbekannt",
      wbsType: /\bpmw\b/i.test(text) ? "pMW" : /\bgmw\b/i.test(text) ? "gMW" : null,
      provider: "Anbieter laut Immowelt", sourceId: SOURCE_ID,
      firstFound: previous?.firstFound || today(), lastChecked: today(), contact: null,
      originalUrl: url, originalLabel: "Originalangebot bei Immowelt öffnen", suitableForPersons: [],
    });
  }
  return results;
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/150 Safari/537.36",
      accept: "text/html,application/xhtml+xml",
      "accept-language": "de-DE,de;q=0.9",
    },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.text();
}

async function main() {
  const existing = JSON.parse(await readFile(DATA_FILE, "utf8"));
  const previousImmowelt = (existing.apartments || []).filter((item) => item.sourceId === SOURCE_ID);
  const previousByUrl = new Map(previousImmowelt.map((item) => [item.originalUrl, item]));
  const otherSources = (existing.apartments || []).filter((item) => item.sourceId !== SOURCE_ID);
  const imported = [];
  const errors = [];
  let successfulSearches = 0;

  for (const search of SEARCHES) {
    try {
      const html = await fetchHtml(search.url);
      successfulSearches += 1;
      const apartments = parseSearchPage(html, search.district, previousByUrl);
      imported.push(...apartments);
      console.log(`${search.district}: ${apartments.length} verwertbare Angebote aus der Suchseite gelesen.`);
    } catch (error) { errors.push(`${search.district}: ${error.message}`); }
  }

  const unique = imported.filter((item, index, all) => all.findIndex((other) => other.originalUrl === item.originalUrl) === index);
  const immoweltApartments = successfulSearches > 0 ? unique : previousImmowelt;
  const output = { ...existing, lastUpdated: today(), apartments: [...otherSources, ...immoweltApartments] };
  await writeFile(DATA_FILE, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(`Immowelt-Import: ${immoweltApartments.length} geprüfte Angebote gespeichert.`);
  if (errors.length) console.warn(`Teilweise Fehler: ${errors.join(" | ")}`);
  if (successfulSearches > 0 && !unique.length) console.warn("Suchseiten waren erreichbar, enthielten aber keine ausreichend vollständig erkennbaren passenden Angebote.");
}

main().catch((error) => {
  console.error(`Immowelt-Import fehlgeschlagen: ${error.message}`);
  process.exitCode = 1;
});
