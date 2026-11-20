import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getRoleDashboardPath, isRoleAllowed } from '../utils/permissions';
import { ProtectedRoute } from './ProtectedRoute';
import { RoleBasedRoute } from './RoleBasedRoute';
import { DashboardLayout } from '../layouts/DashboardLayout';

// Auth Pages (eagerly loaded for instant auth rendering)
import { Login } from '../pages/auth/Login';
import { RegistrationStatus } from '../pages/auth/RegistrationStatus';
import { AccessDenied } from '../pages/common/AccessDenied';

// Helper for dynamic code splitting of named component exports with auto-retry on stale deployment chunks
function lazyWithRetry(importFn, name) {
  return React.lazy(async () => {
    try {
      const mod = await importFn();
      return { default: name ? mod[name] : (mod.default || mod) };
    } catch (error) {
      const msg = String(error?.message || error || '');
      const isChunkError =
        msg.includes('Failed to fetch dynamically imported module') ||
        msg.includes('Expected a JavaScript-or-Wasm module script') ||
        msg.includes('Importing a module script failed') ||
        msg.includes('error loading dynamically imported module') ||
        msg.includes('Loading chunk') ||
        msg.includes('MIME type');

      if (isChunkError && typeof window !== 'undefined') {
        const key = 'ams_chunk_reload_' + (name || 'common');
        const last = sessionStorage.getItem(key);
        const now = Date.now();
        // Allow one auto-reload per 15s to prevent infinite reload loops
        if (!last || now - parseInt(last, 10) > 15000) {
          sessionStorage.setItem(key, String(now));
          window.location.reload();
          return new Promise(() => {}); // Hold until reload executes
        }
      }
      throw error;
    }
  });
}
const lazyNamed = lazyWithRetry;

// Route Loading Spinner fallback
function RouteLoadingSpinner() {
  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center text-indigo-400 font-mono text-sm">
      <div className="flex items-center gap-2">
        <div className="w-5 h-5 rounded-full border-2 border-indigo-400 border-t-transparent animate-spin"></div>
        <span>Loading...</span>
      </div>
    </div>
  );
}

// State Admin Pages (lazy loaded on demand)
const StateAdminDashboard = lazyNamed(() => import('../pages/state-admin/Dashboard'), 'StateAdminDashboard');
const StatesOverview = lazyNamed(() => import('../pages/state-admin/StatesOverview'), 'StatesOverview');
const StateDistricts = lazyNamed(() => import('../pages/state-admin/Districts'), 'StateDistricts');
const StateDivisions = lazyNamed(() => import('../pages/state-admin/Divisions'), 'StateDivisions');
const StatePincodes = lazyNamed(() => import('../pages/state-admin/Pincodes'), 'StatePincodes');
const StateCustomers = lazyNamed(() => import('../pages/state-admin/Customers'), 'StateCustomers');
const StateMembershipCards = lazyNamed(() => import('../pages/state-admin/MembershipCards'), 'StateMembershipCards');
const StateVendors = lazyNamed(() => import('../pages/state-admin/Vendors'), 'StateVendors');
const StateVendorSubscriptions = lazyNamed(() => import('../pages/state-admin/VendorSubscriptions'), 'StateVendorSubscriptions');
const StateVendorPayments = lazyNamed(() => import('../pages/state-admin/VendorPayments'), 'StateVendorPayments');
const StateOrders = lazyNamed(() => import('../pages/state-admin/Orders'), 'StateOrders');
const StateBookings = lazyNamed(() => import('../pages/state-admin/Bookings'), 'StateBookings');
const StateJobs = lazyNamed(() => import('../pages/state-admin/Jobs'), 'StateJobs');
const StateDeliveryPartners = lazyNamed(() => import('../pages/state-admin/DeliveryPartners'), 'StateDeliveryPartners');
const StateTechnicians = lazyNamed(() => import('../pages/state-admin/Technicians'), 'StateTechnicians');
const StateExecutives = lazyNamed(() => import('../pages/state-admin/Executives'), 'StateExecutives');
const StateAgents = lazyNamed(() => import('../pages/state-admin/Agents'), 'StateAgents');
const StateManagers = lazyNamed(() => import('../pages/state-admin/Managers'), 'StateManagers');
const StateAgentPayments = lazyNamed(() => import('../pages/state-admin/AgentPayments'), 'StateAgentPayments');
const StatePayments = lazyNamed(() => import('../pages/state-admin/Payments'), 'StatePayments');
const StateReports = lazyNamed(() => import('../pages/state-admin/Reports'), 'StateReports');
const StateKYC = lazyNamed(() => import('../pages/state-admin/KYC'), 'StateKYC');
const StateQualityCheck = lazyNamed(() => import('../pages/state-admin/QualityCheck'), 'StateQualityCheck');
const StateSupportTeam = lazyNamed(() => import('../pages/state-admin/SupportTeam'), 'StateSupportTeam');
const StateProfile = lazyNamed(() => import('../pages/state-admin/Profile'), 'StateProfile');
const StateSettings = lazyNamed(() => import('../pages/state-admin/Settings'), 'StateSettings');
const StateTasks = lazyNamed(() => import('../pages/state-admin/Tasks'), 'StateTasks');
const StateQueries = lazyNamed(() => import('../pages/state-admin/Queries'), 'StateQueries');

// District Admin Pages (lazy loaded on demand)
const DistrictAdminDashboard = lazyNamed(() => import('../pages/district-admin/Dashboard'), 'DistrictAdminDashboard');
const DistrictOverview = lazyNamed(() => import('../pages/district-admin/Overview'), 'DistrictOverview');
const DistrictDivisions = lazyNamed(() => import('../pages/district-admin/Divisions'), 'DistrictDivisions');
const DistrictPincodes = lazyNamed(() => import('../pages/district-admin/Pincodes'), 'DistrictPincodes');
const DistrictCustomers = lazyNamed(() => import('../pages/district-admin/Customers'), 'DistrictCustomers');
const DistrictMembershipCards = lazyNamed(() => import('../pages/district-admin/MembershipCards'), 'DistrictMembershipCards');
const DistrictVendors = lazyNamed(() => import('../pages/district-admin/Vendors'), 'DistrictVendors');
const DistrictVendorSubscriptions = lazyNamed(() => import('../pages/district-admin/VendorSubscriptions'), 'DistrictVendorSubscriptions');
const DistrictVendorPayments = lazyNamed(() => import('../pages/district-admin/VendorPayments'), 'DistrictVendorPayments');
const DistrictOrders = lazyNamed(() => import('../pages/district-admin/Orders'), 'DistrictOrders');
const DistrictBookings = lazyNamed(() => import('../pages/district-admin/Bookings'), 'DistrictBookings');
const DistrictJobs = lazyNamed(() => import('../pages/district-admin/Jobs'), 'DistrictJobs');
const DistrictDeliveryPartners = lazyNamed(() => import('../pages/district-admin/DeliveryPartners'), 'DistrictDeliveryPartners');
const DistrictTechnicians = lazyNamed(() => import('../pages/district-admin/Technicians'), 'DistrictTechnicians');
const DistrictExecutives = lazyNamed(() => import('../pages/district-admin/Executives'), 'DistrictExecutives');
const DistrictSupportTeam = lazyNamed(() => import('../pages/district-admin/SupportTeam'), 'DistrictSupportTeam');
const DistrictAgents = lazyNamed(() => import('../pages/district-admin/Agents'), 'DistrictAgents');
const DistrictAgentPayments = lazyNamed(() => import('../pages/district-admin/AgentPayments'), 'DistrictAgentPayments');
const DistrictKYC = lazyNamed(() => import('../pages/district-admin/KYC'), 'DistrictKYC');
const DistrictQualityCheck = lazyNamed(() => import('../pages/district-admin/QualityCheck'), 'DistrictQualityCheck');
const DistrictReports = lazyNamed(() => import('../pages/district-admin/Reports'), 'DistrictReports');
const DistrictPayments = lazyNamed(() => import('../pages/district-admin/Payments'), 'DistrictPayments');
const DistrictTasks = lazyNamed(() => import('../pages/district-admin/Tasks'), 'DistrictTasks');
const DistrictQueries = lazyNamed(() => import('../pages/district-admin/Queries'), 'DistrictQueries');
const DistrictProfile = lazyNamed(() => import('../pages/district-admin/Profile'), 'DistrictProfile');
const DistrictSettings = lazyNamed(() => import('../pages/district-admin/Settings'), 'DistrictSettings');

// Divisional Admin Pages (lazy loaded on demand)
const DivisionalAdminDashboard = lazyNamed(() => import('../pages/divisional-admin/Dashboard'), 'DivisionalAdminDashboard');
const DivisionalOverview = lazyNamed(() => import('../pages/divisional-admin/Overview'), 'DivisionalOverview');
const DivisionalPincodes = lazyNamed(() => import('../pages/divisional-admin/Pincodes'), 'DivisionalPincodes');
const DivisionalCustomers = lazyNamed(() => import('../pages/divisional-admin/Customers'), 'DivisionalCustomers');
const DivisionalMembershipCards = lazyNamed(() => import('../pages/divisional-admin/MembershipCards'), 'DivisionalMembershipCards');
const DivisionalVendors = lazyNamed(() => import('../pages/divisional-admin/Vendors'), 'DivisionalVendors');
const DivisionalVendorSubscriptions = lazyNamed(() => import('../pages/divisional-admin/VendorSubscriptions'), 'DivisionalVendorSubscriptions');
const DivisionalVendorPayments = lazyNamed(() => import('../pages/divisional-admin/VendorPayments'), 'DivisionalVendorPayments');
const DivisionalOrders = lazyNamed(() => import('../pages/divisional-admin/Orders'), 'DivisionalOrders');
const DivisionalBookings = lazyNamed(() => import('../pages/divisional-admin/Bookings'), 'DivisionalBookings');
const DivisionalJobs = lazyNamed(() => import('../pages/divisional-admin/Jobs'), 'DivisionalJobs');
const DivisionalDeliveryPartners = lazyNamed(() => import('../pages/divisional-admin/DeliveryPartners'), 'DivisionalDeliveryPartners');
const DivisionalTechnicians = lazyNamed(() => import('../pages/divisional-admin/Technicians'), 'DivisionalTechnicians');
const DivisionalExecutives = lazyNamed(() => import('../pages/divisional-admin/Executives'), 'DivisionalExecutives');
const DivisionalSupportTeam = lazyNamed(() => import('../pages/divisional-admin/SupportTeam'), 'DivisionalSupportTeam');
const DivisionalAgents = lazyNamed(() => import('../pages/divisional-admin/Agents'), 'DivisionalAgents');
const DivisionalAgentPayments = lazyNamed(() => import('../pages/divisional-admin/AgentPayments'), 'DivisionalAgentPayments');
const DivisionalKYC = lazyNamed(() => import('../pages/divisional-admin/KYC'), 'DivisionalKYC');
const DivisionalQualityCheck = lazyNamed(() => import('../pages/divisional-admin/QualityCheck'), 'DivisionalQualityCheck');
const DivisionalReports = lazyNamed(() => import('../pages/divisional-admin/Reports'), 'DivisionalReports');
const DivisionalPayments = lazyNamed(() => import('../pages/divisional-admin/Payments'), 'DivisionalPayments');
const DivisionalTasks = lazyNamed(() => import('../pages/divisional-admin/Tasks'), 'DivisionalTasks');
const DivisionalQueries = lazyNamed(() => import('../pages/divisional-admin/Queries'), 'DivisionalQueries');
const DivisionalProfile = lazyNamed(() => import('../pages/divisional-admin/Profile'), 'DivisionalProfile');
const DivisionalSettings = lazyNamed(() => import('../pages/divisional-admin/Settings'), 'DivisionalSettings');

// Pincode Admin Pages (lazy loaded on demand)
const PincodeAdminDashboard = lazyNamed(() => import('../pages/pincode-admin/Dashboard'), 'PincodeAdminDashboard');
const PincodeOverview = lazyNamed(() => import('../pages/pincode-admin/Overview'), 'PincodeOverview');
const PincodeCustomers = lazyNamed(() => import('../pages/pincode-admin/Customers'), 'PincodeCustomers');
const PincodeMembershipCards = lazyNamed(() => import('../pages/pincode-admin/MembershipCards'), 'PincodeMembershipCards');
const PincodeVendors = lazyNamed(() => import('../pages/pincode-admin/Vendors'), 'PincodeVendors');
const PincodeVendorSubscriptions = lazyNamed(() => import('../pages/pincode-admin/VendorSubscriptions'), 'PincodeVendorSubscriptions');
const PincodeVendorDetails = lazyNamed(() => import('../pages/pincode-admin/VendorDetails'), 'PincodeVendorDetails');
const PincodeVendorPayments = lazyNamed(() => import('../pages/pincode-admin/VendorPayments'), 'PincodeVendorPayments');
const PincodeOrders = lazyNamed(() => import('../pages/pincode-admin/Orders'), 'PincodeOrders');
const PincodeBookings = lazyNamed(() => import('../pages/pincode-admin/Bookings'), 'PincodeBookings');
const PincodeJobs = lazyNamed(() => import('../pages/pincode-admin/Jobs'), 'PincodeJobs');
const PincodeDeliveryPartners = lazyNamed(() => import('../pages/pincode-admin/DeliveryPartners'), 'PincodeDeliveryPartners');
const PincodeTechnicians = lazyNamed(() => import('../pages/pincode-admin/Technicians'), 'PincodeTechnicians');
const PincodeExecutives = lazyNamed(() => import('../pages/pincode-admin/Executives'), 'PincodeExecutives');
const PincodeSupportTeam = lazyNamed(() => import('../pages/pincode-admin/SupportTeam'), 'PincodeSupportTeam');
const PincodeAgents = lazyNamed(() => import('../pages/pincode-admin/Agents'), 'PincodeAgents');
const PincodeAgentPayments = lazyNamed(() => import('../pages/pincode-admin/AgentPayments'), 'PincodeAgentPayments');
const PincodeKYC = lazyNamed(() => import('../pages/pincode-admin/KYC'), 'PincodeKYC');
const PincodeQualityCheck = lazyNamed(() => import('../pages/pincode-admin/QualityCheck'), 'PincodeQualityCheck');
const PincodeBusinessReports = lazyNamed(() => import('../pages/pincode-admin/BusinessReports'), 'PincodeBusinessReports');
const PincodePayments = lazyNamed(() => import('../pages/pincode-admin/Payments'), 'PincodePayments');
const PincodeTasks = lazyNamed(() => import('../pages/pincode-admin/Tasks'), 'PincodeTasks');
const PincodeQueries = lazyNamed(() => import('../pages/pincode-admin/Queries'), 'PincodeQueries');
const PincodeProfile = lazyNamed(() => import('../pages/pincode-admin/Profile'), 'PincodeProfile');
const PincodeSettings = lazyNamed(() => import('../pages/pincode-admin/Settings'), 'PincodeSettings');

// Onboarding Request Pages (lazy loaded on demand)
const ManagerRequestsPage = lazyNamed(() => import('../pages/requests/ManagerRequestsPage'), 'ManagerRequestsPage');
const AgentRequestsPage = lazyNamed(() => import('../pages/requests/AgentRequestsPage'), 'AgentRequestsPage');
const VendorRequestsPage = lazyNamed(() => import('../pages/requests/VendorRequestsPage'), 'VendorRequestsPage');

// Common Notifications Page (lazy loaded on demand)
const NotificationsPage = lazyWithRetry(() => import('../pages/common/Notifications'));

function RootRedirect() {
  const { user, isAuthenticated, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center text-indigo-400 font-mono text-sm">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded-full border-2 border-indigo-400 border-t-transparent animate-spin"></div>
          <span>Loading...</span>
        </div>
      </div>
    );
  }
  if (!isAuthenticated || !user) return <Navigate to="/login" replace />;

  const authorizedRoles = ['State Admin', 'District Admin', 'Divisional Admin', 'Division Admin', 'Pincode Admin', 'Super Admin'];
  if (!isRoleAllowed(user.role, authorizedRoles)) {
    return <Navigate to="/access-denied" replace />;
  }

  const statusUpper = String(user?.status || '').toUpperCase();
  const isApproved = (statusUpper === 'ACTIVE' || statusUpper === 'APPROVED') &&
    String(user?.adminApprovalStatus || 'approved').toLowerCase() === 'approved' &&
    user?.isActive !== false &&
    !user?.requiresApproval;

  if (!isApproved) {
    return <Navigate to="/registration-status" replace />;
  }
  return <Navigate to={getRoleDashboardPath(user.role)} replace />;
}

export function AppRoutes() {
  return (
    <React.Suspense fallback={<RouteLoadingSpinner />}>
      <Routes>
      <Route path="/" element={<RootRedirect />} />
      {/* /login: already-authenticated users are redirected to their dashboard inside Login.jsx */}
      <Route path="/login" element={<Login />} />
      <Route path="/registration-status" element={<RegistrationStatus />} />
      <Route path="/access-denied" element={<AccessDenied />} />

      {/* /dashboard: canonical route for Super Admin and Admin roles */}
      <Route element={<ProtectedRoute />}>
        <Route element={<DashboardLayout />}>
          <Route path="/dashboard" element={<Navigate to="/state-admin/dashboard" replace />} />
        </Route>
      </Route>

      {/* Protected Dashboards Layout */}
      <Route element={<ProtectedRoute />}>
        <Route element={<DashboardLayout />}>

          {/* Super Admin routes redirect to State Admin dashboard */}
          <Route path="/super-admin/*" element={<Navigate to="/state-admin/dashboard" replace />} />

          {/* State Admin Routes */}
          <Route element={<RoleBasedRoute allowedRoles={['State Admin']} />}>
            <Route path="/state-admin/dashboard" element={<StateAdminDashboard />} />
            <Route path="/state-admin/states-overview" element={<StatesOverview />} />
            <Route path="/state-admin/districts" element={<StateDistricts />} />
            <Route path="/state-admin/district-admins" element={<Navigate to="/state-admin/districts" replace />} />
            <Route path="/state-admin/district-details" element={<Navigate to="/state-admin/districts" replace />} />
            <Route path="/state-admin/divisions" element={<StateDivisions />} />
            <Route path="/state-admin/division-admins" element={<Navigate to="/state-admin/divisions" replace />} />
            <Route path="/state-admin/division-details" element={<Navigate to="/state-admin/divisions" replace />} />
            <Route path="/state-admin/pincodes" element={<StatePincodes />} />
            <Route path="/state-admin/pincode-admins" element={<Navigate to="/state-admin/pincodes" replace />} />
            <Route path="/state-admin/pincode-details" element={<Navigate to="/state-admin/pincodes" replace />} />
            <Route path="/state-admin/customers" element={<StateCustomers />} />
            <Route path="/state-admin/membership-cards" element={<StateMembershipCards />} />
            <Route path="/state-admin/vendors" element={<StateVendors />} />
            <Route path="/state-admin/vendors/requests" element={<VendorRequestsPage />} />
            <Route path="/state-admin/vendor-subscriptions" element={<StateVendorSubscriptions />} />
            <Route path="/state-admin/vendor-payments" element={<StateVendorPayments />} />
            <Route path="/state-admin/orders" element={<StateOrders />} />
            <Route path="/state-admin/bookings" element={<StateBookings />} />
            <Route path="/state-admin/jobs" element={<StateJobs />} />
            <Route path="/state-admin/delivery-partners" element={<StateDeliveryPartners />} />
            <Route path="/state-admin/technicians" element={<StateTechnicians />} />
            <Route path="/state-admin/executives" element={<StateExecutives />} />
            <Route path="/state-admin/support-team" element={<StateSupportTeam />} />
            <Route path="/state-admin/managers" element={<StateManagers level="state" />} />
            <Route path="/state-admin/managers/state" element={<StateManagers level="state" />} />
            <Route path="/state-admin/managers/district" element={<StateManagers level="district" />} />
            <Route path="/state-admin/managers/divisional" element={<StateManagers level="divisional" />} />
            <Route path="/state-admin/managers/pincode" element={<StateManagers level="pincode" />} />
            <Route path="/state-admin/managers/requests" element={<ManagerRequestsPage />} />
            <Route path="/state-admin/agents" element={<StateAgents level="state" />} />
            <Route path="/state-admin/agents/state" element={<StateAgents level="state" />} />
            <Route path="/state-admin/agents/district" element={<StateAgents level="district" />} />
            <Route path="/state-admin/agents/divisional" element={<StateAgents level="divisional" />} />
            <Route path="/state-admin/agents/pincode" element={<StateAgents level="pincode" />} />
            <Route path="/state-admin/agents/requests" element={<AgentRequestsPage />} />
            <Route path="/state-admin/agent-payments" element={<StateAgentPayments />} />
            <Route path="/state-admin/kyc" element={<StateKYC />} />
            <Route path="/state-admin/quality-check" element={<StateQualityCheck />} />
            <Route path="/state-admin/payments" element={<StatePayments />} />
            <Route path="/state-admin/reports" element={<StateReports />} />
            <Route path="/state-admin/tasks" element={<StateTasks />} />
            <Route path="/state-admin/queries" element={<StateQueries />} />
            <Route path="/state-admin/notifications" element={<NotificationsPage />} />
            <Route path="/state-admin/profile" element={<StateProfile />} />
            <Route path="/state-admin/settings" element={<StateSettings />} />
          </Route>

          {/* District Admin Routes */}
          <Route element={<RoleBasedRoute allowedRoles={['District Admin']} />}>
            <Route path="/district-admin/dashboard" element={<DistrictAdminDashboard />} />
            <Route path="/district-admin/overview" element={<Navigate to="/district-admin/dashboard" replace />} />
            <Route path="/district-admin/divisions" element={<DistrictDivisions />} />
            <Route path="/district-admin/division-admins" element={<Navigate to="/district-admin/divisions" replace />} />
            <Route path="/district-admin/division-details" element={<Navigate to="/district-admin/divisions" replace />} />
            <Route path="/district-admin/pincodes" element={<DistrictPincodes />} />
            <Route path="/district-admin/pincode-admins" element={<Navigate to="/district-admin/pincodes" replace />} />
            <Route path="/district-admin/pincode-details" element={<Navigate to="/district-admin/pincodes" replace />} />
            <Route path="/district-admin/customers" element={<DistrictCustomers />} />
            <Route path="/district-admin/membership-cards" element={<DistrictMembershipCards />} />
            <Route path="/district-admin/vendors" element={<DistrictVendors />} />
            <Route path="/district-admin/vendors/requests" element={<VendorRequestsPage />} />
            <Route path="/district-admin/vendor-subscriptions" element={<DistrictVendorSubscriptions />} />
            <Route path="/district-admin/vendor-payments" element={<DistrictVendorPayments />} />
            <Route path="/district-admin/orders" element={<DistrictOrders />} />
            <Route path="/district-admin/bookings" element={<DistrictBookings />} />
            <Route path="/district-admin/jobs" element={<DistrictJobs />} />
            <Route path="/district-admin/delivery-partners" element={<DistrictDeliveryPartners />} />
            <Route path="/district-admin/technicians" element={<DistrictTechnicians />} />
            <Route path="/district-admin/executives" element={<DistrictExecutives />} />
            <Route path="/district-admin/support-team" element={<DistrictSupportTeam />} />
            <Route path="/district-admin/managers" element={<StateManagers level="district" />} />
            <Route path="/district-admin/managers/district" element={<StateManagers level="district" />} />
            <Route path="/district-admin/managers/divisional" element={<StateManagers level="divisional" />} />
            <Route path="/district-admin/managers/pincode" element={<StateManagers level="pincode" />} />
            <Route path="/district-admin/managers/requests" element={<ManagerRequestsPage />} />
            <Route path="/district-admin/agents" element={<DistrictAgents level="district" />} />
            <Route path="/district-admin/agents/state" element={<DistrictAgents level="state" />} />
            <Route path="/district-admin/agents/district" element={<DistrictAgents level="district" />} />
            <Route path="/district-admin/agents/divisional" element={<DistrictAgents level="divisional" />} />
            <Route path="/district-admin/agents/pincode" element={<DistrictAgents level="pincode" />} />
            <Route path="/district-admin/agents/requests" element={<AgentRequestsPage />} />
            <Route path="/district-admin/agent-payments" element={<DistrictAgentPayments />} />
            <Route path="/district-admin/kyc" element={<DistrictKYC />} />
            <Route path="/district-admin/quality-check" element={<DistrictQualityCheck />} />
            <Route path="/district-admin/reports" element={<DistrictReports />} />
            <Route path="/district-admin/payments" element={<DistrictPayments />} />
            <Route path="/district-admin/tasks" element={<DistrictTasks />} />
            <Route path="/district-admin/queries" element={<DistrictQueries />} />
            <Route path="/district-admin/notifications" element={<NotificationsPage />} />
            <Route path="/district-admin/profile" element={<DistrictProfile />} />
            <Route path="/district-admin/settings" element={<DistrictSettings />} />
          </Route>

          {/* Divisional Admin Routes */}
          <Route element={<RoleBasedRoute allowedRoles={['Divisional Admin', 'Division Admin']} />}>
            <Route path="/divisional-admin/dashboard" element={<DivisionalAdminDashboard />} />
            <Route path="/divisional-admin/overview" element={<DivisionalOverview />} />
            <Route path="/divisional-admin/pincodes" element={<DivisionalPincodes />} />
            <Route path="/divisional-admin/pincode-admins" element={<Navigate to="/divisional-admin/pincodes" replace />} />
            <Route path="/divisional-admin/pincode-details" element={<Navigate to="/divisional-admin/pincodes" replace />} />
            <Route path="/divisional-admin/managers" element={<StateManagers level="divisional" />} />
            <Route path="/divisional-admin/managers/divisional" element={<StateManagers level="divisional" />} />
            <Route path="/divisional-admin/managers/pincode" element={<StateManagers level="pincode" />} />
            <Route path="/divisional-admin/managers/requests" element={<ManagerRequestsPage />} />
            <Route path="/divisional-admin/agents" element={<DistrictAgents level="divisional" />} />
            <Route path="/divisional-admin/agents/state" element={<DistrictAgents level="state" />} />
            <Route path="/divisional-admin/agents/district" element={<DistrictAgents level="district" />} />
            <Route path="/divisional-admin/agents/divisional" element={<DistrictAgents level="divisional" />} />
            <Route path="/divisional-admin/agents/pincode" element={<DistrictAgents level="pincode" />} />
            <Route path="/divisional-admin/agents/requests" element={<AgentRequestsPage />} />
            <Route path="/divisional-admin/agent-payments" element={<DivisionalAgentPayments />} />
            <Route path="/divisional-admin/customers" element={<DivisionalCustomers />} />
            <Route path="/divisional-admin/membership-cards" element={<DivisionalMembershipCards />} />
            <Route path="/divisional-admin/vendors" element={<DivisionalVendors />} />
            <Route path="/divisional-admin/vendors/requests" element={<VendorRequestsPage />} />
            <Route path="/divisional-admin/vendor-subscriptions" element={<DivisionalVendorSubscriptions />} />
            <Route path="/divisional-admin/vendor-payments" element={<DivisionalVendorPayments />} />
            <Route path="/divisional-admin/orders" element={<DivisionalOrders />} />
            <Route path="/divisional-admin/bookings" element={<DivisionalBookings />} />
            <Route path="/divisional-admin/jobs" element={<DivisionalJobs />} />
            <Route path="/divisional-admin/delivery-partners" element={<DivisionalDeliveryPartners />} />
            <Route path="/divisional-admin/technicians" element={<DivisionalTechnicians />} />
            <Route path="/divisional-admin/executives" element={<DivisionalExecutives />} />
            <Route path="/divisional-admin/support-team" element={<DivisionalSupportTeam />} />
            <Route path="/divisional-admin/kyc" element={<DivisionalKYC />} />
            <Route path="/divisional-admin/quality-check" element={<DivisionalQualityCheck />} />
            <Route path="/divisional-admin/payments" element={<DivisionalPayments />} />
            <Route path="/divisional-admin/reports" element={<DivisionalReports />} />
            <Route path="/divisional-admin/tasks" element={<DivisionalTasks />} />
            <Route path="/divisional-admin/queries" element={<DivisionalQueries />} />
            <Route path="/divisional-admin/notifications" element={<NotificationsPage />} />
            <Route path="/divisional-admin/profile" element={<DivisionalProfile />} />
            <Route path="/divisional-admin/settings" element={<DivisionalSettings />} />
          </Route>

          {/* Division Admin URL Aliases */}
          <Route path="/division-admin/dashboard" element={<Navigate to="/divisional-admin/dashboard" replace />} />
          <Route path="/division-admin/*" element={<Navigate to="/divisional-admin/dashboard" replace />} />

          {/* Pincode Admin Routes */}
          <Route element={<RoleBasedRoute allowedRoles={['Pincode Admin']} />}>
            <Route path="/pincode-admin/dashboard" element={<PincodeAdminDashboard />} />
            <Route path="/pincode-admin/overview" element={<Navigate to="/pincode-admin/dashboard" replace />} />
            <Route path="/pincode-admin/customers" element={<PincodeCustomers />} />
            <Route path="/pincode-admin/membership-cards" element={<PincodeMembershipCards />} />
            <Route path="/pincode-admin/vendors" element={<PincodeVendors />} />
            <Route path="/pincode-admin/vendors/requests" element={<VendorRequestsPage />} />
            <Route path="/pincode-admin/vendor-subscriptions" element={<PincodeVendorSubscriptions />} />
            <Route path="/pincode-admin/vendor-details" element={<Navigate to="/pincode-admin/vendor-subscriptions" replace />} />
            <Route path="/pincode-admin/vendor-payments" element={<PincodeVendorPayments />} />
            <Route path="/pincode-admin/orders" element={<PincodeOrders />} />
            <Route path="/pincode-admin/bookings" element={<PincodeBookings />} />
            <Route path="/pincode-admin/jobs" element={<PincodeJobs />} />
            <Route path="/pincode-admin/delivery-partners" element={<PincodeDeliveryPartners />} />
            <Route path="/pincode-admin/technicians" element={<PincodeTechnicians />} />
            <Route path="/pincode-admin/executives" element={<PincodeExecutives />} />
            <Route path="/pincode-admin/support-team" element={<PincodeSupportTeam />} />
            <Route path="/pincode-admin/agents" element={<PincodeAgents />} />
            <Route path="/pincode-admin/agents/requests" element={<AgentRequestsPage />} />
            <Route path="/pincode-admin/agent-payments" element={<PincodeAgentPayments />} />
            <Route path="/pincode-admin/kyc" element={<PincodeKYC />} />
            <Route path="/pincode-admin/quality-check" element={<PincodeQualityCheck />} />
            <Route path="/pincode-admin/business-reports" element={<PincodeBusinessReports />} />
            <Route path="/pincode-admin/managers" element={<StateManagers level="pincode" />} />
            <Route path="/pincode-admin/managers/pincode" element={<StateManagers level="pincode" />} />
            <Route path="/pincode-admin/managers/requests" element={<ManagerRequestsPage />} />
            <Route path="/pincode-admin/pincode-manager" element={<Navigate to="/pincode-admin/managers" replace />} />
            <Route path="/pincode-admin/payments" element={<PincodePayments />} />
            <Route path="/pincode-admin/tasks" element={<PincodeTasks />} />
            <Route path="/pincode-admin/queries" element={<PincodeQueries />} />
            <Route path="/pincode-admin/notifications" element={<NotificationsPage />} />
            <Route path="/pincode-admin/profile" element={<PincodeProfile />} />
            <Route path="/pincode-admin/settings" element={<PincodeSettings />} />
          </Route>

          {/* Common Admin Vendor Requests Route */}
          <Route path="/vendor-requests" element={<VendorRequestsPage />} />

          {/* Disallow Manager dashboard in Sub-Admin portal */}
          <Route path="/manager/*" element={<Navigate to="/access-denied" replace />} />

        </Route>
      </Route>

      {/* Fallback */}
      <Route path="*" element={<RootRedirect />} />
    </Routes>
    </React.Suspense>
  );
}
