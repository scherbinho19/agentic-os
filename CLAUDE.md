# Agentic OS, Fork scherbinho19: Regeln für Claude und Codex

Obsidian-Plugin, TypeScript, React 18, esbuild. Fork von `sebaskauf/agentic-os`, wird vom
Autor nicht mehr gepflegt, deshalb wird hier ausgebaut. Feature-Branches wie `3d-druck`,
Basis-Tag `upgrade-0.2.2-ok`. Der Ablauf für neue Features steht im Skill
`agentic-os-feature` unter `~/.claude/skills/`, diese Datei hält nur die Regeln, die im
Code selbst gebrochen würden.

## Bauen und prüfen

- `npm run build` ist `tsc -noEmit -skipLibCheck && node esbuild.config.mjs production`
  und schreibt `main.js`. `main.js` wird mit committet, Obsidian lädt es.
- Es gibt keine Testsuite und kein Lint. `npx tsc --noEmit` ist der einzige automatische
  Check. Jede nicht-triviale Logik braucht deshalb ein Review, bevor sie als fertig gilt.
- Render-Smoke ohne Obsidian: esbuild-Bundle mit `--external:react --external:react/jsx-runtime
  --external:react-dom --external:obsidian`, `global.window` stellen, `react-dom/server`.
- Sichtbar wird eine Änderung erst nach "Anwendung neu laden ohne zu speichern" in
  Obsidian. **Der Reload beendet alle Claude-Terminals im Drawer.** Vorher prüfen, ob dort
  etwas läuft, und mit Ben abstimmen.

## Sprache im Code

- Kommentare, Strings, Notices auf Deutsch mit echten Umlauten (ä ö ü ß). `ae/oe/ue/ss`
  als Ersatz ist verboten. Bezeichner bleiben ASCII (`druckLaeuft` ist ok, `kopf_geprüft`
  nicht). Keine Em-Dashes in neuem Text, der Pfeil `→` ist erlaubt.
- Vor jedem Commit den Diff greppen: `git diff --cached | grep -nE "^\+.*(ae|oe|ue|—)"`
  und jeden Treffer bewerten. Altlast in `src/main.ts:44-46` (`MUESSEN`, `zurueck`).

## React und Drawer

- Kein `StrictMode` im Baum (`src/view.tsx` rendert nackt). Updater laufen genau einmal.
  Wer das ändert, muss Seiteneffekte in Updatern (`alert` im Tab-Listener) mit umbauen.
- `dispatchSetState` führt einen Updater nur eager aus, wenn `fiber.lanes === NoLanes`.
  Ergebnisse eines Updaters nie direkt nach dem `setState`-Aufruf über ein Ref auslesen.
  Entscheidungen, die atomar sein müssen (Dedup, Limits), gehören in EINEN funktionalen
  Updater.
- `ChatDrawer` liest `chat-tabs.json` nur beim Mount und überschreibt sie bei jeder
  Änderung. Externe Tabs nie über die Datei anlegen, nur über das CustomEvent
  `agentic-os:open-project` mit `detail: { cwd, name }`. Der Listener dedupliziert über
  `realpathSync` (`~/Documents/Projects` ist ein Symlink auf `~/claude-projekte`).
- Nie in eine laufende Drawer-Session tippen, auch nicht per Computer-Use. Den cwd eines
  Terminals mit `lsof -a -p <pid> -d cwd` prüfen statt mit `pwd`.
- `runCommand` schickt Text ans aktive Terminal, dessen cwd ein Projektordner sein kann.
  `@`-Dateireferenzen deshalb absolut aus `vaultRoot()` bauen, nie relativ zum Vault.

## Domänen-Tabs

- Blaupausen: `src/loadDruck.ts` (Loader, Normalisierung, TTL, mtime-Watcher, CLI-Spawn,
  Revision-Warten), `src/DruckView.tsx` (Tab mit `aktionen`-Prop, Error Boundary),
  `src/DruckStatusZeile.tsx`, `src/App.tsx` (`druckCli`, `druckAktionen`).
- Das Plugin besitzt keine Vault-Daten. Es liest eine JSON-Datei und ruft für jede
  Änderung die Python-CLI im Vault auf (`spawn` ohne Shell, `DRUCK_VAULT` vorher aus der
  Umgebung löschen). Erfolg ist erst, wenn `revision` in der Datei die gemeldete
  Revision erreicht hat; `health` danach prüfen.
- Busy-Flag pro Aktionsgruppe als `useState` plus `useRef`-Eintrittsguard, synchron vor
  dem ersten `await` gesetzt. Ein abgewiesener Zweitaufruf darf das Flag nicht löschen.
- Felder innerhalb von Listen-Elementen werden vom Loader nicht normalisiert, in der View
  deshalb mit `typeof` guarden.
- Der rechte Bereich des Headers (`iconbtn` REFRESH) liegt bei normaler Fensterbreite
  außerhalb seines Containers und ist geclippt. Neue Knöpfe nicht dort platzieren.
- Styles nur mit eigenem Präfix (`druck-*`) in `styles.css`, gescoped unter
  `.agentic-os-root`. Bestehende Regeln nicht ändern.

## Git

- Commit-Messages englisch, Conventional Commits mit Scope (`feat(druck): ...`).
- `git commit --amend` nur, solange der zu korrigierende Commit HEAD ist. Liegt schon ein
  neuer Commit darauf, kommt ein eigener Fix-Commit.
- Nie zwei Implementierer parallel im selben Repo.
