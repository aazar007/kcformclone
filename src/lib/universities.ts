/**
 * Saudi Arabian universities.
 *
 * **Each university accepts only its own domains**, and the address a member enters must
 * belong to the university they selected — a KSU team cannot roster somebody with an
 * IAU address. That check was a soft warning until it was made strict; see
 * `acceptedEmailDomains` for how the accepted set is decided.
 *
 * `emailDomains` is the institution's own domain(s). Where a university issues students
 * a **separate** subdomain (King Saud's `student.ksu.edu.sa`, King Abdulaziz's
 * `stu.kau.edu.sa`), `studentDomains` names it and then *replaces* `emailDomains` for
 * validation — a student address is the only thing a roster accepts.
 *
 * `region` is derived from `city` rather than typed by hand, so the province a
 * team qualifies under can never drift from the institution's location.
 */
import { regionForCity, type SaudiRegion } from "./regions";

export type UniversitySector = "Government" | "Private";

export interface University {
  id: string;
  name: string;
  nameAr?: string;
  city: string;
  sector: UniversitySector;
  /** A few institutions accept only women, so they are hidden from the male division. */
  womenOnly?: boolean;
  emailDomains: string[];
  /**
   * The domains students are actually issued, when that differs from the
   * institution's own.
   *
   * **When this is present it is the complete accepted set** — `emailDomains` is not
   * also accepted. That is the point: King Saud students hold
   * `@student.ksu.edu.sa`, and the request was that nothing else gets through.
   *
   * Left undefined for every institution whose students use the main domain, so the
   * fallback keeps them registrable. Adding a university's student subdomain is a
   * one-line change here — deliberately, because guessing a subdomain that does not
   * exist would lock out every real student at that institution.
   */
  studentDomains?: string[];
  /** Shown as a hint when the institution's domain is unusual. */
  note?: string;
  /** Derived from `city` — the province this institution competes in. */
  region: SaudiRegion;
  /** True for institutions the organisers added from the admin console. */
  addedByOrganisers?: boolean;
}

/** The curated list, before the province is derived from each city. */
const BASE_UNIVERSITIES: Omit<University, "region">[] = [
  { id: "ksu", name: "King Saud University", nameAr: "جامعة الملك سعود", city: "Riyadh", sector: "Government", emailDomains: ["ksu.edu.sa"], studentDomains: ["student.ksu.edu.sa"] },
  { id: "kau", name: "King Abdulaziz University", nameAr: "جامعة الملك عبدالعزيز", city: "Jeddah", sector: "Government", emailDomains: ["kau.edu.sa"], studentDomains: ["stu.kau.edu.sa"] },
  { id: "kfupm", name: "King Fahd University of Petroleum & Minerals", nameAr: "جامعة الملك فهد للبترول والمعادن", city: "Dhahran", sector: "Government", emailDomains: ["kfupm.edu.sa"] },
  { id: "kaust", name: "King Abdullah University of Science and Technology", nameAr: "جامعة الملك عبدالله للعلوم والتقنية", city: "Thuwal", sector: "Government", emailDomains: ["kaust.edu.sa"] },
  { id: "iau", name: "Imam Abdulrahman Bin Faisal University", nameAr: "جامعة الإمام عبدالرحمن بن فيصل", city: "Dammam", sector: "Government", emailDomains: ["iau.edu.sa"] },
  { id: "kku", name: "King Khalid University", nameAr: "جامعة الملك خالد", city: "Abha", sector: "Government", emailDomains: ["kku.edu.sa"] },
  { id: "qu", name: "Qassim University", nameAr: "جامعة القصيم", city: "Buraydah", sector: "Government", emailDomains: ["qu.edu.sa"] },
  { id: "taibahu", name: "Taibah University", nameAr: "جامعة طيبة", city: "Madinah", sector: "Government", emailDomains: ["taibahu.edu.sa"] },
  { id: "uqu", name: "Umm Al-Qura University", nameAr: "جامعة أم القرى", city: "Makkah", sector: "Government", emailDomains: ["uqu.edu.sa"] },
  { id: "kfu", name: "King Faisal University", nameAr: "جامعة الملك فيصل", city: "Al-Ahsa", sector: "Government", emailDomains: ["kfu.edu.sa"] },
  { id: "nbu", name: "Northern Border University", nameAr: "جامعة الحدود الشمالية", city: "Arar", sector: "Government", emailDomains: ["nbu.edu.sa"] },
  { id: "ut", name: "University of Tabuk", nameAr: "جامعة تبوك", city: "Tabuk", sector: "Government", emailDomains: ["ut.edu.sa"] },
  { id: "jazanu", name: "Jazan University", nameAr: "جامعة جازان", city: "Jazan", sector: "Government", emailDomains: ["jazanu.edu.sa"] },
  { id: "nu", name: "Najran University", nameAr: "جامعة نجران", city: "Najran", sector: "Government", emailDomains: ["nu.edu.sa"] },
  { id: "uoh", name: "University of Hail", nameAr: "جامعة حائل", city: "Hail", sector: "Government", emailDomains: ["uoh.edu.sa"] },
  { id: "ju", name: "Al Jouf University", nameAr: "جامعة الجوف", city: "Sakaka", sector: "Government", emailDomains: ["ju.edu.sa"] },
  { id: "bu", name: "Al Baha University", nameAr: "جامعة الباحة", city: "Al Baha", sector: "Government", emailDomains: ["bu.edu.sa"] },
  { id: "psau", name: "Prince Sattam bin Abdulaziz University", nameAr: "جامعة الأمير سطام بن عبدالعزيز", city: "Al-Kharj", sector: "Government", emailDomains: ["psau.edu.sa"] },
  { id: "pnu", name: "Princess Nourah bint Abdulrahman University", nameAr: "جامعة الأميرة نورة بنت عبدالرحمن", city: "Riyadh", sector: "Government", womenOnly: true, emailDomains: ["pnu.edu.sa"] },
  { id: "ksau-hs", name: "King Saud bin Abdulaziz University for Health Sciences", nameAr: "جامعة الملك سعود بن عبدالعزيز للعلوم الصحية", city: "Riyadh", sector: "Government", emailDomains: ["ksau-hs.edu.sa"] },
  { id: "seu", name: "Saudi Electronic University", nameAr: "الجامعة السعودية الإلكترونية", city: "Riyadh", sector: "Government", emailDomains: ["seu.edu.sa"] },
  { id: "iu", name: "Islamic University of Madinah", nameAr: "الجامعة الإسلامية بالمدينة المنورة", city: "Madinah", sector: "Government", emailDomains: ["iu.edu.sa"] },
  { id: "mu", name: "Majmaah University", nameAr: "جامعة المجمعة", city: "Al-Majmaah", sector: "Government", emailDomains: ["mu.edu.sa"] },
  { id: "su", name: "Shaqra University", nameAr: "جامعة شقراء", city: "Shaqra", sector: "Government", emailDomains: ["su.edu.sa"] },
  { id: "imamu", name: "Imam Muhammad ibn Saud Islamic University", nameAr: "جامعة الإمام محمد بن سعود الإسلامية", city: "Riyadh", sector: "Government", emailDomains: ["imamu.edu.sa"] },
  { id: "uj", name: "University of Jeddah", nameAr: "جامعة جدة", city: "Jeddah", sector: "Government", emailDomains: ["uj.edu.sa"] },
  { id: "tu", name: "Taif University", nameAr: "جامعة الطائف", city: "Taif", sector: "Government", emailDomains: ["tu.edu.sa"] },
  { id: "uhb", name: "University of Hafr Al Batin", nameAr: "جامعة حفر الباطن", city: "Hafr Al Batin", sector: "Government", emailDomains: ["uhb.edu.sa"] },
  { id: "ksui", name: "King Salman International University", nameAr: "جامعة الملك سلمان الدولية", city: "Sharm El Sheikh / Al-Tur", sector: "Government", emailDomains: ["ksui.edu.sa"] },
  { id: "fbsu", name: "Fahad Bin Sultan University", nameAr: "جامعة فهد بن سلطان", city: "Tabuk", sector: "Private", emailDomains: ["fbsu.edu.sa"] },
  { id: "psu", name: "Prince Sultan University", nameAr: "جامعة الأمير سلطان", city: "Riyadh", sector: "Private", emailDomains: ["psu.edu.sa"] },
  { id: "pmu", name: "Prince Mohammad Bin Fahd University", nameAr: "جامعة الأمير محمد بن فهد", city: "Al-Khobar", sector: "Private", emailDomains: ["pmu.edu.sa"] },
  { id: "alfaisal", name: "Alfaisal University", nameAr: "جامعة الفيصل", city: "Riyadh", sector: "Private", emailDomains: ["alfaisal.edu"], note: "Alfaisal uses .edu rather than .edu.sa" },
  { id: "effat", name: "Effat University", nameAr: "جامعة عفت", city: "Jeddah", sector: "Private", womenOnly: true, emailDomains: ["effatuniversity.edu.sa"] },
  { id: "yu", name: "Al Yamamah University", nameAr: "جامعة اليمامة", city: "Riyadh", sector: "Private", emailDomains: ["yu.edu.sa"] },
  { id: "dau", name: "Dar Al Uloom University", nameAr: "جامعة دار العلوم", city: "Riyadh", sector: "Private", emailDomains: ["dau.edu.sa"] },
  { id: "aou", name: "Arab Open University", nameAr: "الجامعة العربية المفتوحة", city: "Riyadh", sector: "Private", emailDomains: ["aou.edu.sa"] },
  { id: "ubt", name: "University of Business and Technology", nameAr: "جامعة الأعمال والتكنولوجيا", city: "Jeddah", sector: "Private", emailDomains: ["ubt.edu.sa"] },
  { id: "um", name: "AlMaarefa University", nameAr: "جامعة المعرفة", city: "Riyadh", sector: "Private", emailDomains: ["um.edu.sa"] },
  { id: "riyadh", name: "Riyadh Elm University", nameAr: "جامعة رياض العلم", city: "Riyadh", sector: "Private", emailDomains: ["riyadh.edu.sa"] },
  { id: "ibnsina", name: "Ibn Sina National College", nameAr: "كلية ابن سينا الأهلية", city: "Jeddah", sector: "Private", emailDomains: ["ibnsina.edu.sa"] },
  { id: "sr", name: "Sulaiman Al Rajhi University", nameAr: "جامعة سليمان الراجحي", city: "Al-Bukayriyah", sector: "Private", emailDomains: ["sr.edu.sa"] },
  { id: "bmc", name: "Batterjee Medical College", nameAr: "كلية البترجي الطبية", city: "Jeddah", sector: "Private", emailDomains: ["bmc.edu.sa"] },
];

export const UNIVERSITIES: University[] = BASE_UNIVERSITIES.map((university) => ({
  ...university,
  region: regionForCity(university.city),
}));

export const UNIVERSITY_SECTOR_LABEL = {
  Government: "Government",
  Private: "Private",
} as const;

/**
 * The provinces actually represented in the list — used by the admin console to
 * offer only regions that at least one institution competes in.
 */
export function representedRegions(): SaudiRegion[] {
  const seen = new Set<SaudiRegion>();
  for (const university of UNIVERSITIES) seen.add(university.region);
  return [...seen];
}

export function universityById(id: string) {
  return UNIVERSITIES.find((u) => u.id === id) ?? null;
}

/**
 * The domains an address may use to count as a member of this university.
 *
 * `studentDomains` wins outright when it exists, rather than being added to the
 * institutional list — that is what makes "KSU students use `student.ksu.edu.sa`" a rule
 * instead of a suggestion. Everyone else falls back to the institution's own domain,
 * which is already strict to that university.
 */
export function acceptedEmailDomains(university: University): string[] {
  return university.studentDomains?.length ? university.studentDomains : university.emailDomains;
}

/** The domain part of an address, lower-cased. Exported for the form's live hint. */
export function emailDomainOf(email: string): string {
  const at = email.lastIndexOf("@");
  return at === -1 ? "" : email.slice(at + 1).trim().toLowerCase();
}

/**
 * Whether an address belongs to this university.
 *
 * A subdomain of an accepted domain counts — `mail.student.ksu.edu.sa` is still King
 * Saud — but nothing outside it does. `gmail.com`, a lookalike such as
 * `ksu.edu.sa.example.com`, and a different university's domain are all refused.
 */
export function emailMatchesUniversity(email: string, university: University): boolean {
  const domain = emailDomainOf(email);
  if (!domain) return false;
  return acceptedEmailDomains(university).some(
    (allowed) => domain === allowed.toLowerCase() || domain.endsWith(`.${allowed.toLowerCase()}`),
  );
}
