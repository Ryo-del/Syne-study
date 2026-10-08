const UNITS = ["Б", "КБ", "МБ", "ГБ", "ТБ"];

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0 Б";
  let v = n;
  let i = 0;
  while (v >= 1024 && i < UNITS.length - 1) {
    v /= 1024;
    i += 1;
  }
  const text = v >= 10 || i === 0 ? Math.round(v).toString() : v.toFixed(1).replace(".", ",");
  return `${text} ${UNITS[i]}`;
}