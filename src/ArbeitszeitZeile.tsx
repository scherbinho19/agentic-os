import * as React from "react";
import { Icons } from "./icons";
import { fmtStunden, zeitAlterMinuten, zeitHealth, type ZeitStatus } from "./loadArbeitszeit";
import { monatKurz } from "./ArbeitszeitCharts";

/**
 * Eine Zeile in der ÜBERSICHT unter der 3D-Druck-Zeile. Klick springt auf Tab 04.
 * Zeigt, was heute läuft, den Monatsstand, den Saldo und offene Tage.
 */
export function ArbeitszeitZeile({ status, onOpen }: { status: ZeitStatus | null; onOpen: () => void }): JSX.Element {
	const eff = zeitHealth(status);
	let t: React.ReactNode;
	if (status === null) {
		t = <span style={{ color: "var(--dim)" }}>noch kein Stand, läuft der LaunchAgent de.ben.arbeitszeit?</span>;
	} else if (eff !== "ok") {
		t = <span style={{ color: "var(--accent)" }}>⚠ {eff}{eff === "stale" ? `: Stand vor ${zeitAlterMinuten(status) ?? "?"} min` : ""}{status.health.grund !== "" ? `, ${status.health.grund}` : ""}</span>;
	} else {
		const h = status.heute, m = status.monat, s = status.saldo.stunden;
		const heute = h.zustand === "laeuft" ? <>läuft seit <span style={{ color: "var(--accent)" }}>{h.start ?? "?"}</span></>
			: h.zustand === "pause" ? <>Pause seit <span style={{ color: "var(--accent)" }}>{h.pause_start ?? "?"}</span></>
			: h.zustand === "fertig" ? <>heute {fmtStunden(h.stunden)} h</>
			: h.zustand === "abwesend" ? <>heute {h.art ?? "abwesend"}</>
			: <span style={{ color: "var(--muted)" }}>heute nichts gestempelt</span>;
		t = (
			<>
				{heute} · {monatKurz(m.monat)} <span style={{ color: "var(--accent)" }}>{fmtStunden(m.ist)}</span> / {fmtStunden(m.soll, 0)} h
				{" · "}saldo {s >= 0 ? "+" : ""}{fmtStunden(s)} h
				{status.unvollstaendig.length > 0 && <> · <span style={{ color: "var(--accent)" }}>{status.unvollstaendig.length} offen</span></>}
			</>
		);
	}
	return (
		<div style={{ margin: "4px 18px 0" }}>
			<div className="featured" onClick={onOpen} title="Arbeitszeit-Tab öffnen" style={{ padding: "10px 14px", display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
				<span className="ctitle"><Icons.cal style={{ color: "var(--accent)" }} /> arbeitszeit</span>
				<span style={{ fontSize: 12.5, color: "#f5f5f5", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t}</span>
				<span style={{ flex: 1 }} />
				<span className="mono small-caps" style={{ color: "var(--accent)", fontSize: 10.5, letterSpacing: ".12em" }}>[04] ▸</span>
			</div>
		</div>
	);
}
