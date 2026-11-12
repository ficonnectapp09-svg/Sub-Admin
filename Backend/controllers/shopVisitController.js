const { uploadFile } = require('../config/storage');
const { db, filterByLocation } = require('../config/db');

exports.createShopVisit = async (req, res) => {
  try {
    const {
      shopName,
      category,
      shopPhoto,
      voiceNote,
      interestedStatus,
      notInterestedReason,
      stateId,
      districtId,
      divisionId,
      pincodeId,
      pincodeCode,
      vendorId,
      notes
    } = req.body;

    if (!shopName || !shopName.trim()) {
      return res.status(400).json({ success: false, message: 'Shop name is mandatory.' });
    }

    if (!shopPhoto) {
      return res.status(400).json({ success: false, message: 'Shop storefront photo is mandatory.' });
    }

    if (!interestedStatus) {
      return res.status(400).json({ success: false, message: 'Interest status (YES or NO) is mandatory.' });
    }

    if (interestedStatus.toUpperCase() === 'NO' && !voiceNote) {
      return res.status(400).json({ success: false, message: 'Audio voice note explaining reason is mandatory.' });
    }

    let finalShopPhoto = shopPhoto || null;
    let finalVoiceNote = voiceNote || null;

    if (finalShopPhoto && typeof finalShopPhoto === 'string' && finalShopPhoto.startsWith('data:')) {
      try {
        const uploadRes = await uploadFile(finalShopPhoto, 'shop_visits', `shop_${Date.now()}`);
        finalShopPhoto = uploadRes.url || uploadRes.key;
      } catch (err) {
        console.error('Failed to store shopPhoto:', err);
      }
    }

    if (finalVoiceNote && typeof finalVoiceNote === 'string' && finalVoiceNote.startsWith('data:')) {
      try {
        const uploadRes = await uploadFile(finalVoiceNote, 'voice_notes', `voice_${Date.now()}`);
        finalVoiceNote = uploadRes.url || uploadRes.key;
      } catch (err) {
        console.error('Failed to store voiceNote:', err);
      }
    }

    const newVisit = {
      _id: `visit_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      shopName: shopName.trim(),
      category: category || 'Products',
      shopPhoto: finalShopPhoto,
      voiceNote: finalVoiceNote,
      interestedStatus: interestedStatus.toUpperCase(), // 'YES' | 'NO'
      notInterestedReason: interestedStatus.toUpperCase() === 'NO' ? (notInterestedReason || 'Not specified') : null,
      vendorId: vendorId || null,
      notes: notes || '',
      managerId: req.user?._id || req.user?.id || 'mgr_system',
      managerName: req.user?.name || 'Manager',
      managerRole: req.user?.role || 'pincode_manager',
      state: req.user?.state || null,
      district: req.user?.district || null,
      division: req.user?.division || null,
      pincode: pincodeCode || req.user?.pincode || null,
      stateId: stateId || req.user?.stateId || null,
      districtId: districtId || req.user?.districtId || null,
      divisionId: divisionId || req.user?.divisionId || null,
      pincodeId: pincodeId || req.user?.pincodeId || null,
      pincodeCode: pincodeCode || req.user?.pincode || null,
      status: interestedStatus.toUpperCase() === 'YES' ? 'Onboarded' : 'Closed',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await db.shopVisits.insertOne(newVisit);

    return res.status(201).json({
      success: true,
      message: 'Shop visit recorded successfully',
      data: newVisit
    });
  } catch (err) {
    console.error('Failed to create shop visit:', err);
    return res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

exports.getShopVisits = async (req, res) => {
  try {
    const allVisits = Array.from(db.shopVisits || []);
    let filtered = filterByLocation(allVisits, req.user);

    const { search, status, category, scope, managerRole, district, page = 1, limit = 10 } = req.query;

    // Filter by Scope: 'all' | 'self' (My Report) | 'state_managers' | 'district_managers' | 'division_managers' | 'pincode_managers' | 'others'
    if (scope === 'self' || scope === 'my') {
      filtered = filtered.filter(v => v.managerId === req.user?._id || v.managerId === req.user?.id);
    } else if (scope === 'state_managers' || scope === 'state') {
      filtered = filtered.filter(v => {
        const r = (v.managerRole || '').toLowerCase();
        return r.includes('state');
      });
    } else if (scope === 'district_managers' || scope === 'district') {
      filtered = filtered.filter(v => {
        const r = (v.managerRole || '').toLowerCase();
        return r.includes('district');
      });
    } else if (scope === 'division_managers' || scope === 'division' || scope === 'divisional') {
      filtered = filtered.filter(v => {
        const r = (v.managerRole || '').toLowerCase();
        return r.includes('division') || r.includes('divisional');
      });
    } else if (scope === 'pincode_managers' || scope === 'pincode') {
      filtered = filtered.filter(v => {
        const r = (v.managerRole || '').toLowerCase();
        return r.includes('pincode');
      });
    } else if (scope === 'others' || scope === 'subordinates') {
      filtered = filtered.filter(v => v.managerId !== req.user?._id && v.managerId !== req.user?.id);
    }

    if (category && category !== 'All' && category !== 'undefined') {
      filtered = filtered.filter(v => (v.category || '').toLowerCase() === category.toLowerCase());
    }

    if (managerRole && managerRole !== 'All' && managerRole !== 'undefined') {
      filtered = filtered.filter(v => v.managerRole === managerRole || v.managerRole?.toLowerCase().includes(managerRole.toLowerCase()));
    }

    if (district && district !== 'All' && district !== 'undefined') {
      filtered = filtered.filter(v => v.district === district || v.districtId === district);
    }

    if (search && search !== 'undefined' && search !== 'null' && search.trim() !== '') {
      const q = search.toLowerCase().trim();
      filtered = filtered.filter(v =>
        (v.shopName && v.shopName.toLowerCase().includes(q)) ||
        (v.category && v.category.toLowerCase().includes(q)) ||
        (v.managerName && v.managerName.toLowerCase().includes(q)) ||
        (v.district && v.district.toLowerCase().includes(q)) ||
        (v.division && v.division.toLowerCase().includes(q)) ||
        (v.notInterestedReason && v.notInterestedReason.toLowerCase().includes(q))
      );
    }

    if (status && status !== 'All' && status !== 'undefined' && status !== 'null') {
      filtered = filtered.filter(v => v.interestedStatus === status.toUpperCase() || v.status === status);
    }

    // Sort newest first
    filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const startIndex = (pageNum - 1) * limitNum;
    const paginated = filtered.slice(startIndex, startIndex + limitNum).map(v => {
      let vendorObj = null;
      if (v.vendorId) {
        const found = Array.from(db.vendors || []).find(vend => vend.id === v.vendorId || vend._id === v.vendorId);
        if (found) {
          vendorObj = {
            id: found.id || found._id,
            businessName: found.businessName || found.name,
            contactPerson: found.contactPerson || found.ownerName,
            phone: found.phone || found.mobile,
            email: found.email,
            address: found.address,
            pincode: found.pincode,
            district: found.district,
            state: found.state,
            category: found.category,
            approvalStatus: found.approvalStatus || 'Pending Pincode Admin Approval',
            kycStatus: found.kycStatus || 'Pending Verification',
            status: found.status || 'Under Review',
            adminApprovedBy: found.adminApprovedBy || null,
            adminApprovedAt: found.adminApprovedAt || null,
            gstStatus: found.gstStatus,
            gstNumber: found.gstNumber,
            bankName: found.bankName,
            accountNumber: found.accountNumber,
            ifsc: found.ifsc,
            documents: found.documents || []
          };
        }
      }
      return {
        ...v,
        vendor: vendorObj
      };
    });

    return res.json({
      success: true,
      data: paginated,
      pagination: {
        total: filtered.length,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(filtered.length / limitNum) || 1
      }
    });
  } catch (err) {
    console.error('Failed to fetch shop visits:', err);
    return res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

exports.updateShopVisit = async (req, res) => {
  try {
    const { id } = req.params;
    const visits = Array.from(db.shopVisits);
    const visit = visits.find(v => v._id === id || v.id === id);

    if (!visit) {
      return res.status(404).json({ success: false, message: 'Shop visit not found' });
    }

    const updatedData = { ...req.body, updatedAt: new Date().toISOString() };
    const updated = await db.shopVisits.findByIdAndUpdate(visit._id || visit.id, updatedData);

    return res.json({
      success: true,
      message: 'Shop visit updated successfully',
      data: updated || { ...visit, ...updatedData }
    });
  } catch (err) {
    console.error('Failed to update shop visit:', err);
    return res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};