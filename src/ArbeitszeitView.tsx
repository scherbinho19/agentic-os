import * as React from "react";
import { useState } from "react";
import { Icons } from "./icons";
import { MAX_ALTER_MIN } from "./loadDruck";
import { fmtStunden, zeitAlterMinuten, zeitHealth, type StempelAktion, type ZeitArt, type ZeitStatus, type ZeitTag } from "./loadArbeitszeit";
import { MonatsBalken, StundenBalken, monatKurz } from "./ArbeitszeitCharts";

/**
 * Tab [04] ARBEITSZEIT. Rendert nur status.json. Aktionen kommen über das Prop
 * `aktionen` (Paket D); ohne Prop ist der Tab rein lesend. Jede Aktion gibt zurück, ob
 * sie geglückt ist, damit der Editor bei einem Fehler offen bleibt.
 */

export interface ZeitAktionen {
	laeuft: boolean;
	stempel: (aktion: StempelAktion) => Promise<boolean>;
	eintrag: (datum: string, zeiten: [string, string, string, string]) => Promise<boolean>;
	abwesend: (datum: string, art: "urlaub" | "krank") => Promise<boolean>;
	loeschen: (datum: string) => Promise<boolean>;
	exportieren: (monat: string) => Promise<boolean>;
	refresh: () => Promise<boolean>;
}

function zahl(v: unknown): number {
	return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function text(v: unknown): string {
	return typeof v === "string" ? v : "";
}

const MONAT_RE = /^\d{4}-\d{2}$/;
const DATUM_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Key für den Inline-Editor eines Tages. Enthält die Felder des Tages, damit der Editor
 * remountet, sobald ein Snapshot den Tag ändert (Codex-Befund: ein offener Editor hätte
 * sonst ein inzwischen gestempeltes Ende mit seinem alten Entwurf überschrieben). Gleicher
 * Tag, gleiche Felder heißt gleicher Key, der Entwurf überlebt dann den 5-s-Poll.
 */
export function editorSchluessel(datum: string, tag: ZeitTag): string {
	return [datum, tag.art, tag.start, tag.pause_start, tag.pause_ende, tag.ende].map((v) => (typeof v === "string" ? v : "")).join("|");
}

/** Fängt Render-Fehler des Arbeitszeit-Bereichs ab, wie DruckFehlerGrenze. Neuer Snapshot löscht den Fehler. */
export class ZeitFehlerGrenze extends React.Component<{ revision: number; children: React.ReactNode }, { fehler: string | null }> {
	state: { fehler: string | null } = { fehler: null };
	static getDerivedStateFromError(e: unknown): { fehler: string } {
		return { fehler: e instanceof Error ? e.message : String(e) };
	}
	componentDidCatch(e: unknown, info: React.ErrorInfo): void {
		console.error("[agentic-os] Arbeitszeit-Render fehlgeschlagen:", e, info.componentStack);
	}
	componentDidUpdate(prev: { revision: number }): void {
		if (this.state.fehler !== null && prev.revision !== this.props.revision) this.setState({ fehler: null });
	}
	render(): React.ReactNode {
		if (this.state.fehler !== null) {
			return (
				<div className="featured" style={{ margin: "4px 18px 0", padding: "10px 14px", borderColor: "#3a2414" }}>
					<span className="ctitle" style={{ color: "var(--accent)" }}>⚠ arbeitszeit · anzeige fehlgeschlagen</span>
					<div className="mono" style={{ fontSize: 10, color: "var(--muted)", marginTop: 4 }}>{this.state.fehler}</div>
				</div>
			);
		}
		return this.props.children;
	}
}

export function ZeitBanner({ status }: { status: ZeitStatus | null }): JSX.Element | null {
	const eff = zeitHealth(status);
	if (eff === "ok") return null;
	const alter = zeitAlterMinuten(status);
	const t = eff === "fehlt" ? "Kein Stand vorhanden."
		: eff === "error" ? "Dieser Stand ist nicht verlässlich."
		: alter !== null && alter >= MAX_ALTER_MIN ? `Dieser Stand ist ${alter} Minuten alt.`
		: "Dieser Stand ist möglicherweise nicht aktuell.";
	return (
		<div className="featured" style={{ margin: "4px 18px 0", padding: "10px 14px", borderColor: "#3a2414", display: "flex", flexDirection: "column", gap: 4 }}>
			<span className="ctitle" style={{ color: "var(--accent)" }}>⚠ arbeitszeit · {eff}</span>
			<span style={{ fontSize: 12, color: "#f5f5f5" }}>{t}</span>
			{status !== null && status.health.grund !== "" && <span className="mono" style={{ fontSize: 10, color: "var(--muted)" }}>{status.health.grund}</span>}
			<span className="mono" style={{ fontSize: 10, color: "var(--dim)" }}>
				prüfen: <span style={{ color: "var(--text)" }}>launchctl list | grep arbeitszeit</span> · neu starten: <span style={{ color: "var(--text)" }}>launchctl kickstart -k gui/$(id -u)/de.ben.arbeitszeit</span>
			</span>
		</div>
	);
}

function RefreshKnopf({ aktionen }: { aktionen?: ZeitAktionen }): JSX.Element | null {
	if (aktionen === undefined) return null;
	return (
		<div style={{ margin: "10px 18px" }}>
			<button className="zeit-btn" disabled={aktionen.laeuft} onClick={() => void aktionen.refresh()}>{aktionen.laeuft ? "läuft …" : "↻ jetzt erzeugen"}</button>
		</div>
	);
}

function Stat({ value, label, accent, warn }: { value: string; label: string; accent?: boolean; warn?: boolean }): JSX.Element {
	return (
		<div className="featured" style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 4, borderColor: warn === true ? "#3a2414" : undefined }}>
			<div className="mono tnum" style={{ fontSize: 22, fontWeight: 600, color: accent === true ? "var(--accent)" : "#f5f5f5", lineHeight: 1, whiteSpace: "nowrap" }}>{value}</div>
			<div className="mono small-caps" style={{ color: "var(--dim)", fontSize: 9.5, letterSpacing: ".16em" }}>{label}</div>
		</div>
	);
}

function Heute({ status, aktionen }: { status: ZeitStatus; aktionen?: ZeitAktionen }): JSX.Element {
	const h = status.heute;
	const alter = zeitAlterMinuten(status);
	const pause = h.pause_start !== null && h.pause_ende !== null ? `, Pause ${h.pause_start} bis ${h.pause_ende}` : "";
	let t: React.ReactNode;
	if (h.zustand === "laeuft") t = <>läuft seit <b style={{ color: "var(--accent)" }}>{h.start ?? "?"}</b>{pause}, bisher <b>{fmtStunden(h.stunden)} h</b></>;
	else if (h.zustand === "pause") t = <>Pause seit <b style={{ color: "var(--accent)" }}>{h.pause_start ?? "?"}</b>, Start {h.start ?? "?"}, bisher <b>{fmtStunden(h.stunden)} h</b></>;
	else if (h.zustand === "fertig") t = <>fertig: {h.start ?? "?"} bis {h.ende ?? "?"}{pause}, <b>{fmtStunden(h.stunden)} h</b></>;
	else if (h.zustand === "abwesend") t = <>heute <b>{h.art ?? "abwesend"}</b>, {fmtStunden(h.stunden)} h</>;
	else t = <span style={{ color: "var(--muted)" }}>heute noch nichts gestempelt.</span>;
	const busy = aktionen === undefined || aktionen.laeuft || h.datum === "";
	const knopf = (label: string, primaer: boolean, onClick: () => void): JSX.Element =>
		<button className={"zeit-btn" + (primaer ? " primaer" : "")} disabled={busy} onClick={onClick}>{label}</button>;
	return (
		<div style={{ margin: "4px 18px 0" }}>
			<div className="featured" style={{ padding: "14px 18px 16px", position: "relative" }}>
				<span className="bracket tl" /><span className="bracket tr" /><span className="bracket bl" /><span className="bracket br" />
				<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
					<span className="ctitle"><Icons.cal style={{ color: "var(--accent)" }} /> heute · {h.datum || "?"}</span>
					<span className="mono" style={{ fontSize: 10, color: "var(--dim)", letterSpacing: ".08em" }}>
						stand <span style={{ color: "var(--text)" }}>vor {alter ?? "?"}m</span> · rev {status.revision}
					</span>
				</div>
				<div style={{ fontSize: 13, color: "#f5f5f5" }}>{t}</div>
				{aktionen !== undefined && (
					<div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10, alignItems: "center" }}>
						{h.zustand === "nichts" && <>
							{knopf("▶ start", true, () => void aktionen.stempel("start"))}
							{knopf("urlaub", false, () => void aktionen.abwesend(h.datum, "urlaub"))}
							{knopf("krank", false, () => void aktionen.abwesend(h.datum, "krank"))}
						</>}
						{h.zustand === "laeuft" && <>
							{knopf("❚❚ pause", false, () => void aktionen.stempel("pause"))}
							{knopf("■ ende", true, () => void aktionen.stempel("ende"))}
						</>}
						{h.zustand === "pause" && <>
							{knopf("▶ weiter", true, () => void aktionen.stempel("weiter"))}
							{knopf("■ ende", false, () => void aktionen.stempel("ende"))}
						</>}
						{(h.zustand === "fertig" || h.zustand === "abwesend") && <span className="mono" style={{ fontSize: 10, color: "var(--dim)" }}>Korrektur unten in der Tagesliste.</span>}
					</div>
				)}
			</div>
		</div>
	);
}

function Kennzahlen({ status }: { status: ZeitStatus }): JSX.Element {
	const m = status.monat, s = status.saldo, u = status.urlaub;
	const noetig = m.stunden_pro_tag_noetig;
	return (
		<div style={{ margin: "12px 18px 0", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(165px, 1fr))", gap: 10 }}>
			<Stat value={`${fmtStunden(m.ist)} / ${fmtStunden(m.soll, 0)}`} label={`stunden ${monatKurz(m.monat)}`} accent />
			{m.ueberstunden > 0
				? <Stat value={`+${fmtStunden(m.ueberstunden)} h`} label="überstunden" accent />
				: <Stat value={`${fmtStunden(m.rest)} h`} label="fehlen noch" accent={m.rest > 0} />}
			<Stat value={String(m.arbeitstage_verbleibend)} label="arbeitstage übrig" />
			<Stat value={noetig === null ? (m.rest > 0 ? "keine tage" : "-") : `${fmtStunden(noetig)} h`} label="nötig pro tag" accent={m.knapp} warn={m.knapp} />
			<Stat value={`${s.stunden >= 0 ? "+" : ""}${fmtStunden(s.stunden)} h`} label="saldo vormonate" />
			<Stat value={`${u.genommen} / ${u.anspruch}`} label={`urlaub ${u.jahr} · ${u.rest} rest${u.krank_tage > 0 ? ` · ${u.krank_tage} krank` : ""}`} />
		</div>
	);
}

function OffeneTage({ status, onSpringe, lesend }: { status: ZeitStatus; onSpringe: (datum: string) => void; lesend: boolean }): JSX.Element | null {
	// unvollstaendig ist eine ungeprüfte String-Liste. Ein leerer oder mit "-" beginnender
	// Wert würde bis zur CLI durchgereicht, wo argparse ihn als Option liest.
	const tage = status.unvollstaendig.filter((d) => DATUM_RE.test(d));
	if (tage.length === 0) return null;
	return (
		<div className="featured" style={{ margin: "10px 18px 0", padding: "10px 14px", borderColor: "#3a2414" }}>
			<span className="ctitle" style={{ color: "var(--accent)" }}>⚠ offene tage · {tage.length}</span>
			<div style={{ fontSize: 12, color: "#f5f5f5", marginTop: 4 }}>Diese Tage haben kein Ende und zählen nicht.{lesend ? "" : " Klick öffnet den Tag zum Nachtragen."}</div>
			<div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
				{tage.map((d) => lesend
					? <span key={d} className="zeit-pill warn">{d}</span>
					: <button key={d} className="zeit-btn" onClick={() => onSpringe(d)}>{d}</button>)}
			</div>
		</div>
	);
}

function TagEditor({ datum, tag, aktionen, onClose }: { datum: string; tag: ZeitTag | null; aktionen: ZeitAktionen; onClose: () => void }): JSX.Element {
	const [art, setArt] = useState<ZeitArt>(tag?.art === "urlaub" || tag?.art === "krank" ? tag.art : "arbeit");
	const [zeiten, setZeiten] = useState<[string, string, string, string]>([text(tag?.start), text(tag?.pause_start), text(tag?.pause_ende), text(tag?.ende)]);
	const busy = aktionen.laeuft;
	const setZeit = (i: number, v: string): void => setZeiten((z) => { const n = [...z] as [string, string, string, string]; n[i] = v; return n; });
	const schliesseWenn = (ok: boolean): void => { if (ok) onClose(); };
	const speichern = (): void => {
		if (art === "arbeit") void aktionen.eintrag(datum, zeiten.map((z) => (z === "" ? "-" : z)) as [string, string, string, string]).then(schliesseWenn);
		else void aktionen.abwesend(datum, art).then(schliesseWenn);
	};
	const loeschen = (): void => {
		if (window.confirm(`Eintrag vom ${datum} löschen?`)) void aktionen.loeschen(datum).then(schliesseWenn);
	};
	const felder = ["start", "pause", "weiter", "ende"] as const;
	return (
		<div className="zeit-editor">
			<span className="mono" style={{ color: "var(--accent)", fontSize: 10.5, alignSelf: "center" }}>{datum}</span>
			<label className="mono zeit-feld">art
				<select className="zeit-select" value={art} disabled={busy} onChange={(e) => setArt(e.target.value as ZeitArt)}>
					<option value="arbeit">arbeit</option><option value="urlaub">urlaub</option><option value="krank">krank</option>
				</select>
			</label>
			{felder.map((label, i) => (
				<label key={label} className="mono zeit-feld">{label}
					{/* step 60: minutengenau, Bens Tabellen enthalten Zeiten außerhalb jedes Rasters (Nachtrag 1); der Browser-Default wäre auch 60, explizit gegen spätere Verwechslung mit rundung_minuten. */}
					<input type="time" step={60} className="zeit-time" value={zeiten[i]} disabled={busy || art !== "arbeit"} onChange={(e) => setZeit(i, e.target.value)} />
				</label>
			))}
			<button className="zeit-btn primaer" disabled={busy || (art === "arbeit" && zeiten[0] === "")} onClick={speichern}>speichern</button>
			{/* != null: art in Listen-Elementen ist nicht normalisiert, undefined heißt ebenfalls leer. */}
			{tag !== null && tag.art != null && <button className="zeit-btn" disabled={busy} onClick={loeschen}>löschen</button>}
			<button className="zeit-btn" disabled={busy} onClick={onClose}>abbrechen</button>
		</div>
	);
}

function TagesListe({ status, aktionen, edit, setEdit }: { status: ZeitStatus; aktionen?: ZeitAktionen; edit: string | null; setEdit: (d: string | null) => void }): JSX.Element {
	const heute = status.heute.datum;
	const tage = status.monat.tage;
	const inMonat = edit !== null && tage.some((t) => t.datum === edit);
	const lesend = aktionen === undefined;
	return (
		<div className="featured" style={{ margin: "10px 18px 0", padding: "12px 14px" }}>
			<span className="ctitle" style={{ marginBottom: 8 }}>≡ tage · {monatKurz(status.monat.monat)}</span>
			<div className="zeit-row zeit-kopf mono">
				{["datum", "tag", "art", "start", "pause", "weiter", "ende", "std"].map((k) => <span key={k} className={k === "std" ? "zeit-c-std" : ""}>{k}</span>)}
			</div>
			{edit !== null && !inMonat && aktionen !== undefined && (
				<>
					<div className="mono" style={{ fontSize: 10, color: "var(--dim)", margin: "6px 0 2px" }}>Tag außerhalb des angezeigten Monats:</div>
					{/* key={edit}: sonst behält der Editor beim Wechsel auf einen anderen offenen Tag die getippten Zeiten. */}
					<TagEditor key={edit} datum={edit} tag={null} aktionen={aktionen} onClose={() => setEdit(null)} />
				</>
			)}
			{tage.map((t, i) => {
				// Felder in Listen-Elementen sind nicht normalisiert (Repo-Regel), deshalb typeof an jeder Lesestelle.
				const datum = text(t.datum);
				const wt = text(t.wochentag);
				const we = wt === "Sa" || wt === "So";
				const offen = t.offen === true;
				const art = t.art === "arbeit" || t.art === "urlaub" || t.art === "krank" ? t.art : null;
				const cls = "zeit-row" + (we ? " we" : "") + (datum === heute ? " heute" : "") + (offen ? " offen" : "") + (edit === datum ? " sel" : "") + (lesend ? " lesend" : "");
				return (
					<React.Fragment key={datum ? `${datum}-${i}` : String(i)}>
						<div className={cls} onClick={() => { if (!lesend && DATUM_RE.test(datum)) setEdit(edit === datum ? null : datum); }}>
							<span className="mono">{datum.length === 10 ? `${datum.slice(8, 10)}.${datum.slice(5, 7)}.` : datum}</span>
							<span className="mono" style={{ color: we ? "var(--dim)" : "var(--muted)" }}>{wt}</span>
							<span>
								{art !== null && <span className={"zeit-pill" + (art !== "arbeit" ? " abw" : "")}>{art}</span>}
								{offen && <span className="zeit-pill warn">offen</span>}
							</span>
							<span className="mono tnum">{text(t.start)}</span>
							<span className="mono tnum">{text(t.pause_start)}</span>
							<span className="mono tnum">{text(t.pause_ende)}</span>
							<span className="mono tnum">{text(t.ende)}</span>
							<span className="mono tnum zeit-c-std">{zahl(t.stunden) > 0 ? fmtStunden(t.stunden) : ""}</span>
						</div>
						{edit === datum && aktionen !== undefined && <TagEditor key={editorSchluessel(datum, t)} datum={datum} tag={t} aktionen={aktionen} onClose={() => setEdit(null)} />}
					</React.Fragment>
				);
			})}
		</div>
	);
}

function Fuss({ status, aktionen }: { status: ZeitStatus; aktionen?: ZeitAktionen }): JSX.Element | null {
	const monate = [...new Set(status.saldo.monate.map((m) => m.monat).filter((m): m is string => typeof m === "string" && MONAT_RE.test(m)))];
	const [monat, setMonat] = useState<string>(status.monat.monat);
	if (aktionen === undefined) return null;
	const aktuell = MONAT_RE.test(status.monat.monat) ? status.monat.monat : "";
	const auswahl = monate.includes(monat) ? monat : aktuell;
	return (
		<div style={{ margin: "10px 18px 18px", display: "flex", gap: 8, alignItems: "center" }}>
			<select className="zeit-select" value={auswahl} disabled={aktionen.laeuft} onChange={(e) => setMonat(e.target.value)}>
				{monate.map((m) => <option key={m} value={m}>{monatKurz(m)}</option>)}
				{aktuell !== "" && !monate.includes(aktuell) && <option value={aktuell}>{monatKurz(aktuell)}</option>}
			</select>
			<button className="zeit-btn primaer" disabled={aktionen.laeuft || auswahl === ""} onClick={() => void aktionen.exportieren(auswahl)}>⇩ excel exportieren</button>
			<span className="mono" style={{ fontSize: 10, color: "var(--dim)" }}>schreibt in den Exportordner aus config.json, nie über eine vorhandene Datei</span>
		</div>
	);
}

export function ArbeitszeitView({ status, aktionen }: { status: ZeitStatus | null; aktionen?: ZeitAktionen }): JSX.Element {
	const [edit, setEdit] = useState<string | null>(null);
	// Vertrag "Banner statt Daten": bei fehlendem oder unverlässlichem Stand nichts zeigen,
	// das als echter Wert durchgehen könnte. stale zeigt alles, mit Banner und Refresh-Knopf oben.
	if (status === null || zeitHealth(status) === "error") {
		return (
			<>
				<ZeitBanner status={status} />
				<RefreshKnopf aktionen={aktionen} />
			</>
		);
	}
	return (
		<>
			<ZeitBanner status={status} />
			{zeitHealth(status) === "stale" && <RefreshKnopf aktionen={aktionen} />}
			<Heute status={status} aktionen={aktionen} />
			<Kennzahlen status={status} />
			<OffeneTage status={status} onSpringe={setEdit} lesend={aktionen === undefined} />
			<TagesListe status={status} aktionen={aktionen} edit={edit} setEdit={setEdit} />
			<div style={{ margin: "10px 18px 0", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
				<div className="featured" style={{ padding: "12px 14px" }}>
					<span className="ctitle" style={{ marginBottom: 8 }}>▮ stunden je kalenderwoche</span>
					<StundenBalken wochen={status.wochen} schnitt={status.wochen_schnitt} />
				</div>
				<div className="featured" style={{ padding: "12px 14px" }}>
					<span className="ctitle" style={{ marginBottom: 8 }}>▮ monate · ist gegen soll</span>
					<MonatsBalken monate={status.saldo.monate} />
				</div>
			</div>
			{status.befunde.length > 0 && (
				<div className="featured" style={{ margin: "10px 18px 0", padding: "10px 14px", borderColor: "#3a2414" }}>
					<span className="ctitle" style={{ color: "var(--accent)" }}>befunde in den monatsdateien</span>
					{status.befunde.map((b, i) => <div key={i} className="mono" style={{ fontSize: 10.5, color: "var(--text)", marginTop: 4 }}>{b}</div>)}
				</div>
			)}
			<Fuss status={status} aktionen={aktionen} />
		</>
	);
}
