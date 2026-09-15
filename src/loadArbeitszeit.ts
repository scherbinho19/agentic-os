import { existsSync, readFileSync, statSync } from "fs";
import { spawn } from "child_process";
import { join } from "path";
import { spawnEnv, vaultRoot } from "./platform";
import { MAX_ALTER_MIN, UHR_TOLERANZ_MIN, pythonPfad } from "./loadDruck";

/**
 * Liest Arbeitszeit/status.json, die einzige Datenquelle des Arbeitszeit-Tabs.
 * Der Vertrag steht in <vault>/Arbeitszeit/status.schema.md. Python besitzt die Datei;
 * dieses Modul liest nur und pollt ihre mtime. Mechanik wie loadDruck.ts. Die Alters-
 * und Health-Helfer sind hier typisiert wiederholt, weil die Druck-Varianten einen
 * DruckStatus verlangen.
 */

export type ZeitArt = "arbeit" | "urlaub" | "krank";
export type ZeitZustand = "nichts" | "laeuft" | "pause" | "fertig" | "abwesend";
export type StempelAktion = "start" | "pause" | "weiter" | "ende";
const ZUSTAENDE: ReadonlySet<string> = new Set(["nichts", "laeuft", "pause", "fertig", "abwesend"]);

export interface ZeitTag {
	datum: string;
	wochentag: string;
	art: ZeitArt | null;
	start: string | null;
	pause_start: string | null;
	pause_ende: string | null;
	ende: string | null;
	stunden: number;
	offen: boolean;
}

export interface ZeitWoche { jahr: number; kw: number; von: string; bis: string; stunden: number }
export interface ZeitMonatSumme { monat: string; ist: number; soll: number }

export interface ZeitStatus {
	generated_at: string;
	revision: number;
	health: { status: "ok" | "stale" | "error"; grund: string; quellen: Record<string, unknown> };
	heute: {
		datum: string;
		zustand: ZeitZustand;
		art: ZeitArt | null;
		start: string | null;
		pause_start: string | null;
		pause_ende: string | null;
		ende: string | null;
		stunden: number | null;
	};
	monat: {
		monat: string;
		ist: number;
		soll: number;
		rest: number;
		ueberstunden: number;
		arbeitstage_verbleibend: number;
		stunden_pro_tag_noetig: number | null;
		knapp: boolean;
		tage: ZeitTag[];
	};
	wochen: ZeitWoche[];
	wochen_schnitt: number;
	saldo: { stunden: number; monate: ZeitMonatSumme[] };
	urlaub: { jahr: number; anspruch: number; genommen: number; rest: number; krank_tage: number };
	unvollstaendig: string[];
	befunde: string[];
}

export function zeitStatusPfad(): string {
	const root = vaultRoot();
	return root.length > 0 ? join(root, "Arbeitszeit", "status.json") : "";
}

/** Stunden als deutsche Dezimalzahl, robust gegen kaputte Werte. */
export function fmtStunden(n: unknown, stellen = 2): string {
	return (typeof n === "number" && Number.isFinite(n) ? n : 0).toFixed(stellen).replace(".", ",");
}

const zahl = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const zahlOderNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const text = (v: unknown): string | null => (typeof v === "string" ? v : null);
const objekt = (v: unknown): Record<string, unknown> | null =>
	v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
// Codex-Befund aus dem Druck-Tab: [null] in einer Liste wirft an der Lesestelle. Deshalb
// jedes Element filtern, nicht nur den Container.
const objektListe = <T>(v: unknown): T[] =>
	Array.isArray(v) ? (v.filter((x) => x !== null && typeof x === "object" && !Array.isArray(x)) as T[]) : [];
const stringListe = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const artOderNull = (v: unknown): ZeitArt | null => (v === "arbeit" || v === "urlaub" || v === "krank" ? v : null);

/**
 * Prüft und normalisiert ein rohes JSON-Objekt gegen den Vertrag. Oberste Ebene und die
 * Objekte heute, monat, saldo, urlaub werden vollständig normalisiert. Elemente in
 * monat.tage, wochen und saldo.monate nur als Objekt geprüft; ihre Felder guardet die View.
 * Mutiert `raw` in place und gibt dieselbe Referenz zurück.
 */
export function normalisiereZeitStatus(raw: unknown): ZeitStatus | null {
	// Bewusst enger als loadDruck.ts: ohne Record<string, unknown>, damit Tippfehler in Feldnamen zur Compile-Zeit auffallen.
	const r = objekt(raw) as Partial<ZeitStatus> | null;
	if (r === null || typeof r.generated_at !== "string") return null;
	// Ohne monat gibt es nichts anzuzeigen. Wie projekte beim Druck: hart null statt leerer Kulisse.
	const m = objekt(r.monat);
	if (m === null) return null;

	// revision muss vergleichbar bleiben, sonst hängt warteAufZeitRevision an einem >=-Vergleich.
	if (!Number.isSafeInteger(r.revision) || (r.revision as number) < 0) r.revision = 0;

	const h = objekt(r.health);
	const hs = h?.status;
	r.health = h !== null && (hs === "ok" || hs === "stale" || hs === "error")
		? { status: hs, grund: typeof h.grund === "string" ? h.grund : "", quellen: objekt(h.quellen) ?? {} }
		: { status: "error", grund: "health fehlt oder ist ungültig in status.json", quellen: {} };

	const he = objekt(r.heute) ?? {};
	const z = he.zustand;
	r.heute = {
		datum: text(he.datum) ?? "",
		zustand: typeof z === "string" && ZUSTAENDE.has(z) ? (z as ZeitZustand) : "nichts",
		art: artOderNull(he.art),
		start: text(he.start), pause_start: text(he.pause_start), pause_ende: text(he.pause_ende), ende: text(he.ende),
		stunden: zahlOderNull(he.stunden),
	};
	r.monat = {
		monat: text(m.monat) ?? "",
		ist: zahl(m.ist), soll: zahl(m.soll), rest: zahl(m.rest), ueberstunden: zahl(m.ueberstunden),
		arbeitstage_verbleibend: zahl(m.arbeitstage_verbleibend),
		stunden_pro_tag_noetig: zahlOderNull(m.stunden_pro_tag_noetig),
		knapp: m.knapp === true,
		tage: objektListe<ZeitTag>(m.tage),
	};
	r.wochen = objektListe<ZeitWoche>(r.wochen);
	r.wochen_schnitt = zahl(r.wochen_schnitt);
	const s = objekt(r.saldo) ?? {};
	r.saldo = { stunden: zahl(s.stunden), monate: objektListe<ZeitMonatSumme>(s.monate) };
	const u = objekt(r.urlaub) ?? {};
	r.urlaub = { jahr: zahl(u.jahr), anspruch: zahl(u.anspruch), genommen: zahl(u.genommen), rest: zahl(u.rest), krank_tage: zahl(u.krank_tage) };
	r.unvollstaendig = stringListe(r.unvollstaendig);
	r.befunde = stringListe(r.befunde);
	return r as ZeitStatus;
}

export function loadZeitStatus(): ZeitStatus | null {
	const p = zeitStatusPfad();
	if (p.length === 0 || !existsSync(p)) return null;
	try {
		return normalisiereZeitStatus(JSON.parse(readFileSync(p, "utf-8")));
	} catch (e) {
		console.error("[agentic-os] Arbeitszeit/status.json unlesbar:", e);
		return null;
	}
}

/** Alter von generated_at in Minuten, null wenn unlesbar oder zu weit in der Zukunft. */
export function zeitAlterMinuten(status: ZeitStatus | null): number | null {
	if (status === null) return null;
	const t = new Date(status.generated_at).getTime();
	if (!isFinite(t)) return null;
	const diffMin = (Date.now() - t) / 60000;
	if (diffMin < -UHR_TOLERANZ_MIN) return null;
	return Math.max(0, Math.floor(diffMin));
}

export function zeitVeraltet(status: ZeitStatus | null): boolean {
	const a = zeitAlterMinuten(status);
	return a === null || a >= MAX_ALTER_MIN;
}

/** Effektiver Zustand für die Anzeige: veraltet schlägt ok. */
export function zeitHealth(status: ZeitStatus | null): "ok" | "stale" | "error" | "fehlt" {
	if (status === null) return "fehlt";
	if (status.health.status === "error") return "error";
	if (zeitVeraltet(status)) return "stale";
	return status.health.status;
}

/** Pollt die mtime alle 5 s, kein fs.watch (os.replace wechselt die Inode). Gibt die Stop-Funktion zurück. */
export function watchZeitStatus(cb: (s: ZeitStatus | null) => void, intervalMs = 5000): () => void {
	let lastMtime = -1;
	let lastVeraltet: boolean | null = null;
	const tick = (): void => {
		const p = zeitStatusPfad();
		let mtime = -1;
		try { if (p.length > 0 && existsSync(p)) mtime = statSync(p).mtimeMs; } catch (_) { /* fehlt */ }
		const s = mtime >= 0 ? loadZeitStatus() : null;
		const veraltet = zeitVeraltet(s);
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

export function zeitSkriptPfad(): string {
	const root = vaultRoot();
	return root.length > 0 ? join(root, "scripts", "arbeitszeit.py") : "";
}

let cliInFlight = false;

/**
 * Spawnt die Python-CLI. Erfolg: stdout (Revision, bei --export der Pfad). Fehler: letzte
 * stderr-Zeile. Reentrancy-geschützt, Timeout 30 s. Eigenes Flag, unabhängig vom Druck-Tab:
 * beide Bereiche haben eigene Locks und dürfen parallel laufen.
 */
export function runZeitCli(args: string[]): Promise<{ ok: boolean; stdout: string; error?: string }> {
	return new Promise((resolve) => {
		if (cliInFlight) { resolve({ ok: false, stdout: "", error: "Es läuft schon ein Befehl." }); return; }
		const py = pythonPfad();
		if (!py.ok) { resolve({ ok: false, stdout: "", error: `Python fehlt oder ist nicht ausführbar: ${py.pfad}` }); return; }
		const skript = zeitSkriptPfad();
		if (skript.length === 0 || !existsSync(skript)) { resolve({ ok: false, stdout: "", error: `Skript fehlt: ${skript || "(kein Vault)"}` }); return; }

		cliInFlight = true;
		let out = "", err = "", settled = false;
		const finish = (r: { ok: boolean; stdout: string; error?: string }): void => {
			if (settled) return;
			settled = true;
			cliInFlight = false;
			resolve(r);
		};
		let child: ReturnType<typeof spawn>;
		try {
			// Test-Seams der Python-Skripte. Geerbt würde Python still in einen fremden Vault schreiben.
			const env = spawnEnv();
			delete env.ARBEITSZEIT_VAULT;
			delete env.DRUCK_VAULT;
			child = spawn(py.pfad, [skript, ...args], { env, windowsHide: true });
		} catch (e) {
			finish({ ok: false, stdout: "", error: String(e) });
			return;
		}
		const killTimer = setTimeout(() => {
			try { child.kill(); } catch (_) { /* */ }
			finish({ ok: false, stdout: "", error: "Zeitüberschreitung nach 30 s, der Stand folgt spätestens mit dem nächsten Lauf." });
		}, 30000);
		// setEncoding puffert Mehrbyte-Sequenzen über Chunk-Grenzen, sonst zerfällt ein ü in der Fehlermeldung.
		child.stdout?.setEncoding("utf8");
		child.stderr?.setEncoding("utf8");
		child.stdout?.on("data", (c: string) => { out += c; });
		child.stderr?.on("data", (c: string) => { err += c; });
		child.on("error", (e) => { clearTimeout(killTimer); finish({ ok: false, stdout: "", error: String(e) }); });
		child.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
			clearTimeout(killTimer);
			if (code === 0) finish({ ok: true, stdout: out });
			else finish({ ok: false, stdout: out, error: (err.split("\n").filter((l) => l.trim() !== "").pop() ?? `Exit ${code ?? signal ?? "?"}`).trim() });
		});
	});
}

/** Revision aus der CLI-Ausgabe, undefined wenn keine Zahl kam (Pipe vorher geschlossen). */
export function zeitRevision(stdout: string): number | undefined {
	const n = parseInt(stdout.trim(), 10);
	return Number.isSafeInteger(n) ? n : undefined;
}

/** Pollt status.json, bis revision >= n. Beim Timeout den letzten Stand zurückgeben. */
export function warteAufZeitRevision(n: number, timeoutMs = 10000): Promise<ZeitStatus | null> {
	return new Promise((resolve) => {
		const t0 = Date.now();
		const tick = (): void => {
			const s = loadZeitStatus();
			if (s !== null && s.revision >= n) { resolve(s); return; }
			if (Date.now() - t0 > timeoutMs) { resolve(s); return; }
			window.setTimeout(tick, 250);
		};
		tick();
	});
}
