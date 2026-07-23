import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { chromium } from "playwright";

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
    linkPattern: /\/wohnungsangebote\/[^#?]+/i,
  },
  {
    id: "wgj",
    name: "Wohnungsgenossenschaft Johannstadt",
    url: "https://www.wgj.de/startseite.html",
    provider: "Wohnungsgenossenschaft Johannstadt eG",
    contact: "0351 4402-3, info@wgj.de",
    linkPattern: /\/(?:wohnung|wohnungsangebot|immobilie)[^#?]*/i,
  },
  {
    id: "wohnungsboerse-johannstadt-nord",
    name: "Wohnungsbörse – Johannstadt-Nord",
    url: "https://www.wohnungsboerse.net/Dresden_Johannstadt-Nord/mietwohnungen",
    provider: "Anbieter laut Wohnungsbörse",
    contact: null,
    linkPattern: /\/(?:immodetail|mietangebot|wohnung)\/[^#?]+/i,
  },
  {
    id: "wohnungsboerse-johannstadt-sued",
    name: "Wohnungsbörse – Johannstadt-Süd",
    url: "https://www.wohnungsboerse.net/Dresden_Johannstadt-Sued/mietwohnungen",
    provider: "Anbieter laut Wohnungsbörse",
    contact: null,
    linkPattern: /\/(?:immodetail|mietangebot|wohnung)\/[^#?]+/i,
  },
  {
    id: "wohnungsboerse-gorbitz-nord",
    name: "Wohnungsbörse – Gorbitz-Nord/Neu-Omsewitz",
    url: "https://www.wohnungsboerse.net/Dresden_Gorbitz-NordNeu-Omsewitz/mietwohnungen",
    provider: "Anbieter laut Wohnungsbörse",
    contact: null,
    linkPattern: /\/(?:immodetail|mietangebot|wohnung)\/[^#?]+/i,
  },
  {
    id: "wohnungsboerse-gorbitz-ost",
    name: "Wohnungsbörse – Gorbitz-Ost",
    url: "https://www.wohnungsboerse.net/Dresden_Gorbitz-Ost/mietwohnungen",
    provider: "Anbieter laut Wohnungsbörse",
    contact: null,
    linkPattern: /\/(?:immodetail|mietangebot|wohnung)\/[^#?]+/i,
  },
  {
    id: "immonet-johannstadt",
    name: "Immonet – Johannstadt",
    url: "https://www.immonet.de/suchen/miete/wohnung/dresden-01067/johannstadt-sud-1307/nbh2de91302429",
    provider: "Anbieter laut Immonet",
    contact: null,
    linkPattern: /\/expose\/[a-z0-9-]+/i,
  },
  {
    id: "immonet-gorbitz",
    name: "Immonet – Gorbitz",
    url: "https://www.immonet.de/suchen/miete/wohnung/dresden-01067/gorbitz-ost-1159/nbh2de91302419",
    provider: "Anbieter laut Immonet",
    contact: null,
    linkPattern: /\/expose\/[a-z0-9-]+/i,
  },
];

function clean(value = "") {
  return String(value).replace(/\s+/g, " ").trim();
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

function parseCandidate(candidate, source, previousByUrl, index) {
  const text = clean(candidate.text);
  if (!text || EXCLUDE.test(text)) return null;
  const foundDistrict = district(text);
  if (!foundDistrict) return null;

  const rooms = number(text.match(/(\d(?:[,.]5)?)\s*(?:Zi\.?|Zimmer|Raum|RW)\b/i)?.[1]);
  const areaSqm = number(text.match(/(\d{1,3}(?:[,.]\d{1,2})?)\s*m(?:²|2)\b/i)?.[1]);
  const warmRent = number(text.match(/(?:Warmmiete|Gesamtmiete)\s*:?\s*(\d{2,5}(?:\.\d{3})*(?:,\d{1,2})?)\s*€/i)?.[1]);
  const coldOperatingCosts = number(text.match(/(?:Nebenkosten|Betriebskosten)\s*:?\s*(\d{2,5}(?:\.\d{3})*(?:,\d{1,2})?)\s*€/i)?.[1]);
  const netColdRent = number(text.match(/(?:Kaltmiete\s*:?\s*)?(\d{2,5}(?:\.\d{3})*(?:,\d{1,2})?)\s*€(?:\s*Kaltmiete)?/i)?.[1]);
  if ([rooms, areaSqm, netColdRent, warmRent].filter(Number.isFinite).length < 2) return null;

  const postcode = text.match(/\b(01\d{3})\b/)?.[1] || null;
  const street = text.match(/\b([A-ZÄÖÜ][A-Za-zÄÖÜäöüß .-]+(?:straße|str\.|ring|weg|platz|allee|hof)\s*\d+[a-z]?)\b/i)?.[1] || null;
  const title = clean(candidate.title || "").slice(0, 180) || `${rooms ? `${rooms}-Zimmer-Wohnung` : "Wohnung"} in ${foundDistrict}`;
  const keyUrl = candidate.url || `${source.url}#angebot-${index}`;
  const previous = previousByUrl.get(keyUrl);
  const accessibility = classify(text);

  return {
    id: `${source.id}-${createHash("sha256").update(keyUrl).digest("hex").slice(0, 12)}`,
    dataStatus: "live",
    title,
    district: foundDistrict,
    location: street ? `${street}${postcode ? `, ${postcode} Dresden` : ", Dresden"}` : `${foundDistrict}, Dresden${postcode ? ` (${postcode})` : ""}`,
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
    provider: source.provider,
    sourceId: source.id,
    firstFound: previous?.firstFound || TODAY,
    lastChecked: TODAY,
    contact: source.contact,
    originalUrl: keyUrl,
    originalLabel: `Originalangebot bei ${source.name} öffnen`,
    suitableForPersons: [],
  };
}

async function dismissConsent(page) {
  const labels = [/alle akzeptieren/i, /akzeptieren/i, /zustimmen/i, /einverstanden/i, /accept all/i];
  for (const label of labels) {
    const button = page.getByRole("button", { name: label }).first();
    try {
      if (await button.isVisible({ timeout: 700 })) {
        await button.click({ timeout: 1500 });
        return;
      }
    } catch { /* kein passender Dialog */ }
  }
}

async function extractCandidates(page, source) {
  return page.evaluate(({ patternSource, patternFlags }) => {
    const pattern = new RegExp(patternSource, patternFlags);
    const cleanText = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const results = [];
    const seen = new Set();

    for (const anchor of document.querySelectorAll("a[href]")) {
      let url;
      try { url = new URL(anchor.href, document.baseURI).href; } catch { continue; }
      if (!pattern.test(new URL(url).pathname)) continue;
      pattern.lastIndex = 0;
      const container = anchor.closest("article, li, [class*='card'], [class*='result'], [class*='offer'], [class*='listing']") || anchor.parentElement;
      const text = cleanText(container?.innerText || anchor.innerText || "");
      if (text.length < 20 || seen.has(url)) continue;
      seen.add(url);
      const heading = container?.querySelector("h1,h2,h3,h4,[class*='title']");
      results.push({ url, title: cleanText(heading?.textContent || anchor.textContent), text });
    }

    if (!results.length) {
      const blocks = [...document.querySelectorAll("article, li, [class*='card'], [class*='result'], [class*='offer'], [class*='listing']")];
      for (const [index, block] of blocks.entries()) {
        const text = cleanText(block.innerText);
        if (text.length < 30 || text.length > 2200) continue;
        if (!/(wohnung|apartment|zimmer|m²|€)/i.test(text)) continue;
        const anchor = block.querySelector("a[href]");
        const heading = block.querySelector("h1,h2,h3,h4,[class*='title']");
        results.push({
          url: anchor?.href || `${location.href}#browser-angebot-${index}`,
          title: cleanText(heading?.textContent || anchor?.textContent),
          text,
        });
      }
    }
    return results.slice(0, 100);
  }, { patternSource: source.linkPattern.source, patternFlags: source.linkPattern.flags });
}

async function main() {
  const existing = JSON.parse(await readFile(DATA_FILE, "utf8"));
  const sourceIds = new Set(SOURCES.map((source) => source.id));
  let apartments = (existing.apartments || []).filter((item) => !sourceIds.has(item.sourceId));
  const sourceChecks = { ...(existing.sourceChecks || {}) };

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    locale: "de-DE",
    timezoneId: "Europe/Berlin",
    viewport: { width: 1440, height: 1000 },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  });

  try {
    for (const source of SOURCES) {
      const previous = (existing.apartments || []).filter((item) => item.sourceId === source.id);
      const previousByUrl = new Map(previous.map((item) => [item.originalUrl, item]));
      const page = await context.newPage();
      try {
        const response = await page.goto(source.url, { waitUntil: "domcontentloaded", timeout: 45000 });
        await dismissConsent(page);
        await page.waitForTimeout(2500);
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(1500);

        const status = response?.status() ?? null;
        if (status && status >= 400) throw new Error(`HTTP ${status} auch im Browser`);

        const candidates = await extractCandidates(page, source);
        const imported = candidates
          .map((candidate, index) => parseCandidate(candidate, source, previousByUrl, index))
          .filter(Boolean)
          .filter((item, index, all) => all.findIndex((other) => other.originalUrl === item.originalUrl) === index);

        apartments = [...apartments.filter((item) => item.sourceId !== source.id), ...imported];
        sourceChecks[source.id] = {
          name: source.name,
          status: "success",
          checkedAt: TODAY,
          offersFound: imported.length,
          searchUrl: source.url,
          note: imported.length
            ? `Mit Chromium vollständig geladen; ${candidates.length} mögliche Einträge geprüft.`
            : `Mit Chromium vollständig geladen; ${candidates.length} mögliche Einträge geprüft, aber keine ausreichend vollständigen passenden Angebote erkannt.`,
        };
        console.log(`${source.name}: ${imported.length} passende Angebote aus ${candidates.length} Browser-Kandidaten gespeichert.`);
      } catch (error) {
        sourceChecks[source.id] = {
          name: source.name,
          status: "error",
          checkedAt: TODAY,
          offersFound: previous.length,
          searchUrl: source.url,
          note: `Browser-Abruf fehlgeschlagen: ${error.message}. Vorhandene Daten wurden beibehalten.`,
        };
        apartments = [...apartments.filter((item) => item.sourceId !== source.id), ...previous];
        console.warn(`${source.name}: ${error.message}`);
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }

  sourceChecks.kleinanzeigen = {
    name: "Kleinanzeigen – manuelle Suche",
    status: "manual",
    checkedAt: TODAY,
    offersFound: null,
    searchUrl: "https://www.kleinanzeigen.de/s-wohnung-mieten/dresden/c203l3820",
    note: "Keine offizielle öffentliche Schnittstelle eingebunden. Diese Quelle muss über den Link manuell nach Johannstadt, Gorbitz und Barrierefreiheit geprüft werden.",
  };

  const output = { ...existing, lastUpdated: TODAY, sourceChecks, apartments };
  await writeFile(DATA_FILE, `${JSON.stringify(output, null, 2)}\n`, "utf8");
}

main().catch((error) => {
  console.error(`Browser-Import der Zusatzquellen fehlgeschlagen: ${error.message}`);
  process.exitCode = 1;
});
