import * as React from "react";
import { Icons } from "./icons";
import { effektivHealth, alterMinuten, type DruckStatus } from "./loadDruck";
import { UNGEPRUEFT, tageText, sortiert, materialText } from "./DruckView";

/**
 * Eine Zeile in der ÜBERSICHT, direkt unter dem Briefing. Klick springt auf Tab 03.
 * Zeigt nur, was eine Handlung auslösen könnte: laufender Druck, ältestes ungeprüftes
 * Projekt, Nachkauf. Bei nicht gesundem Stand steht die Warnung an dieser Stelle.
 */
export function DruckStatusZeile({ status, onOpen }: { status: DruckStatus | null; onOpen: () => void }): JSX.Element {
	const eff = effektivHealth(status);
	let text: React.ReactNode;
	if (status === null) {
		text = <span style={{ color: "var(--dim)" }}>noch kein Stand, läuft der LaunchAgent de.ben.druck-dashboard?</span>;
	} else if (eff !== "ok") {
		// health.grund ist laut Vertrag ein String, aber von Hand editiertes status.json
		// kann trotzdem etwas anderes tragen. Erst typeof prüfen, dann anzeigen.
		const grund = typeof status.health.grund === "string" ? status.health.grund : "";
		text = <span style={{ color: "var(--accent)" }}>⚠ {eff}{eff === "stale" ? `: Stand vor ${alterMinuten(status) ?? "?"} min` : ""}{grund !== "" ? `, ${grund}` : ""}</span>;
	} else {
		const l = status.laufend;
		// sortiert() aus DruckView.tsx macht die Absicherung gegen kaputte Projekt-
		// Einträge und nicht-normalisierte letzter_druck-Werte bereits, kein Grund,
		// das hier zu duplizieren. Erster Treffer = ältestes ungeprüftes Projekt.
		const eintrag = sortiert(status.projekte).find(([, p]) => p.zustand !== null && UNGEPRUEFT.has(p.zustand));
		const knapp = status.bestand.filter((b) => b.knapp).length;
		text = (
			<>
				{l !== null
					? <>druckt <span style={{ color: "var(--accent)" }}>{materialText(l.materialien)}</span> {l.laeuft_minuten ?? "?"} min</>
					: <span style={{ color: "var(--muted)" }}>kein Druck aktiv</span>}
				{eintrag !== undefined && <> · <span style={{ color: "var(--accent)" }}>{eintrag[0]}</span>{eintrag[2] !== null ? ` seit ${tageText(eintrag[2])}` : ""} ungeprüft</>}
				{knapp > 0 && <> · {knapp} nachkaufen</>}
			</>
		);
	}
	return (
		<div style={{ margin: "4px 18px 0" }}>
			<div className="featured" onClick={onOpen} title="3D-Druck-Tab öffnen" style={{ padding: "10px 14px", display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
				<span className="ctitle"><Icons.bolt style={{ color: "var(--accent)" }} /> 3d-druck</span>
				<span style={{ fontSize: 12.5, color: "#f5f5f5", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{text}</span>
				<span style={{ flex: 1 }} />
				<span className="mono small-caps" style={{ color: "var(--accent)", fontSize: 10.5, letterSpacing: ".12em" }}>[03] ▸</span>
			</div>
		</div>
	);
}
