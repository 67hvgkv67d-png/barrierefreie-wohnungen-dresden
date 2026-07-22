import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const CONFIG_PATH = path.resolve('data/quellen.json');
const DEFAULT_OUTPUT_PATH = path.resolve('reports/quellen-pruefung.json');
const USER_AGENT = 'BarrierefreieWohnungenDresden-Quellencheck/0.1 (+https://github.com/67hvgkv67d-png/barrierefreie-wohnungen-dresden)';
const REQUEST_TIMEOUT_MS = 15000;
const DELAY_BETWEEN_REQUESTS_MS = 1200;
const MAX_BODY_BYTES = 1500000;

const NAMED_HTML_ENTITIES = Object.freeze({
  amp: '&',
  apos: "'",
  quot: '"',
  lt: '<',
  gt: '>',
  nbsp: ' ',
  auml: 'ä',
  Auml: 'Ä',
  ouml: 'ö',
  Ouml: 'Ö',
  uuml: 'ü',
  Uuml: 'Ü',
  szlig: 'ß',
  eacute: 'é',
  Eacute: 'É',
  agrave: 'à',
  Agrave: 'À',
  egrave: 'è',
  Egrave: 'È',
  euro: '€',
  sup2: '²',
  ndash: '–',
  mdash: '—'
});

const FIELD_PATTERNS = {
  address: [/\bAdresse\b/i, /\bAnschrift\b/i, /\bLage\b/i, /\bStra(?:ße|sse)\b/i, /\bWeg\b/i, /\bRing\b/i],
  rooms: [/\bZimmer\b/i, /\bRäume?\b/i, /\bRaumwohnung\b/i, /\bRaum-Wohnung\b/i],
  area: [/\bWohnfläche\b/i, /\bFläche\b/i, /(?:^|[^\p{L}\p{N}_])m\s*(?:²|2)(?=$|[^\p{L}\p{N}_])/iu],
  rent: [/\bKaltmiete\b/i, /\bWarmmiete\b/i, /\bBruttokaltmiete\b/i, /\bGesamtmiete\b/i, /\bNebenkosten\b/i, /\bMiete\b/i],
  availability: [/\bverfügbar\b/i, /\bfrei ab\b/i, /\bbezugsfrei\b/i, /\bBezug\b/i, /\bVerfügbarkeit\b/i],
  accessibility: [/\bbarrierefrei\b/i, /\bbarrierearm\b/i, /\brollstuhlgerecht\b/i, /\bstufenlos\b/i, /\bAufzug\b/i, /\bLift\b/i],
  wbs: [/\bWBS\b/i, /\bWohnberechtigungsschein\b/i, /\bSozialwohnung\b/i, /\bgefördert\b/i],
  contact: [/\bKontakt\b/i, /\bAnsprechpartner\b/i, /\bTelefon\b/i, /\bE-Mail\b/i, /\bBewerben\b/i, /\bAnfrage\b/i],
  objectId: [/\bObjekt-ID\b/i, /\bObjektnummer\b/i, /\bAngebotsnummer\b/i, /\bReferenznummer\b/i, /\bExposé\b/i, /\bExpose\b/i]
};

function parseArgs(argv) {
  const result = { outputPath: DEFAULT_OUTPUT_PATH, dryRun: false };

  for (const arg of argv) {
    if (arg === '--dry-run') {
      result.dryRun = true;
    } else if (arg.startsWith('--output=')) {
      const value = arg.slice('--output='.length).trim();
      if (!value) throw new Error('Für --output wurde kein Pfad angegeben.');
      result.outputPath = path.resolve(value);
    } else {
      throw new Error(`Unbekanntes Argument: ${arg}`);
    }
  }

  return result;
}

function validateConfig(config) {
  if (!config || !Array.isArray(config.sources) || config.sources.length === 0) {
    throw new Error('data/quellen.json enthält keine Quellen.');
  }

  const ids = new Set();
  for (const source of config.sources) {
    for (const key of ['id', 'name', 'url', 'domain']) {
      if (typeof source[key] !== 'string' || source[key].trim() === '') {
        throw new Error(`Quelle ohne gültiges Feld „${key}“ gefunden.`);
      }
    }

    if (ids.has(source.id)) throw new Error(`Doppelte Quellen-ID: ${source.id}`);
    ids.add(source.id);

    const url = new URL(source.url);
    if (url.protocol !== 'https:') throw new Error(`Nur HTTPS ist erlaubt: ${source.url}`);
    if (url.hostname !== source.domain) {
      throw new Error(`Domain und URL passen nicht zusammen: ${source.id}`);
    }

    if (!Array.isArray(source.expectedFields)) {
      throw new Error(`expectedFields fehlt bei ${source.id}.`);
    }
  }
}

function decodeHtmlEntities(value) {
  return value.replace(/&(?:#(\d+)|#x([\da-fA-F]+)|([A-Za-z][A-Za-z0-9]+));/g, (match, decimal, hexadecimal, named) => {
    if (decimal || hexadecimal) {
      const codePoint = Number.parseInt(decimal || hexadecimal, decimal ? 10 : 16);
      if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
        return match;
      }

      return String.fromCodePoint(codePoint);
    }

    return NAMED_HTML_ENTITIES[named] ?? match;
  });
}

function stripMarkup(html) {
  return decodeHtmlEntities(html)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--([\s\S]*?)-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectFields(html) {
  const decodedHtml = decodeHtmlEntities(html);
  const searchable = `${decodedHtml}\n${stripMarkup(html)}`;
  const detected = {};

  for (const [field, patterns] of Object.entries(FIELD_PATTERNS)) {
    detected[field] = patterns.some((pattern) => pattern.test(searchable));
  }

  return detected;
}

async function readBodyWithLimit(response) {
  if (!response.body) return { body: '', bodyBytes: 0 };

  const reader = response.body.getReader();
  const chunks = [];
  let bodyBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = Buffer.from(value);
      bodyBytes += chunk.byteLength;

      if (bodyBytes > MAX_BODY_BYTES) {
        await reader.cancel('Antwort überschreitet das Größenlimit.').catch(() => {});
        throw new Error(`Antwort größer als ${MAX_BODY_BYTES} Byte.`);
      }

      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }

  return {
    body: Buffer.concat(chunks, bodyBytes).toString('utf8'),
    bodyBytes
  };
}

async function fetchWithLimit(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const startedAt = Date.now();

  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': USER_AGENT,
        accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
        'accept-language': 'de-DE,de;q=0.9'
      }
    });

    const contentType = response.headers.get('content-type') || '';
    const declaredLength = Number(response.headers.get('content-length') || 0);
    if (declaredLength > MAX_BODY_BYTES) {
      if (response.body) await response.body.cancel().catch(() => {});
      throw new Error(`Antwort laut Content-Length größer als ${MAX_BODY_BYTES} Byte.`);
    }

    const { body, bodyBytes } = await readBodyWithLimit(response);

    return {
      ok: response.ok,
      httpStatus: response.status,
      finalUrl: response.url,
      contentType,
      body,
      bodyBytes,
      durationMs: Date.now() - startedAt
    };
  } finally {
    clearTimeout(timeout);
  }
}

function createDryRunResult(source) {
  return {
    id: source.id,
    name: source.name,
    requestedUrl: source.url,
    districts: source.districts,
    status: 'not-requested',
    note: 'Dry-Run: Konfiguration geprüft, aber kein Netzwerkabruf ausgeführt.'
  };
}

async function checkSource(source) {
  try {
    const response = await fetchWithLimit(source.url);
    const fields = detectFields(response.body);
    const recognizedFields = Object.entries(fields)
      .filter(([, found]) => found)
      .map(([field]) => field);
    const missingExpectedFields = source.expectedFields.filter((field) => !fields[field]);

    return {
      id: source.id,
      name: source.name,
      providerType: source.providerType,
      districts: source.districts,
      requestedUrl: source.url,
      finalUrl: response.finalUrl,
      status: response.ok ? 'reachable' : 'http-error',
      httpStatus: response.httpStatus,
      contentType: response.contentType,
      durationMs: response.durationMs,
      bodyBytes: response.bodyBytes,
      recognizedFields,
      missingExpectedFields,
      fieldIndicators: fields,
      diagnosticOnly: true,
      note: 'Die Felderkennung prüft nur öffentlich sichtbare Begriffe und HTML-Merkmale. Sie extrahiert keine Wohnungsangebote und bestätigt noch keine dauerhafte technische Nutzbarkeit.'
    };
  } catch (error) {
    return {
      id: source.id,
      name: source.name,
      providerType: source.providerType,
      districts: source.districts,
      requestedUrl: source.url,
      status: error?.name === 'AbortError' ? 'timeout' : 'request-failed',
      error: error instanceof Error ? error.message : String(error),
      diagnosticOnly: true
    };
  }
}

function summarize(results) {
  return results.reduce(
    (summary, result) => {
      summary.total += 1;
      summary[result.status] = (summary[result.status] || 0) + 1;
      return summary;
    },
    { total: 0 }
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const config = JSON.parse(await readFile(CONFIG_PATH, 'utf8'));
  validateConfig(config);

  const results = [];
  for (const [index, source] of config.sources.entries()) {
    console.log(`[${index + 1}/${config.sources.length}] Prüfe ${source.name} …`);
    results.push(options.dryRun ? createDryRunResult(source) : await checkSource(source));

    if (!options.dryRun && index < config.sources.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, DELAY_BETWEEN_REQUESTS_MS));
    }
  }

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    purpose: config.purpose,
    dryRun: options.dryRun,
    publicationOfListings: false,
    scheduledRunActive: false,
    futureSchedule: config.futureSchedule,
    summary: summarize(results),
    results
  };

  await mkdir(path.dirname(options.outputPath), { recursive: true });
  await writeFile(options.outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(`\nBericht gespeichert: ${path.relative(process.cwd(), options.outputPath)}`);
  console.log(JSON.stringify(report.summary, null, 2));
}

main().catch((error) => {
  console.error('Quellenprüfung abgebrochen:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});