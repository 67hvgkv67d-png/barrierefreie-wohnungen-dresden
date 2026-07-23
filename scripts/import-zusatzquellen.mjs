import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const DATA_FILE = new URL("../data/wohnungen.json", import.meta.url);
const TODAY = new Date().toISOString().slice(0, 10);
const EXCLUDE = /tauschwohnung|wohnungstausch|tauschangebot|tauschobjekt|zum tausch/i;
const A_TERMS = ["barrierefrei", "rollstuhlgerecht", "rollstuhlgeeignet", "behindertengerecht"];
const B_TERMS = ["barrierearm", "seniorengerecht", "seniorenfreundlich", "stufenlos", "schwellenlos", "schwellenarm", "bodengleiche dusche", "ebenerdige dusche", "personenaufzug", "aufzug", "walk-in-dusche"];

const SOURCES = [
  {
    id: "swgd",
    name: "Sächsische Wohnungsgenossenschaft Dresden",
    url: "https://swg-dresden.de/wohnungsangebote/",
    provider: "Sächsische Wohnungsgenossenschaft Dresden eG",
    contact: "0351 272 151 100, vermietung@swg-dresden.de",
    linkPattern: /\/wohnungsangebote\/[^"'#?\s<]+/i,
  },
  {
    id: "wgj",
    name: "Wohnungsgenossenschaft Johannstadt",
    url: "https://www.wgj.de/startseite.html",
    provider: "Wohnungsgenossenschaft Johannstadt eG",
    contact: "0351 4402-3, info@wgj.de",
    linkPattern: /\/(?:wohnung|wohnungsangebot|immobilie)[^"'#?\s<]*/i,
  },
  {
    id: "wohnungsboerse-johannstadt-nord",
    groupName: "Dresdner Wohnungsbörse",
    name: "Wohnungsbörse – Johannstadt-Nord",
    url: "https://www.wohnungsboerse.net/Dresden_Johannstadt-Nord/mietwohnungen",
    provider: "Anbieter laut Wohnungsbörse",
    contact: null,
    linkPattern: /\/(?:immodetail|mietangebot|wohnung)\/[^"'#?\s<]+/i,
  },
  {
    id: "wohnungsboerse-johannstadt-sued",
    groupName: "Dresdner Wohnungsbörse",
    name: "Wohnungsbörse – Johannstadt-Süd",
    url: "https://www.wohnungsboerse.net/Dresden_Johannstadt-Sued/mietwohnungen",
    provider: "Anbieter laut Wohnungsbörse",
    contact: null,
    linkPattern: /\/(?:immodetail|mietangebot|wohnung)\/[^"'#?\s<]+/i,
  },
  {
    id: "wohnungsboerse-gorbitz-nord",
    groupName: "Dresdner Wohnungsbörse",
    name: "Wohnungsbörse – Gorbitz-Nord/Neu-Omsewitz",
    url: "https://www.wohnungsboerse.net/Dresden_Gorbitz-NordNeu-Omsewitz/mietwohnungen",
    provider: "Anbieter laut Wohnungsbörse",
    contact: null,
    linkPattern: /\/(?:immodetail|mietangebot|wohnung)\/[^"'#?\s<]+/i,
  },
  {
    id: "wohnungsboerse-gorbitz-ost",
    groupName: "Dresdner Wohnungsbörse",
    name: "Wohnungsbörse – Gorbitz-Ost",
    url: "https://www.wohnungsboerse.net/Dresden_Gorbitz-Ost/mietwohnungen",
    provider: "Anbieter laut Wohnungsbörse",
    contact: null,
    linkPattern: /\/(?:immodetail|mietangebot|wohnung)\/[^"'#?\s<]+/i,
  },
  {
    id: "immonet-johannstadt",
    groupName: "Immonet",
    name: "Immonet – Johannstadt",
    url: "https://www.immonet.de/suchen/miete/wohnung/dresden-01067/johannstadt-sud-1307/nbh2de91302429",
    provider: "Anbieter laut Immonet",
    contact: null,
    linkPattern: /\/expose\/[a-z0-9-]+/i,
  },
  {
    id: "immonet-gorbitz",
    groupName: "Immonet",
    name: "Immonet – Gorbitz",
    url: "https://www.immonet.de/suchen/miete/wohnung/dresden-01067/gorbitz-ost-1159/nbh2de91302419",
    provider: "Anbieter laut Immonet",
    contact: null,
    linkPattern: /\/expose\/[a-z0-9-]+/i,
  },
];

function clean(value = "") {
  return String(value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;|&#34;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&auml;/gi, "ä").replace(/&ouml;/gi, "ö").replace(/&uuml;/gi, "ü")
    .replace(/&Auml;/g, "Ä").replace(/&Ouml;/g, "Ö").replace(/&Uuml;/g, "Ü")
    .replace(/&szlig;/gi, "ß")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/\\u([0-9a-f]{4})/gi, (_, code) => String.fromCharCode(Number.parseInt(code, 16)))
    .replace(/\\\//g, "/")
    .replace(/\s+/g, " ")
    .trim();
}

function number(value) {
  const match = String(value ?? "").match(/\d{1,5}(?:\.\d{3})*(?:,\d{1,2})?|\d{1,5}(?:\.\d{1,2})?/);
  if (!match) return null;
  const raw = match[0];
  const result = Number(raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw);
  return Number.isFinite(result) ? result : null;
}

function district(text) {
  const lower = text.toLowerCase();
  if (/johannstadt|01307|01309/.test(lower)) return "Johannstadt";
  if (/gorbitz|01159|01169/.test(lower)) return "Gorbitz";
  return null;
}

function classify(text) {
  const lower = text.toLowerCase();
  const a = A_TERMS.filter((term) => lower.includes(term));
  if (a.length) return { category: "A", label: "ausdrücklich als barrierefrei oder rollstuhlgerecht beschrieben", matches: a };
  const b = B_TERMS.filter((term) => lower.includes(term));
  if (b.length) return { category: "B", label: "Hinweise auf eine barrierearme Wohnung; genaue Prüfung erforderlich", matches: b };
  return { category: "C", label: "keine belastbaren Angaben zur Barrierefreiheit gefunden", matches: [] };
}

function normalizeUrl(value, base) {
  try {
    const url = new URL(String(value).replace(/\\u002F/g, "/").replace(/\\\//g, "/"), base);
    return /^https?:$/.test(url.protocol) ? url.href : null;
  } catch { return null; }
}

function candidates(html, source) {
  const result = [];
  const hrefs = [...html.matchAll(/href=["']([^"']+)["']/gi)];
  for (const match of hrefs) {
    const url = normalizeUrl(match[1], source.url);
    if (!url || !source.linkPattern.test(new URL(url).pathname)) continue;
    const start = Math.max(0, match.index - 1400);
    const end = Math.min(html.length, match.index + 1800);
    result.push({ url, text: clean(html.slice(start, end)) });
  }

  if (!result.length) {
    const plain = clean(html);
    const blocks = plain.split(/(?=(?:NEU\s+)?[^.]{4,100}(?:Wohnung|Apartment|Zimmer))/i);
    for (const block of blocks) {
      if (block.length < 30 || block.length > 1600) continue;
      const d = district(block);
      const rooms = number(block.match(/(\d(?:[,.]5)?)\s*(?:Zi\.|Zimmer|Raum)/i)?.[1]);
      const area = number(block.match(/(\d{1,3}(?:[,.]\d{1,2})?)\s*m(?:²|2)/i)?.[1]);
      const rent = number(block.match(/(\d{2,5}(?:\.\d{3})*(?:,\d{1,2})?)\s*€/i)?.[1]);
      if (d && [rooms, area, rent].filter(Number.isFinite).length >= 2) {
        result.push({ url: source.url, text: block });
      }
    }
  }
  return result;
}

function parse(candidate, source, previousByUrl, index) {
  const text = clean(candidate.text);
  if (EXCLUDE.test(text)) return null;
  const d = district(text);
  if (!d) return null;

  const rooms = number(text.match(/(\d(?:[,.]5)?)\s*(?:Zi\.|Zimmer|Raum|RW)\b/i)?.[1]);
  const areaSqm = number(text.match(/(\d{1,3}(?:[,.]\d{1,2})?)\s*m(?:²|2)\b/i)?.[1]);
  const warmRent = number(text.match(/(?:Warmmiete|Gesamtmiete)\s*:?[ ]*(\d{2,5}(?:\.\d{3})*(?:,\d{1,2})?)\s*€/i)?.[1]);
  const netColdRent = number(text.match(/(?:Kaltmiete\s*:?[ ]*)?(\d{2,5}(?:\.\d{3})*(?:,\d{1,2})?)\s*€(?:\s*Kaltmiete)?/i)?.[1]);
  if ([rooms, areaSqm, netColdRent, warmRent].filter(Number.isFinite).length < 2) return null;

  const postcode = text.match(/\b(01\d{3})\b/)?.[1] || null;
  const street = text.match(/\b([A-ZÄÖÜ][A-Za-zÄÖÜäöüß .-]+(?:straße|str\.|ring|weg|platz|allee|hof)\s*\d+[a-z]?)\b/i)?.[1] || null;
  const titleMatch = text.match(/(?:NEU\s+)?([^.!?]{8,150}(?:Wohnung|Apartment|Zuhause)[^.!?]{0,80})/i)?.[1];
  const title = titleMatch ? clean(titleMatch).slice(0, 180) : `${rooms ? `${rooms}-Zimmer-Wohnung` : "Wohnung"} in ${d}`;
  const accessibility = classify(text);
  const keyUrl = candidate.url === source.url ? `${candidate.url}#angebot-${index}` : candidate.url;
  const previous = previousByUrl.get(keyUrl);

  return {
    id: `${source.id}-${createHash("sha256").update(keyUrl).digest("hex").slice(0, 12)}`,
    dataStatus: "live",
    title,
    district: d,
    location: street ? `${street}${postcode ? `, ${postcode} Dresden` : ", Dresden"}` : `${d}, Dresden${postcode ? ` (${postcode})` : ""}`,
    distanceMeters: null,
    rooms,
    areaSqm,
    netColdRent,
    coldOperatingCosts: null,
    grossColdRent: null,
    heatingCosts: null,
    warmRent,
    accessibilityCategory: accessibility.category,
    accessibilityLabel: accessibility.label,
    accessibilityFeatures: accessibility.matches.map((term) => `Im Angebot erkannt: ${term}`),
    wbs: /\bwbs\b|wohnberechtigungsschein/i.test(text) ? "erforderlich" : "unbekannt",
    wbsType: /\bpmw\b/i.test(text) ? "pMW" : /\bgmw\b/i.test(text) ? "gMW" : null,
    provider: source.provider,
    sourceId: source.id,
    firstFound: previous?.firstFound || TODAY,
    lastChecked: TODAY,
    contact: source.contact,
    originalUrl: candidate.url,
    originalLabel: `Originalquelle ${source.groupName || source.name} öffnen`,
    suitableForPersons: [],
  };
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; WohnungsberatungDresden/1.3; +https://github.com/67hvgkv67d-png/barrierefreie-wohnungen-dresden)",
      accept: "text/html,application/xhtml+xml",
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
  const sourceIds = new Set(SOURCES.map((source) => source.id));
  let apartments = (existing.apartments || []).filter((item) => !sourceIds.has(item.sourceId));
  const sourceChecks = { ...(existing.sourceChecks || {}) };

  for (const source of SOURCES) {
    const previous = (existing.apartments || []).filter((item) => item.sourceId === source.id);
    const previousByUrl = new Map(previous.map((item) => [item.originalUrl, item]));
    try {
      const html = await fetchHtml(source.url);
      const imported = candidates(html, source)
        .map((candidate, index) => parse(candidate, source, previousByUrl, index))
        .filter(Boolean)
        .filter((item, index, all) => all.findIndex((other) => other.id === item.id) === index);
      apartments.push(...imported);
      sourceChecks[source.id] = {
        name: source.name,
        groupName: source.groupName || source.name,
        status: "success",
        checkedAt: TODAY,
        offersFound: imported.length,
        searchUrl: source.url,
        note: imported.length ? "Passende Angebote wurden übernommen." : "Quelle war erreichbar; keine ausreichend vollständig erkennbaren passenden Angebote gefunden.",
      };
      console.log(`${source.name}: ${imported.length} passende Angebote gespeichert.`);
    } catch (error) {
      apartments.push(...previous);
      sourceChecks[source.id] = {
        name: source.name,
        groupName: source.groupName || source.name,
        status: "error",
        checkedAt: TODAY,
        offersFound: previous.length,
        searchUrl: source.url,
        note: `Abruf fehlgeschlagen: ${error.message}. Vorhandene Daten wurden beibehalten.`,
      };
      console.warn(`${source.name}: ${error.message}`);
    }
  }

  sourceChecks.kleinanzeigen = {
    name: "Kleinanzeigen",
    groupName: "Kleinanzeigen",
    status: "manual",
    checkedAt: TODAY,
    offersFound: null,
    searchUrl: "https://www.kleinanzeigen.de/s-wohnung-mieten/dresden/johannstadt-gorbitz/k0c203l3820",
    note: "Keine offizielle RSS-Schnittstelle oder öffentliche API für diesen Suchzweck eingebunden. Der Link ermöglicht eine manuelle Kontrolle.",
  };

  const output = { ...existing, lastUpdated: TODAY, sourceChecks, apartments };
  await writeFile(DATA_FILE, `${JSON.stringify(output, null, 2)}\n`, "utf8");
}

main().catch((error) => {
  console.error(`Import der Zusatzquellen fehlgeschlagen: ${error.message}`);
  process.exitCode = 1;
});
