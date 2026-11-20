import React, { useState, useEffect } from 'react';
import { Modal } from './Modal';
import { useAuth } from '../context/AuthContext';
import { dataService } from '../services/dataService';
import {
  formatName,
  validateName,
  validateEmail,
  cleanIndianMobile,
  validateIndianMobile,
  validatePassword,
  validatePasswordMatch,
  cleanAadhaar,
  validateAadhaar,
  maskAadhaar,
  cleanPAN,
  validatePAN,
  cleanBankAccount,
  validateBankAccount,
  maskBankAccount,
  cleanIFSC,
  validateIFSC,
  validateDOB,
  calculateAge,
  getMinAgeCutoffDate,
  validatePincode,
  cleanPincode
} from '../utils/formValidation.js';
import {
  UserPlus,
  User,
  Phone,
  Mail,
  MapPin,
  Building2,
  Layers,
  Award,
  Lock,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ShieldCheck,
  Eye,
  EyeOff,
  Upload,
  FileText,
  Check,
  ChevronRight,
  ChevronLeft,
  Landmark,
  CreditCard,
  Shield,
  Camera,
  FileCheck
} from 'lucide-react';

export function AgentOnboardingModal({ isOpen, onClose, onSuccess, level }) {
  const { user } = useAuth();

  // 1. Determine authorized level strictly from logged-in Sub-Admin's account
  const userRole = String(user?.role || '').toLowerCase().replace(/_/g, ' ').replace(/-/g, ' ').trim();
  const adminUserRole = String(user?.adminRole || '').toLowerCase().replace(/_/g, ' ').replace(/-/g, ' ').trim();
  const isSuperAdmin = (userRole.includes('super admin') || userRole === 'main admin' || (userRole === 'admin' && !adminUserRole.includes('state') && !adminUserRole.includes('district') && !adminUserRole.includes('division') && !adminUserRole.includes('pincode') && !user?.level?.includes('state'))) && (!user?.state || user?.state.toLowerCase() === 'all india');

  let activeLevel = 'state';
  if (userRole.includes('pincode')) activeLevel = 'pincode';
  else if (userRole.includes('division') || userRole.includes('divisional')) activeLevel = 'division';
  else if (userRole.includes('district')) activeLevel = 'district';
  else if (userRole.includes('state')) activeLevel = 'state';
  else if (level) activeLevel = level;

  // Title and badge configs
  const LEVEL_META = {
    state: {
      title: 'Add State Agent',
      badge: 'State Agent',
      roleTitle: 'State Agent',
      icon: Award,
      badgeColor: 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/60 dark:text-purple-300 dark:border-purple-800'
    },
    district: {
      title: 'Add District Agent',
      badge: 'District Agent',
      roleTitle: 'District Agent',
      icon: Building2,
      badgeColor: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800'
    },
    division: {
      title: 'Add Division Agent',
      badge: 'Division Agent',
      roleTitle: 'Division Agent',
      icon: Layers,
      badgeColor: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800'
    },
    pincode: {
      title: 'Add Pincode Agent',
      badge: 'Pincode Agent',
      roleTitle: 'Pincode Agent',
      icon: MapPin,
      badgeColor: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800'
    }
  };

  const meta = LEVEL_META[activeLevel] || LEVEL_META.state;
  const LevelIcon = meta.icon;

  // Prefilled & locked assigned territory from authenticated account
  const assignedState = user?.state || user?.assignedState || 'Tamil Nadu';
  const assignedDistrict = user?.district || user?.assignedDistrict || '';
  const assignedDivision = user?.division || user?.assignedDivision || '';
  const assignedPincode = user?.pincode ? String(user.pincode).trim() : (user?.assignedPincode ? String(user.assignedPincode).trim() : '');

  // Wizard Step Management (1: Credentials, 2: Profile & Address, 3: Bank Details, 4: Documents & Declarations)
  const [currentStep, setCurrentStep] = useState(1);

  // Form State
  const initialFormState = {
    // Step 1: Role & Account Credentials
    roleApplied: meta.roleTitle,
    name: '',
    mobile: '',
    email: '',
    password: '',
    confirmPassword: '',

    // Step 2: Identity & Personal Details
    profilePhoto: '',
    profilePhotoName: '',
    alternativeMobile: '',
    dob: '',
    gender: '',
    aadhaarNumber: '',
    panNumber: '',

    // Step 2: Professional Background
    highestQualification: '',
    experienceLevel: '',
    previousCompany: '',

    // Step 2: Physical / Contact Address (Separate from assigned territory)
    doorNo: '',
    street: '',
    village: '',
    postOffice: '',
    taluk: '',
    physicalState: assignedState || 'Tamil Nadu',
    physicalDistrict: assignedDistrict || '',
    physicalPincode: '',

    // Step 3: Bank Details
    bankName: '',
    accountNumber: '',
    confirmAccountNumber: '',
    ifscCode: '',

    // Step 4: Documents Upload
    aadhaarCardFront: '',
    aadhaarCardFrontName: '',
    aadhaarCardBack: '',
    aadhaarCardBackName: '',
    panCard: '',
    panCardName: '',
    passportPhoto: '',
    passportPhotoName: '',
    reuseProfilePhoto: false,
    digitalSignature: '',
    digitalSignatureName: '',
    educationalCertificate: '',
    educationalCertificateName: '',
    bankProof: '',
    bankProofName: '',

    // Step 4: Legal Declarations (All 3 mandatory)
    declarationTruthfulness: false,
    declarationTerms: false,
    declarationAdminVerification: false
  };

  const [formData, setFormData] = useState(initialFormState);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Validation Errors by Field
  const [fieldErrors, setFieldErrors] = useState({});
  const [stepError, setStepError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setFormData({
        ...initialFormState,
        roleApplied: meta.roleTitle,
        physicalState: assignedState || 'Tamil Nadu',
        physicalDistrict: assignedDistrict || ''
      });
      setCurrentStep(1);
      setFieldErrors({});
      setStepError('');
      setSuccessMsg('');
      setSubmitting(false);
    }
  }, [isOpen, activeLevel, meta.roleTitle, assignedState, assignedDistrict]);

  // Handle Text / Select Input Changes
  const handleInputChange = (e) => {
    const { name, value, type, checked } = e.target;
    let finalValue = type === 'checkbox' ? checked : value;

    // Field-specific auto-formatting
    if (name === 'name') {
      finalValue = formatName(value);
    } else if (name === 'mobile' || name === 'alternativeMobile') {
      finalValue = cleanIndianMobile(value).slice(0, 10);
    } else if (name === 'aadhaarNumber') {
      finalValue = cleanAadhaar(value).slice(0, 12);
    } else if (name === 'panNumber') {
      finalValue = cleanPAN(value).slice(0, 10);
    } else if (name === 'physicalPincode') {
      finalValue = cleanPincode(value);
    } else if (name === 'accountNumber' || name === 'confirmAccountNumber') {
      finalValue = cleanBankAccount(value).slice(0, 18);
    } else if (name === 'ifscCode') {
      finalValue = cleanIFSC(value).slice(0, 11);
    } else if (name === 'experienceLevel') {
      // Auto-set Previous Company to 'N/A' for Freshers
      if (value.toLowerCase().includes('fresher')) {
        setFormData(prev => ({
          ...prev,
          experienceLevel: value,
          previousCompany: 'N/A'
        }));
        if (fieldErrors.previousCompany) {
          setFieldErrors(prev => ({ ...prev, previousCompany: '' }));
        }
        return;
      } else {
        setFormData(prev => ({
          ...prev,
          experienceLevel: value,
          previousCompany: prev.previousCompany === 'N/A' ? '' : prev.previousCompany
        }));
        return;
      }
    }

    setFormData(prev => ({ ...prev, [name]: finalValue }));

    // Clear inline error on change
    if (fieldErrors[name]) {
      setFieldErrors(prev => ({ ...prev, [name]: '' }));
    }
    if (stepError) setStepError('');
  };

  // Handle File Upload to Base64 (JPG, PNG, PDF <= 5MB)
  const handleFileUpload = (field, nameField, e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      setFieldErrors(prev => ({ ...prev, [field]: 'File size exceeds maximum limit of 5 MB.' }));
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result;
      setFormData(prev => {
        const updated = {
          ...prev,
          [field]: base64,
          [nameField]: file.name
        };
        // If reusing profile photo and profile photo changes, sync passport photo
        if (field === 'profilePhoto' && prev.reuseProfilePhoto) {
          updated.passportPhoto = base64;
          updated.passportPhotoName = file.name;
        }
        return updated;
      });
      setFieldErrors(prev => ({ ...prev, [field]: '' }));
    };
    reader.readAsDataURL(file);
  };

  // Toggle Reuse Profile Photo for Passport Photo
  const handleReuseProfilePhotoToggle = (e) => {
    const checked = e.target.checked;
    setFormData(prev => ({
      ...prev,
      reuseProfilePhoto: checked,
      passportPhoto: checked ? prev.profilePhoto : '',
      passportPhotoName: checked ? (prev.profilePhotoName || 'profile_photo.jpg') : ''
    }));
    if (checked && fieldErrors.passportPhoto) {
      setFieldErrors(prev => ({ ...prev, passportPhoto: '' }));
    }
  };

  // ─────────────────────────────────────────────────────────────────
  // STEP VALIDATION LOGIC
  // ─────────────────────────────────────────────────────────────────

  const validateStep1 = () => {
    const errors = {};

    const nameRes = validateName(formData.name, 'Full Name', true);
    if (!nameRes.isValid) errors.name = nameRes.message;

    const mobileRes = validateIndianMobile(formData.mobile, true, 'Primary Mobile Number');
    if (!mobileRes.isValid) errors.mobile = mobileRes.message;

    const emailRes = validateEmail(formData.email, true);
    if (!emailRes.isValid) errors.email = emailRes.message;

    const passRes = validatePassword(formData.password, true);
    if (!passRes.isValid) errors.password = passRes.message;

    const passMatch = validatePasswordMatch(formData.password, formData.confirmPassword);
    if (!passMatch.isValid) errors.confirmPassword = passMatch.message;

    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      setStepError('Please fix the highlighted errors before continuing.');
      return false;
    }
    setStepError('');
    return true;
  };

  const validateStep2 = () => {
    const errors = {};

    // Profile Photo
    if (!formData.profilePhoto) {
      errors.profilePhoto = 'Profile photo is mandatory (JPG/PNG <= 5MB).';
    }

    // Alt Mobile
    const altMobileRes = validateIndianMobile(formData.alternativeMobile, true, 'Alternative Mobile Number');
    if (!altMobileRes.isValid) {
      errors.alternativeMobile = altMobileRes.message;
    } else if (formData.alternativeMobile === formData.mobile) {
      errors.alternativeMobile = 'Alternative mobile cannot be identical to primary mobile.';
    }

    // DOB (18+)
    const dobRes = validateDOB(formData.dob, 18, true);
    if (!dobRes.isValid) errors.dob = dobRes.message;

    // Gender
    if (!formData.gender) errors.gender = 'Please select a gender.';

    // Aadhaar (12 digits)
    const aadhaarRes = validateAadhaar(formData.aadhaarNumber, true);
    if (!aadhaarRes.isValid) errors.aadhaarNumber = aadhaarRes.message;

    // PAN Card
    const panRes = validatePAN(formData.panNumber, true);
    if (!panRes.isValid) errors.panNumber = panRes.message;

    // Qualification
    if (!formData.highestQualification) errors.highestQualification = 'Highest qualification is mandatory.';

    // Experience
    if (!formData.experienceLevel) {
      errors.experienceLevel = 'Experience level is mandatory.';
    } else if (!formData.experienceLevel.toLowerCase().includes('fresher') && (!formData.previousCompany || formData.previousCompany === 'N/A')) {
      errors.previousCompany = 'Previous company name is mandatory for experienced candidates.';
    }

    // Physical Address (All 8 fields mandatory)
    if (!formData.doorNo.trim()) errors.doorNo = 'Building / Door / Shop No is required.';
    if (!formData.street.trim()) errors.street = 'Street Name / Area is required.';
    if (!formData.village.trim()) errors.village = 'Village / Locality is required.';
    if (!formData.postOffice.trim()) errors.postOffice = 'Post Office is required.';
    if (!formData.taluk.trim()) errors.taluk = 'Taluk is required.';
    if (!formData.physicalState.trim()) errors.physicalState = 'State is required.';
    if (!formData.physicalDistrict.trim()) errors.physicalDistrict = 'District is required.';

    const pinRes = validatePincode(formData.physicalPincode, true);
    if (!pinRes.isValid) errors.physicalPincode = pinRes.message;

    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      setStepError('Please complete all mandatory profile and address fields before continuing.');
      return false;
    }
    setStepError('');
    return true;
  };

  const validateStep3 = () => {
    const errors = {};

    if (!formData.bankName.trim()) {
      errors.bankName = 'Bank Name is mandatory.';
    }

    const accRes = validateBankAccount(formData.accountNumber, formData.bankName, true);
    if (!accRes.isValid) {
      errors.accountNumber = accRes.message;
    }

    if (formData.confirmAccountNumber && formData.accountNumber !== formData.confirmAccountNumber) {
      errors.confirmAccountNumber = 'Account Number and Confirm Account Number must match.';
    }

    const ifscRes = validateIFSC(formData.ifscCode, true);
    if (!ifscRes.isValid) {
      errors.ifscCode = ifscRes.message;
    }

    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      setStepError('Please correct the bank details before continuing.');
      return false;
    }
    setStepError('');
    return true;
  };

  const validateStep4 = () => {
    const errors = {};

    if (!formData.aadhaarCardFront) errors.aadhaarCardFront = 'Aadhaar Card Front is mandatory.';
    if (!formData.aadhaarCardBack) errors.aadhaarCardBack = 'Aadhaar Card Back is mandatory.';
    if (!formData.panCard) errors.panCard = 'PAN Card copy is mandatory.';
    if (!formData.passportPhoto) errors.passportPhoto = 'Passport Photo is mandatory.';
    if (!formData.digitalSignature) errors.digitalSignature = 'Digital Signature is mandatory.';

    if (!formData.declarationTruthfulness) {
      errors.declarationTruthfulness = 'You must confirm that all submitted information is correct and true.';
    }
    if (!formData.declarationTerms) {
      errors.declarationTerms = 'You must accept the Terms & Conditions and Privacy Policy.';
    }
    if (!formData.declarationAdminVerification) {
      errors.declarationAdminVerification = 'You must acknowledge administration verification and approval.';
    }

    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      setStepError('Please complete all mandatory document uploads and accept all 3 legal declarations.');
      return false;
    }
    setStepError('');
    return true;
  };

  // Next / Prev Navigation
  const handleNextStep = () => {
    if (currentStep === 1) {
      if (validateStep1()) setCurrentStep(2);
    } else if (currentStep === 2) {
      if (validateStep2()) setCurrentStep(3);
    } else if (currentStep === 3) {
      if (validateStep3()) setCurrentStep(4);
    }
  };

  const handlePrevStep = () => {
    setStepError('');
    setCurrentStep(prev => Math.max(prev - 1, 1));
  };

  // Final Submission
  const handleSubmit = async (e) => {
    e.preventDefault();
    setStepError('');
    setSuccessMsg('');

    // Re-validate all steps
    if (!validateStep1()) { setCurrentStep(1); return; }
    if (!validateStep2()) { setCurrentStep(2); return; }
    if (!validateStep3()) { setCurrentStep(3); return; }
    if (!validateStep4()) { setCurrentStep(4); return; }

    setSubmitting(true);
    try {
      const payload = {
        // Step 1
        name: formData.name.trim(),
        mobile: formData.mobile.trim(),
        phone: formData.mobile.trim(),
        email: formData.email.trim().toLowerCase(),
        password: formData.password,
        confirmPassword: formData.confirmPassword,
        level: activeLevel,
        role: `${activeLevel}_agent`,

        // Assigned Territory (Strictly matching authenticated scope)
        state: assignedState,
        district: activeLevel === 'state' ? null : (assignedDistrict || null),
        division: (activeLevel === 'division' || activeLevel === 'pincode') ? (assignedDivision || null) : null,
        pincode: activeLevel === 'pincode' ? (assignedPincode || null) : null,
        stateId: user?.stateId || null,
        districtId: activeLevel === 'state' ? null : (user?.districtId || null),
        divisionId: (activeLevel === 'division' || activeLevel === 'pincode') ? (user?.divisionId || null) : null,
        pincodeId: activeLevel === 'pincode' ? (user?.pincodeId || null) : null,

        // Step 2 Identity & Personal
        profilePhoto: formData.profilePhoto,
        alternativeMobile: formData.alternativeMobile.trim(),
        dob: formData.dob,
        gender: formData.gender,
        aadhaarNumber: formData.aadhaarNumber,
        panNumber: formData.panNumber.toUpperCase(),

        // Step 2 Professional Background
        highestQualification: formData.highestQualification,
        experienceLevel: formData.experienceLevel,
        previousCompany: formData.experienceLevel.toLowerCase().includes('fresher') ? 'N/A' : formData.previousCompany.trim(),

        // Step 2 Physical Contact Address
        physicalAddress: {
          doorNo: formData.doorNo.trim(),
          street: formData.street.trim(),
          village: formData.village.trim(),
          postOffice: formData.postOffice.trim(),
          taluk: formData.taluk.trim(),
          state: formData.physicalState.trim(),
          district: formData.physicalDistrict.trim(),
          pincode: formData.physicalPincode.trim()
        },

        // Step 3 Bank Details
        bankDetails: {
          bankName: formData.bankName.trim(),
          accountNumber: formData.accountNumber.trim(),
          ifscCode: formData.ifscCode.trim().toUpperCase()
        },

        // Step 4 Documents Upload
        documents: {
          aadhaarCard: formData.aadhaarCardFront,
          aadhaarCardFront: formData.aadhaarCardFront,
          aadhaarCardBack: formData.aadhaarCardBack,
          panCard: formData.panCard,
          passportPhoto: formData.passportPhoto || formData.profilePhoto,
          digitalSignature: formData.digitalSignature,
          educationalCertificate: formData.educationalCertificate || null,
          bankProof: formData.bankProof || null
        },

        // Step 4 Legal Declarations
        declarations: {
          truthfulness: formData.declarationTruthfulness,
          declarationTruthfulness: formData.declarationTruthfulness,
          termsAndPrivacy: formData.declarationTerms,
          declarationTerms: formData.declarationTerms,
          adminVerification: formData.declarationAdminVerification,
          declarationAdminVerification: formData.declarationAdminVerification
        }
      };

      const res = await dataService.addAgent(payload);
      if (res && res.success) {
        setSuccessMsg(res.message || `${meta.roleTitle} onboarded successfully! Awaiting territory verification and approval.`);
        setTimeout(() => {
          if (onSuccess) onSuccess(res.agent);
          onClose();
        }, 1500);
      } else {
        setStepError(res?.message || 'Failed to onboard agent. Please verify details.');
      }
    } catch (err) {
      console.error('Agent onboarding error:', err);
      setStepError(err?.message || 'Server error occurred while onboarding agent.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={meta.title} maxWidth="max-w-3xl">
      <div className="space-y-4">
        {/* Global Mandatory Notice */}
        <div className="text-[11px] font-medium text-slate-600 dark:text-slate-400 bg-amber-50/80 dark:bg-amber-950/40 border border-amber-200/80 dark:border-amber-800/80 rounded-xl px-3 py-2 flex items-center gap-2">
          <span className="text-rose-500 font-bold text-sm">*</span>
          <span>All fields are mandatory unless explicitly marked <strong>Optional</strong> or <strong>Not Applicable (N/A)</strong> for your selected role.</span>
        </div>

        {/* Territory Scope & Same-Level Rule Banner */}
        <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/80 flex items-start gap-3">
          <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-950/80 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5">
            <LevelIcon className="w-4 h-4" />
          </div>
          <div className="text-xs space-y-1 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-slate-800 dark:text-slate-200">Authorized Onboarding Scope:</span>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${meta.badgeColor}`}>
                {meta.badge}
              </span>
              <span className="text-[10px] text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 px-2 py-0.5 rounded-full font-medium flex items-center gap-1">
                <Lock className="w-3 h-3" /> Same-level territory rule enforced
              </span>
            </div>
            <p className="text-slate-500 dark:text-slate-400 text-[11px]">
              You can onboard agents only at your assigned territory level and within your assigned territory. Agents enter pending status for territory verification and approval.
            </p>
          </div>
        </div>

        {/* 4-Step Progress Indicator */}
        <div className="py-2 border-y border-slate-200 dark:border-slate-800">
          <div className="grid grid-cols-4 gap-2">
            {[
              { num: 1, label: 'Credentials', icon: User },
              { num: 2, label: 'Profile & Address', icon: MapPin },
              { num: 3, label: 'Bank Details', icon: Landmark },
              { num: 4, label: 'Documents & KYC', icon: FileCheck }
            ].map(step => {
              const isDone = currentStep > step.num;
              const isCurrent = currentStep === step.num;
              const StepIcon = step.icon;

              return (
                <div
                  key={step.num}
                  className={`flex items-center gap-2 p-2 rounded-xl border text-xs transition-all ${
                    isCurrent
                      ? 'bg-blue-50 dark:bg-blue-950/60 border-blue-500 text-blue-700 dark:text-blue-300 font-bold shadow-xs'
                      : isDone
                      ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 font-semibold'
                      : 'bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700/60 text-slate-400'
                  }`}
                >
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] shrink-0 font-bold ${
                    isCurrent
                      ? 'bg-blue-600 text-white'
                      : isDone
                      ? 'bg-emerald-600 text-white'
                      : 'bg-slate-200 dark:bg-slate-700 text-slate-500'
                  }`}>
                    {isDone ? <Check className="w-3 h-3" /> : step.num}
                  </div>
                  <div className="hidden sm:block truncate">
                    <span className="block text-[11px] leading-tight truncate">{step.label}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Alerts */}
        {stepError && (
          <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300 flex items-start gap-2 animate-fadeIn">
            <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
            <div className="flex-1 font-medium">{stepError}</div>
          </div>
        )}

        {successMsg && (
          <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-700 dark:text-emerald-300 flex items-start gap-2 animate-fadeIn">
            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
            <div className="flex-1 font-medium">{successMsg}</div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* ============================================================== */}
          {/* STEP 1: ROLE APPLIED FOR & ACCOUNT CREDENTIALS */}
          {/* ============================================================== */}
          {currentStep === 1 && (
            <div className="space-y-4 animate-fadeIn">
              <div className="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-slate-800">
                <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                  <User className="w-4 h-4 text-blue-600" />
                  <span>Step 1: Role Applied For & Account Credentials</span>
                </h4>
                <span className="text-[11px] text-slate-500">Step 1 of 4</span>
              </div>

              {/* Role Applied For (Locked by same-level territory rule) */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1 flex items-center gap-1.5">
                  <span>Role Applied For</span>
                  <span className="text-rose-500 font-bold">*</span>
                  <Lock className="w-3 h-3 text-amber-500" />
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={formData.roleApplied}
                    readOnly
                    disabled
                    className="w-full pl-9 pr-3 py-2 text-xs rounded-xl bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 font-bold cursor-not-allowed select-none"
                  />
                  <ShieldCheck className="w-4 h-4 text-purple-600 absolute left-3 top-2.5" />
                </div>
                <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1">
                  Locked to your authorized tier: {meta.roleTitle}. You cannot onboard agents at higher or lower levels.
                </p>
              </div>

              {/* Full Name */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Full Name <span className="text-rose-500 font-bold">*</span>
                  <span className="text-[10px] text-slate-400 font-normal ml-1">(2–100 characters; letters and spaces only)</span>
                </label>
                <div className="relative">
                  <User className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    name="name"
                    value={formData.name}
                    onChange={handleInputChange}
                    placeholder="e.g. Ramesh Kumar"
                    className={`w-full pl-9 pr-3 py-2 text-xs rounded-xl bg-white dark:bg-slate-900 border ${
                      fieldErrors.name ? 'border-rose-500 focus:ring-rose-500' : 'border-slate-300 dark:border-slate-700 focus:ring-blue-500'
                    } focus:outline-none focus:ring-2 dark:text-white`}
                  />
                </div>
                {fieldErrors.name && (
                  <p className="text-[11px] text-rose-500 mt-1 font-medium">{fieldErrors.name}</p>
                )}
              </div>

              {/* Primary Mobile & Email */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Primary Mobile Number <span className="text-rose-500 font-bold">*</span>
                  </label>
                  <div className="relative">
                    <Phone className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                    <input
                      type="tel"
                      name="mobile"
                      value={formData.mobile}
                      onChange={handleInputChange}
                      placeholder="10-digit mobile (6-9)"
                      maxLength={10}
                      className={`w-full pl-9 pr-3 py-2 text-xs rounded-xl bg-white dark:bg-slate-900 border ${
                        fieldErrors.mobile ? 'border-rose-500 focus:ring-rose-500' : 'border-slate-300 dark:border-slate-700 focus:ring-blue-500'
                      } focus:outline-none focus:ring-2 dark:text-white font-mono`}
                    />
                  </div>
                  {fieldErrors.mobile ? (
                    <p className="text-[11px] text-rose-500 mt-1 font-medium">{fieldErrors.mobile}</p>
                  ) : (
                    <p className="text-[10px] text-slate-400 mt-1">Must be exactly 10 digits starting with 6, 7, 8, or 9.</p>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Email Address <span className="text-rose-500 font-bold">*</span>
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                    <input
                      type="email"
                      name="email"
                      value={formData.email}
                      onChange={handleInputChange}
                      placeholder="agent@example.com"
                      className={`w-full pl-9 pr-3 py-2 text-xs rounded-xl bg-white dark:bg-slate-900 border ${
                        fieldErrors.email ? 'border-rose-500 focus:ring-rose-500' : 'border-slate-300 dark:border-slate-700 focus:ring-blue-500'
                      } focus:outline-none focus:ring-2 dark:text-white`}
                    />
                  </div>
                  {fieldErrors.email && (
                    <p className="text-[11px] text-rose-500 mt-1 font-medium">{fieldErrors.email}</p>
                  )}
                </div>
              </div>

              {/* Password & Confirm Password */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Account Password <span className="text-rose-500 font-bold">*</span>
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      name="password"
                      value={formData.password}
                      onChange={handleInputChange}
                      placeholder="Min 6 chars (Upper, Num, Special)"
                      className={`w-full pl-9 pr-9 py-2 text-xs rounded-xl bg-white dark:bg-slate-900 border ${
                        fieldErrors.password ? 'border-rose-500 focus:ring-rose-500' : 'border-slate-300 dark:border-slate-700 focus:ring-blue-500'
                      } focus:outline-none focus:ring-2 dark:text-white`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(p => !p)}
                      className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  {fieldErrors.password ? (
                    <p className="text-[11px] text-rose-500 mt-1 font-medium">{fieldErrors.password}</p>
                  ) : (
                    <p className="text-[10px] text-slate-400 mt-1">Min 6 chars, at least 1 uppercase, 1 digit, 1 symbol</p>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Confirm Password <span className="text-rose-500 font-bold">*</span>
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                    <input
                      type={showConfirmPassword ? 'text' : 'password'}
                      name="confirmPassword"
                      value={formData.confirmPassword}
                      onChange={handleInputChange}
                      placeholder="Re-enter password"
                      className={`w-full pl-9 pr-9 py-2 text-xs rounded-xl bg-white dark:bg-slate-900 border ${
                        fieldErrors.confirmPassword ? 'border-rose-500 focus:ring-rose-500' : 'border-slate-300 dark:border-slate-700 focus:ring-blue-500'
                      } focus:outline-none focus:ring-2 dark:text-white`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(p => !p)}
                      className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                    >
                      {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  {fieldErrors.confirmPassword && (
                    <p className="text-[11px] text-rose-500 mt-1 font-medium">{fieldErrors.confirmPassword}</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* STEP 2: PROFILE, VERIFICATION, TERRITORY & PHYSICAL ADDRESS */}
          {/* ============================================================== */}
          {currentStep === 2 && (
            <div className="space-y-4 animate-fadeIn">
              <div className="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-slate-800">
                <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                  <MapPin className="w-4 h-4 text-blue-600" />
                  <span>Step 2: Profile, Territory & Physical Address</span>
                </h4>
                <span className="text-[11px] text-slate-500">Step 2 of 4</span>
              </div>

              {/* Sub-Section A: Identity & Personal Details */}
              <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700 space-y-3">
                <h5 className="text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider flex items-center gap-1">
                  <User className="w-3.5 h-3.5 text-blue-500" />
                  <span>A. Identity & Personal Details</span>
                </h5>

                {/* Profile Photo Upload */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Profile Photo <span className="text-rose-500 font-bold">*</span>
                    <span className="text-[10px] text-slate-400 font-normal ml-1">(JPG/PNG, max 5 MB)</span>
                  </label>
                  <div className="flex items-center gap-3">
                    {formData.profilePhoto ? (
                      <img
                        src={formData.profilePhoto}
                        alt="Profile Preview"
                        className="w-12 h-12 rounded-xl object-cover border-2 border-blue-500 shadow-xs"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded-xl bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-slate-400">
                        <Camera className="w-5 h-5" />
                      </div>
                    )}
                    <label className="cursor-pointer inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 shadow-xs transition">
                      <Upload className="w-3.5 h-3.5 text-blue-600" />
                      <span>{formData.profilePhoto ? 'Change Photo' : 'Upload Profile Photo'}</span>
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/jpg"
                        onChange={(e) => handleFileUpload('profilePhoto', 'profilePhotoName', e)}
                        className="hidden"
                      />
                    </label>
                    {formData.profilePhotoName && (
                      <span className="text-[11px] text-slate-500 truncate max-w-xs">{formData.profilePhotoName}</span>
                    )}
                  </div>
                  {fieldErrors.profilePhoto && (
                    <p className="text-[11px] text-rose-500 mt-1 font-medium">{fieldErrors.profilePhoto}</p>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {/* Alternative Mobile */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Alternative Mobile <span className="text-rose-500 font-bold">*</span>
                    </label>
                    <input
                      type="tel"
                      name="alternativeMobile"
                      value={formData.alternativeMobile}
                      onChange={handleInputChange}
                      placeholder="10-digit mobile"
                      maxLength={10}
                      className={`w-full px-3 py-2 text-xs rounded-xl bg-white dark:bg-slate-900 border ${
                        fieldErrors.alternativeMobile ? 'border-rose-500' : 'border-slate-300 dark:border-slate-700'
                      } focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-white font-mono`}
                    />
                    {fieldErrors.alternativeMobile && (
                      <p className="text-[11px] text-rose-500 mt-1 font-medium">{fieldErrors.alternativeMobile}</p>
                    )}
                  </div>

                  {/* DOB */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Date of Birth (18+) <span className="text-rose-500 font-bold">*</span>
                    </label>
                    <input
                      type="date"
                      name="dob"
                      max={getMinAgeCutoffDate(18)}
                      value={formData.dob}
                      onChange={handleInputChange}
                      className={`w-full px-3 py-2 text-xs rounded-xl bg-white dark:bg-slate-900 border ${
                        fieldErrors.dob ? 'border-rose-500' : 'border-slate-300 dark:border-slate-700'
                      } focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-white`}
                    />
                    {fieldErrors.dob && (
                      <p className="text-[11px] text-rose-500 mt-1 font-medium">{fieldErrors.dob}</p>
                    )}
                  </div>

                  {/* Gender */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Gender <span className="text-rose-500 font-bold">*</span>
                    </label>
                    <select
                      name="gender"
                      value={formData.gender}
                      onChange={handleInputChange}
                      className={`w-full px-3 py-2 text-xs rounded-xl bg-white dark:bg-slate-900 border ${
                        fieldErrors.gender ? 'border-rose-500' : 'border-slate-300 dark:border-slate-700'
                      } focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-white`}
                    >
                      <option value="">Select Gender</option>
                      <option value="Male">Male</option>
                      <option value="Female">Female</option>
                      <option value="Other">Other</option>
                      <option value="Prefer Not to Say">Prefer Not to Say</option>
                    </select>
                    {fieldErrors.gender && (
                      <p className="text-[11px] text-rose-500 mt-1 font-medium">{fieldErrors.gender}</p>
                    )}
                  </div>
                </div>

                {/* Aadhaar & PAN */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Aadhaar Number <span className="text-rose-500 font-bold">*</span>
                      <span className="text-[10px] text-slate-400 font-normal ml-1">(12 numeric digits)</span>
                    </label>
                    <input
                      type="text"
                      name="aadhaarNumber"
                      value={formData.aadhaarNumber}
                      onChange={handleInputChange}
                      placeholder="12-digit Aadhaar"
                      maxLength={12}
                      className={`w-full px-3 py-2 text-xs rounded-xl bg-white dark:bg-slate-900 border ${
                        fieldErrors.aadhaarNumber ? 'border-rose-500' : 'border-slate-300 dark:border-slate-700'
                      } focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-white font-mono`}
                    />
                    {fieldErrors.aadhaarNumber && (
                      <p className="text-[11px] text-rose-500 mt-1 font-medium">{fieldErrors.aadhaarNumber}</p>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      PAN Number <span className="text-rose-500 font-bold">*</span>
                      <span className="text-[10px] text-slate-400 font-normal ml-1">(ABCDE1234F)</span>
                    </label>
                    <input
                      type="text"
                      name="panNumber"
                      value={formData.panNumber}
                      onChange={handleInputChange}
                      placeholder="e.g. ABCDE1234F"
                      maxLength={10}
                      className={`w-full px-3 py-2 text-xs rounded-xl bg-white dark:bg-slate-900 border ${
                        fieldErrors.panNumber ? 'border-rose-500' : 'border-slate-300 dark:border-slate-700'
                      } focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-white font-mono uppercase`}
                    />
                    {fieldErrors.panNumber && (
                      <p className="text-[11px] text-rose-500 mt-1 font-medium">{fieldErrors.panNumber}</p>
                    )}
                  </div>
                </div>

                {/* Qualification & Experience */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Highest Qualification <span className="text-rose-500 font-bold">*</span>
                    </label>
                    <select
                      name="highestQualification"
                      value={formData.highestQualification}
                      onChange={handleInputChange}
                      className={`w-full px-3 py-2 text-xs rounded-xl bg-white dark:bg-slate-900 border ${
                        fieldErrors.highestQualification ? 'border-rose-500' : 'border-slate-300 dark:border-slate-700'
                      } focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-white`}
                    >
                      <option value="">Select Qualification</option>
                      <option value="10th Standard / SSLC">10th Standard / SSLC</option>
                      <option value="12th Standard / HSC">12th Standard / HSC</option>
                      <option value="Diploma">Diploma</option>
                      <option value="Bachelor's Degree">Bachelor's Degree</option>
                      <option value="Master's Degree">Master's Degree</option>
                      <option value="Doctorate / PhD">Doctorate / PhD</option>
                      <option value="Other">Other</option>
                    </select>
                    {fieldErrors.highestQualification && (
                      <p className="text-[11px] text-rose-500 mt-1 font-medium">{fieldErrors.highestQualification}</p>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Experience Level <span className="text-rose-500 font-bold">*</span>
                    </label>
                    <select
                      name="experienceLevel"
                      value={formData.experienceLevel}
                      onChange={handleInputChange}
                      className={`w-full px-3 py-2 text-xs rounded-xl bg-white dark:bg-slate-900 border ${
                        fieldErrors.experienceLevel ? 'border-rose-500' : 'border-slate-300 dark:border-slate-700'
                      } focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-white`}
                    >
                      <option value="">Select Experience</option>
                      <option value="Fresher">Fresher</option>
                      <option value="1-2 Years">1-2 Years</option>
                      <option value="3-5 Years">3-5 Years</option>
                      <option value="5+ Years">5+ Years</option>
                    </select>
                    {fieldErrors.experienceLevel && (
                      <p className="text-[11px] text-rose-500 mt-1 font-medium">{fieldErrors.experienceLevel}</p>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Previous Company Name{' '}
                      {formData.experienceLevel === 'Fresher' ? (
                        <span className="text-slate-400 font-normal">(N/A for Fresher)</span>
                      ) : (
                        <span className="text-rose-500 font-bold">*</span>
                      )}
                    </label>
                    <input
                      type="text"
                      name="previousCompany"
                      value={formData.previousCompany}
                      onChange={handleInputChange}
                      disabled={formData.experienceLevel === 'Fresher'}
                      placeholder={formData.experienceLevel === 'Fresher' ? 'N/A' : 'e.g. Acme Corp'}
                      className={`w-full px-3 py-2 text-xs rounded-xl border ${
                        formData.experienceLevel === 'Fresher'
                          ? 'bg-slate-100 dark:bg-slate-800 text-slate-500 cursor-not-allowed border-slate-200 dark:border-slate-700 font-bold'
                          : fieldErrors.previousCompany
                          ? 'border-rose-500 bg-white dark:bg-slate-900'
                          : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900'
                      } focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-white`}
                    />
                    {fieldErrors.previousCompany && (
                      <p className="text-[11px] text-rose-500 mt-1 font-medium">{fieldErrors.previousCompany}</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Sub-Section B: Authorized Organizational Territory (Locked) */}
              <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700 space-y-2">
                <div className="flex items-center justify-between">
                  <h5 className="text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider flex items-center gap-1">
                    <Lock className="w-3.5 h-3.5 text-amber-500" />
                    <span>B. Authorized Organizational Territory</span>
                  </h5>
                  <span className="text-[10px] text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 px-2 py-0.5 rounded-full font-medium">
                    Locked to your jurisdiction
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-[11px]">
                  <div>
                    <span className="block text-slate-400 text-[10px]">Assigned State</span>
                    <span className="font-bold text-slate-800 dark:text-slate-200">{assignedState || 'Tamil Nadu'}</span>
                  </div>
                  <div>
                    <span className="block text-slate-400 text-[10px]">Assigned District</span>
                    <span className="font-semibold text-slate-700 dark:text-slate-300">
                      {activeLevel === 'state' ? 'System-derived (All)' : (assignedDistrict || 'Assigned District')}
                    </span>
                  </div>
                  <div>
                    <span className="block text-slate-400 text-[10px]">Assigned Division</span>
                    <span className="font-semibold text-slate-700 dark:text-slate-300">
                      {activeLevel === 'state' ? 'N/A - Statewide' : (activeLevel === 'district' ? 'District-wide' : (assignedDivision || 'Assigned Division'))}
                    </span>
                  </div>
                  <div>
                    <span className="block text-slate-400 text-[10px]">Taluk / Locality</span>
                    <span className="font-semibold text-slate-700 dark:text-slate-300">
                      {(activeLevel === 'state' || activeLevel === 'district') ? 'N/A' : (assignedDivision || 'Assigned')}
                    </span>
                  </div>
                  <div>
                    <span className="block text-slate-400 text-[10px]">Assigned PIN</span>
                    <span className="font-semibold font-mono text-slate-700 dark:text-slate-300">
                      {activeLevel === 'pincode' ? (assignedPincode || 'Assigned') : 'System-derived'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Sub-Section C: Physical / Contact Address (All 8 Fields Mandatory) */}
              <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700 space-y-3">
                <div className="flex items-center justify-between">
                  <h5 className="text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider flex items-center gap-1">
                    <Building2 className="w-3.5 h-3.5 text-blue-500" />
                    <span>C. Physical / Contact Address</span>
                    <span className="text-rose-500 font-bold">*</span>
                  </h5>
                  <span className="text-[10px] text-slate-400 font-medium">8 Mandatory Fields</span>
                </div>
                <p className="text-[10px] text-slate-500 dark:text-slate-400">
                  Applicant residential address. This remains distinct from organizational jurisdiction.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      1. Building No / Door No / Shop No <span className="text-rose-500 font-bold">*</span>
                    </label>
                    <input
                      type="text"
                      name="doorNo"
                      value={formData.doorNo}
                      onChange={handleInputChange}
                      placeholder="e.g. 12/4B, 2nd Floor"
                      className={`w-full px-3 py-2 text-xs rounded-xl bg-white dark:bg-slate-900 border ${
                        fieldErrors.doorNo ? 'border-rose-500' : 'border-slate-300 dark:border-slate-700'
                      } focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-white`}
                    />
                    {fieldErrors.doorNo && (
                      <p className="text-[11px] text-rose-500 mt-1 font-medium">{fieldErrors.doorNo}</p>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      2. Street Name / Area <span className="text-rose-500 font-bold">*</span>
                    </label>
                    <input
                      type="text"
                      name="street"
                      value={formData.street}
                      onChange={handleInputChange}
                      placeholder="e.g. Gandhi Nagar Main Road"
                      className={`w-full px-3 py-2 text-xs rounded-xl bg-white dark:bg-slate-900 border ${
                        fieldErrors.street ? 'border-rose-500' : 'border-slate-300 dark:border-slate-700'
                      } focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-white`}
                    />
                    {fieldErrors.street && (
                      <p className="text-[11px] text-rose-500 mt-1 font-medium">{fieldErrors.street}</p>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      3. Village / Locality <span className="text-rose-500 font-bold">*</span>
                    </label>
                    <input
                      type="text"
                      name="village"
                      value={formData.village}
                      onChange={handleInputChange}
                      placeholder="e.g. Adyar"
                      className={`w-full px-3 py-2 text-xs rounded-xl bg-white dark:bg-slate-900 border ${
                        fieldErrors.village ? 'border-rose-500' : 'border-slate-300 dark:border-slate-700'
                      } focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-white`}
                    />
                    {fieldErrors.village && (
                      <p className="text-[11px] text-rose-500 mt-1 font-medium">{fieldErrors.village}</p>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      4. Post Office <span className="text-rose-500 font-bold">*</span>
                    </label>
                    <input
                      type="text"
                      name="postOffice"
                      value={formData.postOffice}
                      onChange={handleInputChange}
                      placeholder="e.g. Adyar H.O"
                      className={`w-full px-3 py-2 text-xs rounded-xl bg-white dark:bg-slate-900 border ${
                        fieldErrors.postOffice ? 'border-rose-500' : 'border-slate-300 dark:border-slate-700'
                      } focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-white`}
                    />
                    {fieldErrors.postOffice && (
                      <p className="text-[11px] text-rose-500 mt-1 font-medium">{fieldErrors.postOffice}</p>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      5. Taluk <span className="text-rose-500 font-bold">*</span>
                    </label>
                    <input
                      type="text"
                      name="taluk"
                      value={formData.taluk}
                      onChange={handleInputChange}
                      placeholder="e.g. Velachery"
                      className={`w-full px-3 py-2 text-xs rounded-xl bg-white dark:bg-slate-900 border ${
                        fieldErrors.taluk ? 'border-rose-500' : 'border-slate-300 dark:border-slate-700'
                      } focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-white`}
                    />
                    {fieldErrors.taluk && (
                      <p className="text-[11px] text-rose-500 mt-1 font-medium">{fieldErrors.taluk}</p>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      6. State <span className="text-rose-500 font-bold">*</span>
                    </label>
                    <input
                      type="text"
                      name="physicalState"
                      value={formData.physicalState}
                      onChange={handleInputChange}
                      placeholder="e.g. Tamil Nadu"
                      className={`w-full px-3 py-2 text-xs rounded-xl bg-white dark:bg-slate-900 border ${
                        fieldErrors.physicalState ? 'border-rose-500' : 'border-slate-300 dark:border-slate-700'
                      } focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-white`}
                    />
                    {fieldErrors.physicalState && (
                      <p className="text-[11px] text-rose-500 mt-1 font-medium">{fieldErrors.physicalState}</p>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      7. District <span className="text-rose-500 font-bold">*</span>
                    </label>
                    <input
                      type="text"
                      name="physicalDistrict"
                      value={formData.physicalDistrict}
                      onChange={handleInputChange}
                      placeholder="e.g. Chennai"
                      className={`w-full px-3 py-2 text-xs rounded-xl bg-white dark:bg-slate-900 border ${
                        fieldErrors.physicalDistrict ? 'border-rose-500' : 'border-slate-300 dark:border-slate-700'
                      } focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-white`}
                    />
                    {fieldErrors.physicalDistrict && (
                      <p className="text-[11px] text-rose-500 mt-1 font-medium">{fieldErrors.physicalDistrict}</p>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      8. Pincode <span className="text-rose-500 font-bold">*</span>
                      <span className="text-[10px] text-slate-400 font-normal ml-1">(6 digits)</span>
                    </label>
                    <input
                      type="text"
                      name="physicalPincode"
                      value={formData.physicalPincode}
                      onChange={handleInputChange}
                      placeholder="e.g. 600020"
                      maxLength={6}
                      className={`w-full px-3 py-2 text-xs rounded-xl bg-white dark:bg-slate-900 border ${
                        fieldErrors.physicalPincode ? 'border-rose-500' : 'border-slate-300 dark:border-slate-700'
                      } focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-white font-mono`}
                    />
                    {fieldErrors.physicalPincode && (
                      <p className="text-[11px] text-rose-500 mt-1 font-medium">{fieldErrors.physicalPincode}</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* STEP 3: BANK DETAILS */}
          {/* ============================================================== */}
          {currentStep === 3 && (
            <div className="space-y-4 animate-fadeIn">
              <div className="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-slate-800">
                <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                  <Landmark className="w-4 h-4 text-blue-600" />
                  <span>Step 3: Bank Details</span>
                </h4>
                <span className="text-[11px] text-slate-500">Step 3 of 4</span>
              </div>

              <div className="p-3 bg-blue-50/60 dark:bg-blue-950/40 rounded-xl border border-blue-200 dark:border-blue-900/60 text-xs text-blue-800 dark:text-blue-300 flex items-start gap-2.5">
                <ShieldCheck className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold">Bank Verification & Encrypted Storage:</span>
                  <p className="text-[11px] text-blue-700/80 dark:text-blue-300/80 mt-0.5">
                    Agent bank details are used for commission settlements and payouts. Numbers are masked in logs and views. All 3 fields are mandatory.
                  </p>
                </div>
              </div>

              {/* Bank Name */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Bank Name <span className="text-rose-500 font-bold">*</span>
                </label>
                <div className="relative">
                  <Landmark className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    name="bankName"
                    value={formData.bankName}
                    onChange={handleInputChange}
                    placeholder="e.g. State Bank of India, HDFC Bank, ICICI Bank"
                    className={`w-full pl-9 pr-3 py-2 text-xs rounded-xl bg-white dark:bg-slate-900 border ${
                      fieldErrors.bankName ? 'border-rose-500' : 'border-slate-300 dark:border-slate-700'
                    } focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-white`}
                  />
                </div>
                {fieldErrors.bankName && (
                  <p className="text-[11px] text-rose-500 mt-1 font-medium">{fieldErrors.bankName}</p>
                )}
              </div>

              {/* Account Number & Confirm Account Number */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Account Number <span className="text-rose-500 font-bold">*</span>
                    <span className="text-[10px] text-slate-400 font-normal ml-1">(9–18 digits)</span>
                  </label>
                  <div className="relative">
                    <CreditCard className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                    <input
                      type="text"
                      name="accountNumber"
                      value={formData.accountNumber}
                      onChange={handleInputChange}
                      placeholder="Enter account number"
                      maxLength={18}
                      className={`w-full pl-9 pr-3 py-2 text-xs rounded-xl bg-white dark:bg-slate-900 border ${
                        fieldErrors.accountNumber ? 'border-rose-500' : 'border-slate-300 dark:border-slate-700'
                      } focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-white font-mono`}
                    />
                  </div>
                  {fieldErrors.accountNumber ? (
                    <p className="text-[11px] text-rose-500 mt-1 font-medium">{fieldErrors.accountNumber}</p>
                  ) : formData.accountNumber ? (
                    <p className="text-[10px] text-emerald-600 font-mono mt-1">Masked Preview: {maskBankAccount(formData.accountNumber)}</p>
                  ) : null}
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Confirm Account Number <span className="text-rose-500 font-bold">*</span>
                  </label>
                  <div className="relative">
                    <CreditCard className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                    <input
                      type="text"
                      name="confirmAccountNumber"
                      value={formData.confirmAccountNumber}
                      onChange={handleInputChange}
                      placeholder="Re-enter account number"
                      maxLength={18}
                      className={`w-full pl-9 pr-3 py-2 text-xs rounded-xl bg-white dark:bg-slate-900 border ${
                        fieldErrors.confirmAccountNumber ? 'border-rose-500' : 'border-slate-300 dark:border-slate-700'
                      } focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-white font-mono`}
                    />
                  </div>
                  {fieldErrors.confirmAccountNumber && (
                    <p className="text-[11px] text-rose-500 mt-1 font-medium">{fieldErrors.confirmAccountNumber}</p>
                  )}
                </div>
              </div>

              {/* IFSC Code */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  IFSC Code <span className="text-rose-500 font-bold">*</span>
                  <span className="text-[10px] text-slate-400 font-normal ml-1">(11 characters, 5th character must be '0', e.g. SBIN0001234)</span>
                </label>
                <div className="relative">
                  <Building2 className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    name="ifscCode"
                    value={formData.ifscCode}
                    onChange={handleInputChange}
                    placeholder="e.g. SBIN0001234"
                    maxLength={11}
                    className={`w-full pl-9 pr-3 py-2 text-xs rounded-xl bg-white dark:bg-slate-900 border ${
                      fieldErrors.ifscCode ? 'border-rose-500' : 'border-slate-300 dark:border-slate-700'
                    } focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-white font-mono uppercase`}
                  />
                </div>
                {fieldErrors.ifscCode && (
                  <p className="text-[11px] text-rose-500 mt-1 font-medium">{fieldErrors.ifscCode}</p>
                )}
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* STEP 4: DOCUMENTS UPLOAD & DECLARATIONS */}
          {/* ============================================================== */}
          {currentStep === 4 && (
            <div className="space-y-4 animate-fadeIn">
              <div className="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-slate-800">
                <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                  <FileCheck className="w-4 h-4 text-blue-600" />
                  <span>Step 4: Documents Upload & Legal Declarations</span>
                </h4>
                <span className="text-[11px] text-slate-500">Step 4 of 4</span>
              </div>

              {/* Mandatory Documents Upload Grid */}
              <div className="space-y-3">
                <h5 className="text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider flex items-center gap-1">
                  <span>A. Mandatory KYC Documents</span>
                  <span className="text-rose-500 font-bold">*</span>
                </h5>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Aadhaar Front */}
                  <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700 space-y-1.5">
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                      Aadhaar Card (Front) <span className="text-rose-500 font-bold">*</span>
                    </label>
                    <label className="cursor-pointer block w-full py-2 px-3 rounded-lg border border-dashed border-slate-300 dark:border-slate-600 text-center text-xs text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-900 transition">
                      <div className="flex items-center justify-center gap-2">
                        <Upload className="w-3.5 h-3.5 text-blue-500" />
                        <span className="truncate">{formData.aadhaarCardFrontName || 'Upload Front (JPG/PNG/PDF)'}</span>
                      </div>
                      <input
                        type="file"
                        accept="image/*,application/pdf"
                        onChange={(e) => handleFileUpload('aadhaarCardFront', 'aadhaarCardFrontName', e)}
                        className="hidden"
                      />
                    </label>
                    {fieldErrors.aadhaarCardFront && (
                      <p className="text-[11px] text-rose-500 font-medium">{fieldErrors.aadhaarCardFront}</p>
                    )}
                  </div>

                  {/* Aadhaar Back */}
                  <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700 space-y-1.5">
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                      Aadhaar Card (Back) <span className="text-rose-500 font-bold">*</span>
                    </label>
                    <label className="cursor-pointer block w-full py-2 px-3 rounded-lg border border-dashed border-slate-300 dark:border-slate-600 text-center text-xs text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-900 transition">
                      <div className="flex items-center justify-center gap-2">
                        <Upload className="w-3.5 h-3.5 text-blue-500" />
                        <span className="truncate">{formData.aadhaarCardBackName || 'Upload Back (JPG/PNG/PDF)'}</span>
                      </div>
                      <input
                        type="file"
                        accept="image/*,application/pdf"
                        onChange={(e) => handleFileUpload('aadhaarCardBack', 'aadhaarCardBackName', e)}
                        className="hidden"
                      />
                    </label>
                    {fieldErrors.aadhaarCardBack && (
                      <p className="text-[11px] text-rose-500 font-medium">{fieldErrors.aadhaarCardBack}</p>
                    )}
                  </div>

                  {/* PAN Card */}
                  <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700 space-y-1.5">
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                      PAN Card <span className="text-rose-500 font-bold">*</span>
                    </label>
                    <label className="cursor-pointer block w-full py-2 px-3 rounded-lg border border-dashed border-slate-300 dark:border-slate-600 text-center text-xs text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-900 transition">
                      <div className="flex items-center justify-center gap-2">
                        <Upload className="w-3.5 h-3.5 text-blue-500" />
                        <span className="truncate">{formData.panCardName || 'Upload PAN (JPG/PNG/PDF)'}</span>
                      </div>
                      <input
                        type="file"
                        accept="image/*,application/pdf"
                        onChange={(e) => handleFileUpload('panCard', 'panCardName', e)}
                        className="hidden"
                      />
                    </label>
                    {fieldErrors.panCard && (
                      <p className="text-[11px] text-rose-500 font-medium">{fieldErrors.panCard}</p>
                    )}
                  </div>

                  {/* Digital Signature */}
                  <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700 space-y-1.5">
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                      Digital Signature <span className="text-rose-500 font-bold">*</span>
                    </label>
                    <label className="cursor-pointer block w-full py-2 px-3 rounded-lg border border-dashed border-slate-300 dark:border-slate-600 text-center text-xs text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-900 transition">
                      <div className="flex items-center justify-center gap-2">
                        <Upload className="w-3.5 h-3.5 text-blue-500" />
                        <span className="truncate">{formData.digitalSignatureName || 'Upload Signature (JPG/PNG)'}</span>
                      </div>
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/jpg"
                        onChange={(e) => handleFileUpload('digitalSignature', 'digitalSignatureName', e)}
                        className="hidden"
                      />
                    </label>
                    {fieldErrors.digitalSignature && (
                      <p className="text-[11px] text-rose-500 font-medium">{fieldErrors.digitalSignature}</p>
                    )}
                  </div>
                </div>

                {/* Passport Photo with Profile Photo Reuse */}
                <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700 space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                      Passport Size Photo <span className="text-rose-500 font-bold">*</span>
                    </label>
                    {formData.profilePhoto && (
                      <label className="flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400 font-medium cursor-pointer">
                        <input
                          type="checkbox"
                          checked={formData.reuseProfilePhoto}
                          onChange={handleReuseProfilePhotoToggle}
                          className="rounded text-blue-600 focus:ring-blue-500 w-3.5 h-3.5"
                        />
                        <span>Reuse Profile Photo from Step 2</span>
                      </label>
                    )}
                  </div>

                  {!formData.reuseProfilePhoto ? (
                    <label className="cursor-pointer block w-full py-2 px-3 rounded-lg border border-dashed border-slate-300 dark:border-slate-600 text-center text-xs text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-900 transition">
                      <div className="flex items-center justify-center gap-2">
                        <Camera className="w-3.5 h-3.5 text-blue-500" />
                        <span className="truncate">{formData.passportPhotoName || 'Upload Passport Photo (JPG/PNG)'}</span>
                      </div>
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/jpg"
                        onChange={(e) => handleFileUpload('passportPhoto', 'passportPhotoName', e)}
                        className="hidden"
                      />
                    </label>
                  ) : (
                    <div className="flex items-center gap-2 p-2 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-lg text-xs text-emerald-700 dark:text-emerald-300 font-medium">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span>Reusing validated Step 2 profile photo as passport photo.</span>
                    </div>
                  )}

                  {fieldErrors.passportPhoto && (
                    <p className="text-[11px] text-rose-500 font-medium">{fieldErrors.passportPhoto}</p>
                  )}
                </div>

                {/* Optional Supporting Documents */}
                <div className="pt-2">
                  <h5 className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">
                    B. Optional Documents (No asterisk)
                  </h5>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="p-3 bg-slate-50 dark:bg-slate-800/30 rounded-xl border border-slate-200 dark:border-slate-700/60 space-y-1">
                      <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                        Educational Certificate <span className="text-[10px] text-slate-400 font-normal">(Optional)</span>
                      </label>
                      <label className="cursor-pointer block w-full py-1.5 px-3 rounded-lg border border-dashed border-slate-300 dark:border-slate-600 text-center text-xs text-slate-500 hover:bg-white dark:hover:bg-slate-900 transition">
                        <span className="truncate">{formData.educationalCertificateName || 'Choose file (Optional)'}</span>
                        <input
                          type="file"
                          accept="image/*,application/pdf"
                          onChange={(e) => handleFileUpload('educationalCertificate', 'educationalCertificateName', e)}
                          className="hidden"
                        />
                      </label>
                    </div>

                    <div className="p-3 bg-slate-50 dark:bg-slate-800/30 rounded-xl border border-slate-200 dark:border-slate-700/60 space-y-1">
                      <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                        Bank Proof / Cancelled Cheque <span className="text-[10px] text-slate-400 font-normal">(Optional)</span>
                      </label>
                      <label className="cursor-pointer block w-full py-1.5 px-3 rounded-lg border border-dashed border-slate-300 dark:border-slate-600 text-center text-xs text-slate-500 hover:bg-white dark:hover:bg-slate-900 transition">
                        <span className="truncate">{formData.bankProofName || 'Choose file (Optional)'}</span>
                        <input
                          type="file"
                          accept="image/*,application/pdf"
                          onChange={(e) => handleFileUpload('bankProof', 'bankProofName', e)}
                          className="hidden"
                        />
                      </label>
                    </div>
                  </div>
                </div>
              </div>

              {/* Sub-Section C: Legal Declarations (All 3 Mandatory) */}
              <div className="p-3.5 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700 space-y-3">
                <div className="flex items-center gap-1.5">
                  <Shield className="w-4 h-4 text-blue-600" />
                  <h5 className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
                    C. Legal Declarations <span className="text-rose-500 font-bold">*</span>
                  </h5>
                </div>

                <div className="space-y-2.5 text-xs text-slate-700 dark:text-slate-300">
                  {/* Declaration 1 */}
                  <label className="flex items-start gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      name="declarationTruthfulness"
                      checked={formData.declarationTruthfulness}
                      onChange={handleInputChange}
                      className="mt-0.5 rounded text-blue-600 focus:ring-blue-500 w-4 h-4 shrink-0"
                    />
                    <span>
                      <strong>1. Information Truthfulness:</strong> “I confirm that all submitted information is correct and true.” <span className="text-rose-500 font-bold">*</span>
                    </span>
                  </label>
                  {fieldErrors.declarationTruthfulness && (
                    <p className="text-[11px] text-rose-500 font-medium pl-6">{fieldErrors.declarationTruthfulness}</p>
                  )}

                  {/* Declaration 2 */}
                  <label className="flex items-start gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      name="declarationTerms"
                      checked={formData.declarationTerms}
                      onChange={handleInputChange}
                      className="mt-0.5 rounded text-blue-600 focus:ring-blue-500 w-4 h-4 shrink-0"
                    />
                    <span>
                      <strong>2. Terms & Privacy Acceptance:</strong> “I agree to the Terms & Conditions and Privacy Policy of Forge India Connect Platform.” <span className="text-rose-500 font-bold">*</span>
                    </span>
                  </label>
                  {fieldErrors.declarationTerms && (
                    <p className="text-[11px] text-rose-500 font-medium pl-6">{fieldErrors.declarationTerms}</p>
                  )}

                  {/* Declaration 3 */}
                  <label className="flex items-start gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      name="declarationAdminVerification"
                      checked={formData.declarationAdminVerification}
                      onChange={handleInputChange}
                      className="mt-0.5 rounded text-blue-600 focus:ring-blue-500 w-4 h-4 shrink-0"
                    />
                    <span>
                      <strong>3. Approval Acknowledgment:</strong> “I understand that agent onboarding is subject to verification and approval by Connect Administration.” <span className="text-rose-500 font-bold">*</span>
                    </span>
                  </label>
                  {fieldErrors.declarationAdminVerification && (
                    <p className="text-[11px] text-rose-500 font-medium pl-6">{fieldErrors.declarationAdminVerification}</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* NAVIGATION FOOTER */}
          {/* ============================================================== */}
          <div className="flex items-center justify-between pt-3 border-t border-slate-200 dark:border-slate-800">
            {currentStep > 1 ? (
              <button
                type="button"
                onClick={handlePrevStep}
                disabled={submitting}
                className="px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition cursor-pointer flex items-center gap-1.5 disabled:opacity-60"
              >
                <ChevronLeft className="w-4 h-4" />
                <span>Back</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition cursor-pointer"
              >
                Cancel
              </button>
            )}

            <div className="flex items-center gap-2">
              {currentStep < 4 ? (
                <button
                  type="button"
                  onClick={handleNextStep}
                  disabled={submitting}
                  className="px-5 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl shadow-xs transition flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
                >
                  <span>Continue</span>
                  <ChevronRight className="w-4 h-4" />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={submitting || !formData.declarationTruthfulness || !formData.declarationTerms || !formData.declarationAdminVerification}
                  className="px-5 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl shadow-xs transition flex items-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Onboarding Agent...</span>
                    </>
                  ) : (
                    <>
                      <UserPlus className="w-4 h-4" />
                      <span>Submit & Stage for Review</span>
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </form>
      </div>
    </Modal>
  );
}
