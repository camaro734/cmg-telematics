/**
 * Shared PDF + Excel export utilities.
 * Uses jspdf v4 + jspdf-autotable v5 + xlsx v0.18
 */

// ─── Excel (xlsx) ─────────────────────────────────────────────────────────────

export function exportExcel(
  sheets: { name: string; rows: Record<string, unknown>[] }[],
  filename: string
) {
  import("xlsx").then((XLSX) => {
    const wb = XLSX.utils.book_new();
    for (const sheet of sheets) {
      const ws = XLSX.utils.json_to_sheet(sheet.rows);
      XLSX.utils.book_append_sheet(wb, ws, sheet.name.slice(0, 31));
    }
    XLSX.writeFile(wb, filename);
  });
}

// ─── Route map canvas ─────────────────────────────────────────────────────────

interface RoutePoint { lat: number; lng: number; speed: number | null }

/** Speed → CSS color string (green → yellow → red) */
function speedColor(speed: number): string {
  const s = Math.min(speed, 120);
  if (s <= 60) {
    const t = s / 60;
    return `rgb(${Math.round(34 + t * 216)},${Math.round(197 - t * 6)},${Math.round(94 - t * 83)})`;
  }
  const t = (s - 60) / 60;
  return `rgb(${Math.round(250 - t * 11)},${Math.round(204 - t * 136)},${Math.round(11 + t * 57)})`;
}

/**
 * Draw the route on an HTML Canvas using CartoDB Voyager tile images as base map.
 * Returns a PNG data URL (async — tiles are fetched from CartoDB).
 */
export async function drawRouteImage(
  positions: RoutePoint[],
  width = 550,
  height = 320
): Promise<string> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;

  // Fallback background while tiles load (or if they fail)
  ctx.fillStyle = "#e8e0d8";
  ctx.fillRect(0, 0, width, height);

  if (positions.length === 0) {
    ctx.fillStyle = "#64748b";
    ctx.font = "13px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Sin posiciones registradas", width / 2, height / 2);
    return canvas.toDataURL("image/png");
  }

  const TILE_SIZE = 256;

  // ── Mercator projection ──────────────────────────────────────────────────────
  const lngToWorld = (lng: number) => (lng + 180) / 360;
  const latToWorld = (lat: number) => {
    const sin = Math.sin((lat * Math.PI) / 180);
    return 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI);
  };

  const lats = positions.map((p) => p.lat);
  const lngs = positions.map((p) => p.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);

  // Bounding box with padding (35 % of range, min 0.003°)
  const padLat = Math.max((maxLat - minLat) * 0.35, 0.003);
  const padLng = Math.max((maxLng - minLng) * 0.35, 0.003);
  const bbMinLat = minLat - padLat;
  const bbMaxLat = maxLat + padLat;
  const bbMinLng = minLng - padLng;
  const bbMaxLng = maxLng + padLng;

  // ── Find zoom level where bbox fits the canvas ───────────────────────────────
  let zoom = 18;
  for (; zoom >= 1; zoom--) {
    const wp = Math.pow(2, zoom) * TILE_SIZE;
    const bw = Math.abs(lngToWorld(bbMaxLng) - lngToWorld(bbMinLng)) * wp;
    const bh = Math.abs(latToWorld(bbMinLat) - latToWorld(bbMaxLat)) * wp;
    if (bw <= width * 0.92 && bh <= height * 0.92) break;
  }

  const worldPx = Math.pow(2, zoom) * TILE_SIZE;
  const centerLat = (bbMinLat + bbMaxLat) / 2;
  const centerLng = (bbMinLng + bbMaxLng) / 2;
  const centerWX = lngToWorld(centerLng) * worldPx;
  const centerWY = latToWorld(centerLat) * worldPx;
  const cx = width / 2;
  const cy = height / 2;

  // ── Load CartoDB Voyager tiles ────────────────────────────────────────────────
  const tileX0 = Math.floor((centerWX - cx) / TILE_SIZE);
  const tileX1 = Math.floor((centerWX + cx) / TILE_SIZE);
  const tileY0 = Math.floor((centerWY - cy) / TILE_SIZE);
  const tileY1 = Math.floor((centerWY + cy) / TILE_SIZE);
  const subs = ["a", "b", "c", "d"];
  const tileJobs: Promise<void>[] = [];

  for (let tx = tileX0; tx <= tileX1; tx++) {
    for (let ty = tileY0; ty <= tileY1; ty++) {
      const sub = subs[(Math.abs(tx) + Math.abs(ty)) % 4];
      const url = `https://${sub}.basemaps.cartocdn.com/rastertiles/voyager/${zoom}/${tx}/${ty}.png`;
      const drawX = Math.round(tx * TILE_SIZE - (centerWX - cx));
      const drawY = Math.round(ty * TILE_SIZE - (centerWY - cy));
      tileJobs.push(
        new Promise<void>((resolve) => {
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.onload = () => { ctx.drawImage(img, drawX, drawY, TILE_SIZE, TILE_SIZE); resolve(); };
          img.onerror = () => resolve(); // skip failed tiles silently
          img.src = url;
        })
      );
    }
  }

  // Wait for tiles — max 6 s
  await Promise.race([
    Promise.all(tileJobs),
    new Promise<void>((r) => setTimeout(r, 6000)),
  ]);

  // ── Helper: geographic coords → canvas pixel ─────────────────────────────────
  const toPixel = (lat: number, lng: number) => ({
    x: cx + lngToWorld(lng) * worldPx - centerWX,
    y: cy + latToWorld(lat) * worldPx - centerWY,
  });

  // ── Route polyline (colored by speed) ───────────────────────────────────────
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.lineWidth = 4;

  if (positions.length === 1) {
    const { x, y } = toPixel(positions[0].lat, positions[0].lng);
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.fillStyle = "#1D9E75";
    ctx.fill();
  } else {
    for (let i = 1; i < positions.length; i++) {
      const a = toPixel(positions[i - 1].lat, positions[i - 1].lng);
      const b = toPixel(positions[i].lat, positions[i].lng);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = speedColor(positions[i].speed ?? 0);
      ctx.stroke();
    }
  }

  // ── Markers (A = inicio verde, B = fin rojo) ─────────────────────────────────
  const drawPin = (x: number, y: number, color: string, label: string) => {
    // White halo
    ctx.beginPath();
    ctx.arc(x, y, 10, 0, Math.PI * 2);
    ctx.fillStyle = "white";
    ctx.fill();
    // Colored circle
    ctx.beginPath();
    ctx.arc(x, y, 8, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    // Label
    ctx.fillStyle = "white";
    ctx.font = "bold 9px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, x, y);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
  };

  const first = positions[0];
  const last = positions[positions.length - 1];
  const fp = toPixel(first.lat, first.lng);
  const lp = toPixel(last.lat, last.lng);
  drawPin(fp.x, fp.y, "#22c55e", "A");
  drawPin(lp.x, lp.y, last === first ? "#22c55e" : "#ef4444", "B");

  // ── Speed legend (top-right, white background) ───────────────────────────────
  const legendItems: [string, string][] = [
    ["0 km/h", "#22c55e"],
    ["60 km/h", "#fbbf24"],
    ["120+ km/h", "#ef4444"],
  ];
  const legX = width - 78;
  const legY = 8;
  ctx.fillStyle = "rgba(255,255,255,0.88)";
  ctx.fillRect(legX - 4, legY - 4, 74, legendItems.length * 14 + 8);
  ctx.font = "8px sans-serif";
  legendItems.forEach(([label, color], i) => {
    ctx.fillStyle = color;
    ctx.fillRect(legX, legY + i * 14, 10, 8);
    ctx.fillStyle = "#333";
    ctx.textAlign = "left";
    ctx.fillText(label, legX + 14, legY + i * 14 + 7);
  });

  // ── Attribution ───────────────────────────────────────────────────────────────
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.fillRect(0, height - 16, 200, 16);
  ctx.fillStyle = "#666";
  ctx.font = "7px sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("© OpenStreetMap contributors © CARTO", 3, height - 4);

  return canvas.toDataURL("image/png");
}

// ─── Automation Session PDF ───────────────────────────────────────────────────

export interface SessionForPdf {
  id: string;
  label: string | null;
  color: string | null;
  started_at: string;
  ended_at: string | null;
  position_count: number;
}

export interface PositionForPdf {
  time: string;
  lat: number;
  lng: number;
  speed: number | null;
}

/**
 * Generate a PDF report for a single automation session.
 * Includes: header, session info, route map image, position table.
 */
export async function exportSessionPdf(opts: {
  vehicleName: string;
  licensePlate?: string | null;
  ruleName: string;
  ioKey: string;
  condition: string;
  threshold: number;
  session: SessionForPdf;
  positions: PositionForPdf[];
  brandColor?: string;
}) {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;

  const bc = opts.brandColor ?? "#1D9E75";
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 14;

  // ── Header bar ───────────────────────────────────────────────────────────────
  doc.setFillColor(bc);
  doc.rect(0, 0, pageW, 26, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text("Informe de Automatización", margin, 12);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text(`${opts.vehicleName}${opts.licensePlate ? "  ·  " + opts.licensePlate : ""}`, margin, 20);
  doc.text(new Date().toLocaleString("es-ES"), pageW - margin, 20, { align: "right" });

  let y = 32;

  // ── Session info block ────────────────────────────────────────────────────────
  const ms = (opts.session.ended_at
    ? new Date(opts.session.ended_at)
    : new Date()
  ).getTime() - new Date(opts.session.started_at).getTime();
  const mins = Math.floor(ms / 60000);
  const dur = mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)}h ${mins % 60}min`;
  const condMap: Record<string, string> = { gt: ">", lt: "<", gte: "≥", lte: "≤", eq: "=", neq: "≠" };

  const infoRows: [string, string][] = [
    ["Regla", opts.ruleName],
    ["Disparador", `${opts.ioKey} ${condMap[opts.condition] ?? opts.condition} ${opts.threshold}`],
    ["Inicio", new Date(opts.session.started_at).toLocaleString("es-ES")],
    ["Fin", opts.session.ended_at ? new Date(opts.session.ended_at).toLocaleString("es-ES") : "En curso"],
    ["Duración", dur],
    ["Posiciones registradas", String(opts.session.position_count)],
  ];

  doc.setFillColor(245, 247, 250);
  doc.roundedRect(margin, y, pageW - margin * 2, 8 + infoRows.length * 7, 2, 2, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(40, 40, 40);
  infoRows.forEach(([key, val], i) => {
    doc.setFont("helvetica", "bold");
    doc.setTextColor(80, 80, 80);
    doc.text(key + ":", margin + 4, y + 9 + i * 7);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(30, 30, 30);
    doc.text(val, margin + 50, y + 9 + i * 7);
  });
  y += 10 + infoRows.length * 7 + 6;

  // ── Route map image ───────────────────────────────────────────────────────────
  if (opts.positions.length > 0) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(40, 40, 40);
    doc.text("Mapa de recorrido", margin, y);
    y += 5;

    const imgData = await drawRouteImage(
      opts.positions.map((p) => ({ lat: p.lat, lng: p.lng, speed: p.speed })),
      550,
      320
    );
    // Scale to fit page width maintaining aspect ratio
    const imgW = pageW - margin * 2;
    const imgH = (imgW * 320) / 550;
    doc.addImage(imgData, "PNG", margin, y, imgW, imgH);
    y += imgH + 6;

    // Coordinate reference note
    doc.setFontSize(7);
    doc.setTextColor(120, 120, 120);
    doc.setFont("helvetica", "italic");
    const firstPos = opts.positions[0];
    const lastPos = opts.positions[opts.positions.length - 1];
    doc.text(
      `A (inicio): ${firstPos.lat.toFixed(6)}, ${firstPos.lng.toFixed(6)}   ·   B (fin): ${lastPos.lat.toFixed(6)}, ${lastPos.lng.toFixed(6)}`,
      margin,
      y
    );
    y += 6;
  }

  // ── Positions table ───────────────────────────────────────────────────────────
  if (opts.positions.length > 0) {
    // Deduplicate: skip positions where lat/lng didn't change (within ~5 m)
    const MOVE_EPSILON = 0.00005;
    const uniquePositions = opts.positions.filter((p, i) => {
      if (i === 0) return true;
      const prev = opts.positions[i - 1];
      return (
        Math.abs(p.lat - prev.lat) > MOVE_EPSILON ||
        Math.abs(p.lng - prev.lng) > MOVE_EPSILON
      );
    });

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(40, 40, 40);
    doc.text(
      `Registro de posiciones (${uniquePositions.length} cambios de ubicación)`,
      margin, y
    );
    y += 3;

    autoTable(doc, {
      startY: y,
      head: [["#", "Fecha y hora", "Latitud", "Longitud", "Velocidad (km/h)"]],
      body: uniquePositions.map((p, i) => [
        i + 1,
        new Date(p.time).toLocaleString("es-ES"),
        p.lat.toFixed(6),
        p.lng.toFixed(6),
        p.speed != null ? p.speed : "—",
      ]),
      margin: { left: margin, right: margin },
      headStyles: { fillColor: bc, textColor: 255, fontStyle: "bold", fontSize: 8 },
      bodyStyles: { fontSize: 7.5, textColor: [40, 40, 40] },
      alternateRowStyles: { fillColor: [245, 247, 250] },
      styles: { cellPadding: 2 },
      didDrawPage: (data) => {
        const n = (doc as unknown as { internal: { getNumberOfPages: () => number } })
          .internal.getNumberOfPages();
        doc.setFontSize(7);
        doc.setTextColor(160, 160, 160);
        doc.text(`CMG Telematics — Página ${data.pageNumber} de ${n}`, pageW / 2, pageH - 5, {
          align: "center",
        });
      },
    });
  }

  const safeName = (opts.vehicleName + "_" + opts.ruleName)
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .slice(0, 40);
  doc.save(`automatizacion_${safeName}_${new Date().toISOString().slice(0, 10)}.pdf`);
}

// ─── Generic PDF (jspdf + autotable) ─────────────────────────────────────────

export interface PdfSection {
  title?: string;
  subtitle?: string;
  table?: {
    head: string[][];
    body: (string | number | null)[][];
  };
  text?: string;
}

export async function exportPdf(
  reportTitle: string,
  subtitle: string,
  sections: PdfSection[],
  filename: string,
  brandColor = "#1D9E75"
) {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 14;

  doc.setFillColor(brandColor);
  doc.rect(0, 0, pageW, 22, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text(reportTitle, margin, 13);
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.text(subtitle, margin, 19);
  doc.text(new Date().toLocaleString("es-ES"), pageW - margin, 19, { align: "right" });

  let y = 28;

  for (const section of sections) {
    if (section.title) {
      doc.setTextColor(40, 40, 40);
      doc.setFontSize(10);
      doc.setFont("helvetica", "bold");
      doc.text(section.title, margin, y);
      y += 5;
    }
    if (section.subtitle) {
      doc.setTextColor(100, 100, 100);
      doc.setFontSize(8);
      doc.setFont("helvetica", "normal");
      doc.text(section.subtitle, margin, y);
      y += 5;
    }
    if (section.text) {
      doc.setTextColor(60, 60, 60);
      doc.setFontSize(9);
      doc.setFont("helvetica", "normal");
      const lines = doc.splitTextToSize(section.text, pageW - margin * 2);
      doc.text(lines, margin, y);
      y += lines.length * 5 + 3;
    }
    if (section.table) {
      autoTable(doc, {
        startY: y,
        head: section.table.head,
        body: section.table.body,
        margin: { left: margin, right: margin },
        headStyles: { fillColor: brandColor, textColor: 255, fontStyle: "bold", fontSize: 8 },
        bodyStyles: { fontSize: 8, textColor: [40, 40, 40] },
        alternateRowStyles: { fillColor: [245, 247, 250] },
        styles: { cellPadding: 2 },
        didDrawPage: (data) => {
          const n = (doc as unknown as { internal: { getNumberOfPages: () => number } })
            .internal.getNumberOfPages();
          doc.setFontSize(7);
          doc.setTextColor(160, 160, 160);
          doc.text(
            `CMG Telematics — Página ${data.pageNumber} de ${n}`,
            pageW / 2,
            doc.internal.pageSize.getHeight() - 6,
            { align: "center" }
          );
        },
      });
      y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
    }
    y += 2;
  }

  doc.save(filename);
}
