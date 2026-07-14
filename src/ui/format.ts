export function formatMoney(amount: number): string {
  return `${amount < 0 ? '−$' : '$'}${Math.abs(Math.round(amount))}k`;
}

export function formatTime(time: number | null | undefined): string {
  if (time == null || !Number.isFinite(time)) return '—';
  const minutes = Math.floor(time / 60);
  const seconds = time - minutes * 60;
  return `${minutes}:${seconds.toFixed(2).padStart(5, '0')}`;
}

export function ratingDots(value: number, label: string): string {
  let dots = '';
  for (let index = 0; index < 5; index++)
    dots += `<span class="d${index < value ? ' f' : ''}"></span>`;
  return `<div class="strow"><span style="width:64px">${label}</span><span class="dots">${dots}</span></div>`;
}

export function escapeHtml(value: unknown): string {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;');
}
