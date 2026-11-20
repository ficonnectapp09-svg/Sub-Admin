import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../../context/AuthContext';
import { dataService } from '../../services/dataService';
import { DataTable } from '../../components/DataTable';
import { StatusBadge } from '../../components/Badge';
import { InitiateVendorOnboardingModal } from '../../components/InitiateVendorOnboardingModal';
import { AgentActivityFlowModal } from '../../components/AgentActivityFlowModal';
import { AgentOnboardingModal } from '../../components/AgentOnboardingModal';
import { AccountActionModal } from '../../components/AccountActionModal';
import { 
  UserPlus, 
  Phone, 
  Mail, 
  Wallet, 
  MapPin, 
  Store, 
  Plus, 
  ArrowRight, 
  CheckCircle2,
  UserCheck,
  UserX,
  Trash2
} from 'lucide-react';

export function PincodeAgents() {
  const { user } = useAuth();
  const [agents, setAgents] = useState([]);
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('roster');
  const [selectedActivity, setSelectedActivity] = useState(null);
  const [showOnboardModal, setShowOnboardModal] = useState(false);
  const [showAddAgentModal, setShowAddAgentModal] = useState(false);

  const pincode = user?.pincode || '';

  const [statusFilter, setStatusFilter] = useState('all');

  // Account Action State (Suspend / Activate / Delete)
  const [accountActionState, setAccountActionState] = useState({
    isOpen: false,
    actionType: 'suspend', // 'suspend' | 'activate' | 'delete'
    account: null,
    loading: false,
    error: ''
  });

  const handleTriggerAccountAction = (account, actionType) => {
    setAccountActionState({
      isOpen: true,
      actionType,
      account: {
        id: account.id || account._id,
        name: account.name || account.fullName || 'Agent',
        role: 'agent',
        status: account.status || 'Active',
        identifier: account.phone || account.mobile || account.email || account.agentId || account.id
      },
      loading: false,
      error: ''
    });
  };

  const handleConfirmAccountAction = async (payload) => {
    if (!accountActionState.account) return;
    setAccountActionState(prev => ({ ...prev, loading: true, error: '' }));
    try {
      const id = accountActionState.account.id;
      const res = await dataService.updateAgentAccountStatus(id, {
        action: accountActionState.actionType,
        reason: payload.reason || ''
      });
      if (res?.success) {
        setAccountActionState(prev => ({ ...prev, isOpen: false, loading: false, account: null }));
        await loadData();
      } else {
        setAccountActionState(prev => ({ ...prev, loading: false, error: res?.message || 'Failed to update agent status' }));
      }
    } catch (err) {
      setAccountActionState(prev => ({
        ...prev,
        loading: false,
        error: err.response?.data?.message || err.message || 'Error updating agent status'
      }));
    }
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await dataService.getAgents({ pincode, level: 'pincode', status: 'all' });
      if (res.success && res.agents) setAgents(res.agents);
      else setAgents([]);

      const actRes = await dataService.getAgentActivities({ pincode });
      if (actRes.success && actRes.activities) setActivities(actRes.activities);
      else setActivities([]);
    } catch (e) {
      console.error(e);
      setAgents([]);
      setActivities([]);
    } finally {
      setLoading(false);
    }
  };

  const filteredAgents = useMemo(() => {
    let list = agents;
    if (statusFilter && statusFilter !== 'all') {
      const sf = statusFilter.toLowerCase();
      if (sf === 'deleted') {
        list = list.filter(a => (a.status || '').toLowerCase() === 'deleted' || a.isDeleted);
      } else {
        list = list.filter(a => (a.status || '').toLowerCase() === sf && !a.isDeleted);
      }
    }
    return list;
  }, [agents, statusFilter]);

  useEffect(() => {
    loadData();
  }, []);

  const handleCreateOnboarding = async (formData) => {
    const res = await dataService.createAgentActivity(formData);
    if (res.success) {
      loadData();
      setActiveTab('activities');
    }
  };

  const columns = [
    {
      header: 'Agent Details',
      accessor: 'name',
      render: (row) => (
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-indigo-950/60 border border-indigo-700/40 text-indigo-400">
            <UserPlus className="w-5 h-5" />
          </div>
          <div>
            <div className="font-bold text-slate-900 dark:text-white text-sm">{row.name}</div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1">
              <Phone className="w-3 h-3 text-slate-400" />
              {row.phone}
            </div>
            <div className="text-[11px] text-slate-400">{row.email}</div>
          </div>
        </div>
      )
    },
    {
      header: 'Referrals & Subscriptions',
      accessor: 'totalReferrals',
      render: (row) => (
        <div>
          <div className="font-bold text-slate-900 dark:text-white">{row.totalReferrals} Referrals</div>
          <div className="text-[11px] text-blue-600 dark:text-blue-400 font-semibold">{row.vendorOnboardings || 0} Vendors Onboarded</div>
        </div>
      )
    },
    {
      header: 'Wallet Balance',
      accessor: 'walletBalance',
      render: (row) => (
        <span className="font-mono font-bold text-amber-500 dark:text-amber-300 text-sm">
          ₹{(Number(row.walletBalance) || 0).toLocaleString()}
        </span>
      )
    },
    {
      header: 'Total Earned',
      accessor: 'totalEarned',
      render: (row) => (
        <span className="font-bold text-emerald-600 dark:text-emerald-400">₹{(Number(row.totalEarned) || 0).toLocaleString()}</span>
      )
    },
    {
      header: 'Status',
      accessor: 'status',
      render: (row) => <StatusBadge status={row.status} />
    },
    {
      header: 'Actions',
      accessor: 'id',
      render: (row) => {
        const rowStatus = (row.status || 'Active').toLowerCase();
        const isDeleted = rowStatus === 'deleted' || row.isDeleted;
        const isSuspended = rowStatus === 'suspended';

        if (isDeleted) {
          return (
            <span className="inline-flex items-center px-2 py-0.5 text-[10px] font-semibold rounded-lg bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400 border border-rose-200 dark:border-rose-900/50">
              Deactivated
            </span>
          );
        }

        return (
          <div className="flex items-center gap-1.5 flex-wrap">
            {isSuspended ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleTriggerAccountAction(row, 'activate');
                }}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:hover:bg-emerald-900/50 border border-emerald-200 dark:border-emerald-800 transition cursor-pointer"
                title="Activate Agent"
              >
                <UserCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                <span>Activate</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleTriggerAccountAction(row, 'suspend');
                }}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold text-amber-700 dark:text-amber-300 bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/40 dark:hover:bg-amber-900/50 border border-amber-200 dark:border-amber-800 transition cursor-pointer"
                title="Suspend Agent"
              >
                <UserX className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                <span>Suspend</span>
              </button>
            )}

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleTriggerAccountAction(row, 'delete');
              }}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold text-rose-700 dark:text-rose-300 bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 dark:hover:bg-rose-900/50 border border-rose-200 dark:border-rose-800 transition cursor-pointer"
              title="Delete Agent (Soft Delete)"
            >
              <Trash2 className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" />
              <span>Delete</span>
            </button>
          </div>
        );
      }
    }
  ];

  const activityColumns = [
    {
      header: 'Activity & Onboarding',
      accessor: 'title',
      render: (row) => (
        <div className="flex items-center gap-2">
          <Store className="w-4 h-4 text-amber-500" />
          <div>
            <div className="text-xs font-bold text-slate-900 dark:text-white">{row.title}</div>
            <div className="text-[10px] text-slate-500 font-mono">{row.id} • {row.createdDate}</div>
          </div>
        </div>
      )
    },
    {
      header: 'Escalation Status',
      accessor: 'status',
      render: (row) => (
        <div>
          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">
            {row.status}
          </span>
          <div className="text-[10px] text-slate-500 mt-0.5">Currently at: {row.currentStage}</div>
        </div>
      )
    },
    {
      header: 'Action',
      accessor: 'id',
      render: (row) => (
        <button
          type="button"
          onClick={() => setSelectedActivity(row)}
          className="text-xs font-bold text-amber-600 hover:text-amber-700 flex items-center gap-1 cursor-pointer"
        >
          Track Flow <ArrowRight className="w-3 h-3" />
        </button>
      )
    }
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">Pincode Agents{pincode ? ` (PIN: ${pincode})` : ''}</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">Hyper-local pincode service agents, door-to-door customer onboarding, and neighborhood liaisons.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowAddAgentModal(true)}
            className="px-3.5 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl shadow-xs transition flex items-center gap-2 cursor-pointer"
          >
            <UserPlus className="w-4 h-4" />
            <span>Add Pincode Agent</span>
          </button>
        </div>
      </div>

      {/* Visibility Rule Notice */}
      <div className="p-3.5 rounded-xl bg-amber-50/80 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/50 flex items-center justify-between text-xs text-amber-900 dark:text-amber-200">
        <div className="flex items-center gap-2">
          <MapPin className="w-4 h-4 text-amber-600" />
          <span className="font-bold">Hierarchy Rule:</span>
          <span>Pincode Agents initiate ground vendor onboarding and membership card activities, which flow upward to the Divisional Agent.</span>
        </div>
        <span className="text-[10px] font-bold bg-amber-200 dark:bg-amber-900 text-amber-800 dark:text-amber-300 px-2 py-0.5 rounded-full">
          Tier 4 Ground
        </span>
      </div>

      <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-2">
        <button
          type="button"
          onClick={() => setActiveTab('roster')}
          className={`px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer ${
            activeTab === 'roster' ? 'bg-amber-600 text-white' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300'
          }`}
        >
          Pincode Agents ({agents.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('activities')}
          className={`px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer ${
            activeTab === 'activities' ? 'bg-amber-600 text-white' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300'
          }`}
        >
          Ground Activities & Onboardings ({activities.length})
        </button>
      </div>

      {activeTab === 'roster' ? (
        <DataTable
          title="Agent Network Roster"
          subtitle="Manage acquisition agents and referral track records"
          columns={columns}
          data={filteredAgents}
          loading={loading}
          onRefresh={loadData}
          filterOptions={[
            { label: `All (${agents.length})`, value: 'all' },
            { label: `Active (${agents.filter(a => (a.status || '').toLowerCase() === 'active' && !a.isDeleted).length})`, value: 'active' },
            { label: `Suspended (${agents.filter(a => (a.status || '').toLowerCase() === 'suspended' && !a.isDeleted).length})`, value: 'suspended' },
            { label: `Deleted (${agents.filter(a => (a.status || '').toLowerCase() === 'deleted' || a.isDeleted).length})`, value: 'deleted' }
          ]}
          activeFilter={statusFilter}
          onFilterChange={setStatusFilter}
          searchPlaceholder="Search agent by name or phone..."
          exportFileName="pincode_agents.csv"
        />
      ) : (
        <DataTable
          title="Ground Activities & Vendor Onboardings"
          subtitle="Direct activities initiated within this pincode"
          columns={activityColumns}
          data={activities}
          loading={loading}
          onRefresh={loadData}
          searchPlaceholder="Search activity..."
          exportFileName="pincode_agent_activities.csv"
        />
      )}

      <AgentActivityFlowModal
        isOpen={Boolean(selectedActivity)}
        onClose={() => setSelectedActivity(null)}
        activity={selectedActivity}
      />

      {/* Account Action Modal (Suspend / Activate / Soft-Delete) */}
      <AccountActionModal
        isOpen={accountActionState.isOpen}
        onClose={() => setAccountActionState(prev => ({ ...prev, isOpen: false, error: '' }))}
        onConfirm={handleConfirmAccountAction}
        actionType={accountActionState.actionType}
        account={accountActionState.account}
        loading={accountActionState.loading}
        error={accountActionState.error}
      />

      <InitiateVendorOnboardingModal
        isOpen={showOnboardModal}
        onClose={() => setShowOnboardModal(false)}
        onSuccess={handleCreateOnboarding}
        defaultPincode={pincode}
      />

      <AgentOnboardingModal
        isOpen={showAddAgentModal}
        onClose={() => setShowAddAgentModal(false)}
        onSuccess={() => {
          loadData();
        }}
        level="pincode"
      />
    </div>
  );
}
