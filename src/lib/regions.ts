/**
 * Provinces (مناطق) of Saudi Arabia.
 *
 * A team's province is derived from the city of the university each member
 * studies at, so organisers can open a tournament to a subset of the country
 * without maintaining a second list of institutions by hand.
 */
export const SAUDI_REGIONS = [
  "Riyadh",
  "Makkah",
  "Madinah",
  "Eastern Province",
  "Qassim",
  "Asir",
  "Tabuk",
  "Hail",
  "Northern Borders",
  "Jazan",
  "Najran",
  "Al Baha",
  "Al Jouf",
] as const;

export type SaudiRegion = (typeof SAUDI_REGIONS)[number] | "Other";

/** Region label shown in the admin picker. */
export const REGION_LABEL: Record<SaudiRegion, string> = {
  Riyadh: "Riyadh",
  Makkah: "Makkah",
  Madinah: "Madinah",
  "Eastern Province": "Eastern Province",
  Qassim: "Qassim",
  Asir: "Asir",
  Tabuk: "Tabuk",
  Hail: "Hail",
  "Northern Borders": "Northern Borders",
  Jazan: "Jazan",
  Najran: "Najran",
  "Al Baha": "Al Baha",
  "Al Jouf": "Al Jouf",
  Other: "Outside Saudi Arabia",
};

/**
 * The Arabic name of a province.
 *
 * `allowedRegions` is stored as these English keys — they are the identity of a
 * province, not its label — so a student-facing sentence that joins them reads
 * "Only universities in Riyadh are listed" *inside* an otherwise Arabic sentence.
 * The admin picker can keep the keys; anything a student reads cannot.
 */
const REGION_LABEL_AR: Record<SaudiRegion, string> = {
  Riyadh: "الرياض",
  Makkah: "مكة المكرمة",
  Madinah: "المدينة المنورة",
  "Eastern Province": "المنطقة الشرقية",
  Qassim: "القصيم",
  Asir: "عسير",
  Tabuk: "تبوك",
  Hail: "حائل",
  "Northern Borders": "الحدود الشمالية",
  Jazan: "جازان",
  Najran: "نجران",
  "Al Baha": "الباحة",
  "Al Jouf": "الجوف",
  Other: "خارج السعودية",
};

/** A province's name in the reader's language. */
export function regionLabel(region: SaudiRegion, language: "ar" | "en"): string {
  return language === "ar" ? REGION_LABEL_AR[region] : REGION_LABEL[region];
}

/**
 * City → province. Keys must match the `city` values in `universities.ts`
 * exactly; anything unmapped falls back to `Other`, which is only reachable by
 * an institution the organisers added with a city they typed themselves.
 */
const CITY_REGION: Record<string, SaudiRegion> = {
  Riyadh: "Riyadh",
  "Al-Kharj": "Riyadh",
  "Al-Majmaah": "Riyadh",
  Shaqra: "Riyadh",
  Jeddah: "Makkah",
  Makkah: "Makkah",
  Taif: "Makkah",
  Thuwal: "Makkah",
  Madinah: "Madinah",
  "Al-Bukayriyah": "Qassim",
  Buraydah: "Qassim",
  Dhahran: "Eastern Province",
  Dammam: "Eastern Province",
  "Al-Khobar": "Eastern Province",
  "Al-Ahsa": "Eastern Province",
  "Hafr Al Batin": "Eastern Province",
  Abha: "Asir",
  Tabuk: "Tabuk",
  Hail: "Hail",
  Arar: "Northern Borders",
  Jazan: "Jazan",
  Najran: "Najran",
  "Al Baha": "Al Baha",
  Sakaka: "Al Jouf",
  "Sharm El Sheikh / Al-Tur": "Other",
};

export function regionForCity(city: string): SaudiRegion {
  return CITY_REGION[city.trim()] ?? "Other";
}

export function isSaudiRegion(value: unknown): value is SaudiRegion {
  return typeof value === "string" && (SAUDI_REGIONS as readonly string[]).includes(value);
}

/** Every region the admin picker offers, provinces first, "Other" last. */
export const SELECTABLE_REGIONS: SaudiRegion[] = [...SAUDI_REGIONS, "Other"];
