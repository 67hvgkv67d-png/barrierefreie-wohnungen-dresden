import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const DATA_FILE = new URL("../data/wohnungen.json", import.meta.url);

const SOURCES = [
  {
    id: "vonovia",
    name: "Vonovia",
    url: "https://www.vonovia.de/zuhause-finden/immobilien?balcony=0&city=Dresden&dachgeschoss=0&disabilityAccess=0&erdgeschoss=0&immoType=wohnung&lift=0&minRooms=0&perimeter=0&priceMaxRenting=0&priceMinRenting=0&rentType=miete&sizeMax=0&sizeMin=0&sofortfrei=0&subsidizedHousingPermit=0",
    provider: "Vonovia",
    contact: "Vonovia Kundenservice: 0234 414 700 000",
    detailPattern: /\/zuhause-finden\/immobilien\/(?!\?)[^\"'?#\s<]+/i,
  },
  {
    id: "wg-aufbau",
    name: "WG Aufbau Dresden",
    url: "https://www.wgaufbau-dresden.de/objektsuche/wohnung/",
    provider: "Wohnungsgenossenschaft Aufbau Dresden eG",
    contact: "WG Aufbau: 0351 4432-0, info@wga-dresden.de",
    detailPattern: /\/objektsuche\/wohnung\/[^\"'?#\s<]+/i,
  },
];

const A_TERMS = ["barrierefrei", "rollstuhlgerecht", "rollstuhlgeeignet", "behindertengerecht"];
const B_TERMS = ["barrierearm", "seniorengerecht", "seniorenfreundlich", "stufenlos", "schwellenlos", "schwellenarm", "bodengleiche dusche", "ebenerdige dusche", "personenaufzug", "aufzug"];
const EXCLUDE_TERMS = ["tauschwohnung", "wohnungstausch", "tauschangebot", "tauschobjekt", "zum tausch"];

function today() {
  return new Date().toISOString().slice(0, 10);
}

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
    .replace(/&auml;/gi, "ä")
    .replace(/&ouml;/gi, "ö")
    .replace(/&uuml;/gi, "ü")
    .replace(/&Auml;/g, "Ä")
    .replace(/&Ouml;/g, "Ö")
    .replace(/&Uuml;/g, "Ü")
    .replace(/&szlig;/gi, "ß")
    .replace(/&#(\d+);/g, (_, number) => String.fromCodePoint(Number(number)))
    .replace(/\\u([0-9a-f]{4})/gi, (_, code) => String.fromCharCode(Number.parseInt(code, 16)))
    .replace(/\\\//g, "/")
    .replace(/\s+/g, " ")
    .trim();
}

function parseNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const match = String(value).match(/\d{1,5}(?:\.\d{3})*(?:,\d{1,2})?|\d{1,5}(?:\.\d{1,2})?/);
  if (!match) return null;
  const raw = match[0];
  const normalized = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function stableId(sourceId, url) {
  return `${sourceId}-${createHash("sha256").update(url).digest("hex").slice(0, 12)}`;
}

function classify(text) {
  const normalized = text.toLowerCase();
  const a = A_TERMS.filter((term) => normalized.includes(term));
  if (a.length) return { category: "A", label: "ausdrücklich als barrierefrei oder rollstuhlgerecht beschrieben", matches: a };
  const b = B_TERMS.filter((term) => normalized.includes(term));
  if (b.length) return { category: "B", label: "Hinweise auf eine barrierearme Wohnung; genaue Prüfung erforderlich", matches: b };
  return { category: "C", label: "keine belastbaren Angaben zur Barrierefreiheit gefunden", matches: [] };
}

function districtFromText(text) {
  const normalized = text.toLowerCase();
  if (/johannstadt|01307|01309/.test(normalized)) return "Johannstadt";
  if (/gorbitz|01169/.test(normalized)) return "Gorbitz";
  return null;
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

function extractJsonObjects(html) {
  const objects = [];
  const patterns = [
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
    /<script[^>]+type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi,
  ];
  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      try { collectObjects(JSON.parse(match[1]), objects); } catch { /* ungültige Blöcke ignorieren */ }
    }
  }
  return objects;
}

function normalizeUrl(value, baseUrl) {
  if (!value) return null;
  try {
    const url = new URL(String(value).replace(/\\u002F/g, "/").replace(/\\\//g, "/"), baseUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.href;
  } catch {
    return null;
  }
}

function candidateFromObject(object, source) {
  const url = normalizeUrl(object.url || object["@id"] || object.mainEntityOfPage, source.url);
  const type = String(object["@type"] || "").toLowerCase();
  const serialized = cleanText(JSON.stringify(object));
  if (!url || (!source.detailPattern.test(new URL(url).pathname) && !/apartment|wohnung|offer|product|residence/.test(type))) return null;

  const address = object.address && typeof object.address === "object" ? object.address : {};
  const offers = object.offers && typeof object.offers === "object" ? object.offers : {};
  return {
    url,
    title: cleanText(object.name || object.headline || ""),
    text: serialized,
    location: cleanText(address.streetAddress || ""),
    postcode: cleanText(address.postalCode || ""),
    rooms: parseNumber(object.numberOfRooms || object.numberOfBedrooms),
    areaSqm: parseNumber(object.floorSize?.value || object.floorSize || object.area),
    netColdRent: parseNumber(offers.price || object.price),
  };
}

function fallbackCandidates(html, source) {
  const candidates = [];
  const hrefPattern = /href=["']([^"']+)["']/gi;
  for (const match of html.matchAll(hrefPattern)) {
    const url = normalizeUrl(match[1], source.url);
    if (!url || !source.detailPattern.test(new URL(url).pathname)) continue;
    const start = Math.max(0, match.index - 1800);
    const end = Math.min(html.length, match.index + 2200);
    const text = cleanText(html.slice(start, end));
    candidates.push({ url, title: "", text, location: "", postcode: "", rooms: null, areaSqm: null, netColdRent: null });
  }
  return candidates;
}

function parseCandidate(candidate, source, previousByUrl) {
  const text = cleanText(`${candidate.title} ${candidate.location} ${candidate.postcode} ${candidate.text}`);
  const normalized = text.toLowerCase();
  if (EXCLUDE_TERMS.some((term) => normalized.includes(term))) return null;

  const district = districtFromText(text);
  if (!district) return null;

  const rooms = candidate.rooms ?? parseNumber(text.match(/(\d(?:[,.]5)?)\s*(?:Zimmer|Raum|RW)\b/i)?.[1]);
  const areaSqm = candidate.areaSqm ?? parseNumber(text.match(/(\d{1,3}(?:[,.]\d{1,2})?)\s*m(?:²|2)\b/i)?.[1]);
  const netColdRent = candidate.netColdRent ?? parseNumber(text.match(/(\d{2,5}(?:\.\d{3})*(?:,\d{1,2})?)\s*€(?:\s*Kaltmiete)?/i)?.[1]);
  const warmRent = parseNumber(text.match(/(?:Warmmiete|Gesamtmiete)\s*:?\s*(\d{2,5}(?:\.\d{3})*(?:,\d{1,2})?)\s*€/i)?.[1]);
  const coldOperatingCosts = parseNumber(text.match(/(?:Nebenkosten|Betriebskosten)\s*:?\s*(\d{2,5}(?:\.\d{3})*(?:,\d{1,2})?)\s*€/i)?.[1]);

  const coreCount = [rooms, areaSqm, netColdRent, warmRent].filter(Number.isFinite).length;
  if (coreCount < 2) return null;

  const postcode = candidate.postcode || text.match(/\b(01\d{3})\b/)?.[1] || null;
  const street = candidate.location || text.match(/\b([A-ZÄÖÜ][A-Za-zÄÖÜäöüß .-]+(?:straße|str\.|ring|weg|platz|allee|hof)\s*\d+[a-z]?)\b/i)?.[1] || null;
  const location = street ? `${street}${postcode ? `, ${postcode} Dresden` : ", Dresden"}` : `${district}, Dresden${postcode ? ` (${postcode})` : ""}`;
  const title = candidate.title && candidate.title.length >= 8 && candidate.title.length <= 180
    ? candidate.title
    : `${rooms ? `${rooms}-Zimmer-Wohnung` : "Wohnung"} in ${district}`;
  const accessibility = classify(text);
  const previous = previousByUrl.get(candidate.url);

  return {
    id: stableId(source.id, candidate.url),
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
    accessibilityFeatures: accessibility.matches.map((term) => `Im Wohnungsangebot erkannt: ${term}`),
    wbs: /\bwbs\b|wohnberechtigungsschein/i.test(text) ? "erforderlich" : "unbekannt",
    wbsType: /\bpmw\b/i.test(text) ? "pMW" : /\bgmw\b/i.test(text) ? "gMW" : null,
    provider: source.provider,
    sourceId: source.id,
    firstFound: previous?.firstFound || today(),
    lastChecked: today(),
    contact: source.contact,
    originalUrl: candidate.url,
    originalLabel: `Originalangebot bei ${source.name} öffnen`,
    suitableForPersons: [],
  };
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; WohnungsberatungDresden/1.2; +https://github.com/67hvgkv67d-png/barrierefreie-wohnungen-dresden)",
      accept: "text/html,application/xhtml+xml,application/json",
      "accept-language": "de-DE,de;q=0.9",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

async function main() {
  const existing = JSON.parse(await readFile(DATA_FILE, "utf8"));
  let apartments = (existing.apartments || []).filter((item) => item.sourceId !== "immowelt");
  const sourceChecks = { ...(existing.sourceChecks || {}) };

  for (const source of SOURCES) {
    const previous = apartments.filter((item) => item.sourceId === source.id);
    const previousByUrl = new Map(previous.map((item) => [item.originalUrl, item]));
    try {
      const html = await fetchHtml(source.url);
      const jsonCandidates = extractJsonObjects(html).map((object) => candidateFromObject(object, source)).filter(Boolean);
      const candidates = [...jsonCandidates, ...fallbackCandidates(html, source)];
      const imported = candidates
        .map((candidate) => parseCandidate(candidate, source, previousByUrl))
        .filter(Boolean)
        .filter((item, index, all) => all.findIndex((other) => other.originalUrl === item.originalUrl) === index);

      apartments = [...apartments.filter((item) => item.sourceId !== source.id), ...imported];
      sourceChecks[source.id] = {
        name: source.name,
        status: "success",
        checkedAt: today(),
        offersFound: imported.length,
        searchUrl: source.url,
        note: imported.length ? "Angebote erfolgreich übernommen." : "Quelle erreichbar; aktuell keine passenden Angebote in Johannstadt oder Gorbitz erkannt.",
      };
      console.log(`${source.name}: ${imported.length} passende Angebote gespeichert.`);
    } catch (error) {
      sourceChecks[source.id] = {
        name: source.name,
        status: "error",
        checkedAt: today(),
        offersFound: previous.length,
        searchUrl: source.url,
        note: `Abruf fehlgeschlagen: ${error.message}. Vorhandene Daten wurden beibehalten.`,
      };
      console.warn(`${source.name}: ${error.message}; vorhandene Daten bleiben erhalten.`);
    }
  }

  const output = { ...existing, lastUpdated: today(), sourceChecks, apartments };
  await writeFile(DATA_FILE, `${JSON.stringify(output, null, 2)}\n`, "utf8");
}

main().catch((error) => {
  console.error(`Import offizieller Quellen fehlgeschlagen: ${error.message}`);
  process.exitCode = 1;
});
