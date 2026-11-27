# EK-Service – Einkaufs- und Bestandsmanagement für den Service

Einkaufs- und Bestandsmanagement für den **Servicebereich** eines Hotel- und Restaurantbetriebs.
Läuft als **eigenes Windows-Programm** mit eigenem Programmfenster, z. B. auf einem Dell-Rugged-Tablet oder -Laptop – ohne Browser, ohne Webseite, ohne Datenbankserver und ohne Internet.

> Ein Kücheneinkauf ist bewusst **nicht** umgesetzt. Die Datenbank trennt aber jeden Datensatz nach Bereich (`department`), und der Bereich `kueche` ist bereits angelegt (deaktiviert). Ein Küchenmodul kann deshalb später ohne Umbau ergänzt werden.

---

## Schnellstart auf dem Dell Rugged (Windows 10/11, 64 Bit)

Es gibt zwei gleichwertige Varianten:

- **`EK-Service-Setup-<Version>.exe` (Installer):** Doppelklick – EK-Service wird ohne weitere Fragen für den aktuellen Benutzer installiert (keine Admin-Rechte nötig) und startet sofort. Desktop-Verknüpfung, Startmenü-Eintrag und „EK-Service aktualisieren“ im Startmenü werden angelegt.
- **`EK-Service-Programm-<Version>.zip` (Programmordner):** ZIP entpacken, z. B. nach `C:\EK-Service-Programm\`, im Ordner `EK-Service` auf **`EK-Service.exe`** doppelklicken. Beim ersten Start werden Verknüpfungen auf dem Desktop und im Startmenü angelegt. Wichtig: den ganzen Ordner behalten, nicht nur die EXE herauskopieren.

Danach:

1. EK-Service öffnet sich als **normales Programmfenster** – keine Adressleiste, keine Tabs, kein Browser, kein Konsolenfenster. Fenster schließen = Programm beendet. Ein zweiter Doppelklick holt nur das offene Fenster nach vorne.
   - Windows SmartScreen meldet beim ersten Start eventuell „Unbekannter Herausgeber“, weil das Programm nicht signiert ist. Dann *Weitere Informationen → Trotzdem ausführen* wählen.
   - Die Firewall fragt **nicht** nach: EK-Service ist von außen nicht erreichbar.
2. **Daten der bisherigen Version übernehmen:** Findet EK-Service beim ersten Start einen alten Ordner `ek-data` (z. B. neben der alten `EK-Service.exe` in `C:\EK-Service\`, auf dem Desktop oder in *Downloads*), fragt es: *„Übernehmen“*, *„Anderen Ordner wählen …“* oder *„Neu beginnen“*. Die alten Dateien bleiben dabei unverändert.
3. Anmelden mit **Benutzer `admin`, Passwort `admin`** (bei neuem Start). Danach das Passwort sofort ändern (unten links auf den Namen tippen).
4. Unter **System** den Betriebsnamen eintragen. Zum Ausprobieren können dort Beispieldaten geladen werden.
5. Unter **Drucker** den Bondrucker anlegen und einen Testdruck auslösen.

Bedienung im Fenster: **F11** Vollbild, **Strg + / Strg − / Strg 0** Schrift größer/kleiner/normal (auch per Zwei-Finger-Zoom), **F5** neu laden.

Alle Daten liegen in **`%APPDATA%\EK-Service\daten`** (unter *System → Zugriff & System* gibt es „Datenordner öffnen“):

- `ek-service.db`: Datenbank
- `backups\`: automatische Sicherungen
- `logs\ek-service.log`: Protokoll für die Fehlersuche

Die Daten bleiben bei Updates und auch beim Deinstallieren erhalten.

**Autostart (optional):** Mit `Win+R` → `shell:startup` den Autostart-Ordner öffnen und die Desktop-Verknüpfung dort hineinkopieren.

**Zugriff vom Handy (optional, standardmäßig aus):** EK-Service ist nur auf diesem Gerät nutzbar. Wer trotzdem mit dem Handy im WLAN mitzählen möchte, legt im Datenordner eine Datei `config.json` mit `{ "lanAccess": true }` an und startet EK-Service neu. Unter *System → Zugriff* stehen dann die Adressen (Port 8080); die Firewall fragt einmalig nach („Private Netzwerke“ erlauben).

---

## So läuft ein Einkauf (geführte Bestandszählung)

Der Ablauf funktioniert wie in Inventursystemen großer Firmen:

1. **„+ Neue Einkaufsliste“** antippen (Dashboard, Einkaufslisten oder Bestandszählungen), **„Mit Bestandszählung“** wählen und bei **„Wo kaufst du ein?“** den Lieferanten bzw. Einkaufsort antippen, z. B. *Großmarkt*. Dann werden nur dessen Artikel abgefragt. Lagerorte und Kategorien lassen sich zusätzlich eingrenzen.
2. Das System legt einen **Zählbeleg** (z. B. `INV-00001`) und eine leere **Einkaufsliste** (z. B. `EK-00002`) an.
3. Es führt dich in Laufwegreihenfolge Artikel für Artikel durchs Lager: *„Coca-Cola 0,2 l – Wie viele Kästen sind noch da?“*
4. Du tippst die Menge über den großen Ziffernblock ein, z. B. **2**. Das System zeigt sofort: **„🛒 Nachkaufen: 8 Kästen (auffüllen bis MAX 10)“**.
5. **„Speichern & weiter“** bucht den Bestand und setzt die 8 Kästen **automatisch auf die Einkaufsliste**. Danach kommt der nächste Artikel.
   - Die Menge lässt sich mit −/+ anpassen; eine manuelle Menge wird bei einer Nachzählung nicht überschrieben.
   - Schnelltasten: *Nichts mehr da (0)*, *Unverändert*, *Voll (MAX)*.
   - *Überspringen*: Der Artikel bleibt „nicht kontrolliert“ und wird **nicht** als 0 gewertet.
   - Was bereits auf einer anderen offenen Bestellung steht, wird abgezogen. So entstehen keine Doppelbestellungen.
6. Am Ende zeigt die Übersicht den Bestellvorschlag und die **Soll/Ist-Differenzen** zur letzten Zählung (Verbrauch/Schwund). Von dort geht es direkt zur Einkaufsliste mit Bondruck, PDF und Freigabe.

7. Zum Schluss **„✓ Fertigstellen“** drücken. Die Einkaufsliste wird einkaufsbereit, und es erscheinen vier große Knöpfe:
   - **📄 PDF ansehen**: öffnen, speichern, weiterleiten.
   - **🖨️ A4 drucken**: druckfertige A4-Seite mit Abhak-Kästchen. Der Windows-Druckdialog öffnet sich automatisch; Drucker auswählen, fertig.
   - **🧾 Bon drucken**: direkt auf den Bondrucker, ohne Dialog.
   - **✉️ E-Mail senden**: PDF als Anhang an Standard-Empfänger oder Lieferanten (mit einem Tipp hinzufügbar).

   Fertige Listen stehen **2 Tage** (einstellbar unter *System*) oben auf dem Dashboard mit denselben Knöpfen. Danach verschwinden sie aus dieser Schnellansicht, bleiben aber dauerhaft unter *Einkaufslisten* gespeichert.

**E-Mail einrichten (einmalig):** *System → E-Mail-Versand*. Anbieter antippen (Gmail, Outlook/Microsoft 365, IONOS, Strato, GMX, WEB.DE, T-Online), dann Benutzer, Passwort und Absender eintragen und **„Test-E-Mail senden“**. Bei Gmail und Microsoft ist ein **App-Passwort** nötig, nicht das normale Passwort. Das Passwort wird in der lokalen Datenbank gespeichert und nie an die Oberfläche zurückgegeben.

**Sonderwünsche:** Vor dem Fertigstellen fragt das Programm: *„Noch Sonderwünsche?“*. Hier kommt alles hinein, was nicht in der Artikelliste steht: ein neuer Wein zum Probieren, Deko für eine Feier, ein Wunsch vom Küchenchef.

- Eintragen: Bezeichnung, Menge, Einheit, Lieferant (optional), Preis (optional) und Bemerkung. Mit „+ Hinzufügen & weiteren“ gehen mehrere nacheinander.
- Gibt es den Artikel schon, schlägt das Programm ihn beim Tippen vor. So entstehen keine Doppelungen.
- Sonderwünsche erscheinen auf Bon, A4, PDF und E-Mail unter **„Sonderwünsche“** und lassen sich wie jede Position abhaken und beim Wareneingang buchen. Sie haben keine Bestandsführung und keine MIN/MAX-Grenze.
- In jeder Einkaufsliste gibt es zusätzlich **„✍️ + Sonderwunsch“**.
- **Kommt der neue Wein gut an:** In der Liste auf **„→ Artikel“** tippen. Er wird ein fester Artikel mit MIN/MAX; alternativ wird er einem vorhandenen Artikel zugeordnet.

Mit Tastatur geht es noch schneller: Zahl tippen und *Enter* drücken. Alle Zählbelege bleiben unter **Bestandszählungen** nachvollziehbar und lassen sich als CSV exportieren.

## Artikel anlegen mit Produktkatalog

Beim Anlegen eines Artikels einfach den Namen tippen, z. B. „cola“, „augustiner“ oder „monin vanille“. Der **eingebaute Produktkatalog** zeigt passende Vorschläge mit Größe und Gebinde, z. B. *Coca-Cola 1,0 l · Flasche · Kasten à 12*.

- Ein Tipp füllt **Name, Hersteller, Kategorie, Größe und Zähleinheit (Flasche, Dose, Fass …)** aus und wählt die typische **Bestelleinheit (Kasten/Karton)** vor.
- Unter **„📦 Wie wird bestellt?“** lässt sich jederzeit umschalten: *einzeln* oder *Kasten à 24/20/12*, *Karton à 6/12/24* bzw. *anders …*. Damit schlägt die Zählung später ganze Kästen statt einzelner Flaschen vor.
- Gibt es den Artikel schon, warnt das Programm vor einer Doppelanlage. Die Artikelnummer wird automatisch vergeben, wenn das Feld leer bleibt.
- Der Katalog funktioniert offline und enthält über 250 typische Service-Artikel: Softdrinks, Wasser, Säfte, Bier, Wein, Sekt, Spirituosen, Liköre, Sirups, Cocktailzutaten, Kaffee/Tee, Verbrauchsmaterial und Reinigung.
- Er enthält **typische Gebinde, aber bewusst keine Preise und keine EAN-Nummern**. Bitte mit dem eigenen Lieferanten abgleichen.
- Auch beim Sonderwunsch schlägt der Katalog Name und Einheit vor.

## MIN/MAX von Claude berechnen lassen und per Tabelle einfügen

1. **Artikel → „📋 Tabelle einfügen (MIN/MAX)“** öffnen.
2. **„Anfrage für Claude kopieren“** antippen, optional nur für einen Lieferanten. Kopiert wird eine fertige Anfrage mit deinen aktuellen Artikeln als Tabelle.
3. Die Anfrage in Claude einfügen und kurz den Betrieb beschreiben (Öffnungstage, Gäste pro Woche, wie oft eingekauft wird, Verbrauch). Claude antwortet mit einer Tabelle mit MIN, MAX, Bestelleinheit (z. B. Karton à 6) usw.
4. Die Antwort-Tabelle in das Feld einfügen. Mitkopierter Text vor oder nach der Tabelle stört nicht. Es funktionieren auch Tabellen aus Excel und CSV.
5. **Vorschau**: Für jeden Artikel siehst du, was sich ändert (z. B. „MIN 2 → 3, MAX 6 → 12“), welche Artikel neu angelegt werden und welche Zeilen Fehler haben.
6. **Übernehmen**. Ab jetzt nutzt jede Bestandszählung diese Werte.

Spalten werden über ihren Namen erkannt, z. B. *Artikel/Bezeichnung*, *MIN/Mindestbestand*, *MAX/Zielbestand*, *Lieferant/Einkaufsort*, *Bestelleinheit*, *Inhalt je Bestelleinheit/Stück pro Karton*, *EK netto*. Artikel werden über die Artikelnummer gefunden, sonst über den Namen. Leere Zellen ändern nichts.

## Bestelleinheiten (zählen in Flaschen, bestellen in Kartons)

Pro Artikel lassen sich eine **Bestelleinheit** und ihr **Inhalt** hinterlegen, z. B. *Karton à 6 Flaschen*. Gezählt wird weiter in Flaschen. Vorgeschlagen werden aber immer ganze Kartons: *„Nachkaufen: 2 Kartons (= 12 Flaschen)“*. Mit −/+ änderst du die Menge kartonweise oder trägst sie selbst ein. Bon und PDF drucken „2 Kartons“, darunter „= 12 Flaschen“.

## Updates einspielen (EK-Service-Update.bat)

Die Update-Datei **`EK-Service-Update.bat`** liegt im Programmordner; bei der installierten Variante gibt es dafür im Startmenü den Eintrag **„EK-Service aktualisieren“**. Doppelklick, und das Update läuft geführt:

1. **[1] Update über Download-Link:** Link zur neuen ZIP- oder Setup-Datei einfügen (Rechtsklick fügt ein). Der Link wird gespeichert; beim nächsten Update genügt **Enter**. Dropbox-, Google-Drive- und OneDrive-Teilen-Links werden automatisch in Direkt-Downloads umgewandelt.
2. **[2] Update aus heruntergeladener Datei:** ZIP/Setup einfach ins Fenster ziehen. Enter nimmt automatisch die neueste EK-Service-Datei aus dem Download-Ordner.
3. **[3] Vorherige Version wiederherstellen:** falls nach einem Update etwas nicht passt.
4. **[4] Desktop-Verknüpfung „EK-Service aktualisieren“** anlegen.

Die Datei erkennt selbst, was eingespielt wird:
- **Programmordner (ZIP):** ersetzt den Programmordner, alte Dateien werden entfernt. Die vorige Version wird in `alte-versionen\` gesichert.
- **Installer (EK-Service-Setup.exe):** installiert still über die vorhandene Installation.
- **Umstieg von der alten Einzel-EXE:** einfach die Update-Datei neben der alten `EK-Service.exe` mit dem neuen ZIP ausführen. Danach steht dort der neue Programmordner; die alte EXE liegt in `alte-versionen\`, beim ersten Start werden die Daten übernommen.

Bei jedem Update geschieht automatisch:
- Prüfung, ob der Download wirklich EK-Service ist und keine Webseite.
- Warten, bis EK-Service geschlossen ist (oder auf Nachfrage beenden).
- **Sicherung** der **Datenbank** (`backups\…_vorupdate.db`) und der alten Programmversion.
- Bei einem Fehler wird der alte Stand wiederhergestellt.
- Anzeige alte → neue Version, auf Wunsch Neustart.

Die Daten bleiben bei Updates unverändert; neue Programmversionen passen die Datenbank beim ersten Start automatisch an.

## Barcodes, QR-Codes & Etiketten

**Codes je Artikel:** Im Artikel (Artikel → antippen → „🏷️ Barcodes / QR-Codes“) lassen sich beliebig viele Codes hinterlegen. Beispiele:

- EAN der Flasche, EAN des Kartons
- eigener Etiketten-Code: „Eigenen Code erzeugen“ ergibt z. B. `EK000007`

Einfach in das Feld scannen oder eintippen. Ein Code gehört immer genau zu einem Artikel; die Artikelnummer funktioniert zusätzlich als Code. Bei EAN-Codes wird die Prüfziffer kontrolliert. Codes lassen sich auch über *Tabelle einfügen* importieren (Spalte *EAN*, *Barcode* oder *Code*).

**Scanner:** Jeder Barcode- oder QR-Scanner im Tastatur-Modus funktioniert: USB, Bluetooth oder eingebaut wie beim Dell Rugged. Das Programm erkennt einen Scan am Tempo, ein Eingabefeld muss dafür nicht angeklickt sein.

- **Bestandszählung:** Der Scan springt sofort zum Artikel (Hinweis „📷 Gescannt – danach geht es weiter mit …“).
  - Nach **„Speichern & weiter“** setzt die Zählung dort fort, wo die normale Reihenfolge stand.
  - Ist der Artikel nicht Teil der Zählung, wird er auf Wunsch hinzugefügt.
  - Ohne Scanner: Code oder Namen ins Feld „📷 Scannen oder Code/Name“ tippen.
- **Einkaufsmodus:** Der Scan springt zur Artikelkarte, das Eingabefeld ist sofort bereit.
- **Artikel:** Der Scan öffnet den Artikel. Ein unbekannter Code bietet „Neuen Artikel anlegen“ oder „Vorhandenem Artikel zuordnen“.
- **Unbekannte Codes** können Administratoren direkt beim Scannen einem Artikel zuordnen; ab dann werden sie erkannt.

**Etiketten drucken:** *Artikel → „🏷️ Etiketten“* oder direkt im Artikel.

- A4-Bögen 3 × 8 (Avery Zweckform L7159) oder 2 × 7 (L7163). Bereits benutzte Etiketten auf angebrochenen Bögen lassen sich überspringen.
- Oder einzeln auf den Bondrucker, mit Schnitt nach jedem Etikett.
- Artikel ohne Code bekommen automatisch einen eigenen Code.
- Gedruckt wird ein Code-128-Barcode, den Barcode- und QR-Scanner lesen. Sehr lange Codes druckt der Bondrucker als QR-Code.
- Im Druckdialog „Ränder: Keine / 100 %“ wählen.

## Belohnungen & angenehme Bedienung

- **Sofort-Feedback:** sanfte Töne, kurze Vibration auf Handy/Tablet, kleine Animationen beim Zählen, Abhaken, Speichern, Drucken und Mailen.
- **Zählung:** Fortschrittsbalken mit „+1 ✓“, Meilensteine (¼, Halbzeit, Endspurt), Serien („🔥 10 in Folge“), Konfetti bei „Alles gezählt“ und beim Fertigstellen.
- **Erfolgsbilanz** nach jeder Zählung: Anzahl, Dauer, Ø Sekunden pro Artikel, geschätzte gesparte Zeit (≈ 30 s je Artikel für Liste schreiben und Mengen ausrechnen).
- **Meine Erfolge:** Level von *Neuling* bis *Inventur-Großmeister*, Erfahrungspunkte und 13 Abzeichen (z. B. *Erste Zählung*, *Vollständig*, *Blitzzähler*, *Dranbleiber*), jeweils mit Freischalt-Feier.
- **Dashboard:** persönliche Begrüßung, Tagesbilanz, Level-Leiste und **Lagergesundheit** des Teams als Ring. Wenn alles im grünen Bereich ist, gibt es einmal am Tag Konfetti.
- **Einstellbar pro Gerät** (unten links auf den Namen tippen): Töne, Vibration, Animationen/Konfetti. „Bewegung reduzieren“ des Betriebssystems wird automatisch beachtet.
- **Bewusst ohne** Ranglisten zwischen Mitarbeitern und ohne Druck- oder Verlustmeldungen: Erfolge sind persönlich, die Lagergesundheit gehört dem ganzen Team.

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

- **Programm:** Electron (eigenes Programmfenster mit eingebautem Chromium und Node.js 24). Der Fachkern läuft im Programm selbst und ist nur programmintern erreichbar (127.0.0.1, zufälliger Port); es gibt **keine Laufzeit-Abhängigkeiten** von Drittanbietern. Installer: NSIS (pro Benutzer, ohne Admin-Rechte).
- **Datenbank:** SQLite (in Node integriert) im WAL-Modus. Fremdschlüssel, CHECK-Constraints und Eindeutigkeiten sichern die Konsistenz, alle Buchungen laufen in Transaktionen, Schemaänderungen über versionierte Migrationen.
- **Sicherheit:** scrypt-Passwort-Hashes, HttpOnly/SameSite-Sitzungscookies, CSRF-Header, Content-Security-Policy, serverseitige Validierung und Rechteprüfung bei jedem Endpunkt, Schutz vor Formel-Injektion beim CSV-Export.
- **Oberfläche:** Vanilla-JavaScript-Module ohne Build-Schritt, responsiv (Tablet, Smartphone, PC), große Touchflächen.

```
src/
electron/              Programmfenster, Datenübernahme, Verknüpfungen, Selbsttest
  main.js              Start ohne Programmfenster (Entwicklung/Server)
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
scripts/build-portable.js  Programmordner als ZIP
windows/               Update-Datei, Installer-Ergänzungen
```

### Entwickeln, testen, bauen

```bash
npm install
npm start                 # Programmfenster öffnen (Electron)
npm run server            # nur Kern ohne Fenster: http://localhost:8080
npm test                  # 62 Tests: Berechnungen, Bestandsbuchungen, Rechte, Druck (simulierte Drucker), PDF, Sicherung
npm run build:win         # → dist-app/EK-Service-Setup-<Version>.exe (Installer, unter Windows bauen)
npm run build:portable    # → dist-app/EK-Service-Programm-<Version>.zip (Programmordner, baubar unter Windows/Linux)
node scripts/make-icon.js # Programmsymbol assets/icon.ico aus assets/icon.svg neu erzeugen (benötigt Playwright)
```

Bei jedem Push baut der GitHub-Actions-Workflow `Windows-Programm bauen` Installer und Programmordner auf einem Windows-Server, installiert und startet beides dort zur Probe (Selbsttest mit Oberfläche und Datenbank), prüft die Update-Datei und stellt den Installer als Download-Artefakt bereit.

### Erweiterung um den Kücheneinkauf (später)

1. Bereich `kueche` in der Tabelle `departments` aktivieren.
2. Kategorien und Lagerorte mit `department = 'kueche'` anlegen. Die API akzeptiert dafür bereits `?department=…`.
3. In der Oberfläche einen Bereichsumschalter ergänzen. Listen bekommen dann automatisch ein eigenes Nummernpräfix (z. B. `KU-00001`).
