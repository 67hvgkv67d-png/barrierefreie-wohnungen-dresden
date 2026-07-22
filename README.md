# Barrierefreie Wohnungen Dresden

Grundversion einer öffentlichen, barrierearmen und mobil nutzbaren Übersicht für barrierefreie und barrierearme Mietwohnungsangebote in Dresden-Johannstadt und Dresden-Gorbitz.

## Aktueller Stand

Die Webseite befindet sich im Testbetrieb. Alle angezeigten Wohnungen sind eindeutig gekennzeichnete Beispieldaten und keine echten Wohnungsangebote. Die öffentliche Webseite führt selbst keine automatische Wohnungssuche, keine Karten- oder Entfernungs-API und keinen Abruf externer Webseiten aus.

Für die technische Vorbereitung gibt es zusätzlich einen rein manuellen Quellencheck. Er veröffentlicht keine Angebote und besitzt keinen automatischen Zeitplan.

## Funktionen

- Filter nach Stadtteil, Barrierefreiheitskategorie, Personenzahl, KdU-Einschätzung und Wohnberechtigungsschein
- Sortierung nach Entfernung, Warmmiete oder Funddatum
- Angebotskarten mit gut lesbaren Eckdaten
- Aufklappbare Erklärung der Kategorien A, B und C
- Daten werden vollständig aus `data/wohnungen.json` geladen
- Keine externen Bibliotheken, Schriftarten oder Bilder

## Dateien

- `index.html` – semantische Seitenstruktur
- `styles.css` – responsive Gestaltung mit hohem Kontrast und sichtbarem Fokus
- `script.js` – Laden der JSON-Daten, Filterung, Sortierung und Fehlermeldungen
- `data/wohnungen.json` – erfundene Beispieldaten
- `data/quellen.json` – Konfiguration der zunächst zu prüfenden Vermietungsquellen
- `scripts/pruefe-quellen.mjs` – rein technischer Erreichbarkeits- und Feldindikator
- `.github/workflows/quellen-pruefung.yml` – ausschließlich manuell startbarer Prüflauf

## Technischer Quellencheck

Die Datei `data/quellen.json` enthält zunächst fünf öffentliche Vermietungsquellen:

- EWG Dresden
- Grand City Property
- WiD Wohnen in Dresden
- WG Aufbau Dresden
- Vonovia Dresden

Das Skript `scripts/pruefe-quellen.mjs` prüft ausschließlich:

- ob die konfigurierte öffentliche Start- oder Suchseite erreichbar ist,
- welchen HTTP-Status und Inhaltstyp sie liefert,
- ob typische Feldbezeichnungen wie Adresse, Zimmer, Wohnfläche, Miete, Verfügbarkeit, Barrierefreiheit, WBS, Kontakt und Objektnummer erkennbar sind.

Es folgt keinen Angebotslinks, lädt keine Bilder, speichert kein vollständiges HTML und übernimmt oder veröffentlicht keine echten Wohnungsangebote. Die Felderkennung ist nur ein technischer Indikator und noch kein fertiger Import.

Lokaler Konfigurationstest ohne Internetzugriff:

```bash
node scripts/pruefe-quellen.mjs --dry-run
```

Einmaliger Quellenabruf:

```bash
node scripts/pruefe-quellen.mjs
```

Alternativ kann unter **Actions → Einmalige Quellenprüfung → Run workflow** ein rein manueller GitHub-Actions-Lauf gestartet werden. Es gibt keinen automatischen Zeitplan. Ein späterer Zeitplan ist nur für Montag und Mittwoch vorgesehen und derzeit ausdrücklich deaktiviert.
