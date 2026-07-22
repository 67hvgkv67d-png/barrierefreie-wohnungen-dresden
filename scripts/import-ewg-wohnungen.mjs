import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const LIST_URL = "https://www.ewg-dresden.de/wohnungen/";
const DATA_FILE = new URL("../data/wohnungen.json", import.meta.url);
const ALLOWED_DISTRICTS = new Map([
  ["01169", "Gorbitz"],
]);
const ACCESSIBILITY_TERMS = [
  "barrierefrei",
  "barrierearm",
  "rollstuhlgerecht",
  "rollstuhlgeeignet",
  "seniorengerecht",
  "pmw",
  "mobilitätseinschränkung",
  "mobilitaetseinschraenkung",
  "schwellenlos",
  "stufenlos",
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

function parseGermanNumber(value) {
  if (!value) return null;
  const number = Number(value.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(number) ? number : null;
}

function stableId(url) {
  return `ewg-${createHash("sha256").update(url).digest("hex").slice(0, 12)}`;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function findCards(html) {
  const links = [...html.matchAll(/href=["'](https?:\/\/www\.ewg-dresden\.de)?(\/immobilie\/[^"'#?]+\/?)["']/gi)];
  const seen = new Set();
  const cards = [];

  for (const match of links) {
    const path = match[2];
    const url = new URL(path, LIST_URL).href;
    if (seen.has(url)) continue;
    seen.add(url);

    const start = Math.max(0, match.index - 2200);
    const end = Math.min(html.length, match.index + 1800);
    cards.push({ url, html: html.slice(start, end) });
  }
  return cards;
}

function parseCard(card, previousByUrl) {
  const text = decodeHtml(card.html);
  const normalized = text.toLowerCase();
  const postcode = text.match(/\b(01\d{3})\s+Dresden\b/i)?.[1] ?? null;
  const district = postcode ? ALLOWED_DISTRICTS.get(postcode) : null;
  if (!district) return null;
  if (!ACCESSIBILITY_TERMS.some((term) => normalized.includes(term))) return null;

  const titleFromUrl = decodeURIComponent(new URL(card.url).pathname.split("/").filter(Boolean).at(-1) || "")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
  const headingMatches = [...card.html.matchAll(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/gi)]
    .map((entry) => decodeHtml(entry[1]))
    .filter(Boolean);
  const title = headingMatches.find((heading) => /wohnung|\b[1-7][ -]?(?:raum|rw)\b|wbs|pmw/i.test(heading)) || titleFromUrl;

  const rooms = parseGermanNumber(text.match(/\b([1-7](?:[,.]5)?)\s*(?:Zimmer|Raum|RW)\b/i)?.[1]);
  const areaSqm = parseGermanNumber(text.match(/\b(\d{1,3}(?:[.,]\d{1,2})?)\s*m(?:²|2)\b/i)?.[1]);
  const warmRent = parseGermanNumber(text.match(/\b(\d{2,4}(?:\.\d{3})*,\d{2})\s*€/)?.[1]);
  const street = text.match(/\b([A-ZÄÖÜ][A-Za-zÄÖÜäöüß.-]+(?:straße|str\.|ring|weg|platz|allee|hof))\s*(\d+[a-z]?)\s*,?\s*01\d{3}\s+Dresden\b/i);
  const location = street ? `${street[1]} ${street[2]}, ${postcode} Dresden` : `${postcode} Dresden`;
  const previous = previousByUrl.get(card.url);
  const found = today();

  const features = ACCESSIBILITY_TERMS
    .filter((term) => normalized.includes(term))
    .map((term) => term === "pmw" ? "Angebot ist für Personen mit Mobilitätseinschränkung (pMW) gekennzeichnet" : `Im Angebot genannt: ${term}`);

  return {
    id: stableId(card.url),
    dataStatus: "live",
    title,
    district,
    location,
    distanceMeters: null,
    rooms,
    areaSqm,
    netColdRent: null,
    coldOperatingCosts: null,
    grossColdRent: null,
    heatingCosts: null,
    warmRent,
    accessibilityCategory: normalized.includes("rollstuhl") || normalized.includes("barrierefrei") || normalized.includes("pmw") ? "A" : "B",
    accessibilityLabel: normalized.includes("pmw") ? "vom Anbieter für Personen mit Mobilitätseinschränkung gekennzeichnet" : "vom Anbieter als barrierearm oder seniorengerecht beschrieben",
    accessibilityFeatures: [...new Set(features)],
    wbs: normalized.includes("wbs") ? "erforderlich" : "unbekannt",
    provider: "Eisenbahner-Wohnungsbaugenossenschaft Dresden eG",
    sourceId: "ewg-dresden",
    firstFound: previous?.firstFound || found,
    lastChecked: found,
    contact: "EWG-Vermietung: 0351 41 81 716, wohnung@ewg-dresden.de",
    originalUrl: card.url,
    originalLabel: "Originalangebot bei der EWG öffnen",
    suitableForPersons: [],
  };
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; BarrierefreieWohnungenDresden/1.0; +https://github.com/67hvgkv67d-png/barrierefreie-wohnungen-dresden)",
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
  const html = await fetchHtml(LIST_URL);
  const cards = findCards(html);
  if (cards.length === 0) throw new Error("Auf der EWG-Seite wurden keine Angebotslinks gefunden. Bestehende Daten bleiben unverändert.");

  const apartments = cards
    .map((card) => parseCard(card, previousByUrl))
    .filter(Boolean)
    .filter((item, index, all) => all.findIndex((other) => other.originalUrl === item.originalUrl) === index);

  const output = {
    lastUpdated: today(),
    referenceAddresses: existing.referenceAddresses,
    apartments,
  };

  await writeFile(DATA_FILE, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(`EWG-Import abgeschlossen: ${apartments.length} passende Angebote.`);
}

main().catch((error) => {
  console.error(`EWG-Import fehlgeschlagen: ${error.message}`);
  process.exitCode = 1;
});
