import { INDIAN_STATES } from '@/data/states'
import { getRelevantSchemes } from '@/lib/eligibility-service'
import { extractProfileWithChatGPT, generateChatGPTSchemeResponse } from '@/lib/openai-chat-service'
import { getSchemeByQuery, mergeProfiles, toSchemeModel } from '@/lib/scheme-service'
import type { ChatMessage, ExtractedUserProfile, RankedScheme, SchemeModel, UserProfile } from '@/types'

export type QueryIntent =
  | 'documents'
  | 'eligibility'
  | 'benefits'
  | 'application_process'
  | 'deadline'
  | 'overview'
  | 'recommendation'

export function detectQueryIntent(query: string): QueryIntent {
  const lower = query.toLowerCase()

  if (/document|papers?|certificate|proof|required\s*doc/i.test(lower)) return 'documents'
  if (/eligib|who\s*can|am\s*i\s*eligible|qualify|criteria|condition/i.test(lower)) return 'eligibility'
  if (/benefit|advantage|what\s*(do|will)\s*i\s*get|amount|money|stipend|subsid/i.test(lower)) return 'benefits'
  if (/how\s*to\s*apply|application\s*process|apply\s*online|registration|step|procedure/i.test(lower)) return 'application_process'
  if (/deadline|last\s*date|due\s*date|when\s*(is|does)\s*(the|it)\s*(end|close|expire)/i.test(lower)) return 'deadline'
  if (/detail|tell\s*me\s*about|what\s*is|explain|overview|information|full\s*detail/i.test(lower)) return 'overview'

  return 'recommendation'
}

export async function sendRagChatMessage(
  messages: ChatMessage[],
  locale: string,
  storedProfile?: UserProfile | null,
): Promise<string> {
  const userMessages = messages.filter((message) => message.role === 'user')
  const lastUserMessage = userMessages.at(-1)

  if (!lastUserMessage) {
    const t = CHAT_TRANSLATIONS[locale] || CHAT_TRANSLATIONS.en
    return t.typeQuestion
  }

  const userQuery = lastUserMessage.content
  const queryIntent = detectQueryIntent(userQuery)
  const baseProfile = storedProfile ? mapUserProfile(storedProfile) : {}
  const memoryProfile = await extractConversationProfile(userMessages)
  const userProfile = mergeProfiles(baseProfile, memoryProfile)
  const rawScheme = getSchemeByQuery(userQuery)
  const namedScheme = rawScheme ? toSchemeModel(rawScheme) as SchemeModel : undefined

  if (namedScheme && isSchemeDetailQuestion(userQuery)) {
    const rankedScheme = buildSingleSchemeResult(namedScheme)
    const fallbackResponse = formatFocusedResponse(namedScheme, userProfile, queryIntent, locale)

    return generateChatGPTSchemeResponse({
      messages,
      userProfile,
      rankedSchemes: [rankedScheme],
      fallbackResponse,
      queryIntent,
      locale,
    })
  }

  const rankedSchemes = await getRelevantSchemes(userProfile, userQuery)
  const usefulSchemes = rankedSchemes
    .filter((result) => result.confidenceScore >= 20)
    .slice(0, 6)

  if (!usefulSchemes.length) {
    return formatNoMatch(userProfile, locale)
  }

  const fallbackResponse = formatRecommendationResponse(userQuery, userProfile, usefulSchemes, locale)

  return generateChatGPTSchemeResponse({
    messages,
    userProfile,
    rankedSchemes: usefulSchemes,
    fallbackResponse,
    queryIntent,
    locale,
  })
}

export async function extractUserProfileFromQuery(query: string): Promise<ExtractedUserProfile> {
  const apiKey = import.meta.env.VITE_OPENROUTER_API_KEY ?? import.meta.env.VITE_GEMINI_API_KEY

  const chatGPTProfile = await extractProfileWithChatGPT(query)
  if (chatGPTProfile) return mergeProfiles(extractProfileWithRules(query), sanitizeProfile(chatGPTProfile))

  if (apiKey) {
    const llmProfile = await extractProfileWithLlm(query, apiKey)
    if (llmProfile) return mergeProfiles(extractProfileWithRules(query), llmProfile)
  }

  return extractProfileWithRules(query)
}

async function extractConversationProfile(messages: ChatMessage[]): Promise<ExtractedUserProfile> {
  let profile: ExtractedUserProfile = {}

  for (const message of messages) {
    profile = mergeProfiles(profile, await extractUserProfileFromQuery(message.content))
  }

  return profile
}

function mapUserProfile(profile: UserProfile): ExtractedUserProfile {
  return {
    caste: profile.casteCategory,
    state: profile.state,
    age: profile.age,
    gender: profile.gender,
    occupation: profile.employmentStatus,
    education: profile.qualification,
    income: profile.familyIncome,
    disabilityStatus: profile.disabilityStatus,
    isStudent: profile.isStudent,
    isFarmer: profile.isFarmer,
    isWidow: profile.isWidow,
    isMinority: profile.isMinority,
    isSeniorCitizen: profile.isSeniorCitizen,
    isStartupOwner: profile.isStartupOwner,
    skillDevelopmentInterest: profile.skillDevelopmentInterest,
    bplStatus: profile.bplStatus,
  }
}

async function extractProfileWithLlm(
  query: string,
  apiKey: string,
): Promise<ExtractedUserProfile | null> {
  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'google/gemini-2.0-flash-001',
        messages: [
          {
            role: 'system',
            content: `Extract a reusable government scheme user profile from the message.
Return only compact JSON with these optional keys:
caste, state, age, gender, occupation, education, income, disabilityStatus, isStudent, isFarmer, isWidow, isMinority, isStartupOwner, skillDevelopmentInterest, bplStatus.
Use exact values where possible: caste General/OBC/SC/ST/EWS; gender Male/Female/Other; occupation Employed/Unemployed/Self-Employed/Student/Retired.
Map farmers to isFarmer true, students to isStudent true and occupation Student, widows to isWidow true, women entrepreneurs to gender Female and isStartupOwner true.
Do not guess missing values.`,
          },
          { role: 'user', content: query },
        ],
      }),
    })

    if (!response.ok) return null

    const data = (await response.json()) as { choices?: { message?: { content?: string } }[] }
    const content = data.choices?.[0]?.message?.content ?? '{}'
    const json = content.match(/\{[\s\S]*\}/)?.[0] ?? '{}'
    return sanitizeProfile(JSON.parse(json) as ExtractedUserProfile)
  } catch {
    return null
  }
}

function extractProfileWithRules(query: string): ExtractedUserProfile {
  const lower = query.toLowerCase()
  const profile: ExtractedUserProfile = {}
  const state = INDIAN_STATES.find((item) => lower.includes(item.toLowerCase()))
  const ageMatch =
    lower.match(/\b(?:i am|i'm|age|aged)\s*(\d{1,2})\b/) ??
    lower.match(/\b(\d{1,2})\s*(?:years?|yrs?)\s*old\b/)
  const incomeMatch = lower.match(/(?:income|earn|earns|earning|salary|family income)[^\d]*(\d+(?:,\d+)*(?:\.\d+)?)\s*(lakh|lac|k|thousand)?/)

  if (state) profile.state = state
  if (ageMatch) profile.age = Number(ageMatch[1])
  if (incomeMatch) profile.income = parseIncome(incomeMatch[1], incomeMatch[2])
  if (/\bobc\b/.test(lower)) profile.caste = 'OBC'
  if (/\bsc\b|scheduled caste/.test(lower)) profile.caste = 'SC'
  if (/\bst\b|scheduled tribe/.test(lower)) profile.caste = 'ST'
  if (/\bews\b/.test(lower)) profile.caste = 'EWS'
  if (/\bgeneral\b/.test(lower)) profile.caste = 'General'
  if (/\bfemale\b|\bwoman\b|\bwomen\b|\bgirl\b/.test(lower)) profile.gender = 'Female'
  if (/\bmale\b|\bman\b|\bboy\b/.test(lower)) profile.gender = 'Male'
  if (/\bstudent\b|studying|college|school|btech|engineering|mtech|graduate|scholarship/.test(lower)) {
    profile.occupation = 'Student'
    profile.isStudent = true
  }
  if (/\bfarmer\b|farming|agriculture|landholding|pm kisan|kisan\b/.test(lower)) profile.isFarmer = true
  if (/\bwidow\b|widowed\b/.test(lower)) {
    profile.isWidow = true
    profile.gender = profile.gender ?? 'Female'
  }
  if (/\bminority\b|muslim|christian|sikh|buddhist|jain|parsi/.test(lower)) profile.isMinority = true
  if (/\bdisabled\b|disability|divyang/.test(lower)) profile.disabilityStatus = true
  if (/\bbpl\b|below poverty|low income/.test(lower)) profile.bplStatus = true
  if (/\bstartup\b|entrepreneur|business owner|women entrepreneur|woman entrepreneur/.test(lower)) {
    profile.isStartupOwner = true
    profile.occupation = 'Self-Employed'
  }
  if (/\bskill\b|training|upskill/.test(lower)) profile.skillDevelopmentInterest = true

  const educationMatch = query.match(/\b(BTech|MTech|MBA|MBBS|BSc|BA|BCom|MSc|MA|12th|10th|PhD|Graduate|Engineering)\b/i)
  if (educationMatch) profile.education = educationMatch[1]

  return sanitizeProfile(profile)
}

function sanitizeProfile(profile: ExtractedUserProfile): ExtractedUserProfile {
  return Object.fromEntries(
    Object.entries(profile).filter(([, value]) => value !== undefined && value !== null && value !== ''),
  ) as ExtractedUserProfile
}

function parseIncome(amount: string, unit?: string): number {
  const value = Number(amount.replace(/,/g, ''))
  if (unit === 'lakh' || unit === 'lac') return value * 100000
  if (unit === 'k' || unit === 'thousand') return value * 1000
  return value
}

function isSchemeDetailQuestion(query: string): boolean {
  return /detail|benefit|document|apply|application|process|last date|deadline|eligib|how can i get|how to get|criteria|condition|amount|money|stipend|subsid|step|procedure|certificate|proof|papers?|overview|tell me about|what is|explain|information/i.test(query)
}

function buildSingleSchemeResult(scheme: SchemeModel): RankedScheme {
  return {
    scheme,
    rank: 1,
    semanticScore: 1,
    eligibilityScore: 1,
    confidenceScore: 100,
    matchStrength: 'strong',
    eligible: true,
    matchedCriteria: ['User asked about this scheme directly'],
    missingInformation: [],
    disqualifyingCriteria: [],
  }
}

function formatRecommendationResponse(
  userQuery: string,
  profile: ExtractedUserProfile,
  results: RankedScheme[],
  locale: string = 'en',
): string {
  const t = CHAT_TRANSLATIONS[locale] || CHAT_TRANSLATIONS.en
  const strong = results.filter((result) => result.matchStrength === 'strong').slice(0, 3)
  const possible = results
    .filter((result) => result.matchStrength === 'possible' || (result.matchStrength === 'low' && strong.length === 0))
    .slice(0, strong.length ? 3 : 4)
  const title = getRecommendationTitle(userQuery, profile, locale)
  const sections: string[] = [`${title}\n━━━━━━━━━━━━━━━━━━`]

  if (strong.length) {
    sections.push([t.highlyRelevant, ...strong.map((r) => formatSchemeCard(r, locale))].join('\n\n'))
  }

  if (possible.length) {
    sections.push([t.possiblyRelevant, ...possible.map((r) => formatSchemeCard(r, locale))].join('\n\n'))
  }

  sections.push(formatMissingInfo(results, profile, locale))

  return sections.join('\n\n━━━━━━━━━━━━━━━━━━\n\n')
}

function formatSchemeCard(result: RankedScheme, locale: string = 'en'): string {
  const t = CHAT_TRANSLATIONS[locale] || CHAT_TRANSLATIONS.en
  const scheme = result.scheme
  const marker = result.matchStrength === 'strong' ? t.strongMatch : t.possibleMatch
  const cautions = result.disqualifyingCriteria.length
    ? `\n${t.cautionsHeader}\n${result.disqualifyingCriteria.map((item) => `• ${item}`).join('\n')}`
    : ''

  const nameVal = getTranslatedProp(scheme, 'name', locale) || scheme.scheme_name
  const benefitsVal = getTranslatedProp(scheme, 'benefits', locale) || scheme.benefits
  const eligibilityVal = getTranslatedProp(scheme, 'eligibility', locale) || scheme.eligibility
  const documentsVal = getTranslatedProp(scheme, 'documents', locale) || scheme.documents

  return [
    `🏆 ${nameVal}`,
    `${marker} · ${t.confidence} ${result.confidenceScore}%`,
    '',
    t.whyMatches,
    formatBullets(result.matchedCriteria.length ? result.matchedCriteria.slice(0, 4) : [t.semanticMatchReason]),
    '',
    t.benefits,
    formatBullets(benefitsVal.slice(0, 3)),
    '',
    t.eligibility,
    formatBullets(eligibilityVal.slice(0, 3)),
    '',
    t.documents,
    formatBullets(documentsVal.slice(0, 5)),
    '',
    `${t.apply} ${scheme.apply_link}`,
    `${t.source} ${scheme.source} (${scheme.official_link})`,
    scheme.last_date ? `${t.lastDate} ${scheme.last_date}` : `${t.lastDate} ${t.checkPortal}`,
    cautions,
  ]
    .filter(Boolean)
    .join('\n')
}

function formatFocusedResponse(
  scheme: SchemeModel,
  profile: ExtractedUserProfile,
  intent: QueryIntent,
  locale: string = 'en',
): string {
  const t = CHAT_TRANSLATIONS[locale] || CHAT_TRANSLATIONS.en
  const nameVal = getTranslatedProp(scheme, 'name', locale) || scheme.scheme_name
  const header = `🏆 ${nameVal}\n━━━━━━━━━━━━━━━━━━`

  switch (intent) {
    case 'documents':
      return [
        header,
        '',
        t.documents,
        formatBullets(getTranslatedProp(scheme, 'documents', locale) || scheme.documents),
        '',
        `${t.apply} ${scheme.apply_link}`,
      ].join('\n')

    case 'eligibility':
      return [
        header,
        '',
        t.eligibility,
        formatBullets(getTranslatedProp(scheme, 'eligibility', locale) || scheme.eligibility),
        scheme.age_limit?.min || scheme.age_limit?.max
          ? `\nAge: ${scheme.age_limit.min ?? 'No min'} – ${scheme.age_limit.max ?? 'No max'} years`
          : '',
        scheme.income_limit ? `Income limit: ₹${scheme.income_limit.toLocaleString('en-IN')}` : '',
      ].filter(Boolean).join('\n')

    case 'benefits':
      return [
        header,
        '',
        t.benefits,
        formatBullets(getTranslatedProp(scheme, 'benefits', locale) || scheme.benefits),
      ].join('\n')

    case 'application_process':
      return [
        header,
        '',
        t.howToApply,
        formatBullets(scheme.application_process.map((step, index) => `${index + 1}. ${step}`)),
        '',
        `${t.applyOnline} ${scheme.apply_link}`,
      ].join('\n')

    case 'deadline':
      return [
        header,
        '',
        scheme.last_date
          ? `${t.lastDate} ${scheme.last_date}`
          : `${t.lastDate} ${t.checkPortal}`,
        '',
        `${t.officialPortal} ${scheme.official_link}`,
      ].join('\n')

    case 'overview':
    default:
      return formatSchemeDetails(scheme, profile, locale)
  }
}

function formatSchemeDetails(scheme: SchemeModel, profile: ExtractedUserProfile, locale: string = 'en'): string {
  const t = CHAT_TRANSLATIONS[locale] || CHAT_TRANSLATIONS.en
  const nameVal = getTranslatedProp(scheme, 'name', locale) || scheme.scheme_name
  const benefitsVal = getTranslatedProp(scheme, 'benefits', locale) || scheme.benefits
  const eligibilityVal = getTranslatedProp(scheme, 'eligibility', locale) || scheme.eligibility
  const documentsVal = getTranslatedProp(scheme, 'documents', locale) || scheme.documents

  const knownContext = [
    profile.caste ? `Category: ${profile.caste}` : '',
    profile.state ? `State: ${profile.state}` : '',
    profile.occupation ? `Occupation: ${profile.occupation}` : '',
    profile.isFarmer ? 'Farmer' : '',
    profile.isWidow ? 'Widow' : '',
  ].filter(Boolean)

  return [
    `🏆 ${nameVal}`,
    '━━━━━━━━━━━━━━━━━━',
    knownContext.length ? `${t.basedOnProfile} ${knownContext.join(', ')}` : t.generalOverviewText,
    '',
    t.benefits,
    formatBullets(benefitsVal),
    '',
    t.eligibility,
    formatBullets(eligibilityVal),
    '',
    t.documents,
    formatBullets(documentsVal),
    '',
    t.howToApply,
    formatBullets(scheme.application_process.map((step, index) => `${index + 1}. ${step}`)),
    '',
    `${t.apply} ${scheme.apply_link}`,
    `${t.source} ${scheme.source} (${scheme.official_link})`,
    scheme.last_date ? `${t.lastDate} ${scheme.last_date}` : `${t.lastDate} ${t.checkPortal}`,
  ].join('\n')
}

function formatMissingInfo(results: RankedScheme[], profile: ExtractedUserProfile, locale: string = 'en'): string {
  const t = CHAT_TRANSLATIONS[locale] || CHAT_TRANSLATIONS.en
  const missing = [
    ...new Set(results.flatMap((result) => result.missingInformation)),
  ].filter((field) => isActuallyMissing(field, profile)).slice(0, 5)

  if (!missing.length) {
    return `${t.missingInfoTitle}\n${t.noMissingInfoNeeded}`
  }

  return [
    t.missingInfoTitle,
    t.missingInfoText,
    formatBullets(missing.map((m) => translateField(m, locale))),
  ].join('\n')
}

function formatNoMatch(profile: ExtractedUserProfile, locale: string = 'en'): string {
  const t = CHAT_TRANSLATIONS[locale] || CHAT_TRANSLATIONS.en
  const known = Object.keys(profile).length
    ? `I used your available profile details: ${Object.entries(profile).map(([key, value]) => `${key}: ${value}`).join(', ')}.`
    : 'I do not have profile details yet.'

  return [
    t.noMatch,
    known,
    '',
    t.noMatchHint,
    formatBullets(['student/farmer/entrepreneur/widow status', 'state', 'caste/category', 'annual family income', 'age'].map((m) => translateField(m, locale))),
  ].join('\n')
}

function getRecommendationTitle(query: string, profile: ExtractedUserProfile, locale: string): string {
  const t = CHAT_TRANSLATIONS[locale] || CHAT_TRANSLATIONS.en

  // 1. Query-based checks first (takes highest priority based on active search context)
  if (/student|scholarship|engineering|btech/i.test(query)) return t.studentTitle
  if (/farmer|kisan/i.test(query)) return t.farmerTitle
  if (/entrepreneur|startup|business/i.test(query)) return t.startupTitle
  if (/women|woman/i.test(query)) return t.womenTitle

  // 2. Profile-based checks second
  if (profile.isFarmer) return t.farmerTitle
  if (profile.isStudent) return t.studentTitle
  if (profile.isWidow) return t.widowTitle
  if (profile.isStartupOwner) return t.startupTitle
  if (profile.gender === 'Female') return t.womenTitle

  return t.generalTitle
}

function formatBullets(items: string[]): string {
  return items.map((item) => `• ${item}`).join('\n')
}

function isActuallyMissing(field: string, profile: ExtractedUserProfile): boolean {
  if (field.includes('income')) return profile.income === undefined
  if (field.includes('state')) return !profile.state
  if (field.includes('caste') || field.includes('category')) return !profile.caste
  if (field.includes('age')) return profile.age === undefined
  if (field.includes('gender')) return !profile.gender
  if (field.includes('occupation')) return !profile.occupation && !profile.isFarmer && !profile.isWidow
  if (field.includes('student')) return profile.isStudent === undefined
  if (field.includes('farmer')) return profile.isFarmer === undefined
  return true
}

function getTranslatedProp(scheme: any, prop: string, locale: string): any {
  if (!scheme) return undefined
  if (locale === 'en') return scheme[prop]
  const suffix = locale.charAt(0).toUpperCase() + locale.slice(1) // 'hi' -> 'Hi', 'te' -> 'Te'
  const localizedKey = `${prop}${suffix}`
  return scheme[localizedKey] || scheme[prop]
}

function translateField(field: string, locale: string): string {
  const f = field.toLowerCase()
  if (f.includes('income')) return locale === 'hi' ? 'वार्षिक पारिवारिक आय' : locale === 'te' ? 'సంవత్సర కుటుంబ ఆదాయం' : locale === 'ta' ? 'ஆண்டு குடும்ப வருமானம்' : locale === 'kn' ? 'ವಾರ್ಷಿಕ ಕೌಟುಂಬಿಕ ಆದಾಯ' : locale === 'ml' ? 'വാർഷിക കുടുംബ വരുമാനം' : 'annual family income'
  if (f.includes('state')) return locale === 'hi' ? 'राज्य' : locale === 'te' ? 'రాష్ట్రం' : locale === 'ta' ? 'மாநிலம்' : locale === 'kn' ? 'ರಾಜ್ಯ' : locale === 'ml' ? 'സംസ്ഥാനം' : 'state'
  if (f.includes('caste') || f.includes('category')) return locale === 'hi' ? 'जाति/श्रेणी' : locale === 'te' ? 'కులం/ವರ್గం' : locale === 'ta' ? 'சாதி/பிரிவு' : locale === 'kn' ? 'ಜಾತಿ/ವರ್ಗ' : locale === 'ml' ? 'ജാതി/വിഭാഗം' : 'caste/category'
  if (f.includes('age')) return locale === 'hi' ? 'आयु' : locale === 'te' ? 'వయస్సు' : locale === 'ta' ? 'வயது' : locale === 'kn' ? 'ವಯಸ್ಸು' : locale === 'ml' ? 'പ്രായം' : 'age'
  if (f.includes('gender')) return locale === 'hi' ? 'लिंग' : locale === 'te' ? 'లింగం' : locale === 'ta' ? 'பாலினம்' : locale === 'kn' ? 'ಲಿಂಗ' : locale === 'ml' ? 'ലിംഗം' : 'gender'
  if (f.includes('occupation')) return locale === 'hi' ? 'व्यवसाय' : locale === 'te' ? 'వృత్తి' : locale === 'ta' ? 'தொழில்' : locale === 'kn' ? 'ಉದ್ಯೋಗ' : locale === 'ml' ? 'തൊഴിൽ' : 'occupation'
  if (f.includes('student')) return locale === 'hi' ? 'छात्र स्थिति' : locale === 'te' ? 'విద్యార్థి స్థితి' : locale === 'ta' ? 'மாணவர் நிலை' : locale === 'kn' ? 'ವಿದ್ಯಾರ್ಥಿ ಸ್ಥಿತಿ' : locale === 'ml' ? 'വിദ്യാർത്ഥി നില' : 'student status'
  if (f.includes('farmer')) return locale === 'hi' ? 'किसान स्थिति' : locale === 'te' ? 'రైతు స్థితి' : locale === 'ta' ? 'விவசாயி நிலை' : locale === 'kn' ? 'ರೈത ಸ್ಥಿತಿ' : locale === 'ml' ? 'കർഷക നില' : 'farmer status'
  return field
}

const CHAT_TRANSLATIONS: Record<string, Record<string, string>> = {
  en: {
    studentTitle: '🎓 STUDENT SCHEMES FOR YOU',
    farmerTitle: '🌾 FARMER SCHEMES FOR YOU',
    widowTitle: '🛡️ WIDOW WELFARE SCHEMES FOR YOU',
    startupTitle: '🚀 BUSINESS AND STARTUP SCHEMES FOR YOU',
    womenTitle: '👩 WOMEN-FOCUSED SCHEMES FOR YOU',
    generalTitle: '🏛️ GOVERNMENT SCHEMES FOR YOU',
    strongMatch: '✓ Strong Match',
    possibleMatch: '◐ Possible Match',
    confidence: 'Confidence',
    whyMatches: 'Why this matches:',
    benefits: 'Benefits:',
    eligibility: 'Eligibility:',
    documents: 'Required documents:',
    apply: 'Apply:',
    source: 'Source:',
    lastDate: 'Last date:',
    missingInfoTitle: '💡 Additional Information Needed',
    missingInfoText: 'These recommendations are based on what you shared. To improve accuracy, you can tell me:',
    noMatch: 'I could not find a strong scheme match yet.',
    noMatchHint: 'Share any one or two details and I will recommend schemes immediately:',
    checkPortal: 'Check official portal for the latest deadline.',
    howToApply: 'How to apply:',
    applyOnline: 'Apply online:',
    officialPortal: 'Official portal:',
    typeQuestion: 'Please type your question.',
    highlyRelevant: 'HIGHLY RELEVANT SCHEMES',
    possiblyRelevant: 'POSSIBLY RELEVANT SCHEMES',
    cautionsHeader: 'Check carefully:',
    basedOnProfile: 'Based on your profile:',
    generalOverviewText: 'Here are the scheme details from the repository.',
    noMissingInfoNeeded: 'No extra information is needed for this first recommendation pass. Please verify final eligibility on the official portal before applying.',
    semanticMatchReason: 'Semantic search found this scheme relevant to your query.'
  },
  hi: {
    studentTitle: '🎓 आपके लिए छात्र योजनाएं',
    farmerTitle: '🌾 आपके लिए किसान योजनाएं',
    widowTitle: '🛡️ आपके लिए विधवा कल्याण योजनाएं',
    startupTitle: '🚀 आपके लिए व्यवसाय और स्टार्टअप योजनाएं',
    womenTitle: '👩 आपके लिए महिला केंद्रित योजनाएं',
    generalTitle: '🏛️ आपके लिए सरकारी योजनाएं',
    strongMatch: '✓ सटीक मिलान',
    possibleMatch: '◐ संभावित मिलान',
    confidence: 'विश्वास स्कोर',
    whyMatches: 'यह क्यों मेल खाता है:',
    benefits: 'लाभ:',
    eligibility: 'पात्रता:',
    documents: 'आवश्यक दस्तावेज:',
    apply: 'आवेदन करें:',
    source: 'स्रोत:',
    lastDate: 'अंतिम तिथि:',
    missingInfoTitle: '💡 अतिरिक्त जानकारी आवश्यक है',
    missingInfoText: 'ये सिफारिशें आपके द्वारा साझा की गई जानकारी पर आधारित हैं। सटीकता में सुधार के लिए, आप मुझे बता सकते हैं:',
    noMatch: 'मुझे अभी तक कोई मजबूत योजना नहीं मिली है।',
    noMatchHint: 'कोई भी एक या दो विवरण साझा करें और मैं तुरंत योजनाओं की सिफारिश करूंगा:',
    checkPortal: 'नवीनतम समय सीमा के लिए आधिकारिक पोर्टल की जाँच करें।',
    howToApply: 'आवेदन कैसे करें:',
    applyOnline: 'ऑनलाइन आवेदन करें:',
    officialPortal: 'आधिकारिक पोर्टल:',
    typeQuestion: 'कृपया अपना प्रश्न लिखें।',
    highlyRelevant: 'अत्यंत प्रासंगिक योजनाएं',
    possiblyRelevant: 'संभावित प्रासंगिक योजनाएं',
    cautionsHeader: 'ध्यान से जांचें:',
    basedOnProfile: 'आपके प्रोफाइल के आधार पर:',
    generalOverviewText: 'यहाँ रिपॉजिटरी से योजना के विवरण दिए गए हैं।',
    noMissingInfoNeeded: 'इस पहले सिफारिश पास के लिए किसी अतिरिक्त जानकारी की आवश्यकता नहीं है। कृपया आवेदन करने से पहले आधिकारिक पोर्टल पर अंतिम पात्रता की पुष्टि करें।',
    semanticMatchReason: 'अर्थपूर्ण खोज में यह योजना आपके प्रश्न के लिए प्रासंगिक पाई गई।'
  },
  te: {
    studentTitle: '🎓 మీ కోసం విద్యార్థి పథకాలు',
    farmerTitle: '🌾 మీ కోసం రైతు పథకాలు',
    widowTitle: '🛡️ మీ కోసం విതംతు సంక్షేమ పథకాలు',
    startupTitle: '🚀 మీ కోసం వ్యాపార మరియు స్టార్టప్ పథకాలు',
    womenTitle: '👩 మీ కోసం మహిళా ఆధారిత పథకాలు',
    generalTitle: '🏛️ మీ కోసం ప్రభుత్వ పథకాలు',
    strongMatch: '✓ బలమైన సరిపోలిక',
    possibleMatch: '◐ సాధ్యమైన సరిపోలిక',
    confidence: 'విశ్వసనీయత',
    whyMatches: 'ఇది ఎందుకు సరిపోలింది:',
    benefits: 'ప్రయోజనాలు:',
    eligibility: 'అర్హత:',
    documents: 'అవసరమైన పత్రాలు:',
    apply: 'అప్లై చేయండి:',
    source: 'మూలం:',
    lastDate: 'చివరి తేదీ:',
    missingInfoTitle: '💡 అదనపు సమాచారం అవసరం',
    missingInfoText: 'ఈ సిఫార్సులు మీరు పంచుకున్న సమాచారంపై ఆధారపడి ఉంటాయి. ఖచ్చితత్వాన్ని మెరుగుపరచడానికి, మీరు నాకు చెప్పవచ్చు:',
    noMatch: 'నాకు ఇంకా సరైన పథకం లభించలేదు.',
    noMatchHint: 'ఏదైనా ఒకటి లేదా రెండు వివరాలను పంచుకోండి మరియు నేను వెంటనే పథకాలను సిఫార్సు చేస్తాను:',
    checkPortal: 'ఇటీവലി గడువు కోసం అధికారిక పోర్టల్ తనిఖీ చేయండి.',
    howToApply: 'ఎలా అప్లై చేయాలి:',
    applyOnline: 'ఆన్‌లైన్ అప్లై లింక్:',
    officialPortal: 'అధికారిక పోర్റ്റల్:',
    typeQuestion: 'దయచేసి మీ ప్రశ్నను టైപ്പ് చేయండి.',
    highlyRelevant: 'అత్యంత సంబంధిత పథకాలు',
    possiblyRelevant: 'సాధ్యమైన సంబంధిత పథకాలు',
    cautionsHeader: 'జಾಗ్రత్తగా తనిఖీ చేయండి:',
    basedOnProfile: 'మీ ప్రొఫൈల్ ఆధారంగా:',
    generalOverviewText: 'రిపోజిటరీ నుండి పథకం వివరాలు ఇక్కడ ఉన్నాయి.',
    noMissingInfoNeeded: 'ఈ మొదటి സിഫാർസു ചെയ്യാൻ അധിക വിവരങ്ങൾ ആവശ്യമില്ല. ദയവായി അപേക്ഷിക്കുന്നതിന് മുൻപ് ഔദ്യോഗിക പോർട്ടലിൽ അർഹത ഉറപ്പാക്കുക.',
    semanticMatchReason: 'మీ శోధనకు ఈ పథకం సంబంధితంగా కనుగొనబడింది.'
  },
  ta: {
    studentTitle: '🎓 உங்களுக்கான மாணவர் திட்டங்கள்',
    farmerTitle: '🌾 உங்களுக்கான விவசாயி திட்டங்கள்',
    widowTitle: '🛡️ உங்களுக்கான விதவை நலத் திட்டங்கள்',
    startupTitle: '🚀 உங்களுக்கான வணிக மற்றும் ஸ்டார்ட்அப் திட்டங்கள்',
    womenTitle: '👩 உங்களுக்கான பெண்கள் நலத் திட்டங்கள்',
    generalTitle: '🏛️ உங்களுக்கான அரசு திட்டங்கள்',
    strongMatch: '✓ பொருத்தமான தேர்வு',
    possibleMatch: '◐ சாத்தியமான தேர்வு',
    confidence: 'நம்பகத்தன்மை',
    whyMatches: 'ஏன் இது பொருந்துகிறது:',
    benefits: 'பலன்கள்:',
    eligibility: 'தகுதி:',
    documents: 'தேவையான ஆவணங்கள்:',
    apply: 'விண்ணப்பிக்கவும்:',
    source: 'ஆதாரம்:',
    lastDate: 'கடைசி தேதி:',
    missingInfoTitle: '💡 கூடுதல் தகவல் தேவை',
    missingInfoText: 'இந்த பரிந்துரைகள் நீங்கள் பகிர்ந்த விவரங்களின் அடிப்படையில் உள்ளன. துல்லியத்தை மேம்படுத்த, நீங்கள் கூறலாம்:',
    noMatch: 'பொருத்தமான திட்டங்கள் எதுவும் இன்னும் கிடைக்கவில்லை.',
    noMatchHint: 'ஒன்று அல்லது இரண்டு விவரங்களைப் பகிரவும், நான் உடனடியாக பரிந்துரைக்கிறேன்:',
    checkPortal: 'சமீபத்திய காலக்கெடுவுக்கு அதிகாரப்பூர்வ போர்ட்டலைச் சரிபார்க்கவும்.',
    howToApply: 'எப்படி விண்ணப்பிப்பது:',
    applyOnline: 'ஆன்லைனில் விண்ணப்பிக்கவும்:',
    officialPortal: 'அதிகாரப்பூர்வ போர்டல்:',
    typeQuestion: 'தயவுசெய்து உங்கள் கேள்வியை உள்ளிடவும்.',
    highlyRelevant: 'மிகவும் பொருத்தமான திட்டங்கள்',
    possiblyRelevant: 'ஓரளவு பொருத்தமான திட்டங்கள்',
    cautionsHeader: 'கவனமாக சரிபார்க்கவும்:',
    basedOnProfile: 'உங்கள் சுயவிவரத்தின் அடிப்படையில்:',
    generalOverviewText: 'திட்டத்தின் விவரங்கள் இதோ.',
    noMissingInfoNeeded: 'கூடுதல் தகவல் தேவையில்லை. விண்ணப்பிக்கும் முன் அதிகாரப்பூர்வ போர்ட்டலில் தகுதியைச் சரிபார்க்கவும்.',
    semanticMatchReason: 'உங்கள் தேடலுக்கு இந்த திட்டம் மிகவும் பொருத்தமானது.'
  },
  kn: {
    studentTitle: '🎓 ನಿಮಗಾಗಿ ವಿದ್ಯಾರ್ಥಿ ಯೋಜನೆಗಳು',
    farmerTitle: '🌾 ನಿಮಗಾಗಿ ರೈತ ಯೋಜನೆಗಳು',
    widowTitle: '🛡️ ನಿಮಗಾಗಿ ವಿಧವಾ ಕಲ್ಯಾಣ ಯೋಜನೆಗಳು',
    startupTitle: '🚀 ನಿಮಗಾಗಿ ವ್ಯವಹಾರ ಮತ್ತು ಸ್ಟಾರ್ಟ್ಅಪ್ ಯೋಜನೆಗಳು',
    womenTitle: '👩 ನಿಮಗಾಗಿ ಮಹಿಳಾ ಕೇಂದ್ರಿತ ಯೋಜನೆಗಳು',
    generalTitle: '🏛️ ನಿಮಗಾಗಿ ಸರ್ಕಾರಿ ಯೋಜನೆಗಳು',
    strongMatch: '✓ ಬಲವಾದ ಹೋಲಿಕೆ',
    possibleMatch: '◐ ಸಂಭಾವ್ಯ ಹೋಲಿಕೆ',
    confidence: 'ವಿಶ್ವಾಸಾರ್ಹತೆ',
    whyMatches: 'ಇದು ಏಕೆ ಹೋಲುತ್ತದೆ:',
    benefits: 'ಪ್ರಯೋಜನಗಳು:',
    eligibility: 'ಅರ್ಹತೆ:',
    documents: 'ಅಗತ್ಯ ದಾಖಲೆಗಳು:',
    apply: 'ಅರ್ಜಿ ಸಲ್ಲಿಸಿ:',
    source: 'ಮೂಲ:',
    lastDate: 'ಕೊನೆಯ ದಿನಾಂಕ:',
    missingInfoTitle: '💡 ಹೆಚ್ಚುವರಿ ಮಾಹಿತಿ ಅಗತ್ಯವಿದೆ',
    missingInfoText: 'ಈ ಶಿಫಾರಸುಗಳು ನೀವು ಹಂಚಿಕೊಂಡ ಮಾಹಿತಿಯನ್ನು ಆಧರಿಸಿವೆ. ನಿಖರತೆಯನ್ನು ಹೆಚ್ಚಿಸಲು, ನೀವು ತಿಳಿಸಬಹುದು:',
    noMatch: 'ಯಾವುದೇ ಬಲವಾದ ಯೋಜನೆ ಕಂಡುಬಂದಿಲ್ಲ.',
    noMatchHint: 'ಯಾವುದಾದರೂ ಒಂದು ಅಥವಾ ಎರಡು ವಿವರಗಳನ್ನು ಹಂಚಿಕೊಳ್ಳಿ ಮತ್ತು ನಾನು ತಕ್ಷಣ ಶಿಫಾರಸು ಮಾಡುತ್ತೇನೆ:',
    checkPortal: 'ಇತ್ತೀಚಿನ ಗಡುವಿಗಾಗಿ ಅಧಿಕೃತ ಪೋರ್ಟಲ್ ಪರಿಶೀಲಿಸಿ.',
    howToApply: 'ಅರ್ಜಿ ಸಲ್ಲಿಸುವುದು ಹೇಗೆ:',
    applyOnline: 'ಆನ್‌ಲೈನ್ ಅರ್ಜಿ:',
    officialPortal: 'ಅಧಿಕೃತ ಪೋರ್ಟಲ್:',
    typeQuestion: 'ದಯವಿಟ್ಟು ನಿಮ್ಮ ಪ್ರಶ್ನೆಯನ್ನು ಟೈಪ್ ಮಾಡಿ.',
    highlyRelevant: 'ಹೆಚ್ಚು ಪ್ರಸ್ತುತವಾದ ಯೋಜನೆಗಳು',
    possiblyRelevant: 'ಸಾಧ್ಯವಿರುವ ಪ್ರಸ್ತುತವಾದ ಯೋಜನೆಗಳು',
    cautionsHeader: 'ಎಚ್ಚರಿಕೆಯಿಂದ ಪರಿಶೀಲಿಸಿ:',
    basedOnProfile: 'ನಿಮ್ಮ ಪ್ರೊಫೈಲ್ ಆಧಾರದ ಮೇಲೆ:',
    generalOverviewText: 'ಯೋಜನೆಯ ವಿವರಗಳು ಇಲ್ಲಿವೆ.',
    noMissingInfoNeeded: 'ಹೆಚ್ಚುವರಿ ಮಾಹಿತಿ ಅಗತ್ಯವಿಲ್ಲ. ಅರ್ಜಿ ಸಲ್ಲಿಸುವ ಮುನ್ನ ಅಧಿಕೃತ ಪೋರ್ಟಲ್‌ನಲ್ಲಿ ಅರ್ಹತೆಯನ್ನು ಖಚಿತಪಡಿಸಿಕೊಳ್ಳಿ.',
    semanticMatchReason: 'ನಿಮ್ಮ ಪ್ರಶ್ನೆಗೆ ಈ ಯೋಜನೆಯು ಪ್ರಸ್ತುತವಾಗಿದೆ.'
  },
  ml: {
    studentTitle: '🎓 നിങ്ങൾക്കായുള്ള വിദ്യാർത്ഥി പദ്ധതികൾ',
    farmerTitle: '🌾 നിങ്ങൾക്കായുള്ള കർഷക പദ്ധതികൾ',
    widowTitle: '🛡️ നിങ്ങൾക്കായുള്ള വിധവക്ഷേമ പദ്ധതികൾ',
    startupTitle: '🚀 നിങ്ങൾക്കായുള്ള ബിസിനസ്സ്, സ്റ്റാർട്ടപ്പ് പദ്ധതികൾ',
    womenTitle: '👩 നിങ്ങൾക്കായുള്ള വനിതാ പദ്ധതികൾ',
    generalTitle: '🏛️ നിങ്ങൾക്കായുള്ള സർക്കാർ പദ്ധതികൾ',
    strongMatch: '✓ മികച്ച അനുയോജ്യത',
    possibleMatch: '◐ സാധ്യതയുള്ള അനുയോജ്യത',
    confidence: 'വിശ്വാസ്യത',
    whyMatches: 'എന്തുകൊണ്ട് ഇത് അനുയോജ്യമാകുന്നു:',
    benefits: 'ആനുകൂല്യങ്ങൾ:',
    eligibility: 'യോഗ്യത:',
    documents: 'ആവശ്യമായ രേഖകൾ:',
    apply: 'അപേക്ഷിക്കുക:',
    source: 'ഉറവിടം:',
    lastDate: 'അവസാന തീയതി:',
    missingInfoTitle: '💡 അധിക വിവരങ്ങൾ ആവശ്യമുണ്ട്',
    missingInfoText: 'ഈ ശുപാർശകൾ നിങ്ങൾ നൽകിയ വിവരങ്ങളെ അടിസ്ഥാനമാക്കിയുള്ളതാണ്. കൃത്യത വർദ്ധിപ്പിക്കാൻ ഇവ നൽകാം:',
    noMatch: 'അനുയോജ്യമായ പദ്ധതികൾ ഒന്നും കണ്ടെത്താനായില്ല.',
    noMatchHint: 'ഒന്നോ രണ്ടോ വിവരങ്ങൾ പങ്കുവെക്കൂ, ഞാൻ ഉടൻ തന്നെ പദ്ധതികൾ ശുപാർശ ചെയ്യാം:',
    checkPortal: 'അവസാന തീയതിക്കായി ഔദ്യോഗിക പോർട്ടൽ സന്ദർശിക്കുക.',
    howToApply: 'അപേക്ഷിക്കേണ്ട വിധം:',
    applyOnline: 'ഓൺലൈനായി അപേക്ഷിക്കുക:',
    officialPortal: 'ഔദ്യോഗിക പോർട്ടൽ:',
    typeQuestion: 'ദയവായി നിങ്ങളുടെ ചോദ്യം രേഖപ്പെടുത്തുക.',
    highlyRelevant: 'ഏറ്റവും അനുയോജ്യമായ പദ്ധതികൾ',
    possiblyRelevant: 'സാധ്യതയുള്ള അനുയോജ്യമായ പദ്ധതികൾ',
    cautionsHeader: 'ശ്രദ്ധാപൂർവ്വം പരിശോധിക്കുക:',
    basedOnProfile: 'നിങ്ങളുടെ പ്രൊഫൈൽ അടിസ്ഥാനമാക്കി:',
    generalOverviewText: 'പദ്ധതി വിവരങ്ങൾ താഴെ നൽകുന്നു.',
    noMissingInfoNeeded: 'അധിക വിവരങ്ങൾ ആവശ്യമില്ല. അപേക്ഷിക്കുന്നതിന് മുൻപ് ഔദ്യോഗിക പോർട്ടലിൽ യോഗ്യത പരിശോധിക്കുക.',
    semanticMatchReason: 'നിങ്ങളുടെ ചോദ്യത്തിന് ഈ പദ്ധതി അനുയോജ്യമാണ്.'
  }
}
