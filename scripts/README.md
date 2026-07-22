# Automatischer EWG-Import

Der Importer `import-ewg-wohnungen.mjs` liest die öffentlich sichtbaren Wohnungsangebote der EWG Dresden aus.

Er übernimmt nur Angebote,

- deren Postleitzahl dem derzeit berücksichtigten Gebiet Gorbitz zugeordnet ist und
- deren Angebotskarte einen eindeutigen Hinweis wie `pMW`, `barrierefrei`, `rollstuhlgerecht`, `barrierearm` oder `seniorengerecht` enthält.

Die GitHub Action läuft montags und mittwochs um 06:00 UTC. Sie kann außerdem manuell über **Actions → EWG-Wohnungen aktualisieren → Run workflow** gestartet werden.

Bei einem Abruffehler oder einer unerwarteten Änderung der EWG-Seite beendet sich der Import mit Fehler. Die zuletzt veröffentlichten Daten werden dann nicht überschrieben.
