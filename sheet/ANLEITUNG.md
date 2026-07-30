# Die Tabelle einrichten

Einmal pro Turnier, am Schreibtisch. Danach läuft der Turniertag nur noch über
das Rundenblatt am Handy.

---

## 1. Tabelle anlegen

Die Vorlage in Google Drive kopieren. Die Kopie braucht fünf Blätter, genau so
geschrieben:

| Blatt | Inhalt |
|---|---|
| `Config` | Einstellungen, Schlüssel in Spalte A, Wert in Spalte B |
| `Teams` | ein Team je Zeile |
| `Spielplan` | wird von der App geschrieben |
| `WEB` | wird von der App geschrieben |
| `Anleitung` | dieser Text |

## 2. `Config` ausfüllen

Keine Kopfzeile, einfach Schlüssel und Wert:

| A | B |
|---|---|
| `title` | Bonsai Cup 2027 |
| `start` | 09:00 |
| `courts` | 5 |
| `matchMin` | 10 |
| `semiMin` | 12 |
| `finalMode` | set |
| `walkover` | 2:0 |
| `token` | ein langes, ausgedachtes Kennwort |
| `endpoint` | kommt in Schritt 4 |

Pausen kommen als wiederholte Zeilen dazu, im Format
`nach Runde | Minuten | Text`:

| A | B |
|---|---|
| `break` | `6 \| 5 \| Platzpflege` |
| `break` | `12 \| 10 \| Reserveblock` |

Pausen hängen an **Runden**, nicht an Uhrzeiten. Eine Pause, die auf 11:00
festgenagelt ist, steht an der falschen Stelle, sobald das Turnier zehn Minuten
im Rückstand ist.

`finalMode` ist entweder `set` (offenes Ende, das Finale wird auf Sätze
gespielt) oder eine Zahl in Minuten.

## 3. `Teams` ausfüllen

Kopfzeile in Zeile 1, genau diese Namen:

| id | p1 | p2 | group | decider |
|---|---|---|---|---|
| T01 | Muster Anna | Muster Ben | | |
| T02 | Beispiel Cem | Beispiel Dana | | |

- `id` ist die Kennung, die nie wieder vergeben wird. Reihenfolge egal.
- `group` bleibt leer — die Auslosung füllt sie. Wer selbst einteilen will,
  schreibt `A` bis `D` hinein; was dort steht, wird nicht überschrieben.
- `decider` bleibt bei fast jedem Team leer. Sie ist der Handentscheid für den
  Fall, dass zwei Teams in Punkten, Differenz und Siegen gleich sind. Die
  höhere Zahl gewinnt.

Zwischen 16 und 32 Teams. Darunter werden die Gruppen zu klein, darüber wird
der Tag zu lang; die App weigert sich in beiden Fällen.

Eigene Spalten dürfen dazwischen. Die App sucht ihre Spalten am Namen in der
Kopfzeile, nicht an der Position.

## 4. Das Skript bereitstellen

Das Skript hängt an der Tabelle, wird also mitkopiert. Es muss nur einmal
freigeschaltet werden.

1. In der Tabelle: **Erweiterungen → Apps Script**.
2. Den Inhalt von `Code.gs` aus diesem Ordner hineinkopieren und speichern.
3. **Bereitstellen → Neue Bereitstellung**, Typ **Web-App**.
4. **Ausführen als: Ich**, **Zugriff: Jeder**.
5. Bereitstellen, den Google-Warnhinweis bestätigen.
6. Die angezeigte URL (endet auf `/exec`) kopieren und in `Config` beim
   Schlüssel `endpoint` eintragen.

**„Zugriff: Jeder“ ist nötig und nicht so schlimm, wie es klingt.** Das Handy
ruft die Adresse ohne Google-Konto auf, deshalb muss sie offen sein. Geschrieben
wird trotzdem nur mit dem richtigen `token`. Steht in `Config` kein `token`,
lehnt das Skript **jeden** Schreibversuch ab.

Nach jeder Änderung an `Code.gs`: **Bereitstellen → Bereitstellungen verwalten →
Bearbeiten → Neue Version**. Sonst läuft weiter der alte Stand.

## 5. Freigeben

Die Zuschauerseite liest nur das Blatt `WEB`. Dafür gibt es zwei Wege, und der
Unterschied ist wichtig:

**Empfohlen — nur `WEB` veröffentlichen.**
**Datei → Freigeben → Im Web veröffentlichen**, dort das Blatt `WEB` auswählen.
Dann bleibt `Config` privat, und damit auch das Kennwort.

**Bequemer, aber offen — die ganze Tabelle freigeben.**
**Freigeben → Jeder mit dem Link · Betrachter**. So findet das Rundenblatt die
Adresse des Skripts von selbst. Aber: wer den Link zur Tabelle hat, kann auch
`Config` lesen — und dort steht das Kennwort. Für ein Vereinsturnier ist das
meist zu verschmerzen; es sollte nur eine Entscheidung sein und kein Versehen.

Wird nur `WEB` veröffentlicht, fragt das Rundenblatt einmal nach der Adresse aus
`Config` und merkt sie sich auf dem Gerät.

## 6. Aufrufen

Alle fünf Dateien gehören in **denselben Ordner**:

```
index.html    round.html    engine.js    viewer.js    sheet.js
```

Es gibt keinen Build-Schritt — die Dateien werden so hochgeladen, wie sie sind.
Fehlt eine, sagen die Seiten das beim Öffnen.

| Wer | Adresse |
|---|---|
| Zuschauer | `…/index.html?id=TABELLEN-ID` |
| Turnierleitung | `…/round.html?id=TABELLEN-ID&k=KENNWORT` |

Die Tabellen-ID steht in der Adresszeile der Tabelle:
`docs.google.com/spreadsheets/d/`**`DIESE-ID`**`/edit`

Die Adresse für die Turnierleitung enthält das Kennwort im Klartext. Also nicht
in eine Gruppe schicken; auf dem eigenen Handy als Lesezeichen ablegen.

## 7. Am Turniertag

Das Rundenblatt schreibt bei jeder Eingabe:

- die Zeile des Spiels in `Spielplan`
- alle Zeilen, deren Teams sich dadurch klären („Sieger Viertelfinale 2“ wird
  zu einem Namen)
- das ganze Blatt `WEB` neu

Die Tabelle darf dabei offen bleiben und von Hand korrigiert werden. Eine
falsch getippte Zahl kann direkt in der Zelle geändert werden; das Rundenblatt
liest den Stand beim nächsten Laden wieder ein. Nur gleichzeitig sollten beide
nicht schreiben — sonst gewinnt, wer zuletzt speichert.

Oben im Rundenblatt steht, wie die Tabelle steht:

| Anzeige | Bedeutung |
|---|---|
| `gesichert 11:42` | alles in der Tabelle |
| `sichern …` | wird gerade geschrieben |
| `nicht gesichert` | die Eingabe liegt nur auf diesem Gerät — antippen sendet erneut |

**Eine Eingabe geht nicht verloren, wenn das Netz weg ist.** Sie wird zuerst auf
dem Gerät gespeichert und als ungesendet markiert. Das Rundenblatt sagt es so
lange, bis die Tabelle sie hat, und schickt sie beim nächsten Versuch mit.

## 8. Wenn etwas nicht geht

| Meldung | Ursache |
|---|---|
| „Falsches oder fehlendes Kennwort.“ | `k=` in der Adresse stimmt nicht mit `token` in `Config` überein |
| „In „Config“ steht kein Kennwort.“ | die Zeile `token` fehlt — es wird nichts geschrieben |
| „Die Tabelle antwortet mit einer Anmeldeseite.“ | die Bereitstellung steht auf „Nur ich“ statt „Jeder“ |
| „Das Blatt „Config“ ist nicht öffentlich lesbar.“ | normal, wenn nur `WEB` veröffentlicht ist — die Adresse einmal von Hand eintragen |
| „Das Blatt „…“ fehlt in dieser Tabelle.“ | ein Blatt wurde umbenannt oder gelöscht |
| Änderungen kommen nicht an | nach dem Ändern von `Code.gs` wurde keine **neue Version** bereitgestellt |
