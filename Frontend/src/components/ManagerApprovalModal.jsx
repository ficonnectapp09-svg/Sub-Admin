import React, { useState, useEffect } from 'react';
import { Modal } from './Modal';
import { StatusBadge } from './Badge';
import { dataService } from '../services/dataService';
import { API_BASE_URL } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { canAdminApproveManagerRequest } from '../utils/permissions';
import {
  UserCog,
  ShieldCheck,
  Building2,
  Layers,
  MapPin,
  Award,
  Phone,
  Mail,
  Calendar,
  FileText,
  CheckCircle2,
  XCircle,
  AlertCircle,
  ExternalLink,
  Eye,
  EyeOff,
  Check,
  X,
  CreditCard,
  UserCheck,
  Maximize2,
  Download,
  Clock,
  Landmark
} from 'lucide-react';

export function ManagerApprovalModal({ isOpen, onClose, manager, onManagerUpdated }) {
  const { user } = useAuth();
  const [currentMgr, setCurrentMgr] = useState(manager);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [showRejectBox, setShowRejectBox] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [showPendingBox, setShowPendingBox] = useState(false);
  const [pendingReason, setPendingReason] = useState('');
  const [previewMedia, setPreviewMedia] = useState(null); // { url, title, isPdf }
  const [avatarLoadFailed, setAvatarLoadFailed] = useState(false);

  // Sensitive data masking toggle states
  const [showFullAadhaar, setShowFullAadhaar] = useState(false);
  const [showFullPan, setShowFullPan] = useState(false);

  useEffect(() => {
    setCurrentMgr(manager);
    setShowRejectBox(false);
    setShowPendingBox(false);
    setRejectReason('');
    setPendingReason('');
    setError('');
    setSuccessMsg('');
  }, [manager]);

  if (!isOpen || !currentMgr) return null;

  const activeMgr = currentMgr;
  const s = String(activeMgr.status || '').toLowerCase();
  const isPendingAdmin = s === 'under_review' || s === 'pending' || s === 'pending_admin_approval' || s === 'pending_sub_admin_approval';
  const isPendingKyc = s === 'pending_kyc' || s === 'pending_kyc_approval';
  const isPending = isPendingAdmin || isPendingKyc;
  const isActive = s === 'active';
  const isRejected = s === 'rejected' || s === 'rejected_by_sub_admin' || s === 'kyc_rejected';
  const canApprove = canAdminApproveManagerRequest(user, activeMgr);

  // Resolve relative uploads against the configured backend URL
  const resolveMediaUrl = (url) => {
    if (!url) return '';
    if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:') || url.startsWith('blob:')) return url;
    const normalized = url.startsWith('/') ? url : `/${url}`;
    return API_BASE_URL ? `${API_BASE_URL}${normalized}` : normalized;
  };

  const handleApprove = async () => {
    if (!canApprove) {
      setError('You do not have administrative authority to approve requests for this territory level.');
      return;
    }
    setLoading(true);
    setError('');
    setSuccessMsg('');
    try {
      const res = await dataService.approveManager(activeMgr.id || activeMgr._id);
      if (res.success) {
        setSuccessMsg(res.message || 'Registration accepted & approved! Manager queued for KYC review.');
        const updated = res.manager || { ...activeMgr, status: 'PENDING_KYC_APPROVAL', adminApprovalStatus: 'approved', canApprove: false, workflowStage: 'Awaiting KYC Review' };
        setCurrentMgr(updated);
        if (onManagerUpdated) onManagerUpdated(updated);
        setTimeout(() => {
          onClose();
        }, 1500);
      } else {
        setError(res.message || 'Failed to approve manager.');
      }
    } catch (err) {
      setError(err.message || 'Error occurred while approving manager.');
    } finally {
      setLoading(false);
    }
  };

  const handleReject = async () => {
    if (!canApprove) {
      setError('You do not have administrative authority to reject requests for this territory level.');
      return;
    }
    if (!rejectReason.trim()) {
      setError('Please provide a reason for rejecting the manager registration.');
      return;
    }
    setLoading(true);
    setError('');
    setSuccessMsg('');
    try {
      const res = await dataService.rejectManager(activeMgr.id || activeMgr._id, { reason: rejectReason.trim() });
      if (res.success) {
        setSuccessMsg(res.message || 'Manager application rejected.');
        setCurrentMgr(res.manager || { ...activeMgr, status: 'rejected', rejectionReason: rejectReason.trim() });
        if (onManagerUpdated) onManagerUpdated(res.manager || { ...activeMgr, status: 'rejected' });
        setTimeout(() => {
          onClose();
        }, 1500);
      } else {
        setError(res.message || 'Failed to reject manager.');
      }
    } catch (err) {
      setError(err.message || 'Error occurred while rejecting manager.');
    } finally {
      setLoading(false);
    }
  };

  const handleKeepPending = async () => {
    if (!canApprove) {
      setError('You do not have administrative authority to manage requests for this territory level.');
      return;
    }
    if (!pendingReason.trim()) {
      setError('Please provide a reason or note explaining why this manager is kept pending.');
      return;
    }
    setLoading(true);
    setError('');
    setSuccessMsg('');
    try {
      const res = await dataService.keepPendingManager(activeMgr.id || activeMgr._id, { reason: pendingReason.trim() });
      if (res.success) {
        setSuccessMsg(res.message || 'Manager registration kept pending. Note saved.');
        const updated = res.manager || { ...activeMgr, status: 'pending', adminApprovalStatus: 'pending', pendingReason: pendingReason.trim() };
        setCurrentMgr(updated);
        if (onManagerUpdated) onManagerUpdated(updated);
        setTimeout(() => {
          onClose();
        }, 1500);
      } else {
        setError(res.message || 'Failed to update manager pending status.');
      }
    } catch (err) {
      setError(err.message || 'Error occurred while updating pending status.');
    } finally {
      setLoading(false);
    }
  };

  // Merge document references
  const rawDocs = activeMgr.documents || {};
  const kycDocs = activeMgr.kycDocs || {};
  const kyc = activeMgr.kyc || rawDocs.kyc || {};

  const getDocVal = (v) => {
    if (!v) return null;
    if (typeof v === 'string') return v;
    if (typeof v === 'object' && v.url) return v.url;
    return null;
  };

  const aadhaarNumber = activeMgr.aadhaarNumber || kyc.aadhaarNumber || activeMgr.aadharNumber || rawDocs.aadharNumber || null;
  const panNumber = activeMgr.panNumber || kyc.panNumber || rawDocs.panNumber || null;

  const aadhaarDocUrl = rawDocs.aadharUrl || rawDocs.aadhaarUrl || rawDocs.aadhaar || rawDocs.aadhar ||
    getDocVal(kycDocs.aadhaarFront) || getDocVal(kycDocs.aadhaar) || activeMgr.aadharUrl || activeMgr.aadhaarUrl || activeMgr.aadharPhoto || activeMgr.aadhaarPhoto || null;
  const aadhaarFileName = rawDocs.aadharFileName || rawDocs.aadhaarFileName || (kycDocs.aadhaarFront?.name) || (aadhaarDocUrl ? 'Aadhaar_Card' : null);

  const panDocUrl = rawDocs.panUrl || rawDocs.pan || getDocVal(kycDocs.panCard) || getDocVal(kycDocs.pan) || activeMgr.panUrl || activeMgr.panPhoto || null;
  const panFileName = rawDocs.panFileName || (kycDocs.panCard?.name) || (panDocUrl ? 'PAN_Card' : null);

  const bankDocUrl = rawDocs.bankPassbookUrl || rawDocs.bankUrl || rawDocs.bankPassbook || rawDocs.passbookUrl ||
    getDocVal(kycDocs.bankPassbook) || getDocVal(kycDocs.passbook) || activeMgr.bankPassbookPhoto || activeMgr.bankPassbookUrl || activeMgr.bankPhoto || activeMgr.bankUrl || null;
  const bankFileName = rawDocs.bankPassbookFileName || rawDocs.bankFileName || (kycDocs.bankPassbook?.name) || (bankDocUrl ? 'Bank_Passbook' : null);

  const cancelledChequeUrl = rawDocs.cancelledChequeUrl || rawDocs.chequeUrl || rawDocs.cancelledCheque ||
    getDocVal(kycDocs.cancelledCheque) || getDocVal(kycDocs.cheque) || activeMgr.cancelledChequePhoto || activeMgr.cancelledChequeUrl || null;
  const cancelledChequeFileName = rawDocs.cancelledChequeFileName || (kycDocs.cancelledCheque?.name) || (cancelledChequeUrl ? 'Cancelled_Cheque' : null);

  const signatureDocUrl = rawDocs.signatureUrl || rawDocs.signature ||
    getDocVal(kycDocs.signature) || getDocVal(kycDocs.authorizedSignature) || activeMgr.signaturePhoto || activeMgr.signatureUrl || null;
  const signatureFileName = rawDocs.signatureFileName || (kycDocs.signature?.name) || (signatureDocUrl ? 'Digital_Signature' : null);

  // Bank Account Info
  const bankInfo = activeMgr.bankDetails || {};
  const bankAccountHolder = bankInfo.accountHolderName || activeMgr.accountHolderName || activeMgr.name || 'Not provided';
  const bankAccountName = bankInfo.bankName || activeMgr.bankName || 'Not provided';
  const bankAccountNumber = bankInfo.accountNumber || activeMgr.accountNumber || 'Not provided';
  const bankIfscCode = bankInfo.ifscCode || activeMgr.ifscCode || 'Not provided';
  const bankBranchName = bankInfo.branchName || activeMgr.branchName || 'Not provided';

  // Masking helpers
  const maskAadhaar = (num) => {
    if (!num) return 'Not Provided';
    const clean = String(num).replace(/\s+/g, '');
    if (clean.length < 4) return clean;
    return `XXXX XXXX ${clean.slice(-4)}`;
  };

  const maskPan = (num) => {
    if (!num) return 'Not Provided';
    const clean = String(num).trim().toUpperCase();
    if (clean.length < 4) return clean;
    return `XXXXXX${clean.slice(-4)}`;
  };

  const avatarSrc = activeMgr.avatarUrl || activeMgr.avatar;
  const resolvedAvatar = avatarSrc ? resolveMediaUrl(avatarSrc) : null;

  // Render a reusable official document card
  const renderDocCard = ({ title, docUrl, fileName }) => {
    const mediaUrl = docUrl ? resolveMediaUrl(docUrl) : null;
    const isPdf = mediaUrl ? mediaUrl.toLowerCase().endsWith('.pdf') : false;

    return (
      <div className="flex flex-col p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-700/60 space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs min-w-0">
            <FileText className="w-4 h-4 text-slate-400 shrink-0" />
            <span className="font-bold text-slate-800 dark:text-slate-200 truncate">{title}</span>
          </div>
          {mediaUrl ? (
            <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 px-2 py-0.5 rounded-full flex items-center gap-1 shrink-0 whitespace-nowrap">
              <CheckCircle2 className="w-3 h-3" /> Uploaded
            </span>
          ) : (
            <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 px-2 py-0.5 rounded-full flex items-center gap-1 shrink-0 whitespace-nowrap">
              <AlertCircle className="w-3 h-3" /> Not Uploaded
            </span>
          )}
        </div>

        {mediaUrl ? (
          <div className="flex items-center justify-between pt-1 gap-2.5">
            {/* Thumbnail or PDF badge */}
            {!isPdf ? (
              <div
                onClick={() => setPreviewMedia({ url: mediaUrl, title, isPdf: false })}
                className="relative w-16 h-12 rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 shrink-0 cursor-pointer group bg-black/5"
              >
                <img
                  src={mediaUrl}
                  alt={title}
                  className="w-full h-full object-cover group-hover:scale-110 transition"
                />
                <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition flex items-center justify-center text-white">
                  <Eye className="w-3.5 h-3.5" />
                </div>
              </div>
            ) : (
              <div
                onClick={() => setPreviewMedia({ url: mediaUrl, title, isPdf: true })}
                className="w-16 h-12 rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800/60 flex flex-col items-center justify-center text-red-600 dark:text-red-400 text-[10px] font-bold shrink-0 cursor-pointer hover:bg-red-100 dark:hover:bg-red-900/50 transition"
              >
                <span>PDF</span>
              </div>
            )}

            <div className="flex-1 min-w-0">
              <p className="text-[11px] text-slate-700 dark:text-slate-300 truncate font-mono font-medium" title={fileName}>
                {fileName || `${title.replace(/\s+/g, '_')}`}
              </p>
              <div className="flex items-center gap-2 mt-1">
                <button
                  type="button"
                  onClick={() => setPreviewMedia({ url: mediaUrl, title, isPdf })}
                  className="text-[11px] font-bold text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 flex items-center gap-1 cursor-pointer"
                >
                  <Eye className="w-3 h-3" /> View
                </button>
                <span className="text-slate-300 dark:text-slate-700">|</span>
                <a
                  href={mediaUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] font-medium text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 flex items-center gap-1"
                >
                  <ExternalLink className="w-3 h-3" /> New Tab
                </a>
              </div>
            </div>
          </div>
        ) : (
          <div className="py-1">
            <span className="text-[11px] text-slate-400 dark:text-slate-500 italic">
              No document file attached
            </span>
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title="Manager Details & Official Documents"
        maxWidth="max-w-4xl"
      >
        <div className="p-6 space-y-6">
          {/* Status Alerts */}
          {error && (
            <div className="p-3.5 rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800/60 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
              <div className="text-xs text-red-700 dark:text-red-300 font-medium">{error}</div>
            </div>
          )}

          {successMsg && (
            <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800/60 flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
              <div className="text-xs text-emerald-700 dark:text-emerald-300 font-medium">{successMsg}</div>
            </div>
          )}

          {/* ========================================================= */}
          {/* SECTION A: PERSONAL / MANAGER DETAILS                     */}
          {/* ========================================================= */}
          <div className="space-y-4">
            {/* Manager Header Info with Profile Photo */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/60">
              <div className="flex items-center gap-4">
                {resolvedAvatar && !avatarLoadFailed ? (
                  <div className="relative group cursor-pointer" onClick={() => setPreviewMedia({ url: resolvedAvatar, title: `${activeMgr.name} - Profile Photo`, isPdf: false })}>
                    <img
                      src={resolvedAvatar}
                      alt={activeMgr.name}
                      onError={() => setAvatarLoadFailed(true)}
                      className="w-14 h-14 rounded-2xl object-cover border-2 border-blue-500/40 dark:border-blue-400/50 shrink-0 shadow-md transition group-hover:scale-105"
                    />
                    <div className="absolute inset-0 bg-black/40 rounded-2xl opacity-0 group-hover:opacity-100 transition flex items-center justify-center text-white">
                      <Maximize2 className="w-4 h-4" />
                    </div>
                  </div>
                ) : (
                  <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-white flex items-center justify-center font-bold text-xl shadow-md shrink-0">
                    {activeMgr.name ? activeMgr.name.charAt(0).toUpperCase() : 'M'}
                  </div>
                )}
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="font-bold text-slate-900 dark:text-white text-base">{activeMgr.name}</h4>
                    <StatusBadge status={activeMgr.status || 'Active'} />
                  </div>
                  <p className="text-xs font-semibold text-blue-600 dark:text-blue-400 mt-0.5">
                    {activeMgr.roleTitle || activeMgr.role?.replace(/_/g, ' ')}
                  </p>
                  <p className="text-[11px] text-slate-500 font-mono mt-0.5">
                    Applied on: {activeMgr.joinedDate || 'Recently Registered'}
                  </p>
                </div>
              </div>

              <div className="text-left sm:text-right sm:border-l sm:border-slate-200 sm:dark:border-slate-700 sm:pl-4">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Jurisdiction Tier</span>
                <div className="text-xs font-bold text-slate-800 dark:text-slate-200 mt-0.5">
                  Level {activeMgr.level || 1} Operations
                </div>
                <div className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 mt-0.5">
                  {activeMgr.jurisdiction}
                </div>
              </div>
            </div>

            {/* Operational Territory & Contact Info */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-700/60 bg-white dark:bg-slate-900/60 space-y-2">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-300 border-b border-slate-100 dark:border-slate-800 pb-2">
                  <MapPin className="w-4 h-4 text-amber-500" />
                  <span>Assigned Administrative Territory</span>
                </div>
                <div className="space-y-1.5 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-500">State:</span>
                    <span className="font-semibold text-slate-800 dark:text-slate-200">{activeMgr.stateName || 'Tamil Nadu'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">District:</span>
                    <span className="font-semibold text-slate-800 dark:text-slate-200">{activeMgr.districtName || 'N/A'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Division:</span>
                    <span className="font-semibold text-slate-800 dark:text-slate-200">{activeMgr.divisionName || 'N/A'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Postal PIN:</span>
                    <span className="font-semibold font-mono text-emerald-600 dark:text-emerald-400">
                      {activeMgr.pincodeCode || (activeMgr.pincodeId ? activeMgr.pincodeId.replace('pin_', '') : 'N/A')}
                    </span>
                  </div>
                  {activeMgr.targetAdminRole && (
                    <div className="flex justify-between pt-1 border-t border-slate-100 dark:border-slate-800">
                      <span className="text-slate-500">Designated Authority:</span>
                      <span className="font-semibold text-blue-600 dark:text-blue-400">
                        {activeMgr.targetAdminRole}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-700/60 bg-white dark:bg-slate-900/60 space-y-2">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-300 border-b border-slate-100 dark:border-slate-800 pb-2">
                  <Phone className="w-4 h-4 text-blue-500" />
                  <span>Contact & Personal Credentials</span>
                </div>
                <div className="space-y-1.5 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Email:</span>
                    <span className="font-semibold font-mono text-slate-800 dark:text-slate-200 truncate max-w-[170px]" title={activeMgr.email}>
                      {activeMgr.email}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Mobile:</span>
                    <span className="font-semibold font-mono text-slate-800 dark:text-slate-200">{activeMgr.mobile || activeMgr.phone}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Gender / DOB:</span>
                    <span className="font-semibold text-slate-800 dark:text-slate-200">
                      {activeMgr.gender || 'Not specified'} {activeMgr.dob ? `(${activeMgr.dob})` : ''}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-slate-500 shrink-0">Address:</span>
                    <div className="text-right">
                      {(() => {
                        const addr = activeMgr.address || activeMgr.fullAddress || '';
                        const door = activeMgr.doorNumber || activeMgr.houseNumber || activeMgr.doorStreet || activeMgr.doorNo || '';
                        const street = activeMgr.street || activeMgr.streetName || activeMgr.streetAddress || '';
                        const area = activeMgr.area || activeMgr.locality || activeMgr.localityArea || '';
                        const village = activeMgr.village || activeMgr.villageName || activeMgr.town || activeMgr.city || activeMgr.townCity || '';
                        const taluk = activeMgr.taluk || activeMgr.talukName || activeMgr.mandal || '';
                        const dist = activeMgr.district || activeMgr.districtName || activeMgr.districtAddr || '';
                        const state = activeMgr.state || activeMgr.stateName || activeMgr.stateAddr || '';
                        const pin = activeMgr.pincode || activeMgr.addrPincode || activeMgr.assignedPincode || activeMgr.pincodeCode || '';

                        const hasSubFields = door || street || area || village || taluk || dist || state || pin;
                        if (!hasSubFields) {
                          return (
                            <span className={`font-semibold text-slate-800 dark:text-slate-200 text-right ${!addr ? 'italic text-slate-400' : ''}`}>
                              {addr || 'Not provided'}
                            </span>
                          );
                        }

                        const lines = [
                          door && `Door No: ${door}`,
                          street && street,
                          area && area,
                          village && village,
                          taluk && `Taluk: ${taluk}`,
                          dist && dist,
                          state && state,
                          pin && `PIN: ${pin}`,
                        ].filter(Boolean);

                        return (
                          <div className="font-semibold text-slate-800 dark:text-slate-200 text-right leading-relaxed">
                            {lines.map((line, i) => <div key={i}>{line}</div>)}
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Bank Account Details */}
            <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-700/60 bg-white dark:bg-slate-900/60 space-y-2">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-300 border-b border-slate-100 dark:border-slate-800 pb-2">
                <Landmark className="w-4 h-4 text-emerald-500" />
                <span>Bank Account Details</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div>
                  <span className="text-slate-500 block text-[11px]">Account Holder:</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">{bankAccountHolder}</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[11px]">Bank Name:</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">{bankAccountName}</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[11px]">Account Number:</span>
                  <span className="font-semibold font-mono text-slate-800 dark:text-slate-200">{bankAccountNumber}</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[11px]">IFSC Code:</span>
                  <span className="font-semibold font-mono text-slate-800 dark:text-slate-200">{bankIfscCode}</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[11px]">Branch:</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">{bankBranchName}</span>
                </div>
              </div>
            </div>
          </div>

          {/* ========================================================= */}
          {/* SECTION B: IDENTITY DETAILS (Aadhaar & PAN)               */}
          {/* ========================================================= */}
          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-700/60 bg-white dark:bg-slate-900/60 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2.5">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-800 dark:text-slate-200">
                <ShieldCheck className="w-4 h-4 text-blue-500" />
                <span>Identity Details (Aadhaar & PAN)</span>
              </div>
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-200 dark:border-blue-800/60">
                Government Proofs
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              {/* Aadhaar Card */}
              <div className="flex flex-col p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-700/60 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-800 dark:text-slate-200">Aadhaar Card Number</span>
                  {aadhaarNumber && (
                    <button
                      type="button"
                      onClick={() => setShowFullAadhaar(v => !v)}
                      className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 cursor-pointer font-medium"
                    >
                      {showFullAadhaar ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                      {showFullAadhaar ? 'Mask' : 'Reveal'}
                    </button>
                  )}
                </div>
                <div className="text-xs font-mono font-semibold text-slate-800 dark:text-slate-200 bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 rounded-lg tracking-wider">
                  {aadhaarNumber ? (showFullAadhaar ? aadhaarNumber : maskAadhaar(aadhaarNumber)) : <span className="text-slate-400 italic font-sans">Not Provided</span>}
                </div>
                {renderDocCard({
                  title: 'Aadhaar Document',
                  docUrl: aadhaarDocUrl,
                  fileName: aadhaarFileName
                })}
              </div>

              {/* PAN Card */}
              <div className="flex flex-col p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-700/60 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-800 dark:text-slate-200">PAN Card Number</span>
                  {panNumber && (
                    <button
                      type="button"
                      onClick={() => setShowFullPan(v => !v)}
                      className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 cursor-pointer font-medium"
                    >
                      {showFullPan ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                      {showFullPan ? 'Mask' : 'Reveal'}
                    </button>
                  )}
                </div>
                <div className="text-xs font-mono font-semibold text-slate-800 dark:text-slate-200 bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 rounded-lg tracking-wider">
                  {panNumber ? (showFullPan ? panNumber : maskPan(panNumber)) : <span className="text-slate-400 italic font-sans">Not Provided</span>}
                </div>
                {renderDocCard({
                  title: 'PAN Document',
                  docUrl: panDocUrl,
                  fileName: panFileName
                })}
              </div>
            </div>
          </div>

          {/* ========================================================= */}
          {/* SECTION C: BANK DETAILS / DOCUMENTS                       */}
          {/* ========================================================= */}
          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-700/60 bg-white dark:bg-slate-900/60 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2.5">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-800 dark:text-slate-200">
                <Landmark className="w-4 h-4 text-emerald-500" />
                <span>Bank Documents</span>
              </div>
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60">
                Financial Verification
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              {renderDocCard({
                title: 'Bank Passbook / Bank Account Document',
                docUrl: bankDocUrl,
                fileName: bankFileName
              })}

              {renderDocCard({
                title: 'Cancelled Cheque',
                docUrl: cancelledChequeUrl,
                fileName: cancelledChequeFileName
              })}
            </div>
          </div>

          {/* ========================================================= */}
          {/* SECTION D: DIGITAL SIGNATURE                              */}
          {/* ========================================================= */}
          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-700/60 bg-white dark:bg-slate-900/60 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2.5">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-800 dark:text-slate-200">
                <Award className="w-4 h-4 text-purple-500" />
                <span>Digital Signature</span>
              </div>
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-purple-50 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300 border border-purple-200 dark:border-purple-800/60">
                Authorization Proof
              </span>
            </div>

            <div>
              {renderDocCard({
                title: 'Digital Signature',
                docUrl: signatureDocUrl,
                fileName: signatureFileName
              })}
            </div>

            <div className="text-[11px] text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/30 p-2.5 rounded-lg flex items-center gap-2">
              <UserCheck className="w-4 h-4 text-blue-500 shrink-0" />
              <span>
                Terms of Employment & Code of Conduct: <strong>{activeMgr.declarationAccepted ? 'Formally Accepted by Candidate' : 'Acknowledged'}</strong>
              </span>
            </div>
          </div>

          {/* Approval History / Status Summary */}
          {isActive && (
            <div className="p-3.5 rounded-xl bg-emerald-50/80 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
              <div className="text-xs">
                <div className="font-bold text-emerald-800 dark:text-emerald-300">Account Active & Operational</div>
                <div className="text-emerald-700/90 dark:text-emerald-400 mt-0.5">
                  Approved by <strong>{activeMgr.adminApprovedBy || 'Administrator'}</strong>. The manager has full portal credentials and operational access to their dashboard.
                </div>
              </div>
            </div>
          )}

          {isRejected && (
            <div className="p-3.5 rounded-xl bg-red-50/80 dark:bg-red-950/40 border border-red-200 dark:border-red-800/60 flex items-start gap-3">
              <XCircle className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
              <div className="text-xs">
                <div className="font-bold text-red-800 dark:text-red-300">Registration Application Rejected</div>
                <div className="text-red-700/90 dark:text-red-400 mt-0.5">
                  Reason: {activeMgr.rejectionReason || 'Criteria not met.'}
                </div>
              </div>
            </div>
          )}

          {/* Rejection Reason Input Box */}
          {showRejectBox && (
            <div className="p-4 rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50/40 dark:bg-red-950/20 space-y-3 animate-fadeIn">
              <label className="block text-xs font-bold text-red-700 dark:text-red-300">
                Reason for Rejection (Visible to Manager on sign in attempt):
              </label>
              <textarea
                rows={3}
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="e.g. Document mismatch, incomplete KYC proofs, or jurisdictional cap exceeded."
                className="w-full text-xs p-2.5 rounded-lg border border-red-200 dark:border-red-800 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-red-500"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowRejectBox(false)}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={loading}
                  onClick={handleReject}
                  className="px-3.5 py-1.5 rounded-lg text-xs font-bold bg-red-600 hover:bg-red-700 text-white shadow-sm transition disabled:opacity-50 cursor-pointer"
                >
                  {loading ? 'Rejecting...' : 'Confirm Rejection'}
                </button>
              </div>
            </div>
          )}

          {/* Pending Reason Input Box */}
          {showPendingBox && (
            <div className="p-4 rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/40 dark:bg-amber-950/20 space-y-3 animate-fadeIn">
              <label className="block text-xs font-bold text-amber-700 dark:text-amber-300">
                Reason / Note for Keeping Request Pending (Visible to applicant):
              </label>
              <textarea
                rows={3}
                value={pendingReason}
                onChange={(e) => setPendingReason(e.target.value)}
                placeholder="e.g. Awaiting additional proofs, clarification required regarding assigned jurisdiction, or pending senior executive verification..."
                className="w-full text-xs p-2.5 rounded-lg border border-amber-200 dark:border-amber-800 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowPendingBox(false)}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={loading}
                  onClick={handleKeepPending}
                  className="px-3.5 py-1.5 rounded-lg text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white shadow-sm transition disabled:opacity-50 cursor-pointer"
                >
                  {loading ? 'Saving...' : 'Confirm Pending'}
                </button>
              </div>
            </div>
          )}

          {/* Actions Footer */}
          <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
            >
              Close
            </button>

            {isPending && !canApprove && (
              <span className="text-xs font-semibold text-slate-500 italic px-3 py-1.5 bg-slate-100 dark:bg-slate-800 rounded-xl">
                Authority designated to {activeMgr.targetAdminRole || 'Level Administrator'}
              </span>
            )}

            {!isActive && !showRejectBox && !showPendingBox && canApprove && (
              <>
                <button
                  type="button"
                  onClick={() => setShowPendingBox(true)}
                  disabled={loading}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/50 hover:bg-amber-100 dark:hover:bg-amber-900/50 border border-amber-200 dark:border-amber-800/60 transition cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
                >
                  <Clock className="w-3.5 h-3.5" />
                  Keep Pending
                </button>

                {!isRejected && (
                  <button
                    type="button"
                    onClick={() => setShowRejectBox(true)}
                    disabled={loading}
                    className="px-4 py-2 rounded-xl text-xs font-bold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/50 hover:bg-red-100 dark:hover:bg-red-900/50 border border-red-200 dark:border-red-800/60 transition cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
                  >
                    <X className="w-3.5 h-3.5" />
                    Reject
                  </button>
                )}

                <button
                  type="button"
                  onClick={handleApprove}
                  disabled={loading}
                  className="px-5 py-2 rounded-xl text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 shadow-md shadow-emerald-500/20 transition cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
                >
                  <Check className="w-4 h-4" />
                  {loading ? 'Approving & Forwarding to KYC...' : (isRejected ? 'Reconsider & Approve Manager' : 'Accept & Approve Manager')}
                </button>
              </>
            )}
          </div>
        </div>
      </Modal>

      {/* Full Resolution Document & Photo Lightbox / Previewer */}
      {previewMedia && (
        <div
          className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn"
          onClick={() => setPreviewMedia(null)}
        >
          <div
            className="relative max-w-4xl max-h-[90vh] bg-white dark:bg-slate-900 rounded-2xl overflow-hidden shadow-2xl flex flex-col border border-slate-200 dark:border-slate-800 w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50">
              <h4 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <FileText className="w-4 h-4 text-blue-500" />
                {previewMedia.title}
              </h4>
              <div className="flex items-center gap-2">
                <a
                  href={previewMedia.url}
                  download
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                  title="Open in new tab"
                >
                  <ExternalLink className="w-4 h-4" />
                </a>
                <button
                  type="button"
                  onClick={() => setPreviewMedia(null)}
                  className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="p-4 overflow-auto flex items-center justify-center max-h-[80vh] bg-slate-100 dark:bg-slate-950/30">
              {previewMedia.isPdf ? (
                <iframe
                  src={previewMedia.url}
                  title={previewMedia.title}
                  className="w-full h-[70vh] rounded-lg border border-slate-200 dark:border-slate-800"
                />
              ) : (
                <img
                  src={previewMedia.url}
                  alt={previewMedia.title}
                  className="max-h-[75vh] w-auto max-w-full object-contain rounded-xl shadow-lg"
                />
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
