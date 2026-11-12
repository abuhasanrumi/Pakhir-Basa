import { formatTk } from "./format";

const COLORS = {
  bg: "#fbfbfa",
  primary: "#12281e",
  accent: "#d8af54",
  text: "#14221b",
  muted: "#5e6f66",
  line: "#e3e8e5",
  due: "#b91c1c",
  credit: "#047857",
};

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

// Draws a month settlement card (for WhatsApp/Messenger) and returns it as a PNG blob.
export async function renderReportImage({ messName, monthName, range, mealRate, totalMeals, mealCost, deposits, rows }) {
  if (document.fonts?.ready) await document.fonts.ready;
  const font = "Outfit, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif";
  const width = 1080;
  const padding = 64;
  const rowHeight = 92;
  const headerHeight = 360;
  const statsHeight = 170;
  const height = headerHeight + statsHeight + 70 + rows.length * rowHeight + 120;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, width, height);

  // Header band
  const gradient = ctx.createLinearGradient(0, 0, width, headerHeight);
  gradient.addColorStop(0, "#12281e");
  gradient.addColorStop(1, "#27523f");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, headerHeight);

  ctx.fillStyle = COLORS.accent;
  ctx.font = `700 30px ${font}`;
  ctx.fillText((messName || "Mess").toUpperCase(), padding, 92);
  ctx.fillStyle = "#ffffff";
  ctx.font = `800 64px ${font}`;
  ctx.fillText(monthName, padding, 172);
  ctx.fillStyle = "rgba(255,255,255,0.72)";
  ctx.font = `500 30px ${font}`;
  ctx.fillText(range, padding, 222);

  ctx.fillStyle = "rgba(255,255,255,0.12)";
  roundRect(ctx, width - padding - 300, 70, 300, 170, 28);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.font = `600 28px ${font}`;
  ctx.textAlign = "right";
  ctx.fillText("Meal rate", width - padding - 32, 122);
  ctx.fillStyle = "#ffffff";
  ctx.font = `800 64px ${font}`;
  ctx.fillText(formatTk(mealRate), width - padding - 32, 200);
  ctx.textAlign = "left";

  // Stats
  const stats = [
    ["Meals", String(totalMeals)],
    ["Meal cost", formatTk(mealCost)],
    ["Deposits", formatTk(deposits)],
  ];
  const statWidth = (width - padding * 2 - 32) / 3;
  stats.forEach(([label, value], index) => {
    const x = padding + index * (statWidth + 16);
    const y = headerHeight - 60;
    ctx.fillStyle = "#ffffff";
    roundRect(ctx, x, y, statWidth, 150, 24);
    ctx.fill();
    ctx.strokeStyle = COLORS.line;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = COLORS.muted;
    ctx.font = `700 24px ${font}`;
    ctx.fillText(label.toUpperCase(), x + 28, y + 52);
    ctx.fillStyle = COLORS.primary;
    ctx.font = `800 44px ${font}`;
    ctx.fillText(value, x + 28, y + 112);
  });

  // People
  let y = headerHeight + statsHeight + 40;
  ctx.fillStyle = COLORS.muted;
  ctx.font = `700 24px ${font}`;
  ctx.fillText("PERSON", padding, y);
  ctx.textAlign = "right";
  ctx.fillText("BALANCE", width - padding, y);
  ctx.textAlign = "left";
  y += 24;

  rows.forEach((row) => {
    ctx.strokeStyle = COLORS.line;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(padding, y);
    ctx.lineTo(width - padding, y);
    ctx.stroke();

    ctx.fillStyle = COLORS.text;
    ctx.font = `700 34px ${font}`;
    ctx.fillText(row.name, padding, y + 50);
    ctx.fillStyle = COLORS.muted;
    ctx.font = `500 24px ${font}`;
    ctx.fillText(`${Number(row.meals || 0).toFixed(1)} meals · paid ${formatTk(row.paid || 0)}`, padding, y + 80);

    const balance = Number(row.balance || 0);
    ctx.textAlign = "right";
    ctx.fillStyle = balance < 0 ? COLORS.due : balance > 0 ? COLORS.credit : COLORS.muted;
    ctx.font = `800 36px ${font}`;
    ctx.fillText(formatTk(Math.abs(balance)), width - padding, y + 50);
    ctx.font = `600 24px ${font}`;
    ctx.fillText(balance < 0 ? "owes" : balance > 0 ? "gets back" : "settled", width - padding, y + 80);
    ctx.textAlign = "left";
    y += rowHeight;
  });

  ctx.fillStyle = COLORS.muted;
  ctx.font = `500 22px ${font}`;
  ctx.fillText(`Made with Pakhir Basa · ${new Date().toLocaleDateString("en", { day: "numeric", month: "short", year: "numeric" })}`, padding, height - 48);

  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}
