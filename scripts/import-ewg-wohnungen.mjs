import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const LIST_URL = "https://www.ewg-dresden.de/wohnungen/";
const DATA_FILE = new URL("../data/wohnungen.json", import.meta.url);
const ALLOWED_DISTRICTS = new Map([
  ["01169", "Gorbitz"],
]);

const CATEGORY_A_TERMS = [
  "barrierefrei",
  "rollstuhlgerecht",
  "rollstuhlgeeignet",
  "rollstuhlwohnung",
  "behindertengerecht",
];

const CATEGORY_B_TERMS = [
  "barrierearm",
  "seniorengerecht",
  "seniorenfreundlich",
  "schwellenarm",
  "schwellenlos",
  "stufenlos",
  "bodengleiche dusche",
  "ebenerdige dusche",
  "dusche ohne schwelle",
  "aufzug bis in die etage",
  "aufzug bis zur etage",
];

function decodeHtml(value = "") {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&auml;/gi, "ä")
    .replace(/&ouml;/gi, "ö")
    .replace(/&uuml;/gi, "ü")
    .replace(/&Auml;/g, "Ä")
    .replace(/&Ouml;/g, "Ö")
    .replace(/&Uuml;/g, "Ü")
    .replace(/&szlig;/gi, "ß")
    .replace(/&#(\d+);/g, (_, number) => String.fromCodePoint(Number(number)))
    .replace(/\s+/g, " ")
    .trim();
}

function relevantHtml(html) {
  const main = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1];
  const article = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1];
  const source = main || article || html;
  return source
    .replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi, " ")
    .replace(/<header\b[^>]*>[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer\b[^>]*>[\s\S]*?<\/footer>/gi, " ");
}

function parseGermanNumber(value) {
  if (!value) return null;
  const number = Number(value.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(number) ? number : null;
}

function parseMoneyAfterLabel(text, label) {
  const match = text.match(new RegExp(`${label}\\s*:?\\s*(\\d{1,4}(?:\\.\\d{3})*,\\d{2})\\s*€`, "i"));
  return parseGermanNumber(match?.[1]);
}

function stableId(url) {
  return `ewg-${createHash("sha256").update(url).digest("hex").slice(0, 12)}`;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function findOfferUrls(html) {
  const urls = [...html.matchAll(/href=["'](https?:\/\/www\.ewg-dresden\.de)?(\/immobilie\/[^"'#?]+\/?)['"]/gi)]
    .map((match) => new URL(match[2], LIST_URL).href);
  return [...new Set(urls)];
}

function classifyAccessibility(normalized) {
  const aMatches = CATEGORY_A_TERMS.filter((term) => normalized.includes(term));
  if (aMatches.length > 0) {
    return {
      category: "A",
      label: "ausdrücklich als barrierefrei oder rollstuhlgerecht beschrieben",
      matches: aMatches,
    };
  }

  const bMatches = CATEGORY_B_TERMS.filter((term) => normalized.includes(term));
  const hasLift = /\baufzug\b|fahrstuhl/.test(normalized);
  const hasAccessibleShower = /bodengleiche dusche|ebenerdige dusche|dusche ohne schwelle/.test(normalized);
  const hasStepFreeHint = /stufenlos|schwellenlos|schwellenarm/.test(normalized);

  if (bMatches.length > 0 || (hasLift && (hasAccessibleShower || hasStepFreeHint))) {
    const combinedMatches = [...bMatches];
    if (hasLift) combinedMatches.push("Aufzug");
    if (hasAccessibleShower) combinedMatches.push("bodengleiche oder ebenerdige Dusche");
    if (hasStepFreeHint) combinedMatches.push("stufen- oder schwellenarmer Zugang");
    return {
      category: "B",
      label: "Hinweise auf eine barrierearme Wohnung; genaue Prüfung erforderlich",
      matches: [...new Set(combinedMatches)],
    };
  }

  return {
    category: "C",
    label: "keine belastbaren Angaben zur Barrierefreiheit gefunden",
    matches: [],
  };
}

function detectWbs(text) {
  const normalized = text.toLowerCase();
  if (/\bpmw\b/.test(normalized)) return { required: "erforderlich", type: "pMW" };
  if (/\bgmw\b/.test(normalized)) return { required: "erforderlich", type: "gMW" };
  if (/\bwbs\b|wohnberechtigungsschein/.test(normalized)) return { required: "erforderlich", type: "nicht näher bezeichnet" };
  return { required: "unbekannt", type: null };
}

function parseApartment(url, html, previousByUrl) {
  const offerHtml = relevantHtml(html);
  const text = decodeHtml(offerHtml);
  const normalized = text.toLowerCase();
  const postcode = text.match(/\b(01\d{3})\s+Dresden\b/i)?.[1] ?? null;
  const district = postcode ? ALLOWED_DISTRICTS.get(postcode) : null;
  if (!district) return null;

  const accessibility = classifyAccessibility(normalized);
  const wbs = detectWbs(text);

  const headingMatches = [...offerHtml.matchAll(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/gi)]
    .map((entry) => decodeHtml(entry[1]))
    .filter(Boolean);
  const titleFromUrl = decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).at(-1) || "")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
  const title = headingMatches.find((heading) => /wohnung|\b[1-7][ -]?(?:raum|rw)\b|wbs|pmw/i.test(heading)) || titleFromUrl;

  const rooms = parseGermanNumber(text.match(/(?:Zimmer|Anzahl Zimmer|Räume|Raumzahl)\s*:?\s*([1-7](?:[,.]5)?)/i)?.[1]
    || text.match(/\b([1-7](?:[,.]5)?)\s*(?:Zimmer|Raum|RW)\b/i)?.[1]);
  const areaSqm = parseGermanNumber(text.match(/(?:Wohnfläche)\s*:?\s*(\d{1,3}(?:[.,]\d{1,2})?)\s*m(?:²|2)/i)?.[1]
    || text.match(/\b(\d{1,3}(?:[.,]\d{1,2})?)\s*m(?:²|2)\b/i)?.[1]);

  const netColdRent = parseMoneyAfterLabel(text, "Kaltmiete");
  const coldOperatingCosts = parseMoneyAfterLabel(text, "Nebenkosten");
  const warmRent = parseMoneyAfterLabel(text, "Gesamtmiete")
    ?? parseMoneyAfterLabel(text, "Warmmiete");

  const street = text.match(/\b([A-ZÄÖÜ][A-Za-zÄÖÜäöüß.-]+(?:straße|str\.|ring|weg|platz|allee|hof))\s*(\d+[a-z]?)\s*,?\s*01\d{3}\s+Dresden\b/i);
  const location = street ? `${street[1]} ${street[2]}, ${postcode} Dresden` : `${postcode} Dresden`;
  const previous = previousByUrl.get(url);
  const found = today();

  const features = accessibility.matches.map((term) => `Im Wohnungsangebot erkannt: ${term}`);

  return {
    id: stableId(url),
    dataStatus: "live",
    title,
    district,
    location,
    distanceMeters: null,
    rooms,
    areaSqm,
    netColdRent,
    coldOperatingCosts,
    grossColdRent: null,
    heatingCosts: null,
    warmRent,
    accessibilityCategory: accessibility.category,
    accessibilityLabel: accessibility.label,
    accessibilityFeatures: [...new Set(features)],
    wbs: wbs.required,
    wbsType: wbs.type,
    provider: "Eisenbahner-Wohnungsbaugenossenschaft Dresden eG",
    sourceId: "ewg-dresden",
    firstFound: previous?.firstFound || found,
    lastChecked: found,
    contact: "EWG-Vermietung: 0351 41 81 716, wohnung@ewg-dresden.de",
    originalUrl: url,
    originalLabel: "Originalangebot bei der EWG öffnen",
    suitableForPersons: [],
  };
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; WohnungsberatungDresden/1.0; +https://github.com/67hvgkv67d-png/barrierefreie-wohnungen-dresden)",
      accept: "text/html,application/xhtml+xml",
    },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.text();
}

async function main() {
  const existing = JSON.parse(await readFile(DATA_FILE, "utf8"));
  const previousByUrl = new Map((existing.apartments || []).map((item) => [item.originalUrl, item]));
  const listHtml = await fetchHtml(LIST_URL);
  const urls = findOfferUrls(listHtml);
  if (urls.length === 0) throw new Error("Auf der EWG-Seite wurden keine Angebotslinks gefunden. Bestehende Daten bleiben unverändert.");

  const details = await Promise.all(urls.map(async (url) => ({ url, html: await fetchHtml(url) })));
  const apartments = details
    .map(({ url, html }) => parseApartment(url, html, previousByUrl))
    .filter(Boolean)
    .filter((item, index, all) => all.findIndex((other) => other.originalUrl === item.originalUrl) === index);

  const output = {
    lastUpdated: today(),
    referenceAddresses: existing.referenceAddresses,
    apartments,
  };

  await writeFile(DATA_FILE, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  const counts = Object.fromEntries(["A", "B", "C"].map((category) => [category, apartments.filter((item) => item.accessibilityCategory === category).length]));
  console.log(`EWG-Import abgeschlossen: ${apartments.length} Angebote (A: ${counts.A}, B: ${counts.B}, C: ${counts.C}).`);
}

main().catch((error) => {
  console.error(`EWG-Import fehlgeschlagen: ${error.message}`);
  process.exitCode = 1;
});
