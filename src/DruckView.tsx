import * as React from "react";
import { useState } from "react";
import { Icons } from "./icons";
import { alterMinuten, effektivHealth, MAX_ALTER_MIN, type DruckStatus, type DruckProjekt, type DruckMaterial } from "./loadDruck";
import { BestandBalken, QuoteRing, Sparkline, WochenBalken } from "./DruckCharts";

/**
 * Tab [03] 3D-DRUCK. Rendert nur status.json. Aktionen kommen in Paket C über
 * das Prop `aktionen`; ohne Prop ist der Tab rein lesend.
 */

export interface DruckAktionen {
	terminal: (name: string, pfad: string) => void;
	status: (name: string, zustand: string) => Promise<void>;
	zuordnen: (taskId: string, projekt: string) => Promise<void>;
	claude: (name: string, p: DruckProjekt) => void;
	refresh: () => Promise<void>;
	laeuft: boolean;
}

export const UNGEPRUEFT = new Set(["gedruckt"]);
// wird in Paket C für das Select gebraucht
const ZUSTAENDE = ["idee", "konstruiert", "gedruckt", "passt", "v2-noetig", "ruht"];

function dauer(min: number | null | undefined): string {
	if (min === null || min === undefined || min <= 0) return "-";
	if (min < 60) return `${min} min`;
	return `${Math.floor(min / 60)} h ${min % 60} min`;
}

/** Zahl aus unbestätigten Feldern, robust gegen Strings, null, bool und NaN. */
function zahl(v: unknown): number {
	return Number.isFinite(v as number) ? (v as number) : 0;
}

function tageHer(datum: string | null): number | null {
	// letzter_druck ist laut loadDruck.ts innerhalb eines Projekts NICHT normalisiert:
	// ein von Hand editiertes status.json kann hier auch eine Zahl oder sonst etwas
	// tragen, trotz Typ. typeof deckt das ab, nicht nur den deklarierten null-Fall.
	if (typeof datum !== "string" || datum === "") return null;
	const t = new Date(datum.slice(0, 10)).getTime();
	return isFinite(t) ? Math.floor((Date.now() - t) / 86400000) : null;
}

export function tageText(t: number | null): string {
	if (t === null) return "unbekannt";
	return t === 1 ? "1 Tag" : `${t} Tagen`;
}

/** Materialliste als Text, robust gegen fehlende oder nicht-string Felder in materialien. */
export function materialText(materialien: DruckMaterial[]): string {
	const teile = materialien
		.map((m) => [m.material, m.farbe].filter((x) => typeof x === "string" && x !== "").join(" "))
		.filter((s) => s !== "");
	return teile.length > 0 ? teile.join(", ") : "unbekannt";
}

function pillKlasse(zustand: string | null): string {
	if (zustand === "passt") return "druck-pill ok";
	if (zustand !== null && UNGEPRUEFT.has(zustand)) return "druck-pill warn";
	return "druck-pill";
}

/** Sortierung wie im Markdown-Dashboard: ungeprüft älteste zuerst, dann der Rest alphabetisch. */
export function sortiert(projekte: Record<string, DruckProjekt>): Array<[string, DruckProjekt, number | null]> {
	// projekte kommt aus status.json. Der Vertrag verspricht Objekte als Werte, ein von
	// Hand editiertes JSON kann trotzdem { x: null } enthalten. Kaputte Einträge hier
	// rausfiltern, bevor irgendein Feld auf ihnen gelesen wird.
	const eintraege = Object.entries(projekte).filter(([, p]) => p !== null && typeof p === "object");
	// p.letzter_druck ist laut loadDruck.ts innerhalb eines Projekts nicht normalisiert,
	// kann also trotz Typ auch undefined sein. tageHer prüft nur auf null, deshalb hier
	// am Lesepunkt absichern statt tageHer selbst anzufassen.
	const rows = eintraege.map(([n, p]): [string, DruckProjekt, number | null] => [n, p, tageHer(p.letzter_druck ?? null)]);
	return rows.sort((a, b) => {
		const au = a[1].zustand !== null && UNGEPRUEFT.has(a[1].zustand) ? 0 : 1;
		const bu = b[1].zustand !== null && UNGEPRUEFT.has(b[1].zustand) ? 0 : 1;
		if (au !== bu) return au - bu;
		if (au === 0) return (b[2] ?? -1) - (a[2] ?? -1);
		return a[0].localeCompare(b[0]);
	});
}

/**
 * Fängt Render-Fehler des 3D-Druck-Bereichs ab. Ohne diese Grenze würde ein
 * einziger Throw die gesamte Plugin-Pane weiß schalten, inklusive Tab-Leiste.
 * Der Aufrufer reicht die Revision als Prop; ein neuer Snapshot löscht den
 * Fehlerzustand, ohne den Teilbaum zu remounten.
 */
export class DruckFehlerGrenze extends React.Component<{ revision: number; children: React.ReactNode }, { fehler: string | null }> {
	state: { fehler: string | null } = { fehler: null };
	static getDerivedStateFromError(e: unknown): { fehler: string } {
		return { fehler: e instanceof Error ? e.message : String(e) };
	}
	componentDidCatch(e: unknown, info: React.ErrorInfo): void {
		console.error("[agentic-os] 3D-Druck-Render fehlgeschlagen:", e, info.componentStack);
	}
	componentDidUpdate(prev: { revision: number }): void {
		// Ein neuer Snapshot darf den Render erneut versuchen. Über key statt hier
		// würde jeder Lauf den Teilbaum remounten und die Auswahl verlieren.
		if (this.state.fehler !== null && prev.revision !== this.props.revision) this.setState({ fehler: null });
	}
	render(): React.ReactNode {
		if (this.state.fehler !== null) {
			return (
				<div className="featured" style={{ margin: "4px 18px 0", padding: "10px 14px", borderColor: "#3a2414" }}>
					<span className="ctitle" style={{ color: "var(--accent)" }}>⚠ 3d-druck · anzeige fehlgeschlagen</span>
					<div className="mono" style={{ fontSize: 10, color: "var(--muted)", marginTop: 4 }}>{this.state.fehler}</div>
				</div>
			);
		}
		return this.props.children;
	}
}

export function DruckBanner({ status }: { status: DruckStatus | null }): JSX.Element | null {
	const eff = effektivHealth(status);
	if (eff === "ok") return null;
	const alter = alterMinuten(status);
	const text = eff === "fehlt" ? "Kein Stand vorhanden."
		: eff === "error" ? "Dieser Stand ist nicht verlässlich."
		: alter !== null && alter >= MAX_ALTER_MIN ? `Dieser Stand ist ${alter} Minuten alt.`
		: "Dieser Stand ist möglicherweise nicht aktuell.";
	return (
		<div className="featured" style={{ margin: "4px 18px 0", padding: "10px 14px", borderColor: "#3a2414", display: "flex", flexDirection: "column", gap: 4 }}>
			<span className="ctitle" style={{ color: "var(--accent)" }}>⚠ 3d-druck · {eff}</span>
			<span style={{ fontSize: 12, color: "#f5f5f5" }}>{text}</span>
			{status !== null && typeof status.health.grund === "string" && status.health.grund !== "" && <span className="mono" style={{ fontSize: 10, color: "var(--muted)" }}>{status.health.grund}</span>}
			<span className="mono" style={{ fontSize: 10, color: "var(--dim)" }}>
				prüfen: <span style={{ color: "var(--text)" }}>launchctl list | grep druck-dashboard</span> · neu starten: <span style={{ color: "var(--text)" }}>launchctl kickstart -k gui/$(id -u)/de.ben.druck-dashboard</span>
			</span>
		</div>
	);
}

function Hero({ status }: { status: DruckStatus }): JSX.Element {
	const l = status.laufend;
	const alter = alterMinuten(status);
	return (
		<div style={{ margin: "4px 18px 0", position: "relative" }}>
			<div className="featured" style={{ padding: "14px 18px 16px", position: "relative" }}>
				<span className="bracket tl" /><span className="bracket tr" /><span className="bracket bl" /><span className="bracket br" />
				<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
					<span className="ctitle"><Icons.bolt style={{ color: "var(--accent)" }} /> jetzt im druck</span>
					<span className="mono" style={{ fontSize: 10, color: "var(--dim)", letterSpacing: ".08em" }}>
						stand <span style={{ color: "var(--text)" }}>vor {alter ?? "?"}m</span> · rev {status.revision}
					</span>
				</div>
				{l === null ? (
					<div style={{ fontSize: 13, color: "var(--muted)" }}>Kein Druck aktiv.</div>
				) : (
					<>
						<div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
							<span className="mono tnum" style={{ fontSize: 34, color: "var(--accent)", fontWeight: 600, lineHeight: 1 }}>{l.laeuft_minuten ?? "?"}</span>
							<span className="mono small-caps" style={{ fontSize: 9, color: "var(--dim)", letterSpacing: ".16em" }}>minuten</span>
							<span style={{ fontSize: 12.5, color: "#f5f5f5" }}>{materialText(l.materialien)}</span>
							<span className="mono" style={{ fontSize: 10, color: "var(--dim)" }}>{l.trays.join(", ") || "-"} · task {l.task_id ?? "?"}</span>
						</div>
						{/* Annahme für den Fortschrittsbalken, ein Druck über 6 h klebt bei 100 %. Die echte Restzeit liefert der Tracker nicht. */}
						<div className="hatch" style={{ position: "relative", height: 10, borderRadius: 3, border: "1px solid #232323", overflow: "hidden", marginTop: 10 }}>
							<div className="burn-fill" style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${Math.min(100, (zahl(l.laeuft_minuten) / 360) * 100)}%` }} />
						</div>
						<div className="mono" style={{ fontSize: 9.5, color: "var(--dim)", marginTop: 6 }}>
							{l.projekt_hinweis}{l.unbestaetigt === true ? " · UNBESTÄTIGT, siehe Warnung" : ""}{l.uebernommen === true ? ` · übernommener Wert, ${l.uebernommen_seit_minuten ?? "?"} min alt` : ""}
						</div>
					</>
				)}
			</div>
		</div>
	);
}

function Stat({ value, label, accent }: { value: string; label: string; accent?: boolean }): JSX.Element {
	return (
		<div className="featured" style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 4 }}>
			<div className="mono tnum" style={{ fontSize: 24, fontWeight: 600, color: accent === true ? "var(--accent)" : "#f5f5f5", lineHeight: 1 }}>{value}</div>
			<div className="mono small-caps" style={{ color: "var(--dim)", fontSize: 9.5, letterSpacing: ".16em" }}>{label}</div>
		</div>
	);
}

function Kennzahlen({ status }: { status: DruckStatus }): JSX.Element {
	const rows = sortiert(status.projekte);
	const ungeprueft = rows.filter(([, p]) => p.zustand !== null && UNGEPRUEFT.has(p.zustand)).length;
	const knapp = status.bestand.filter((b) => b.knapp).length;
	// "drucke" und "verbraucht" müssen dieselbe Grundmenge zählen wie die Python-Serien
	// laut Vertrag: nur FINISH. Ein FAILED-Druck zählt sonst mit, gramm aber nicht.
	const fertigeDrucke = status.drucke.filter((d) => d.status === "FINISH");
	const kg = (fertigeDrucke.reduce((s, d) => s + zahl(d.gesamt_g), 0) / 1000).toFixed(1);
	return (
		<div style={{ margin: "12px 18px 0", display: "grid", gridTemplateColumns: "repeat(4,1fr) auto", gap: 10, alignItems: "stretch" }}>
			<Stat value={String(ungeprueft)} label="ungeprüft" accent />
			<Stat value={String(fertigeDrucke.length)} label="fertige drucke" />
			<Stat value={`${kg} kg`} label="verbraucht" />
			<Stat value={String(knapp)} label="nachkaufen" accent />
			<div className="featured" style={{ padding: "8px 12px", display: "flex", alignItems: "center", gap: 10 }}>
				<QuoteRing quote={status.serien.quote} />
				<div className="mono small-caps" style={{ fontSize: 9, color: "var(--dim)", letterSpacing: ".14em", lineHeight: 1.5 }}>
					{status.serien.quote.fertig} fertig<br />{status.serien.quote.fehlgeschlagen} fehl<br />gesamt
				</div>
			</div>
		</div>
	);
}

function ProjektListe({ status, sel, onSel }: { status: DruckStatus; sel: string | null; onSel: (n: string) => void }): JSX.Element {
	return (
		<div className="featured" style={{ padding: "12px 14px" }}>
			<span className="ctitle" style={{ marginBottom: 8 }}>◫ projekte · {Object.keys(status.projekte).length}</span>
			{sortiert(status.projekte).map(([name, p, tage]) => {
				// p.zustand ist innerhalb eines Projekts nicht normalisiert, siehe ProjektDetail.
				const zustand = typeof p.zustand === "string" ? p.zustand : null;
				return (
					<div key={name} className={"druck-row" + (sel === name ? " sel" : "")} onClick={() => onSel(name)}>
						<span className="mono" style={{ flex: 1, color: "#f5f5f5", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
						<Sparkline wochen={p.wochen} />
						<span className={pillKlasse(zustand)}>{zustand ?? "fehlt"}{zustand !== null && UNGEPRUEFT.has(zustand) && tage !== null ? ` ${tage}d` : ""}</span>
					</div>
				);
			})}
		</div>
	);
}

function ProjektDetail({ status, name, aktionen }: { status: DruckStatus; name: string | null; aktionen?: DruckAktionen }): JSX.Element {
	if (name === null || !(name in status.projekte)) {
		return <div className="featured" style={{ padding: "12px 14px", color: "var(--dim)", fontSize: 12 }}>Projekt links wählen.</div>;
	}
	const p = status.projekte[name] as DruckProjekt;
	// Felder INNERHALB eines Projekts sind laut loadDruck.ts nicht normalisiert,
	// deshalb hier defensiv gegen fehlende oder falsch typisierte Werte in der Rohdatei.
	const notiz = typeof p.notiz === "string" ? p.notiz : "";
	const pfad = typeof p.pfad === "string" ? p.pfad : "";
	const stand = typeof p.stand === "string" ? p.stand : "";
	const zustand = typeof p.zustand === "string" ? p.zustand : null;
	const letzterDruck = p.letzter_druck ?? null;
	const druckeAnzahl = zahl(p.drucke);
	const drucke = status.drucke.filter((d) => d.projekt === name).reverse();
	return (
		<div className="featured" style={{ padding: "12px 14px", position: "relative" }}>
			<span className="bracket tl" /><span className="bracket tr" /><span className="bracket bl" /><span className="bracket br" />
			<div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
				<span className="mono" style={{ fontSize: 14, color: "#f5f5f5", fontWeight: 600 }}>{name}</span>
				<span className={pillKlasse(zustand)}>{zustand ?? "fehlt"}</span>
				<span className="mono" style={{ fontSize: 10, color: "var(--dim)" }}>stand {stand || "-"}</span>
			</div>
			<div className="mono" style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>
				{druckeAnzahl} {druckeAnzahl === 1 ? "Druck" : "Drucke"} · {zahl(p.gramm)} g · zuletzt {letzterDruck ?? "-"}
				{zustand !== null && UNGEPRUEFT.has(zustand) ? ` · seit ${tageText(tageHer(letzterDruck))} ungeprüft` : ""}
			</div>
			{notiz !== "" && <div style={{ fontSize: 11.5, color: "var(--text)", marginBottom: 8, lineHeight: 1.5 }}>{notiz}</div>}
			{drucke.slice(0, 6).map((d) => (
				<div key={d.task_id} className="druck-row" style={{ cursor: "default" }}>
					<span className="mono" style={{ flex: 1, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{(typeof d.print_name === "string" ? d.print_name : "") || "-"}</span>
					<span className="mono" style={{ fontSize: 10, color: "var(--dim)" }}>{(d.zeitpunkt ?? "").slice(0, 10) || "-"} · {zahl(d.gesamt_g)} g · {dauer(zahl(d.dauer_min))}</span>
				</div>
			))}
			{aktionen !== undefined && (
				<div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
					<button className="druck-btn" disabled={aktionen.laeuft || pfad === ""} onClick={() => aktionen.terminal(name, pfad)}>▸ terminal hier</button>
					<button className="druck-btn" disabled={aktionen.laeuft || zustand === "passt"} onClick={() => void aktionen.status(name, "passt")}>✓ passt</button>
					<button className="druck-btn" disabled={aktionen.laeuft || zustand === "v2-noetig"} onClick={() => void aktionen.status(name, "v2-noetig")}>✗ v2 nötig</button>
					<button className="druck-btn" disabled={aktionen.laeuft || zustand === "ruht"} onClick={() => void aktionen.status(name, "ruht")}>◌ ruht</button>
					<button className="druck-btn" disabled={aktionen.laeuft} onClick={() => aktionen.claude(name, p)}>claude fragen</button>
				</div>
			)}
		</div>
	);
}

function ZuletztFertig({ status, aktionen }: { status: DruckStatus; aktionen?: DruckAktionen }): JSX.Element {
	const fertig = status.drucke.filter((d) => d.status === "FINISH").slice(-12).reverse();
	const projekte = Object.keys(status.projekte).sort();
	return (
		<div className="featured" style={{ margin: "10px 18px 0", padding: "12px 14px" }}>
			<span className="ctitle" style={{ marginBottom: 8 }}>≡ zuletzt fertig</span>
			{fertig.map((d) => {
				const zuordenbar = d.quelle === "offen" || d.quelle === "mehrdeutig" || d.quelle === "zuordnung";
				const platzhalter = d.quelle === "zuordnung" ? (d.projekt ?? "kein Projekt") : "zuordnen …";
				return (
					<div key={d.task_id} className="druck-row" style={{ cursor: "default" }}>
						<span className="mono" style={{ fontSize: 10, color: "var(--dim)", flex: "0 0 96px" }}>{(d.zeitpunkt ?? "").slice(0, 16) || "-"}</span>
						<span className="mono" style={{ flex: 1, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{(typeof d.print_name === "string" ? d.print_name : "") || "ohne Namen"}</span>
						{zuordenbar && aktionen !== undefined ? (
							<select className="druck-select" value="__" disabled={aktionen.laeuft} onChange={(e) => { const v = e.target.value; if (v !== "__") void aktionen.zuordnen(d.task_id, v === "__kein" ? "" : v); }}>
								<option value="__">{platzhalter}</option>
								{projekte.map((p) => <option key={p} value={p}>{p}</option>)}
								<option value="__kein">kein Projekt</option>
							</select>
						) : (
							<span className="mono" style={{ fontSize: 10, color: d.projekt !== null ? "var(--accent)" : "var(--dim)" }}>{d.projekt ?? d.quelle}</span>
						)}
						<span className="mono tnum" style={{ fontSize: 10, color: "var(--muted)", flex: "0 0 60px", textAlign: "right" }}>{zahl(d.gesamt_g)} g</span>
					</div>
				);
			})}
		</div>
	);
}

function Aufklappbar({ titel, children }: { titel: string; children: React.ReactNode }): JSX.Element {
	const [offen, setOffen] = useState<boolean>(false);
	return (
		<div className="featured" style={{ padding: offen ? "12px 14px" : "8px 14px" }}>
			<div style={{ display: "flex", alignItems: "center", cursor: "pointer" }} onClick={() => setOffen((v) => !v)}>
				<span className="ctitle">{titel}</span>
				<span style={{ flex: 1 }} />
				<span className="mono small-caps" style={{ color: "var(--accent)", fontSize: 10 }}>{offen ? "▴ einklappen" : "aufklappen ▸"}</span>
			</div>
			{offen && <div style={{ marginTop: 10 }}>{children}</div>}
		</div>
	);
}

/** Refresh-Knopf für die Fälle ohne Stand oder mit unverlässlichem Stand. Ohne aktionen leer. */
function RefreshKnopf({ aktionen }: { aktionen?: DruckAktionen }): JSX.Element | null {
	if (aktionen === undefined) return null;
	return (
		<div style={{ margin: "10px 18px" }}>
			<button className="druck-btn" disabled={aktionen.laeuft} onClick={() => void aktionen.refresh()}>{aktionen.laeuft ? "läuft …" : "↻ jetzt erzeugen"}</button>
		</div>
	);
}

export function DruckView({ status, aktionen }: { status: DruckStatus | null; aktionen?: DruckAktionen }): JSX.Element {
	const [sel, setSel] = useState<string | null>(null);
	// Vertrag "Banner statt Daten": bei fehlendem oder unverlässlichem Stand (health
	// error) keine Kennzahlen und keinen Hero zeigen, die als echte Werte durchgehen
	// könnten. stale zeigt weiterhin alles, nur mit Banner oben.
	if (status === null || effektivHealth(status) === "error") {
		return (
			<>
				<DruckBanner status={status} />
				<RefreshKnopf aktionen={aktionen} />
			</>
		);
	}
	// sortiert()[0]: ungeprüfte zuerst nach Alter, sonst das alphabetisch erste Projekt.
	const ersterEintrag = sortiert(status.projekte)[0]?.[0] ?? null;
	const gewaehlt = sel ?? ersterEintrag;
	return (
		<>
			<DruckBanner status={status} />
			<Hero status={status} />
			<Kennzahlen status={status} />
			<div style={{ margin: "10px 18px 0", display: "grid", gridTemplateColumns: "240px 1fr", gap: 10 }}>
				<ProjektListe status={status} sel={gewaehlt} onSel={setSel} />
				<ProjektDetail status={status} name={gewaehlt} aktionen={aktionen} />
			</div>
			<ZuletztFertig status={status} aktionen={aktionen} />
			<div style={{ margin: "10px 18px 18px", display: "flex", flexDirection: "column", gap: 8 }}>
				<Aufklappbar titel={`▮ verbrauch · gramm je kalenderwoche`}><WochenBalken wochen={status.serien.wochen} /></Aufklappbar>
				<Aufklappbar titel={`▤ filament · ${status.bestand.length} sorten · ${status.bestand.filter((b) => b.knapp).length} knapp`}><BestandBalken bestand={status.bestand} /></Aufklappbar>
				<Aufklappbar titel={`☑ backlog · ${status.backlog.length} offen`}>
					{status.backlog.length === 0 ? <div className="mono" style={{ color: "var(--dim)", fontSize: 11 }}>Nichts offen.</div>
						: status.backlog.map((b, i) => <div key={i} className="druck-row" style={{ cursor: "default" }}><span className="mono" style={{ color: "var(--dim)" }}>[ ]</span><span style={{ fontSize: 11.5 }}>{String(b)}</span></div>)}
				</Aufklappbar>
				{status.befunde.length > 0 && (
					<div className="featured" style={{ padding: "10px 14px", borderColor: "#3a2414" }}>
						<span className="ctitle" style={{ color: "var(--accent)" }}>befunde in Projekte.md</span>
						{status.befunde.map((b, i) => <div key={i} className="mono" style={{ fontSize: 10.5, color: "var(--text)", marginTop: 4 }}>{String(b)}</div>)}
					</div>
				)}
			</div>
		</>
	);
}
