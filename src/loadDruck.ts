import { existsSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { vaultRoot } from "./platform";

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
	const liste = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
	r.drucke = liste<DruckEreignis>(r.drucke);
	r.bestand = liste<DruckBestand>(r.bestand);
	r.befunde = liste<string>(r.befunde);
	r.backlog = liste<string>(r.backlog);
	const serien = r.serien as { wochen?: unknown; quote?: unknown } | undefined;
	const q = serien?.quote as { fertig?: unknown; fehlgeschlagen?: unknown } | undefined;
	const quote =
		q !== null && typeof q === "object" && Number.isFinite(q?.fertig) && Number.isFinite(q?.fehlgeschlagen)
			? (q as { fertig: number; fehlgeschlagen: number })
			: { fertig: 0, fehlgeschlagen: 0 };
	r.serien = { wochen: liste<{ jahr: number; kw: number; gramm: number }>(serien?.wochen), quote };
	if (r.laufend !== null && r.laufend !== undefined && typeof r.laufend === "object" && !Array.isArray(r.laufend)) {
		const l = r.laufend as DruckLaufend & Record<string, unknown>;
		l.materialien = liste<DruckMaterial>(l.materialien);
		l.trays = liste<string>(l.trays);
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

/** Alter von generated_at in Minuten, oder null wenn unlesbar. */
export function alterMinuten(status: DruckStatus | null): number | null {
	if (status === null) return null;
	const t = new Date(status.generated_at).getTime();
	if (!isFinite(t)) return null;
	return Math.max(0, Math.floor((Date.now() - t) / 60000));
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
