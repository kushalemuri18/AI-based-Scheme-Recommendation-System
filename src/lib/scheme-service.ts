import type { ExtractedUserProfile, Scheme } from '@/types'
import { schemes as defaultSchemes } from '@/data/schemes'

let schemes: Scheme[] = [...defaultSchemes]

export function getAllSchemes(): Scheme[] {
  return schemes
}

export function setAllSchemes(newSchemes: any[]): void {
  schemes = newSchemes.map((dbScheme) => {
    const dbId = dbScheme.id || dbScheme._id
    const hardcoded = defaultSchemes.find((h) => h.id === dbId || h.slug === dbScheme.slug)
    return {
      ...dbScheme,
      id: dbId || hardcoded?.id || '',
      rules: dbScheme.rules || hardcoded?.rules || {},
    } as Scheme
  })
}

export function getSchemeById(id: string): Scheme | undefined {
  return schemes.find((scheme) => scheme.id === id)
}

export function getSchemeByQuery(query: string): Scheme | undefined {
  const normalized = normalize(query)

  return schemes.find((scheme) => {
    const aliases = [
      scheme.id,
      scheme.name,
      scheme.name.replace(/[()]/g, ''),
      ...scheme.name.split(/[-()]/),
      ...scheme.name.split(/\s+/),
      ...scheme.name.split(/[^a-zA-Z0-9]+/),
    ].map(normalize)

    return aliases.some((alias) => alias.length > 3 && normalized.includes(alias))
  })
}

export function buildSchemeDocument(scheme: Scheme): string {
  return [
    scheme.name,
    scheme.category,
    scheme.description,
    scheme.benefits.join(' '),
    scheme.documents.join(' '),
  ].join(' ')
}

export function buildProfileQuery(profile: ExtractedUserProfile, userQuery = ''): string {
  return [
    userQuery,
    profile.caste,
    profile.state,
    profile.gender,
    profile.occupation,
    profile.education,
    profile.isStudent ? 'student scholarship education college' : '',
    profile.isFarmer ? 'farmer agriculture landholding' : '',
    profile.isWidow ? 'widow pension women' : '',
    profile.isMinority ? 'minority scholarship' : '',
    profile.isStartupOwner ? 'startup entrepreneur business loan' : '',
    profile.skillDevelopmentInterest ? 'skill training employment' : '',
    profile.disabilityStatus ? 'disability pension social welfare' : '',
    profile.bplStatus ? 'bpl low income welfare health housing' : '',
  ]
    .filter(Boolean)
    .join(' ')
}

export function mergeProfiles(
  base?: ExtractedUserProfile | null,
  extracted?: ExtractedUserProfile | null,
): ExtractedUserProfile {
  return {
    ...base,
    ...Object.fromEntries(
      Object.entries(extracted ?? {}).filter(([, value]) => value !== undefined && value !== null && value !== ''),
    ),
  }
}

/**
 * Adapt a frontend Scheme object into the SchemeModel shape expected by
 * chatbot formatters and the OpenAI prompt builder.
 * Scheme uses: name, applyUrl, officialUrl, rules
 * SchemeModel uses: scheme_name, apply_link, official_link, filters, application_process
 */
export function toSchemeModel(scheme: Scheme): any {
  return {
    id: scheme.id,
    scheme_name: scheme.name,
    category: scheme.category,
    beneficiaries: [],
    state: 'Central',
    income_limit: (scheme.rules as any)?.incomeLimit ?? null,
    age_limit: {
      min: (scheme.rules as any)?.minAge ?? null,
      max: (scheme.rules as any)?.maxAge ?? null,
    },
    eligibility: scheme.benefits,   // best approximation available on Scheme
    benefits: scheme.benefits,
    documents: scheme.documents,
    application_process: [],
    apply_link: scheme.applyUrl,
    official_link: scheme.officialUrl,
    source: scheme.ministry,
    last_date: scheme.deadline ?? null,
    filters: scheme.rules ?? {},
    // Carry through all locale variants so getTranslatedProp() can access them
    nameHi: scheme.nameHi,
    nameTe: (scheme as any).nameTe,
    nameTa: (scheme as any).nameTa,
    nameKn: (scheme as any).nameKn,
    nameMl: (scheme as any).nameMl,
    benefitsHi: (scheme as any).benefitsHi,
    benefitsTe: (scheme as any).benefitsTe,
    benefitsTa: (scheme as any).benefitsTa,
    benefitsKn: (scheme as any).benefitsKn,
    benefitsMl: (scheme as any).benefitsMl,
    documentsHi: (scheme as any).documentsHi,
    documentsTe: (scheme as any).documentsTe,
    documentsTa: (scheme as any).documentsTa,
    documentsKn: (scheme as any).documentsKn,
    documentsMl: (scheme as any).documentsMl,
    // Keep the original Scheme fields so eligibility-service.ts rule checks still work
    name: scheme.name,
    applyUrl: scheme.applyUrl,
    officialUrl: scheme.officialUrl,
    rules: scheme.rules,
  }
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
}
