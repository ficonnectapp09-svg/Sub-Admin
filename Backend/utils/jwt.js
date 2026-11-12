const path = require('path');
const jwt = require('jsonwebtoken');

if (!process.env.JWT_SECRET) {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
}

const JWT_SECRET = process.env.JWT_SECRET;

function getJwtSecret() {
  const secret = process.env.JWT_SECRET || JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is not configured.');
  }
  return secret;
}

function generateToken(user) {
  const payload = {
    id: user._id || user.id,
    _id: user._id || user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    level: user.level || (user.role === 'State Admin' ? 1 : user.role === 'District Admin' ? 2 : user.role === 'Divisional Admin' ? 3 : 4),
    status: user.status || (user.requiresApproval ? 'PENDING_SUB_ADMIN_APPROVAL' : 'active'),
    state: user.state,
    district: user.district,
    division: user.division,
    pincode: user.pincode,
    stateId: user.stateId,
    districtId: user.districtId,
    divisionId: user.divisionId,
    pincodeId: user.pincodeId,
    regionId: user.regionId || user.stateId,
    scope: user.scope || (user.requiresApproval ? 'pending_registration' : 'dashboard_access'),
    requiresApproval: user.requiresApproval !== undefined ? Boolean(user.requiresApproval) : false
  };

  return jwt.sign(payload, getJwtSecret(), { expiresIn: '7d' });
}

function verifyToken(token) {
  return jwt.verify(token, getJwtSecret());
}

module.exports = {
  JWT_SECRET,
  generateToken,
  verifyToken
};
