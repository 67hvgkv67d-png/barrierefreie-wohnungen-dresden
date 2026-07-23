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

function stableId(url) {
  return `immowelt-${createHash("sha256").update(url).digest("hex").slice(0, 12)}`;
}

function normalizeUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value.replace(/\\u002F/g, "/").replace(/\\\//g, "/"), "https://www.immowelt.de");
    if (!/(^|\.)immowelt\.de$/i.test(url.hostname)) return null;
    const expose = url.pathname.match(/\/expose\/([a-z0-9-]+)/i);
    if (!expose) return null;
    return `https://www.immowelt.de/expose/${expose[1]}`;
  } catch {
    return null;
  }
}

function findExposeUrls(html) {
  const urls = new Set();
  const patterns = [
    /href=["']([^"']*\/expose\/[a-z0-9-]+[^"']*)["']/gi,
    /["'](?:url|href)["']\s*:\s*["']([^"']*\/expose\/[a-z0-9-]+[^"']*)["']/gi,
    /https?:\\?\/\\?\/www\.immowelt\.de\\?\/expose\\?\/[a-z0-9-]+/gi,
  ];
  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      const url = normalizeUrl(match[1] || match[0]);
      if (url) urls.add(url);
    }
  }
  return [...urls].slice(0, 40);
}

function classify(text) {
  const normalized = text.toLowerCase();
  const a = A_TERMS.filter((term) => normalized.includes(term));
  if (a.length) return { category: "A", label: "ausdrücklich als barrierefrei oder rollstuhlgerecht beschrieben", matches: a };
  const b = B_TERMS.filter((term) => normalized.includes(term));
  if (b.length) return { category: "B", label: "Hinweise auf eine barrierearme Wohnung; genaue Prüfung erforderlich", matches: b };
  return { category: "B", label: "über die Immowelt-Suche für barrierefreie beziehungsweise behindertengerechte Wohnungen gefunden; Angaben im Exposé prüfen", matches: ["Zuordnung durch die Immowelt-Suchkategorie"] };
}

function extractTitle(html, text, district) {
  const h2 = [...html.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)]
    .map((match) => cleanText(match[1]))
    .find((value) => value.length >= 8 && !/Merkmale|Mietkosten|Lage|Weitere Informationen/i.test(value));
  if (h2) return h2.slice(0, 180);
  const og = cleanText(html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1] || "");
  if (og) return og.slice(0, 180);
  const title = cleanText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").replace(/\s*\|\s*immowelt.*$/i, "");
  return title || `Wohnung in ${district}`;
}

function parseMoneyAfterLabel(text, label) {
  const patterns = [
    new RegExp(`${label}\\s*(?:pro Monat)?\\s*(\\d{1,5}(?:\\.\\d{3})*(?:,\\d{1,2})?)\\s*€`, "i"),
    new RegExp(`(\\d{1,5}(?:\\.\\d{3})*(?:,\\d{1,2})?)\\s*€\\s*${label}`, "i"),
  ];
  for (const pattern of patterns) {
    const value = parseNumber(text.match(pattern)?.[1]);
    if (value !== null) return value;
  }
  return null;
}

function districtFromText(text) {
  const normalized = text.toLowerCase();
  if (/johannstadt|01307|01309/.test(normalized)) return "Johannstadt";
  if (/gorbitz|01169/.test(normalized)) return "Gorbitz";
  return null;
}

function parseExpose(url, html, expectedDistrict, previousByUrl) {
  const text = cleanText(html);
  const normalized = text.toLowerCase();
  if (EXCLUDE_TERMS.some((term) => normalized.includes(term))) return null;

  const district = districtFromText(text);
  if (!district || district !== expectedDistrict) return null;

  const title = extractTitle(html, text, district);
  if (EXCLUDE_TERMS.some((term) => title.toLowerCase().includes(term))) return null;

  const rooms = parseNumber(text.match(/(\d(?:[,.]5)?)\s*Zimmer/i)?.[1]);
  const areaSqm = parseNumber(text.match(/(\d{1,3}(?:[,.]\d{1,2})?)\s*m(?:²|2)/i)?.[1]);
  const netColdRent = parseMoneyAfterLabel(text, "Kaltmiete");
  const warmRent = parseMoneyAfterLabel(text, "Warmmiete");
  const coldOperatingCosts = parseMoneyAfterLabel(text, "Nebenkosten");
  const postcode = text.match(/\((01\d{3})\)|\b(01\d{3})\b/)?.[1] || text.match(/\((01\d{3})\)|\b(01\d{3})\b/)?.[2] || null;
  const street = text.match(/\b([A-ZÄÖÜ][A-Za-zÄÖÜäöüß .-]+(?:straße|str\.|ring|weg|platz|allee|hof)\s*\d+[a-z]?)\b/i)?.[1] || null;
  const location = street && postcode ? `${street}, ${postcode} Dresden` : `${district}, Dresden${postcode ? ` (${postcode})` : ""}`;
  const provider = cleanText(text.match(/Über den Anbieter\s+(.{2,100}?)(?:\s+\d+ Jahre Partnerschaft|\s+Dein Kontakt|\s+Kontaktieren)/i)?.[1] || "Anbieter laut Immowelt");
  const accessibility = classify(text);
  const previous = previousByUrl.get(url);

  if (!rooms && !areaSqm && !netColdRent && !warmRent) return null;

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
    accessibilityFeatures: accessibility.matches.map((term) => `Im Angebot erkannt: ${term}`),
    wbs: /\bwbs\b|wohnberechtigungsschein/i.test(text) ? "erforderlich" : "unbekannt",
    wbsType: /\bpmw\b/i.test(text) ? "pMW" : /\bgmw\b/i.test(text) ? "gMW" : null,
    provider,
    sourceId: SOURCE_ID,
    firstFound: previous?.firstFound || today(),
    lastChecked: today(),
    contact: null,
    originalUrl: url,
    originalLabel: "Originalangebot bei Immowelt öffnen",
    suitableForPersons: [],
  };
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; WohnungsberatungDresden/1.1; +https://github.com/67hvgkv67d-png/barrierefreie-wohnungen-dresden)",
      accept: "text/html,application/xhtml+xml",
      "accept-language": "de-DE,de;q=0.9",
    },
    redirect: "follow",
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
      const searchHtml = await fetchHtml(search.url);
      successfulSearches += 1;
      const urls = findExposeUrls(searchHtml);
      console.log(`${search.district}: ${urls.length} Exposé-Links gefunden.`);
      for (const url of urls) {
        try {
          const exposeHtml = await fetchHtml(url);
          const apartment = parseExpose(url, exposeHtml, search.district, previousByUrl);
          if (apartment) imported.push(apartment);
        } catch (error) {
          errors.push(`${url}: ${error.message}`);
        }
      }
    } catch (error) {
      errors.push(`${search.district}: ${error.message}`);
    }
  }

  const unique = imported.filter((item, index, all) => all.findIndex((other) => other.originalUrl === item.originalUrl) === index);
  const immoweltApartments = successfulSearches > 0 ? unique : previousImmowelt;
  const output = {
    ...existing,
    lastUpdated: today(),
    apartments: [...otherSources, ...immoweltApartments],
  };

  await writeFile(DATA_FILE, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(`Immowelt-Import: ${unique.length} geprüfte Angebote gespeichert.`);
  if (errors.length) console.warn(`Teilweise Fehler: ${errors.slice(0, 10).join(" | ")}`);
  if (!successfulSearches) console.warn("Keine Immowelt-Suche erreichbar. Vorhandene Daten wurden beibehalten.");
}

main().catch((error) => {
  console.error(`Immowelt-Import fehlgeschlagen: ${error.message}`);
  process.exitCode = 1;
});
