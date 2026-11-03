// Moment.js-style date formatting, the format strings Obsidian uses in Templates (`{{time:HH:mm}}`) and Bases
// (`now().format("HH:mm")`). Pure and English only, so it works the same in tests, on desktop and on a phone.
//
// Supported tokens: YYYY YY, MMMM MMM MM M, Do DD D, dddd ddd dd d, HH H hh h, mm m, ss s, SSS, A a, Z.
// Text in square brackets is kept as written: `[at] HH:mm`. Any other character is kept as it is.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Longest token first, so `MMMM` is not read as `MM` twice. */
export const TOKEN_PATTERN = /\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|M|Do|DD|D|dddd|ddd|dd|d|HH|H|hh|h|mm|m|ss|s|SSS|A|a|Z/g;

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

function ordinal(n: number): string {
  const rem = n % 100;
  if (rem >= 11 && rem <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

function offset(date: Date): string {
  const minutes = -date.getTimezoneOffset();
  const sign = minutes >= 0 ? '+' : '-';
  const abs = Math.abs(minutes);
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** Format a date in local time. */
export function formatMoment(date: Date, format: string): string {
  const hour12 = date.getHours() % 12 || 12;
  return format.replace(TOKEN_PATTERN, (token: string, literal: string | undefined) => {
    if (literal !== undefined) return literal;
    switch (token) {
      case 'YYYY':
        return pad(date.getFullYear(), 4);
      case 'YY':
        return pad(date.getFullYear() % 100);
      case 'MMMM':
        return MONTHS[date.getMonth()] ?? '';
      case 'MMM':
        return (MONTHS[date.getMonth()] ?? '').slice(0, 3);
      case 'MM':
        return pad(date.getMonth() + 1);
      case 'M':
        return String(date.getMonth() + 1);
      case 'Do':
        return ordinal(date.getDate());
      case 'DD':
        return pad(date.getDate());
      case 'D':
        return String(date.getDate());
      case 'dddd':
        return DAYS[date.getDay()] ?? '';
      case 'ddd':
        return (DAYS[date.getDay()] ?? '').slice(0, 3);
      case 'dd':
        return (DAYS[date.getDay()] ?? '').slice(0, 2);
      case 'd':
        return String(date.getDay());
      case 'HH':
        return pad(date.getHours());
      case 'H':
        return String(date.getHours());
      case 'hh':
        return pad(hour12);
      case 'h':
        return String(hour12);
      case 'mm':
        return pad(date.getMinutes());
      case 'm':
        return String(date.getMinutes());
      case 'ss':
        return pad(date.getSeconds());
      case 's':
        return String(date.getSeconds());
      case 'SSS':
        return pad(date.getMilliseconds(), 3);
      case 'A':
        return date.getHours() < 12 ? 'AM' : 'PM';
      case 'a':
        return date.getHours() < 12 ? 'am' : 'pm';
      case 'Z':
        return offset(date);
      default:
        return token;
    }
  });
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A regular expression source that matches what `formatMoment` writes for this format, used to recognise a line
 * that holds only the generated text (an "empty" entry). Words, such as day names, match letters.
 */
export function formatToRegex(format: string): string {
  let out = '';
  let last = 0;
  for (const m of format.matchAll(TOKEN_PATTERN)) {
    const at = m.index ?? 0;
    out += escapeRegExp(format.slice(last, at));
    last = at + m[0].length;
    if (m[1] !== undefined) {
      out += escapeRegExp(m[1]);
      continue;
    }
    switch (m[0]) {
      case 'YYYY':
        out += '\\d{4}';
        break;
      case 'YY':
      case 'MM':
      case 'DD':
      case 'HH':
      case 'hh':
      case 'mm':
      case 'ss':
        out += '\\d{2}';
        break;
      case 'M':
      case 'D':
      case 'H':
      case 'h':
      case 'm':
      case 's':
        out += '\\d{1,2}';
        break;
      case 'Do':
        out += '\\d{1,2}(?:st|nd|rd|th)';
        break;
      case 'MMMM':
      case 'dddd':
        out += '[A-Za-z]+';
        break;
      case 'MMM':
      case 'ddd':
        out += '[A-Za-z]{3}';
        break;
      case 'dd':
        out += '[A-Za-z]{2}';
        break;
      case 'd':
        out += '\\d';
        break;
      case 'SSS':
        out += '\\d{3}';
        break;
      case 'A':
      case 'a':
        out += '[AaPp][Mm]';
        break;
      case 'Z':
        out += '[+-]\\d{2}:\\d{2}';
        break;
      default:
        out += escapeRegExp(m[0]);
    }
  }
  return out + escapeRegExp(format.slice(last));
}
