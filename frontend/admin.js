let currentAdminUser = null;
let currentAdminTab = 'dashboard';

// --- Authentication & Initialization ---
window.addEventListener('DOMContentLoaded', () => {
  const token = localStorage.getItem('auth_token');
  const userStr = localStorage.getItem('auth_user');

  if (!token || !userStr) {
    window.location.href = '/login';
    return;
  }

  try {
    currentAdminUser = JSON.parse(userStr);
    if (currentAdminUser.role !== 'ADMIN') {
      alert('Bạn không có quyền truy cập trang quản trị! Vui lòng đăng nhập tài khoản Quản trị viên (Admin).');
      window.location.href = '/login';
      return;
    }

    document.getElementById('adminFullName').textContent = currentAdminUser.full_name || 'Admin';
    document.getElementById('adminUsername').textContent = currentAdminUser.username || 'admin';

    // Load initial dashboard data
    loadDashboardStats();

  } catch (err) {
    window.location.href = '/login';
  }
});

function getAuthHeader() {
  const token = localStorage.getItem('auth_token');
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  };
}

function logoutAdmin() {
  localStorage.removeItem('auth_token');
  localStorage.removeItem('auth_user');
  window.location.href = '/login';
}

// --- Tab Switching ---
function switchAdminTab(tabName) {
  currentAdminTab = tabName;

  document.querySelectorAll('.admin-tab-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  document.querySelectorAll('.admin-tab-pane').forEach(pane => {
    pane.classList.remove('active');
  });

  const activePane = document.getElementById(`tab-${tabName}`);
  if (activePane) activePane.classList.add('active');

  // Activate button
  event.target.classList.add('active');

  if (tabName === 'dashboard') loadDashboardStats();
  else if (tabName === 'revenue') loadRevenueReport();
  else if (tabName === 'history') loadHistoryData();
  else if (tabName === 'security') loadSecurityLogs();
  else if (tabName === 'staff') loadStaffList();
}

// --- TAB 1: DASHBOARD ---
async function loadDashboardStats() {
  const recentTbody = document.getElementById('recentTableBody');
  recentTbody.innerHTML = '<tr><td colspan="9" style="text-align:center; padding:16px;">Đang tải dữ liệu...</td></tr>';

  try {
    const res = await fetch('/api/admin/dashboard', { headers: getAuthHeader() });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) logoutAdmin();
      return;
    }
    const data = await res.json();
    const stats = data.stats || {};

    // Render KPI Cards
    document.getElementById('kpiRevenue').textContent = `${(stats.revenue_today || 0).toLocaleString('vi-VN')} VNĐ`;
    document.getElementById('kpiOccupancy').textContent = `${stats.occupied_slots || 0} / ${stats.total_slots || 32} Ô`;
    document.getElementById('kpiAvailable').textContent = `Còn trống: ${stats.available_slots || 32} vị trí đỗ`;
    document.getElementById('kpiTraffic').textContent = `${stats.in_today || 0} vào / ${stats.out_today || 0} ra`;
    document.getElementById('kpiOverrides').textContent = `${stats.overrides_today || 0} Lượt`;

    // Render Recent Sessions
    const recent = data.recent_sessions || [];
    if (recent.length === 0) {
      recentTbody.innerHTML = '<tr><td colspan="9" style="text-align:center; padding:16px;">Chưa có lượt gửi xe nào được ghi nhận.</td></tr>';
      return;
    }

    recentTbody.innerHTML = recent.map(item => `
      <tr>
        <td><strong>#${item.id}</strong></td>
        <td><span style="background:#eff6ff; color:#1d4ed8; padding:3px 8px; border-radius:4px; font-weight:700;">${item.slot_number || 'N/A'}</span></td>
        <td style="font-weight:800; color:#b91c1c;">${item.plate_number}</td>
        <td>${new Date(item.entry_time).toLocaleString('vi-VN')}</td>
        <td>${item.exit_time ? new Date(item.exit_time).toLocaleString('vi-VN') : '<span style="color:#64748b;">Đang đỗ</span>'}</td>
        <td>${item.staff_in_name || '<span style="color:#94a3b8;">Hệ thống</span>'}</td>
        <td>${item.staff_out_name || (item.status === 'OUT' ? '<span style="color:#94a3b8;">Hệ thống</span>' : '-')}</td>
        <td><strong>${item.fee ? item.fee.toLocaleString('vi-VN') + ' đ' : '0 đ'}</strong></td>
        <td>
          <span class="${item.status === 'IN' ? 'badge-status-in' : 'badge-status-out'}">
            ${item.status === 'IN' ? 'ĐANG TRONG BÃI' : 'ĐÃ RA'}
          </span>
          ${item.is_overridden ? '<span class="badge-override" title="Đã duyệt bỏ qua cảnh báo mặt">OVERRIDE</span>' : ''}
        </td>
      </tr>
    `).join('');

  } catch (err) {
    recentTbody.innerHTML = '<tr><td colspan="9" style="text-align:center; color:red; padding:16px;">Lỗi kết nối tới máy chủ!</td></tr>';
  }
}

// --- TAB REVENUE: BÁO CÁO DOANH THU CHUYÊN SÂU ---
function toggleRevenueFilters() {
  const period = document.getElementById('revPeriodSelect').value;
  const yearGroup = document.getElementById('revYearFilterGroup');
  const monthGroup = document.getElementById('revMonthFilterGroup');

  if (period === 'day') {
    yearGroup.style.display = 'flex';
    monthGroup.style.display = 'flex';
  } else if (period === 'month') {
    yearGroup.style.display = 'flex';
    monthGroup.style.display = 'none';
  } else { // 'year'
    yearGroup.style.display = 'none';
    monthGroup.style.display = 'none';
  }

  loadRevenueReport();
}

async function loadRevenueReport() {
  const tbody = document.getElementById('revenueTableBody');
  tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:16px;">Đang tải dữ liệu báo cáo...</td></tr>';

  const period = document.getElementById('revPeriodSelect').value;
  const year = document.getElementById('revYearSelect').value;
  const month = document.getElementById('revMonthSelect').value;

  const colHeader = document.getElementById('revTableColHeader');
  if (period === 'day') colHeader.textContent = 'MỐC NGÀY';
  else if (period === 'month') colHeader.textContent = 'MỐC THÁNG';
  else colHeader.textContent = 'MỐC NĂM';

  try {
    const res = await fetch(`/api/admin/revenue-report?period=${period}&year=${year}&month=${month}`, {
      headers: getAuthHeader()
    });

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) logoutAdmin();
      return;
    }

    const report = await res.json();
    const summary = report.summary || {};
    const dataList = report.data || [];

    document.getElementById('revTotalRevenue').textContent = `${(summary.total_revenue || 0).toLocaleString('vi-VN')} VNĐ`;
    document.getElementById('revTotalVehicles').textContent = `${(summary.total_vehicles || 0).toLocaleString('vi-VN')} Lượt`;
    document.getElementById('revAvgPerVehicle').textContent = `${(summary.avg_per_vehicle || 0).toLocaleString('vi-VN')} đ / xe`;

    if (period === 'day') {
      document.getElementById('revSubPeriodLabel').textContent = `Tháng ${month}/${year}`;
    } else if (period === 'month') {
      document.getElementById('revSubPeriodLabel').textContent = `Cả năm ${year}`;
    } else {
      document.getElementById('revSubPeriodLabel').textContent = `Toàn bộ các năm`;
    }

    if (dataList.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:16px;">Không có dữ liệu lượt xe hoàn thành trong kỳ này.</td></tr>';
      return;
    }

    const maxRev = Math.max(...dataList.map(d => parseInt(d.total_revenue) || 0), 1);

    tbody.innerHTML = dataList.map(item => {
      const rev = parseInt(item.total_revenue) || 0;
      const count = parseInt(item.total_vehicles) || 0;
      const pct = summary.total_revenue > 0 ? Math.round((rev / summary.total_revenue) * 100) : 0;
      const barPct = Math.round((rev / maxRev) * 100);

      let labelDisplay = item.time_label;
      if (period === 'day') {
        const parts = item.time_label.split('-');
        if (parts.length === 3) labelDisplay = `Ngày ${parts[2]}/${parts[1]}/${parts[0]}`;
      } else if (period === 'month') {
        const parts = item.time_label.split('-');
        if (parts.length === 2) labelDisplay = `Tháng ${parts[1]}/${parts[0]}`;
      } else {
        labelDisplay = `Năm ${item.time_label}`;
      }

      return `
        <tr>
          <td><strong style="color:#1e3a8a;">${labelDisplay}</strong></td>
          <td><strong>${count}</strong> lượt xe</td>
          <td style="min-width: 140px;">
            <div style="display:flex; justify-content:space-between; font-size:0.78rem; font-weight:700;">
              <span>${pct}%</span>
            </div>
            <div style="background-color:#e2e8f0; border-radius:4px; height:8px; width:100%; overflow:hidden; margin-top:3px;">
              <div style="background-color:#16a34a; height:100%; width:${barPct}%; border-radius:4px;"></div>
            </div>
          </td>
          <td><strong style="color:#15803d; font-size:1.05rem;">${rev.toLocaleString('vi-VN')} VNĐ</strong></td>
        </tr>
      `;
    }).join('');

  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:red; padding:16px;">Lỗi tải báo cáo doanh thu!</td></tr>';
  }
}

// --- TAB 2: LỊCH SỬ GỬI XE & BÁO CÁO ---
async function loadHistoryData() {
  const tbody = document.getElementById('historyTableBody');
  tbody.innerHTML = '<tr><td colspan="10" style="text-align:center; padding:16px;">Đang tải danh sách...</td></tr>';

  const date = document.getElementById('historyDateFilter').value;
  const plate = document.getElementById('historyPlateFilter').value.trim();
  const status = document.getElementById('historyStatusFilter').value;

  let queryParams = new URLSearchParams();
  if (date) queryParams.append('date', date);
  if (plate) queryParams.append('plate', plate);
  if (status) queryParams.append('status', status);

  try {
    const res = await fetch(`/api/admin/history?${queryParams.toString()}`, { headers: getAuthHeader() });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) logoutAdmin();
      return;
    }

    const list = await res.json();
    if (!Array.isArray(list) || list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="10" style="text-align:center; padding:16px;">Không tìm thấy lượt gửi xe nào khớp với bộ lọc.</td></tr>';
      return;
    }

    tbody.innerHTML = list.map(item => `
      <tr>
        <td><strong>#${item.id}</strong></td>
        <td><span style="background:#eff6ff; color:#1d4ed8; padding:3px 8px; border-radius:4px; font-weight:700;">${item.slot_number || 'N/A'}</span></td>
        <td style="font-weight:800; color:#b91c1c;">${item.plate_number}</td>
        <td>
          ${item.image_in ? `<img src="/${item.image_in}" class="thumb-img" alt="Ảnh vào" onclick="window.open('/${item.image_in}', '_blank')">` : '-'}
        </td>
        <td>${new Date(item.entry_time).toLocaleString('vi-VN')}</td>
        <td>${item.staff_in_name || '<span style="color:#94a3b8;">Hệ thống</span>'}</td>
        <td>${item.exit_time ? new Date(item.exit_time).toLocaleString('vi-VN') : '<span style="color:#64748b;">Đang đỗ</span>'}</td>
        <td>${item.staff_out_name || (item.status === 'OUT' ? '<span style="color:#94a3b8;">Hệ thống</span>' : '-')}</td>
        <td><strong>${item.fee ? item.fee.toLocaleString('vi-VN') + ' đ' : '0 đ'}</strong></td>
        <td>
          <span class="${item.status === 'IN' ? 'badge-status-in' : 'badge-status-out'}">
            ${item.status === 'IN' ? 'ĐANG TRONG BÃI' : 'ĐÃ RA'}
          </span>
          ${item.is_overridden ? '<span class="badge-override">OVERRIDE</span>' : ''}
        </td>
      </tr>
    `).join('');

  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="10" style="text-align:center; color:red; padding:16px;">Lỗi tải dữ liệu lịch sử!</td></tr>';
  }
}

function resetHistoryFilters() {
  document.getElementById('historyDateFilter').value = '';
  document.getElementById('historyPlateFilter').value = '';
  document.getElementById('historyStatusFilter').value = 'ALL';
  loadHistoryData();
}

// --- TAB 3: NHẬT KÝ CAN THIỆP AN NINH (OVERRIDE LOGS) ---
async function loadSecurityLogs() {
  const tbody = document.getElementById('securityTableBody');
  tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:16px;">Đang tải dữ liệu can thiệp...</td></tr>';

  try {
    const res = await fetch('/api/admin/security-logs', { headers: getAuthHeader() });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) logoutAdmin();
      return;
    }

    const list = await res.json();
    if (!Array.isArray(list) || list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:16px;">Chưa có lượt can thiệp Override nào được ghi nhận. Hệ thống an toàn!</td></tr>';
      return;
    }

    tbody.innerHTML = list.map(item => `
      <tr>
        <td><strong>#${item.id}</strong></td>
        <td style="font-weight:800; color:#b91c1c;">${item.plate_number}</td>
        <td>
          ${item.face_image_in ? `<img src="/${item.face_image_in}" class="thumb-img" alt="Mặt vào" onclick="window.open('/${item.face_image_in}', '_blank')">` : '<span style="color:#94a3b8;">Không có</span>'}
        </td>
        <td>
          ${item.face_image_out ? `<img src="/${item.face_image_out}" class="thumb-img" alt="Mặt ra" onclick="window.open('/${item.face_image_out}', '_blank')">` : '<span style="color:#94a3b8;">Không có</span>'}
        </td>
        <td>${item.exit_time ? new Date(item.exit_time).toLocaleString('vi-VN') : '-'}</td>
        <td><strong style="color:#1d4ed8;">${item.staff_out_name || 'Bảo vệ ca trực'}</strong></td>
        <td><span class="badge-override" style="font-size:0.8rem;">${item.override_reason || 'Bảo vệ xác nhận bỏ qua'}</span></td>
        <td><strong>${item.fee ? item.fee.toLocaleString('vi-VN') + ' đ' : '0 đ'}</strong></td>
      </tr>
    `).join('');

  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; color:red; padding:16px;">Lỗi tải nhật ký can thiệp!</td></tr>';
  }
}

// --- TAB 4: QUẢN LÝ NHÂN VIÊN (STAFF MANAGEMENT) ---
async function loadStaffList() {
  const tbody = document.getElementById('usersTableBody');
  tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:16px;">Đang tải danh sách nhân viên...</td></tr>';

  try {
    const res = await fetch('/api/admin/users', { headers: getAuthHeader() });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) logoutAdmin();
      return;
    }

    const users = await res.json();
    if (!Array.isArray(users) || users.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:16px;">Chưa có tài khoản nào.</td></tr>';
      return;
    }

    tbody.innerHTML = users.map(u => `
      <tr>
        <td>#${u.id}</td>
        <td><strong>${u.username}</strong></td>
        <td>${u.full_name}</td>
        <td>
          <span style="padding:3px 8px; border-radius:4px; font-weight:700; font-size:0.75rem; background:${u.role === 'ADMIN' ? '#dbeafe; color:#1e40af;' : '#f1f5f9; color:#475569;'}">
            ${u.role === 'ADMIN' ? 'QUẢN TRỊ VIÊN' : 'BẢO VỆ (STAFF)'}
          </span>
        </td>
        <td>${u.phone || '-'}</td>
        <td>
          <span style="padding:3px 8px; border-radius:4px; font-weight:700; font-size:0.75rem; background:${u.status === 'ACTIVE' ? '#dcfce7; color:#15803d;' : '#fee2e2; color:#b91c1c;'}">
            ${u.status === 'ACTIVE' ? 'HOẠT ĐỘNG' : 'ĐÃ KHÓA'}
          </span>
        </td>
        <td>${new Date(u.created_at).toLocaleDateString('vi-VN')}</td>
        <td>
          <button class="btn-action" style="padding:4px 8px; font-size:0.78rem;" onclick='openEditUserModal(${JSON.stringify(u)})'>Sửa</button>
          ${u.id !== currentAdminUser.id ? `
            <button class="btn-action btn-secondary" style="padding:4px 8px; font-size:0.78rem; background:#dc2626;" onclick="deleteUser(${u.id}, '${u.username}')">Xóa</button>
          ` : ''}
        </td>
      </tr>
    `).join('');

  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; color:red; padding:16px;">Lỗi tải danh sách nhân sự!</td></tr>';
  }
}

// User Modal Functions
function openCreateUserModal() {
  document.getElementById('modalTitle').textContent = 'Thêm Tài Khoản Mới';
  document.getElementById('editUserId').value = '';
  document.getElementById('modalUsername').value = '';
  document.getElementById('modalUsername').disabled = false;
  document.getElementById('modalFullName').value = '';
  document.getElementById('modalPassword').value = '';
  document.getElementById('modalPassword').required = true;
  document.getElementById('modalPassword').placeholder = 'Nhập mật khẩu...';
  document.getElementById('modalRole').value = 'STAFF';
  document.getElementById('modalPhone').value = '';
  document.getElementById('modalStatusGroup').style.display = 'none';

  document.getElementById('userModal').style.display = 'flex';
}

function openEditUserModal(user) {
  document.getElementById('modalTitle').textContent = `Chỉnh Sửa Tài Khoản #${user.id} (${user.username})`;
  document.getElementById('editUserId').value = user.id;
  document.getElementById('modalUsername').value = user.username;
  document.getElementById('modalUsername').disabled = true;
  document.getElementById('modalFullName').value = user.full_name;
  document.getElementById('modalPassword').value = '';
  document.getElementById('modalPassword').required = false;
  document.getElementById('modalPassword').placeholder = 'Để trống nếu giữ nguyên mật khẩu cũ';
  document.getElementById('modalRole').value = user.role;
  document.getElementById('modalPhone').value = user.phone || '';
  document.getElementById('modalStatusGroup').style.display = 'block';
  document.getElementById('modalStatus').value = user.status;

  document.getElementById('userModal').style.display = 'flex';
}

function closeUserModal() {
  document.getElementById('userModal').style.display = 'none';
}

async function handleSaveUser(e) {
  e.preventDefault();
  const id = document.getElementById('editUserId').value;
  const username = document.getElementById('modalUsername').value.trim();
  const full_name = document.getElementById('modalFullName').value.trim();
  const password = document.getElementById('modalPassword').value.trim();
  const role = document.getElementById('modalRole').value;
  const phone = document.getElementById('modalPhone').value.trim();
  const status = document.getElementById('modalStatus').value;

  const submitBtn = document.getElementById('modalSubmitBtn');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Đang lưu...';

  try {
    let url = '/api/admin/users';
    let method = 'POST';
    let body = { username, full_name, password, role, phone };

    if (id) {
      url = `/api/admin/users/${id}`;
      method = 'PUT';
      body = { full_name, role, phone, status };
      if (password) body.password = password;
    }

    const res = await fetch(url, {
      method: method,
      headers: getAuthHeader(),
      body: JSON.stringify(body)
    });

    const data = await res.json();

    if (!res.ok) {
      alert(data.error || 'Có lỗi xảy ra!');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Lưu Tài Khoản';
      return;
    }

    alert(data.message || 'Thành công!');
    closeUserModal();
    loadStaffList();

  } catch (err) {
    alert('Lỗi kết nối tới máy chủ!');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Lưu Tài Khoản';
  }
}

async function deleteUser(id, username) {
  if (!confirm(`Bạn có chắc chắn muốn xóa tài khoản nhân viên "${username}" (#${id})?`)) return;

  try {
    const res = await fetch(`/api/admin/users/${id}`, {
      method: 'DELETE',
      headers: getAuthHeader()
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Không thể xóa tài khoản!');
      return;
    }

    alert(data.message || 'Đã xóa tài khoản thành công!');
    loadStaffList();
  } catch (err) {
    alert('Lỗi kết nối tới máy chủ!');
  }
}
