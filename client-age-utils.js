/**
 * Age displayed next to DOB in Client at a Glance.
 * This value is calculated from DOB; it must never be stored as a fixed age.
 * Supports the CRM's MM/DD/YYYY form input and its ISO YYYY-MM-DD database dates.
 */
export function ageFromBirthDate(dob, today = new Date()) {
  const raw = String(dob ?? '').trim();
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!us && !iso) return null;
  const year = Number(us ? us[3] : iso[1]);
  const month = Number(us ? us[1] : iso[2]);
  const day = Number(us ? us[2] : iso[3]);
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  // Noon avoids midnight/DST surprises when checking date validity.
  const birth = new Date(year, month - 1, day, 12);
  if (birth.getFullYear() !== year || birth.getMonth() + 1 !== month || birth.getDate() !== day) return null;
  if (!(today instanceof Date) || Number.isNaN(today.getTime())) return null;
  let age = today.getFullYear() - year;
  const monthNow = today.getMonth() + 1;
  if (monthNow < month || (monthNow === month && today.getDate() < day)) age -= 1;
  return age < 0 ? null : age;
}
