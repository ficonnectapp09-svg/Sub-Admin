const { uploadFile } = require('../config/storage');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { db } = require('../config/db');
const { generateToken, JWT_SECRET } = require('../utils/jwt');
const { getMongoDb } = require('../config/mongo');
const { getAssignedPermissions } = require('../utils/permissions');
const { validateKycDocuments, formatCapitalizedName, validateName } = require('../utils/validation');
const {
  isRoleAuthorizedForApp,
  isAccountApproved,
  isAccountBlockedOrSuspended,
  AUTHORIZED_APP_ROLES,
  normalizeRoleName: normalizeAppRole
} = require('../config/appSecurity');

const ROLE_LIMITS = {
  state_manager: 25,     // 25 managers per State
  district_manager: 25,  // 25 managers per District
  division_manager: 25,  // 25 managers per Division
  pincode_manager: 50    // 50 managers per PIN Code
};

const ROLE_LEVELS = {
  'Super Admin': 0,
  'State Admin': 1,
  'District Admin': 2,
  'Divisional Admin': 3,
  'Division Admin': 3,
  'Pincode Admin': 4
};

// Authoritative role resolution: strictly maps only valid Sub-Admin management roles.
// Non-admin roles (Manager, Agent, Vendor, Customer, Staff) are strictly rejected (isAdmin: false).
const resolveAdminRole = (user) => {
  if (!user) return { role: '', level: 4, isAdmin: false };

  const rawRole = String(user.role || '').toLowerCase().replace(/_/g, ' ').replace(/-/g, ' ').trim();
  const adminRole = String(user.adminRole || '').toLowerCase().replace(/_/g, ' ').replace(/-/g, ' ').trim();
  const adminLevel = String(user.adminLevel || '').toLowerCase().replace(/_/g, ' ').replace(/-/g, ' ').trim();
  const levelStr = typeof user.level === 'string' ? user.level.toLowerCase().replace(/_/g, ' ').replace(/-/g, ' ').trim() : '';

  // Explicitly deny non-admin roles
  if (
    rawRole.includes('manager') ||
    rawRole.includes('agent') ||
    rawRole.includes('vendor') ||
    rawRole.includes('customer') ||
    rawRole === 'member' ||
    adminRole === 'staff'
  ) {
    return { role: user.role, level: 4, isAdmin: false };
  }

  // 1. Super Admin / Main Admin
  if (
    rawRole === 'super admin' || rawRole === 'main admin' || rawRole === 'superadmin' ||
    adminRole === 'super admin' || adminRole === 'main admin' ||
    adminLevel === 'super' || adminLevel === 'main' ||
    (rawRole === 'admin' && (adminRole === 'super admin' || (!adminRole && !user.assignedState && !user.state)))
  ) {
    return { role: 'Super Admin', level: 0, isAdmin: true };
  }

  // 2. State Admin (Must check State BEFORE Pincode/Division/District to prevent schema default corruption)
  if (
    rawRole === 'state admin' ||
    adminRole === 'state admin' ||
    adminLevel === 'state' ||
    levelStr === 'state' ||
    (rawRole === 'admin' && (adminRole === 'state admin' || (!adminRole && (user.assignedState || user.state) && !user.assignedDistrict && !user.district && !user.assignedDivision && !user.division && !user.assignedPincode && !user.pincode)))
  ) {
    return { role: 'State Admin', level: 1, isAdmin: true };
  }

  // 3. District Admin
  if (
    rawRole === 'district admin' ||
    adminRole === 'district admin' ||
    adminLevel === 'district' ||
    levelStr === 'district' ||
    (rawRole === 'admin' && (adminRole === 'district admin' || (!adminRole && (user.assignedDistrict || user.district) && !user.assignedDivision && !user.division && !user.assignedPincode && !user.pincode)))
  ) {
    return { role: 'District Admin', level: 2, isAdmin: true };
  }

  // 4. Divisional / Division Admin
  if (
    rawRole === 'divisional admin' || rawRole === 'division admin' ||
    adminRole === 'divisional admin' || adminRole === 'division admin' ||
    adminLevel === 'division' || adminLevel === 'divisional' ||
    levelStr === 'division' || levelStr === 'divisional' ||
    (rawRole === 'admin' && (adminRole.includes('divis') || adminLevel.includes('divis'))) ||
    (rawRole === 'admin' && (!adminRole && (user.assignedDivision || user.division) && !user.assignedPincode && !user.pincode))
  ) {
    return { role: 'Divisional Admin', level: 3, isAdmin: true };
  }

  // 5. Pincode Admin
  if (
    rawRole === 'pincode admin' ||
    adminRole === 'pincode admin' ||
    adminLevel === 'pincode' ||
    (rawRole === 'admin' && (adminRole === 'pincode admin' || user.assignedPincode || user.pincode))
  ) {
    return { role: 'Pincode Admin', level: 4, isAdmin: true };
  }

  // Fallback for generic 'admin' role
  if (rawRole === 'admin') {
    if (adminRole.includes('state') || adminLevel === 'state') return { role: 'State Admin', level: 1, isAdmin: true };
    if (adminRole.includes('dist') || adminLevel === 'district') return { role: 'District Admin', level: 2, isAdmin: true };
    if (adminRole.includes('divis') || adminLevel === 'division') return { role: 'Divisional Admin', level: 3, isAdmin: true };
    if (adminRole.includes('pincode') || adminLevel === 'pincode') return { role: 'Pincode Admin', level: 4, isAdmin: true };
    if (user.assignedState || user.state) return { role: 'State Admin', level: 1, isAdmin: true };
    return { role: 'Super Admin', level: 0, isAdmin: true };
  }

  return { role: user.role, level: 4, isAdmin: false };
};


// Calculate occupancy for a location and role
const getOccupancy = async (role, { stateId, districtId, divisionId, pincodeId }) => {
  const users = await db.users.find();
  const occupiedUsers = users.filter(u => u.status === 'active' || u.status === 'approved');
  const limit = ROLE_LIMITS[role] || 5;

  if (role === 'state_manager') {
    if (!stateId) return { count: 0, limit, isFull: false, remaining: limit };
    const matches = occupiedUsers.filter(u => u.role === 'state_manager' && u.stateId === stateId);
    return { count: matches.length, limit, isFull: matches.length >= limit, remaining: Math.max(0, limit - matches.length) };
  }

  if (role === 'district_manager') {
    if (!districtId) return { count: 0, limit, isFull: false, remaining: limit };
    const matches = occupiedUsers.filter(u => u.role === 'district_manager' && u.districtId === districtId);
    return { count: matches.length, limit, isFull: matches.length >= limit, remaining: Math.max(0, limit - matches.length) };
  }

  if (role === 'division_manager') {
    if (!divisionId) return { count: 0, limit, isFull: false, remaining: limit };
    const matches = occupiedUsers.filter(u => u.role === 'division_manager' && u.divisionId === divisionId);
    return { count: matches.length, limit, isFull: matches.length >= limit, remaining: Math.max(0, limit - matches.length) };
  }

  if (role === 'pincode_manager') {
    if (!pincodeId) return { count: 0, limit, isFull: false, remaining: limit };
    const matches = occupiedUsers.filter(u => u.role === 'pincode_manager' && u.pincodeId === pincodeId);
    return { count: matches.length, limit, isFull: matches.length >= limit, remaining: Math.max(0, limit - matches.length) };
  }

  return { count: 0, limit, isFull: false, remaining: limit };
};

// Helper: build normalized user profile matching both portals
const buildUserProfile = async (user) => {
  const [regionObj, state, district, division, pincode] = await Promise.all([
    (user.regionId || user.stateId) ? db.states.findById(user.regionId || user.stateId) : null,
    user.stateId ? db.states.findById(user.stateId) : null,
    user.districtId ? db.districts.findById(user.districtId) : null,
    user.divisionId ? db.divisions.findById(user.divisionId) : null,
    user.pincodeId ? db.pincodes.findById(user.pincodeId) : null
  ]);

  const stateName = user.state || user.assignedState || state?.name || null;
  const districtName = user.district || user.assignedDistrict || district?.name || null;
  const divisionName = user.division || user.assignedDivision || division?.name || null;
  const pincodeCode = user.pincode || user.assignedPincode || pincode?.code || null;
  const avatar = user.avatar || user.avatarUrl || null;
  const mobile = user.mobile || user.phone || null;
  const phone = user.phone || user.mobile || null;
  const status = user.status || 'PENDING_SUB_ADMIN_APPROVAL';
  const statusUpper = String(status).toUpperCase();
  const adminApprovalStatus = user.adminApprovalStatus || (statusUpper === 'PENDING_KYC_APPROVAL' || statusUpper === 'PENDING_KYC' ? 'approved' : statusUpper === 'ACTIVE' || statusUpper === 'APPROVED' ? 'approved' : statusUpper === 'REJECTED' ? 'rejected' : 'pending');
  const kycStatus = user.kycStatus || (statusUpper === 'ACTIVE' || statusUpper === 'APPROVED' ? 'Verified' : statusUpper === 'REJECTED' ? 'Rejected' : 'pending_verification');
  const isFullyApproved = (statusUpper === 'ACTIVE' || statusUpper === 'APPROVED') &&
    String(adminApprovalStatus).toLowerCase() === 'approved' &&
    (String(kycStatus).toLowerCase() === 'verified' || String(kycStatus).toLowerCase() === 'approved') &&
    user.isActive === true;

  return {
    id: user._id || user.id,
    _id: user._id || user.id,
    subAdminId: user.subAdminId || user.id || user._id,
    name: user.name,
    username: user.username || user.loginId || user.email,
    email: user.email,
    mobile,
    phone,
    alternateMobile: user.alternateMobile || user.altPhone || null,
    role: user.role,
    adminRole: user.adminRole || user.role,
    level: user.level || ROLE_LEVELS[user.role] || 1,
    permissions: user.permissions && Array.isArray(user.permissions) && user.permissions.length > 0
      ? user.permissions
      : getAssignedPermissions(user.role),
    status,
    adminApprovalStatus,
    kycStatus,
    isActive: Boolean(user.isActive),
    requiresApproval: !isFullyApproved,
    isFullyApproved,
    targetAdminRole: user.targetAdminRole || null,
    targetAdminId: user.targetAdminId || user.assignedAdminId || null,
    targetAdminName: user.targetAdminName || null,
    targetJurisdiction: user.targetJurisdiction || null,
    routingIssue: user.routingIssue || null,
    dob: user.dob || null,
    gender: user.gender || null,
    address: user.address || null,
    city: user.city || user.town || null,
    documents: user.documents || {},
    bankName: user.bankName || (user.bankDetails && user.bankDetails.bankName) || null,
    branchName: user.branchName || (user.bankDetails && user.bankDetails.branchName) || null,
    accountHolderName: user.accountHolderName || (user.bankDetails && user.bankDetails.accountHolderName) || null,
    accountNumber: (user.accountNumber || (user.bankDetails && user.bankDetails.accountNumber)) ? String(user.accountNumber || (user.bankDetails && user.bankDetails.accountNumber)) : null,
    ifscCode: user.ifscCode || (user.bankDetails && user.bankDetails.ifscCode) || null,
    aadharNumber: user.aadharNumber || user.aadhaarNumber || null,
    panNumber: user.panNumber || null,
    parentAdminId: user.parentAdminId || user.onboardedBy || null,
    parentAdminName: user.parentAdminName || user.onboardedByName || null,
    parentAdminRole: user.parentAdminRole || user.onboardedByRole || null,
    onboardedByName: user.onboardedByName || user.parentAdminName || null,
    onboardedByRole: user.onboardedByRole || user.parentAdminRole || null,
    createdAt: user.createdAt || null,
    updatedAt: user.updatedAt || null,
    avatar,
    avatarUrl: avatar,
    state: stateName,
    district: districtName,
    division: divisionName,
    pincode: pincodeCode,
    stateId: user.stateId || (state ? state._id : null),
    districtId: user.districtId || (district ? district._id : null),
    divisionId: user.divisionId || (division ? division._id : null),
    pincodeId: user.pincodeId || (pincode ? pincode._id : null),
    regionId: user.regionId || user.stateId,
    scope: {
      regionId: user.regionId || user.stateId,
      regionName: regionObj?.name || stateName,
      stateId: user.stateId || (state ? state._id : null),
      stateName,
      districtId: user.districtId || (district ? district._id : null),
      districtName,
      divisionId: user.divisionId || (division ? division._id : null),
      divisionName,
      pincodeId: user.pincodeId || (pincode ? pincode._id : null),
      pincodeCode,
      pincodeArea: pincode?.areaName || null
    }
  };
};

// Universal Login: accepts email or mobile / identifier / loginId
const login = async (req, res) => {
  try {
    const { email, identifier, loginId: rawLoginId, username, password } = req.body;
    const rawId = (identifier || email || rawLoginId || username || '').trim();
    const loginId = rawId.toLowerCase();

    if (!rawId || !password) {
      return res.status(400).json({ success: false, message: 'Please provide email or mobile number, and password.' });
    }

    const phoneDigits = rawId.replace(/[^0-9]/g, '');
    const isPhone = phoneDigits.length >= 10;

    let matchedUsers = [];

    // 1. Primary lookup: Check MongoDB Atlas users collection
    try {
      const mdb = await getMongoDb();
      if (mdb) {
        const safeRegex = new RegExp("^" + loginId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$", "i");
        const queryConditions = [
          { email: loginId },
          { email: safeRegex },
          { loginId: rawId },
          { loginId: loginId },
          { registrationId: rawId },
          { registrationId: loginId },
          { username: loginId },
          { username: rawId }
        ];
        if (isPhone) {
          queryConditions.push({ phone: rawId });
          queryConditions.push({ phone: phoneDigits.slice(-10) });
          queryConditions.push({ mobile: rawId });
          queryConditions.push({ mobile: phoneDigits.slice(-10) });
        }
        const mMatches = await mdb.collection("users").find({ $or: queryConditions }).toArray();
        if (mMatches && mMatches.length > 0) {
          matchedUsers.push(...mMatches);
        }
      }
    } catch (mErr) {
      console.warn("MongoDB lookup in login warning:", mErr.message);
    }

    // 2. Lookup in memory users collection loaded from MongoDB
    if (db.users) {
      const allUsers = Array.from(db.users);
      const localMatches = allUsers.filter(u => 
        (u.email && u.email.toLowerCase() === loginId) ||
        (u.loginId && (u.loginId.toLowerCase() === loginId || u.loginId === rawId)) ||
        (u.registrationId && (u.registrationId.toLowerCase() === loginId || u.registrationId === rawId)) ||
        (isPhone && u.mobile && u.mobile.replace(/[^0-9]/g, '').slice(-10) === phoneDigits.slice(-10)) ||
        (isPhone && u.phone && u.phone.replace(/[^0-9]/g, '').slice(-10) === phoneDigits.slice(-10)) ||
        (u.id && String(u.id).toLowerCase() === loginId) ||
        (u._id && String(u._id).toLowerCase() === loginId)
      );
      for (const lm of localMatches) {
        if (!matchedUsers.some(u => String(u._id || u.id) === String(lm._id || lm.id))) {
          matchedUsers.push(lm);
        }
      }
    }



    // Check db.agents and db.managers for multi-account awareness
    if (db.agents) {
      const agentMatches = Array.from(db.agents).filter(a =>
        (a.email && a.email.toLowerCase() === loginId) ||
        (isPhone && a.phone && a.phone.replace(/[^0-9]/g, '').slice(-10) === phoneDigits.slice(-10))
      );
      for (const am of agentMatches) {
        if (!matchedUsers.some(u => String(u._id || u.id) === String(am._id || am.id))) {
          matchedUsers.push({ ...am, role: am.role || 'Agent' });
        }
      }
    }
    if (db.managers) {
      const mgrMatches = Array.from(db.managers).filter(m =>
        (m.email && m.email.toLowerCase() === loginId) ||
        (isPhone && m.phone && m.phone.replace(/[^0-9]/g, '').slice(-10) === phoneDigits.slice(-10))
      );
      for (const mm of mgrMatches) {
        if (!matchedUsers.some(u => String(u._id || u.id) === String(mm._id || mm.id))) {
          matchedUsers.push({ ...mm, role: mm.role || 'Manager' });
        }
      }
    }

    if (matchedUsers.length === 0) {
      console.warn(`[AUTH] Failed login: User identifier '${loginId}' not found.`);
      return res.status(401).json({ success: false, code: 'INVALID_CREDENTIALS', message: 'Invalid credentials' });
    }

    // 3. Strict Application Context & Role Filtering:
    // Filter matching accounts to find an account authorized for THIS application
    const authorizedAdminAccount = matchedUsers.find(u => {
      const adminInfo = resolveAdminRole(u);
      return adminInfo.isAdmin && isRoleAuthorizedForApp(u);
    });

    // If an authorized admin account exists under this email/loginId
    let user = authorizedAdminAccount;

    // If NO authorized admin account exists under this identifier, but other roles (Manager, Agent, Vendor, Customer) do:
    if (!user) {
      const nonAdminAccount = matchedUsers[0];
      const attemptedRole = nonAdminAccount?.role || nonAdminAccount?.adminRole || 'User';
      const nonAdminStatus = String(nonAdminAccount?.status || '').toLowerCase().trim();
      if (nonAdminStatus === 'suspended') {
        return res.status(403).json({
          success: false,
          code: 'ACCOUNT_SUSPENDED',
          message: 'Your account has been suspended. Please contact your administrator for assistance.'
        });
      }
      if (nonAdminStatus === 'deleted' || nonAdminStatus === 'deactivated' || nonAdminAccount?.isDeleted === true) {
        return res.status(403).json({
          success: false,
          code: 'ACCOUNT_DEACTIVATED',
          message: 'Your account has been deactivated and access is no longer available. Please contact your administrator if you believe this is an error.'
        });
      }
      console.warn(`[AUTH] Cross-Role Access Denied: User '${rawId}' has role '${attemptedRole}' which is not authorized for Sub-Admin portal.`);
      return res.status(403).json({
        success: false,
        code: 'UNAUTHORIZED_APPLICATION_ROLE',
        message: 'Invalid credentials'
      });
    }

    // 4. Authoritative Password Verification
    let isMatch = false;
    const userHash = String(user.passwordHash || user.hash || user.hashedPassword || user.password || '').trim();
    if (userHash && (userHash.startsWith('$2a$') || userHash.startsWith('$2b$') || userHash.startsWith('$2y$'))) {
      try {
        isMatch = bcrypt.compareSync(password, userHash) || (typeof password === 'string' && bcrypt.compareSync(password.trim(), userHash));
      } catch (e) {}
    }

    const rawPassword = user.password || user.tempPassword || user.plainPassword || user.pass;
    if (!isMatch && rawPassword) {
      const cleanRaw = typeof rawPassword === 'string' ? rawPassword.trim() : rawPassword;
      if (typeof cleanRaw === 'string' && (cleanRaw.startsWith('$2a$') || cleanRaw.startsWith('$2b$') || cleanRaw.startsWith('$2y$'))) {
        try {
          isMatch = bcrypt.compareSync(password, cleanRaw) || (typeof password === 'string' && bcrypt.compareSync(password.trim(), cleanRaw));
        } catch (e) {}
      } else if (rawPassword === password || rawPassword === password.trim() || cleanRaw === password || cleanRaw === password.trim()) {
        isMatch = true;
      }
    }



    if (!isMatch) {
      console.warn(`[AUTH] Failed login: Incorrect password for user '${user.email || loginId}'.`);
      return res.status(401).json({ success: false, code: 'INVALID_CREDENTIALS', message: 'Invalid credentials' });
    }

    // 5. Authoritative Role Resolution
    const roleInfo = resolveAdminRole(user);
    if (!roleInfo.isAdmin || !isRoleAuthorizedForApp(user)) {
      return res.status(403).json({
        success: false,
        code: 'UNAUTHORIZED_APPLICATION_ROLE',
        message: 'Invalid credentials'
      });
    }

    // 6. Strict Account Status Gate (Suspended, Blocked, Revoked, Inactive, Rejected, Deleted)
    if (isAccountBlockedOrSuspended(user)) {
      const currentStatus = String(user.status || 'inactive').toLowerCase();
      if (currentStatus === 'suspended') {
        console.warn(`[AUTH] Access denied: User '${user.email || loginId}' is suspended.`);
        return res.status(403).json({
          success: false,
          code: 'ACCOUNT_SUSPENDED',
          message: 'Your account has been suspended. Please contact your administrator for assistance.'
        });
      }
      if (currentStatus === 'deleted' || currentStatus === 'deactivated' || user.isDeleted === true) {
        console.warn(`[AUTH] Access denied: User '${user.email || loginId}' is deactivated/deleted.`);
        return res.status(403).json({
          success: false,
          code: 'ACCOUNT_DEACTIVATED',
          message: 'Your account has been deactivated and access is no longer available. Please contact your administrator if you believe this is an error.'
        });
      }
      console.warn(`[AUTH] Access denied: User '${user.email || loginId}' account status is '${currentStatus}'.`);
      return res.status(403).json({
        success: false,
        code: 'ACCOUNT_STATUS_REVOKED',
        message: `Access denied: Your account has been suspended or deactivated (${currentStatus}). Please contact Super Admin support.`
      });
    }

    // Territory Synchronization & User Mapping
    const finalState = user.state || user.assignedState || '';
    const finalDistrict = user.district || user.assignedDistrict || '';
    const finalDivision = user.division || user.assignedDivision || '';
    const finalPincode = user.pincode || user.assignedPincode || '';

    const mappedUser = {
      ...user,
      _id: user._id || user.id,
      id: user._id || user.id,
      role: roleInfo.role,
      level: roleInfo.level,
      state: finalState,
      assignedState: finalState,
      district: finalDistrict,
      assignedDistrict: finalDistrict,
      division: finalDivision,
      assignedDivision: finalDivision,
      pincode: finalPincode,
      assignedPincode: finalPincode,
      mobile: user.mobile || user.phone || '',
      phone: user.phone || user.mobile || ''
    };

    const userProfile = await buildUserProfile(mappedUser);

    // 7. Strict Approval Gate: Never auto-approve on login
    const isApproved = isAccountApproved(user);
    if (!isApproved) {
      console.warn(`[AUTH] Approval Gate: User '${user.email || loginId}' status is '${user.status || 'pending'}'. Dashboard access denied.`);
      
      // Issue ONLY a restricted-scope pending token (never a dashboard-authorized token)
      const pendingToken = generateToken({
        _id: mappedUser._id,
        id: mappedUser._id,
        email: mappedUser.email,
        role: mappedUser.role,
        scope: 'pending_registration',
        requiresApproval: true
      });

      return res.status(200).json({
        success: true,
        requiresApproval: true,
        isFullyApproved: false,
        status: user.status || 'PENDING_SUB_ADMIN_APPROVAL',
        adminApprovalStatus: user.adminApprovalStatus || 'pending',
        kycStatus: user.kycStatus || 'pending_verification',
        message: 'Account registration is awaiting administrative approval.',
        token: pendingToken,
        user: {
          ...userProfile,
          requiresApproval: true,
          isFullyApproved: false
        }
      });
    }

    // 8. Fully Approved & Active Administrator: Issue Dashboard Access Token
    mappedUser.status = 'active';
    mappedUser.isActive = true;
    mappedUser.requiresApproval = false;
    mappedUser.isFullyApproved = true;

    const token = generateToken({
      ...mappedUser,
      scope: 'dashboard_access',
      requiresApproval: false
    });

    return res.json({
      success: true,
      requiresApproval: false,
      isFullyApproved: true,
      message: 'Welcome ' + (mappedUser.name || 'Admin') + '. Logged in successfully.',
      token,
      user: {
        ...userProfile,
        requiresApproval: false,
        isFullyApproved: true
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ success: false, message: 'Login failed', error: err.message });
  }
};

const getMe = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    let user = null;

    try {
      const mdb = await getMongoDb();
      if (mdb) {
        const { ObjectId } = require('mongodb');
        try {
          user = await mdb.collection('users').findOne({ _id: new ObjectId(userId) });
        } catch (e) {
          user = await mdb.collection('users').findOne({ _id: String(userId) });
        }
      }
    } catch (mErr) {
      console.warn('MongoDB getMe lookup warning:', mErr.message);
    }

    if (!user) {
      const allUsers = Array.from(db.users);
      user = allUsers.find(u => String(u._id || u.id) === String(userId));
    }

    if (!user && db.agents) {
      user = Array.from(db.agents).find(u => String(u._id || u.id) === String(userId));
    }

    if (!user && db.managers) {
      user = Array.from(db.managers).find(u => String(u._id || u.id) === String(userId));
    }

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Role check: Strictly enforce application role authorization
    const roleInfo = resolveAdminRole(user);
    if (!roleInfo.isAdmin || !isRoleAuthorizedForApp(user)) {
      return res.status(403).json({
        success: false,
        code: 'UNAUTHORIZED_APPLICATION_ROLE',
        message: 'Your account does not have permission to access this application.'
      });
    }

    // Status check (Suspended, Blocked, Revoked, Inactive, Rejected)
    if (isAccountBlockedOrSuspended(user)) {
      const currentStatus = (user.status || 'inactive').toLowerCase().trim();
      return res.status(403).json({
        success: false,
        code: 'ACCOUNT_STATUS_REVOKED',
        status: currentStatus,
        message: 'Your account is currently ' + currentStatus.replace(/_/g, ' ') + '. Access is disabled.'
      });
    }

    const isApproved = isAccountApproved(user);

    const finalState = user.state || user.assignedState || '';
    const finalDistrict = user.district || user.assignedDistrict || '';
    const finalDivision = user.division || user.assignedDivision || '';
    const finalPincode = user.pincode || user.assignedPincode || '';

    const mappedUser = {
      ...user,
      _id: user._id || user.id,
      id: user._id || user.id,
      role: roleInfo.role,
      level: roleInfo.level,
      status: isApproved ? 'active' : (user.status || 'PENDING_SUB_ADMIN_APPROVAL'),
      isActive: isApproved,
      requiresApproval: !isApproved,
      isFullyApproved: isApproved,
      state: finalState,
      assignedState: finalState,
      district: finalDistrict,
      assignedDistrict: finalDistrict,
      division: finalDivision,
      assignedDivision: finalDivision,
      pincode: finalPincode,
      assignedPincode: finalPincode,
      mobile: user.mobile || user.phone || '',
      phone: user.phone || user.mobile || ''
    };

    const profile = await buildUserProfile(mappedUser);
    return res.json({
      success: true,
      requiresApproval: !isApproved,
      isFullyApproved: isApproved,
      user: {
        ...profile,
        requiresApproval: !isApproved,
        isFullyApproved: isApproved
      }
    });
  } catch (err) {
    console.error('Get profile error:', err);
    return res.status(500).json({ success: false, message: 'Failed to retrieve profile', error: err.message });
  }
};

const getDemoAdmins = (req, res) => {
  const demoList = db.admins.map(a => ({
    id: a.id || a._id,
    name: a.name,
    email: a.email,
    role: a.role,
    state: a.state,
    district: a.district,
    division: a.division,
    pincode: a.pincode,
    avatar: a.avatar || a.avatarUrl
  }));

  return res.json({ success: true, admins: demoList });
};

const register = async (req, res) => {
  try {
    let {
      name,
      fullName,
      email,
      mobile,
      phone,
      password,
      role,
      dob,
      gender,
      address,
      documents,
      declarationAccepted,
      stateId,
      zone,
      districtId,
      divisionId,
      pincodeId,
      state,
      district,
      division,
      pincode,
      avatarUrl
    } = req.body;

    name = formatCapitalizedName(name || fullName || '');
    mobile = (mobile || phone || '').trim();

    if (!stateId && (state || zone)) {
      const stName = (state || zone || '').toLowerCase();
      const sObj = Array.from(db.states).find(s => s.name?.toLowerCase() === stName);
      if (sObj) stateId = sObj._id || sObj.id;
    }
    if (!districtId && district) {
      const distName = district.toLowerCase();
      const dObj = Array.from(db.districts).find(d => d.name?.toLowerCase() === distName);
      if (dObj) districtId = dObj._id || dObj.id;
    }
    if (!divisionId && division) {
      const divName = division.toLowerCase();
      const divObj = Array.from(db.divisions).find(d => d.name?.toLowerCase() === divName);
      if (divObj) divisionId = divObj._id || divObj.id;
    }
    if (!pincodeId && pincode) {
      const pObj = Array.from(db.pincodes).find(p => String(p.code) === String(pincode));
      if (pObj) pincodeId = pObj._id || pObj.id;
    }

    if (!name || !email || !mobile || !password || !role) {
      return res.status(400).json({ success: false, message: 'Please provide all required fields: Full Name, Email, Mobile, Password, and Role.' });
    }

    if (req.body.documents || req.body.aadharNumber || req.body.aadhaarNumber || req.body.panNumber) {
      const kycErr = validateKycDocuments(req.body);
      if (kycErr) {
        return res.status(400).json({ success: false, message: kycErr });
      }
    }

    const normRole = (role || '').trim().toLowerCase().replace(/[\s-]/g, '_');
    const isManagerRole = ['state_manager', 'district_manager', 'division_manager', 'pincode_manager'].includes(normRole);
    const isAgentRole = ['state_agent', 'district_agent', 'division_agent', 'pincode_agent'].includes(normRole) || normRole === 'agent';
    const isVendorRole = ['vendor', 'seller', 'merchant'].includes(normRole);
    const effectiveRole = isAgentRole && normRole === 'agent'
      ? (pincodeId || pincode ? 'pincode_agent' : divisionId || division ? 'division_agent' : districtId || district ? 'district_agent' : 'state_agent')
      : (isVendorRole ? 'vendor' : normRole);

    if (!isManagerRole && !isAgentRole && !isVendorRole) {
      return res.status(400).json({ success: false, message: 'Invalid role selected. Must be a valid Manager, Agent, or Vendor role.' });
    }

    const isStateLevel = effectiveRole === 'state_manager' || effectiveRole === 'state_agent';
    const isDistrictLevel = effectiveRole === 'district_manager' || effectiveRole === 'district_agent';
    const isDivisionLevel = effectiveRole === 'division_manager' || effectiveRole === 'division_agent';
    const isPincodeLevel = effectiveRole === 'pincode_manager' || effectiveRole === 'pincode_agent';

    if (isVendorRole && (!stateId && !state && !districtId && !district && !pincodeId && !pincode)) {
      return res.status(400).json({ success: false, message: 'Location information (State, District, or PIN Code) is required for Vendor registration.' });
    }
    if (isStateLevel && !stateId && !state) {
      return res.status(400).json({ success: false, message: `State selection is required for ${effectiveRole.replace('_', ' ')}.` });
    }
    if (isDistrictLevel && (!stateId && !state || !districtId && !district)) {
      return res.status(400).json({ success: false, message: `State and District selections are required for ${effectiveRole.replace('_', ' ')}.` });
    }
    if (isDivisionLevel && (!stateId && !state || !districtId && !district || !divisionId && !division)) {
      return res.status(400).json({ success: false, message: `State, District, and Division selections are required for ${effectiveRole.replace('_', ' ')}.` });
    }
    if (isPincodeLevel && (!stateId && !state || !districtId && !district || !divisionId && !division || !pincodeId && !pincode)) {
      return res.status(400).json({ success: false, message: `State, District, Division, and PIN Code selections are required for ${effectiveRole.replace('_', ' ')}.` });
    }

    const existingEmail = await db.users.findOne({ email: email.trim().toLowerCase() });
    if (existingEmail) {
      return res.status(400).json({ success: false, message: 'An account with this email address already exists. Please sign in or use another email.' });
    }

    const existingMobile = await db.users.findOne({ mobile: mobile.trim() });
    if (existingMobile) {
      return res.status(400).json({ success: false, message: 'An account with this mobile number already exists. Please sign in or use another mobile number.' });
    }

    if (isManagerRole) {
      const occupancy = await getOccupancy(effectiveRole, { stateId, districtId, divisionId, pincodeId });
      if (occupancy.isFull) {
        return res.status(400).json({
          success: false,
          limitReached: true,
          message: `This place has reached its maximum manager capacity (${occupancy.count}/${occupancy.limit}). Registration not allowed for this location.`
        });
      }
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const level = ROLE_LEVELS[effectiveRole] || (isStateLevel ? 1 : isDistrictLevel ? 2 : isDivisionLevel ? 3 : 4);

    const [selectedState, selectedDistrict, selectedDivision, selectedPincode] = await Promise.all([
      stateId ? db.states.findById(stateId) : null,
      districtId ? db.districts.findById(districtId) : null,
      divisionId ? db.divisions.findById(divisionId) : null,
      pincodeId ? db.pincodes.findById(pincodeId) : null
    ]);

    const stateName = selectedState?.name || req.body.state || null;
    const districtName = selectedDistrict?.name || req.body.district || null;
    const divisionName = selectedDivision?.name || req.body.division || null;
    const pincodeCode = selectedPincode?.code || req.body.pincode || null;

    // Resolve the related administrator for this role and jurisdiction
    let targetAdminRole = null;
    let targetJurisdiction = null;
    let relatedAdmin = null;

    const allAdmins = Array.from(db.users).filter(u => (u.role || '').toLowerCase().includes('admin'));

    if (isStateLevel) {
      targetAdminRole = 'State Admin';
      targetJurisdiction = `State: ${stateName || stateId}`;
      relatedAdmin = allAdmins.find(a => 
        (a.role === 'State Admin' || (a.role || '').toLowerCase().includes('state')) &&
        ((a.stateId && stateId && String(a.stateId).toLowerCase() === String(stateId).toLowerCase()) ||
         (a.state && stateName && a.state.trim().toLowerCase() === stateName.trim().toLowerCase()))
      );
    } else if (isDistrictLevel) {
      targetAdminRole = 'District Admin';
      targetJurisdiction = `District: ${districtName || districtId}, ${stateName || stateId}`;
      relatedAdmin = allAdmins.find(a => 
        (a.role === 'District Admin' || (a.role || '').toLowerCase().includes('district')) &&
        ((a.districtId && districtId && String(a.districtId).toLowerCase() === String(districtId).toLowerCase()) ||
         (a.district && districtName && a.district.trim().toLowerCase() === districtName.trim().toLowerCase()) ||
         ((a.district === 'Salem' || a.districtId === 'dist_salem') && (districtId === 'dist_salem' || districtName === 'Salem')))
      );
    } else if (isDivisionLevel) {
      targetAdminRole = 'Divisional Admin';
      targetJurisdiction = `Division: ${divisionName || divisionId}, ${districtName || districtId}`;
      relatedAdmin = allAdmins.find(a => 
        (a.role === 'Divisional Admin' || a.role === 'Division Admin' || (a.role || '').toLowerCase().includes('division')) &&
        ((a.divisionId && divisionId && String(a.divisionId).toLowerCase() === String(divisionId).toLowerCase()) ||
         (a.division && divisionName && a.division.trim().toLowerCase() === divisionName.trim().toLowerCase()) ||
         ((a.division === 'Salem North' || a.divisionId === 'div_dist_salem_urban') && (divisionId === 'div_dist_salem_urban' || divisionName === 'Salem North')))
      );
    } else if (isPincodeLevel) {
      targetAdminRole = 'Pincode Admin';
      targetJurisdiction = `PIN: ${pincodeCode || pincodeId}`;
      relatedAdmin = allAdmins.find(a => 
        (a.role === 'Pincode Admin' || (a.role || '').toLowerCase().includes('pincode')) &&
        ((a.pincodeId && pincodeId && String(a.pincodeId).toLowerCase() === String(pincodeId).toLowerCase()) ||
         (a.pincode && pincodeCode && String(a.pincode).trim() === String(pincodeCode).trim()) ||
         (a.pincode && pincodeId && pincodeId === `pin_${String(a.pincode).trim()}`))
      );
    } else if (isVendorRole) {
      if (pincodeCode || pincodeId) {
        targetAdminRole = 'Pincode Admin';
        targetJurisdiction = `PIN: ${pincodeCode || pincodeId}`;
        relatedAdmin = allAdmins.find(a => 
          (a.role === 'Pincode Admin' || (a.role || '').toLowerCase().includes('pincode')) &&
          ((a.pincodeId && pincodeId && String(a.pincodeId).toLowerCase() === String(pincodeId).toLowerCase()) ||
           (a.pincode && pincodeCode && String(a.pincode).trim() === String(pincodeCode).trim()) ||
           (a.pincode && pincodeId && pincodeId === `pin_${String(a.pincode).trim()}`))
        );
      } else if (divisionName || divisionId) {
        targetAdminRole = 'Divisional Admin';
        targetJurisdiction = `Division: ${divisionName || divisionId}, ${districtName || districtId}`;
        relatedAdmin = allAdmins.find(a => 
          (a.role === 'Divisional Admin' || a.role === 'Division Admin' || (a.role || '').toLowerCase().includes('division')) &&
          ((a.divisionId && divisionId && String(a.divisionId).toLowerCase() === String(divisionId).toLowerCase()) ||
           (a.division && divisionName && a.division.trim().toLowerCase() === divisionName.trim().toLowerCase()))
        );
      } else if (districtName || districtId) {
        targetAdminRole = 'District Admin';
        targetJurisdiction = `District: ${districtName || districtId}, ${stateName || stateId}`;
        relatedAdmin = allAdmins.find(a => 
          (a.role === 'District Admin' || (a.role || '').toLowerCase().includes('district')) &&
          ((a.districtId && districtId && String(a.districtId).toLowerCase() === String(districtId).toLowerCase()) ||
           (a.district && districtName && a.district.trim().toLowerCase() === districtName.trim().toLowerCase()))
        );
      } else {
        targetAdminRole = 'State Admin';
        targetJurisdiction = `State: ${stateName || stateId}`;
        relatedAdmin = allAdmins.find(a => 
          (a.role === 'State Admin' || (a.role || '').toLowerCase().includes('state')) &&
          ((a.stateId && stateId && String(a.stateId).toLowerCase() === String(stateId).toLowerCase()) ||
           (a.state && stateName && a.state.trim().toLowerCase() === stateName.trim().toLowerCase()))
        );
      }
    }

    const routingIssue = !relatedAdmin ? `No matching ${targetAdminRole || 'Sub-admin'} found for territory: ${targetJurisdiction || 'unspecified'}` : null;
    const initialStatus = isVendorRole ? 'Under Review' : 'PENDING_SUB_ADMIN_APPROVAL';

    const newUser = await db.users.insertOne({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      mobile: mobile.trim(),
      phone: mobile.trim(),
      passwordHash,
      role,
      level,
      status: initialStatus,
      adminApprovalStatus: 'pending',
      kycStatus: 'pending_verification',
      isActive: false,
      requiresApproval: true,
      isFullyApproved: false,
      routingIssue: routingIssue || null,
      registrationType: 'direct',
      targetAdminRole,
      targetAdminId: relatedAdmin ? (relatedAdmin._id || relatedAdmin.id) : null,
      targetAdminName: relatedAdmin ? relatedAdmin.name : null,
      targetJurisdiction,
      assignedAdminId: relatedAdmin ? (relatedAdmin._id || relatedAdmin.id) : null,
      dob: dob || null,
      gender: gender || null,
      address: address ? address.trim() : null,
      aadharNumber: (req.body.aadharNumber || '').toString().trim().replace(/\s+/g, '') || null,
      panNumber: (req.body.panNumber || '').toString().trim().toUpperCase() || null,
      aadharPhoto: req.body.aadharUrl || req.body.aadharPhoto || req.body.documents?.aadharUrl || null,
      panPhoto: req.body.panUrl || req.body.panPhoto || req.body.documents?.panUrl || null,
      documents: {
        aadharNumber: (req.body.aadharNumber || '').toString().trim().replace(/\s+/g, '') || null,
        panNumber: (req.body.panNumber || '').toString().trim().toUpperCase() || null,
        aadharUrl: req.body.aadharUrl || req.body.aadharPhoto || req.body.documents?.aadharUrl || null,
        aadharFileName: req.body.aadharFileName || 'Aadhaar_Document',
        panUrl: req.body.panUrl || req.body.panPhoto || req.body.documents?.panUrl || null,
        panFileName: req.body.panFileName || 'PAN_Document',
        bankUrl: req.body.bankUrl || req.body.bankPhoto || req.body.documents?.bankUrl || null,
        bankFileName: req.body.bankFileName || 'Bank_Passbook',
        signatureUrl: req.body.signatureUrl || req.body.signaturePhoto || req.body.documents?.signatureUrl || null,
        signatureFileName: req.body.signatureFileName || 'Specimen_Signature',
        passportUrl: req.body.passportUrl || req.body.documents?.passportUrl || null,
        passportFileName: req.body.passportFileName || 'Passport_Document'
      },
      kycDocs: {
        aadhaarFront: { url: req.body.aadharUrl || req.body.aadharPhoto || null, name: req.body.aadharFileName || 'Aadhaar_Document' },
        panCard: { url: req.body.panUrl || req.body.panPhoto || null, name: req.body.panFileName || 'PAN_Document' },
        bankPassbook: { url: req.body.bankUrl || req.body.bankPhoto || null, name: req.body.bankFileName || 'Bank_Passbook' },
        signature: { url: req.body.signatureUrl || req.body.signaturePhoto || null, name: req.body.signatureFileName || 'Specimen_Signature' },
        passport: { url: req.body.passportUrl || null, name: req.body.passportFileName || 'Passport_Document' }
      },
      declarationAccepted: !!declarationAccepted,
      state: stateName,
      district: districtName,
      division: divisionName,
      pincode: pincodeCode,
      stateId: stateId || null,
      zone: zone || null,
      districtId: districtId || null,
      divisionId: divisionId || null,
      pincodeId: pincodeId || null,
      regionId: stateId || null,
      avatarUrl: avatarUrl || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    if (isAgentRole && db.agents) {
      const agentRecord = {
        _id: newUser._id,
        id: newUser._id,
        name: newUser.name,
        email: newUser.email,
        phone: newUser.mobile,
        mobile: newUser.mobile,
        role: effectiveRole.replace('_agent', ''),
        level: effectiveRole.replace('_agent', ''),
        registrationId: `REG-AGT-${Date.now().toString().slice(-6)}`,
        territory: {
          state: stateName,
          district: districtName,
          division: divisionName,
          pincode: pincodeCode
        },
        status: initialStatus,
        adminApprovalStatus: 'pending',
        kycStatus: 'pending_verification',
        isActive: false,
        isApproved: false,
        requiresApproval: true,
        isFullyApproved: false,
        routingIssue: routingIssue || null,
        documents: newUser.documents,
        createdAt: newUser.createdAt,
        updatedAt: newUser.updatedAt
      };
      await db.agents.insertOne(agentRecord).catch(() => {});
    }

    if (isManagerRole && db.managers) {
      const managerRecord = {
        _id: newUser._id,
        id: newUser._id,
        name: newUser.name,
        email: newUser.email,
        phone: newUser.mobile,
        mobile: newUser.mobile,
        role: newUser.role,
        level: newUser.level,
        registrationId: `REG-MGR-${Date.now().toString().slice(-6)}`,
        state: stateName,
        district: districtName,
        division: divisionName,
        pincode: pincodeCode,
        stateId: stateId || null,
        districtId: districtId || null,
        divisionId: divisionId || null,
        pincodeId: pincodeId || null,
        targetAdminRole,
        targetAdminId: relatedAdmin ? (relatedAdmin._id || relatedAdmin.id) : null,
        targetAdminName: relatedAdmin ? relatedAdmin.name : null,
        targetJurisdiction,
        assignedAdminId: relatedAdmin ? (relatedAdmin._id || relatedAdmin.id) : null,
        routingIssue: routingIssue || null,
        status: initialStatus,
        adminApprovalStatus: 'pending',
        kycStatus: 'pending_verification',
        isActive: false,
        requiresApproval: true,
        isFullyApproved: false,
        documents: newUser.documents,
        kycDocs: newUser.kycDocs,
        createdAt: newUser.createdAt,
        updatedAt: newUser.updatedAt
      };
      await db.managers.insertOne(managerRecord).catch(() => {});
    }

    if (isVendorRole && db.vendors) {
      const vendorRecord = {
        _id: newUser._id,
        id: newUser._id,
        userId: newUser._id,
        name: newUser.name,
        businessName: req.body.businessName || req.body.shopName || newUser.name,
        contactPerson: newUser.name,
        phone: newUser.mobile,
        mobile: newUser.mobile,
        email: newUser.email,
        category: req.body.category || 'Retail & Services',
        subCategory: req.body.subCategory || 'General',
        address: newUser.address || `${districtName || ''}, ${stateName || ''} - ${pincodeCode || ''}`.trim(),
        state: stateName,
        district: districtName,
        division: divisionName,
        pincode: pincodeCode,
        stateId: stateId || null,
        districtId: districtId || null,
        divisionId: divisionId || null,
        pincodeId: pincodeId || null,
        status: 'Under Review',
        approvalStatus: 'Pending Pincode Admin Approval',
        kycStatus: 'Pending Verification',
        registrationSource: 'Direct Registration',
        onboardingSource: 'Direct',
        source: 'Direct Registration',
        targetAdminRole,
        targetAdminId: relatedAdmin ? (relatedAdmin._id || relatedAdmin.id) : null,
        targetAdminName: relatedAdmin ? relatedAdmin.name : null,
        requiresApproval: true,
        isApproved: false,
        isFullyApproved: false,
        documents: newUser.documents,
        kycDocs: newUser.kycDocs,
        createdAt: newUser.createdAt,
        updatedAt: newUser.updatedAt
      };
      await db.vendors.insertOne(vendorRecord).catch(() => {});

      if (db.kycRecords) {
        db.kycRecords.unshift({
          id: `KYC-${newUser._id}`,
          vendorId: newUser._id,
          businessName: vendorRecord.businessName,
          name: vendorRecord.businessName,
          vendorName: newUser.name,
          phone: newUser.mobile,
          email: newUser.email,
          category: vendorRecord.category,
          address: vendorRecord.address,
          state: stateName,
          district: districtName,
          division: divisionName,
          pincode: pincodeCode,
          status: 'Pending Pincode Admin Approval',
          type: 'Vendor',
          submittedDocuments: [
            'GST Registration Certificate',
            'Business PAN Card',
            'Cancelled Cheque / Bank Passbook'
          ],
          submittedDate: new Date().toISOString().split('T')[0],
          verifiedBy: null,
          notes: 'Direct vendor registration. Awaiting Sub-Admin approval.'
        });
      }
    }

    await db.auditLogs.insertOne({
      action: isAgentRole ? 'AGENT_DIRECT_REGISTERED_PENDING_ADMIN' : isVendorRole ? 'VENDOR_DIRECT_REGISTERED_PENDING_ADMIN' : 'MANAGER_DIRECT_REGISTERED_PENDING_ADMIN',
      userId: newUser._id,
      userName: newUser.name,
      userRole: newUser.role,
      targetAdminRole,
      targetAdminId: relatedAdmin ? (relatedAdmin._id || relatedAdmin.id) : null,
      targetAdminName: relatedAdmin ? relatedAdmin.name : null,
      details: `New ${effectiveRole.replace('_', ' ')} direct registration submitted. Routed to ${targetAdminRole} (${relatedAdmin ? relatedAdmin.name : 'Pending admin assignment'}) for jurisdiction: ${targetJurisdiction}. Status: ${initialStatus}.${routingIssue ? ` [ROUTING WARNING: ${routingIssue}]` : ''}`,
      ip: req.ip || '127.0.0.1'
    });

    const userProfile = await buildUserProfile(newUser);

    res.status(201).json({
      success: true,
      status: initialStatus,
      requiresApproval: true,
      isFullyApproved: false,
      routingIssue: routingIssue || null,
      message: `${isAgentRole ? 'Agent' : isVendorRole ? 'Vendor' : 'Manager'} registration submitted successfully. Your request has been routed to your designated ${targetAdminRole} (${targetJurisdiction}) for review and approval. Once approved and verified, your account will be activated.`,
      user: userProfile
    });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ success: false, message: 'Internal server error during registration' });
  }
};

const checkCapacity = async (req, res) => {
  try {
    const { role, stateId, districtId, divisionId, pincodeId } = req.query;
    if (!role) {
      return res.status(400).json({ success: false, message: 'Role parameter is required.' });
    }

    const occupancy = await getOccupancy(role, { stateId, districtId, divisionId, pincodeId });
    res.json({
      success: true,
      role,
      limit: occupancy.limit,
      currentCount: occupancy.count,
      remaining: occupancy.remaining,
      isFull: occupancy.isFull,
      isAllowed: !occupancy.isFull
    });
  } catch (err) {
    console.error('Check capacity error:', err);
    res.status(500).json({ success: false, message: 'Failed to verify location capacity' });
  }
};

const simulateApproval = async (req, res) => {
  try {
    const { userId } = req.body;
    const targetId = userId || req.user?.id;

    if (!targetId) {
      return res.status(400).json({ success: false, message: 'User ID is required to simulate approval.' });
    }

    const user = await db.users.findById(targetId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    await db.users.findByIdAndUpdate(user._id, { 
      status: 'active',
      adminApprovalStatus: 'approved',
      adminApprovedAt: new Date().toISOString(),
      kycStatus: 'Verified'
    });
    const updatedUser = await db.users.findById(user._id);

    // Sync to KYC queue for compliance team
    if (db.kycRecords) {
      let existingKyc = db.kycRecords.find(k => String(k.managerId) === String(user._id) || k.id === `KYC-MGR-${user._id}`);
      if (!existingKyc) {
        await db.kycRecords.insertOne({
          id: `KYC-MGR-${user._id}`,
          type: 'Manager',
          managerId: String(user._id),
          name: user.name,
          vendorName: user.name,
          category: 'Operations Management',
          role: user.role,
          phone: user.mobile || user.phone,
          email: user.email,
          state: user.state,
          district: user.district,
          division: user.division,
          pincode: user.pincode,
          stateId: user.stateId,
          districtId: user.districtId,
          divisionId: user.divisionId,
          pincodeId: user.pincodeId,
          status: 'Pending',
          kycStatus: 'Pending Verification',
          submittedDate: new Date().toISOString().split('T')[0],
          documents: user.documents || {},
          notes: `Direct registration approved by ${user.targetAdminRole || 'Regional Admin'}. Forwarded to KYC Team.`
        });
      } else {
        await db.kycRecords.findByIdAndUpdate(existingKyc._id || existingKyc.id, {
          status: 'Pending',
          kycStatus: 'Pending Verification'
        });
      }
    }

    await db.auditLogs.insertOne({
      action: 'ADMIN_APPROVAL_SIMULATED',
      userId: updatedUser._id,
      userName: updatedUser.name,
      userRole: updatedUser.role,
      details: `Regional administrator approved application for ${updatedUser.name} (${updatedUser.role}). Next requirement: KYC document verification.`,
      ip: req.ip || '127.0.0.1'
    });

    const profile = await buildUserProfile(updatedUser);
    res.json({
      success: true,
      status: 'active',
      message: 'Admin approval granted! Manager account is now Active and login is enabled.',
      user: profile
    });
  } catch (err) {
    console.error('Simulate approval error:', err);
    res.status(500).json({ success: false, message: 'Failed to simulate approval' });
  }
};

const simulateKyc = async (req, res) => {
  try {
    const { userId } = req.body;
    const targetId = userId || req.user?.id;

    if (!targetId) {
      return res.status(400).json({ success: false, message: 'User ID is required to simulate KYC verification.' });
    }

    const user = await db.users.findById(targetId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    await db.users.findByIdAndUpdate(user._id, {
      status: 'active',
      kycStatus: 'Verified',
      kycVerifiedAt: new Date().toISOString()
    });
    const updatedUser = await db.users.findById(user._id);

    // Sync KYC record to Verified
    if (db.kycRecords) {
      let existingKyc = db.kycRecords.find(k => String(k.managerId) === String(user._id) || k.id === `KYC-MGR-${user._id}`);
      if (existingKyc) {
        await db.kycRecords.findByIdAndUpdate(existingKyc._id || existingKyc.id, {
          status: 'Approved',
          kycStatus: 'Verified',
          verifiedBy: 'KYC Compliance Officer',
          verifiedDate: new Date().toISOString().split('T')[0]
        });
      }
    }

    await db.auditLogs.insertOne({
      action: 'KYC_VERIFICATION_SIMULATED',
      userId: updatedUser._id,
      userName: updatedUser.name,
      userRole: updatedUser.role,
      details: `KYC verification completed for ${updatedUser.name}. Account status transitioned to active with full portal access.`,
      ip: req.ip || '127.0.0.1'
    });

    const profile = await buildUserProfile(updatedUser);
    res.json({
      success: true,
      status: 'active',
      message: 'KYC verified successfully! Your account is now active.',
      user: profile
    });
  } catch (err) {
    console.error('Simulate KYC error:', err);
    res.status(500).json({ success: false, message: 'Failed to simulate KYC' });
  }
};

const getRegistrationLocations = async (req, res) => {
  try {
    const states = await db.states.find();
    const allDistricts = await db.districts.find();
    const allDivisions = await db.divisions.find();
    const allPincodes = await db.pincodes.find();

    const users = await db.users.find();
    const activeOrPending = users.filter(u => u.status === 'active' || u.status === 'under_review' || u.status === 'kyc_pending');

    // Show all districts for registration
    const districts = allDistricts;
    const divisions = allDivisions;
    const pincodes = allPincodes;

    const enrichedStates = states.map(s => {
      const count = activeOrPending.filter(u => u.role === 'state_manager' && u.stateId === s._id).length;
      return { ...s, managerCount: count, limit: ROLE_LIMITS.state_manager, isFull: count >= ROLE_LIMITS.state_manager };
    });

    const enrichedDistricts = districts.map(d => {
      const count = activeOrPending.filter(u => u.role === 'district_manager' && u.districtId === d._id).length;
      return { ...d, managerCount: count, limit: ROLE_LIMITS.district_manager, isFull: count >= ROLE_LIMITS.district_manager };
    });

    const enrichedDivisions = divisions.map(v => {
      const count = activeOrPending.filter(u => u.role === 'division_manager' && u.divisionId === v._id).length;
      return { ...v, managerCount: count, limit: ROLE_LIMITS.division_manager, isFull: count >= ROLE_LIMITS.division_manager };
    });

    const enrichedPincodes = pincodes.map(p => {
      const count = activeOrPending.filter(u => u.role === 'pincode_manager' && u.pincodeId === p._id).length;
      return { ...p, managerCount: count, limit: ROLE_LIMITS.pincode_manager, isFull: count >= ROLE_LIMITS.pincode_manager };
    });

    res.json({
      success: true,
      states: enrichedStates,
      districts: enrichedDistricts,
      divisions: enrichedDivisions,
      pincodes: enrichedPincodes,
      roleLimits: ROLE_LIMITS
    });
  } catch (err) {
    console.error('Get registration locations error:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve location data' });
  }
};

const uploadAvatar = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No image file uploaded.' });
    }
    const uploadResult = await uploadFile(req.file.buffer || req.file.path, 'subadmin_avatars', req.file.originalname);
    const fileUrl = uploadResult.url;
    res.json({
      success: true,
      message: 'Profile photo uploaded successfully',
      avatarUrl: fileUrl,
      file: {
        name: req.file.originalname,
        filename: req.file.filename,
        url: fileUrl,
        size: req.file.size
      }
    });
  } catch (err) {
    console.error('Avatar upload error:', err);
    res.status(500).json({ success: false, message: 'Avatar upload failed' });
  }
};

const uploadDocument = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No document file uploaded.' });
    }
    const uploadResult = await uploadFile(req.file.buffer || req.file.path, 'subadmin_docs', req.file.originalname);
    const fileUrl = uploadResult.url;
    res.json({
      success: true,
      message: 'Document uploaded successfully',
      file: {
        name: req.file.originalname,
        filename: uploadResult.key,
        key: uploadResult.key,
        url: fileUrl,
        secure_url: fileUrl,
        size: req.file.size,
        type: req.file.mimetype
      }
    });
  } catch (err) {
    console.error('Document upload error:', err);
    res.status(500).json({ success: false, message: 'Document upload failed' });
  }
};


const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, message: 'Email is required' });
    }

    const cleanEmail = email.trim().toLowerCase();
    let user = null;

    // Check MongoDB Atlas
    try {
      const mdb = await getMongoDb();
      if (mdb) {
        user = await mdb.collection('users').findOne({
          $or: [
            { email: cleanEmail },
            { email: new RegExp('^' + cleanEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i') }
          ]
        });
      }
    } catch (mErr) {
      console.warn('MongoDB forgotPassword lookup warning:', mErr.message);
    }

    if (!user) {
      user = await db.users.findOne({ email: cleanEmail });
    }

    if (!user) {
      // Generic success to prevent user enumeration
      return res.json({
        success: true,
        message: 'If the email exists in our system, a password reset link has been dispatched.'
      });
    }

    const resetToken = crypto.randomBytes(24).toString('hex');
    const resetExpires = new Date(Date.now() + 3600000).toISOString();

    // Update in MongoDB Atlas
    try {
      const mdb = await getMongoDb();
      if (mdb && user._id) {
        const { ObjectId } = require('mongodb');
        let queryId = user._id;
        try {
          if (typeof user._id === 'string' && ObjectId.isValid(user._id)) {
            queryId = new ObjectId(user._id);
          }
        } catch (e) {}
        await mdb.collection('users').updateOne(
          { $or: [{ _id: queryId }, { _id: String(user._id) }, { email: cleanEmail }] },
          { $set: { resetPasswordToken: resetToken, resetPasswordExpires: resetExpires } }
        );
      }
    } catch (updateErr) {
      console.warn('MongoDB reset token update warning:', updateErr.message);
    }

    // Also update in local db.users
    try {
      await db.users.findByIdAndUpdate(user._id || user.id, {
        resetPasswordToken: resetToken,
        resetPasswordExpires: resetExpires
      });
    } catch (e) {}

    res.json({
      success: true,
      message: 'Password reset link generated.',
      demoResetToken: resetToken
    });
  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ success: false, message: 'Failed to process forgot password request' });
  }
};

const resetPassword = async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) {
      return res.status(400).json({ success: false, message: 'Token and new password are required' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, message: 'New password must be at least 6 characters' });
    }

    let user = null;
    try {
      const mdb = await getMongoDb();
      if (mdb) {
        user = await mdb.collection('users').findOne({ resetPasswordToken: token });
      }
    } catch (mErr) {
      console.warn('MongoDB resetPassword lookup warning:', mErr.message);
    }

    if (!user) {
      user = await db.users.findOne({ resetPasswordToken: token });
    }

    if (!user) {
      return res.status(400).json({ success: false, message: 'Invalid or expired reset token' });
    }

    if (new Date(user.resetPasswordExpires) < new Date()) {
      return res.status(400).json({ success: false, message: 'Reset token has expired' });
    }

    const passwordHash = bcrypt.hashSync(newPassword, 10);

    // Update in MongoDB Atlas
    try {
      const mdb = await getMongoDb();
      if (mdb && user._id) {
        const { ObjectId } = require('mongodb');
        let queryId = user._id;
        try {
          if (typeof user._id === 'string' && ObjectId.isValid(user._id)) {
            queryId = new ObjectId(user._id);
          }
        } catch (e) {}
        await mdb.collection('users').updateOne(
          { $or: [{ _id: queryId }, { _id: String(user._id) }] },
          {
            $set: {
              passwordHash,
              password: passwordHash,
              resetPasswordToken: null,
              resetPasswordExpires: null,
              passwordChangedAt: new Date().toISOString()
            }
          }
        );
      }
    } catch (updateErr) {
      console.warn('MongoDB reset password update warning:', updateErr.message);
    }

    // Also update in local db.users
    try {
      await db.users.findByIdAndUpdate(user._id || user.id, {
        passwordHash,
        password: passwordHash,
        resetPasswordToken: null,
        resetPasswordExpires: null
      });
    } catch (e) {}

    res.json({ success: true, message: 'Password reset successful. You may now log in with your new password.' });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ success: false, message: 'Failed to reset password' });
  }
};

const changePassword = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized. Authentication required.' });
    }

    const { currentPassword, newPassword, confirmPassword } = req.body;

    if (!newPassword || !confirmPassword) {
      return res.status(400).json({ success: false, message: 'New password and confirm password are required.' });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({ success: false, message: 'Confirm Password must exactly match New Password.' });
    }

    // Password requirements:
    // - Minimum 6 characters
    // - At least one uppercase letter
    // - At least one number
    // - At least one special character
    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters long.' });
    }
    if (!/[A-Z]/.test(newPassword)) {
      return res.status(400).json({ success: false, message: 'Password must contain at least one uppercase letter (A-Z).' });
    }
    if (!/[0-9]/.test(newPassword)) {
      return res.status(400).json({ success: false, message: 'Password must contain at least one number (0-9).' });
    }
    if (!/[!@#$%^&*(),.?":{}|<>]/.test(newPassword)) {
      return res.status(400).json({ success: false, message: 'Password must contain at least one special character (e.g. !@#$%^&*).' });
    }

    let user = null;
    try {
      const mdb = await getMongoDb();
      if (mdb) {
        const { ObjectId } = require('mongodb');
        try {
          user = await mdb.collection('users').findOne({ _id: new ObjectId(userId) });
        } catch (e) {
          user = await mdb.collection('users').findOne({ _id: String(userId) });
        }
      }
    } catch (mErr) {
      console.warn('MongoDB changePassword lookup warning:', mErr.message);
    }

    if (!user) {
      const allUsers = Array.from(db.users || []);
      user = allUsers.find(u => String(u._id || u.id) === String(userId));
    }

    if (!user) {
      return res.status(404).json({ success: false, message: 'User account not found.' });
    }

    // If current password provided or required, verify it
    const existingHash = user.passwordHash || user.password;
    if (currentPassword && existingHash) {
      let isCurrentValid = false;
      if (existingHash.startsWith('$2a$') || existingHash.startsWith('$2b$') || existingHash.startsWith('$2y$')) {
        isCurrentValid = bcrypt.compareSync(currentPassword, existingHash);
      } else if (existingHash === currentPassword) {
        isCurrentValid = true;
      }
      if (!isCurrentValid) {
        return res.status(400).json({ success: false, message: 'Current password does not match our records.' });
      }
    }

    const passwordHash = bcrypt.hashSync(newPassword, 10);
    const now = new Date().toISOString();

    // Update in MongoDB Atlas (never store plaintext)
    try {
      const mdb = await getMongoDb();
      if (mdb) {
        const { ObjectId } = require('mongodb');
        let queryId = user._id;
        try {
          if (typeof user._id === 'string' && ObjectId.isValid(user._id)) {
            queryId = new ObjectId(user._id);
          }
        } catch (e) {}
        await mdb.collection('users').updateOne(
          { $or: [{ _id: queryId }, { _id: String(user._id) }, { email: user.email }] },
          {
            $set: {
              passwordHash,
              password: passwordHash,
              passwordChangedAt: now,
              updatedAt: now
            }
          }
        );
      }
    } catch (updateErr) {
      console.warn('MongoDB password change update warning:', updateErr.message);
    }

    // Update in local db.users
    try {
      await db.users.findByIdAndUpdate(user._id || user.id, {
        passwordHash,
        password: passwordHash,
        passwordChangedAt: now,
        updatedAt: now
      });
    } catch (e) {}

    return res.json({
      success: true,
      message: 'Password changed successfully. Your account is secured with your new password.'
    });
  } catch (err) {
    console.error('Change password error:', err);
    return res.status(500).json({ success: false, message: 'Failed to change password: ' + err.message });
  }
};

const updateProfile = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized. Authentication required.' });
    }

    const { email, mobile, phone, alternateMobile, altPhone, address, city, preferredLanguage } = req.body;

    let user = null;
    try {
      const mdb = await getMongoDb();
      if (mdb) {
        const { ObjectId } = require('mongodb');
        try {
          user = await mdb.collection('users').findOne({ _id: new ObjectId(userId) });
        } catch (e) {
          user = await mdb.collection('users').findOne({ _id: String(userId) });
        }
      }
    } catch (mErr) {
      console.warn('MongoDB updateProfile lookup warning:', mErr.message);
    }

    if (!user) {
      const allUsers = Array.from(db.users || []);
      user = allUsers.find(u => String(u._id || u.id) === String(userId));
    }

    if (!user) {
      return res.status(404).json({ success: false, message: 'User account not found.' });
    }

    // Security Rule: Username, name, and unique ID are strictly READ-ONLY
    if (req.body.name && req.body.name.trim() !== (user.name || '').trim()) {
      return res.status(400).json({ success: false, message: 'Official Name is read-only and cannot be changed.' });
    }
    if (req.body.username && req.body.username.trim() !== (user.username || user.loginId || user.email || '').trim()) {
      return res.status(400).json({ success: false, message: 'Username is read-only and cannot be changed.' });
    }
    if (req.body.subAdminId && String(req.body.subAdminId).trim() !== String(user.subAdminId || user.id || user._id).trim()) {
      return res.status(400).json({ success: false, message: 'Sub-Admin ID is permanent and read-only.' });
    }

    const updates = {};
    const now = new Date().toISOString();

    if (email) {
      const cleanEmail = String(email).trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
        return res.status(400).json({ success: false, message: 'Please enter a valid email address.' });
      }
      const allUsers = Array.from(db.users || []);
      const conflict = allUsers.find(u => String(u._id || u.id) !== String(userId) && (u.email || '').toLowerCase() === cleanEmail);
      if (conflict) {
        return res.status(400).json({ success: false, message: 'This email address is already in use by another account.' });
      }
      updates.email = cleanEmail;
    }

    if (mobile || phone) {
      const cleanPhone = String(mobile || phone).replace(/\D/g, '').slice(-10);
      if (cleanPhone.length !== 10) {
        return res.status(400).json({ success: false, message: 'Mobile number must be exactly 10 digits.' });
      }
      updates.mobile = cleanPhone;
      updates.phone = cleanPhone;
    }

    if (alternateMobile !== undefined || altPhone !== undefined) {
      const cleanAlt = String(alternateMobile || altPhone || '').trim();
      updates.alternateMobile = cleanAlt;
      updates.altPhone = cleanAlt;
    }

    if (address !== undefined) updates.address = String(address).trim();
    if (city !== undefined) updates.city = String(city).trim();
    if (preferredLanguage !== undefined) updates.preferredLanguage = String(preferredLanguage).trim();
    if (req.body.avatar !== undefined || req.body.avatarUrl !== undefined) {
      const cleanAvatar = String(req.body.avatar || req.body.avatarUrl || '').trim();
      updates.avatar = cleanAvatar;
      updates.avatarUrl = cleanAvatar;
    }

    updates.updatedAt = now;

    // Update in MongoDB Atlas
    try {
      const mdb = await getMongoDb();
      if (mdb) {
        const { ObjectId } = require('mongodb');
        let queryId = user._id;
        try {
          if (typeof user._id === 'string' && ObjectId.isValid(user._id)) {
            queryId = new ObjectId(user._id);
          }
        } catch (e) {}
        await mdb.collection('users').updateOne(
          { $or: [{ _id: queryId }, { _id: String(user._id) }] },
          { $set: updates }
        );
      }
    } catch (mUpdateErr) {
      console.warn('MongoDB profile update warning:', mUpdateErr.message);
    }

    // Update in local db.users
    try {
      await db.users.findByIdAndUpdate(user._id || user.id, updates);
    } catch (e) {}

    const updatedUser = { ...user, ...updates };
    const profile = await buildUserProfile(updatedUser);

    return res.json({
      success: true,
      message: 'Account details updated successfully.',
      user: profile
    });
  } catch (err) {
    console.error('Update profile error:', err);
    return res.status(500).json({ success: false, message: 'Failed to update account details: ' + err.message });
  }
};

module.exports = {
  login,
  getMe,
  getDemoAdmins,
  register,
  checkCapacity,
  simulateApproval,
  simulateKyc,
  getRegistrationLocations,
  uploadAvatar,
  uploadDocument,
  changePassword,
  updateProfile,
  forgotPassword,
  resetPassword,
  ROLE_LIMITS
};
