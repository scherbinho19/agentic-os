import { accessSync, constants, existsSync, readFileSync, statSync } from "fs";
import { spawn } from "child_process";
import { join } from "path";
import { homeDir, spawnEnv, vaultRoot } from "./platform";

/**
 * Liest 3D-Druck/status.json, die einzige Datenquelle des 3D-Druck-Tabs.
 * Der Vertrag steht in <vault>/3D-Druck/status.schema.md. Python besitzt die Datei;
 * dieses Modul liest nur und pollt ihre mtime.
 */

export interface DruckMaterial { material: string; farbe: string; gramm?: number }

export interface DruckEreignis {
	task_id: string;
	zeitpunkt: string;
	status: "FINISH" | "FAILED";
	print_name: string;
	dauer_min: number;
	gesamt_g: number;
	projekt: string | null;
	quelle: "zuordnung" | "eindeutig" | "mehrdeutig" | "kein_name" | "offen";
	materialien: DruckMaterial[];
}

export interface DruckProjekt {
	zustand: string | null;
	stand: string;
	notiz: string;
	drucke: number;
	letzter_druck: string | null;
	gramm: number;
	wochen: number[];
	pfad: string;
}

export interface DruckLaufend {
	task_id: string | null;
	seit: string | null;
	laeuft_minuten: number | null;
	trays: string[];
	materialien: DruckMaterial[];
	projekt: null;
	projekt_hinweis: string;
	bestaetigt_am?: string;
	unbestaetigt?: boolean;
	uebernommen?: boolean;
	uebernommen_seit_minuten?: number;
}

export interface DruckBestand {
	material: string;
	farbe: string;
	menge: number;
	gewicht_g: number;
	knapp: boolean;
}

export interface DruckStatus {
	generated_at: string;
	revision: number;
	health: { status: "ok" | "stale" | "error"; grund: string; quellen: Record<string, string | null>; letzte_gebuchte_task: string | null };
	laufend: DruckLaufend | null;
	projekte: Record<string, DruckProjekt>;
	drucke: DruckEreignis[];
	bestand: DruckBestand[];
	slots: Record<string, unknown>;
	befunde: string[];
	serien: { wochen: Array<{ jahr: number; kw: number; gramm: number }>; quote: { fertig: number; fehlgeschlagen: number } };
	backlog: string[];
}

/** Ab diesem Alter gilt ein Stand als veraltet, egal was health sagt. launchd kommt alle 5 min. */
export const MAX_ALTER_MIN = 15;

export function druckStatusPfad(): string {
	const root = vaultRoot();
	return root.length > 0 ? join(root, "3D-Druck", "status.json") : "";
}

/**
 * Prüft und normalisiert ein rohes JSON-Objekt gegen den Vertrag. Getrennt von
 * loadDruckStatus, damit die Normalisierung ohne Dateisystem testbar ist.
 * Mutiert `raw` in place und gibt dieselbe Referenz zurück.
 */
export function normalisiereDruckStatus(raw: unknown): DruckStatus | null {
	if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
	const r = raw as Partial<DruckStatus> & Record<string, unknown>;
	if (typeof r.generated_at !== "string") return null;
	// projekte muss ein echtes Objekt sein, kein Array und kein null. Ohne diese
	// Grenze würde ein kaputtes JSON weiter unten unbemerkt durchrutschen.
	if (r.projekte === null || typeof r.projekte !== "object" || Array.isArray(r.projekte)) return null;

	// revision muss vergleichbar bleiben: der Vertrag erlaubt dem Plugin, auf
	// revision >= n zu warten. Ein ungültiger Wert würde jeden >=-Vergleich false
	// machen und das Plugin hängen lassen, statt auf eine kaputte Datei sichtbar zu reagieren.
	if (!Number.isSafeInteger(r.revision) || (r.revision as number) < 0) r.revision = 0;

	// Fehlt health oder ist der Zustand ungültig, reißt ein Throw in effektivHealth
	// sonst das gesamte Panel mit. Deshalb hier hart auf error normalisieren.
	const healthStatus = (r.health as { status?: unknown } | undefined)?.status;
	if (
		r.health === null ||
		typeof r.health !== "object" ||
		Array.isArray(r.health) ||
		(healthStatus !== "ok" && healthStatus !== "stale" && healthStatus !== "error")
	) {
		r.health = { status: "error", grund: "health fehlt oder ist ungültig in status.json", quellen: {}, letzte_gebuchte_task: null };
	}

	// Python liefert laut Vertrag alle Felder, aber ein von Hand editiertes oder halb geschriebenes
	// JSON nicht. Der Cast zu DruckStatus darf keine Lüge sein, also werden Listen hier aufgefüllt;
	// die View verlässt sich auf den Typ. projekte wird bewusst NICHT aufgefüllt, siehe oben.
	// Ein Array allein reicht nicht: Codex-Review fand `bestand: [null]`, das an der
	// Lesestelle (b.knapp) wirft. Deshalb zusätzlich jedes Element filtern, nicht nur
	// den Container. Objektlisten behalten nur echte Objekte, Stringlisten nur Strings.
	const objektListe = <T>(v: unknown): T[] =>
		Array.isArray(v) ? (v.filter((x) => typeof x === "object" && x !== null && !Array.isArray(x)) as T[]) : [];
	const stringListe = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
	r.drucke = objektListe<DruckEreignis>(r.drucke);
	r.bestand = objektListe<DruckBestand>(r.bestand);
	r.befunde = stringListe(r.befunde);
	r.backlog = stringListe(r.backlog);
	const serien = r.serien as { wochen?: unknown; quote?: unknown } | undefined;
	const q = serien?.quote as { fertig?: unknown; fehlgeschlagen?: unknown } | undefined;
	const quote =
		q !== null && typeof q === "object" && Number.isFinite(q?.fertig) && Number.isFinite(q?.fehlgeschlagen)
			? (q as { fertig: number; fehlgeschlagen: number })
			: { fertig: 0, fehlgeschlagen: 0 };
	r.serien = { wochen: objektListe<{ jahr: number; kw: number; gramm: number }>(serien?.wochen), quote };
	if (r.laufend !== null && r.laufend !== undefined && typeof r.laufend === "object" && !Array.isArray(r.laufend)) {
		const l = r.laufend as DruckLaufend & Record<string, unknown>;
		l.materialien = objektListe<DruckMaterial>(l.materialien);
		l.trays = stringListe(l.trays);
		r.laufend = l;
	} else {
		r.laufend = null;
	}
	r.slots ??= {};

	return r as DruckStatus;
}

export function loadDruckStatus(): DruckStatus | null {
	const p = druckStatusPfad();
	if (p.length === 0 || !existsSync(p)) return null;
	try {
		const raw = JSON.parse(readFileSync(p, "utf-8"));
		return normalisiereDruckStatus(raw);
	} catch (e) {
		console.error("[agentic-os] status.json unlesbar:", e);
		return null;
	}
}

/** Toleranz für einen generated_at-Zeitstempel in der Zukunft, in Minuten. */
export const UHR_TOLERANZ_MIN = 5;

/**
 * Alter von generated_at in Minuten, oder null wenn unlesbar oder wenn der Stand
 * mehr als UHR_TOLERANZ_MIN Minuten in der Zukunft liegt. Python und Plugin laufen
 * auf derselben Uhr; mehr als fünf Minuten Vorsprung sind ein Uhr-Sprung oder eine
 * Handänderung, kein frischer Stand.
 */
export function alterMinuten(status: DruckStatus | null): number | null {
	if (status === null) return null;
	const t = new Date(status.generated_at).getTime();
	if (!isFinite(t)) return null;
	const diffMin = (Date.now() - t) / 60000;
	if (diffMin < -UHR_TOLERANZ_MIN) return null;
	return Math.max(0, Math.floor(diffMin));
}

/**
 * Python kann nicht wissen, ob launchd noch lebt. Ein Snapshot mit health ok, dessen
 * Erzeuger vor einer Stunde gestorben ist, bliebe sonst ewig plausibel.
 */
export function istVeraltet(status: DruckStatus | null): boolean {
	const a = alterMinuten(status);
	return a === null || a >= MAX_ALTER_MIN;
}

/** Effektiver Zustand für die Anzeige: veraltet schlägt ok. */
export function effektivHealth(status: DruckStatus | null): "ok" | "stale" | "error" | "fehlt" {
	if (status === null) return "fehlt";
	if (status.health.status === "error") return "error";
	if (istVeraltet(status)) return "stale";
	return status.health.status;
}

/**
 * Pollt die mtime alle 5 s. Kein fs.watch: os.replace wechselt die Inode, und ein
 * Watcher auf dem alten Handle sieht nichts mehr. Ruft cb auch, wenn nur die
 * Veraltet-Grenze kippt, damit ein AUSBLEIBENDER Lauf sichtbar wird.
 * Gibt die Stop-Funktion zurück.
 */
export function watchDruckStatus(cb: (s: DruckStatus | null) => void, intervalMs = 5000): () => void {
	let lastMtime = -1;
	let lastVeraltet: boolean | null = null;
	const tick = (): void => {
		const p = druckStatusPfad();
		let mtime = -1;
		try { if (p.length > 0 && existsSync(p)) mtime = statSync(p).mtimeMs; } catch (_) { /* fehlt */ }
		const s = mtime >= 0 ? loadDruckStatus() : null;
		const veraltet = istVeraltet(s);
		if (mtime !== lastMtime || veraltet !== lastVeraltet) {
			lastMtime = mtime;
			lastVeraltet = veraltet;
			cb(s);
		}
	};
	tick();
	const id = window.setInterval(tick, intervalMs);
	return () => window.clearInterval(id);
}

/**
 * Der Interpreter mit Festplattenvollzugriff. Nie ein Tilde-String: child_process.spawn
 * startet keine Shell und expandiert ~ nicht. Der aufgelöste Pfad steht in jeder Meldung.
 */
export function pythonPfad(): { pfad: string; ok: boolean } {
	const pfad = join(homeDir, ".local", "bin", "python3.12");
	try {
		accessSync(pfad, constants.X_OK);
		return { pfad, ok: true };
	} catch (_) {
		return { pfad, ok: false };
	}
}

export function druckSkriptPfad(): string {
	const root = vaultRoot();
	return root.length > 0 ? join(root, "scripts", "druck_status.py") : "";
}

let cliInFlight = false;
export function cliLaeuft(): boolean { return cliInFlight; }

/**
 * Spawnt die Python-CLI. Erfolg: Revision aus stdout. Fehler: letzte stderr-Zeile.
 * Reentrancy-geschützt wie pullBriefings: ein zweiter Aufruf während eines laufenden
 * wird abgewiesen, nicht gestapelt. Timeout 30 s.
 * close wartet auf alle stdio-Streams. Die CLI darf keinen Enkelprozess mit geerbtem
 * stdout hinterlassen (druck_status.py nutzt capture_output), sonst läuft jeder Klick
 * in die Zeitüberschreitung.
 * Beim Plugin-Unload wird bewusst nicht gekillt: eine halb ausgeführte Mutation
 * abzuschießen wäre schlechter, Lock und os.replace decken den Fall ab.
 */
export function runDruckCli(args: string[]): Promise<{ ok: boolean; revision?: number; error?: string }> {
	return new Promise((resolve) => {
		if (cliInFlight) { resolve({ ok: false, error: "Es läuft schon ein Befehl." }); return; }
		const py = pythonPfad();
		if (!py.ok) { resolve({ ok: false, error: `Python fehlt oder ist nicht ausführbar: ${py.pfad}` }); return; }
		const skript = druckSkriptPfad();
		if (skript.length === 0 || !existsSync(skript)) { resolve({ ok: false, error: `Skript fehlt: ${skript || "(kein Vault)"}` }); return; }

		cliInFlight = true;
		let out = "", err = "", settled = false;
		const finish = (r: { ok: boolean; revision?: number; error?: string }): void => {
			if (settled) return;
			settled = true;
			cliInFlight = false;
			resolve(r);
		};
		let child: ReturnType<typeof spawn>;
		try {
			// DRUCK_VAULT ist der Test-Seam der Python-Skripte; geerbt würde Python still
			// in einen fremden Vault schreiben, während das Plugin den echten liest.
			const env = spawnEnv();
			delete env.DRUCK_VAULT;
			child = spawn(py.pfad, [skript, ...args], { env, windowsHide: true });
		} catch (e) {
			finish({ ok: false, error: String(e) });
			return;
		}
		const killTimer = setTimeout(() => { try { child.kill(); } catch (_) { /* */ } finish({ ok: false, error: "Zeitüberschreitung nach 30 s, der Stand folgt spätestens mit dem nächsten Lauf." }); }, 30000);
		child.stdout?.on("data", (c: Buffer) => { out += c.toString(); });
		child.stderr?.on("data", (c: Buffer) => { err += c.toString(); });
		child.on("error", (e) => { clearTimeout(killTimer); finish({ ok: false, error: String(e) }); });
		child.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
			clearTimeout(killTimer);
			if (code === 0) {
				// Erfolg ohne Zahl auf stdout: die Pipe wurde vom Plugin vorher geschlossen
				// (Vertrag im Schema). Dann gilt kein Fehler, nur keine Revision zum Warten.
				const rev = parseInt(out.trim(), 10);
				finish(Number.isSafeInteger(rev) ? { ok: true, revision: rev } : { ok: true });
			} else {
				finish({ ok: false, error: (err.split("\n").filter((l) => l.trim() !== "").pop() ?? `Exit ${code ?? signal ?? "?"}`).trim() });
			}
		});
	});
}

/**
 * Pollt status.json, bis revision >= n. Damit ist ein Klick erst fertig, wenn der Stand ihn
 * enthält. Der Aufrufer prüft danach health. Beim Timeout wird der letzte gelesene Stand
 * zurückgegeben, auch wenn er die Revision nicht erreicht.
 */
export function warteAufRevision(n: number, timeoutMs = 10000): Promise<DruckStatus | null> {
	return new Promise((resolve) => {
		const t0 = Date.now();
		const tick = (): void => {
			const s = loadDruckStatus();
			if (s !== null && s.revision >= n) { resolve(s); return; }
			if (Date.now() - t0 > timeoutMs) { resolve(s); return; }
			window.setTimeout(tick, 250);
		};
		tick();
	});
}
