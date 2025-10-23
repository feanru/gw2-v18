import { getActiveLanguage } from '../services/langContext.js';

function normalizeLang(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.toLowerCase();
}

function getBannerElement() {
  if (typeof document === 'undefined') return null;
  return document.getElementById('freshness-banner');
}

function formatTimestamp(isoString) {
  if (!isoString) return '';
  try {
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString();
  } catch (err) {
    return '';
  }
}

export function renderFreshnessBanner(meta = {}) {
  const banner = getBannerElement();
  if (!banner) return;
  const {
    stale = false,
    lastUpdated,
    generatedAt,
    warnings = [],
    errors = [],
    lang: metaLang = null,
  } = meta;
  const timestamp = formatTimestamp(lastUpdated || generatedAt);
  const classes = ['freshness-banner'];
  if (stale) {
    classes.push('freshness-banner--stale');
  } else {
    classes.push('freshness-banner--fresh');
  }
  banner.className = classes.join(' ');
  const statusLabel = stale ? 'Datos potencialmente desactualizados' : 'Datos actualizados';
  const timeLabel = timestamp ? `Última generación: ${timestamp}` : '';
  const activeLang = normalizeLang(getActiveLanguage());
  const effectiveLang = normalizeLang(metaLang) || activeLang;
  const langWarning = activeLang && effectiveLang && activeLang !== effectiveLang
    ? `<span class="freshness-banner__lang">Mostrando contenido en ${effectiveLang.toUpperCase()} (preferido: ${activeLang.toUpperCase()})</span>`
    : '';
  const warningsText = Array.isArray(warnings) && warnings.length
    ? `<span class="freshness-banner__warnings">Avisos: ${warnings.join(', ')}</span>`
    : '';
  const errorsText = Array.isArray(errors) && errors.length
    ? `<span class="freshness-banner__errors">Errores: ${errors.join(', ')}</span>`
    : '';
  banner.innerHTML = `
    <strong>${statusLabel}</strong>
    ${timeLabel ? `<span class="freshness-banner__timestamp">${timeLabel}</span>` : ''}
    ${langWarning}
    ${warningsText}
    ${errorsText}
  `;
  banner.classList.remove('hidden');
}

export function hideFreshnessBanner() {
  const banner = getBannerElement();
  if (!banner) return;
  banner.classList.add('hidden');
  banner.innerHTML = '';
}
