import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const DATA_FILE = new URL("../data/wohnungen.json", import.meta.url);
const SOURCE_ID = "immowelt";
const SEARCHES = [
  {
    district: "Johannstadt",
    url: "https://www.immowelt.de/suche/mieten/wohnung/guenstig/behindertengerecht/dresden-01067/johannstadt-nord-1307/nbh2de91302418",
  },
  {
    district: "Gorbitz",
    url: "https://www.immowelt.de/suche/mieten/wohnung/guenstig/behindertengerecht/dresden-01067/gorbitz-sud-1169/nbh2de91302420",
  },
];

const A_TERMS = ["barrierefrei", "rollstuhlgerecht", "rollstuhlgeeignet", "behindertengerecht"];
const B_TERMS = ["barrierearm", "seniorengerecht", "seniorenfreundlich", "stufenlos", "schwellenlos", "schwellenarm", "bodengleiche dusche", "aufzug"];

function today() {
  return new Date().toISOString().slice(0, 10);
}

function cleanText(value = "") {
  return String(value)
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
    .replace(/\\u([0-9a-f]{4})/gi, (_, code) => String.fromCharCode(Number.parseInt(code, 16)))
    .replace(/\\\//g, "/")
    .replace(/\s+/g, " ")
    .trim();
}

function parseNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const match = String(value).match(/\d{1,4}(?:[.,]\d{1,2})?/);
  if (!match) return null;
  const number = Number(match[0].replace(".", "").replace(",", "."));
  return Number.isFinite(number) ? number : null;
}

function stableId(url) {
  return `immowelt-${createHash("sha256").update(url).digest("hex").slice(0, 12)}`;
}

function classify(text) {
  const normalized = text.toLowerCase();
  const a = A_TERMS.filter((term) => normalized.includes(term));
  if (a.length) return { category: "A", label: "ausdrücklich als barrierefrei oder rollstuhlgerecht beschrieben", matches: a };
  const b = B_TERMS.filter((term) => normalized.includes(term));
  return {
    category: "B",
    label: "über die Immowelt-Suche für barrierefreie bzw. behindertengerechte Wohnungen gefunden; genaue Prüfung erforderlich",
    matches: b.length ? b : ["Zuordnung durch die Immowelt-Suchkategorie"],
  };
}

function collectObjects(value, output = []) {
  if (!value || typeof value !== "object") return output;
  if (Array.isArray(value)) {
    for (const item of value) collectObjects(item, output);
    return output;
  }
  output.push(value);
  for (const item of Object.values(value)) collectObjects(item, output);
  return output;
}

function extractJsonLd(html) {
  const objects = [];
  for (const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      collectObjects(JSON.parse(match[1]), objects);
    } catch {
      // Einzelne ungültige JSON-LD-Blöcke ignorieren.
    }
  }
  return objects;
}

function normalizeUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value, "https://www.immowelt.de");
    if (!/immowelt\.de$/i.test(url.hostname) && !/\.immowelt\.de$/i.test(url.hostname)) return null;
    return url.href;
  } catch {
    return null;
  }
}

function candidateFromObject(object) {
  const url = normalizeUrl(object.url || object["@id"] || object.mainEntityOfPage);
  if (!url || !/expose|immobilie|angebot/i.test(url)) return null;
  const addressObject = object.address && typeof object.address === "object" ? object.address : {};
  const offers = object.offers && typeof object.offers === "object" ? object.offers : {};
  const text = cleanText(JSON.stringify(object));
  return {
    url,
    title: cleanText(object.name || object.headline || object.description || "Wohnungsangebot bei Immowelt").slice(0, 180),
    text,
    location: cleanText(addressObject.streetAddress || object.address || ""),
    postcode: cleanText(addressObject.postalCode || ""),
    rooms: parseNumber(object.numberOfRooms || object.numberOfBedrooms),
    areaSqm: parseNumber(object.floorSize?.value || object.floorSize),
    netColdRent: parseNumber(offers.price || object.price),
    provider: cleanText(object.seller?.name || object.provider?.name || object.brand?.name || "Anbieter laut Immowelt"),
  };
}

function fallbackCandidates(html) {
  const output = [];
  const links = [...html.matchAll(/href=["']([^"']*(?:expose|immobilie)[^"']*)["']/gi)];
  for (const match of links) {
    const url = normalizeUrl(match[1]);
    if (!url) continue;
    const start = Math.max(0, match.index - 1800);
    const end = Math.min(html.length, match.index + 2200);
    const text = cleanText(html.slice(start, end));
    output.push({ url, title: text.slice(0, 160), text, location: "", postcode: "", rooms: null, areaSqm: null, netColdRent: null, provider: "Anbieter laut Immowelt" });
  }
  return output;
}

function districtMatches(candidate, expectedDistrict) {
  const text = `${candidate.location} ${candidate.postcode} ${candidate.text}`.toLowerCase();
  if (expectedDistrict === "Johannstadt") return /johannstadt|01307|01309/.test(text);
  return /gorbitz|01169/.test(text);
}

function parseCandidate(candidate, district, previousByUrl) {
  const text = cleanText(candidate.text);
  if (!districtMatches(candidate, district)) return null;
  if (/tauschangebot|tauschwohnung/i.test(text)) return null;

  const accessibility = classify(text);
  const previous = previousByUrl.get(candidate.url);
  const locationMatch = text.match(/([A-ZÄÖÜ][A-Za-zÄÖÜäöüß .-]+(?:straße|str\.|ring|weg|platz|allee|hof)\s*\d+[a-z]?)\s*,?\s*(01\d{3})/i);
  const rooms = candidate.rooms ?? parseNumber(text.match(/(\d(?:[,.]5)?)\s*Zimmer/i)?.[1]);
  const areaSqm = candidate.areaSqm ?? parseNumber(text.match(/(\d{1,3}(?:[,.]\d{1,2})?)\s*m(?:²|2)/i)?.[1]);
  const netColdRent = candidate.netColdRent ?? parseNumber(text.match(/(\d{2,4}(?:[.,]\d{1,2})?)\s*€\s*Kaltmiete/i)?.[1]);
  const title = candidate.title && candidate.title !== "Wohnungsangebot bei Immowelt"
    ? candidate.title
    : `${rooms ? `${rooms}-Zimmer-Wohnung` : "Wohnung"} in ${district}`;

  return {
    id: stableId(candidate.url),
    dataStatus: "live",
    title,
    district,
    location: locationMatch ? `${locationMatch[1]}, ${locationMatch[2]} Dresden` : `${district}, Dresden`,
    distanceMeters: null,
    rooms,
    areaSqm,
    netColdRent,
    coldOperatingCosts: null,
    grossColdRent: null,
    heatingCosts: null,
    warmRent: null,
    accessibilityCategory: accessibility.category,
    accessibilityLabel: accessibility.label,
    accessibilityFeatures: accessibility.matches.map((term) => `Im Angebot erkannt: ${term}`),
    wbs: /\bwbs\b|wohnberechtigungsschein/i.test(text) ? "erforderlich" : "unbekannt",
    wbsType: /\bpmw\b/i.test(text) ? "pMW" : null,
    provider: candidate.provider || "Anbieter laut Immowelt",
    sourceId: SOURCE_ID,
    firstFound: previous?.firstFound || today(),
    lastChecked: today(),
    contact: null,
    originalUrl: candidate.url,
    originalLabel: "Originalangebot bei Immowelt öffnen",
    suitableForPersons: [],
  };
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; WohnungsberatungDresden/1.0; +https://github.com/67hvgkv67d-png/barrierefreie-wohnungen-dresden)",
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

  for (const search of SEARCHES) {
    try {
      const html = await fetchHtml(search.url);
      const jsonCandidates = extractJsonLd(html).map(candidateFromObject).filter(Boolean);
      const candidates = jsonCandidates.length ? jsonCandidates : fallbackCandidates(html);
      for (const candidate of candidates) {
        const apartment = parseCandidate(candidate, search.district, previousByUrl);
        if (apartment) imported.push(apartment);
      }
    } catch (error) {
      errors.push(`${search.district}: ${error.message}`);
    }
  }

  const unique = imported.filter((item, index, all) => all.findIndex((other) => other.originalUrl === item.originalUrl) === index);
  const immoweltApartments = unique.length ? unique : previousImmowelt;
  const output = {
    ...existing,
    lastUpdated: today(),
    apartments: [...otherSources, ...immoweltApartments],
  };

  await writeFile(DATA_FILE, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(`Immowelt-Import: ${unique.length} aktuelle Angebote gefunden; ${immoweltApartments.length} gespeichert.`);
  if (errors.length) console.warn(`Teilweise Fehler: ${errors.join(" | ")}`);
  if (!unique.length) console.warn("Keine neuen Immowelt-Angebote geparst. Vorhandene Immowelt-Daten wurden unverändert beibehalten.");
}

main().catch((error) => {
  console.error(`Immowelt-Import fehlgeschlagen: ${error.message}`);
  process.exitCode = 1;
});
