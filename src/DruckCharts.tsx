import * as React from "react";
import type { DruckBestand, DruckStatus } from "./loadDruck";

/**
 * Vier Grafiken für den 3D-Druck-Tab, reines CSS und inline SVG. Farben nur über
 * die Variablen des OS. Die Daten kommen fertig aus status.json, hier wird nur
 * gezeichnet, nicht gerechnet.
 */

// Erwartet finiten Input. Die Aufrufer normalisieren vorher mit zahl(), das
// klemmt hier keinen Sonderfall mehr ab (sonst kippt Infinity fälschlich auf min
// statt auf max).
function klemmen(n: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, n));
}

// Math.max(1, ...arr) kippt auf NaN, sobald ein einziges Element NaN ist (JS-Falle).
// zahl() fängt kaputte Einzelwerte ab, bevor sie in Text oder eine weitere
// Rechnung durchsickern.
function zahl(n: number): number {
	return Number.isFinite(n) ? n : 0;
}

export function WochenBalken({ wochen }: { wochen: DruckStatus["serien"]["wochen"] }): JSX.Element {
	const max = Math.max(1, ...wochen.map((w) => w.gramm).filter(Number.isFinite));
	const spitze = wochen.reduce((a, b) => (zahl(b.gramm) > zahl(a.gramm) ? b : a), wochen[0] ?? { jahr: 0, kw: 0, gramm: 0 });
	return (
		<div>
			<div className="druck-vb">
				{wochen.map((w, i) => {
					// g ist die einzige Quelle der Wahrheit für diesen Balken: Höhe, leer-Klasse
					// und Tooltip müssen dasselbe kaputte gramm (z.B. ein String statt number)
					// gleich behandeln, sonst zeigt der Balken etwas anderes als der Tooltip.
					const g = zahl(w.gramm);
					const h = klemmen(Math.round((g / max) * 100), 0, 100);
					const cls = "druck-vb-bar" + (i === wochen.length - 1 ? " aktuell" : "") + (g === 0 ? " leer" : "");
					return <div key={`${w.jahr}-${w.kw}`} className={cls} style={{ height: `${Math.max(h, g === 0 ? 30 : 2)}%` }} title={`KW ${w.kw}: ${g} g`} />;
				})}
			</div>
			<div className="druck-vb-labels mono">
				{wochen.map((w, i) => <span key={`${w.jahr}-${w.kw}`} style={{ color: i === wochen.length - 1 ? "var(--accent)" : undefined }}>{w.kw}</span>)}
			</div>
			<div className="mono" style={{ fontSize: 9.5, color: "var(--dim)", marginTop: 4 }}>
				{wochen.length === 0 ? "keine Daten" : `spitze KW${spitze.kw}: ${zahl(spitze.gramm)} g · aktuell: ${zahl(wochen[wochen.length - 1]?.gramm ?? 0)} g`}
			</div>
		</div>
	);
}

export function BestandBalken({ bestand, schwelle = 250 }: { bestand: DruckBestand[]; schwelle?: number }): JSX.Element {
	const s = zahl(schwelle);
	const max = Math.max(s, ...bestand.map((b) => b.gewicht_g).filter(Number.isFinite));
	// s und max sind beide finit; bei s=0 und leerem/nur-kaputtem Bestand kann max
	// ebenfalls 0 sein (0/0 = NaN), deshalb hier noch ein zahl() vor dem Klemmen.
	const schwellePct = klemmen(zahl((s / max) * 100), 0, 100);
	return (
		<div>
			{bestand.map((b) => {
				const g = zahl(b.gewicht_g);
				// Eine Zeile mit 1 g bei einer Skala bis 1000 g ist sonst ein 0,01-%-Strich,
				// unsichtbar - und genau diese knappe Zeile ist der Sinn des Diagramms.
				const breite = g > 0 ? Math.max(0.8, klemmen((g / max) * 100, 0, 100)) : 0;
				return (
					<div key={`${b.material}-${b.farbe}`} className="druck-hb">
						<span className="druck-hb-label mono">{b.material} {b.farbe}</span>
						<div className="druck-hb-track">
							<span className="druck-hb-schwelle" style={{ left: `${schwellePct}%` }} />
							<i className={b.knapp ? "knapp" : ""} style={{ width: `${breite}%` }} />
						</div>
						<span className="druck-hb-n mono tnum" style={{ color: b.knapp ? "var(--accent)" : undefined }}>{Math.round(g)} g</span>
					</div>
				);
			})}
		</div>
	);
}

export function Sparkline({ wochen }: { wochen: number[] }): JSX.Element {
	const werte = Array.isArray(wochen) ? wochen : [];
	const max = Math.max(1, ...werte.filter(Number.isFinite));
	const w = 70, h = 14, gap = 1;
	if (werte.length === 0) return <svg width={w} height={h} className="druck-spark" aria-hidden="true" />;
	const bw = (w - gap * (werte.length - 1)) / werte.length;
	return (
		<svg width={w} height={h} className="druck-spark" aria-hidden="true">
			{werte.map((roh, i) => {
				const n = zahl(roh);
				const bh = n === 0 ? 2 : Math.max(2, (n / max) * h);
				return <rect key={i} x={i * (bw + gap)} y={h - bh} width={bw} height={bh} fill={n > 0 ? "var(--accent)" : "var(--border-2)"} />;
			})}
		</svg>
	);
}

export function QuoteRing({ quote }: { quote: DruckStatus["serien"]["quote"] }): JSX.Element {
	const fertig = zahl(quote.fertig);
	const fehlgeschlagen = zahl(quote.fehlgeschlagen);
	const gesamt = fertig + fehlgeschlagen;
	// Ein negativer fertig-Wert darf nie ein negatives Prozent-Segment im
	// conic-gradient ergeben, deshalb hier klemmen statt nur runden.
	const pct = gesamt > 0 ? klemmen(Math.round((fertig / gesamt) * 100), 0, 100) : 0;
	return (
		<div className="druck-ring" style={{ background: `conic-gradient(var(--accent) 0 ${pct}%, var(--border-2) ${pct}% 100%)` }} title={`${fertig} fertig, ${fehlgeschlagen} fehlgeschlagen`}>
			<b className="mono tnum">{pct}%</b>
		</div>
	);
}
