/**
 * Escapes unsafe HTML characters to prevent XSS.
 * Replaces &, <, >, ", and ' with their corresponding HTML entities.
 */
export function escapeHtml(str: string): string {
  if (typeof str !== 'string') {
    return '';
  }
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export default escapeHtml;
