import React, { useState, useEffect } from 'react';
import { Modal } from './Modal';
import { StatusBadge } from './Badge';
import { dataService } from '../services/dataService';
import { API_BASE_URL } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { formatAddress } from '../utils/territoryHelper';
import { canAdminApproveAgentRequest } from '../utils/permissions';
import {
  UserPlus,
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
  Landmark,
  User
} from 'lucide-react';

export function AgentApprovalModal({ isOpen, onClose, agent, onAgentUpdated }) {
  const { user } = useAuth();
  const [currentAgent, setCurrentAgent] = useState(agent);
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
    setCurrentAgent(agent);
    setError('');
    setSuccessMsg('');
    setShowRejectBox(false);
    setShowPendingBox(false);
    setRejectReason('');
    setPendingReason('');
  }, [agent]);

  if (!isOpen || !currentAgent) return null;

  const activeAgent = currentAgent;
  const s = String(activeAgent.status || '').toLowerCase();
  const isPending = s === 'under_review' || s === 'pending' || s === 'pending_admin_approval' || s === 'pending_sub_admin_approval';
  const isPendingKyc = s === 'pending_kyc' || s === 'pending_kyc_approval';
  const isActive = s === 'active' || s === 'approved';
  const isRejected = s === 'rejected';
  const canApprove = canAdminApproveAgentRequest(user, activeAgent);

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
      const res = await dataService.approveAgent(activeAgent.id || activeAgent._id);
      if (res.success) {
        setSuccessMsg(res.message || 'Agent registration approved! Forwarded to KYC Review queue.');
        const updated = res.agent || { ...activeAgent, status: 'PENDING_KYC_APPROVAL', adminApprovalStatus: 'approved', canApprove: false, workflowStage: 'Awaiting KYC Review' };
        setCurrentAgent(updated);
        if (onAgentUpdated) onAgentUpdated(updated);
        setTimeout(() => {
          onClose();
        }, 1500);
      } else {
        setError(res.message || 'Failed to approve agent.');
      }
    } catch (err) {
      setError(err.message || 'Error occurred while approving agent.');
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
      setError('Please provide a reason for rejecting the agent registration.');
      return;
    }
    setLoading(true);
    setError('');
    setSuccessMsg('');
    try {
      const res = await dataService.rejectAgent(activeAgent.id || activeAgent._id, { reason: rejectReason.trim() });
      if (res.success) {
        setSuccessMsg(res.message || 'Agent registration rejected.');
        const updated = res.agent || { ...activeAgent, status: 'rejected', rejectionReason: rejectReason.trim(), canApprove: false, workflowStage: 'Territory Rejected' };
        setCurrentAgent(updated);
        if (onAgentUpdated) onAgentUpdated(updated);
        setTimeout(() => {
          onClose();
        }, 1500);
      } else {
        setError(res.message || 'Failed to reject agent.');
      }
    } catch (err) {
      setError(err.message || 'Error occurred while rejecting agent.');
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
      setError('Please provide a reason or note explaining why this agent is kept pending.');
      return;
    }
    setLoading(true);
    setError('');
    setSuccessMsg('');
    try {
      const res = await dataService.keepPendingAgent(activeAgent.id || activeAgent._id, { reason: pendingReason.trim() });
      if (res.success) {
        setSuccessMsg(res.message || 'Agent registration kept pending. Note saved.');
        const updated = res.agent || { ...activeAgent, status: 'pending', adminApprovalStatus: 'pending', pendingReason: pendingReason.trim(), canApprove: true, workflowStage: 'Territory Pending' };
        setCurrentAgent(updated);
        if (onAgentUpdated) onAgentUpdated(updated);
        setTimeout(() => {
          onClose();
        }, 1500);
      } else {
        setError(res.message || 'Failed to update agent pending status.');
      }
    } catch (err) {
      setError(err.message || 'Error occurred while updating pending status.');
    } finally {
      setLoading(false);
    }
  };

  // Merge document references
  const rawDocs = activeAgent.documents || {};
  const kycDocs = activeAgent.kycDocs || {};
  const kyc = activeAgent.kyc || rawDocs.kyc || {};

  const getDocVal = (v) => {
    if (!v) return null;
    if (typeof v === 'string') return v;
    if (typeof v === 'object' && v.url) return v.url;
    return null;
  };

  const aadhaarNumber = activeAgent.aadhaarNumber || kyc.aadhaarNumber || activeAgent.aadharNumber || rawDocs.aadharNumber || null;
  const panNumber = activeAgent.panNumber || kyc.panNumber || rawDocs.panNumber || null;

  const aadhaarDocUrl = rawDocs.aadharUrl || rawDocs.aadhaarUrl || rawDocs.aadhaar || rawDocs.aadhar ||
    getDocVal(kycDocs.aadhaarFront) || getDocVal(kycDocs.aadhaar) || activeAgent.aadharUrl || activeAgent.aadhaarUrl || activeAgent.aadharPhoto || null;
  const aadhaarFileName = rawDocs.aadharFileName || rawDocs.aadhaarFileName || (kycDocs.aadhaarFront?.name) || (aadhaarDocUrl ? 'Aadhaar_Card' : null);

  const panDocUrl = rawDocs.panUrl || rawDocs.pan || getDocVal(kycDocs.panCard) || getDocVal(kycDocs.pan) || activeAgent.panUrl || activeAgent.panPhoto || null;
  const panFileName = rawDocs.panFileName || (kycDocs.panCard?.name) || (panDocUrl ? 'PAN_Card' : null);

  const bankDocUrl = rawDocs.bankPassbookUrl || rawDocs.bankUrl || rawDocs.bankPassbook || rawDocs.passbookUrl ||
    getDocVal(kycDocs.bankPassbook) || getDocVal(kycDocs.passbook) || activeAgent.bankPassbookPhoto || activeAgent.bankPassbookUrl || null;
  const bankFileName = rawDocs.bankPassbookFileName || rawDocs.bankFileName || (kycDocs.bankPassbook?.name) || (bankDocUrl ? 'Bank_Passbook' : null);

  const signatureDocUrl = rawDocs.signatureUrl || rawDocs.signature ||
    getDocVal(kycDocs.signature) || getDocVal(kycDocs.authorizedSignature) || activeAgent.signaturePhoto || activeAgent.signatureUrl || null;
  const signatureFileName = rawDocs.signatureFileName || (kycDocs.signature?.name) || (signatureDocUrl ? 'Digital_Signature' : null);

  // Bank Account Info
  const bankInfo = activeAgent.bankDetails || {};
  const bankAccountHolder = bankInfo.accountHolderName || activeAgent.accountHolderName || activeAgent.name || 'Not provided';
  const bankAccountName = bankInfo.bankName || activeAgent.bankName || 'Not provided';
  const bankAccountNumber = bankInfo.accountNumber || activeAgent.accountNumber || 'Not provided';
  const bankIfscCode = bankInfo.ifscCode || activeAgent.ifscCode || 'Not provided';
  const bankBranchName = bankInfo.branchName || activeAgent.branchName || 'Not provided';

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

  const avatarSrc = activeAgent.avatarUrl || activeAgent.avatar || activeAgent.photo;
  const resolvedAvatar = avatarSrc ? resolveMediaUrl(avatarSrc) : null;

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
                  download
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] font-bold text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 flex items-center gap-1"
                >
                  <Download className="w-3 h-3" /> Open
                </a>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-[11px] text-slate-400 italic">No document file submitted.</p>
        )}
      </div>
    );
  };

  const terr = activeAgent.territory || {};
  const assignedState = terr.state || activeAgent.state || 'Tamil Nadu';
  const assignedDistrict = terr.district || activeAgent.district || '-';
  const assignedDivision = terr.division || activeAgent.division || '-';
  const assignedPincode = terr.pincode || activeAgent.pincode || '-';

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title="Agent Onboarding Request Verification"
        maxWidth="max-w-4xl"
      >
        <div className="space-y-5">
          {/* Status Message Banners */}
          {error && (
            <div className="p-3.5 rounded-xl bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-800 text-xs text-red-600 dark:text-red-400 flex items-start gap-2 animate-fadeIn">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {successMsg && (
            <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-600 dark:text-emerald-400 flex items-start gap-2 animate-fadeIn">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* Header Identity Card */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-5 rounded-2xl bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 text-white shadow-lg border border-indigo-900/40">
            <div className="flex items-center gap-4">
              <div className="relative w-16 h-16 rounded-2xl overflow-hidden bg-white/10 border border-white/20 flex items-center justify-center shrink-0 shadow-inner">
                {resolvedAvatar && !avatarLoadFailed ? (
                  <img
                    src={resolvedAvatar}
                    alt={activeAgent.name}
                    className="w-full h-full object-cover"
                    onError={() => setAvatarLoadFailed(true)}
                  />
                ) : (
                  <UserPlus className="w-8 h-8 text-blue-300" />
                )}
              </div>

              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-lg font-bold text-white">{activeAgent.name || activeAgent.applicantName}</h3>
                  <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-400/30">
                    {activeAgent.roleTitle || activeAgent.role || 'Agent'}
                  </span>
                </div>
                <p className="text-xs text-slate-300 font-mono mt-1">
                  ID: {activeAgent.id || activeAgent._id || 'N/A'} • Applied: {activeAgent.registrationDate || activeAgent.joinedDate || 'Recent'}
                </p>
                <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-slate-300">
                  <span className="flex items-center gap-1">
                    <Phone className="w-3.5 h-3.5 text-blue-400" /> {activeAgent.phone || activeAgent.mobile || 'No phone'}
                  </span>
                  <span>•</span>
                  <span className="flex items-center gap-1">
                    <Mail className="w-3.5 h-3.5 text-blue-400" /> {activeAgent.email || 'No email'}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex flex-col items-start sm:items-end gap-1.5 self-stretch sm:self-auto pt-2 sm:pt-0 border-t sm:border-t-0 border-white/10">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Current Workflow Stage</span>
              <span className={`px-3 py-1 rounded-full text-xs font-bold border ${
                activeAgent.workflowStage === 'Activated' || activeAgent.status === 'active' || activeAgent.status === 'approved'
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-400/40'
                  : activeAgent.workflowStage === 'Awaiting KYC Review' || activeAgent.status === 'pending_kyc'
                  ? 'bg-cyan-500/20 text-cyan-300 border-cyan-400/40'
                  : activeAgent.status === 'rejected' || activeAgent.workflowStage?.includes('Rejected')
                  ? 'bg-red-500/20 text-red-300 border-red-400/40'
                  : 'bg-amber-500/20 text-amber-300 border-amber-400/40'
              }`}>
                {activeAgent.workflowStage || (isPending ? 'Awaiting Territory Approval' : activeAgent.status)}
              </span>
            </div>
          </div>

          {/* Territory Jurisdiction Grid */}
          <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-700/60">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-3 flex items-center gap-2">
              <MapPin className="w-4 h-4 text-blue-500" />
              Requested Territory Jurisdiction
            </h4>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="p-2.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                <span className="text-[10px] text-slate-400 block font-semibold">State</span>
                <span className="font-bold text-slate-800 dark:text-slate-200">{assignedState}</span>
              </div>
              <div className="p-2.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                <span className="text-[10px] text-slate-400 block font-semibold">District</span>
                <span className="font-bold text-slate-800 dark:text-slate-200">{assignedDistrict}</span>
              </div>
              <div className="p-2.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                <span className="text-[10px] text-slate-400 block font-semibold">Division</span>
                <span className="font-bold text-slate-800 dark:text-slate-200">{assignedDivision}</span>
              </div>
              <div className="p-2.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                <span className="text-[10px] text-slate-400 block font-semibold">PIN Code</span>
                <span className="font-bold text-slate-800 dark:text-slate-200 font-mono">{assignedPincode}</span>
              </div>
            </div>

            <div className="mt-3 text-xs text-slate-600 dark:text-slate-400 flex items-start gap-2 bg-white/60 dark:bg-slate-800/60 p-2.5 rounded-lg border border-slate-200/60 dark:border-slate-700/50">
              <span className="font-bold text-slate-700 dark:text-slate-300 shrink-0">Address:</span>
              <span>{formatAddress(activeAgent.address || activeAgent.assignedArea)}</span>
            </div>
          </div>

          {/* Approved / Activated Status Banner */}
          {(isActive || activeAgent.adminApprovalStatus === 'approved') && (
            <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 text-xs space-y-1">
              <div className="flex items-center gap-2 font-bold text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                <span>Registration Approved & Active</span>
              </div>
              <p className="text-emerald-700 dark:text-emerald-400">
                Territory credentials cleared and authorized by {activeAgent.adminApprovedBy || 'Administrator'}
                {activeAgent.adminApprovedByRole ? ` (${activeAgent.adminApprovedByRole})` : ''}
                {activeAgent.adminApprovedAt ? ` on ${new Date(activeAgent.adminApprovedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}` : ''}.
              </p>
            </div>
          )}

          {/* Action Required / Pending Reason Banner (Only when pending) */}
          {isPending && (activeAgent.pendingReason || activeAgent.adminNotes) && (
            <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 text-xs space-y-1">
              <div className="flex items-center gap-2 font-bold text-amber-800 dark:text-amber-300">
                <Clock className="w-4 h-4 text-amber-500" />
                <span>Pending Reviewer Reason:</span>
              </div>
              <p className="text-amber-700 dark:text-amber-400 font-medium">
                {activeAgent.pendingReason || activeAgent.adminNotes}
              </p>
              {activeAgent.adminPendingBy && (
                <p className="text-[11px] text-amber-600 dark:text-amber-500">
                  By {activeAgent.adminPendingBy} {activeAgent.adminPendingByRole ? `(${activeAgent.adminPendingByRole})` : ''}
                  {activeAgent.adminPendingAt ? ` on ${new Date(activeAgent.adminPendingAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}` : ''}
                </p>
              )}
            </div>
          )}

          {/* Rejection Reason (If Rejected) */}
          {isRejected && activeAgent.rejectionReason && (
            <div className="p-4 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 text-xs space-y-1">
              <div className="flex items-center gap-2 font-bold text-red-700 dark:text-red-400">
                <XCircle className="w-4 h-4" /> Rejection Reason Recorded
              </div>
              <p className="text-red-600 dark:text-red-300">{activeAgent.rejectionReason}</p>
            </div>
          )}

          {/* Official Verification Numbers */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700/60 flex items-center justify-between">
              <div>
                <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider block">Aadhaar Number</span>
                <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
                  {showFullAadhaar ? (aadhaarNumber || 'Not provided') : maskAadhaar(aadhaarNumber)}
                </span>
              </div>
              {aadhaarNumber && (
                <button
                  type="button"
                  onClick={() => setShowFullAadhaar(!showFullAadhaar)}
                  className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                >
                  {showFullAadhaar ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              )}
            </div>

            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700/60 flex items-center justify-between">
              <div>
                <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider block">PAN Number</span>
                <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
                  {showFullPan ? (panNumber || 'Not provided') : maskPan(panNumber)}
                </span>
              </div>
              {panNumber && (
                <button
                  type="button"
                  onClick={() => setShowFullPan(!showFullPan)}
                  className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                >
                  {showFullPan ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              )}
            </div>
          </div>

          {/* KYC Documents Section */}
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-2.5 flex items-center gap-2">
              <FileText className="w-4 h-4 text-indigo-500" />
              Submitted Official KYC Documents
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {renderDocCard({ title: 'Aadhaar Card Front / Back', docUrl: aadhaarDocUrl, fileName: aadhaarFileName })}
              {renderDocCard({ title: 'PAN Card Copy', docUrl: panDocUrl, fileName: panFileName })}
              {renderDocCard({ title: 'Bank Passbook / Statement', docUrl: bankDocUrl, fileName: bankFileName })}
              {renderDocCard({ title: 'Digital Signature', docUrl: signatureDocUrl, fileName: signatureFileName })}
            </div>
          </div>

          {/* Bank Account Details */}
          <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700/60 text-xs">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-3 flex items-center gap-2">
              <Landmark className="w-4 h-4 text-emerald-500" />
              Settlement Bank Account Details
            </h4>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div>
                <span className="text-[10px] text-slate-400 block font-semibold">Account Holder</span>
                <span className="font-bold text-slate-800 dark:text-slate-200">{bankAccountHolder}</span>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 block font-semibold">Bank Name</span>
                <span className="font-bold text-slate-800 dark:text-slate-200">{bankAccountName}</span>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 block font-semibold">Account Number</span>
                <span className="font-bold font-mono text-slate-800 dark:text-slate-200">{bankAccountNumber}</span>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 block font-semibold">IFSC Code</span>
                <span className="font-bold font-mono text-slate-800 dark:text-slate-200">{bankIfscCode}</span>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 block font-semibold">Branch</span>
                <span className="font-bold text-slate-800 dark:text-slate-200">{bankBranchName}</span>
              </div>
            </div>
          </div>

          {/* Historical Review History / Audit Trail */}
          {Array.isArray(activeAgent.reviewHistory) && activeAgent.reviewHistory.length > 0 && (
            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700/60 text-xs space-y-2">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 flex items-center gap-2">
                <Clock className="w-3.5 h-3.5 text-slate-400" />
                Review & Approval History
              </h4>
              <div className="divide-y divide-slate-200 dark:divide-slate-700/60">
                {activeAgent.reviewHistory.map((entry, idx) => (
                  <div key={idx} className="py-2 flex items-start justify-between gap-3 text-[11px]">
                    <div>
                      <span className={`font-bold uppercase ${
                        entry.action === 'APPROVED' ? 'text-emerald-600 dark:text-emerald-400' :
                        entry.action === 'REJECTED' ? 'text-red-600 dark:text-red-400' :
                        'text-amber-600 dark:text-amber-400'
                      }`}>
                        {entry.action || 'REVIEW'}:
                      </span>{' '}
                      <span className="text-slate-700 dark:text-slate-300">{entry.reason || entry.note || entry.status || 'Updated'}</span>
                      <div className="text-[10px] text-slate-400 mt-0.5">
                        By {entry.reviewerName || 'Administrator'} {entry.reviewerRole ? `(${entry.reviewerRole})` : ''}
                      </div>
                    </div>
                    {(entry.reviewedAt || entry.timestamp) && (
                      <span className="text-[10px] text-slate-400 shrink-0 font-mono">
                        {new Date(entry.reviewedAt || entry.timestamp).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Rejection Prompt Box */}
          {showRejectBox && (
            <div className="p-4 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 space-y-3 animate-fadeIn">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-red-700 dark:text-red-400 flex items-center gap-1.5">
                  <AlertCircle className="w-4 h-4" /> Specify Reason for Rejection
                </span>
                <button
                  type="button"
                  onClick={() => setShowRejectBox(false)}
                  className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                >
                  Cancel
                </button>
              </div>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                rows={3}
                placeholder="Enter mandatory reason for rejecting this agent registration (e.g. Unclear ID proofs, jurisdiction mismatch, invalid contact details)..."
                className="w-full text-xs p-3 rounded-lg border border-red-200 dark:border-red-800 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-red-500"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowRejectBox(false)}
                  className="px-3 py-1.5 text-xs text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleReject}
                  disabled={loading || !rejectReason.trim()}
                  className="px-4 py-1.5 text-xs font-bold text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 rounded-lg shadow transition"
                >
                  {loading ? 'Submitting...' : 'Confirm Rejection'}
                </button>
              </div>
            </div>
          )}

          {/* Pending Reason Input Box */}
          {showPendingBox && (
            <div className="p-4 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50/40 dark:bg-amber-950/20 space-y-3 animate-fadeIn">
              <label className="block text-xs font-bold text-amber-700 dark:text-amber-300">
                Mandatory Reason / Note for Keeping Request Pending:
              </label>
              <textarea
                value={pendingReason}
                onChange={(e) => setPendingReason(e.target.value)}
                rows={3}
                placeholder="Enter mandatory reason or note explaining why this agent registration is kept pending (e.g. Awaiting proof of address, clarification on operational division, pending background check)..."
                className="w-full text-xs p-3 rounded-lg border border-amber-200 dark:border-amber-800 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowPendingBox(false)}
                  className="px-3 py-1.5 text-xs text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleKeepPending}
                  disabled={loading || !pendingReason.trim()}
                  className="px-4 py-1.5 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50 rounded-lg shadow transition"
                >
                  {loading ? 'Saving...' : 'Confirm Pending'}
                </button>
              </div>
            </div>
          )}

          {/* Modal Footer Controls */}
          <div className="flex items-center justify-between pt-4 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition"
            >
              Close
            </button>

            <div className="flex items-center gap-2">
              {isPending && !canApprove && (
                <span className="text-xs font-semibold text-slate-500 italic px-3 py-1.5 bg-slate-100 dark:bg-slate-800 rounded-xl">
                  Authority designated to {activeAgent.targetAdminRole || 'Territory Administrator'}
                </span>
              )}

              {isPending && !showRejectBox && !showPendingBox && canApprove && (
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

                  <button
                    type="button"
                    onClick={() => setShowRejectBox(true)}
                    disabled={loading}
                    className="px-4 py-2 rounded-xl text-xs font-bold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/50 hover:bg-red-100 dark:hover:bg-red-900/50 border border-red-200 dark:border-red-800/60 transition cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
                  >
                    <X className="w-3.5 h-3.5" />
                    Reject
                  </button>

                  <button
                    type="button"
                    onClick={handleApprove}
                    disabled={loading}
                    className="px-5 py-2 rounded-xl text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 shadow-md shadow-emerald-500/20 transition cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
                  >
                    <Check className="w-4 h-4" />
                    {loading ? 'Approving...' : 'Approve & Forward to KYC'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </Modal>

      {/* Lightbox Preview */}
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
