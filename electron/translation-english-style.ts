const terminalPeriodPattern = /\.(?=(?:["'”’)]*)\s*$)/;

export function normalizeComposerEnglishStyle(value: string) {
  let text = (value || '').trim();
  text = text.replace(/[—–]/g, ', ').replace(/[；;]/g, ',').replace(/-/g, ' ');
  text = text.replace(terminalPeriodPattern, '');
  text = text.replace(/\s+,/g, ',').replace(/,\s*,+/g, ',').replace(/[ \t]{2,}/g, ' ').trim();
  return text;
}
