# EK-Service – Einkaufs- und Bestandsmanagement für den Service

Einkaufs- und Bestandsmanagement für den **Servicebereich** eines Hotel- und Restaurantbetriebs.
Läuft als **einzelne Windows-Datei `EK-Service.exe`**, z. B. auf einem Dell-Rugged-Tablet oder -Laptop. Installation, Datenbankserver oder Internet sind nicht nötig.

> Ein Kücheneinkauf ist bewusst **nicht** umgesetzt. Die Datenbank trennt aber jeden Datensatz nach Bereich (`department`), und der Bereich `kueche` ist bereits angelegt (deaktiviert). Ein Küchenmodul kann deshalb später ohne Umbau ergänzt werden.

---

## Schnellstart auf dem Dell Rugged (Windows 10/11, 64 Bit)

1. `EK-Service.exe` in einen eigenen Ordner kopieren, z. B. `C:\EK-Service\` (nicht nach *Programme*).
2. Doppelklick auf `EK-Service.exe`.
   - Ein Konsolenfenster zeigt den Status. **Dieses Fenster geöffnet lassen.**
   - Die Oberfläche öffnet sich automatisch als randloses Edge-App-Fenster.
   - Windows SmartScreen meldet beim ersten Start eventuell „Unbekannter Herausgeber“, weil die Datei nicht signiert ist. Dann *Weitere Informationen → Trotzdem ausführen* wählen.
   - Die Windows-Firewall fragt nach einer Freigabe. **„Private Netzwerke“** erlauben, damit Smartphones im WLAN zugreifen können.
3. Anmelden mit **Benutzer `admin`, Passwort `admin`**. Danach das Passwort sofort ändern (unten links auf den Namen tippen).
4. Unter **System** den Betriebsnamen eintragen. Zum Ausprobieren können dort Beispieldaten geladen werden.
5. Unter **Drucker** den Bondrucker anlegen und einen Testdruck auslösen.

Alle Daten liegen im Ordner `ek-data` neben der EXE:

- `ek-service.db`: Datenbank
- `backups\`: automatische Sicherungen
- `config.json`: Port und Startverhalten

Ist der Ordner neben der EXE nicht beschreibbar, wird stattdessen `%LOCALAPPDATA%\EK-Service` verwendet.

**Autostart (optional):** Mit `Win+R` → `shell:startup` den Autostart-Ordner öffnen und dort eine Verknüpfung zur EXE ablegen.

**Smartphones/Tablets im WLAN:** Unter *System → Zugriff* stehen die Adressen, z. B. `http://192.168.1.20:8080`. Diese Adresse im Browser öffnen und „Zum Startbildschirm hinzufügen“ wählen. Gedruckt wird immer über den EK-Service-Rechner, deshalb funktioniert der Druck auch vom Handy aus.

`config.json`:
```json
{ "port": 8080, "host": "0.0.0.0", "openBrowser": true, "appWindow": true }
```
`"host": "127.0.0.1"` sperrt den Zugriff aus dem Netzwerk. Startparameter: `--port 9000`, `--no-browser`.

---

## So läuft ein Einkauf (geführte Bestandszählung)

Der Ablauf funktioniert wie in Inventursystemen großer Firmen:

1. **„+ Neue Einkaufsliste“** antippen (Dashboard, Einkaufslisten oder Bestandszählungen) und **„Mit Bestandszählung“** wählen. Optional lassen sich Lagerorte und Kategorien eingrenzen.
2. Das System legt einen **Zählbeleg** (z. B. `INV-00001`) und eine leere **Einkaufsliste** (z. B. `EK-00002`) an.
3. Es führt dich in Laufwegreihenfolge Artikel für Artikel durchs Lager: *„Coca-Cola 0,2 l – Wie viele Kästen sind noch da?“*
4. Du tippst die Menge über den großen Ziffernblock ein, z. B. **2**. Das System zeigt sofort: **„🛒 Nachkaufen: 8 Kästen (auffüllen bis MAX 10)“**.
5. **„Speichern & weiter“** bucht den Bestand und setzt die 8 Kästen **automatisch auf die Einkaufsliste**. Danach kommt der nächste Artikel.
   - Die Menge lässt sich mit −/+ anpassen; eine manuelle Menge wird bei einer Nachzählung nicht überschrieben.
   - Schnelltasten: *Nichts mehr da (0)*, *Unverändert*, *Voll (MAX)*.
   - *Überspringen*: Der Artikel bleibt „nicht kontrolliert“ und wird **nicht** als 0 gewertet.
   - Was bereits auf einer anderen offenen Bestellung steht, wird abgezogen. So entstehen keine Doppelbestellungen.
6. Am Ende zeigt die Übersicht den Bestellvorschlag und die **Soll/Ist-Differenzen** zur letzten Zählung (Verbrauch/Schwund). Von dort geht es direkt zur Einkaufsliste mit Bondruck, PDF und Freigabe.

Mit Tastatur geht es noch schneller: Zahl tippen und *Enter* drücken. Alle Zählbelege bleiben unter **Bestandszählungen** nachvollziehbar und lassen sich als CSV exportieren.

## Funktionen

| Bereich | Umfang |
|---|---|
| **Artikel** | Alle geforderten Felder inklusive Bild (Kamera/Datei, wird automatisch verkleinert). Anlegen, Bearbeiten, Duplizieren, Archivieren/Wiederherstellen, Aktiv/Inaktiv, Löschen (nur ohne Historie). Sortieren nach jeder Spalte sowie manuelle Reihenfolge (= Laufweg im Lager). CSV-Export und -Import (Excel), Bestandskorrektur mit Pflichtgrund, Bewegungshistorie |
| **Kategorien, Lagerorte, Einheiten** | Frei konfigurierbar und sortierbar, Einheiten mit Ein- und Mehrzahl („1 Flasche / 3 Flaschen“) |
| **MIN/MAX** | Bestellempfehlung, sobald *Ist-Bestand + bereits bestellt ≤ MIN*: auffüllen bis MAX, aufgerundet auf Gebindeschritt und Mindestbestellmenge. Offene Mengen aus allen Listen werden abgezogen (Schutz vor Doppelbestellungen). MAX ist ein Zielwert: Mit Berechtigung darf er überschritten werden, Servicemitarbeiter werden serverseitig begrenzt |
| **Statusfarben** | 🟢 ausreichend · 🟡 MIN erreicht · 🔴 unter MIN · ⚪ nicht kontrolliert (oder Kontrolle älter als X Tage) · 🔵 Nachbestellung ausgelöst |
| **Einkaufsmodus** | Touch-optimiert mit großer Checkbox, MIN/MAX, Ist-Bestand und Bestellmenge mit ± sowie automatischer Empfehlung, außerdem „Bestand ausreichend“, „Nicht verfügbar“ und Bemerkung. Zwei Arbeitsweisen: **Schnellauswahl** und **Bestandskontrolle**. Sortierung nach Lagerort, Kategorie oder Lieferant; Suche; Filter (Bedarf, nicht kontrolliert, auf der Liste). Jede Eingabe wird sofort gespeichert; bei Funkloch wird automatisch erneut gesendet. Mit *Enter* springt der Cursor zum nächsten Artikel. **Nicht kontrollierte Artikel werden nie als Bestand 0 behandelt** |
| **Einkaufslisten** | Positionen hinzufügen und entfernen, Mengen ändern, als eingekauft abhaken. Speichern, abschließen, erneut öffnen, nach Lieferant/Kategorie/Lagerort gruppieren. Doppelte Artikel werden automatisch zusammengeführt (auch ganze Listen). Geschätzte Preise und Gesamtkosten inklusive Versand, Warnung bei Mindestbestellwert, PDF (A4 quer mit Abhak-Kästchen), Bondruck (auch ein Bon je Lieferant) |
| **Status-Workflow** | Entwurf → Einkaufsbereit → Bestellt (Freigabe nur Admin) → Teilweise/Vollständig geliefert → Abgeschlossen; Storniert. Erneutes Öffnen ist möglich |
| **Wareneingang** | Gelieferte Mengen und tatsächliche Preise erfassen. Die Mengen werden dem Bestand zugebucht, Korrekturen sind möglich, der neue Einkaufspreis kann optional übernommen werden |
| **Historie** | Eindeutige Nummer (EK-00001), Ersteller, Mengen, Lieferanten, geschätzte und tatsächliche Kosten, Status, vollständiger Änderungsverlauf, Druckhistorie mit Nachdruck |
| **Lieferanten** | Alle geforderten Felder, Bestell- und Liefertage, Mindestbestellwert, Versandkosten, Artikelzuordnung |
| **Dashboard** | Artikel unter und am MIN, nicht kontrolliert, offene Listen und Bestellungen, ausstehende Lieferungen, geschätztes Einkaufsvolumen, letzte Bestandskontrolle. Dazu monatliche Kosten sowie Kosten nach Kategorie und Lieferant, Lagerwert und Überbestände (gebundenes Kapital) |
| **Benutzer & Rechte** | Rollen Administrator und Servicemitarbeiter, Zusatzrechte einzeln vergebbar. Touch-Anmeldung mit PIN-Feld, Sperre nach 5 Fehlversuchen, mindestens ein Admin bleibt immer erhalten |
| **Protokoll** | Alle relevanten Änderungen mit Benutzer, Zeit und Vorher/Nachher-Werten |
| **Datensicherung** | Täglich automatisch (Rotation), manuell, Download, Wiederherstellung aus Liste oder Datei (vorher wird automatisch eine Sicherheitskopie angelegt), Integritätsprüfung |

### Rechte

| Recht | Service | Admin |
|---|:-:|:-:|
| Bestände kontrollieren, Artikel auswählen, Einkaufslisten erstellen | ✓ | ✓ |
| Bestellmengen ändern (bis MAX) | ✓ | ✓ |
| Einkaufsbons drucken / PDF | ✓ | ✓ |
| MAX überschreiten, Wareneingang, Freigabe/Abschluss | – | ✓ |
| Artikel, MIN/MAX, Preise, Lieferanten, Drucker, Benutzer, Statistik, System | – | ✓ |

Einzelne Admin-Rechte können auch Servicemitarbeitern gegeben werden (z. B. Wareneingang buchen).

---

## Bondrucker (80 mm, ESC/POS, Epson TM-m30II)

Der Druck geht **direkt aus dem EK-Service-Programm** an den Drucker. Weil ein Browser keine rohen Druckdaten an Netzwerkdrucker senden darf, übernimmt der eingebaute lokale Druckdienst diese Aufgabe. Es erscheint kein Druckdialog.

| Protokoll | Einsatz |
|---|---|
| **ESC/POS über Netzwerk** (RAW, Port 9100) | Empfohlen für TM-m30II und alle ESC/POS-Netzwerkdrucker. Echtzeitstatus per DLE EOT (Deckel offen, Papier leer/fast leer, offline) |
| **Epson ePOS-Print** (HTTP, Port 80) | Herstellerschnittstelle der TM-m30II mit detaillierter Statusrückmeldung. ePOS-Print muss in der Drucker-Weboberfläche aktiviert sein |
| **Windows-Drucker** (RAW) | USB- oder Bluetooth-Bondrucker mit installiertem Windows-Treiber. Druck über die Windows-Warteschlange ohne Dialog; „Drucker suchen“ listet die installierten Drucker |

Einstellbar sind außerdem Papierbreite (80/58 mm), Zeichen pro Zeile, Zeichensatz (PC858 mit € und Umlauten), automatischer Papierabschnitt, Standarddrucker und Aktiv/Inaktiv. Jeder Druck wird mit Erfolg oder Fehlermeldung protokolliert und kann erneut gedruckt werden, auch auf einem anderen Drucker.

**IP-Adresse der TM-m30II:** Drucker ausschalten, die Vorschubtaste gedrückt halten und einschalten. Der Statusbon zeigt die IP. Am besten im Router eine feste IP vergeben.

Beispielbon (Vorschau aus dem Druckdialog):
```
================================================
         S E R V I C E - E I N K A U F
               Hotel & Restaurant

Datum: 25.11.2026 15:06
Mitarbeiter: Service
Liste: EK-00001

ALKOHOLFREIE GETRÄNKE
[ ] Coca-Cola 0,2 l                     8 Kästen
[ ] Fanta 0,2 l                         3 Kästen

SPIRITUOSEN
[ ] Aperol                            2 Flaschen
[ ] Bacardi Carta Blanca               1 Flasche
------------------------------------------------
Positionen: 4
================================================
```

---

## Technik

- **Laufzeit:** Node.js 22 als *Single Executable Application*. Server, Oberfläche, Datenbank und Druckdienst stecken in einer Datei; es gibt **keine Laufzeit-Abhängigkeiten** von Drittanbietern.
- **Datenbank:** SQLite (in Node integriert) im WAL-Modus. Fremdschlüssel, CHECK-Constraints und Eindeutigkeiten sichern die Konsistenz, alle Buchungen laufen in Transaktionen, Schemaänderungen über versionierte Migrationen.
- **Sicherheit:** scrypt-Passwort-Hashes, HttpOnly/SameSite-Sitzungscookies, CSRF-Header, Content-Security-Policy, serverseitige Validierung und Rechteprüfung bei jedem Endpunkt, Schutz vor Formel-Injektion beim CSV-Export.
- **Oberfläche:** Vanilla-JavaScript-Module ohne Build-Schritt, responsiv (Tablet, Smartphone, PC), große Touchflächen.

```
src/
  main.js              Start, Browserfenster, Port-Fallback, Einzelinstanz
  app.js               Zusammenbau (auch für Tests)
  auth.js              Passwörter, Sitzungen, Rechte
  db/                  Schema/Migrationen, Startdaten
  http/                Router, Server, Validierung
  services/            Fachlogik: stock (MIN/MAX), lists (Workflow, Wareneingang),
                       printing, dashboard, backup, audit
  print/               Bon-Layout + ESC/POS/ePOS, Transportwege, PDF-Generator
  routes/              REST-API
public/                Oberfläche (SPA)
test/                  Automatisierte Tests
scripts/build-exe.js   EXE-Erstellung
```

### Entwickeln, testen, bauen

```bash
npm install
npm start                 # http://localhost:8080
npm test                  # 37 Tests: Berechnungen, Bestandsbuchungen, Rechte, Druck (simulierte Drucker), PDF, Sicherung
npm run build:exe         # → dist/EK-Service.exe (Windows x64, baubar unter Windows/Linux/macOS)
```

Bei jedem Push baut der GitHub-Actions-Workflow `Windows-EXE bauen` die EXE auf einem Windows-Server, startet sie dort zur Probe und stellt sie als Download-Artefakt bereit.

### Erweiterung um den Kücheneinkauf (später)

1. Bereich `kueche` in der Tabelle `departments` aktivieren.
2. Kategorien und Lagerorte mit `department = 'kueche'` anlegen. Die API akzeptiert dafür bereits `?department=…`.
3. In der Oberfläche einen Bereichsumschalter ergänzen. Listen bekommen dann automatisch ein eigenes Nummernpräfix (z. B. `KU-00001`).
