/* ============================================================
   SmartGate - Hệ thống Quản lý Ra vào Chung cư
   Application Logic - Complete Business Logic
   ============================================================ */

// ==================== GLOBAL STATE ====================
let currentUser = null;
let currentView = null;
let useFirebase = false;
let firebaseDb = null;
let scanInterval = null;
let videoStream = null;
let pollingInterval = null;

// ==================== DATA KEYS ====================
const KEYS = {
  USERS: 'sg_users',
  QR_CODES: 'sg_qrcodes',
  CONFIRMATIONS: 'sg_confirmations',
  ENTRY_LOGS: 'sg_entrylogs',
  INCIDENTS: 'sg_incidents',
  SESSION: 'sg_session'
};

// ==================== INITIALIZATION ====================
document.addEventListener('DOMContentLoaded', () => {
  initFirebase();
  initDefaultData();
  checkSession();
});

function initFirebase() {
  if (window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.databaseURL) {
    // Load Firebase SDK dynamically
    const script1 = document.createElement('script');
    script1.src = 'https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js';
    script1.onload = () => {
      const script2 = document.createElement('script');
      script2.src = 'https://www.gstatic.com/firebasejs/9.23.0/firebase-database-compat.js';
      script2.onload = () => {
        try {
          firebase.initializeApp(window.FIREBASE_CONFIG);
          firebaseDb = firebase.database();
          useFirebase = true;
          updateModeIndicators(true);
          showToast('Đã kết nối Firebase Realtime Database', 'success');
          // Sync local data to Firebase on first connect
          syncLocalToFirebase();
        } catch (e) {
          console.error('Firebase init error:', e);
          useFirebase = false;
          updateModeIndicators(false);
        }
      };
      document.head.appendChild(script2);
    };
    document.head.appendChild(script1);
  } else {
    useFirebase = false;
    updateModeIndicators(false);
  }
}

function updateModeIndicators(isFirebase) {
  const loginIndicator = document.getElementById('login-mode-indicator');
  const sidebarBadge = document.getElementById('sidebar-mode-badge');
  if (isFirebase) {
    if (loginIndicator) {
      loginIndicator.classList.add('firebase-mode');
      loginIndicator.innerHTML = '<span class="material-icons-round">wifi</span><span>Firebase Realtime - Đồng bộ nhiều thiết bị</span>';
    }
    if (sidebarBadge) {
      sidebarBadge.classList.add('firebase-active');
      sidebarBadge.innerHTML = '<span class="material-icons-round">wifi</span><span>Firebase Realtime</span>';
    }
  }
}

// ==================== DATA LAYER ====================
function getData(key) {
  try {
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : [];
  } catch (e) {
    console.error('Error reading data:', key, e);
    return [];
  }
}

function setData(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify(data));
    // If Firebase is active, sync
    if (useFirebase && firebaseDb) {
      firebaseDb.ref(key).set(data).catch(e => console.error('Firebase sync error:', e));
    }
  } catch (e) {
    console.error('Error saving data:', key, e);
  }
}

function syncLocalToFirebase() {
  if (!useFirebase || !firebaseDb) return;
  Object.values(KEYS).forEach(key => {
    if (key === KEYS.SESSION) return;
    const localData = getData(key);
    if (localData && localData.length > 0) {
      firebaseDb.ref(key).once('value', snap => {
        const fbData = snap.val();
        if (!fbData || (Array.isArray(fbData) && fbData.length === 0)) {
          firebaseDb.ref(key).set(localData);
        }
      });
    }
  });

  // Listen for remote changes
  Object.values(KEYS).forEach(key => {
    if (key === KEYS.SESSION) return;
    firebaseDb.ref(key).on('value', snap => {
      const data = snap.val();
      if (data) {
        localStorage.setItem(key, JSON.stringify(data));
        // Refresh current view if relevant
        handleDataUpdate(key);
      }
    });
  });
}

function handleDataUpdate(key) {
  if (!currentUser) return;
  const role = currentUser.role;

  if (key === KEYS.CONFIRMATIONS) {
    if (role === 'resident') {
      if (currentView === 'resident-confirmations') renderResidentConfirmations();
      updateResidentBadges();
    }
    if (role === 'guard') {
      refreshGuardScanResult();
    }
    if (role === 'admin') {
      if (currentView === 'admin-dashboard') renderAdminDashboard();
      if (currentView === 'admin-confirmations') renderAdminConfirmations();
    }
  }
  if (key === KEYS.QR_CODES) {
    if (role === 'resident' && currentView === 'resident-qrlist') renderResidentQRList();
    if (role === 'admin' && currentView === 'admin-qrlist') renderAdminQRList();
  }
  if (key === KEYS.ENTRY_LOGS) {
    if (role === 'admin') {
      if (currentView === 'admin-dashboard') renderAdminDashboard();
      if (currentView === 'admin-logs') renderAdminLogs();
    }
    if (role === 'guard' && currentView === 'guard-logs') renderGuardLogs();
    if (role === 'resident' && currentView === 'resident-history') renderResidentHistory();
  }
  if (key === KEYS.INCIDENTS) {
    if (role === 'admin' && currentView === 'admin-incidents') renderAdminIncidents();
    if (role === 'resident' && currentView === 'resident-incidents') renderResidentIncidents();
  }
  if (key === KEYS.USERS) {
    if (role === 'admin') {
      if (currentView === 'admin-accounts') renderAccountList();
      if (currentView === 'admin-residents') renderResidentList();
      if (currentView === 'admin-guards') renderGuardList();
      if (currentView === 'admin-dashboard') renderAdminDashboard();
    }
  }
}

// ==================== DEFAULT DATA ====================
const DATA_VERSION = '4-smartgate-owner-qr';

function initDefaultData() {
  // Check data version - if outdated, reset all data
  const savedVersion = localStorage.getItem('sg_version');
  if (savedVersion !== DATA_VERSION) {
    // Clear old data to load new default accounts
    Object.values(KEYS).forEach(key => localStorage.removeItem(key));
    localStorage.setItem('sg_version', DATA_VERSION);
  }

  const users = getData(KEYS.USERS);
  if (!users || users.length === 0) {
    setData(KEYS.USERS, [
      // Ban quản lý
      {
        id: generateId(),
        fullName: 'Quản trị viên',
        username: 'admin',
        password: 'admin123',
        role: 'admin',
        phone: '0900000000',
        status: 'active',
        createdAt: new Date().toISOString()
      },
      // Bảo vệ
      {
        id: generateId(),
        fullName: 'Nguyễn Văn Nam',
        username: 'admin2',
        password: 'admin123',
        role: 'guard',
        phone: '0912345678',
        area: 'Cổng chính',
        shift: 'Ca ngày (6h-14h)',
        status: 'active',
        createdAt: new Date().toISOString()
      },
      // Cư dân - Tòa A
      {
        id: generateId(),
        fullName: 'Nguyễn Văn An',
        username: 'a501',
        password: '123456',
        role: 'resident',
        phone: '0901000501',
        apartmentId: 'A-501',
        building: 'A',
        floor: '5',
        status: 'active',
        createdAt: new Date().toISOString()
      },
      {
        id: generateId(),
        fullName: 'Trần Thị Bích',
        username: 'a802',
        password: '123456',
        role: 'resident',
        phone: '0901000802',
        apartmentId: 'A-802',
        building: 'A',
        floor: '8',
        status: 'active',
        createdAt: new Date().toISOString()
      },
      {
        id: generateId(),
        fullName: 'Trần Minh Khoa',
        username: 'a1205',
        password: '123456',
        role: 'resident',
        phone: '0901001205',
        apartmentId: 'A-1205',
        building: 'A',
        floor: '12',
        status: 'active',
        createdAt: new Date().toISOString()
      },
      {
        id: generateId(),
        fullName: 'Lê Hoàng Dũng',
        username: 'a1503',
        password: '123456',
        role: 'resident',
        phone: '0901001503',
        apartmentId: 'A-1503',
        building: 'A',
        floor: '15',
        status: 'active',
        createdAt: new Date().toISOString()
      },
      // Cư dân - Tòa B
      {
        id: generateId(),
        fullName: 'Phạm Thị Lan',
        username: 'b301',
        password: '123456',
        role: 'resident',
        phone: '0902000301',
        apartmentId: 'B-301',
        building: 'B',
        floor: '3',
        status: 'active',
        createdAt: new Date().toISOString()
      },
      {
        id: generateId(),
        fullName: 'Võ Minh Tuấn',
        username: 'b607',
        password: '123456',
        role: 'resident',
        phone: '0902000607',
        apartmentId: 'B-607',
        building: 'B',
        floor: '6',
        status: 'active',
        createdAt: new Date().toISOString()
      },
      {
        id: generateId(),
        fullName: 'Đặng Thùy Trang',
        username: 'b1001',
        password: '123456',
        role: 'resident',
        phone: '0902001001',
        apartmentId: 'B-1001',
        building: 'B',
        floor: '10',
        status: 'active',
        createdAt: new Date().toISOString()
      }
    ]);
  }

  // Version 4 starts with admin only. Residents and guards must be created by management.
  if (savedVersion !== DATA_VERSION) {
    setData(KEYS.USERS, [{
      id: generateId(),
      fullName: 'Quan tri vien',
      username: 'admin',
      password: 'admin123',
      role: 'admin',
      phone: '0900000000',
      status: 'active',
      createdAt: new Date().toISOString()
    }]);
  }

  // Initialize empty arrays if not exist
  if (!localStorage.getItem(KEYS.QR_CODES)) setData(KEYS.QR_CODES, []);
  if (!localStorage.getItem(KEYS.CONFIRMATIONS)) setData(KEYS.CONFIRMATIONS, []);
  if (!localStorage.getItem(KEYS.ENTRY_LOGS)) setData(KEYS.ENTRY_LOGS, []);
  if (!localStorage.getItem(KEYS.INCIDENTS)) setData(KEYS.INCIDENTS, []);
}

// ==================== AUTH ====================
function checkSession() {
  try {
    const session = localStorage.getItem(KEYS.SESSION);
    if (session) {
      const user = JSON.parse(session);
      const users = getData(KEYS.USERS);
      const found = users.find(u => u.id === user.id && u.status === 'active');
      if (found) {
        currentUser = found;
        showApp();
        return;
      }
    }
  } catch (e) {}
  showLogin();
}

function handleLogin(event) {
  event.preventDefault();
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  const errorEl = document.getElementById('login-error');

  if (!username || !password) {
    showLoginError('Vui lòng nhập đầy đủ thông tin');
    return;
  }

  const users = getData(KEYS.USERS);
  const user = users.find(u => u.username === username && u.password === password);

  if (!user) {
    showLoginError('Tên đăng nhập hoặc mật khẩu không đúng');
    return;
  }

  if (user.status === 'locked') {
    showLoginError('Tài khoản đã bị khóa. Liên hệ ban quản lý.');
    return;
  }

  currentUser = user;
  localStorage.setItem(KEYS.SESSION, JSON.stringify(user));
  errorEl.classList.add('hidden');
  showApp();
  showToast(`Xin chào, ${user.fullName}!`, 'success');
}

function showLoginError(msg) {
  const errorEl = document.getElementById('login-error');
  errorEl.textContent = msg;
  errorEl.classList.remove('hidden');
}

function handleLogout() {
  stopCamera();
  stopPolling();
  currentUser = null;
  currentView = null;
  localStorage.removeItem(KEYS.SESSION);
  showLogin();
  showToast('Đã đăng xuất', 'info');
}

function togglePasswordVisibility(btn) {
  const input = btn.previousElementSibling;
  const icon = btn.querySelector('.material-icons-round');
  if (input.type === 'password') {
    input.type = 'text';
    icon.textContent = 'visibility';
  } else {
    input.type = 'password';
    icon.textContent = 'visibility_off';
  }
}

// ==================== APP SHELL ====================
function showLogin() {
  document.getElementById('login-page').classList.remove('hidden');
  document.getElementById('app-shell').classList.add('hidden');
  document.getElementById('login-username').value = '';
  document.getElementById('login-password').value = '';
}

function showApp() {
  document.getElementById('login-page').classList.add('hidden');
  document.getElementById('app-shell').classList.remove('hidden');
  setupHeader();
  setupNavigation();
  navigateToDefault();
  startPolling();
}

function setupHeader() {
  const roleBadge = document.getElementById('header-role-badge');
  const userName = document.getElementById('header-user-name');
  const sidebarName = document.getElementById('sidebar-user-name');
  const sidebarRole = document.getElementById('sidebar-user-role');

  const roleNames = { admin: 'Ban quản lý', resident: 'Chủ nhà', guard: 'Bảo vệ' };
  const roleClass = { admin: 'role-admin', resident: 'role-resident', guard: 'role-guard' };

  roleBadge.textContent = roleNames[currentUser.role];
  roleBadge.className = 'user-role-badge ' + roleClass[currentUser.role];
  userName.textContent = currentUser.fullName;
  sidebarName.textContent = currentUser.fullName;
  sidebarRole.textContent = roleNames[currentUser.role];
}

// ==================== NAVIGATION ====================
const NAV_CONFIG = {
  admin: [
    { id: 'admin-dashboard', icon: 'dashboard', label: 'Dashboard', bottomNav: true },
    { id: 'admin-accounts', icon: 'manage_accounts', label: 'Quản lý TK', bottomNav: true },
    { id: 'admin-residents', icon: 'people', label: 'Cư dân', bottomNav: false },
    { id: 'admin-guards', icon: 'security', label: 'Bảo vệ', bottomNav: false },
    { id: 'admin-qrlist', icon: 'qr_code_2', label: 'QR Code', bottomNav: true },
    { id: 'admin-confirmations', icon: 'fact_check', label: 'Xác nhận', bottomNav: false },
    { id: 'admin-logs', icon: 'history', label: 'Nhật ký', bottomNav: true },
    { id: 'admin-incidents', icon: 'report_problem', label: 'Sự cố', bottomNav: true }
  ],
  resident: [
    { id: 'resident-create-qr', icon: 'qr_code', label: 'Tạo QR', bottomNav: true },
    { id: 'resident-qrlist', icon: 'qr_code_2', label: 'QR đã tạo', bottomNav: true },
    { id: 'resident-confirmations', icon: 'notifications_active', label: 'Xác nhận', bottomNav: true, badgeKey: 'pendingConfirm' },
    { id: 'resident-incidents', icon: 'report_problem', label: 'Sự cố', bottomNav: true },
    { id: 'resident-history', icon: 'history', label: 'Lịch sử', bottomNav: false },
    { id: 'resident-info', icon: 'person', label: 'Tài khoản', bottomNav: true }
  ],
  guard: [
    { id: 'guard-scanner', icon: 'qr_code_scanner', label: 'Quét QR', bottomNav: true },
    { id: 'guard-logs', icon: 'history', label: 'Nhật ký', bottomNav: true }
  ]
};

function setupNavigation() {
  const role = currentUser.role;
  const navItems = NAV_CONFIG[role] || [];
  const sidebarMenu = document.getElementById('sidebar-menu');
  const bottomNav = document.getElementById('bottom-nav');

  // Sidebar
  sidebarMenu.innerHTML = navItems.map(item => `
    <li>
      <a href="#" data-view="${item.id}" onclick="navigateTo('${item.id}'); closeSidebar(); return false;">
        <span class="material-icons-round">${item.icon}</span>
        ${item.label}
        ${item.badgeKey ? `<span class="nav-badge hidden" id="sidebar-badge-${item.id}"></span>` : ''}
      </a>
    </li>
  `).join('');

  // Bottom nav (mobile) - max 5 items
  const bottomItems = navItems.filter(i => i.bottomNav).slice(0, 5);
  bottomNav.innerHTML = bottomItems.map(item => `
    <button class="bottom-nav-item" data-view="${item.id}" onclick="navigateTo('${item.id}')">
      <span class="material-icons-round">${item.icon}</span>
      ${item.label}
      ${item.badgeKey ? `<span class="nav-badge hidden" id="bottom-badge-${item.id}"></span>` : ''}
    </button>
  `).join('');
}

function navigateToDefault() {
  const role = currentUser.role;
  const defaults = { admin: 'admin-dashboard', resident: 'resident-create-qr', guard: 'guard-scanner' };
  navigateTo(defaults[role]);
}

function navigateTo(viewId) {
  // Hide all views
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));

  // Show target view
  const target = document.getElementById('view-' + viewId);
  if (target) {
    target.classList.remove('hidden');
    currentView = viewId;
  }

  // Update nav active states
  document.querySelectorAll('.sidebar-menu a').forEach(a => {
    a.classList.toggle('active', a.dataset.view === viewId);
  });
  document.querySelectorAll('.bottom-nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === viewId);
  });

  // Render view content
  renderView(viewId);

  // Scroll to top
  window.scrollTo(0, 0);
}

function renderView(viewId) {
  switch (viewId) {
    case 'admin-dashboard': renderAdminDashboard(); break;
    case 'admin-accounts': renderAccountList(); break;
    case 'admin-residents': renderResidentList(); break;
    case 'admin-guards': renderGuardList(); break;
    case 'admin-qrlist': renderAdminQRList(); break;
    case 'admin-confirmations': renderAdminConfirmations(); break;
    case 'admin-logs': renderAdminLogs(); break;
    case 'admin-incidents': renderAdminIncidents(); break;
    case 'resident-info': renderResidentInfo(); break;
    case 'resident-create-qr': setupResidentQRForm(); break;
    case 'resident-qrlist': renderResidentQRList(); break;
    case 'resident-confirmations': renderResidentConfirmations(); break;
    case 'resident-incidents': renderResidentIncidents(); break;
    case 'resident-history': renderResidentHistory(); break;
    case 'guard-scanner': setupGuardScanner(); break;
    case 'guard-logs': renderGuardLogs(); break;
  }
}

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  sidebar.classList.toggle('open');
  overlay.classList.toggle('hidden');
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.add('hidden');
}

// ==================== POLLING (for localStorage mode) ====================
function startPolling() {
  if (useFirebase) return; // Firebase handles realtime
  stopPolling();
  pollingInterval = setInterval(() => {
    if (!currentUser) return;
    handleDataUpdate(KEYS.CONFIRMATIONS);
    handleDataUpdate(KEYS.QR_CODES);
    handleDataUpdate(KEYS.ENTRY_LOGS);
  }, 2000);
}

function stopPolling() {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
}

// ==================== TOAST ====================
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const icons = {
    success: 'check_circle',
    error: 'error',
    warning: 'warning',
    info: 'info'
  };

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span class="material-icons-round toast-icon">${icons[type]}</span>
    <span class="toast-message">${message}</span>
  `;

  toast.onclick = () => removeToast(toast);
  container.appendChild(toast);

  setTimeout(() => removeToast(toast), 4000);
}

function removeToast(toast) {
  toast.classList.add('toast-exit');
  setTimeout(() => toast.remove(), 300);
}

// ==================== MODAL ====================
function openModal(title, bodyHtml, footerHtml = '') {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = bodyHtml;
  document.getElementById('modal-footer').innerHTML = footerHtml;
  document.getElementById('modal-overlay').classList.remove('hidden');
}

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
}

// ==================== UTILITY ====================
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
}

function generateToken() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let token = 'SG-';
  for (let i = 0; i < 24; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

function formatDateTime(isoStr) {
  if (!isoStr) return '—';
  const d = new Date(isoStr);
  return d.toLocaleString('vi-VN', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

function formatDateShort(isoStr) {
  if (!isoStr) return '—';
  const d = new Date(isoStr);
  return d.toLocaleString('vi-VN', {
    day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit'
  });
}

function timeAgo(isoStr) {
  const now = new Date();
  const then = new Date(isoStr);
  const diffMs = now - then;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Vừa xong';
  if (mins < 60) return `${mins} phút trước`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} giờ trước`;
  const days = Math.floor(hours / 24);
  return `${days} ngày trước`;
}

function isToday(isoStr) {
  const d = new Date(isoStr);
  const now = new Date();
  return d.toDateString() === now.toDateString();
}

function getRoleName(role) {
  const map = { admin: 'Ban quản lý', resident: 'Chủ nhà', guard: 'Bảo vệ' };
  return map[role] || role;
}

function getStatusText(status) {
  const map = {
    active: 'Còn hiệu lực',
    used: 'Đã sử dụng',
    expired: 'Hết hạn',
    cancelled: 'Đã hủy',
    waitingOwner: 'Chờ chủ nhà xác nhận',
    ownerApproved: 'Chủ nhà đã đồng ý',
    pending: 'Đang chờ',
    approved: 'Đã đồng ý',
    rejected: 'Đã từ chối',
    entered: 'Đã cho vào'
  };
  return map[status] || status;
}

function getStatusClass(status) {
  const map = {
    active: 'status-active',
    used: 'status-used',
    expired: 'status-expired',
    cancelled: 'status-cancelled',
    waitingOwner: 'status-pending',
    ownerApproved: 'status-approved',
    pending: 'status-pending',
    approved: 'status-approved',
    rejected: 'status-rejected',
    entered: 'status-entered',
    locked: 'status-locked',
    new: 'status-new',
    processing: 'status-processing',
    resolved: 'status-resolved'
  };
  return map[status] || '';
}

function getCategoryName(cat) {
  const map = {
    security: 'An ninh',
    hygiene: 'Vệ sinh',
    technical: 'Kỹ thuật',
    elevator: 'Thang máy',
    other: 'Khác'
  };
  return map[cat] || cat;
}

function getSeverityName(sev) {
  const map = { low: 'Thấp', medium: 'Trung bình', high: 'Cao' };
  return map[sev] || sev;
}

function getIncidentStatusName(st) {
  const map = { new: 'Mới tiếp nhận', processing: 'Đang xử lý', resolved: 'Đã xử lý' };
  return map[st] || st;
}

function emptyStateHtml(icon, message) {
  return `
    <div class="empty-state">
      <span class="material-icons-round">${icon}</span>
      <p>${message}</p>
    </div>
  `;
}

// Check and update expired QR codes
function checkExpiredQRs() {
  const qrs = getData(KEYS.QR_CODES);
  const now = new Date().getTime();
  let changed = false;
  qrs.forEach(qr => {
    if (qr.status === 'active' && qr.expiresAt && new Date(qr.expiresAt).getTime() < now) {
      qr.status = 'expired';
      changed = true;
    }
  });
  if (changed) setData(KEYS.QR_CODES, qrs);
}

// ============================================================
//               ADMIN VIEWS
// ============================================================

// ==================== ADMIN DASHBOARD ====================
function renderAdminDashboard() {
  checkExpiredQRs();
  const users = getData(KEYS.USERS);
  const qrs = getData(KEYS.QR_CODES);
  const confirms = getData(KEYS.CONFIRMATIONS);
  const logs = getData(KEYS.ENTRY_LOGS);
  const incidents = getData(KEYS.INCIDENTS);

  const totalUsers = users.length;
  const totalResidents = users.filter(u => u.role === 'resident').length;
  const totalGuards = users.filter(u => u.role === 'guard').length;
  const totalQR = qrs.length;
  const scansToday = logs.filter(l => isToday(l.entryTime)).length;
  const pendingConfirms = confirms.filter(c => c.status === 'pending').length;
  const entered = logs.filter(l => l.status === 'entered').length;
  const rejected = confirms.filter(c => c.status === 'rejected').length;
  const expiredQR = qrs.filter(q => q.status === 'expired').length;
  const processingIncidents = incidents.filter(i => i.status !== 'resolved').length;

  const statsGrid = document.getElementById('admin-stats-grid');
  statsGrid.innerHTML = `
    <div class="stat-card">
      <div class="stat-icon blue"><span class="material-icons-round">people</span></div>
      <div class="stat-info"><div class="stat-value">${totalUsers}</div><div class="stat-label">Tổng tài khoản</div></div>
    </div>
    <div class="stat-card">
      <div class="stat-icon green"><span class="material-icons-round">home</span></div>
      <div class="stat-info"><div class="stat-value">${totalResidents}</div><div class="stat-label">Chủ nhà</div></div>
    </div>
    <div class="stat-card">
      <div class="stat-icon orange"><span class="material-icons-round">security</span></div>
      <div class="stat-info"><div class="stat-value">${totalGuards}</div><div class="stat-label">Bảo vệ</div></div>
    </div>
    <div class="stat-card">
      <div class="stat-icon purple"><span class="material-icons-round">qr_code_2</span></div>
      <div class="stat-info"><div class="stat-value">${totalQR}</div><div class="stat-label">QR đã tạo</div></div>
    </div>
    <div class="stat-card">
      <div class="stat-icon cyan"><span class="material-icons-round">today</span></div>
      <div class="stat-info"><div class="stat-value">${scansToday}</div><div class="stat-label">Lượt hôm nay</div></div>
    </div>
    <div class="stat-card">
      <div class="stat-icon orange"><span class="material-icons-round">pending_actions</span></div>
      <div class="stat-info"><div class="stat-value">${pendingConfirms}</div><div class="stat-label">Chờ xác nhận</div></div>
    </div>
    <div class="stat-card">
      <div class="stat-icon green"><span class="material-icons-round">check_circle</span></div>
      <div class="stat-info"><div class="stat-value">${entered}</div><div class="stat-label">Đã cho vào</div></div>
    </div>
    <div class="stat-card">
      <div class="stat-icon red"><span class="material-icons-round">cancel</span></div>
      <div class="stat-info"><div class="stat-value">${rejected}</div><div class="stat-label">Bị từ chối</div></div>
    </div>
    <div class="stat-card">
      <div class="stat-icon red"><span class="material-icons-round">timer_off</span></div>
      <div class="stat-info"><div class="stat-value">${expiredQR}</div><div class="stat-label">QR hết hạn</div></div>
    </div>
    <div class="stat-card">
      <div class="stat-icon orange"><span class="material-icons-round">build</span></div>
      <div class="stat-info"><div class="stat-value">${processingIncidents}</div><div class="stat-label">Sự cố xử lý</div></div>
    </div>
  `;

  // Recent logs
  const recentLogs = logs.slice(-5).reverse();
  const logsContainer = document.getElementById('admin-recent-logs');
  if (recentLogs.length === 0) {
    logsContainer.innerHTML = emptyStateHtml('history', 'Chưa có nhật ký ra/vào');
  } else {
    logsContainer.innerHTML = `
      <table class="data-table">
        <thead><tr><th>Thời gian</th><th>Người đến</th><th>Căn hộ</th><th>Trạng thái</th></tr></thead>
        <tbody>${recentLogs.map(l => `
          <tr>
            <td>${formatDateShort(l.entryTime)}</td>
            <td>${l.visitorName}</td>
            <td>${l.apartmentId || '—'}</td>
            <td><span class="status-badge status-entered">Đã cho vào</span></td>
          </tr>
        `).join('')}</tbody>
      </table>
    `;
  }

  // Pending requests
  const pendingReqs = confirms.filter(c => c.status === 'pending').slice(-5).reverse();
  const pendingContainer = document.getElementById('admin-pending-requests');
  if (pendingReqs.length === 0) {
    pendingContainer.innerHTML = emptyStateHtml('done_all', 'Không có yêu cầu nào đang chờ');
  } else {
    pendingContainer.innerHTML = pendingReqs.map(r => `
      <div class="list-card" style="margin: 8px 16px;">
        <div class="list-card-header">
          <div>
            <div class="list-card-title">${r.visitorName}</div>
            <div class="list-card-subtitle">${r.visitorType} → ${r.apartmentId}</div>
          </div>
          <span class="status-badge status-pending">Đang chờ</span>
        </div>
        <div class="list-card-body">
          <div class="list-card-row"><span class="material-icons-round">schedule</span>${timeAgo(r.scanTime)}</div>
        </div>
      </div>
    `).join('');
  }
}

// ==================== ADMIN ACCOUNTS ====================
function renderAccountList() {
  const users = getData(KEYS.USERS);
  const roleFilter = document.getElementById('filter-account-role').value;
  const statusFilter = document.getElementById('filter-account-status').value;
  const search = document.getElementById('search-account').value.toLowerCase();

  let filtered = users.filter(u => {
    if (roleFilter && u.role !== roleFilter) return false;
    if (statusFilter && u.status !== statusFilter) return false;
    if (search && !u.fullName.toLowerCase().includes(search) && !u.username.toLowerCase().includes(search)) return false;
    return true;
  });

  const container = document.getElementById('account-list');
  if (filtered.length === 0) {
    container.innerHTML = emptyStateHtml('person_off', 'Không tìm thấy tài khoản nào');
    return;
  }

  container.innerHTML = filtered.map(u => {
    const isSystem = u.role === 'admin';
    return `
    <div class="list-card">
      <div class="list-card-header">
        <div>
          <div class="list-card-title">${u.fullName}</div>
          <div class="list-card-subtitle">@${u.username} ${isSystem ? '<span style="font-size:0.7rem; color:var(--primary-light);">(Tài khoản hệ thống)</span>' : ''}</div>
        </div>
        <div style="display: flex; gap: 6px; align-items: center;">
          <span class="user-role-badge role-${u.role}">${getRoleName(u.role)}</span>
          <span class="status-badge ${u.status === 'active' ? 'status-active' : 'status-locked'}">${u.status === 'active' ? 'Hoạt động' : 'Khóa'}</span>
        </div>
      </div>
      <div class="list-card-body">
        <div class="list-card-row"><span class="material-icons-round">phone</span>${u.phone || '—'}</div>
        ${u.role === 'resident' ? `<div class="list-card-row"><span class="material-icons-round">apartment</span>Căn hộ: ${u.apartmentId || '—'} | Tòa ${u.building || '—'} | Tầng ${u.floor || '—'}</div>` : ''}
        ${u.role === 'guard' ? `<div class="list-card-row"><span class="material-icons-round">location_on</span>${u.area || '—'} | ${u.shift || '—'}</div>` : ''}
      </div>
      ${isSystem ? '' : `
      <div class="list-card-actions">
        <button class="btn btn-sm btn-outline" onclick="editAccount('${u.id}')"><span class="material-icons-round">edit</span>Sửa</button>
        ${u.status === 'active'
          ? `<button class="btn btn-sm btn-warning" onclick="toggleAccountStatus('${u.id}', 'locked')"><span class="material-icons-round">lock</span>Khóa</button>`
          : `<button class="btn btn-sm btn-success" onclick="toggleAccountStatus('${u.id}', 'active')"><span class="material-icons-round">lock_open</span>Mở khóa</button>`}
        <button class="btn btn-sm btn-danger" onclick="deleteAccount('${u.id}')"><span class="material-icons-round">delete</span>Xóa</button>
      </div>
      `}
    </div>
  `;
  }).join('');
}

function showAccountForm(userId = null) {

  navigateTo('admin-account-form');
  const form = document.getElementById('account-form');
  form.reset();
  document.getElementById('account-edit-id').value = '';
  document.getElementById('account-form-title').textContent = 'Tạo tài khoản mới';
  document.getElementById('account-form-submit-btn').innerHTML = '<span class="material-icons-round">save</span> Luu tai khoan';
  document.getElementById('acc-username').removeAttribute('readonly');
  document.getElementById('acc-role').value = 'resident';
  toggleRoleFields();

  if (userId) {
    const users = getData(KEYS.USERS);
    const user = users.find(u => u.id === userId);
    if (user) {
      document.getElementById('account-edit-id').value = user.id;
      document.getElementById('account-form-title').textContent = 'Chinh sua tai khoan';
      document.getElementById('acc-fullname').value = user.fullName;
      document.getElementById('acc-username').value = user.username;
      document.getElementById('acc-username').setAttribute('readonly', true);
      document.getElementById('acc-password').value = user.password;
      document.getElementById('acc-phone').value = user.phone || '';
      document.getElementById('acc-role').value = user.role;
      document.getElementById('acc-status').value = user.status;
      toggleRoleFields();
      if (user.role === 'resident') {
        document.getElementById('acc-apartment').value = user.apartmentId || '';
        document.getElementById('acc-building').value = user.building || '';
        document.getElementById('acc-floor').value = user.floor || '';
      }
      if (user.role === 'guard') {
        document.getElementById('acc-area').value = user.area || '';
        document.getElementById('acc-shift').value = user.shift || '';
      }
    }
  }
}

function editAccount(userId) {
  showAccountForm(userId);
}

function toggleRoleFields() {
  const role = document.getElementById('acc-role').value;
  document.getElementById('resident-fields').classList.toggle('hidden', role !== 'resident');
  document.getElementById('guard-fields').classList.toggle('hidden', role !== 'guard');
}

function handleSaveAccount(event) {
  event.preventDefault();
  const editId = document.getElementById('account-edit-id').value;
  const fullName = document.getElementById('acc-fullname').value.trim();
  const username = document.getElementById('acc-username').value.trim();
  const password = document.getElementById('acc-password').value;
  const phone = document.getElementById('acc-phone').value.trim();
  const role = document.getElementById('acc-role').value;
  const status = document.getElementById('acc-status').value;

  if (!fullName || !username || !password || !role) {
    showToast('Vui lòng điền đầy đủ thông tin bắt buộc', 'error');
    return;
  }

  const users = getData(KEYS.USERS);

  // Check username uniqueness for new accounts
  if (!editId) {
    if (users.find(u => u.username === username)) {
      showToast('Tên đăng nhập đã tồn tại', 'error');
      return;
    }
  }

  let userData = {
    fullName, username, password, phone, role, status
  };

  if (role === 'resident') {
    const apartmentId = document.getElementById('acc-apartment').value.trim();
    const building = document.getElementById('acc-building').value.trim();
    const floor = document.getElementById('acc-floor').value.trim();
    if (!apartmentId || !building || !floor) {
      showToast('Vui lòng nhập đầy đủ thông tin căn hộ', 'error');
      return;
    }
    userData.apartmentId = apartmentId;
    userData.building = building;
    userData.floor = floor;
  }

  if (role === 'guard') {
    const area = document.getElementById('acc-area').value;
    const shift = document.getElementById('acc-shift').value;
    if (!area || !shift) {
      showToast('Vui lòng chọn khu vực trực và ca trực', 'error');
      return;
    }
    userData.area = area;
    userData.shift = shift;
  }

  if (editId) {
    // Update
    const idx = users.findIndex(u => u.id === editId);
    if (idx !== -1) {
      users[idx] = { ...users[idx], ...userData };
      setData(KEYS.USERS, users);
      showToast('Cập nhật tài khoản thành công', 'success');
    }
  } else {
    // Create
    userData.id = generateId();
    userData.createdAt = new Date().toISOString();
    users.push(userData);
    setData(KEYS.USERS, users);
    showToast(`Tạo tài khoản "${username}" thành công`, 'success');
  }

  navigateTo('admin-accounts');
}

function toggleAccountStatus(userId, newStatus) {
  const users = getData(KEYS.USERS);
  const user = users.find(u => u.id === userId);
  if (user) {
    user.status = newStatus;
    setData(KEYS.USERS, users);
    showToast(`Đã ${newStatus === 'locked' ? 'khóa' : 'mở khóa'} tài khoản "${user.username}"`, 'success');
    renderAccountList();
  }
}

function deleteAccount(userId) {
  const users = getData(KEYS.USERS);
  const user = users.find(u => u.id === userId);
  if (!user) return;
  if (user.role === 'admin') {
    showToast('Không thể xóa tài khoản hệ thống (Ban quản lý / Bảo vệ)', 'error');
    return;
  }

  openModal('Xác nhận xóa', `
    <p>Bạn có chắc muốn xóa tài khoản <strong>${user.fullName}</strong> (@${user.username})?</p>
    <p style="color: var(--danger); margin-top: 8px; font-size: 0.85rem;">Hành động này không thể hoàn tác.</p>
  `, `
    <button class="btn btn-ghost" onclick="closeModal()">Hủy</button>
    <button class="btn btn-danger" onclick="confirmDeleteAccount('${userId}')"><span class="material-icons-round">delete</span>Xóa</button>
  `);
}

function confirmDeleteAccount(userId) {
  let users = getData(KEYS.USERS);
  users = users.filter(u => u.id !== userId);
  setData(KEYS.USERS, users);
  closeModal();
  showToast('Đã xóa tài khoản', 'success');
  renderAccountList();
}

// ==================== ADMIN RESIDENT/GUARD LISTS ====================
function renderResidentList() {
  const users = getData(KEYS.USERS).filter(u => u.role === 'resident');
  const search = document.getElementById('search-resident')?.value.toLowerCase() || '';
  const filtered = search ? users.filter(u => u.fullName.toLowerCase().includes(search) || (u.apartmentId || '').toLowerCase().includes(search)) : users;
  const container = document.getElementById('resident-list');

  if (filtered.length === 0) {
    container.innerHTML = emptyStateHtml('people', 'Chưa có cư dân nào');
    return;
  }

  container.innerHTML = filtered.map(u => `
    <div class="list-card">
      <div class="list-card-header">
        <div>
          <div class="list-card-title">${u.fullName}</div>
          <div class="list-card-subtitle">Căn hộ ${u.apartmentId || '—'}</div>
        </div>
        <span class="status-badge ${u.status === 'active' ? 'status-active' : 'status-locked'}">${u.status === 'active' ? 'Hoạt động' : 'Khóa'}</span>
      </div>
      <div class="list-card-body">
        <div class="list-card-row"><span class="material-icons-round">phone</span>${u.phone || '—'}</div>
        <div class="list-card-row"><span class="material-icons-round">apartment</span>Tòa ${u.building || '—'} | Tầng ${u.floor || '—'}</div>
        <div class="list-card-row"><span class="material-icons-round">person</span>@${u.username}</div>
      </div>
    </div>
  `).join('');
}

function renderGuardList() {
  const users = getData(KEYS.USERS).filter(u => u.role === 'guard');
  const container = document.getElementById('guard-list');

  if (users.length === 0) {
    container.innerHTML = emptyStateHtml('security', 'Chưa có bảo vệ nào');
    return;
  }

  container.innerHTML = users.map(u => `
    <div class="list-card">
      <div class="list-card-header">
        <div>
          <div class="list-card-title">${u.fullName}</div>
          <div class="list-card-subtitle">@${u.username}</div>
        </div>
        <span class="status-badge ${u.status === 'active' ? 'status-active' : 'status-locked'}">${u.status === 'active' ? 'Hoạt động' : 'Khóa'}</span>
      </div>
      <div class="list-card-body">
        <div class="list-card-row"><span class="material-icons-round">phone</span>${u.phone || '—'}</div>
        <div class="list-card-row"><span class="material-icons-round">location_on</span>${u.area || '—'}</div>
        <div class="list-card-row"><span class="material-icons-round">schedule</span>${u.shift || '—'}</div>
      </div>
    </div>
  `).join('');
}

// ==================== ADMIN QR LIST ====================
function renderAdminQRList() {
  checkExpiredQRs();
  const qrs = getData(KEYS.QR_CODES);
  const statusFilter = document.getElementById('filter-qr-status')?.value || '';
  const search = document.getElementById('search-qr')?.value.toLowerCase() || '';

  let filtered = qrs.filter(q => {
    if (statusFilter && q.status !== statusFilter) return false;
    if (search && !q.visitorName.toLowerCase().includes(search) && !(q.apartmentId || '').toLowerCase().includes(search)) return false;
    return true;
  }).reverse();

  const container = document.getElementById('admin-qr-list');
  if (filtered.length === 0) {
    container.innerHTML = emptyStateHtml('qr_code_2', 'Chưa có mã QR nào');
    return;
  }

  container.innerHTML = filtered.map(q => `
    <div class="list-card">
      <div class="list-card-header">
        <div>
          <div class="list-card-title">${q.visitorName}</div>
          <div class="list-card-subtitle">${q.visitorType} → ${q.apartmentId || '—'}</div>
        </div>
        <span class="status-badge ${getStatusClass(q.status)}">${getStatusText(q.status)}</span>
      </div>
      <div class="list-card-body">
        <div class="list-card-row"><span class="material-icons-round">person</span>Chủ nhà: ${q.residentName}</div>
        <div class="list-card-row"><span class="material-icons-round">schedule</span>Tạo: ${formatDateShort(q.createdAt)}</div>
        <div class="list-card-row"><span class="material-icons-round">timer</span>Hết hạn: ${formatDateShort(q.expiresAt)}</div>
      </div>
    </div>
  `).join('');
}

// ==================== ADMIN CONFIRMATIONS ====================
function renderAdminConfirmations() {
  const confirms = getData(KEYS.CONFIRMATIONS);
  const statusFilter = document.getElementById('filter-confirm-status')?.value || '';
  let filtered = statusFilter ? confirms.filter(c => c.status === statusFilter) : confirms;
  filtered = filtered.slice().reverse();

  const container = document.getElementById('admin-confirm-list');
  if (filtered.length === 0) {
    container.innerHTML = emptyStateHtml('fact_check', 'Chưa có yêu cầu xác nhận nào');
    return;
  }

  container.innerHTML = filtered.map(c => `
    <div class="list-card">
      <div class="list-card-header">
        <div>
          <div class="list-card-title">${c.visitorName}</div>
          <div class="list-card-subtitle">${c.visitorType} → ${c.apartmentId}</div>
        </div>
        <span class="status-badge ${getStatusClass(c.status)}">${getStatusText(c.status)}</span>
      </div>
      <div class="list-card-body">
        <div class="list-card-row"><span class="material-icons-round">security</span>BV: ${c.guardName} | ${c.guardArea}</div>
        <div class="list-card-row"><span class="material-icons-round">schedule</span>${formatDateTime(c.scanTime)}</div>
        ${c.responseTime ? `<div class="list-card-row"><span class="material-icons-round">done</span>Phản hồi: ${formatDateTime(c.responseTime)}</div>` : ''}
      </div>
    </div>
  `).join('');
}

// ==================== ADMIN LOGS ====================
function renderAdminLogs() {
  const logs = getData(KEYS.ENTRY_LOGS);
  const dateFilter = document.getElementById('filter-log-date')?.value || '';
  const search = document.getElementById('search-log')?.value.toLowerCase() || '';

  let filtered = logs.filter(l => {
    if (dateFilter) {
      const logDate = new Date(l.entryTime).toISOString().split('T')[0];
      if (logDate !== dateFilter) return false;
    }
    if (search) {
      const searchStr = `${l.visitorName} ${l.apartmentId} ${l.guardName}`.toLowerCase();
      if (!searchStr.includes(search)) return false;
    }
    return true;
  }).reverse();

  const container = document.getElementById('admin-log-list');
  if (filtered.length === 0) {
    container.innerHTML = emptyStateHtml('history', 'Chưa có nhật ký nào');
    return;
  }

  container.innerHTML = filtered.map(l => `
    <div class="list-card">
      <div class="list-card-header">
        <div>
          <div class="list-card-title">${l.visitorName}</div>
          <div class="list-card-subtitle">${l.visitorType} → ${l.apartmentId || '—'}</div>
        </div>
        <span class="status-badge status-entered">Đã cho vào</span>
      </div>
      <div class="list-card-body">
        <div class="list-card-row"><span class="material-icons-round">schedule</span>${formatDateTime(l.entryTime)}</div>
        <div class="list-card-row"><span class="material-icons-round">person</span>Chủ nhà: ${l.residentName || '—'}</div>
        <div class="list-card-row"><span class="material-icons-round">security</span>BV: ${l.guardName || '—'} | ${l.guardArea || '—'}</div>
      </div>
    </div>
  `).join('');
}

// ==================== ADMIN INCIDENTS ====================
function renderAdminIncidents() {
  const incidents = getData(KEYS.INCIDENTS);
  const statusFilter = document.getElementById('filter-incident-status')?.value || '';
  const catFilter = document.getElementById('filter-incident-category')?.value || '';

  let filtered = incidents.filter(i => {
    if (statusFilter && i.status !== statusFilter) return false;
    if (catFilter && i.category !== catFilter) return false;
    return true;
  }).reverse();

  const container = document.getElementById('admin-incident-list');
  if (filtered.length === 0) {
    container.innerHTML = emptyStateHtml('report_problem', 'Chưa có phản ánh nào');
    return;
  }

  container.innerHTML = filtered.map(i => `
    <div class="list-card">
      <div class="list-card-header">
        <div>
          <div class="list-card-title">${i.title}</div>
          <div class="list-card-subtitle">${getCategoryName(i.category)} | Căn hộ ${i.apartmentId || '—'}</div>
        </div>
        <span class="status-badge ${getStatusClass(i.status)}">${getIncidentStatusName(i.status)}</span>
      </div>
      <div class="list-card-body">
        <div class="list-card-row"><span class="material-icons-round">priority_high</span>Mức độ: <span class="status-badge severity-${i.severity}" style="margin-left:4px;">${getSeverityName(i.severity)}</span></div>
        <div class="list-card-row"><span class="material-icons-round">person</span>${i.submittedBy || '—'}</div>
        <div class="list-card-row"><span class="material-icons-round">schedule</span>${formatDateTime(i.submittedAt)}</div>
        <div class="list-card-row" style="margin-top:4px;"><span class="material-icons-round">description</span>${i.content}</div>
      </div>
      <div class="list-card-actions">
        ${i.status === 'new' ? `<button class="btn btn-sm btn-warning" onclick="updateIncidentStatus('${i.id}', 'processing')"><span class="material-icons-round">engineering</span>Đang xử lý</button>` : ''}
        ${i.status === 'processing' ? `<button class="btn btn-sm btn-success" onclick="updateIncidentStatus('${i.id}', 'resolved')"><span class="material-icons-round">check_circle</span>Đã xử lý</button>` : ''}
        ${i.status === 'resolved' ? '<span style="color: var(--success); font-size: 0.8rem;">✓ Đã hoàn thành</span>' : ''}
      </div>
    </div>
  `).join('');
}

function updateIncidentStatus(incidentId, newStatus) {
  const incidents = getData(KEYS.INCIDENTS);
  const incident = incidents.find(i => i.id === incidentId);
  if (incident) {
    incident.status = newStatus;
    setData(KEYS.INCIDENTS, incidents);
    showToast(`Đã cập nhật trạng thái: ${getIncidentStatusName(newStatus)}`, 'success');
    renderAdminIncidents();
  }
}

// ============================================================
//               RESIDENT VIEWS
// ============================================================

// ==================== RESIDENT INFO ====================
function renderResidentInfo() {
  const u = currentUser;
  const container = document.getElementById('resident-profile-card');
  container.innerHTML = `
    <div class="profile-header">
      <div class="profile-avatar"><span class="material-icons-round">person</span></div>
      <div class="profile-name">${u.fullName}</div>
      <span class="profile-role-badge">${getRoleName(u.role)}</span>
    </div>
    <div class="profile-body">
      <div class="profile-info-row">
        <span class="material-icons-round">person</span>
        <div><div class="profile-info-label">Tên đăng nhập</div><div class="profile-info-value">@${u.username}</div></div>
      </div>
      <div class="profile-info-row">
        <span class="material-icons-round">phone</span>
        <div><div class="profile-info-label">Số điện thoại</div><div class="profile-info-value">${u.phone || '—'}</div></div>
      </div>
      <div class="profile-info-row">
        <span class="material-icons-round">apartment</span>
        <div><div class="profile-info-label">Căn hộ</div><div class="profile-info-value">${u.apartmentId || '—'}</div></div>
      </div>
      <div class="profile-info-row">
        <span class="material-icons-round">domain</span>
        <div><div class="profile-info-label">Tòa nhà / Tầng</div><div class="profile-info-value">Tòa ${u.building || '—'} / Tầng ${u.floor || '—'}</div></div>
      </div>
      <div class="profile-info-row">
        <span class="material-icons-round">circle</span>
        <div><div class="profile-info-label">Trạng thái</div><div class="profile-info-value"><span class="status-badge status-active">Đang hoạt động</span></div></div>
      </div>
    </div>
  `;
}

// ==================== RESIDENT CREATE QR ====================
function setupResidentQRForm() {
  const apartmentField = document.getElementById('qr-apartment-display');
  if (currentUser && currentUser.apartmentId) {
    apartmentField.value = `${currentUser.apartmentId} - Tòa ${currentUser.building} - Tầng ${currentUser.floor}`;
  }
  // Always show form and hide result when navigating to this view
  document.getElementById('create-qr-form').classList.remove('hidden');
  document.getElementById('qr-result').classList.add('hidden');
}

function handleCreateQR(event) {
  event.preventDefault();

  const visitorName = document.getElementById('qr-visitor-name').value.trim();
  const visitorType = document.getElementById('qr-visitor-type').value;
  const visitorPhone = document.getElementById('qr-visitor-phone').value.trim();
  const vehicleOrOrderCode = document.getElementById('qr-vehicle').value.trim();
  const expiresMinutes = parseInt(document.getElementById('qr-expires').value);
  const note = document.getElementById('qr-note').value.trim();

  if (!visitorName || !visitorType) {
    showToast('Vui lòng điền tên người đến và loại đối tượng', 'error');
    return;
  }

  const token = generateToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + expiresMinutes * 60000).toISOString();

  const qrData = {
    app: 'SmartGateQR',
    type: 'entry-pass',
    token: token,
    apartmentId: currentUser.apartmentId,
    apartmentName: `${currentUser.apartmentId} - Tòa ${currentUser.building}`,
    residentName: currentUser.fullName,
    residentUsername: currentUser.username,
    visitorName: visitorName,
    visitorType: visitorType,
    visitorPhone: visitorPhone,
    vehicleOrOrderCode: vehicleOrOrderCode,
    expiresAt: expiresAt,
    note: note,
    createdAt: now.toISOString(),
    status: 'active'
  };

  // Save QR to database
  const qrs = getData(KEYS.QR_CODES);
  qrs.push(qrData);
  setData(KEYS.QR_CODES, qrs);

  // Generate QR code image
  const qrDisplay = document.getElementById('qr-code-display');
  qrDisplay.innerHTML = '';
  new QRCode(qrDisplay, {
    text: JSON.stringify(compactQrPayload(qrData)),
    typeNumber: 10,
    width: 200,
    height: 200,
    colorDark: '#0f172a',
    colorLight: '#ffffff',
    correctLevel: QRCode.CorrectLevel.L
  });

  // Show info summary
  const summaryEl = document.getElementById('qr-info-summary');
  summaryEl.innerHTML = `
    <div class="info-row"><span class="info-label">Người đến:</span><span class="info-value">${visitorName}</span></div>
    <div class="info-row"><span class="info-label">Loại:</span><span class="info-value">${visitorType}</span></div>
    <div class="info-row"><span class="info-label">Căn hộ:</span><span class="info-value">${currentUser.apartmentId}</span></div>
    <div class="info-row"><span class="info-label">SĐT:</span><span class="info-value">${visitorPhone || '—'}</span></div>
    <div class="info-row"><span class="info-label">Biển số/Mã đơn:</span><span class="info-value">${vehicleOrOrderCode || '—'}</span></div>
    <div class="info-row"><span class="info-label">Hết hạn:</span><span class="info-value">${formatDateTime(expiresAt)}</span></div>
  `;

  // Show token
  document.getElementById('qr-token-display').textContent = token;

  // Show result card
  document.getElementById('qr-result').classList.remove('hidden');
  document.getElementById('create-qr-form').classList.add('hidden');

  showToast('Tạo mã QR thành công!', 'success');
}

function copyToken() {
  const token = document.getElementById('qr-token-display').textContent;
  navigator.clipboard.writeText(token).then(() => {
    showToast('Đã sao chép token', 'success');
  }).catch(() => {
    // Fallback
    const textarea = document.createElement('textarea');
    textarea.value = token;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    showToast('Đã sao chép token', 'success');
  });
}

function resetQRForm() {
  document.getElementById('create-qr-form').classList.remove('hidden');
  document.getElementById('create-qr-form').reset();
  document.getElementById('qr-result').classList.add('hidden');
  setupResidentQRForm();
}

// ==================== RESIDENT QR LIST ====================
function renderResidentQRList() {
  checkExpiredQRs();
  const qrs = getData(KEYS.QR_CODES).filter(q => q.residentUsername === currentUser.username).reverse();
  const container = document.getElementById('resident-qr-list');

  if (qrs.length === 0) {
    container.innerHTML = emptyStateHtml('qr_code_2', 'Bạn chưa tạo mã QR nào');
    return;
  }

  container.innerHTML = qrs.map(q => `
    <div class="list-card">
      <div class="list-card-header">
        <div>
          <div class="list-card-title">${q.visitorName}</div>
          <div class="list-card-subtitle">${q.visitorType}</div>
        </div>
        <span class="status-badge ${getStatusClass(q.status)}">${getStatusText(q.status)}</span>
      </div>
      <div class="list-card-body">
        <div class="list-card-row"><span class="material-icons-round">phone</span>${q.visitorPhone || '—'}</div>
        <div class="list-card-row"><span class="material-icons-round">directions_car</span>${q.vehicleOrOrderCode || '—'}</div>
        <div class="list-card-row"><span class="material-icons-round">schedule</span>Tạo: ${formatDateShort(q.createdAt)}</div>
        <div class="list-card-row"><span class="material-icons-round">timer</span>Hết hạn: ${formatDateShort(q.expiresAt)}</div>
        ${q.note ? `<div class="list-card-row"><span class="material-icons-round">note</span>${q.note}</div>` : ''}
      </div>
      <div class="list-card-actions">
        <button class="btn btn-sm btn-outline" onclick="viewQRCode('${q.token}')"><span class="material-icons-round">qr_code</span>Xem QR</button>
        <button class="btn btn-sm btn-outline" onclick="copyTokenDirect('${q.token}')"><span class="material-icons-round">content_copy</span>Token</button>
        ${q.status === 'active' ? `<button class="btn btn-sm btn-danger" onclick="cancelQR('${q.token}')"><span class="material-icons-round">cancel</span>Hủy</button>` : ''}
      </div>
    </div>
  `).join('');
}

function viewQRCode(token) {
  const qrs = getData(KEYS.QR_CODES);
  const qr = qrs.find(q => q.token === token);
  if (!qr) return;

  openModal('Mã QR', `
    <div style="text-align:center;">
      <div id="modal-qr-display" style="display:inline-block; padding:16px; background:white; border-radius:12px; margin: 12px 0;"></div>
      <div style="margin-top:12px;">
        <div class="list-card-row" style="justify-content:center;"><strong>${qr.visitorName}</strong> - ${qr.visitorType}</div>
        <div class="list-card-row" style="justify-content:center; margin-top:4px;"><span class="status-badge ${getStatusClass(qr.status)}">${getStatusText(qr.status)}</span></div>
        <div style="margin-top:12px; font-size:0.75rem; color:var(--text-muted); word-break:break-all;">Token: ${qr.token}</div>
      </div>
    </div>
  `);

  setTimeout(() => {
    const display = document.getElementById('modal-qr-display');
    if (display) {
      new QRCode(display, {
        text: JSON.stringify(compactQrPayload(qr)),
        typeNumber: 10,
        width: 180,
        height: 180,
        colorDark: '#0f172a',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.L
      });
    }
  }, 100);
}

function copyTokenDirect(token) {
  navigator.clipboard.writeText(token).then(() => {
    showToast('Đã sao chép token', 'success');
  }).catch(() => {
    const textarea = document.createElement('textarea');
    textarea.value = token;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    showToast('Đã sao chép token', 'success');
  });
}

function cancelQR(token) {
  const qrs = getData(KEYS.QR_CODES);
  const qr = qrs.find(q => q.token === token);
  if (qr && qr.status === 'active') {
    qr.status = 'cancelled';
    setData(KEYS.QR_CODES, qrs);
    showToast('Đã hủy mã QR', 'success');
    renderResidentQRList();
  }
}

// ==================== RESIDENT CONFIRMATIONS ====================
function renderResidentConfirmations() {
  const confirms = getData(KEYS.CONFIRMATIONS)
    .filter(c => c.residentUsername === currentUser.username)
    .reverse();

  const container = document.getElementById('resident-confirm-list');
  const banner = document.getElementById('resident-notification-badge');
  const pendingCount = confirms.filter(c => c.status === 'pending').length;

  if (pendingCount > 0) {
    banner.classList.remove('hidden');
    banner.innerHTML = `<span class="material-icons-round">priority_high</span><span>Có ${pendingCount} yêu cầu mới cần xác nhận!</span>`;
  } else {
    banner.classList.add('hidden');
  }

  if (confirms.length === 0) {
    container.innerHTML = emptyStateHtml('fact_check', 'Chưa có yêu cầu xác nhận nào');
    return;
  }

  container.innerHTML = confirms.map(c => `
    <div class="confirm-request-card ${c.status === 'pending' ? 'pending' : ''}">
      <div class="confirm-request-header">
        <div>
          <div class="list-card-title">${c.visitorName}</div>
          <div class="list-card-subtitle">${c.visitorType}</div>
        </div>
        <span class="status-badge ${getStatusClass(c.status)}">${getStatusText(c.status)}</span>
      </div>
      <div class="confirm-request-body">
        <div class="list-card-body">
          <div class="list-card-row"><span class="material-icons-round">apartment</span>Căn hộ: <strong>${c.apartmentId}</strong></div>
          <div class="list-card-row"><span class="material-icons-round">phone</span>${c.visitorPhone || '—'}</div>
          <div class="list-card-row"><span class="material-icons-round">directions_car</span>${c.vehicleOrOrderCode || '—'}</div>
          ${c.note ? `<div class="list-card-row"><span class="material-icons-round">note</span>${c.note}</div>` : ''}
          <div class="list-card-row"><span class="material-icons-round">security</span>BV: ${c.guardName} | ${c.guardArea}</div>
          <div class="list-card-row"><span class="material-icons-round">schedule</span>Quét lúc: ${formatDateTime(c.scanTime)}</div>
        </div>
      </div>
      ${c.status === 'pending' ? `
        <div class="confirm-request-actions">
          <button class="btn btn-success" onclick="respondConfirmation('${c.id}', 'approved')">
            <span class="material-icons-round">check_circle</span> Đúng đối tượng
          </button>
          <button class="btn btn-danger" onclick="respondConfirmation('${c.id}', 'rejected')">
            <span class="material-icons-round">cancel</span> Từ chối
          </button>
        </div>
      ` : `
        <div style="padding: 10px 16px; font-size: 0.8rem; color: var(--text-muted);">
          Phản hồi lúc: ${formatDateTime(c.responseTime)}
        </div>
      `}
    </div>
  `).join('');
}

function respondConfirmation(confirmId, response) {
  const confirms = getData(KEYS.CONFIRMATIONS);
  const confirm = confirms.find(c => c.id === confirmId);
  if (!confirm || confirm.status !== 'pending') {
    showToast('Yêu cầu không còn hiệu lực', 'error');
    return;
  }

  confirm.status = response;
  confirm.responseTime = new Date().toISOString();
  setData(KEYS.CONFIRMATIONS, confirms);

  const qrs = getData(KEYS.QR_CODES);
  const qr = qrs.find(q => q.token === confirm.qrToken);
  if (qr && qr.status !== 'used') {
    qr.status = response === 'approved' ? 'ownerApproved' : 'rejected';
    setData(KEYS.QR_CODES, qrs);
  }

  if (response === 'approved') {
    showToast('Đã xác nhận cho vào', 'success');
  } else {
    showToast('Đã từ chối', 'warning');
  }

  renderResidentConfirmations();
}

function updateResidentBadges() {
  if (!currentUser || currentUser.role !== 'resident') return;
  const confirms = getData(KEYS.CONFIRMATIONS);
  const pendingCount = confirms.filter(c => c.residentUsername === currentUser.username && c.status === 'pending').length;

  const sidebarBadge = document.getElementById('sidebar-badge-resident-confirmations');
  const bottomBadge = document.getElementById('bottom-badge-resident-confirmations');

  if (sidebarBadge) {
    sidebarBadge.classList.toggle('hidden', pendingCount === 0);
    sidebarBadge.textContent = pendingCount;
  }
  if (bottomBadge) {
    bottomBadge.classList.toggle('hidden', pendingCount === 0);
    bottomBadge.textContent = pendingCount;
  }
}

// ==================== RESIDENT INCIDENTS ====================
function renderResidentIncidents() {
  const incidents = getData(KEYS.INCIDENTS)
    .filter(i => i.submittedByUsername === currentUser.username)
    .reverse();

  const container = document.getElementById('resident-incident-list');
  if (incidents.length === 0) {
    container.innerHTML = emptyStateHtml('report_problem', 'Bạn chưa gửi phản ánh nào');
    return;
  }

  container.innerHTML = incidents.map(i => `
    <div class="list-card">
      <div class="list-card-header">
        <div>
          <div class="list-card-title">${i.title}</div>
          <div class="list-card-subtitle">${getCategoryName(i.category)}</div>
        </div>
        <span class="status-badge ${getStatusClass(i.status)}">${getIncidentStatusName(i.status)}</span>
      </div>
      <div class="list-card-body">
        <div class="list-card-row"><span class="material-icons-round">priority_high</span>Mức độ: <span class="status-badge severity-${i.severity}" style="margin-left:4px;">${getSeverityName(i.severity)}</span></div>
        <div class="list-card-row"><span class="material-icons-round">schedule</span>${formatDateTime(i.submittedAt)}</div>
        <div class="list-card-row"><span class="material-icons-round">description</span>${i.content}</div>
      </div>
    </div>
  `).join('');
}

function showIncidentForm() {
  document.getElementById('incident-form-container').classList.remove('hidden');
}

function hideIncidentForm() {
  document.getElementById('incident-form-container').classList.add('hidden');
  document.getElementById('incident-form').reset();
}

function handleSubmitIncident(event) {
  event.preventDefault();
  const title = document.getElementById('inc-title').value.trim();
  const category = document.getElementById('inc-category').value;
  const content = document.getElementById('inc-content').value.trim();
  const severity = document.getElementById('inc-severity').value;

  if (!title || !category || !content) {
    showToast('Vui lòng điền đầy đủ thông tin', 'error');
    return;
  }

  const incident = {
    id: generateId(),
    title: title,
    category: category,
    content: content,
    severity: severity,
    submittedAt: new Date().toISOString(),
    submittedBy: currentUser.fullName,
    submittedByUsername: currentUser.username,
    apartmentId: currentUser.apartmentId,
    status: 'new'
  };

  const incidents = getData(KEYS.INCIDENTS);
  incidents.push(incident);
  setData(KEYS.INCIDENTS, incidents);

  hideIncidentForm();
  showToast('Đã gửi phản ánh thành công', 'success');
  renderResidentIncidents();
}

// ==================== RESIDENT HISTORY ====================
function renderResidentHistory() {
  const logs = getData(KEYS.ENTRY_LOGS)
    .filter(l => l.apartmentId === currentUser.apartmentId)
    .reverse();

  const container = document.getElementById('resident-history-list');
  if (logs.length === 0) {
    container.innerHTML = emptyStateHtml('history', 'Chưa có lịch sử ra/vào');
    return;
  }

  container.innerHTML = logs.map(l => `
    <div class="list-card">
      <div class="list-card-header">
        <div>
          <div class="list-card-title">${l.visitorName}</div>
          <div class="list-card-subtitle">${l.visitorType}</div>
        </div>
        <span class="status-badge status-entered">Đã cho vào</span>
      </div>
      <div class="list-card-body">
        <div class="list-card-row"><span class="material-icons-round">schedule</span>${formatDateTime(l.entryTime)}</div>
        <div class="list-card-row"><span class="material-icons-round">security</span>BV: ${l.guardName || '—'}</div>
        <div class="list-card-row"><span class="material-icons-round">location_on</span>${l.guardArea || '—'}</div>
      </div>
    </div>
  `).join('');
}

// ============================================================
//               GUARD VIEWS
// ============================================================

// ==================== GUARD SCANNER ====================
let currentScanToken = null;
let currentScanConfirmId = null;

function setupGuardScanner() {
  document.getElementById('scan-result').classList.add('hidden');
  document.getElementById('manual-token-input').value = '';
}

// ---- Camera QR Scanner ----
function startCamera() {
  const video = document.getElementById('camera-video');
  const canvas = document.getElementById('camera-canvas');
  const container = document.getElementById('camera-container');
  const btnStart = document.getElementById('btn-start-camera');
  const btnStop = document.getElementById('btn-stop-camera');

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showToast('Trình duyệt không hỗ trợ camera. Hãy dùng nhập token thủ công.', 'warning');
    return;
  }

  navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 640 } }
  }).then(stream => {
    videoStream = stream;
    video.srcObject = stream;
    video.play();
    container.classList.remove('hidden');
    btnStart.classList.add('hidden');
    btnStop.classList.remove('hidden');

    const ctx = canvas.getContext('2d');
    scanInterval = setInterval(() => {
      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height);
        if (code && code.data) {
          processQRData(code.data);
          stopCamera();
        }
      }
    }, 300);
  }).catch(err => {
    console.error('Camera error:', err);
    showToast('Không thể mở camera. Kiểm tra quyền truy cập hoặc dùng nhập token thủ công.', 'error');
  });
}

function stopCamera() {
  if (scanInterval) {
    clearInterval(scanInterval);
    scanInterval = null;
  }
  if (videoStream) {
    videoStream.getTracks().forEach(t => t.stop());
    videoStream = null;
  }

  const video = document.getElementById('camera-video');
  video.srcObject = null;
  document.getElementById('camera-container').classList.add('hidden');
  document.getElementById('btn-start-camera').classList.remove('hidden');
  document.getElementById('btn-stop-camera').classList.add('hidden');
}

// ---- Manual Token ----
function handleManualToken() {
  const input = document.getElementById('manual-token-input').value.trim();
  if (!input) {
    showToast('Vui lòng nhập token', 'warning');
    return;
  }

  // Try to find QR by token
  const qrs = getData(KEYS.QR_CODES);
  const qr = qrs.find(q => q.token === input);
  if (qr) {
    processQRData(JSON.stringify(qr));
  } else {
    // Try to parse as JSON
    try {
      const parsed = JSON.parse(input);
      if (parsed.token) {
        processQRData(input);
      } else {
        showScanError('QR không hợp lệ', 'Dữ liệu không đúng định dạng hệ thống SmartGate.');
      }
    } catch {
      showScanError('QR không hợp lệ', 'Token không tồn tại trong hệ thống.');
    }
  }
}

function isSmartGatePayload(data) {
  const normalized = normalizeQrPayload(data);
  return Boolean(
    normalized.token &&
    normalized.apartmentId &&
    normalized.residentUsername &&
    normalized.residentName &&
    normalized.visitorName &&
    normalized.visitorType &&
    normalized.expiresAt
  );
}

function compactQrPayload(data) {
  return {
    a: 'SG',
    y: 'entry',
    t: data.token,
    ap: data.apartmentId,
    an: data.apartmentName || data.apartmentId,
    rn: data.residentName,
    ru: data.residentUsername,
    vn: data.visitorName,
    vt: data.visitorType,
    ph: data.visitorPhone || '',
    vc: data.vehicleOrOrderCode || '',
    ex: data.expiresAt,
    n: data.note || '',
    ca: data.createdAt || new Date().toISOString()
  };
}

function normalizeQrPayload(data) {
  return {
    app: data.app || data.a || 'SmartGateQR',
    type: data.type || data.y || 'entry-pass',
    token: data.token || data.t,
    apartmentId: data.apartmentId || data.ap,
    apartmentName: data.apartmentName || data.an || data.apartmentId || data.ap,
    residentName: data.residentName || data.rn,
    residentUsername: data.residentUsername || data.ru,
    visitorName: data.visitorName || data.vn,
    visitorType: data.visitorType || data.vt,
    visitorPhone: data.visitorPhone || data.ph || '',
    vehicleOrOrderCode: data.vehicleOrOrderCode || data.vc || '',
    expiresAt: data.expiresAt || data.ex,
    note: data.note || data.n || '',
    createdAt: data.createdAt || data.ca || new Date().toISOString(),
    status: data.status || 'active'
  };
}

// ---- Process QR Data ----
function processQRData(rawData) {
  let qrData;
  try {
    qrData = JSON.parse(rawData);
  } catch {
    showScanError('QR không hợp lệ', 'Không thể đọc dữ liệu QR. Định dạng không đúng.');
    return;
  }

  if (!isSmartGatePayload(qrData)) {
    showScanError('QR không hợp lệ', 'Mã QR không thuộc hệ thống SmartGate.');
    return;
  }

  const incomingQr = normalizeQrPayload(qrData);
  // Check in database
  checkExpiredQRs();
  const qrs = getData(KEYS.QR_CODES);
  let qr = qrs.find(q => q.token === incomingQr.token);

  if (!qr) {
    qr = incomingQr;
    qrs.push(qr);
    setData(KEYS.QR_CODES, qrs);
  }

  // Check status
  if (qr.status === 'cancelled') {
    showScanError('QR đã bị chủ nhà hủy', 'Mã QR này đã bị hủy bởi chủ nhà.');
    return;
  }

  if (qr.status === 'used') {
    showScanError('QR đã được sử dụng', 'Mã QR này đã được sử dụng trước đó.');
    return;
  }

  if (qr.status === 'expired' || new Date(qr.expiresAt).getTime() < Date.now()) {
    if (qr.status !== 'expired') {
      qr.status = 'expired';
      setData(KEYS.QR_CODES, qrs);
    }
    showScanError('QR đã hết hạn', `Mã QR đã hết hạn lúc ${formatDateTime(qr.expiresAt)}.`);
    return;
  }

  // QR is valid - show info and send confirmation request
  showValidScan(qr);
}

function showScanError(title, message) {
  const container = document.getElementById('scan-result');
  container.classList.remove('hidden');
  container.innerHTML = `
    <div class="scan-result-status status-error">
      <span class="material-icons-round">error</span>
      <div>
        <div>${title}</div>
        <div style="font-weight:400; font-size:0.85rem; margin-top:4px;">${message}</div>
      </div>
    </div>
    <div style="padding: 16px; text-align:center;">
      <button class="btn btn-outline" onclick="resetScanner()"><span class="material-icons-round">refresh</span>Quét lại</button>
    </div>
  `;
}

function showValidScan(qr) {
  currentScanToken = qr.token;

  const confirms = getData(KEYS.CONFIRMATIONS);
  const existingConfirm = confirms
    .filter(c => c.qrToken === qr.token && ['pending', 'approved', 'rejected'].includes(c.status))
    .sort((a, b) => new Date(b.scanTime).getTime() - new Date(a.scanTime).getTime())[0];

  if (existingConfirm) {
    currentScanConfirmId = existingConfirm.id;
    renderScanResult(qr, existingConfirm);
    showToast('QR nay da co yeu cau xac nhan. Dang hien trang thai hien tai.', 'info');
    return;
  }

  // Create confirmation request
  const confirmId = generateId();
  currentScanConfirmId = confirmId;

  const confirmReq = {
    id: confirmId,
    qrToken: qr.token,
    apartmentId: qr.apartmentId,
    residentUsername: qr.residentUsername,
    residentName: qr.residentName,
    guardUsername: currentUser.username,
    guardName: currentUser.fullName,
    guardArea: currentUser.area || 'N/A',
    scanTime: new Date().toISOString(),
    visitorName: qr.visitorName,
    visitorType: qr.visitorType,
    visitorPhone: qr.visitorPhone,
    vehicleOrOrderCode: qr.vehicleOrOrderCode,
    note: qr.note,
    status: 'pending'
  };

  confirms.push(confirmReq);
  setData(KEYS.CONFIRMATIONS, confirms);

  const qrs = getData(KEYS.QR_CODES);
  const storedQr = qrs.find(item => item.token === qr.token);
  if (storedQr && storedQr.status === 'active') {
    storedQr.status = 'waitingOwner';
    setData(KEYS.QR_CODES, qrs);
  }

  renderScanResult(qr, confirmReq);
  showToast('Đã gửi yêu cầu xác nhận đến chủ nhà', 'info');
}

function renderScanResult(qr, confirmReq) {
  const container = document.getElementById('scan-result');
  container.classList.remove('hidden');

  let statusHtml = '';
  let actionsHtml = '';

  if (confirmReq.status === 'pending') {
    statusHtml = `
      <div class="scan-result-status status-waiting">
        <span class="material-icons-round">hourglass_top</span>
        <div>
          <div>Đã gửi yêu cầu xác nhận đến chủ nhà</div>
          <div style="font-weight:400; font-size:0.85rem; margin-top:4px;">Đang chờ ${qr.residentName} phản hồi...</div>
        </div>
      </div>
    `;
    actionsHtml = `
      <div class="scan-result-actions">
        <button class="btn btn-outline btn-block" onclick="resetScanner()"><span class="material-icons-round">refresh</span>Quét mã khác</button>
      </div>
    `;
  } else if (confirmReq.status === 'approved') {
    statusHtml = `
      <div class="scan-result-status status-approved-result">
        <span class="material-icons-round">check_circle</span>
        <div>
          <div>Chủ nhà đã đồng ý - được phép cho vào</div>
          <div style="font-weight:400; font-size:0.85rem; margin-top:4px;">Phản hồi lúc: ${formatDateTime(confirmReq.responseTime)}</div>
        </div>
      </div>
    `;
    actionsHtml = `
      <div class="scan-result-actions">
        <button class="btn btn-success btn-block" onclick="allowEntry('${qr.token}', '${confirmReq.id}')">
          <span class="material-icons-round">door_front</span> Cho vào
        </button>
      </div>
    `;
  } else if (confirmReq.status === 'rejected') {
    statusHtml = `
      <div class="scan-result-status status-rejected-result">
        <span class="material-icons-round">cancel</span>
        <div>
          <div>Chủ nhà đã từ chối - không cho vào</div>
          <div style="font-weight:400; font-size:0.85rem; margin-top:4px;">Phản hồi lúc: ${formatDateTime(confirmReq.responseTime)}</div>
        </div>
      </div>
    `;
    actionsHtml = `
      <div class="scan-result-actions">
        <button class="btn btn-outline btn-block" onclick="resetScanner()"><span class="material-icons-round">refresh</span>Quét mã khác</button>
      </div>
    `;
  }

  container.innerHTML = `
    ${statusHtml}
    <div class="scan-result-details">
      <div class="detail-row"><span class="detail-label">Người đến</span><span class="detail-value">${qr.visitorName}</span></div>
      <div class="detail-row"><span class="detail-label">Loại</span><span class="detail-value">${qr.visitorType}</span></div>
      <div class="detail-row"><span class="detail-label">Căn hộ</span><span class="detail-value">${qr.apartmentId}</span></div>
      <div class="detail-row"><span class="detail-label">Chủ nhà</span><span class="detail-value">${qr.residentName}</span></div>
      <div class="detail-row"><span class="detail-label">SĐT</span><span class="detail-value">${qr.visitorPhone || '—'}</span></div>
      <div class="detail-row"><span class="detail-label">Biển số/Mã đơn</span><span class="detail-value">${qr.vehicleOrOrderCode || '—'}</span></div>
      ${qr.note ? `<div class="detail-row"><span class="detail-label">Ghi chú</span><span class="detail-value">${qr.note}</span></div>` : ''}
      <div class="detail-row"><span class="detail-label">Thời hạn</span><span class="detail-value">${formatDateTime(qr.expiresAt)}</span></div>
    </div>
    ${actionsHtml}
  `;
}

function refreshGuardScanResult() {
  if (!currentScanConfirmId) return;
  const confirms = getData(KEYS.CONFIRMATIONS);
  const confirmReq = confirms.find(c => c.id === currentScanConfirmId);
  if (!confirmReq) return;

  const qrs = getData(KEYS.QR_CODES);
  const qr = qrs.find(q => q.token === confirmReq.qrToken);
  if (!qr) return;

  // Only refresh if status changed from pending
  if (confirmReq.status !== 'pending') {
    renderScanResult(qr, confirmReq);
    if (confirmReq.status === 'approved') {
      showToast('🎉 Chủ nhà đã đồng ý cho vào!', 'success');
    } else if (confirmReq.status === 'rejected') {
      showToast('⛔ Chủ nhà đã từ chối!', 'warning');
    }
  }
}

function allowEntry(token, confirmId) {
  // Update QR status to used
  const qrs = getData(KEYS.QR_CODES);
  const qr = qrs.find(q => q.token === token);
  if (qr) {
    qr.status = 'used';
    setData(KEYS.QR_CODES, qrs);
  }

  // Update confirmation status
  const confirms = getData(KEYS.CONFIRMATIONS);
  const confirm = confirms.find(c => c.id === confirmId);
  if (confirm) {
    confirm.status = 'entered';
    setData(KEYS.CONFIRMATIONS, confirms);
  }

  // Create entry log
  const log = {
    id: generateId(),
    entryTime: new Date().toISOString(),
    visitorName: qr ? qr.visitorName : 'N/A',
    visitorType: qr ? qr.visitorType : 'N/A',
    visitorPhone: qr ? qr.visitorPhone : '',
    apartmentId: qr ? qr.apartmentId : 'N/A',
    residentName: qr ? qr.residentName : 'N/A',
    guardName: currentUser.fullName,
    guardUsername: currentUser.username,
    guardArea: currentUser.area || 'N/A',
    status: 'entered',
    qrToken: token
  };

  const logs = getData(KEYS.ENTRY_LOGS);
  logs.push(log);
  setData(KEYS.ENTRY_LOGS, logs);

  currentScanToken = null;
  currentScanConfirmId = null;

  // Show success
  const container = document.getElementById('scan-result');
  container.innerHTML = `
    <div class="scan-result-status status-success">
      <span class="material-icons-round">check_circle</span>
      <div>
        <div>Đã cho vào thành công!</div>
        <div style="font-weight:400; font-size:0.85rem; margin-top:4px;">${qr ? qr.visitorName : ''} - ${qr ? qr.visitorType : ''} → ${qr ? qr.apartmentId : ''}</div>
      </div>
    </div>
    <div style="padding: 16px; text-align:center;">
      <button class="btn btn-primary btn-block" onclick="resetScanner()"><span class="material-icons-round">qr_code_scanner</span>Quét mã tiếp theo</button>
    </div>
  `;

  showToast('Đã ghi nhật ký ra/vào thành công', 'success');
}

function resetScanner() {
  currentScanToken = null;
  currentScanConfirmId = null;
  document.getElementById('scan-result').classList.add('hidden');
  document.getElementById('manual-token-input').value = '';
}

// ==================== GUARD LOGS ====================
function renderGuardLogs() {
  const logs = getData(KEYS.ENTRY_LOGS)
    .filter(l => l.guardUsername === currentUser.username)
    .reverse();

  const container = document.getElementById('guard-log-list');
  if (logs.length === 0) {
    container.innerHTML = emptyStateHtml('history', 'Chưa có nhật ký quét nào trong ca trực');
    return;
  }

  container.innerHTML = logs.map(l => `
    <div class="list-card">
      <div class="list-card-header">
        <div>
          <div class="list-card-title">${l.visitorName}</div>
          <div class="list-card-subtitle">${l.visitorType} → ${l.apartmentId || '—'}</div>
        </div>
        <span class="status-badge status-entered">Đã cho vào</span>
      </div>
      <div class="list-card-body">
        <div class="list-card-row"><span class="material-icons-round">schedule</span>${formatDateTime(l.entryTime)}</div>
        <div class="list-card-row"><span class="material-icons-round">person</span>Chủ nhà: ${l.residentName || '—'}</div>
        <div class="list-card-row"><span class="material-icons-round">location_on</span>${l.guardArea || '—'}</div>
      </div>
    </div>
  `).join('');
}
