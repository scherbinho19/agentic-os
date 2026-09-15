import * as React from "react";
import { fmtStunden, type ZeitMonatSumme, type ZeitWoche } from "./loadArbeitszeit";

/**
 * Zwei Grafiken für den Arbeitszeit-Tab, reines CSS. Die Daten kommen fertig aus
 * status.json, hier wird nur gezeichnet. Elemente der Listen sind laut loadArbeitszeit.ts
 * nur als Objekt geprüft, deshalb jedes Feld durch zahl() beziehungsweise typeof.
 */

function klemmen(n: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, n));
}

function zahl(n: unknown): number {
	return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

const MONATE_KURZ = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];

/** "2026-09" → "Sep 26". Alles andere unverändert zurück. */
export function monatKurz(m: unknown): string {
	if (typeof m !== "string" || m.length !== 7) return typeof m === "string" ? m : "?";
	const n = parseInt(m.slice(5, 7), 10);
	return Number.isInteger(n) && n >= 1 && n <= 12 ? `${MONATE_KURZ[n - 1]} ${m.slice(2, 4)}` : m;
}

export function StundenBalken({ wochen, schnitt }: { wochen: ZeitWoche[]; schnitt: number }): JSX.Element {
	const s0 = zahl(schnitt);
	const max = Math.max(1, s0, ...wochen.map((w) => zahl(w.stunden)));
	const linie = klemmen(Math.round((s0 / max) * 100), 0, 100);
	const letzte = wochen[wochen.length - 1];
	return (
		<div>
			<div className="zeit-vb">
				{s0 > 0 && <span className="zeit-vb-linie" style={{ bottom: `${linie}%` }} />}
				{wochen.map((w, i) => {
					const s = zahl(w.stunden);
					const h = klemmen(Math.round((s / max) * 100), 0, 100);
					const cls = "zeit-vb-bar" + (i === wochen.length - 1 ? " aktuell" : "") + (s === 0 ? " leer" : "");
					// Index im Key schützt vor doppelten jahr/kw in ungeprüften Daten; beim Wochenwechsel kostet das die Height-Transition, bewusst.
					return <div key={`${zahl(w.jahr)}-${zahl(w.kw)}-${i}`} className={cls} style={{ height: `${Math.max(h, s === 0 ? 30 : 2)}%` }} title={`KW ${zahl(w.kw)} (${typeof w.von === "string" ? w.von : "?"} bis ${typeof w.bis === "string" ? w.bis : "?"}): ${fmtStunden(s)} h`} />;
				})}
			</div>
			<div className="zeit-vb-labels mono">
				{wochen.map((w, i) => <span key={`${zahl(w.jahr)}-${zahl(w.kw)}-${i}`} style={{ color: i === wochen.length - 1 ? "var(--accent)" : undefined }}>{zahl(w.kw)}</span>)}
			</div>
			<div className="mono" style={{ fontSize: 9.5, color: "var(--dim)", marginTop: 4 }}>
				{wochen.length === 0 ? "keine Daten" : `schnitt ${fmtStunden(s0)} h · aktuelle woche ${fmtStunden(zahl(letzte?.stunden))} h`}
			</div>
		</div>
	);
}

export function MonatsBalken({ monate }: { monate: ZeitMonatSumme[] }): JSX.Element {
	// Höchstens zwölf Monate, sonst laufen die Labels über und beschriften den falschen Balken.
	const sichtbar = monate.slice(-12);
	const max = Math.max(1, ...sichtbar.map((m) => Math.max(zahl(m.ist), zahl(m.soll))));
	return (
		<div>
			<div className="zeit-vb">
				{sichtbar.map((m, i) => {
					const ist = zahl(m.ist), soll = zahl(m.soll);
					const h = klemmen(Math.round((ist / max) * 100), 0, 100);
					const sollPct = klemmen(Math.round((soll / max) * 100), 0, 100);
					const diff = ist - soll;
					return (
						<div key={`${typeof m.monat === "string" ? m.monat : "?"}-${i}`} className={"zeit-mb" + (i === sichtbar.length - 1 ? " aktuell" : "")} title={`${monatKurz(m.monat)}: ${fmtStunden(ist)} h von ${fmtStunden(soll, Number.isInteger(soll) ? 0 : 2)} h (${diff >= 0 ? "+" : ""}${fmtStunden(diff)} h)`}>
							<span className="zeit-mb-soll" style={{ bottom: `${sollPct}%` }} />
							<i className={ist >= soll ? "" : "fehl"} style={{ height: `${Math.max(h, 2)}%` }} />
						</div>
					);
				})}
			</div>
			<div className="zeit-vb-labels mono">
				{sichtbar.map((m, i) => <span key={`${typeof m.monat === "string" ? m.monat : "?"}-${i}`} style={{ color: i === sichtbar.length - 1 ? "var(--accent)" : undefined }}>{monatKurz(m.monat)}</span>)}
			</div>
			<div className="mono" style={{ fontSize: 9.5, color: "var(--dim)", marginTop: 4 }}>
				{sichtbar.length === 0 ? "keine Monate" : "gestrichelt: soll · dunkel: unter soll · letzter balken: laufender monat"}
			</div>
		</div>
	);
}
