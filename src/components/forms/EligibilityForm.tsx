import { zodResolver } from '@hookform/resolvers/zod'
import { motion, AnimatePresence } from 'framer-motion'
import { Save } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useEligibility } from '@/contexts/EligibilityContext'
import { useNotifications } from '@/contexts/NotificationContext'
import { INDIAN_STATES } from '@/data/states'

import {
  DRAFT_STORAGE_KEY,
  eligibilityFormSchema,
  FORM_STEPS,
  type EligibilityFormData,
} from '@/lib/form-schema'
import { predictEligibility } from '@/lib/ml-eligibility-service'
import type { UserProfile } from '@/types'



const UNKNOWN_INCOME = 100_000_001



const defaultValues: EligibilityFormData = {
  // Page 1 – Personal
  fullName: '',
  age: 25,
  gender: 'Male',
  maritalStatus: '' as any,
  disabilityStatus: false,
  disabilityPercentage: '',
  // Page 2 – Social
  casteCategory: 'General',
  // Page 3 – Economic
  occupation: '',
  individualIncome: undefined as any,
  familyIncome: undefined as any,
  parentGuardianIncome: undefined as any,
  employmentStatus: 'Employed',
  bplStatus: false,
  isInHardship: false,
  isGovernmentEmployee: false,
  // Page 4 – Education
  isStudent: false,
  // Page 5 – Location
  state: '',
  district: '',
  areaType: 'Urban',
  // Page 6 – Preferences
  isFarmer: false,
  isWidow: false,
  isSeniorCitizen: false,
  isMinority: false,
  isStartupOwner: false,
  skillDevelopmentInterest: false,
  isArtisan: false,
  isAnimalHusbandryOrFisheries: false,
  preferredCategories: [],
}

export function EligibilityForm() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { setEligibilityData } = useEligibility()
  const { addNotification } = useNotifications()
  const [step, setStep] = useState(0)
  const [draftSaved, setDraftSaved] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const getErrorMessage = (err: any) => {
    if (!err) return ''
    const msg = err.message
    if (msg === 'Age is required') return t('form.errors.ageRequired')
    if (msg === 'Invalid age') return t('form.errors.invalidAge')
    if (msg === 'Please select your occupation!') return t('form.errors.occupationRequired')
    if (msg === 'State is required') return t('form.errors.stateRequired')
    if (msg === 'Income is required') return t('form.errors.incomeRequired')
    if (msg === 'Please select your marital status') return t('form.errors.maritalStatusRequired')
    if (msg === 'Please select your self employment type') return t('form.errors.selfEmploymentTypeRequired')
    return t(msg)
  }

  const yesLabel = ({
    en: 'Yes', hi: 'हाँ', te: 'అవును', kn: 'ಹೌದು', ml: 'അതെ', ta: 'ஆம்'
  } as Record<string, string>)[i18n.language.split('-')[0] || 'en'] || 'Yes'

  const noLabel = ({
    en: 'No', hi: 'नहीं', te: 'కాదు', kn: 'ಇಲ್ಲ', ml: 'അല്ല', ta: 'இல்லை'
  } as Record<string, string>)[i18n.language.split('-')[0] || 'en'] || 'No'

  const form = useForm<EligibilityFormData>({
    resolver: zodResolver(eligibilityFormSchema) as any,
    defaultValues,
    mode: 'onChange',
  })

  const { register, watch, setValue, trigger, formState: { errors }, handleSubmit } = form

  // Watch fields for rendering & effect dependencies
  const age = watch('age')
  const gender = watch('gender')
  const maritalStatus = watch('maritalStatus')
  const disabilityStatus = watch('disabilityStatus')
  const disabilityPercentage = watch('disabilityPercentage')
  const casteCategory = watch('casteCategory')
  const employmentStatus = watch('employmentStatus')
  const isGovernmentEmployee = watch('isGovernmentEmployee')
  const occupation = watch('occupation')
  const bplStatus = watch('bplStatus')
  const isInHardship = watch('isInHardship')
  const isStudent = watch('isStudent')
  const watchedState = watch('state')
  const areaType = watch('areaType')
  const isFarmer = watch('isFarmer')
  const isWidow = watch('isWidow')
  const isSeniorCitizen = watch('isSeniorCitizen')
  const isMinority = watch('isMinority')
  const isStartupOwner = watch('isStartupOwner')


  // Load saved draft on mount
  useEffect(() => {
    try {
      const draft = localStorage.getItem(DRAFT_STORAGE_KEY)
      if (draft) {
        const parsed = JSON.parse(draft) as EligibilityFormData
        Object.entries(parsed).forEach(([key, value]) => {
          setValue(key as any, value)
        })
      }
    } catch { /* ignore */ }
  }, [setValue])

  // Auto-save draft
  useEffect(() => {
    const subscription = watch((data) => {
      localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(data))
      setDraftSaved(true)
    })
    return () => subscription.unsubscribe()
  }, [watch])

  useEffect(() => {
    if (!draftSaved) return
    const timer = setTimeout(() => setDraftSaved(false), 2000)
    return () => clearTimeout(timer)
  }, [draftSaved])

  // Some answers imply an eligibility flag. Only turn a flag on here: a user
  // can still be a student, farmer, or entrepreneur alongside another job.
  useEffect(() => {
    if (age >= 60 && !isSeniorCitizen) setValue('isSeniorCitizen', true)

    if (maritalStatus === 'Widowed' && !isWidow) setValue('isWidow', true)

    if (employmentStatus === 'Student' && !isStudent) setValue('isStudent', true)

    if (employmentStatus === 'Farmer' && !isFarmer) setValue('isFarmer', true)

    if (employmentStatus === 'Startup Owner' && !isStartupOwner) setValue('isStartupOwner', true)
  }, [age, maritalStatus, employmentStatus, isSeniorCitizen, isWidow, isStudent, isFarmer, isStartupOwner, setValue])

  useEffect(() => {
    if (gender !== 'Female') {
      setValue('maritalStatus', 'Single')
    } else {
      setValue('maritalStatus', '' as any)
    }
  }, [gender, setValue])

  // Dynamically calculate active steps. All steps are active for all profiles.
  const activeStepIndices = [0, 1, 2, 3, 4, 5]

  const activeStepIndex = activeStepIndices.indexOf(step)
  const totalActiveSteps = activeStepIndices.length

  const progress = ((activeStepIndex + 1) / totalActiveSteps) * 100

  const nextStep = async () => {
    const currentSchema = FORM_STEPS[step].schema as any
    const fields = Object.keys(currentSchema.shape) as any
    const valid = await trigger(fields)
    if (!valid) {
      const errs = form.formState.errors
      const messages = Object.entries(errs)
        .filter(([k]) => fields.includes(k))
        .map(([k, v]) => `${t('form.fields.' + k, k)}: ${getErrorMessage(v) || 'Invalid value'}`)
        .join('\n')
      const localizedErrorHeader = t('form.validationErrorHeader', 'Please fix the following validation errors to continue:')
      alert(localizedErrorHeader + "\n" + messages)
    }
    if (valid) {
      const currentIndex = activeStepIndices.indexOf(step)
      if (currentIndex < totalActiveSteps - 1) {
        setStep(activeStepIndices[currentIndex + 1])
      }
    }
  }

  const prevStep = () => {
    const currentIndex = activeStepIndices.indexOf(step)
    if (currentIndex > 0) {
      setStep(activeStepIndices[currentIndex - 1])
    }
  }

  const onSubmit = handleSubmit(async (data: EligibilityFormData) => {
    setIsSubmitting(true)
    try {
      // Occupation is the form's primary source for these scheme-specific flags.
      // This also clears a stale flag left over from a previously saved draft.
      const occupationFlags = {
        isFarmer: data.occupation === 'Farmer / Agricultural Worker',
        isArtisan: data.occupation === 'Artisan / Craftsman / Weaver',
        isAnimalHusbandryOrFisheries: data.occupation === 'Involved in Animal Husbandry / Fisheries',
        isStartupOwner: data.occupation === 'Startup Owner / Entrepreneur',
      }
      const mappedEmploymentStatus = data.isStudent
        ? 'Student'
        : occupationFlags.isFarmer
          ? 'Farmer'
          : occupationFlags.isStartupOwner
            ? 'Startup Owner'
            : data.employmentStatus

      // A blank income means it was not supplied; it is never interpreted as
      // zero income. Parent/guardian income is used for student applicants.
      const verifiedIncome = data.familyIncome ?? data.parentGuardianIncome ?? UNKNOWN_INCOME
      
      let mappedGender: 'Male' | 'Female' | 'Other' = data.gender
      let mappedMaritalStatus: 'Single' | 'Married' | 'Widowed' | 'Divorced' = 'Single'
      if (data.maritalStatus === 'Married') mappedMaritalStatus = 'Married'
      else if (data.maritalStatus === 'Widowed') mappedMaritalStatus = 'Widowed'
      else if (data.maritalStatus === 'Divorced' || data.maritalStatus === 'Separated') mappedMaritalStatus = 'Divorced'
      else mappedMaritalStatus = 'Single' // 'Never Married' -> 'Single'

      const profile: UserProfile = {
        ...data,
        gender: mappedGender,
        maritalStatus: mappedMaritalStatus,
        familyIncome: verifiedIncome,
        employmentStatus: mappedEmploymentStatus,
        qualification: 'Graduate',
        collegeType: 'NA',
        ...occupationFlags,
      } as UserProfile

      // Query the XGBoost-based ML service
      const allResults = await predictEligibility(profile)
      let results = allResults
      const occ = data.occupation
      if (occ === 'Farmer / Agricultural Worker') {
        results = allResults.filter(
          (r) => r.scheme.category === 'Agriculture' || r.scheme.rules?.farmerOnly === true
        )
      } else if (occ === 'Artisan / Craftsman / Weaver') {
        results = allResults.filter(
          (r) =>
            r.scheme.rules?.artisanOnly === true ||
            r.scheme.name.toLowerCase().includes('artisan') ||
            r.scheme.name.toLowerCase().includes('vishwakarma')
        )
      } else if (occ === 'Involved in Animal Husbandry / Fisheries') {
        results = allResults.filter(
          (r) =>
            r.scheme.rules?.husbandryOrFisheriesOnly === true ||
            r.scheme.name.toLowerCase().includes('husbandry') ||
            r.scheme.name.toLowerCase().includes('fisheries') ||
            r.scheme.name.toLowerCase().includes('matsya')
        )
      } else if (occ === 'Startup Owner / Entrepreneur') {
        results = allResults.filter(
          (r) =>
            r.scheme.category === 'Business & Entrepreneurship' ||
            r.scheme.rules?.startupOwnerOnly === true ||
            r.scheme.name.toLowerCase().includes('mudra') ||
            r.scheme.name.toLowerCase().includes('startup') ||
            r.scheme.name.toLowerCase().includes('pmegp')
        )
      } else {
        // Exclude specific farmer, artisan, husbandry, and startup schemes
        results = allResults.filter(
          (r) =>
            !r.scheme.rules?.farmerOnly &&
            !r.scheme.rules?.artisanOnly &&
            !r.scheme.rules?.husbandryOrFisheriesOnly &&
            !r.scheme.rules?.startupOwnerOnly &&
            r.scheme.category !== 'Agriculture'
        )
      }

      setEligibilityData(profile, results)
      localStorage.removeItem(DRAFT_STORAGE_KEY)
      addNotification(
        'Eligibility Check Complete',
        `Found ${results.length} matching schemes for your profile.`,
        'success',
      )
      navigate('/results')
    } catch (error: any) {
      addNotification(
        'Eligibility Check Failed',
        error.message || 'AI eligibility service is currently unavailable. Please try again.',
        'error',
      )
    } finally {
      setIsSubmitting(false)
    }
  })

  const currentStep = FORM_STEPS[step]
  const stepTitle = t('form.steps.' + currentStep.id, currentStep.title)

  return (
    <Card className="mx-auto max-w-2xl">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>{stepTitle}</CardTitle>
          <span className="text-sm text-muted-foreground">
            {t('form.step')} {activeStepIndex + 1} {t('form.of')} {totalActiveSteps}
          </span>
        </div>
        <Progress value={progress} className="mt-4" />
        {draftSaved && (
          <p className="flex items-center gap-1 text-xs text-muted-foreground mt-2">
            <Save className="h-3 w-3" /> {t('form.saveDraft')}
          </p>
        )}
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault() }}>
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2 }}
              className="space-y-5"
            >
              {/* ── PAGE 1: Personal Details ────────────────────────────── */}
              {step === 0 && (
                <div className="space-y-6">
                  {/* Gender Selector Cards */}
                  <div className="space-y-3">
                    <Label className="text-base font-semibold">
                      <span className="text-destructive">*</span>{t('form.fields.genderTellUs', 'Tell us about yourself, you are a...')}
                    </Label>
                    <div className="grid grid-cols-3 gap-4">
                      {([
                        { value: 'Male', label: t('form.options.gender.Male', 'Male') },
                        { value: 'Female', label: t('form.options.gender.Female', 'Female') },
                        { value: 'Other', label: t('form.options.gender.Other', 'Others') }
                      ] as const).map((opt) => {
                        const isSelected = gender === opt.value
                        return (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => setValue('gender', opt.value, { shouldDirty: true, shouldValidate: true })}
                            className={`h-11 rounded-md border-2 px-4 text-center text-base font-medium transition-colors ${
                              isSelected
                                ? 'border-green-600 bg-green-50/10 text-green-600 font-semibold'
                                : 'border-border bg-card hover:border-muted-foreground'
                            }`}
                          >
                            {opt.label}
                          </button>
                        )
                      })}
                    </div>
                    {errors.gender && <p className="text-sm text-destructive">{getErrorMessage(errors.gender)}</p>}
                  </div>

                  {/* Age Dropdown Selector */}
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2 text-base font-semibold">
                      <span className="text-destructive">*</span>
                      <span>{t('form.fields.ageLabelPrefix', 'and your age is')}</span>
                      <Select
                        value={String(age || '')}
                        onValueChange={(v) => setValue('age', Number(v), { shouldDirty: true, shouldValidate: true })}
                      >
                        <SelectTrigger className="w-24 h-10">
                          <SelectValue placeholder="--" />
                        </SelectTrigger>
                        <SelectContent className="max-h-60 overflow-y-auto">
                          {Array.from({ length: 103 }, (_, i) => i + 18).map((a) => (
                            <SelectItem key={a} value={String(a)}>{a}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <span>{t('form.fields.ageLabelSuffix', 'years')}</span>
                    </div>
                    {errors.age && <p className="text-sm text-destructive">{getErrorMessage(errors.age)}</p>}
                  </div>

                  {/* Conditional Marital Status */}
                  {gender === 'Female' && (
                    <div className="space-y-2 pt-2 animate-in fade-in slide-in-from-top-2 duration-200">
                      <Label className="text-base font-semibold">
                        <span className="text-destructive">*</span>{t('form.fields.maritalStatus', 'What is your marital status?')}
                      </Label>
                      <Select
                        value={maritalStatus}
                        onValueChange={(v) => setValue('maritalStatus', v as any, { shouldDirty: true, shouldValidate: true })}
                      >
                        <SelectTrigger className="h-11">
                          <SelectValue placeholder={t('form.options.maritalStatus.placeholder', '-- Select One --')} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="-- Select One --" disabled>{t('form.options.maritalStatus.placeholder', '-- Select One --')}</SelectItem>
                          {[
                            { label: t('form.options.maritalStatus.Married', 'Married'), value: 'Married' },
                            { label: t('form.options.maritalStatus.NeverMarried', 'Never Married'), value: 'Never Married' },
                            { label: t('form.options.maritalStatus.Divorced', 'Divorced'), value: 'Divorced' },
                            { label: t('form.options.maritalStatus.Separated', 'Separated'), value: 'Separated' },
                            { label: t('form.options.maritalStatus.Widowed', 'Widowed'), value: 'Widowed' },
                          ].map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {errors.maritalStatus && <p className="text-sm text-destructive">{getErrorMessage(errors.maritalStatus)}</p>}
                    </div>
                  )}
                </div>
              )}

              {/* ── PAGE 2: Location Details ─────────────────────────────── */}
              {step === 1 && (
                <>
                  {/* State */}
                  <div className="space-y-2">
                    <Label className="text-base font-semibold">{t('form.fields.state')}</Label>
                    <Select value={watchedState} onValueChange={(v) => { setValue('state', v, { shouldDirty: true, shouldValidate: true }); setValue('district', '') }}>
                      <SelectTrigger className="h-11"><SelectValue placeholder={t('form.fields.statePlaceholder')} /></SelectTrigger>
                      <SelectContent>
                        {INDIAN_STATES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    {errors.state && <p className="text-sm text-destructive">{getErrorMessage(errors.state)}</p>}
                  </div>

                  {/* Area Type */}
                  <div className="space-y-2">
                    <Label className="text-base font-semibold"><span className="text-destructive">*</span>{t('form.fields.areaType')}</Label>
                    <div className="grid grid-cols-2 gap-3 pt-1">
                      {(['Urban', 'Rural'] as const).map((area) => {
                        const selected = areaType === area
                        return (
                          <button key={area} type="button"
                            onClick={() => setValue('areaType', area, { shouldDirty: true, shouldValidate: true })}
                            className={`h-12 rounded-md border-2 px-4 text-left text-base font-medium transition-colors ${selected ? 'border-secondary bg-secondary/5 text-secondary' : 'border-border bg-card hover:border-muted-foreground'}`}
                            aria-pressed={selected}
                          >
                            {t('form.options.areaType.' + area, area)}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                </>
              )}

              {/* ── PAGE 3: Social / Caste Details ──────────────────────── */}
              {step === 2 && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label className="text-base font-semibold">
                      <span className="text-destructive">*</span>{t('form.fields.casteCategory')}
                    </Label>
                    <Select
                      value={casteCategory}
                      onValueChange={(v) => setValue('casteCategory', v as any, { shouldDirty: true, shouldValidate: true })}
                    >
                      <SelectTrigger className="h-11">
                        <SelectValue placeholder={t('form.options.casteCategory.placeholder', '-- Select Category --')} />
                      </SelectTrigger>
                      <SelectContent>
                        {[
                          { value: 'General', label: t('form.options.casteCategory.General') },
                          { value: 'OBC', label: t('form.options.casteCategory.OBC') },
                          { value: 'PVTG', label: t('form.options.casteCategory.PVTG') },
                          { value: 'SC', label: t('form.options.casteCategory.SC') },
                          { value: 'ST', label: t('form.options.casteCategory.ST') },
                          { value: 'DNT', label: t('form.options.casteCategory.DNT') },
                          { value: 'EWS', label: t('form.options.casteCategory.EWS') },
                        ].map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {errors.casteCategory && <p className="text-sm text-destructive">{getErrorMessage(errors.casteCategory)}</p>}
                  </div>

                </div>
              )}

              {/* ── PAGE 4: Disability & Minority Details ───────────────── */}
              {step === 3 && (
                <div className="space-y-6">
                  {/* Disability Status */}
                  <div className="space-y-3">
                    <Label className="text-base font-semibold">
                      <span className="text-destructive">*</span>{t('form.fields.disabilityStatus')}
                    </Label>
                    <div className="grid grid-cols-2 gap-3">
                      {[{ label: yesLabel, value: true }, { label: noLabel, value: false }].map((opt) => {
                        const selected = disabilityStatus === opt.value
                        return (
                          <button
                            key={opt.label}
                            type="button"
                            onClick={() => {
                              setValue('disabilityStatus', opt.value, { shouldDirty: true, shouldValidate: true })
                              if (!opt.value) {
                                setValue('disabilityPercentage', '', { shouldDirty: true })
                              }
                            }}
                            className={`h-11 rounded-md border-2 px-4 text-center text-base font-medium transition-colors ${selected
                                ? 'border-green-600 bg-green-50/10 text-green-600 font-semibold'
                                : 'border-border bg-card hover:border-muted-foreground'
                              }`}
                            aria-pressed={selected}
                          >
                            {opt.label}
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  {/* Conditional Render based on disabilityStatus */}
                  {disabilityStatus === true ? (
                    <div className="space-y-2">
                      <Label className="text-base font-semibold">
                        <span className="text-destructive">*</span>{t('form.fields.disabilityPercentage')}
                      </Label>
                      <Select
                        value={disabilityPercentage}
                        onValueChange={(v) => setValue('disabilityPercentage', v, { shouldDirty: true, shouldValidate: true })}
                      >
                        <SelectTrigger className="h-11">
                          <SelectValue placeholder={t('form.options.disabilityPercentage.placeholder')} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="-- Select One --">{t('form.options.disabilityPercentage.placeholder')}</SelectItem>
                          {['Below 40%', '40% - 59%', '60% - 79%', '80% and above'].map((p) => {
                            const pKeys: Record<string, string> = {
                              'Below 40%': 'below40',
                              '40% - 59%': 'from40to59',
                              '60% - 79%': 'from60to79',
                              '80% and above': 'above80',
                            }
                            return (
                              <SelectItem key={p} value={p}>
                                {t('form.options.disabilityPercentage.' + pKeys[p], p)}
                              </SelectItem>
                            )
                          })}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <Label className="text-base font-semibold">
                        <span className="text-destructive">*</span>{t('form.fields.isMinority')}
                      </Label>
                      <div className="grid grid-cols-2 gap-3">
                        {[{ label: yesLabel, value: true }, { label: noLabel, value: false }].map((opt) => {
                          const selected = isMinority === opt.value
                          return (
                            <button
                              key={opt.label}
                              type="button"
                              onClick={() => setValue('isMinority', opt.value, { shouldDirty: true, shouldValidate: true })}
                              className={`h-11 rounded-md border-2 px-4 text-center text-base font-medium transition-colors ${selected
                                  ? 'border-green-600 bg-green-50/10 text-green-600 font-semibold'
                                  : 'border-border bg-card hover:border-muted-foreground'
                                }`}
                              aria-pressed={selected}
                            >
                              {opt.label}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ── PAGE 5: Student & Employment Details ───────────────── */}
              {step === 4 && (
                <div className="space-y-6">
                  {/* Are you a student? */}
                  <div className="space-y-3">
                    <Label className="text-base font-semibold">
                      <span className="text-destructive">*</span>{t('form.fields.isStudent')}
                    </Label>
                    <div className="grid grid-cols-2 gap-3">
                      {[{ label: yesLabel, value: true }, { label: noLabel, value: false }].map((opt) => {
                        const selected = isStudent === opt.value
                        return (
                          <button
                            key={opt.label}
                            type="button"
                            onClick={() => {
                              setValue('isStudent', opt.value, { shouldDirty: true, shouldValidate: true })
                              if (opt.value) {
                                setValue('employmentStatus', 'Student', { shouldDirty: true, shouldValidate: true })
                                setValue('isGovernmentEmployee', false, { shouldDirty: true })
                                setValue('occupation', 'Student', { shouldDirty: true, shouldValidate: true })
                              } else {
                                setValue('employmentStatus', '' as any, { shouldDirty: true })
                                setValue('occupation', '', { shouldDirty: true })
                              }
                            }}
                            className={`h-11 rounded-md border-2 px-4 text-center text-base font-medium transition-colors ${selected
                                ? 'border-green-600 bg-green-50/10 text-green-600 font-semibold'
                                : 'border-border bg-card hover:border-muted-foreground'
                              }`}
                            aria-pressed={selected}
                          >
                            {opt.label}
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  {/* If not a student, show employment status buttons */}
                  {isStudent === false && (
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label className="text-base font-semibold">
                          <span className="text-destructive">*</span>{t('form.fields.employmentStatus')}
                        </Label>
                        <Select
                          value={employmentStatus}
                          onValueChange={(v) => {
                            setValue('employmentStatus', v as any, { shouldDirty: true, shouldValidate: true })
                            if (v !== 'Employed') {
                              setValue('isGovernmentEmployee', false, { shouldDirty: true })
                            }
                            if (v === 'Unemployed') {
                              setValue('occupation', 'Unemployed', { shouldDirty: true, shouldValidate: true })
                            } else if (v === 'Self-Employed') {
                              setValue('occupation', '', { shouldDirty: true })
                            } else {
                              setValue('occupation', '', { shouldDirty: true })
                            }
                          }}
                        >
                          <SelectTrigger className="h-11">
                            <SelectValue placeholder={t('form.options.employmentStatus.placeholder', '-- Select Status --')} />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="-- Select Status --" disabled>{t('form.options.employmentStatus.placeholder', '-- Select Status --')}</SelectItem>
                            {[
                              { label: t('form.options.employmentStatus.Employed'), value: 'Employed' },
                              { label: t('form.options.employmentStatus.Unemployed'), value: 'Unemployed' },
                              { label: t('form.options.employmentStatus.SelfEmployed'), value: 'Self-Employed' },
                            ].map((opt) => (
                              <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {errors.employmentStatus && <p className="text-sm text-destructive">{getErrorMessage(errors.employmentStatus)}</p>}
                      </div>
                    </div>
                  )}

                  {/* Govt Employee (only if Employed) */}
                  {isStudent === false && employmentStatus === 'Employed' && (
                    <div className="space-y-3">
                      <Label className="text-base font-semibold">
                        <span className="text-destructive">*</span>{t('form.fields.isGovernmentEmployee')}
                      </Label>
                      <div className="grid grid-cols-2 gap-3">
                        {[{ label: yesLabel, value: true }, { label: noLabel, value: false }].map((opt) => {
                          const selected = isGovernmentEmployee === opt.value
                          return (
                            <button
                              key={opt.label}
                              type="button"
                              onClick={() => {
                                setValue('isGovernmentEmployee', opt.value, { shouldDirty: true, shouldValidate: true })
                                if (opt.value) {
                                  setValue('occupation', 'Government Employee', { shouldDirty: true, shouldValidate: true })
                                } else {
                                  setValue('occupation', '', { shouldDirty: true })
                                }
                              }}
                              className={`h-11 rounded-md border-2 px-4 text-center text-base font-medium transition-colors ${
                                selected
                                  ? 'border-green-600 bg-green-50/10 text-green-600 font-semibold'
                                  : 'border-border bg-card hover:border-muted-foreground'
                              }`}
                              aria-pressed={selected}
                            >
                              {opt.label}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}


              {/* ── PAGE 7: Economic Details ─────────────────────────────── */}
              {step === 5 && (
                <div className="space-y-6">
                  {isStudent === false && employmentStatus === 'Employed' && isGovernmentEmployee === true ? (
                    <>
                      {/* Government Employee: Ask for Individual Income and Family Income */}
                      <div className="space-y-2 animate-in fade-in slide-in-from-top-1 duration-200">
                        <Label htmlFor="individualIncome" className="text-base font-semibold">
                          <span className="text-destructive">*</span>{t('form.fields.individualIncome', 'What is your annual income?')}
                        </Label>
                        <Input
                          id="individualIncome"
                          type="number"
                          min={0}
                          {...register('individualIncome', { valueAsNumber: true })}
                          placeholder={t('form.fields.incomePlaceholder')}
                          className="h-11"
                        />
                        {errors.individualIncome && <p className="text-sm text-destructive">{getErrorMessage(errors.individualIncome)}</p>}
                      </div>

                      <div className="space-y-2 animate-in fade-in slide-in-from-top-2 duration-200">
                        <Label htmlFor="familyIncome" className="text-base font-semibold">
                          <span className="text-destructive">*</span>{t('form.fields.familyIncome')}
                        </Label>
                        <Input
                          id="familyIncome"
                          type="number"
                          min={0}
                          {...register('familyIncome', { valueAsNumber: true })}
                          placeholder={t('form.fields.incomePlaceholder')}
                          className="h-11"
                        />
                        {errors.familyIncome && <p className="text-sm text-destructive">{getErrorMessage(errors.familyIncome)}</p>}
                      </div>
                    </>
                  ) : (
                    <>
                      {/* Occupation Select */}
                      {isStudent === false && (employmentStatus === 'Employed' || employmentStatus === 'Self-Employed') && (
                        <div className="space-y-2 animate-in fade-in slide-in-from-top-1 duration-200">
                          <Label htmlFor="occupation" className="text-base font-semibold">
                            <span className="text-destructive">*</span>{t('form.fields.occupation')}
                          </Label>
                          <p className="text-xs text-muted-foreground mt-[-4px] mb-1">{t('form.fields.occupationSubtext')}</p>
                          <Select
                            value={occupation}
                            onValueChange={(v) => {
                              setValue('occupation', v, { shouldDirty: true, shouldValidate: true })
                              setValue('isFarmer', v === 'Farmer / Agricultural Worker', { shouldDirty: true })
                              setValue('isArtisan', v === 'Artisan / Craftsman / Weaver', { shouldDirty: true })
                              setValue('isAnimalHusbandryOrFisheries', v === 'Involved in Animal Husbandry / Fisheries', { shouldDirty: true })
                              setValue('isStartupOwner', v === 'Startup Owner / Entrepreneur', { shouldDirty: true })
                            }}
                          >
                            <SelectTrigger className="h-11">
                              <SelectValue placeholder={t('form.options.occupation.placeholder')} />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="-- Occupation --" disabled>{t('form.options.occupation.placeholder')}</SelectItem>
                              {[
                                'Farmer / Agricultural Worker',
                                'Artisan / Craftsman / Weaver',
                                'Involved in Animal Husbandry / Fisheries',
                                'Startup Owner / Entrepreneur',
                                'Self-Employed / Other Business',
                                'Private Sector Employee',
                                'Unemployed',
                                'Other',
                              ].map((opt) => {
                                const occKeys: Record<string, string> = {
                                  'Farmer / Agricultural Worker': 'farmer',
                                  'Artisan / Craftsman / Weaver': 'artisan',
                                  'Involved in Animal Husbandry / Fisheries': 'husbandry',
                                  'Startup Owner / Entrepreneur': 'startup',
                                  'Self-Employed / Other Business': 'selfEmployed',
                                  'Private Sector Employee': 'private',
                                  'Unemployed': 'unemployed',
                                  'Other': 'other',
                                }
                                return (
                                  <SelectItem key={opt} value={opt}>
                                    {t('form.options.occupation.' + occKeys[opt], opt)}
                                  </SelectItem>
                                )
                              })}
                            </SelectContent>
                          </Select>
                          {errors.occupation && <p className="text-sm text-destructive">{getErrorMessage(errors.occupation)}</p>}
                        </div>
                      )}

                      {/* BPL Category Selection */}
                      <div className="space-y-3">
                        <Label className="text-base font-semibold">
                          <span className="text-destructive">*</span>{t('form.fields.bplStatus')}
                        </Label>
                        <div className="grid grid-cols-2 gap-3">
                          {[{ label: yesLabel, value: true }, { label: noLabel, value: false }].map((opt) => {
                            const selected = bplStatus === opt.value
                            return (
                              <button
                                key={opt.label}
                                type="button"
                                onClick={() => {
                                  setValue('bplStatus', opt.value, { shouldDirty: true, shouldValidate: true })
                                  if (opt.value) {
                                    setValue('familyIncome', undefined, { shouldDirty: true })
                                    setValue('parentGuardianIncome', undefined, { shouldDirty: true })
                                  } else {
                                    setValue('isInHardship', false, { shouldDirty: true })
                                  }
                                }}
                                className={`h-11 rounded-md border-2 px-4 text-center text-base font-medium transition-colors ${
                                  selected
                                    ? 'border-green-600 bg-green-50/10 text-green-600 font-semibold'
                                    : 'border-border bg-card hover:border-muted-foreground'
                                }`}
                                aria-pressed={selected}
                              >
                                {opt.label}
                              </button>
                            )
                          })}
                        </div>
                      </div>

                      {/* Conditionally render based on BPL status */}
                      {bplStatus === true ? (
                        <div className="space-y-3">
                          <Label className="text-base font-semibold">
                            <span className="text-destructive">*</span>{t('form.fields.isInHardship')}
                          </Label>
                          <div className="grid grid-cols-2 gap-3">
                            {[{ label: yesLabel, value: true }, { label: noLabel, value: false }].map((opt) => {
                              const selected = isInHardship === opt.value
                              return (
                                <button
                                  key={opt.label}
                                  type="button"
                                  onClick={() => setValue('isInHardship', opt.value, { shouldDirty: true, shouldValidate: true })}
                                  className={`h-11 rounded-md border-2 px-4 text-center text-base font-medium transition-colors ${
                                    selected
                                      ? 'border-green-600 bg-green-50/10 text-green-600 font-semibold'
                                      : 'border-border bg-card hover:border-muted-foreground'
                                  }`}
                                  aria-pressed={selected}
                                  >
                                  {opt.label}
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      ) : bplStatus === false ? (
                        <div className="space-y-2 animate-in fade-in slide-in-from-top-1 duration-200">
                          <Label htmlFor="familyIncome" className="text-base font-semibold">
                            {isStudent ? t('form.fields.parentIncome') : t('form.fields.familyIncome')}
                          </Label>
                          <Input
                            id="familyIncome"
                            type="number"
                            min={0}
                            {...register('familyIncome', { valueAsNumber: true })}
                            placeholder={t('form.fields.incomePlaceholder')}
                            className="h-11"
                          />
                          {errors.familyIncome && <p className="text-sm text-destructive">{getErrorMessage(errors.familyIncome)}</p>}
                        </div>
                      ) : null}
                    </>
                  )}
                </div>
              )}

            </motion.div>
          </AnimatePresence>

          <div className="mt-8 flex justify-between gap-4">
            <Button type="button" variant="outline" onClick={prevStep} disabled={step === 0 || isSubmitting}>
              {t('form.prev')}
            </Button>
            {activeStepIndex < totalActiveSteps - 1 ? (
              <Button type="button" onClick={nextStep} disabled={isSubmitting}>{t('form.next')}</Button>
            ) : (
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? t('form.evaluating', 'Evaluating...') : t('form.submit')}
              </Button>
            )}
          </div>
        </form>
      </CardContent>
          </Card>
          )
}
