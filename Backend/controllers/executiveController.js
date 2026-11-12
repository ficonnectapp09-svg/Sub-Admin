const { uploadFile } = require('../config/storage');
const { db, filterByLocation, resolveStateFromDistrict } = require('../config/db');
const { getMongoDb } = require('../config/mongo');
const bcrypt = require('bcryptjs');

// Executives & Support Team
function getExecutives(req, res) {
  try {
    let scoped = filterByLocation(db.executives, req.user);
    return res.json({ success: true, count: scoped.length, executives: scoped, data: scoped });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to fetch executives', error: error.message });
  }
}

function getSupportTeam(req, res) {
  try {
    let scoped = filterByLocation(db.supportTeam, req.user);
    return res.json({ success: true, count: scoped.length, tickets: scoped, data: scoped });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to fetch support team', error: error.message });
  }
}

async function updateTicketStatus(req, res) {
  try {
    const { id } = req.params;
    const { status, assignedTo } = req.body;

    const ticket = await db.supportTeam.findOne({
      $or: [{ _id: id }, { id: id }]
    });
    if (!ticket) return res.status(404).json({ success: false, message: 'Ticket not found' });

    const scoped = filterByLocation([ticket], req.user);
    if (scoped.length === 0) {
      return res.status(403).json({ success: false, message: 'Ticket outside your jurisdiction' });
    }

    const updates = { updatedAt: new Date().toISOString() };
    if (status) updates.status = status;
    if (assignedTo) updates.assignedTo = assignedTo;

    const updated = await db.supportTeam.findByIdAndUpdate(ticket._id || ticket.id, updates);

    return res.json({ success: true, message: 'Ticket updated', ticket: updated || { ...ticket, ...updates } });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to update ticket', error: error.message });
  }
}

/**
 * Get the normalized level of an agent.
 * db.agents stores the level in the `role` field (values: 'state', 'district', 'division', 'pincode').
 * The `level` field may be a number (1-4) or undefined.
 * This function resolves the correct string level from whichever field is populated.
 */
function getAgentLevel(agent) {
  if (!agent) return '';
  // level may be a number (1=state,2=district,3=division,4=pincode) or a string
  const lvlRaw = agent.level;
  if (typeof lvlRaw === 'number') {
    if (lvlRaw === 1) return 'state';
    if (lvlRaw === 2) return 'district';
    if (lvlRaw === 3) return 'division';
    if (lvlRaw === 4) return 'pincode';
  }
  const lvl = (String(lvlRaw || '')).toLowerCase().trim();
  const rol = (String(agent.role || '')).toLowerCase().trim();

  // Generic non-level role names to skip
  const GENERIC = new Set(['agent', 'staff', 'manager', 'vendor', 'customer', 'admin', 'super-admin', '']);

  if (lvl && !GENERIC.has(lvl)) return lvl;
  if (rol && !GENERIC.has(rol)) return rol;
  return lvl || rol || '';
}

/**
 * Normalize a level string for consistent comparison.
 * Frontend sends: 'state', 'district', 'divisional', 'pincode'
 * DB agents use:  'state', 'district', 'division', 'pincode' in `role` field
 */
function normalizeLevel(level) {
  if (!level) return '';
  const l = String(level).toLowerCase().trim();
  if (l.includes('pincode') || l.includes('pin')) return 'pincode';
  if (l.includes('divis')) return 'division';
  if (l.includes('district')) return 'district';
  if (l.includes('state')) return 'state';
  return l;
}

/**
 * Get the agent's territory as a flat object.
 * Resolves from top-level fields (state, district, division, pincode)
 * or from nested territory sub-object.
 */
/**
 * Normalizes division names for comparison by removing trailing 'division' and extra spaces.
 * E.g., 'Attur Division' and 'Attur' will both normalize to 'attur'.
 */
function normalizeDivision(name) {
  if (!name) return '';
  return String(name).toLowerCase().replace(/\s+division$/i, '').trim();
}

function divisionMatches(div1, div2) {
  if (!div1 || !div2) return false;
  return normalizeDivision(div1) === normalizeDivision(div2);
}

function formatAddressString(addr, fallback = 'N/A') {
  if (!addr) return fallback;
  if (typeof addr === 'string') return addr.trim() || fallback;
  if (typeof addr === 'object') {
    if (typeof addr.fullAddress === 'string' && addr.fullAddress.trim()) {
      return addr.fullAddress.trim();
    }
    const parts = [
      addr.buildingNo || addr.doorNo || addr.doorNumber || addr.houseNumber,
      addr.street || addr.streetName || addr.streetAddress,
      addr.locality || addr.area,
      addr.village || addr.town || addr.city,
      addr.postOffice,
      addr.taluk || addr.division,
      addr.district,
      addr.state,
      addr.pincode || addr.pinCode || addr.postalCode
    ].filter(Boolean).map(v => typeof v === 'string' ? v.trim() : String(v)).filter(Boolean);

    if (parts.length > 0) return parts.join(', ');
    const vals = Object.values(addr).filter(v => (typeof v === 'string' || typeof v === 'number') && String(v).trim()).map(v => String(v).trim());
    if (vals.length > 0) return vals.join(', ');
  }
  return String(addr || fallback);
}

/**
 * Get the agent's territory as a flat object.
 * Resolves from top-level fields (state, district, division, pincode)
 * or from nested territory sub-object, with fallback lookup in db.pincodes and db.divisions.
 */
function getAgentTerritory(agent) {
  if (!agent) return { state: '', district: '', division: '', pincode: '' };
  const t = agent.territory || {};
  let state = String(agent.state || t.state || '').trim();
  let district = String(agent.district || t.district || '').trim();
  let division = String(agent.division || t.division || '').trim();
  let pincode = String(agent.pincode || t.pincode || '').trim();

  // If pincode is present but state/district/division missing, resolve from db.pincodes
  if (pincode && (!state || !district || !division) && db.pincodes) {
    const pinObj = Array.from(db.pincodes || []).find(p => String(p.code || p.pincode) === pincode);
    if (pinObj) {
      if (!state && pinObj.state) state = String(pinObj.state).trim();
      if (!district && pinObj.district) district = String(pinObj.district).trim();
      if (!division && pinObj.division) division = String(pinObj.division).trim();
    }
  }

  // If division is present but state/district missing, resolve from db.divisions
  if (division && (!state || !district) && db.divisions) {
    const divObj = Array.from(db.divisions || []).find(d => divisionMatches(d.name, division));
    if (divObj) {
      if (!district && divObj.districtName) district = String(divObj.districtName).trim();
      if (!state && divObj.stateName) state = String(divObj.stateName).trim();
    }
  }

  // If state is still missing but district is known, derive from verified district map
  if (!state && district) {
    const derived = resolveStateFromDistrict(district);
    if (derived) {
      state = derived.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    }
  }

  return { state, district, division, pincode };
}

// ─────────────────────────────────────────────────────────────────
// Core Hierarchical Scoping
//
// Visibility rules:
// Super Admin / admin     → All agents across all territories
// State Admin             → All agent levels (state/district/division/pincode) within their state
// District Admin          → district + division + pincode agents within their district (NEVER state agents)
// Divisional Admin        → division + pincode agents within their division (NEVER district or state agents)
// Pincode Admin           → ONLY pincode agents in their exact pincode
// Managers (any level)    → Same as corresponding admin level
// ─────────────────────────────────────────────────────────────────
function getHierarchicalScopedAgents(allAgents, user) {
  if (!allAgents || !Array.isArray(allAgents)) return [];
  if (!user) return [];

  const rawRole = String(user.role || '');
  const role = rawRole.toLowerCase().replace(/_/g, ' ').trim();

  let userPincode = user.pincode ? String(user.pincode).trim() : null;
  let userDivision = user.division ? String(user.division).trim().toLowerCase() : null;
  let userDistrict = user.district ? String(user.district).trim().toLowerCase() : null;
  let userState = user.state ? String(user.state).trim().toLowerCase() : null;

  // If territory fields are missing on user object, check db.users
  if (user.id || user._id) {
    const dbUser = Array.from(db.users || []).find(u => String(u._id || u.id) === String(user.id || user._id));
    if (dbUser) {
      if (!userPincode && dbUser.pincode) userPincode = String(dbUser.pincode).trim();
      if (!userDivision && dbUser.division) userDivision = String(dbUser.division).trim().toLowerCase();
      if (!userDistrict && dbUser.district) userDistrict = String(dbUser.district).trim().toLowerCase();
      if (!userState && dbUser.state) userState = String(dbUser.state).trim().toLowerCase();
    }
  }

  // ── Super Admin / unrestricted admin ───────────────────────────
  if (role.includes('super admin') || role === 'admin' || role === 'super-admin' || userState === 'all india') {
    return allAgents;
  }

  // ── Pincode Admin / Pincode Manager ────────────────────────────
  if (role.includes('pincode')) {
    if (!userPincode) return [];
    return allAgents.filter(a => {
      const aLevel = normalizeLevel(getAgentLevel(a));
      const t = getAgentTerritory(a);
      // Pincode Agent: strictly within own pincode
      if (aLevel === 'pincode') return Boolean(t.pincode && t.pincode === userPincode);
      // Division Agent: within own division
      if (aLevel === 'division') return Boolean(userDivision && divisionMatches(t.division, userDivision));
      // District Agent: within own district
      if (aLevel === 'district') return Boolean(userDistrict && t.district && t.district.toLowerCase() === userDistrict);
      // State Agent: within own state
      if (aLevel === 'state') return Boolean(userState && t.state && t.state.toLowerCase() === userState);
      return false;
    });
  }

  // ── Division Admin / Divisional Admin / Division Manager ───────
  if (role.includes('division') || role.includes('divisional')) {
    if (!userDivision) return [];
    return allAgents.filter(a => {
      const aLevel = normalizeLevel(getAgentLevel(a));
      const t = getAgentTerritory(a);
      // Division & Pincode Agents: within own division
      if (aLevel === 'division' || aLevel === 'pincode') {
        const matchesDiv = divisionMatches(t.division, userDivision);
        const matchesDist = !userDistrict || (t.district && t.district.toLowerCase() === userDistrict);
        const matchesState = !userState || (t.state && t.state.toLowerCase() === userState);
        return matchesDiv && matchesDist && matchesState;
      }
      // District Agent: within own district (view-only)
      if (aLevel === 'district') {
        return Boolean(userDistrict && t.district && t.district.toLowerCase() === userDistrict);
      }
      // State Agent: within own state (view-only)
      if (aLevel === 'state') {
        return Boolean(userState && t.state && t.state.toLowerCase() === userState);
      }
      return false;
    });
  }

  // ── District Admin / District Manager ─────────────────────────
  if (role.includes('district')) {
    if (!userDistrict) return [];
    return allAgents.filter(a => {
      const aLevel = normalizeLevel(getAgentLevel(a));
      const t = getAgentTerritory(a);
      // District, Division, and Pincode Agents: within own district
      if (aLevel === 'district' || aLevel === 'division' || aLevel === 'pincode') {
        const matchesDist = Boolean(t.district && t.district.toLowerCase() === userDistrict);
        const matchesState = !userState || (t.state && t.state.toLowerCase() === userState);
        return matchesDist && matchesState;
      }
      // State Agent: within own state (view-only)
      if (aLevel === 'state') {
        return Boolean(userState && t.state && t.state.toLowerCase() === userState);
      }
      return false;
    });
  }

  // ── State Admin / State Manager ────────────────────────────────
  if (role.includes('state')) {
    if (!userState) return [];
    return allAgents.filter(a => {
      const t = getAgentTerritory(a);
      // STRICT: Must belong to the admin's state — reject cross-state agents
      return Boolean(t.state && t.state.toLowerCase() === userState);
    });
  }

  // ── Manager catch-all ──────────────────────────────────────────
  if (role.includes('manager')) {
    return allAgents.filter(a => {
      const t = getAgentTerritory(a);
      if (userPincode && (!t.pincode || t.pincode !== userPincode)) return false;
      if (userDivision && (!t.division || !divisionMatches(t.division, userDivision))) return false;
      if (userDistrict && (!t.district || t.district.toLowerCase() !== userDistrict)) return false;
      if (userState && (!t.state || t.state.toLowerCase() !== userState)) return false;
      return true;
    });
  }

  return [];
}

// ─────────────────────────────────────────────────────────────────
// GET /operations/agents
// ─────────────────────────────────────────────────────────────────
async function getAgents(req, res) {
  try {
    if (db.agents && typeof db.agents.reloadFromMongo === 'function' && db.agents._mongoCol) {
      try {
        await db.agents.reloadFromMongo(false);
      } catch (err) {
        // silent
      }
    }
    const rawAgents = Array.from(db.agents);
    const { search, status, level, state, district, division, pincode } = req.query;

    const userRole = String(req.user?.role || '').toLowerCase().replace(/_/g, ' ').replace(/-/g, ' ').trim();
    const isSuperAdmin = userRole.includes('super admin') || userRole === 'admin' || userRole === 'main admin' || req.user?.state === 'All India';

    // Step 0: Backend authorization validation of territory parameters against authenticated user session
    if (!isSuperAdmin) {
      const userState = (req.user?.state || '').toLowerCase().trim();
      const userDistrict = (req.user?.district || '').toLowerCase().trim();
      const userDivision = (req.user?.division || '').toLowerCase().trim();
      const userPincode = String(req.user?.pincode || '').trim();

      // State Admin: cannot access data outside their assigned state
      if (userRole.includes('state')) {
        if (state && userState && userState !== 'all india' && state.toLowerCase().trim() !== userState) {
          return res.status(403).json({
            success: false,
            code: 'UNAUTHORIZED_TERRITORY',
            message: 'Unauthorized territory access. State Admins cannot access data outside their assigned state.'
          });
        }
      }
      // District Admin: cannot access data outside their assigned district
      else if (userRole.includes('district')) {
        if (state && userState && userState !== 'all india' && state.toLowerCase().trim() !== userState) {
          return res.status(403).json({
            success: false,
            code: 'UNAUTHORIZED_TERRITORY',
            message: 'Unauthorized territory access. District Admins cannot access data outside their assigned state.'
          });
        }
        if (district && userDistrict && userDistrict !== 'all districts' && district.toLowerCase().trim() !== userDistrict) {
          return res.status(403).json({
            success: false,
            code: 'UNAUTHORIZED_TERRITORY',
            message: 'Unauthorized territory access. District Admins cannot access data outside their assigned district.'
          });
        }
      }
      // Divisional Admin: cannot access data outside their assigned division
      else if (userRole.includes('division') || userRole.includes('divisional')) {
        if (state && userState && userState !== 'all india' && state.toLowerCase().trim() !== userState) {
          return res.status(403).json({
            success: false,
            code: 'UNAUTHORIZED_TERRITORY',
            message: 'Unauthorized territory access. Divisional Admins cannot access data outside their assigned state.'
          });
        }
        if (district && userDistrict && userDistrict !== 'all districts' && district.toLowerCase().trim() !== userDistrict) {
          return res.status(403).json({
            success: false,
            code: 'UNAUTHORIZED_TERRITORY',
            message: 'Unauthorized territory access. Divisional Admins cannot access data outside their assigned district.'
          });
        }
        if (division && userDivision && userDivision !== 'all divisions' && !divisionMatches(division, userDivision)) {
          return res.status(403).json({
            success: false,
            code: 'UNAUTHORIZED_TERRITORY',
            message: 'Unauthorized territory access. Divisional Admins cannot access data outside their assigned division.'
          });
        }
      }
      // Pincode Admin: cannot access data outside their assigned pincode
      else if (userRole.includes('pincode')) {
        if (pincode && userPincode && userPincode !== 'all' && String(pincode).trim() !== userPincode) {
          return res.status(403).json({
            success: false,
            code: 'UNAUTHORIZED_TERRITORY',
            message: 'Unauthorized territory access. Pincode Admins cannot access data outside their assigned pincode.'
          });
        }
      }
    }

    // Step 1: Hierarchy-based scoping (enforced at data level)
    let scoped = getHierarchicalScopedAgents(rawAgents, req.user);

    // Step 2: Enforce state boundary — non-super-admin cannot escape their state
    const effectiveState = isSuperAdmin ? (state || null) : (req.user?.state || null);
    if (effectiveState && String(effectiveState).toLowerCase() !== 'all india') {
      scoped = scoped.filter(a => {
        const t = getAgentTerritory(a);
        return t.state && t.state.toLowerCase() === effectiveState.toLowerCase();
      });
    }

    // Step 3: Level filter & level-appropriate territory drill-downs
    if (level) {
      const normLevel = normalizeLevel(level);
      scoped = scoped.filter(a => {
        const aLevel = normalizeLevel(getAgentLevel(a));
        return aLevel === normLevel;
      });

      if (normLevel !== 'state' && district) {
        scoped = scoped.filter(a => {
          const t = getAgentTerritory(a);
          return t.district && t.district.toLowerCase() === String(district).trim().toLowerCase();
        });
      }

      if ((normLevel === 'division' || normLevel === 'pincode') && division) {
        scoped = scoped.filter(a => {
          const t = getAgentTerritory(a);
          return divisionMatches(t.division, division);
        });
      }

      if (normLevel === 'pincode' && pincode) {
        scoped = scoped.filter(a => {
          const t = getAgentTerritory(a);
          return t.pincode === String(pincode).trim();
        });
      }
    } else {
      if (district) {
        scoped = scoped.filter(a => {
          const t = getAgentTerritory(a);
          return t.district && t.district.toLowerCase() === String(district).trim().toLowerCase();
        });
      }

      if (division) {
        scoped = scoped.filter(a => {
          const t = getAgentTerritory(a);
          return divisionMatches(t.division, division);
        });
      }

      if (pincode) {
        scoped = scoped.filter(a => {
          const t = getAgentTerritory(a);
          return t.pincode === String(pincode).trim();
        });
      }
    }

    // Step 5: Reject agents missing required territory fields for their level
    scoped = scoped.filter(a => {
      const aLevel = normalizeLevel(getAgentLevel(a));
      const t = getAgentTerritory(a);
      if (aLevel === 'state') return Boolean(t.state);
      if (aLevel === 'district') return Boolean(t.district && t.state);
      if (aLevel === 'division') return Boolean(t.division && t.district);
      if (aLevel === 'pincode') return Boolean(t.pincode);
      return Boolean(t.state || t.district || t.division || t.pincode);
    });

    // Step 6: Search filter
    if (search) {
      const q = String(search).toLowerCase();
      scoped = scoped.filter(a => {
        const t = getAgentTerritory(a);
        return (
          (a.name && String(a.name).toLowerCase().includes(q)) ||
          (a.phone && String(a.phone).includes(q)) ||
          (a.email && String(a.email).toLowerCase().includes(q)) ||
          (a.registrationId && String(a.registrationId).toLowerCase().includes(q)) ||
          (t.pincode && t.pincode.includes(q)) ||
          (t.district && t.district.toLowerCase().includes(q)) ||
          (t.division && t.division.toLowerCase().includes(q)) ||
          (t.state && t.state.toLowerCase().includes(q))
        );
      });
    }

    // Step 7: Status filter
    if (status) {
      const qStat = String(status).toLowerCase().trim();
      if (qStat === 'all') {
        // Explicit all-records view (excludes pending/rejected, includes active, suspended, deleted)
        scoped = scoped.filter(a => {
          const s = (a.status || '').toLowerCase().trim();
          return s !== 'rejected' && !s.includes('pending');
        });
      } else if (qStat === 'active') {
        scoped = scoped.filter(a => {
          const s = (a.status || '').toLowerCase().trim();
          return (s === 'active' || s === 'approved') && s !== 'suspended' && s !== 'deleted' && !a.isDeleted && a.isActive !== false;
        });
      } else if (qStat === 'suspended') {
        scoped = scoped.filter(a => (a.status || '').toLowerCase().trim() === 'suspended');
      } else if (qStat === 'deleted') {
        scoped = scoped.filter(a => (a.status || '').toLowerCase().trim() === 'deleted' || a.isDeleted === true);
      } else {
        scoped = scoped.filter(a => a.status && String(a.status).toLowerCase() === qStat);
      }
    } else {
      // By default in Agent Directories / Rosters, strictly show ONLY approved/active agents (not suspended or deleted).
      scoped = scoped.filter(a => {
        const s = (a.status || '').toLowerCase().trim();
        return (s === 'active' || s === 'approved') && s !== 'rejected' && s !== 'suspended' && s !== 'deleted' && !s.includes('pending') && !a.isDeleted && a.isActive !== false;
      });
    }

    // Step 8: Format each agent with standard normalized fields
    const formattedAgents = scoped.map(a => {
      const normLevel = normalizeLevel(getAgentLevel(a));
      const terr = getAgentTerritory(a);
      const rawId = a.id || a._id;
      const idStr = rawId ? String(rawId) : `agent-${Math.random().toString(36).slice(2, 8)}`;

      let jurisdiction = 'Assigned Territory';
      let assignedArea = '';
      if (normLevel === 'pincode' && terr.pincode) {
        jurisdiction = `PIN ${terr.pincode}`;
        assignedArea = [terr.division, terr.district, terr.state].filter(Boolean).join(', ');
      } else if (normLevel === 'division' && terr.division) {
        jurisdiction = terr.division;
        assignedArea = [terr.district, terr.state].filter(Boolean).join(', ');
      } else if (normLevel === 'district' && terr.district) {
        jurisdiction = `${terr.district} District`;
        assignedArea = terr.state || '';
      } else if (normLevel === 'state' && terr.state) {
        jurisdiction = `${terr.state} State`;
        assignedArea = terr.state ? `${terr.state} (Statewide)` : 'Statewide';
      } else {
        jurisdiction = terr.state || 'Assigned Zone';
        assignedArea = terr.district || '';
      }

      const sLower = (a.status || '').toLowerCase().trim();
      const resolvedStatus = (a.isDeleted || sLower === 'deleted')
        ? 'Deleted'
        : (a.isSuspended || sLower === 'suspended')
        ? 'Suspended'
        : (sLower === 'approved' || sLower === 'active')
        ? 'Active'
        : (a.status || 'Active');

      return {
        ...a,
        id: idStr,
        _id: idStr,
        level: normLevel,
        state: terr.state,
        district: terr.district,
        division: terr.division,
        pincode: terr.pincode,
        jurisdiction,
        assignedArea,
        totalReferrals: a.totalReferrals ?? 0,
        vendorOnboardings: a.vendorOnboardings ?? 0,
        walletBalance: a.walletBalance ?? 0,
        totalEarned: a.totalEarned ?? 0,
        status: resolvedStatus,
        isDeleted: Boolean(a.isDeleted || sLower === 'deleted'),
        isSuspended: Boolean(a.isSuspended || sLower === 'suspended')
      };
    });

    return res.json({ success: true, count: formattedAgents.length, agents: formattedAgents });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to fetch agents', error: error.message });
  }
}

// ─────────────────────────────────────────────────────────────────
// POST /operations/agents — Strict Territory-Based Agent Onboarding
// ─────────────────────────────────────────────────────────────────
async function addAgent(req, res) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }
    req.body = req.body || {};

    const userRole = String(req.user.role || '').toLowerCase().replace(/_/g, ' ').replace(/-/g, ' ').trim();
    const adminUserRole = String(req.user.adminRole || '').toLowerCase().replace(/_/g, ' ').replace(/-/g, ' ').trim();
    const isSuperAdmin = (userRole.includes('super admin') || userRole === 'main admin' || (userRole === 'admin' && !adminUserRole.includes('state') && !adminUserRole.includes('district') && !adminUserRole.includes('division') && !adminUserRole.includes('pincode') && !req.user?.level?.includes('state'))) && (!req.user?.state || req.user?.state.toLowerCase() === 'all india');

    // 1. Determine permitted administrative level strictly from authenticated caller
    let permittedLevel = '';
    if (isSuperAdmin) {
      permittedLevel = req.body.level ? normalizeLevel(req.body.level) : 'state';
    } else if (userRole.includes('pincode')) {
      permittedLevel = 'pincode';
    } else if (userRole.includes('division') || userRole.includes('divisional')) {
      permittedLevel = 'division';
    } else if (userRole.includes('district')) {
      permittedLevel = 'district';
    } else if (userRole.includes('state') || (userRole === 'admin' && req.user?.state)) {
      permittedLevel = 'state';
    } else {
      return res.status(403).json({
        success: false,
        code: 'UNAUTHORIZED_ROLE',
        message: 'Only administrative accounts (State, District, Division, Pincode Admins) have permissions to onboard agents.'
      });
    }

    // 2. Reject if requested level or role does not match caller's permitted administrative level
    if (!isSuperAdmin) {
      if (req.body.level) {
        const requestedNorm = normalizeLevel(req.body.level);
        if (requestedNorm !== permittedLevel) {
          return res.status(403).json({
            success: false,
            code: 'UNAUTHORIZED_LEVEL',
            message: `Unauthorized level. Your account can only onboard ${permittedLevel.charAt(0).toUpperCase() + permittedLevel.slice(1)} Agents at your assigned territory level.`
          });
        }
      }
      if (req.body.role) {
        const reqRoleNorm = normalizeLevel(req.body.role);
        if (reqRoleNorm && reqRoleNorm !== permittedLevel) {
          return res.status(403).json({
            success: false,
            code: 'UNAUTHORIZED_LEVEL',
            message: `Unauthorized role. Your account can only onboard ${permittedLevel.charAt(0).toUpperCase() + permittedLevel.slice(1)} Agents.`
          });
        }
      }
    }

    // 3. Resolve caller's trusted assigned territory
    const callerState = (req.user?.state || req.user?.assignedState || '').trim();
    const callerDistrict = (req.user?.district || req.user?.assignedDistrict || '').trim();
    const callerDivision = (req.user?.division || req.user?.assignedDivision || '').trim();
    const callerPincode = String(req.user?.pincode || req.user?.assignedPincode || '').trim();
    const callerStateId = req.user?.stateId ? String(req.user.stateId).trim() : null;
    const callerDistrictId = req.user?.districtId ? String(req.user.districtId).trim() : null;
    const callerDivisionId = req.user?.divisionId ? String(req.user.divisionId).trim() : null;
    const callerPincodeId = req.user?.pincodeId ? String(req.user.pincodeId).trim() : null;

    const { state: reqState, district: reqDistrict, division: reqDivision, pincode: reqPincode, stateId: reqStateId, districtId: reqDistrictId, divisionId: reqDivisionId, pincodeId: reqPincodeId } = req.body;

    // 4. Territory authorization checks (reject spoofed / manipulated payload territories)
    if (!isSuperAdmin) {
      // State Admin -> Same assigned state only
      if (permittedLevel === 'state') {
        if (reqState && callerState && callerState.toLowerCase() !== 'all india' && reqState.toLowerCase().trim() !== callerState.toLowerCase()) {
          return res.status(403).json({
            success: false,
            code: 'UNAUTHORIZED_TERRITORY',
            message: `Unauthorized territory. State Admins cannot onboard agents outside their assigned state (${callerState}).`
          });
        }
        if (reqStateId && callerStateId && String(reqStateId).trim() !== callerStateId) {
          return res.status(403).json({
            success: false,
            code: 'UNAUTHORIZED_TERRITORY',
            message: 'Unauthorized territory. State ID mismatch.'
          });
        }
      }
      // District Admin -> Same assigned district only
      else if (permittedLevel === 'district') {
        if (reqState && callerState && callerState.toLowerCase() !== 'all india' && reqState.toLowerCase().trim() !== callerState.toLowerCase()) {
          return res.status(403).json({
            success: false,
            code: 'UNAUTHORIZED_TERRITORY',
            message: 'Unauthorized territory. District Admins cannot onboard agents outside their assigned state.'
          });
        }
        if (reqDistrict && callerDistrict && callerDistrict.toLowerCase() !== 'all districts' && reqDistrict.toLowerCase().trim() !== callerDistrict.toLowerCase()) {
          return res.status(403).json({
            success: false,
            code: 'UNAUTHORIZED_TERRITORY',
            message: `Unauthorized territory. District Admins cannot onboard agents outside their assigned district (${callerDistrict}).`
          });
        }
        if (reqDistrictId && callerDistrictId && String(reqDistrictId).trim() !== callerDistrictId) {
          return res.status(403).json({
            success: false,
            code: 'UNAUTHORIZED_TERRITORY',
            message: 'Unauthorized territory. District ID mismatch.'
          });
        }
      }
      // Division Admin -> Same assigned division only
      else if (permittedLevel === 'division') {
        if (reqState && callerState && callerState.toLowerCase() !== 'all india' && reqState.toLowerCase().trim() !== callerState.toLowerCase()) {
          return res.status(403).json({
            success: false,
            code: 'UNAUTHORIZED_TERRITORY',
            message: 'Unauthorized territory. Division Admins cannot onboard agents outside their assigned state.'
          });
        }
        if (reqDistrict && callerDistrict && callerDistrict.toLowerCase() !== 'all districts' && reqDistrict.toLowerCase().trim() !== callerDistrict.toLowerCase()) {
          return res.status(403).json({
            success: false,
            code: 'UNAUTHORIZED_TERRITORY',
            message: 'Unauthorized territory. Division Admins cannot onboard agents outside their assigned district.'
          });
        }
        if (reqDivision && callerDivision && callerDivision.toLowerCase() !== 'all divisions' && !divisionMatches(reqDivision, callerDivision)) {
          return res.status(403).json({
            success: false,
            code: 'UNAUTHORIZED_TERRITORY',
            message: `Unauthorized territory. Division Admins cannot onboard agents outside their assigned division (${callerDivision}).`
          });
        }
        if (reqDivisionId && callerDivisionId && String(reqDivisionId).trim() !== callerDivisionId) {
          return res.status(403).json({
            success: false,
            code: 'UNAUTHORIZED_TERRITORY',
            message: 'Unauthorized territory. Division ID mismatch.'
          });
        }
      }
      // Pincode Admin -> Same assigned pincode only
      else if (permittedLevel === 'pincode') {
        if (reqPincode && callerPincode && callerPincode !== 'all' && String(reqPincode).trim() !== callerPincode) {
          return res.status(403).json({
            success: false,
            code: 'UNAUTHORIZED_TERRITORY',
            message: `Unauthorized territory. Pincode Admins cannot onboard agents outside their assigned pincode (${callerPincode}).`
          });
        }
        if (reqPincodeId && callerPincodeId && String(reqPincodeId).trim() !== callerPincodeId) {
          return res.status(403).json({
            success: false,
            code: 'UNAUTHORIZED_TERRITORY',
            message: 'Unauthorized territory. Pincode ID mismatch.'
          });
        }
      }
    }

    // 5. Server-side authoritative assigned territory
    let assignedState = isSuperAdmin ? (reqState || 'Tamil Nadu') : (callerState || 'Tamil Nadu');
    let assignedDistrict = isSuperAdmin ? (reqDistrict || null) : (permittedLevel === 'state' ? null : callerDistrict);
    let assignedDivision = isSuperAdmin ? (reqDivision || null) : ((permittedLevel === 'division' || permittedLevel === 'pincode') ? callerDivision : null);
    let assignedPincode = isSuperAdmin ? (reqPincode ? String(reqPincode).trim() : null) : (permittedLevel === 'pincode' ? callerPincode : null);

    if (assignedPincode && (!assignedState || !assignedDistrict || !assignedDivision) && db.pincodes) {
      const pinDoc = Array.from(db.pincodes || []).find(p => String(p.code || p.pincode) === assignedPincode);
      if (pinDoc) {
        if (!assignedState && pinDoc.state) assignedState = pinDoc.state;
        if (!assignedDistrict && pinDoc.district) assignedDistrict = pinDoc.district;
        if (!assignedDivision && pinDoc.division) assignedDivision = pinDoc.division;
      }
    }

    let stateId = callerStateId;
    let districtId = callerDistrictId;
    let divisionId = callerDivisionId;
    let pincodeId = callerPincodeId;

    if (!stateId && assignedState && db.states) {
      const sDoc = Array.from(db.states || []).find(s => s.name?.toLowerCase() === assignedState.toLowerCase());
      if (sDoc) stateId = String(sDoc._id || sDoc.id || sDoc.stateId);
    }
    if (!districtId && assignedDistrict && db.districts) {
      const dDoc = Array.from(db.districts || []).find(d => d.name?.toLowerCase() === assignedDistrict.toLowerCase());
      if (dDoc) districtId = String(dDoc._id || dDoc.id || dDoc.districtId);
    }
    if (!divisionId && assignedDivision && db.divisions) {
      const vDoc = Array.from(db.divisions || []).find(d => divisionMatches(d.name, assignedDivision));
      if (vDoc) divisionId = String(vDoc._id || vDoc.id || vDoc.divisionId);
    }
    if (!pincodeId && assignedPincode && db.pincodes) {
      const pDoc = Array.from(db.pincodes || []).find(p => String(p.code || p.pincode) === assignedPincode);
      if (pDoc) pincodeId = String(pDoc._id || pDoc.id || pDoc.pincodeId);
    }

    // ─────────────────────────────────────────────────────────────────
    // STEP 1 VALIDATION — Account Credentials & Basic Info
    // ─────────────────────────────────────────────────────────────────
    const { name, mobile, phone, email, password, confirmPassword } = req.body;

    // Full Name: 2-100 characters; letters and spaces only
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ success: false, message: 'Full Name is required.' });
    }
    const cleanName = name.trim().replace(/\s{2,}/g, ' ');
    if (cleanName.length < 2 || cleanName.length > 100) {
      return res.status(400).json({ success: false, message: 'Full Name must be between 2 and 100 characters.' });
    }
    if (!/^[a-zA-Z\s.'-]+$/.test(cleanName)) {
      return res.status(400).json({ success: false, message: 'Full Name contains invalid characters. Letters and spaces only.' });
    }

    // Primary Mobile: Exactly 10 digits; starts with 6, 7, 8, or 9
    const rawMobile = String(mobile || phone || '').replace(/\D/g, '');
    const cleanMobile = rawMobile.length === 12 && rawMobile.startsWith('91') ? rawMobile.slice(2) : (rawMobile.length === 11 && rawMobile.startsWith('0') ? rawMobile.slice(1) : rawMobile);
    if (!/^[6-9]\d{9}$/.test(cleanMobile)) {
      return res.status(400).json({ success: false, message: 'Primary Mobile Number must be exactly 10 digits starting with 6, 7, 8, or 9.' });
    }

    // Email Address: Valid email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || typeof email !== 'string' || !emailRegex.test(email.trim())) {
      return res.status(400).json({ success: false, message: 'A valid Email Address is required.' });
    }
    const cleanEmail = email.toLowerCase().trim();

    // Password: Minimum 6 characters, at least one uppercase letter, one number, and one special symbol
    const agentPassword = password || req.body.newPassword;
    if (!agentPassword || typeof agentPassword !== 'string') {
      return res.status(400).json({ success: false, message: 'Password is required.' });
    }
    if (agentPassword.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters long.' });
    }
    if (!/[A-Z]/.test(agentPassword)) {
      return res.status(400).json({ success: false, message: 'Password must contain at least one uppercase letter.' });
    }
    if (!/\d/.test(agentPassword)) {
      return res.status(400).json({ success: false, message: 'Password must contain at least one number.' });
    }
    if (!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(agentPassword)) {
      return res.status(400).json({ success: false, message: 'Password must contain at least one special symbol (e.g. !@#$%^&*).' });
    }

    if (confirmPassword && confirmPassword !== agentPassword) {
      return res.status(400).json({ success: false, message: 'Confirm Password must match the password exactly.' });
    }

    // ─────────────────────────────────────────────────────────────────
    // STEP 2 VALIDATION — Profile, Verification, Territory & Physical Address
    // ─────────────────────────────────────────────────────────────────
    const {
      profilePhoto,
      alternativeMobile,
      dob,
      gender,
      aadhaarNumber,
      panNumber,
      highestQualification,
      experienceLevel,
      previousCompany,
      physicalAddress,
      address
    } = req.body;

    // Profile Photo: Mandatory, max 5 MB
    const agentProfilePhoto = profilePhoto || req.body.avatar || req.body.photo;
    if (!agentProfilePhoto || (typeof agentProfilePhoto === 'string' && !agentProfilePhoto.trim())) {
      return res.status(400).json({ success: false, message: 'Profile Photo is mandatory.' });
    }

    // Alternative Mobile: Mandatory, 10 digits starting with 6-9, different from primary mobile
    const rawAltMobile = String(alternativeMobile || req.body.altMobile || '').replace(/\D/g, '');
    const cleanAltMobile = rawAltMobile.length === 12 && rawAltMobile.startsWith('91') ? rawAltMobile.slice(2) : (rawAltMobile.length === 11 && rawAltMobile.startsWith('0') ? rawAltMobile.slice(1) : rawAltMobile);
    if (!/^[6-9]\d{9}$/.test(cleanAltMobile)) {
      return res.status(400).json({ success: false, message: 'Alternative Mobile Number must be exactly 10 digits starting with 6, 7, 8, or 9.' });
    }
    if (cleanAltMobile === cleanMobile) {
      return res.status(400).json({ success: false, message: 'Alternative Mobile Number cannot be the same as Primary Mobile Number.' });
    }

    // Date of Birth: Mandatory, applicant must be at least 18 years old
    if (!dob || (typeof dob === 'string' && !dob.trim())) {
      return res.status(400).json({ success: false, message: 'Date of Birth is mandatory.' });
    }
    const birthDate = new Date(dob);
    if (isNaN(birthDate.getTime())) {
      return res.status(400).json({ success: false, message: 'Please provide a valid Date of Birth.' });
    }
    const today = new Date();
    let calculatedAge = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      calculatedAge--;
    }
    if (calculatedAge < 18) {
      return res.status(400).json({ success: false, message: 'Applicant must be at least 18 years of age.' });
    }

    // Gender: Mandatory, Male, Female, Other, or Prefer Not to Say
    const validGenders = ['male', 'female', 'other', 'prefer not to say'];
    const cleanGender = String(gender || '').trim();
    if (!cleanGender || !validGenders.includes(cleanGender.toLowerCase())) {
      return res.status(400).json({ success: false, message: 'Valid Gender (Male, Female, Other, or Prefer Not to Say) is required.' });
    }

    // Aadhaar Number: Exactly 12 numeric digits
    const rawAadhaar = String(aadhaarNumber || req.body.aadharNumber || '').replace(/\D/g, '');
    if (!/^\d{12}$/.test(rawAadhaar)) {
      return res.status(400).json({ success: false, message: 'Aadhaar Number must be exactly 12 numeric digits.' });
    }

    // PAN Number: 5 letters, 4 digits, 1 letter
    const cleanPAN = String(panNumber || '').trim().toUpperCase();
    if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(cleanPAN)) {
      return res.status(400).json({ success: false, message: 'PAN Number must be valid format: 5 letters, 4 digits, 1 letter (e.g. ABCDE1234F).' });
    }

    // Qualification & Experience Level
    const cleanQualification = String(highestQualification || req.body.qualification || '').trim();
    if (!cleanQualification) {
      return res.status(400).json({ success: false, message: 'Highest Qualification is mandatory.' });
    }

    const cleanExperienceLevel = String(experienceLevel || req.body.experience || '').trim();
    if (!cleanExperienceLevel) {
      return res.status(400).json({ success: false, message: 'Experience Level is mandatory.' });
    }

    // Previous Company Name: Mandatory for experienced, 'N/A' for Fresher
    let cleanPreviousCompany = String(previousCompany || '').trim();
    if (cleanExperienceLevel.toLowerCase().includes('fresher')) {
      cleanPreviousCompany = 'N/A';
    } else {
      if (!cleanPreviousCompany || cleanPreviousCompany === 'N/A') {
        return res.status(400).json({ success: false, message: 'Previous Company Name is mandatory for experienced candidates.' });
      }
    }

    // Physical / Contact Address — All 8 fields are mandatory
    const physAddr = physicalAddress || address || req.body;
    const doorNo = String(physAddr.doorNo || physAddr.doorStreet || physAddr.buildingNo || physAddr.building || '').trim();
    const street = String(physAddr.street || physAddr.streetName || physAddr.area || '').trim();
    const village = String(physAddr.village || physAddr.locality || '').trim();
    const postOffice = String(physAddr.postOffice || '').trim();
    const taluk = String(physAddr.taluk || '').trim();
    const physicalState = String(physAddr.physicalState || physAddr.state || '').trim();
    const physicalDistrict = String(physAddr.physicalDistrict || physAddr.district || '').trim();
    const rawPhysicalPincode = String(physAddr.physicalPincode || physAddr.pincode || '').replace(/\D/g, '');

    if (!doorNo) return res.status(400).json({ success: false, message: 'Physical Address: Building No / Door No / Shop No is required.' });
    if (!street) return res.status(400).json({ success: false, message: 'Physical Address: Street Name / Area is required.' });
    if (!village) return res.status(400).json({ success: false, message: 'Physical Address: Village / Locality is required.' });
    if (!postOffice) return res.status(400).json({ success: false, message: 'Physical Address: Post Office is required.' });
    if (!taluk) return res.status(400).json({ success: false, message: 'Physical Address: Taluk is required.' });
    if (!physicalState) return res.status(400).json({ success: false, message: 'Physical Address: State is required.' });
    if (!physicalDistrict) return res.status(400).json({ success: false, message: 'Physical Address: District is required.' });
    if (!/^[1-9][0-9]{5}$/.test(rawPhysicalPincode)) {
      return res.status(400).json({ success: false, message: 'Physical Address: PIN code must be exactly 6 numeric digits.' });
    }

    // ─────────────────────────────────────────────────────────────────
    // STEP 3 VALIDATION — Bank Details (All 3 fields mandatory)
    // ─────────────────────────────────────────────────────────────────
    const bankData = req.body.bankDetails || req.body;
    const bankName = String(bankData.bankName || '').trim();
    const rawAccountNumber = String(bankData.accountNumber || '').replace(/\D/g, '');
    const ifscCode = String(bankData.ifscCode || '').trim().toUpperCase();

    if (!bankName) {
      return res.status(400).json({ success: false, message: 'Bank Name is mandatory in Step 3.' });
    }
    if (!rawAccountNumber || rawAccountNumber.length < 9 || rawAccountNumber.length > 18) {
      return res.status(400).json({ success: false, message: 'Bank Account Number must be between 9 and 18 numeric digits.' });
    }
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifscCode)) {
      return res.status(400).json({ success: false, message: 'IFSC Code must be valid format (11 characters, 5th character must be "0", e.g. SBIN0001234).' });
    }

    const maskedAccountNumber = `••••••••${rawAccountNumber.slice(-4)}`;

    // ─────────────────────────────────────────────────────────────────
    // STEP 4 VALIDATION — Documents Upload & Declarations
    // ─────────────────────────────────────────────────────────────────
    const docs = req.body.documents || req.body;
    let aadhaarCard = docs.aadhaarCard || docs.aadhaarCardFront || docs.aadharPhoto || docs.aadharDocUrl;
    let panCard = docs.panCard || docs.panPhoto || docs.panDocUrl;
    let passportPhoto = docs.passportPhoto || agentProfilePhoto;
    let digitalSignature = docs.digitalSignature || docs.signaturePhoto || docs.signatureDocUrl;
    let educationalCertificate = docs.educationalCertificate || docs.educationalCertificates || null;
    let bankProof = docs.bankProof || docs.cancelledCheque || docs.bankPassbookPhoto || null;

    // Save base64 KYC documents to local storage
    const uploadKycDoc = async (docVal, name) => {
      if (docVal && typeof docVal === 'string' && docVal.startsWith('data:')) {
        try {
          const uploadRes = await uploadFile(docVal, 'agent_docs/kyc', `exec_${Date.now()}_${name}`);
          return uploadRes.url || uploadRes.key;
        } catch (e) {
          console.error(`Failed to store ${name}:`, e);
          return docVal;
        }
      }
      return docVal;
    };

    aadhaarCard = await uploadKycDoc(aadhaarCard, 'aadhaar');
    panCard = await uploadKycDoc(panCard, 'pan');
    passportPhoto = await uploadKycDoc(passportPhoto, 'passport');
    digitalSignature = await uploadKycDoc(digitalSignature, 'signature');
    if (educationalCertificate) educationalCertificate = await uploadKycDoc(educationalCertificate, 'education');
    if (bankProof) bankProof = await uploadKycDoc(bankProof, 'bankProof');

    if (!aadhaarCard) {
      return res.status(400).json({ success: false, message: 'Aadhaar Card document upload is mandatory.' });
    }
    if (!panCard) {
      return res.status(400).json({ success: false, message: 'PAN Card document upload is mandatory.' });
    }
    if (!passportPhoto) {
      return res.status(400).json({ success: false, message: 'Passport Photo is mandatory.' });
    }
    if (!digitalSignature) {
      return res.status(400).json({ success: false, message: 'Digital Signature document upload is mandatory.' });
    }

    // 3 Legal Declarations must all be accepted
    const decl = req.body.declarations || req.body;
    const declTruth = decl.truthfulness === true || decl.declarationTruthfulness === true || String(decl.declarationTruthfulness) === 'true';
    const declTerms = decl.termsAndPrivacy === true || decl.declarationTerms === true || String(decl.declarationTerms) === 'true';
    const declApproval = decl.adminVerification === true || decl.declarationAdminVerification === true || String(decl.declarationAdminVerification) === 'true';

    if (!declTruth) {
      return res.status(400).json({ success: false, message: 'You must confirm that all submitted information is correct and true.' });
    }
    if (!declTerms) {
      return res.status(400).json({ success: false, message: 'You must agree to the Terms & Conditions and Privacy Policy.' });
    }
    if (!declApproval) {
      return res.status(400).json({ success: false, message: 'You must acknowledge that onboarding is subject to administration verification and approval.' });
    }

    // ─────────────────────────────────────────────────────────────────
    // DUPLICATE CHECKS
    // ─────────────────────────────────────────────────────────────────
    const isDupAgent = Array.from(db.agents || []).some(a =>
      (a.email && a.email.toLowerCase().trim() === cleanEmail) ||
      (a.phone && a.phone.replace(/\D/g, '') === cleanMobile) ||
      (a.mobile && a.mobile.replace(/\D/g, '') === cleanMobile) ||
      (a.aadhaarNumber && String(a.aadhaarNumber).replace(/\D/g, '') === rawAadhaar) ||
      (a.panNumber && String(a.panNumber).toUpperCase().trim() === cleanPAN)
    );
    const isDupUser = Array.from(db.users || []).some(u =>
      (u.email && u.email.toLowerCase().trim() === cleanEmail) ||
      (u.mobile && String(u.mobile).replace(/\D/g, '') === cleanMobile) ||
      (u.phone && String(u.phone).replace(/\D/g, '') === cleanMobile) ||
      (u.aadhaarNumber && String(u.aadhaarNumber).replace(/\D/g, '') === rawAadhaar) ||
      (u.panNumber && String(u.panNumber).toUpperCase().trim() === cleanPAN)
    );

    if (isDupAgent || isDupUser) {
      return res.status(409).json({
        success: false,
        message: 'An agent with this mobile number, email, Aadhaar, or PAN already exists in the platform.'
      });
    }

    // ─────────────────────────────────────────────────────────────────
    // SECURE PASSWORD HASHING & RECORD CREATION
    // ─────────────────────────────────────────────────────────────────
    const passwordHash = await bcrypt.hash(agentPassword, 10);

    const randPart = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    const newId = `AGT-${Date.now().toString().slice(-6)}${randPart}`;
    const regId = `REG-AGT-${Date.now().toString().slice(-6)}`;
    const now = new Date().toISOString();

    const roleString = `${permittedLevel}_agent`;
    const roleTitleString = `${permittedLevel.charAt(0).toUpperCase() + permittedLevel.slice(1)} Agent`;

    const newAgent = {
      _id: newId,
      id: newId,
      name: cleanName,
      applicantName: cleanName,
      email: cleanEmail,
      phone: cleanMobile,
      mobile: cleanMobile,
      alternativeMobile: cleanAltMobile,
      password: passwordHash,
      passwordHash: passwordHash,
      dob: String(dob).split('T')[0],
      age: calculatedAge,
      gender: cleanGender,
      aadhaarNumber: `••••••••${rawAadhaar.slice(-4)}`,
      aadhaarNumberClean: rawAadhaar,
      panNumber: cleanPAN,
      highestQualification: cleanQualification,
      qualification: cleanQualification,
      experienceLevel: cleanExperienceLevel,
      previousCompany: cleanPreviousCompany,
      profilePhoto: agentProfilePhoto,
      role: roleString,
      level: permittedLevel,
      roleTitle: roleTitleString,
      registrationId: regId,
      // Assigned Organizational Territory
      territory: {
        state: assignedState,
        district: assignedDistrict || null,
        division: assignedDivision || null,
        pincode: assignedPincode || null
      },
      state: assignedState,
      district: assignedDistrict || null,
      division: assignedDivision || null,
      pincode: assignedPincode || null,
      stateId: stateId || null,
      districtId: districtId || null,
      divisionId: divisionId || null,
      pincodeId: pincodeId || null,
      // Physical Contact Address (Kept separate from organizational territory)
      address: {
        doorNo,
        street,
        village,
        postOffice,
        taluk,
        state: physicalState,
        district: physicalDistrict,
        pincode: rawPhysicalPincode
      },
      // Bank Details
      bankDetails: {
        bankName,
        accountNumber: rawAccountNumber,
        accountNumberMasked: maskedAccountNumber,
        ifscCode,
        accountHolderName: cleanName
      },
      // KYC Documents
      documents: {
        aadhaarCard,
        aadhaarCardFront: docs.aadhaarCardFront || aadhaarCard,
        aadhaarCardBack: docs.aadhaarCardBack || null,
        panCard,
        passportPhoto,
        digitalSignature,
        educationalCertificate,
        bankProof
      },
      // Legal Declarations
      declarations: {
        truthfulness: true,
        termsAndPrivacy: true,
        adminVerification: true,
        acceptedAt: now
      },
      status: 'pending',
      adminApprovalStatus: 'pending',
      kycStatus: 'pending_verification',
      isActive: false,
      isApproved: false,
      requiresApproval: true,
      isFullyApproved: false,
      onboardedBy: req.user.name || req.user.email,
      onboardedById: req.user.id || req.user._id,
      onboardedByRole: req.user.role,
      creatorId: req.user.id || req.user._id,
      creatorRole: req.user.role,
      creatorTerritory: {
        state: callerState || null,
        district: callerDistrict || null,
        division: callerDivision || null,
        pincode: callerPincode || null
      },
      onboardingSource: 'sub_admin_portal',
      registrationDate: now,
      totalReferrals: 0,
      vendorOnboardings: 0,
      walletBalance: 0,
      totalEarned: 0,
      reviewHistory: [
        {
          action: 'ONBOARDED',
          status: 'pending',
          reviewerId: req.user.id || req.user._id,
          reviewerName: req.user.name || req.user.email,
          reviewerRole: req.user.role,
          reviewedAt: now,
          notes: `Agent onboarded by ${req.user.role} "${req.user.name || req.user.email}". Awaiting territory approval.`
        }
      ],
      createdAt: now,
      updatedAt: now
    };

    if (db.agents && typeof db.agents.initMongo === 'function' && !db.agents._mongoCol) {
      try {
        const { getMongoDb } = require('../config/mongo');
        const mdb = await getMongoDb();
        if (mdb) {
          await db.agents.initMongo(mdb);
        }
      } catch (err) {
        // silent fallback
      }
    }

    if (db.agents) {
      await db.agents.insertOne(newAgent);
    }

    if (db.users) {
      await db.users.insertOne({
        _id: newId,
        id: newId,
        name: cleanName,
        email: cleanEmail,
        mobile: cleanMobile,
        phone: cleanMobile,
        password: passwordHash,
        passwordHash: passwordHash,
        role: roleString,
        level: permittedLevel,
        state: assignedState,
        district: assignedDistrict || null,
        division: assignedDivision || null,
        pincode: assignedPincode || null,
        stateId: stateId || null,
        districtId: districtId || null,
        divisionId: divisionId || null,
        pincodeId: pincodeId || null,
        status: 'pending',
        adminApprovalStatus: 'pending',
        kycStatus: 'pending_verification',
        isActive: false,
        isApproved: false,
        requiresApproval: true,
        createdAt: now,
        updatedAt: now
      }).catch(() => {});
    }

    if (db.auditLogs) {
      await db.auditLogs.insertOne({
        id: `AUD-${Date.now()}`,
        userId: req.user.id || req.user._id,
        userName: req.user.name || req.user.email,
        userRole: req.user.role,
        action: 'AGENT_ONBOARDED',
        module: 'Agents',
        details: `${req.user.role} "${req.user.name || req.user.email}" onboarded ${permittedLevel} agent "${cleanName}" for territory ${[assignedPincode, assignedDivision, assignedDistrict, assignedState].filter(Boolean).join(', ')}.`,
        ip: req.ip || '127.0.0.1',
        timestamp: now
      }).catch(() => {});
    }

    // Sanitize response to protect confidential information
    const sanitizedAgent = { ...newAgent };
    delete sanitizedAgent.password;
    delete sanitizedAgent.passwordHash;
    if (sanitizedAgent.bankDetails) {
      sanitizedAgent.bankDetails = {
        ...sanitizedAgent.bankDetails,
        accountNumber: maskedAccountNumber
      };
    }

    return res.status(201).json({
      success: true,
      message: `${roleTitleString} onboarded successfully! Awaiting territory verification and approval.`,
      agent: sanitizedAgent
    });
  } catch (error) {
    console.error('Failed to onboard agent:', error);
    return res.status(500).json({ success: false, message: 'Failed to onboard agent', error: error.message });
  }
}

// ─────────────────────────────────────────────────────────────────
// GET /operations/agents/hierarchy
// ─────────────────────────────────────────────────────────────────
async function getAgentHierarchy(req, res) {
  try {
    if (db.agents && typeof db.agents.reloadFromMongo === 'function' && db.agents._mongoCol) {
      try {
        await db.agents.reloadFromMongo(false);
      } catch (err) {
        // silent
      }
    }
    const rawAgents = Array.from(db.agents);
    const scopedAgents = getHierarchicalScopedAgents(rawAgents, req.user);

    const stateAgents    = scopedAgents.filter(a => normalizeLevel(getAgentLevel(a)) === 'state');
    const districtAgents = scopedAgents.filter(a => normalizeLevel(getAgentLevel(a)) === 'district');
    const divisionAgents = scopedAgents.filter(a => normalizeLevel(getAgentLevel(a)) === 'division');
    const pincodeAgents  = scopedAgents.filter(a => normalizeLevel(getAgentLevel(a)) === 'pincode');

    // Build hierarchy tree rooted at the highest authorized tier for the user
    let tree = [];
    if (stateAgents.length > 0) {
      tree = stateAgents.map(stateAg => {
        const stT = getAgentTerritory(stateAg);
        const relatedDistricts = districtAgents.filter(d => {
          const dT = getAgentTerritory(d);
          return stT.state && dT.state && dT.state.toLowerCase() === stT.state.toLowerCase();
        });
        return {
          ...stateAg,
          children: relatedDistricts.map(distAg => {
            const dT = getAgentTerritory(distAg);
            const relatedDivisions = divisionAgents.filter(div => {
              const divT = getAgentTerritory(div);
              return dT.district && divT.district && divT.district.toLowerCase() === dT.district.toLowerCase();
            });
            return {
              ...distAg,
              children: relatedDivisions.map(divAg => {
                const vT = getAgentTerritory(divAg);
                const relatedPincodes = pincodeAgents.filter(pin => {
                  const pT = getAgentTerritory(pin);
                  return divisionMatches(vT.division, pT.division);
                });
                return { ...divAg, children: relatedPincodes };
              })
            };
          })
        };
      });
    } else if (districtAgents.length > 0) {
      // Root at district level for District Admin
      tree = districtAgents.map(distAg => {
        const dT = getAgentTerritory(distAg);
        const relatedDivisions = divisionAgents.filter(div => {
          const divT = getAgentTerritory(div);
          return dT.district && divT.district && divT.district.toLowerCase() === dT.district.toLowerCase();
        });
        return {
          ...distAg,
          children: relatedDivisions.map(divAg => {
            const vT = getAgentTerritory(divAg);
            const relatedPincodes = pincodeAgents.filter(pin => {
              const pT = getAgentTerritory(pin);
              return divisionMatches(vT.division, pT.division);
            });
            return { ...divAg, children: relatedPincodes };
          })
        };
      });
    } else if (divisionAgents.length > 0) {
      // Root at division level for Divisional Admin
      tree = divisionAgents.map(divAg => {
        const vT = getAgentTerritory(divAg);
        const relatedPincodes = pincodeAgents.filter(pin => {
          const pT = getAgentTerritory(pin);
          return divisionMatches(vT.division, pT.division);
        });
        return { ...divAg, children: relatedPincodes };
      });
    } else {
      // Pincode level
      tree = pincodeAgents.map(pin => ({ ...pin, children: [] }));
    }

    return res.json({
      success: true,
      summary: {
        totalStateAgents: stateAgents.length,
        totalDistrictAgents: districtAgents.length,
        totalDivisionalAgents: divisionAgents.length,
        totalPincodeAgents: pincodeAgents.length,
        hierarchyChain: 'State Agent -> District Agent -> Divisional Agent -> Pincode Agent'
      },
      tree,
      allAgents: scopedAgents
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to fetch agent hierarchy', error: error.message });
  }
}

// ─────────────────────────────────────────────────────────────────
// GET /operations/agents/activities
// ─────────────────────────────────────────────────────────────────
function getAgentActivities(req, res) {
  try {
    let activities = Array.from(db.agentActivities || []);
    const user = req.user;
    const userRole = String(user?.role || '').toLowerCase().replace(/_/g, ' ').trim();

    if (userRole.includes('super admin') || userRole === 'admin' || userRole === 'super-admin' || user?.state === 'All India') {
      // Super Admin: all activities
    } else if (userRole.includes('pincode')) {
      const pin = user?.pincode ? String(user.pincode).trim() : '';
      if (!pin) activities = [];
      else activities = activities.filter(act => act.pincode && String(act.pincode).trim() === pin);
    } else if (userRole.includes('division') || userRole.includes('divisional')) {
      const div = user?.division ? String(user.division).trim() : '';
      if (!div) activities = [];
      else {
        activities = activities.filter(act => {
          const matchesDiv = divisionMatches(act.division, div);
          const matchesDist = !user.district || (act.district && act.district.toLowerCase() === user.district.toLowerCase());
          const matchesState = !user.state || (act.state && act.state.toLowerCase() === user.state.toLowerCase());
          return matchesDiv && matchesDist && matchesState;
        });
      }
    } else if (userRole.includes('district')) {
      const dist = user?.district ? String(user.district).trim().toLowerCase() : '';
      if (!dist) activities = [];
      else {
        activities = activities.filter(act => {
          const matchesDist = act.district && act.district.toLowerCase() === dist;
          const matchesState = !user.state || (act.state && act.state.toLowerCase() === user.state.toLowerCase());
          return matchesDist && matchesState;
        });
      }
    } else if (userRole.includes('state')) {
      const st = user?.state ? String(user.state).trim().toLowerCase() : '';
      if (!st) activities = [];
      else {
        activities = activities.filter(act => act.state && act.state.toLowerCase() === st);
      }
    } else if (userRole.includes('manager')) {
      activities = activities.filter(act => {
        if (user.pincode && (!act.pincode || String(act.pincode).trim() !== String(user.pincode).trim())) return false;
        if (user.division && (!act.division || !divisionMatches(act.division, user.division))) return false;
        if (user.district && (!act.district || act.district.toLowerCase() !== user.district.toLowerCase())) return false;
        if (user.state && (!act.state || act.state.toLowerCase() !== user.state.toLowerCase())) return false;
        return true;
      });
    }

    const { stage, status, type, pincode, division, district, search } = req.query;

    if (stage) activities = activities.filter(a => a.currentStage && a.currentStage.toLowerCase().includes(stage.toLowerCase()));
    if (status) activities = activities.filter(a => a.status && a.status.toLowerCase().includes(status.toLowerCase()));
    if (type) activities = activities.filter(a => a.type && a.type.toLowerCase().includes(type.toLowerCase()));
    if (district) activities = activities.filter(a => a.district && a.district.toLowerCase() === district.toLowerCase());
    if (division) activities = activities.filter(a => a.division && a.division.toLowerCase() === division.toLowerCase());
    if (pincode) activities = activities.filter(a => a.pincode && a.pincode.toString() === pincode.toString());
    if (search) {
      const q = search.toLowerCase();
      activities = activities.filter(a =>
        (a.title && a.title.toLowerCase().includes(q)) ||
        (a.vendorDetails && a.vendorDetails.name && a.vendorDetails.name.toLowerCase().includes(q)) ||
        (a.pincodeAgent && a.pincodeAgent.name && a.pincodeAgent.name.toLowerCase().includes(q)) ||
        (a.pincode && String(a.pincode).includes(q))
      );
    }

    return res.json({ success: true, count: activities.length, activities });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to fetch agent activities', error: error.message });
  }
}

// ─────────────────────────────────────────────────────────────────
// POST /operations/agents/activities
// ─────────────────────────────────────────────────────────────────
async function createAgentActivity(req, res) {
  try {
    const {
      vendorName,
      category = 'Services',
      contactPerson,
      phone,
      address,
      pincode = '636001',
      division = 'Salem North',
      district = 'Salem',
      state = 'Tamil Nadu',
      notes = 'Initial ground survey and document submission by pincode agent'
    } = req.body;

    if (!vendorName) {
      return res.status(400).json({ success: false, message: 'Vendor name is required' });
    }

    // Find agents by normalized level (uses role field for db.agents records)
    const pincodeAgent = db.agents.find(a =>
      normalizeLevel(getAgentLevel(a)) === 'pincode' &&
      getAgentTerritory(a).pincode === String(pincode)
    ) || db.agents.find(a => normalizeLevel(getAgentLevel(a)) === 'pincode') || {
      id: 'AGT-UNASSIGNED', name: 'Unassigned Pincode Agent', phone: '-', pincode
    };

    const divAgent = db.agents.find(a =>
      normalizeLevel(getAgentLevel(a)) === 'division' &&
      getAgentTerritory(a).division.toLowerCase() === division.toLowerCase()
    ) || { id: 'AGT-UNASSIGNED', name: 'Unassigned Divisional Agent', division };

    const distAgent = db.agents.find(a =>
      normalizeLevel(getAgentLevel(a)) === 'district' &&
      getAgentTerritory(a).district.toLowerCase() === district.toLowerCase()
    ) || { id: 'AGT-UNASSIGNED', name: 'Unassigned District Agent', district };

    const stAgent = db.agents.find(a =>
      normalizeLevel(getAgentLevel(a)) === 'state' &&
      getAgentTerritory(a).state.toLowerCase() === state.toLowerCase()
    ) || db.agents.find(a => normalizeLevel(getAgentLevel(a)) === 'state') ||
      { id: 'AGT-UNASSIGNED', name: 'Unassigned State Agent', state };

    const newId = `ACT-VND-${String((db.agentActivities?.length || 0) + 1).padStart(3, '0')}`;
    const now = new Date();
    const formattedDate = now.toISOString().split('T')[0];
    const formattedTime = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const newActivity = {
      id: newId,
      type: 'Vendor Onboarding',
      title: `Vendor Onboarding: ${vendorName}`,
      description: `Field vendor onboarding and KYC paper collection by ${pincodeAgent.name} (PIN: ${pincode}).`,
      state, district, division, pincode, category,
      vendorDetails: {
        id: `VND-NEW-${Date.now().toString().slice(-4)}`,
        name: vendorName,
        contactPerson: contactPerson || 'Merchant Contact',
        phone: phone || '+91 98000 00000',
        address: address || `${pincode}, ${division}, ${district}`,
        category
      },
      pincodeAgent: {
        id: pincodeAgent.id || pincodeAgent._id,
        name: pincodeAgent.name,
        phone: pincodeAgent.phone,
        pincode: getAgentTerritory(pincodeAgent).pincode || pincode
      },
      divisionalAgent: {
        id: divAgent.id || divAgent._id,
        name: divAgent.name,
        division: getAgentTerritory(divAgent).division || division
      },
      districtAgent: {
        id: distAgent.id || distAgent._id,
        name: distAgent.name,
        district: getAgentTerritory(distAgent).district || district
      },
      stateAgent: {
        id: stAgent.id || stAgent._id,
        name: stAgent.name,
        state: getAgentTerritory(stAgent).state || state
      },
      currentStage: 'Divisional Agent',
      status: 'Divisional Review',
      flowStages: [
        { stage: 'Pincode Agent', actor: `${pincodeAgent.name} (PIN ${pincode})`, action: 'Onboarding Initiated', status: 'Completed', timestamp: `${formattedDate} ${formattedTime}`, notes: notes || 'Merchant enrolled on ground, KYC submitted.' },
        { stage: 'Divisional Agent', actor: `${divAgent.name} (${division})`, action: 'Under Review', status: 'In Progress', timestamp: `${formattedDate} ${formattedTime}`, notes: 'Awaiting divisional cluster verification.' },
        { stage: 'District Agent', actor: `${distAgent.name} (${district})`, action: 'Pending Divisional Verification', status: 'Queued', timestamp: null, notes: 'Territorial oversight queued.' },
        { stage: 'State Agent', actor: `${stAgent.name} (${state})`, action: 'Pending District Endorsement', status: 'Queued', timestamp: null, notes: 'State tracking enabled.' }
      ],
      commissionAmount: 1500,
      createdDate: formattedDate,
      completedDate: null
    };

    if (!db.agentActivities) db.agentActivities = [];
    await db.agentActivities.insertOne(newActivity);

    const foundAgent = db.agents.find(a => String(a.id || a._id) === String(pincodeAgent.id || pincodeAgent._id));
    if (foundAgent) {
      const updatedOnboardings = (foundAgent.vendorOnboardings || 0) + 1;
      await db.agents.findByIdAndUpdate(foundAgent.id || foundAgent._id, { vendorOnboardings: updatedOnboardings });
    }

    return res.status(201).json({ success: true, message: 'Vendor onboarding activity created and routed to Divisional Agent', activity: newActivity });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to create agent activity', error: error.message });
  }
}

// ─────────────────────────────────────────────────────────────────
// PATCH /operations/agents/activities/:id/advance
// ─────────────────────────────────────────────────────────────────
async function advanceAgentActivity(req, res) {
  try {
    const { id } = req.params;
    const { notes } = req.body;
    const activity = (db.agentActivities || []).find(a => String(a.id || a._id) === String(id));

    if (!activity) {
      return res.status(404).json({ success: false, message: 'Activity record not found' });
    }

    const now = new Date();
    const formattedDate = now.toISOString().split('T')[0];
    const formattedTime = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    if (activity.currentStage === 'Divisional Agent') {
      activity.currentStage = 'District Agent';
      activity.status = 'District Review';
      activity.flowStages[1].status = 'Completed';
      activity.flowStages[1].action = 'Division Verified';
      activity.flowStages[1].timestamp = `${formattedDate} ${formattedTime}`;
      if (notes) activity.flowStages[1].notes = notes;
      activity.flowStages[2].status = 'In Progress';
      activity.flowStages[2].action = 'Under Review';
      activity.flowStages[2].timestamp = `${formattedDate} ${formattedTime}`;
    } else if (activity.currentStage === 'District Agent') {
      activity.currentStage = 'State Agent';
      activity.status = 'State Review';
      activity.flowStages[2].status = 'Completed';
      activity.flowStages[2].action = 'District Endorsed';
      activity.flowStages[2].timestamp = `${formattedDate} ${formattedTime}`;
      if (notes) activity.flowStages[2].notes = notes;
      activity.flowStages[3].status = 'In Progress';
      activity.flowStages[3].action = 'Final Verification';
      activity.flowStages[3].timestamp = `${formattedDate} ${formattedTime}`;
    } else if (activity.currentStage === 'State Agent' && activity.status !== 'State Approved') {
      activity.status = 'State Approved';
      activity.completedDate = formattedDate;
      activity.flowStages[3].status = 'Completed';
      activity.flowStages[3].action = 'Statewide Activation';
      activity.flowStages[3].timestamp = `${formattedDate} ${formattedTime}`;
      if (notes) activity.flowStages[3].notes = notes;

      const pinAgent = db.agents.find(a => String(a.id || a._id) === String(activity.pincodeAgent?.id));
      if (pinAgent) {
        const newBal = (pinAgent.walletBalance || 0) + (activity.commissionAmount || 1500);
        const newEarned = (pinAgent.totalEarned || 0) + (activity.commissionAmount || 1500);
        await db.agents.findByIdAndUpdate(pinAgent.id || pinAgent._id, {
          walletBalance: newBal,
          totalEarned: newEarned
        });
      }
    }

    await db.agentActivities.findByIdAndUpdate(activity.id || activity._id, activity);

    return res.json({ success: true, message: `Activity advanced to ${activity.currentStage} (${activity.status})`, activity });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to advance activity', error: error.message });
  }
}

function getDeliveryPartners(req, res) {
  try {
    let scoped = filterByLocation(Array.from(db.deliveryPartners || []), req.user);
    return res.json({ success: true, count: scoped.length, deliveryPartners: scoped, data: scoped });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to fetch delivery partners', error: error.message });
  }
}

function isRelatedAdminForAgent(admin, agent) {
  if (!admin || !agent) return false;
  const adminRole = String(admin.role || '').toLowerCase().replace(/_/g, ' ').replace(/-/g, ' ').trim();
  const adminUserRole = String(admin.adminRole || '').toLowerCase().replace(/_/g, ' ').replace(/-/g, ' ').trim();

  // Non-administrative roles (managers, agents, customers, vendors) cannot approve
  if (!adminRole.includes('admin') || adminRole.includes('manager') || adminRole.includes('agent')) {
    return false;
  }

  // Global Unscoped Super Admin can approve all
  const isSuper = (adminRole === 'super admin' || adminRole === 'main admin' || (adminRole === 'admin' && !adminUserRole.includes('state') && !adminUserRole.includes('district') && !adminUserRole.includes('division') && !adminUserRole.includes('pincode') && !admin.level?.includes('state'))) && (!admin.state || admin.state.toLowerCase() === 'all india');
  if (isSuper) return true;

  const aLevel = normalizeLevel(getAgentLevel(agent));
  const t = getAgentTerritory(agent);

  const clean = (val) => String(val || '').trim().toLowerCase().replace(/\s+(district|division|state)$/, '').trim();
  const uState = clean(admin.state || admin.assignedState);
  const tState = clean(t.state);
  const uDist = clean(admin.district || admin.assignedDistrict);
  const tDist = clean(t.district);
  const uDiv = clean(admin.division || admin.assignedDivision);
  const tDiv = clean(t.division);
  const uPin = String(admin.pincode || admin.assignedPincode || '').trim();
  const tPin = String(t.pincode || '').trim();

  // 1. State Agent -> ONLY State Admin of the same state
  if (aLevel === 'state') {
    if (!adminRole.includes('state') && !(adminRole === 'admin' && uState)) return false;
    return Boolean(uState && tState && uState === tState);
  }

  // 2. District Agent -> ONLY District Admin of the same district
  if (aLevel === 'district') {
    if (!adminRole.includes('district')) return false;
    const matchState = !uState || uState === 'all india' || (tState && tState === uState);
    return Boolean(matchState && uDist && tDist && uDist === tDist);
  }

  // 3. Division Agent -> ONLY Division Admin of the same division
  if (aLevel === 'division' || aLevel === 'divisional') {
    if (!adminRole.includes('division') && !adminRole.includes('divisional')) return false;
    const matchState = !uState || uState === 'all india' || (tState && tState === uState);
    const matchDist = matchState && (!uDist || uDist === 'all districts' || (tDist && tDist === uDist));
    return Boolean(matchDist && uDiv && tDiv && (uDiv === tDiv || divisionMatches(t.division, admin.division)));
  }

  // 4. Pincode Agent -> ONLY Pincode Admin of the same pincode
  if (aLevel === 'pincode') {
    if (!adminRole.includes('pincode')) return false;
    const matchState = !uState || uState === 'all india' || (tState && tState === uState);
    const matchDist = matchState && (!uDist || uDist === 'all districts' || (tDist && tDist === uDist));
    const matchDiv = matchDist && (!uDiv || uDiv === 'all divisions' || (tDiv && (tDiv === uDiv || divisionMatches(t.division, admin.division))));
    return Boolean(matchDiv && uPin && tPin && uPin === tPin);
  }

  return false;
}

function canAdminViewAgent(admin, agent) {
  if (!admin || !agent) return false;
  const adminRole = String(admin.role || '').toLowerCase().replace(/_/g, ' ').replace(/-/g, ' ').trim();
  const adminUserRole = String(admin.adminRole || '').toLowerCase().replace(/_/g, ' ').replace(/-/g, ' ').trim();
  const isSuper = (adminRole === 'super admin' || adminRole === 'main admin' || (adminRole === 'admin' && !adminUserRole.includes('state') && !adminUserRole.includes('district') && !adminUserRole.includes('division') && !adminUserRole.includes('pincode') && !admin.level?.includes('state'))) && (!admin.state || admin.state.toLowerCase() === 'all india');
  if (isSuper) return true;

  const aLevel = normalizeLevel(getAgentLevel(agent));
  const t = getAgentTerritory(agent);

  const clean = (val) => String(val || '').trim().toLowerCase().replace(/\s+(district|division|state)$/, '').trim();
  const uState = clean(admin.state || admin.assignedState);
  const tState = clean(t.state);
  const uDist = clean(admin.district || admin.assignedDistrict);
  const tDist = clean(t.district);
  const uDiv = clean(admin.division || admin.assignedDivision);
  const tDiv = clean(t.division);
  const uPin = String(admin.pincode || admin.assignedPincode || '').trim();
  const tPin = String(t.pincode || '').trim();

  // State Admin (or state-scoped admin): can view all agents within their state
  if (adminRole.includes('state') || (adminRole === 'admin' && uState)) {
    if (!uState || uState === 'all india') return true;
    return Boolean(tState && tState === uState);
  }

  // District Admin: can view district, division, and pincode agents in their district
  if (adminRole.includes('district')) {
    if (aLevel === 'state') return false;
    const matchState = !uState || uState === 'all india' || (tState && tState === uState);
    return Boolean(matchState && (!uDist || uDist === 'all districts' || (tDist && tDist === uDist)));
  }

  // Division Admin: can view division and pincode agents in their division
  if (adminRole.includes('division') || adminRole.includes('divisional')) {
    if (aLevel === 'state' || aLevel === 'district') return false;
    // Direct division match
    if (uDiv && tDiv && (tDiv === uDiv || divisionMatches(t.division, admin.division))) return true;
    const matchState = !uState || uState === 'all india' || (tState && tState === uState);
    const matchDist = matchState && (!uDist || uDist === 'all districts' || (tDist && tDist === uDist));
    return Boolean(matchDist && (!uDiv || uDiv === 'all divisions' || (tDiv && (tDiv === uDiv || divisionMatches(t.division, admin.division)))));
  }

  // Pincode Admin: can view pincode agents in their pincode
  if (adminRole.includes('pincode')) {
    if (aLevel !== 'pincode') return false;
    // Direct PIN code match:
    if (uPin && tPin && tPin === uPin) return true;
    const matchState = !uState || uState === 'all india' || (tState && tState === uState);
    const matchDist = matchState && (!uDist || uDist === 'all districts' || (tDist && tDist === uDist));
    const matchDiv = matchDist && (!uDiv || uDiv === 'all divisions' || (tDiv && (tDiv === uDiv || divisionMatches(t.division, admin.division))));
    return Boolean(matchDiv && (!uPin || uPin === 'all' || (tPin && tPin === uPin)));
  }

  return false;
}

async function getAgentRequests(req, res) {
  try {
    const userRole = String(req.user?.role || '').toLowerCase().replace(/_/g, ' ').replace(/-/g, ' ').trim();
    const adminUserRole = String(req.user?.adminRole || '').toLowerCase().replace(/_/g, ' ').replace(/-/g, ' ').trim();
    const isSuperAdmin = (userRole.includes('super admin') || userRole === 'main admin' || (userRole === 'admin' && !adminUserRole.includes('state') && !adminUserRole.includes('district') && !adminUserRole.includes('division') && !adminUserRole.includes('pincode') && !req.user?.level?.includes('state'))) && (!req.user?.state || req.user?.state.toLowerCase() === 'all india');

    if (!isSuperAdmin) {
      const { state, district, division, pincode } = req.query;
      const userState = (req.user?.state || '').toLowerCase().trim();
      const userDistrict = (req.user?.district || '').toLowerCase().trim();
      const userDivision = (req.user?.division || '').toLowerCase().trim();
      const userPincode = String(req.user?.pincode || '').trim();

      if (userRole.includes('state') || (userRole === 'admin' && userState)) {
        if (state && userState && userState !== 'all india' && state.toLowerCase().trim() !== userState) {
          return res.status(403).json({
            success: false,
            code: 'UNAUTHORIZED_TERRITORY',
            message: 'Unauthorized territory access. State Admins cannot access data outside their assigned state.'
          });
        }
      } else if (userRole.includes('district')) {
        if (state && userState && userState !== 'all india' && state.toLowerCase().trim() !== userState) {
          return res.status(403).json({
            success: false,
            code: 'UNAUTHORIZED_TERRITORY',
            message: 'Unauthorized territory access. District Admins cannot access data outside their assigned state.'
          });
        }
        if (district && userDistrict && userDistrict !== 'all districts' && district.toLowerCase().trim() !== userDistrict) {
          return res.status(403).json({
            success: false,
            code: 'UNAUTHORIZED_TERRITORY',
            message: 'Unauthorized territory access. District Admins cannot access data outside their assigned district.'
          });
        }
      } else if (userRole.includes('division') || userRole.includes('divisional')) {
        if (division && userDivision && userDivision !== 'all divisions' && !divisionMatches(division, userDivision)) {
          return res.status(403).json({
            success: false,
            code: 'UNAUTHORIZED_TERRITORY',
            message: 'Unauthorized territory access. Divisional Admins cannot access data outside their assigned division.'
          });
        }
      } else if (userRole.includes('pincode')) {
        if (pincode && userPincode && userPincode !== 'all' && String(pincode).trim() !== userPincode) {
          return res.status(403).json({
            success: false,
            code: 'UNAUTHORIZED_TERRITORY',
            message: 'Unauthorized territory access. Pincode Admins cannot access data outside their assigned pincode.'
          });
        }
      }
    }

    const nowTime = Date.now();
    // 1. Ensure agents collection is reloaded from MongoDB Atlas only if needed
    if (db.agents && typeof db.agents.reloadFromMongo === 'function' && db.agents._mongoCol) {
      if (!db.agents.length || (nowTime - (db.agents._lastReload || 0) > 10000)) {
        try {
          await db.agents.reloadFromMongo(false);
        } catch (err) {
          console.warn('[getAgentRequests] Atlas agents reload notice:', err.message);
        }
      }
    } else if (db.agents && typeof db.agents.initMongo === 'function' && !db.agents._mongoCol) {
      try {
        const { getMongoDb } = require('../config/mongo');
        const mdb = await getMongoDb();
        if (mdb) {
          await db.agents.initMongo(mdb);
        }
      } catch (err) {
        // fallback
      }
    }

    // 2. Also ensure db.users is reloaded if needed
    if (db.users && typeof db.users.reloadFromMongo === 'function' && db.users._mongoCol) {
      if (!db.users.length || (nowTime - (db.users._lastReload || 0) > 10000)) {
        try {
          await db.users.reloadFromMongo(false);
        } catch (err) {
          // silent
        }
      }
    }

    // 3. Build unified list of agents, merging db.agents and any agent-role records in db.users
    const agentMap = new Map();
    (Array.from(db.agents || [])).forEach(a => {
      const idKey = String(a._id || a.id || '').trim();
      const emailKey = String(a.email || '').toLowerCase().trim();
      if (idKey) agentMap.set(idKey, a);
      if (emailKey) agentMap.set(emailKey, a);
    });

    (Array.from(db.users || [])).forEach(u => {
      const r = String(u.role || '').toLowerCase();
      if (r.includes('agent') || r === 'division' || r === 'district' || r === 'pincode' || r === 'state') {
        const idKey = String(u._id || u.id || '').trim();
        const emailKey = String(u.email || '').toLowerCase().trim();
        if ((!idKey || !agentMap.has(idKey)) && (!emailKey || !agentMap.has(emailKey))) {
          agentMap.set(idKey || emailKey, u);
        }
      }
    });

    const rawAgents = Array.from(new Set(agentMap.values()));
    // Scoped to agent registration requests (supports pending, approved, and rejected tabs)
    let candidateAgents = rawAgents;
    if (req.query.status && String(req.query.status).toLowerCase() !== 'all') {
      const qStatus = String(req.query.status).toLowerCase().trim();
      candidateAgents = candidateAgents.filter(a => {
        const s = (a.status || '').toLowerCase().trim();
        const adminApproval = (a.adminApprovalStatus || '').toLowerCase().trim();
        if (qStatus === 'pending') {
          return s.includes('pending') || s.includes('review') || !s || s === 'submitted' || adminApproval.includes('pending') || adminApproval.includes('review');
        }
        if (qStatus === 'approved' || qStatus === 'active') {
          return s === 'active' || s === 'approved' || adminApproval === 'approved';
        }
        if (qStatus === 'rejected') {
          return s === 'rejected' || adminApproval === 'rejected';
        }
        return s === qStatus || adminApproval === qStatus;
      });
    }

    const visibleAgents = candidateAgents.filter(a => canAdminViewAgent(req.user, a));

    let filteredAgents = visibleAgents;
    const reqLevel = req.query.level ? String(req.query.level).toLowerCase().trim() : '';
    if (reqLevel && reqLevel !== 'all') {
      const targetLevel = (reqLevel === 'divisional') ? 'division' : reqLevel;
      filteredAgents = filteredAgents.filter(a => {
        const lvl = normalizeLevel(getAgentLevel(a));
        return lvl === targetLevel;
      });
    }

    // Role-specific level enforcement
    if (userRole.includes('pincode')) {
      filteredAgents = filteredAgents.filter(a => normalizeLevel(getAgentLevel(a)) === 'pincode');
    } else if (userRole.includes('division') || userRole.includes('divisional')) {
      filteredAgents = filteredAgents.filter(a => {
        const lvl = normalizeLevel(getAgentLevel(a));
        return lvl === 'division' || lvl === 'pincode';
      });
    } else if (userRole.includes('district')) {
      filteredAgents = filteredAgents.filter(a => {
        const lvl = normalizeLevel(getAgentLevel(a));
        return lvl === 'district' || lvl === 'division' || lvl === 'pincode';
      });
    }

    if (req.query.state) {
      const qState = req.query.state.toLowerCase().trim();
      filteredAgents = filteredAgents.filter(a => {
        const t = getAgentTerritory(a);
        return t.state && t.state.toLowerCase().trim() === qState;
      });
    }
    if (req.query.district) {
      const qDist = req.query.district.toLowerCase().trim();
      filteredAgents = filteredAgents.filter(a => {
        const t = getAgentTerritory(a);
        return t.district && t.district.toLowerCase().trim() === qDist;
      });
    }
    if (req.query.division) {
      const qDiv = req.query.division.toLowerCase().trim();
      filteredAgents = filteredAgents.filter(a => {
        const t = getAgentTerritory(a);
        return t.division && (t.division.toLowerCase().trim() === qDiv || divisionMatches(t.division, req.query.division));
      });
    }
    if (req.query.pincode) {
      const qPin = String(req.query.pincode).trim();
      filteredAgents = filteredAgents.filter(a => {
        const t = getAgentTerritory(a);
        return t.pincode && String(t.pincode).trim() === qPin;
      });
    }

    const formatted = filteredAgents.map(a => {
      const normLevel = normalizeLevel(getAgentLevel(a));
      const terr = getAgentTerritory(a);
      const rawId = a.id || a._id;
      const idStr = rawId ? String(rawId) : `agent-${Math.random().toString(36).slice(2, 8)}`;
      const canApprove = isRelatedAdminForAgent(req.user, a);

      let jurisdiction = 'Assigned Territory';
      let assignedArea = '';
      if (normLevel === 'pincode' && terr.pincode) {
        jurisdiction = `PIN ${terr.pincode}`;
        assignedArea = [terr.division, terr.district, terr.state].filter(Boolean).join(', ');
      } else if (normLevel === 'division' && terr.division) {
        jurisdiction = terr.division ? `${terr.division} Division` : 'Assigned Division';
        assignedArea = [terr.district, terr.state].filter(Boolean).join(', ');
      } else if (normLevel === 'district' && terr.district) {
        jurisdiction = `${terr.district} District`;
        assignedArea = terr.state || '';
      } else if (normLevel === 'state' && terr.state) {
        jurisdiction = `${terr.state} State`;
        assignedArea = terr.state ? `${terr.state} (Statewide)` : 'Statewide';
      } else {
        jurisdiction = terr.state || 'Assigned Zone';
        assignedArea = terr.district || '';
      }

      let workflowStage = 'Awaiting Territory Approval';
      const s = (a.status || '').toLowerCase().trim();
      const adminApproval = (a.adminApprovalStatus || '').toLowerCase().trim();
      const kycStatus = (a.kycStatus || '').toLowerCase().trim();

      if (s === 'rejected' || adminApproval === 'rejected') {
        workflowStage = 'Territory Rejected';
      } else if (kycStatus === 'rejected') {
        workflowStage = 'KYC Rejected';
      } else if (s === 'pending_kyc' || adminApproval === 'approved') {
        workflowStage = 'Awaiting KYC Review';
      } else if (adminApproval === 'pending' && (a.pendingReason || a.adminNotes)) {
        workflowStage = 'Territory Pending';
      } else if (s === 'active' || s === 'approved') {
        workflowStage = 'Activated';
      }

      return {
        ...a,
        id: idStr,
        _id: idStr,
        name: a.name || 'Unnamed Agent',
        applicantName: a.name || 'Unnamed Agent',
        level: normLevel,
        role: a.role || normLevel,
        roleTitle: `${normLevel.charAt(0).toUpperCase() + normLevel.slice(1)} Agent`,
        territory: terr,
        state: terr.state,
        district: terr.district,
        division: terr.division,
        pincode: terr.pincode,
        jurisdiction,
        assignedArea,
        rawAddress: a.address || null,
        address: formatAddressString(a.address, [terr.pincode, terr.division, terr.district, terr.state].filter(Boolean).join(', ') || 'N/A'),
        createdAt: a.createdAt || new Date().toISOString(),
        registrationDate: a.createdAt ? new Date(a.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Recent',
        status: (a.status && a.status.toLowerCase() === 'approved') ? 'Active' : (a.status || 'pending'),
        adminApprovalStatus: adminApproval || 'pending',
        kycStatus: a.kycStatus || 'pending_verification',
        rejectionReason: (s === 'rejected' || adminApproval === 'rejected') ? (a.rejectionReason || a.adminRejectionReason || 'Rejected') : null,
        pendingReason: (s === 'rejected' || adminApproval === 'rejected' || s === 'active' || s === 'approved' || adminApproval === 'approved') ? null : (a.pendingReason || a.adminNotes || null),
        reviewerReason: (s === 'active' || s === 'approved' || adminApproval === 'approved') 
          ? (a.adminApprovedBy ? `Approved by ${a.adminApprovedBy}${a.adminApprovedByRole ? ` (${a.adminApprovedByRole})` : ''}` : 'Approved')
          : (s === 'rejected' || adminApproval === 'rejected')
          ? (a.rejectionReason || a.adminRejectionReason || 'Rejected')
          : (a.pendingReason || a.adminNotes || null),
        adminApprovedBy: a.adminApprovedBy || null,
        adminApprovedByRole: a.adminApprovedByRole || null,
        adminApprovedAt: a.adminApprovedAt || null,
        adminRejectedBy: a.adminRejectedBy || null,
        adminRejectedByRole: a.adminRejectedByRole || null,
        adminRejectedAt: a.adminRejectedAt || null,
        adminPendingBy: (s === 'active' || s === 'approved' || s === 'rejected') ? null : (a.adminPendingBy || null),
        adminPendingById: (s === 'active' || s === 'approved' || s === 'rejected') ? null : (a.adminPendingById || null),
        adminPendingByRole: (s === 'active' || s === 'approved' || s === 'rejected') ? null : (a.adminPendingByRole || a.adminPendingRole || null),
        adminPendingAt: (s === 'active' || s === 'approved' || s === 'rejected') ? null : (a.adminPendingAt || null),
        reviewHistory: Array.isArray(a.reviewHistory) ? a.reviewHistory : [],
        workflowStage,
        canApprove,
        documents: a.documents || a.kycDocs || {}
      };
    });

    return res.json({ success: true, count: formatted.length, requests: formatted, agents: formatted });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to fetch agent requests', error: error.message });
  }
}

async function approveAgent(req, res) {
  try {
    const { id } = req.params;
    let agent = Array.from(db.agents || []).find(a => String(a._id || a.id) === String(id));
    if (!agent && db.agents && typeof db.agents.reloadFromMongo === 'function') {
      try {
        await db.agents.reloadFromMongo(true);
      } catch (_) {}
      agent = Array.from(db.agents || []).find(a => String(a._id || a.id) === String(id));
    }
    if (!agent) {
      agent = Array.from(db.users || []).find(u => String(u._id || u.id) === String(id));
    }

    if (!agent) {
      return res.status(404).json({ success: false, message: 'Agent request not found' });
    }

    if (!isRelatedAdminForAgent(req.user, agent)) {
      const aLevel = normalizeLevel(getAgentLevel(agent));
      return res.status(403).json({
        success: false,
        message: `You do not have administrative authority to approve this ${aLevel} agent. Approval must be performed by the designated authority for this jurisdiction.`
      });
    }

    const adminRoleLower = (req.user.role || '').toLowerCase().replace(/_/g, ' ');
    const isGlobalSuper = adminRoleLower === 'super admin' || adminRoleLower === 'main admin' || (adminRoleLower === 'admin' && (!req.user.state || req.user.state.toLowerCase() === 'all india'));

    const now = new Date().toISOString();
    const terr = getAgentTerritory(agent);
    const existingHistory = Array.isArray(agent.reviewHistory) ? agent.reviewHistory : [];
    const reviewEntry = {
      action: isGlobalSuper ? 'APPROVED' : 'SUB_ADMIN_APPROVED',
      status: isGlobalSuper ? 'Active' : 'PENDING_MAIN_ADMIN_APPROVAL',
      reviewerId: req.user.id || req.user._id,
      reviewerName: req.user.name || req.user.email,
      reviewerRole: req.user.role,
      reviewedAt: now,
      timestamp: now
    };
    const updatedHistory = [...existingHistory, reviewEntry];

    let approveUpdates;
    if (isGlobalSuper) {
      approveUpdates = {
        status: 'Active',
        overallRegistrationStatus: 'Active',
        subAdminApprovalStatus: agent.subAdminApprovalStatus || 'approved',
        mainAdminApprovalStatus: 'approved',
        adminApprovalStatus: 'approved',
        kycStatus: 'Verified',
        isActive: true,
        isApproved: true,
        requiresApproval: false,
        isFullyApproved: true,
        mainadminApprovedBy: req.user.id || req.user._id,
        mainadminApprovedByName: req.user.name || req.user.email,
        mainadminApprovedAt: now,
        adminApprovedBy: req.user.name || req.user.email,
        adminApprovedById: req.user.id || req.user._id,
        adminApprovedByRole: req.user.role,
        adminApprovedAt: now,
        rejectionReason: null,
        pendingReason: null,
        reviewerReason: null,
        adminNotes: null,
        reviewHistory: updatedHistory,
        updatedAt: now
      };
    } else {
      // Sub Admin territory approval -> forwards to Main Admin and KYC approval
      approveUpdates = {
        status: 'PENDING_MAIN_ADMIN_APPROVAL',
        overallRegistrationStatus: 'PENDING_MAIN_ADMIN_APPROVAL',
        subAdminApprovalStatus: 'approved',
        mainAdminApprovalStatus: 'pending',
        adminApprovalStatus: 'approved',
        kycStatus: agent.kycStatus || 'pending_verification',
        isActive: false,
        isApproved: false,
        requiresApproval: true,
        isFullyApproved: false,
        subAdminApprovedBy: req.user.name || req.user.email,
        subAdminApprovedById: req.user.id || req.user._id,
        subAdminApprovedByRole: req.user.role,
        subAdminApprovedAt: now,
        adminApprovedBy: req.user.name || req.user.email,
        adminApprovedById: req.user.id || req.user._id,
        adminApprovedByRole: req.user.role,
        adminApprovedAt: now,
        rejectionReason: null,
        pendingReason: null,
        reviewerReason: null,
        adminNotes: null,
        reviewHistory: updatedHistory,
        updatedAt: now
      };
    }
    Object.assign(agent, approveUpdates);

    await db.agents.findByIdAndUpdate(agent._id || agent.id, approveUpdates);

    // Queue in db.kycRecords for KYC team
    if (db.kycRecords) {
      const agIdStr = String(agent._id || agent.id);
      const kycId = `KYC-AGT-${agIdStr}`;
      const existingKyc = await db.kycRecords.findOne({ $or: [{ _id: kycId }, { id: kycId }, { agentId: agIdStr }] });
      if (!existingKyc) {
        await db.kycRecords.insertOne({
          _id: kycId,
          id: kycId,
          type: 'Agent',
          agentId: agIdStr,
          name: agent.name,
          category: 'Field Agency Network',
          role: agent.role || `${getAgentLevel(agent)} Agent`,
          phone: agent.phone || agent.mobile,
          email: agent.email,
          state: terr.state,
          district: terr.district,
          division: terr.division,
          pincode: terr.pincode,
          status: isGlobalSuper ? 'Active' : 'Pending',
          kycStatus: isGlobalSuper ? 'Verified' : 'pending_verification',
          submittedDate: (agent.createdAt || now).split('T')[0],
          documents: agent.documents || agent.kycDocs || {},
          notes: `Agent registration territory-approved by ${req.user.role} "${req.user.name}". Awaiting Main Admin and KYC approval.`,
          createdAt: now,
          updatedAt: now
        });
      } else {
        await db.kycRecords.findByIdAndUpdate(existingKyc._id || existingKyc.id, {
          status: isGlobalSuper ? 'Active' : 'Pending',
          kycStatus: isGlobalSuper ? 'Verified' : (existingKyc.kycStatus || 'pending_verification'),
          approvalStatus: isGlobalSuper ? 'approved' : 'pending_main_admin',
          notes: `Agent registration territory-approved by ${req.user.role} "${req.user.name}".`,
          updatedAt: now
        });
      }
    }

    // Synchronize corresponding user record in db.users
    if (db.users) {
      const user = (await db.users.findById(agent._id || agent.id)) ||
        Array.from(db.users || []).find(u => String(u._id || u.id) === String(agent._id || agent.id) || (u.email && agent.email && u.email.toLowerCase() === agent.email.toLowerCase()));
      if (user) {
        Object.assign(user, approveUpdates);
        await db.users.findByIdAndUpdate(user._id || user.id, {
          ...approveUpdates
        });
      }
    }

    // Audit log entry
    if (db.auditLogs) {
      await db.auditLogs.insertOne({
        action: 'AGENT_TERRITORY_APPROVED_FORWARDED_TO_KYC',
        adminId: req.user.id || req.user._id,
        adminName: req.user.name,
        adminRole: req.user.role,
        targetUserId: agent._id || agent.id,
        targetUserName: agent.name,
        targetUserRole: agent.role,
        details: `Agent "${agent.name}" (${getAgentLevel(agent)}) territory registration approved by ${req.user.role} "${req.user.name}". Forwarded to KYC Team review.`,
        ip: req.ip || '127.0.0.1',
        timestamp: now
      });
    }

    return res.json({
      success: true,
      message: `Registration for ${agent.name} approved by ${req.user.role}. Forwarded to KYC Review queue.`,
      agent: { ...agent, ...approveUpdates, canApprove: false, workflowStage: 'Awaiting KYC Review' }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to approve agent', error: error.message });
  }
}

async function rejectAgent(req, res) {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    let agent = Array.from(db.agents || []).find(a => String(a._id || a.id) === String(id));
    if (!agent && db.agents && typeof db.agents.reloadFromMongo === 'function') {
      try {
        await db.agents.reloadFromMongo(true);
      } catch (_) {}
      agent = Array.from(db.agents || []).find(a => String(a._id || a.id) === String(id));
    }
    if (!agent) {
      agent = Array.from(db.users || []).find(u => String(u._id || u.id) === String(id));
    }

    if (!agent) {
      return res.status(404).json({ success: false, message: 'Agent request not found' });
    }

    if (!isRelatedAdminForAgent(req.user, agent)) {
      return res.status(403).json({
        success: false,
        message: 'You do not have administrative authority to reject this agent registration.'
      });
    }

    const rejectionReason = (reason || '').trim();
    if (!rejectionReason) {
      return res.status(400).json({ success: false, message: 'A rejection reason is strictly required.' });
    }
    const now = new Date().toISOString();
    const terr = getAgentTerritory(agent);
    const rejectUpdates = {
      status: 'rejected',
      adminApprovalStatus: 'rejected',
      kycStatus: 'Rejected',
      isActive: false,
      isApproved: false,
      rejectionReason,
      adminRejectedBy: req.user.name || req.user.email,
      adminRejectedById: req.user.id || req.user._id,
      adminRejectedByRole: req.user.role,
      adminRejectedAt: now,
      updatedAt: now
    };
    Object.assign(agent, rejectUpdates);

    await db.agents.findByIdAndUpdate(agent._id || agent.id, rejectUpdates);

    // Forward rejection details to KYC team queue for review and closure
    if (db.kycRecords) {
      const agIdStr = String(agent._id || agent.id);
      const kycId = `KYC-AGT-${agIdStr}`;
      const existingKyc = await db.kycRecords.findOne({ $or: [{ _id: kycId }, { id: kycId }, { agentId: agIdStr }] });
      if (existingKyc) {
        await db.kycRecords.findByIdAndUpdate(existingKyc._id || existingKyc.id, {
          status: 'Pending',
          kycStatus: 'Pending Verification',
          notes: `Territory-rejected by ${req.user.role} "${req.user.name}". Reason: ${rejectionReason}`,
          updatedAt: now
        });
      } else {
        await db.kycRecords.insertOne({
          _id: kycId,
          id: kycId,
          type: 'Agent',
          agentId: agIdStr,
          name: agent.name,
          category: 'Field Agency Network',
          role: agent.role || `${getAgentLevel(agent)} Agent`,
          phone: agent.phone || agent.mobile,
          email: agent.email,
          state: terr.state,
          district: terr.district,
          division: terr.division,
          pincode: terr.pincode,
          status: 'Pending',
          kycStatus: 'Pending Verification',
          submittedDate: (agent.createdAt || now).split('T')[0],
          documents: agent.documents || agent.kycDocs || {},
          notes: `Territory-rejected by ${req.user.role} "${req.user.name}". Reason: ${rejectionReason}`,
          createdAt: now,
          updatedAt: now
        });
      }
    }

    // Synchronize corresponding user record in db.users
    if (db.users) {
      const user = (await db.users.findById(agent._id || agent.id)) ||
        Array.from(db.users || []).find(u => String(u._id || u.id) === String(agent._id || agent.id) || (u.email && agent.email && u.email.toLowerCase() === agent.email.toLowerCase()));
      if (user) {
        user.status = 'rejected';
        user.adminApprovalStatus = 'rejected';
        user.kycStatus = 'Rejected';
        user.isActive = false;
        user.rejectionReason = rejectionReason;
        user.adminRejectionReason = rejectionReason;
        user.updatedAt = now;
        await db.users.findByIdAndUpdate(user._id || user.id, {
          status: 'rejected',
          adminApprovalStatus: 'rejected',
          kycStatus: 'Rejected',
          isActive: false,
          rejectionReason,
          adminRejectionReason: rejectionReason,
          updatedAt: now
        });
      }
    }

    if (db.auditLogs) {
      await db.auditLogs.insertOne({
        action: 'AGENT_REGISTRATION_REJECTED',
        adminId: req.user.id || req.user._id,
        adminName: req.user.name,
        adminRole: req.user.role,
        targetUserId: agent._id || agent.id,
        targetUserName: agent.name,
        details: `Agent "${agent.name}" registration rejected by ${req.user.role} "${req.user.name}". Reason: ${rejectionReason}`,
        ip: req.ip || '127.0.0.1',
        timestamp: now
      });
    }

    return res.json({
      success: true,
      message: `Agent registration for ${agent.name} has been rejected.`,
      agent: { ...agent, ...rejectUpdates, canApprove: false, workflowStage: 'Territory Rejected' }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to reject agent', error: error.message });
  }
}

// POST /api/operations/agents/:id/pending - Keep agent registration pending with mandatory reason
async function keepPendingAgent(req, res) {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    let agent = Array.from(db.agents || []).find(a => String(a._id || a.id) === String(id));
    if (!agent && db.agents && typeof db.agents.reloadFromMongo === 'function') {
      try {
        await db.agents.reloadFromMongo(true);
      } catch (_) {}
      agent = Array.from(db.agents || []).find(a => String(a._id || a.id) === String(id));
    }
    if (!agent) {
      agent = Array.from(db.users || []).find(u => String(u._id || u.id) === String(id));
    }

    if (!agent) {
      return res.status(404).json({ success: false, message: 'Agent request not found' });
    }

    if (!isRelatedAdminForAgent(req.user, agent)) {
      return res.status(403).json({
        success: false,
        message: 'You do not have administrative authority to manage this agent registration.'
      });
    }

    const pendingReason = (reason || '').trim();
    if (!pendingReason) {
      return res.status(400).json({ success: false, message: 'A meaningful pending reason or administrative note is required.' });
    }

    const now = new Date().toISOString();
    const existingHistory = Array.isArray(agent.reviewHistory) ? agent.reviewHistory : [];
    const reviewEntry = {
      action: 'PENDING',
      status: 'pending',
      reason: pendingReason,
      reviewerId: req.user.id || req.user._id,
      reviewerName: req.user.name || req.user.email,
      reviewerRole: req.user.role,
      reviewedAt: now,
      timestamp: now
    };
    const updatedHistory = [...existingHistory, reviewEntry];

    const pendingUpdates = {
      status: 'pending',
      adminApprovalStatus: 'pending',
      pendingReason,
      reviewerReason: pendingReason,
      adminNotes: pendingReason,
      adminPendingBy: req.user.name || req.user.email,
      adminPendingById: req.user.id || req.user._id,
      adminPendingByRole: req.user.role,
      adminPendingAt: now,
      reviewHistory: updatedHistory,
      updatedAt: now
    };
    Object.assign(agent, pendingUpdates);

    await db.agents.findByIdAndUpdate(agent._id || agent.id, pendingUpdates);

    if (db.kycRecords) {
      const agIdStr = String(agent._id || agent.id);
      const kycId = `KYC-AGT-${agIdStr}`;
      const existingKyc = await db.kycRecords.findOne({ $or: [{ _id: kycId }, { id: kycId }, { agentId: agIdStr }] });
      if (existingKyc) {
        await db.kycRecords.findByIdAndUpdate(existingKyc._id || existingKyc.id, {
          notes: `Kept pending by ${req.user.role} "${req.user.name}". Reason: ${pendingReason}`,
          updatedAt: now
        });
      }
    }

    // Synchronize corresponding user record in db.users
    if (db.users) {
      const user = (await db.users.findById(agent._id || agent.id)) ||
        Array.from(db.users || []).find(u => String(u._id || u.id) === String(agent._id || agent.id) || (u.email && agent.email && u.email.toLowerCase() === agent.email.toLowerCase()));
      if (user) {
        user.status = 'pending';
        user.adminApprovalStatus = 'pending';
        user.pendingReason = pendingReason;
        user.reviewerReason = pendingReason;
        user.adminNotes = pendingReason;
        user.adminPendingBy = req.user.name || req.user.email;
        user.adminPendingAt = now;
        user.reviewHistory = updatedHistory;
        user.updatedAt = now;
        await db.users.findByIdAndUpdate(user._id || user.id, {
          status: 'pending',
          adminApprovalStatus: 'pending',
          pendingReason,
          reviewerReason: pendingReason,
          adminNotes: pendingReason,
          adminPendingBy: req.user.name || req.user.email,
          adminPendingAt: now,
          reviewHistory: updatedHistory,
          updatedAt: now
        });
      }
    }

    if (db.auditLogs) {
      await db.auditLogs.insertOne({
        action: 'AGENT_REGISTRATION_KEPT_PENDING',
        adminId: req.user.id || req.user._id,
        adminName: req.user.name,
        adminRole: req.user.role,
        targetUserId: agent._id || agent.id,
        targetUserName: agent.name,
        details: `Agent "${agent.name}" registration kept pending by ${req.user.role} "${req.user.name}". Reason: ${pendingReason}`,
        ip: req.ip || '127.0.0.1',
        timestamp: now
      });
    }

    return res.json({
      success: true,
      message: `Agent registration for ${agent.name} kept pending. Note saved.`,
      agent: { ...agent, ...pendingUpdates, canApprove: true, workflowStage: 'Territory Pending' }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to update agent pending status', error: error.message });
  }
}

// PATCH /operations/agents/:id/status - Suspend, activate, or soft-delete agent account
async function updateAgentStatus(req, res) {
  try {
    const { id } = req.params;
    const { action, status, reason } = req.body;

    let agent = Array.from(db.agents || []).find(a => String(a._id || a.id) === String(id));
    if (!agent && db.agents && typeof db.agents.reloadFromMongo === 'function') {
      try {
        await db.agents.reloadFromMongo(true);
      } catch (_) {}
      agent = Array.from(db.agents || []).find(a => String(a._id || a.id) === String(id));
    }
    if (!agent) {
      agent = Array.from(db.users || []).find(u => String(u._id || u.id) === String(id) && String(u.role || '').toLowerCase().includes('agent'));
    }

    if (!agent) {
      return res.status(404).json({ success: false, message: 'Agent record not found' });
    }

    // Territorial authorization check
    if (!canAdminViewAgent(req.user, agent)) {
      return res.status(403).json({
        success: false,
        code: 'UNAUTHORIZED_TERRITORY',
        message: 'Forbidden: You do not have territory authorization to manage this agent account.'
      });
    }

    let targetStatus = '';
    const norm = String(action || status || '').toLowerCase().trim();
    if (norm === 'suspend' || norm === 'suspended') {
      targetStatus = 'Suspended';
    } else if (norm === 'activate' || norm === 'active') {
      targetStatus = 'Active';
    } else if (norm === 'delete' || norm === 'deleted') {
      targetStatus = 'Deleted';
    } else {
      return res.status(400).json({ success: false, message: 'Invalid action. Must be suspend, activate, or delete.' });
    }

    if (targetStatus === 'Active') {
      const currentAdm = String(agent.adminApprovalStatus || '').toLowerCase();
      if (currentAdm === 'rejected') {
        return res.status(400).json({ success: false, message: 'Cannot activate an account that has been rejected.' });
      }
    }

    const now = new Date().toISOString();
    const oldStatus = agent.status || 'Active';
    const isDeleted = targetStatus === 'Deleted';
    const isActive = targetStatus === 'Active';

    const updates = {
      status: targetStatus,
      isActive,
      updatedAt: now
    };

    if (isDeleted) {
      updates.isDeleted = true;
      updates.deletedAt = now;
      updates.deletedBy = req.user.name || req.user.email;
      updates.deletedById = req.user.id || req.user._id;
      updates.deletedByRole = req.user.role;
      if (reason) updates.deleteReason = reason;
    } else if (targetStatus === 'Suspended') {
      updates.isSuspended = true;
      updates.suspendedAt = now;
      updates.suspendedBy = req.user.name || req.user.email;
      updates.suspendedById = req.user.id || req.user._id;
      updates.suspendedByRole = req.user.role;
      if (reason) updates.suspendReason = reason;
    } else if (targetStatus === 'Active') {
      updates.isSuspended = false;
      updates.isDeleted = false;
      updates.activatedAt = now;
      updates.activatedBy = req.user.name || req.user.email;
      updates.activatedById = req.user.id || req.user._id;
      updates.activatedByRole = req.user.role;
    }

    // Update in db.agents
    Object.assign(agent, updates);
    if (db.agents && typeof db.agents.findByIdAndUpdate === 'function') {
      await db.agents.findByIdAndUpdate(agent._id || agent.id, updates);
    }

    // Sync to db.users & MongoDB Atlas users
    const agIdStr = String(agent._id || agent.id);
    if (db.users) {
      const u = Array.from(db.users).find(x => String(x._id || x.id) === agIdStr || (agent.email && x.email && x.email.toLowerCase() === agent.email.toLowerCase()));
      if (u) Object.assign(u, updates);
    }

    try {
      const mongoDb = await getMongoDb();
      if (mongoDb) {
        const { ObjectId } = require('mongodb');
        const filter = {
          $or: [
            { id: agIdStr },
            { email: (agent.email || '').toLowerCase() }
          ]
        };
        if (ObjectId.isValid(agIdStr)) {
          filter.$or.unshift({ _id: new ObjectId(agIdStr) });
        }
        await mongoDb.collection('users').updateMany(filter, { $set: updates });
      }
    } catch (mErr) {
      console.warn('MongoDB Atlas sync in updateAgentStatus warning:', mErr.message);
    }

    // Audit log
    if (db.auditLogs) {
      await db.auditLogs.insertOne({
        id: `AUD-${Date.now()}`,
        userId: req.user.id || req.user._id,
        userName: req.user.name || req.user.email,
        userRole: req.user.role,
        action: `AGENT_${targetStatus.toUpperCase()}`,
        module: 'Agents',
        details: `${req.user.role} "${req.user.name || req.user.email}" transitioned agent "${agent.name}" status from "${oldStatus}" to "${targetStatus}". Reason: ${reason || 'N/A'}.`,
        ip: req.ip || '127.0.0.1',
        timestamp: now
      }).catch(() => {});
    }

    return res.json({
      success: true,
      message: `Agent account successfully updated to ${targetStatus}.`,
      agent: { ...agent, ...updates }
    });
  } catch (error) {
    console.error('Failed to update agent status:', error);
    return res.status(500).json({ success: false, message: 'Failed to update agent status', error: error.message });
  }
}

module.exports = {
  getExecutives,
  getSupportTeam,
  updateTicketStatus,
  getAgents,
  addAgent,
  getAgentHierarchy,
  getAgentActivities,
  createAgentActivity,
  advanceAgentActivity,
  getDeliveryPartners,
  getAgentRequests,
  approveAgent,
  rejectAgent,
  keepPendingAgent,
  updateAgentStatus,
  isRelatedAdminForAgent,
  canAdminViewAgent,
  getHierarchicalScopedAgents,
  getAgentTerritory,
  normalizeLevel,
  getAgentLevel
};

