# Barrierefreie Wohnungen Dresden

Grundversion einer öffentlichen, barrierearmen und mobil nutzbaren Übersicht für barrierefreie und barrierearme Mietwohnungsangebote in Dresden-Johannstadt und Dresden-Gorbitz.

## Aktueller Stand

Die Webseite befindet sich im Testbetrieb. Alle angezeigten Wohnungen sind eindeutig gekennzeichnete Beispieldaten und keine echten Wohnungsangebote. Es gibt keine automatische Wohnungssuche, keine Karten- oder Entfernungs-API und keinen Abruf externer Webseiten.

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
