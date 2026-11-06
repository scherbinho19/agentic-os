import * as React from "react";
import { useState } from "react";
import type { DruckWartung, DruckWartungsAufgabe } from "./loadDruck";

/**
 * Wartungsblock im Tab [03] 3D-DRUCK, direkt unter den Kennzahlen. Rechnet nichts:
 * Zustand, Resttext, Anteil und Reihenfolge kommen fertig aus status.json
 * (scripts/druck_wartung.py). Die Elemente von wartung.aufgaben normalisiert der Loader
 * nur als Objekte, jedes Feld wird hier deshalb mit typeof geprüft.
 */

/** Gleiche Muster wie in druck_wartung.py. App.tsx prüft damit vor jedem Spawn. */
export const WARTUNG_ID = /^[a-z0-9][a-z0-9-]*$/;
export const DATUM_ISO = /^\d{4}-\d{2}-\d{2}$/;

export interface WartungsAktionen {
	gewartet: (id: string, datum?: string) => Promise<void>;
	gewartetZurueck: (id: string) => Promise<void>;
	laeuft: boolean;
}

type Zustand = DruckWartungsAufgabe["zustand"];
const DRINGEND: ReadonlySet<string> = new Set(["faellig", "nie", "bald"]);
const BEKANNT: ReadonlySet<string> = new Set(["faellig", "nie", "bald", "ok", "bedarf"]);
const ZEICHEN: Record<Zustand, string> = { faellig: "●", nie: "●", bald: "◐", ok: "○", bedarf: "·" };

function text(v: unknown): string {
	return typeof v === "string" ? v : "";
}

function zustandVon(a: DruckWartungsAufgabe): Zustand {
	// Ein unbekannter Zustand kommt nur aus einer von Hand editierten Datei. Er wird still
	// als ok einsortiert statt als fällig zu alarmieren.
	return typeof a.zustand === "string" && BEKANNT.has(a.zustand) ? a.zustand : "ok";
}

/** Heute als YYYY-MM-DD in Ortszeit. toISOString wäre UTC und kippt nach Mitternacht. */
function heuteIso(): string {
	const d = new Date();
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function farbe(z: Zustand): string {
	if (z === "faellig" || z === "nie") return "var(--accent)";
	if (z === "bald") return "#e0b341";
	return "var(--dim)";
}

function Zeile({ a, aktionen }: { a: DruckWartungsAufgabe; aktionen?: WartungsAktionen }): JSX.Element {
	const [nachtrag, setNachtrag] = useState<boolean>(false);
	const [datum, setDatum] = useState<string>("");
	const z = zustandVon(a);
	const id = text(a.id);
	// Nur mit gültiger ID gibt es Knöpfe. App.tsx prüft vor dem Spawn noch einmal.
	const ak = WARTUNG_ID.test(id) ? aktionen : undefined;
	const anleitung = text(a.anleitung);
	const anteil = typeof a.anteil === "number" && Number.isFinite(a.anteil) ? Math.max(0, Math.min(1, a.anteil)) : null;
	const heute = heuteIso();
	const datumOk = DATUM_ISO.test(datum) && datum <= heute;
	const titel = [text(a.seit), text(a.notiz)].filter((s) => s !== "").join(" · ");
	return (
		<div className="druck-row" style={{ cursor: "default", flexDirection: "column", alignItems: "stretch", gap: 4 }}>
			<div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
				<span style={{ color: farbe(z), fontSize: 10, flex: "0 0 10px" }}>{ZEICHEN[z]}</span>
				<span className="mono" style={{ fontSize: 9.5, color: "var(--dim)", flex: "0 0 74px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{text(a.bereich)}</span>
				<span title={text(a.hinweis)} style={{ flex: 1, minWidth: 0, fontSize: 11.5, color: "#f5f5f5", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{text(a.aufgabe)}</span>
				<span className="mono" style={{ fontSize: 10, color: farbe(z), whiteSpace: "nowrap" }}>{text(a.rest)}</span>
			</div>
			<div style={{ display: "flex", alignItems: "center", gap: 8, paddingLeft: 18, flexWrap: "wrap" }}>
				{anteil !== null && (
					<div className="hatch" style={{ position: "relative", width: 90, height: 6, borderRadius: 2, border: "1px solid #232323", overflow: "hidden" }}>
						<div className="burn-fill" style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${anteil * 100}%` }} />
					</div>
				)}
				<span className="mono" title={titel} style={{ flex: 1, minWidth: 120, fontSize: 9.5, color: "var(--dim)" }}>
					{text(a.intervall)} · zuletzt {text(a.zuletzt) || "-"}
				</span>
				{ak !== undefined && (
					<>
						<button className="druck-btn" disabled={ak.laeuft} onClick={() => void ak.gewartet(id)}>✓ erledigt</button>
						<button className="druck-btn" disabled={ak.laeuft} title="früheres Datum eintragen" onClick={() => setNachtrag((v) => !v)}>📅</button>
						{a.rueckgaengig === true && <button className="druck-btn" disabled={ak.laeuft} onClick={() => void ak.gewartetZurueck(id)}>↶ rückgängig</button>}
					</>
				)}
				{anleitung.startsWith("https://") && <a className="druck-btn" href={anleitung} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none" }}>anleitung ↗</a>}
			</div>
			{nachtrag && ak !== undefined && (
				<div style={{ display: "flex", alignItems: "center", gap: 6, paddingLeft: 18 }}>
					<input type="date" className="druck-select" max={heute} value={datum} onChange={(e) => setDatum(e.target.value)} />
					<button className="druck-btn" disabled={ak.laeuft || !datumOk} onClick={() => { setNachtrag(false); void ak.gewartet(id, datum); }}>eintragen</button>
				</div>
			)}
		</div>
	);
}

function Umschalter({ offen, titel, onClick }: { offen: boolean; titel: string; onClick: () => void }): JSX.Element {
	return (
		<div style={{ display: "flex", alignItems: "center", cursor: "pointer", marginTop: 8 }} onClick={onClick}>
			<span className="mono small-caps" style={{ color: "var(--dim)", fontSize: 10, letterSpacing: ".12em" }}>{titel}</span>
			<span style={{ flex: 1 }} />
			<span className="mono small-caps" style={{ color: "var(--accent)", fontSize: 10 }}>{offen ? "▴ einklappen" : "aufklappen ▸"}</span>
		</div>
	);
}

export function WartungsBlock({ wartung, aktionen }: { wartung: DruckWartung; aktionen?: WartungsAktionen }): JSX.Element {
	const [okOffen, setOkOffen] = useState<boolean>(false);
	const [bedarfOffen, setBedarfOffen] = useState<boolean>(false);
	const alle = wartung.aufgaben;
	// Frisch eingetragene Aufgaben bleiben oben sichtbar. Sonst verschwände der
	// Rückgängig-Knopf mit dem Klick in der eingeklappten Liste.
	const sichtbar = alle.filter((a) => DRINGEND.has(zustandVon(a)) || a.rueckgaengig === true);
	const ok = alle.filter((a) => zustandVon(a) === "ok" && a.rueckgaengig !== true);
	const bedarf = alle.filter((a) => zustandVon(a) === "bedarf" && a.rueckgaengig !== true);
	const schluessel = (a: DruckWartungsAufgabe, i: number): string => (text(a.id) !== "" ? text(a.id) : `#${i}`);
	const kopf = wartung.faellig > 0 || wartung.bald > 0
		? `▲ wartung · ${wartung.faellig} fällig · ${wartung.bald} bald`
		: alle.length > 0 ? "✓ wartung · nichts fällig" : "wartung · kein plan";
	return (
		<div className="featured" style={{ margin: "10px 18px 0", padding: "12px 14px" }}>
			<div style={{ display: "flex", alignItems: "center", marginBottom: sichtbar.length > 0 ? 6 : 0 }}>
				<span className="ctitle" style={{ color: wartung.faellig > 0 ? "var(--accent)" : undefined }}>{kopf}</span>
				<span style={{ flex: 1 }} />
				<span className="mono" style={{ fontSize: 9.5, color: "var(--dim)" }}>plan: 3D-Druck/Wartungsplan.md</span>
			</div>
			{sichtbar.map((a, i) => <Zeile key={schluessel(a, i)} a={a} aktionen={aktionen} />)}
			{ok.length > 0 && <Umschalter offen={okOffen} titel={`${ok.length} im plan, nicht fällig`} onClick={() => setOkOffen((v) => !v)} />}
			{okOffen && ok.map((a, i) => <Zeile key={schluessel(a, i)} a={a} aktionen={aktionen} />)}
			{bedarf.length > 0 && <Umschalter offen={bedarfOffen} titel={`bei bedarf · ${bedarf.length}`} onClick={() => setBedarfOffen((v) => !v)} />}
			{bedarfOffen && bedarf.map((a, i) => <Zeile key={schluessel(a, i)} a={a} aktionen={aktionen} />)}
			{wartung.befunde.length > 0 && (
				<div style={{ marginTop: 8 }}>
					<span className="ctitle" style={{ color: "var(--accent)" }}>befunde in Wartungsplan.md oder wartung.json</span>
					{wartung.befunde.map((b, i) => <div key={i} className="mono" style={{ fontSize: 10.5, color: "var(--text)", marginTop: 4 }}>{b}</div>)}
				</div>
			)}
		</div>
	);
}
