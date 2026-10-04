let currentMode = 'entry'; // 'entry', 'exit', 'map', 'list'
let selectedFile = null;
let selectedFaceFile = null;
let allSlotsData = [];

function switchMode(mode) {
  currentMode = mode;
  selectedFile = null;
  selectedFaceFile = null;

  document.getElementById('modeEntryBtn').classList.toggle('active', mode === 'entry');
  document.getElementById('modeExitBtn').classList.toggle('active', mode === 'exit');
  document.getElementById('modeMapBtn').classList.toggle('active', mode === 'map');
  document.getElementById('modeListBtn').classList.toggle('active', mode === 'list');

  const mainWS = document.getElementById('mainWorkspace');
  const mapWS = document.getElementById('mapWorkspace');
  const listWS = document.getElementById('listWorkspace');

  if (mode === 'map') {
    mainWS.style.display = 'none';
    mapWS.style.display = 'block';
    listWS.style.display = 'none';
    fetchParkingSlots();
    return;
  }

  if (mode === 'list') {
    mainWS.style.display = 'none';
    mapWS.style.display = 'none';
    listWS.style.display = 'block';
    fetchVehiclesList();
    return;
  }

  mainWS.style.display = 'flex';
  mapWS.style.display = 'none';
  listWS.style.display = 'none';

  const actionBtn = document.getElementById('actionBtn');
  if (mode === 'entry') {
    actionBtn.innerHTML = 'NHẬN DẠNG<br>BIỂN SỐ (VÀO)';
  } else {
    actionBtn.innerHTML = 'XÁC NHẬN<br>XE RA (TÍNH TIỀN)';
  }
  actionBtn.disabled = true;

  resetUI();
}

async function fetchParkingSlots() {
  const container = document.getElementById('slotsGridContainer');
  container.innerHTML = '<div style="text-align:center; width:100%; padding:20px;">Đang tải sơ đồ bãi xe...</div>';

  try {
    const response = await fetch('/api/slots');
    const data = await response.json();
    allSlotsData = data;

    if (!response.ok || !Array.isArray(data)) {
      container.innerHTML = '<div style="text-align:center; width:100%; color:red;">Không thể tải sơ đồ bãi xe!</div>';
      return;
    }

    renderSlotsGrid(data);
  } catch (error) {
    container.innerHTML = '<div style="text-align:center; width:100%; color:red;">Lỗi kết nối tới Server!</div>';
  }
}

function renderSlotsGrid(slots) {
  const container = document.getElementById('slotsGridContainer');
  const searchQuery = (document.getElementById('mapSearchInput').value || '').trim().toLowerCase();

  let autoSelectSlot = null;

  container.innerHTML = slots.map(slot => {
    const isOccupied = slot.is_occupied;
    const session = slot.session || {};
    const plate = session.plate_number || 'TRỐNG';

    let isHighlighted = false;
    if (searchQuery && isOccupied && plate.toLowerCase().includes(searchQuery)) {
      isHighlighted = true;
      if (!autoSelectSlot) autoSelectSlot = slot;
    }

    let boxClass = 'compact-slot-box';
    if (isHighlighted) {
      boxClass += ' slot-box-search';
    } else if (isOccupied) {
      boxClass += ' slot-box-occupied';
    } else {
      boxClass += ' slot-box-free';
    }

    const slotJson = JSON.stringify(slot).replace(/'/g, "&apos;");

    return `
      <div class="${boxClass}" onclick='showSlotDetail(${slotJson})' title="Ô ${slot.slot_number}: ${isOccupied ? plate : 'Trống'}">
        ${slot.slot_number}
      </div>
    `;
  }).join('');

  if (autoSelectSlot) {
    showSlotDetail(autoSelectSlot);
  }
}

function showSlotDetail(slot) {
  const infoBar = document.getElementById('infoBarText');

  if (!slot.is_occupied) {
    infoBar.innerHTML = `<span style="color:#15803d; font-weight:700;">Trạng thái: Ô TRỐNG (${slot.slot_number}) - Sẵn sàng nhận xe vào bãi</span>`;
  } else {
    const session = slot.session || {};
    infoBar.innerHTML = `
      <span style="color:#b91c1c; font-weight:800;">Trạng thái: ĐÃ CÓ XE ĐỖ (${slot.slot_number})</span> | 
      Biển số: <strong style="color:#dc2626; font-size:1.1rem; margin-right:8px;">${session.plate_number || 'N/A'}</strong> | 
      Mã vé: <strong>#${session.id || 'N/A'}</strong> | 
      Giờ vào: <strong>${new Date(session.entry_time).toLocaleTimeString('vi-VN')}</strong>
    `;
  }
}

function highlightSlotBySearch() {
  renderSlotsGrid(allSlotsData);
}

async function fetchVehiclesList() {
  const tbody = document.getElementById('vehicleTableBody');
  tbody.innerHTML = '<tr><td colspan="8" style="text-align:center">Đang tải danh sách xe...</td></tr>';

  try {
    const response = await fetch('/api/vehicles');
    const data = await response.json();

    if (!response.ok || !Array.isArray(data)) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; color:red">Không thể tải danh sách xe!</td></tr>';
      return;
    }

    if (data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center">Hiện tại không có xe nào đang ở trong bãi.</td></tr>';
      return;
    }

    tbody.innerHTML = data.map(item => `
      <tr>
        <td>#${item.id}</td>
        <td><span class="slot-badge-table">${item.slot_number || 'A-01'}</span></td>
        <td style="color:#ff0000; font-size:1.2rem; font-weight:800">${item.plate_number}</td>
        <td><img src="/${item.image_in}" class="table-img" alt="Ảnh xe vào" onerror="this.onerror=null; this.src='/uploads/1789326409713.jpg';"></td>
        <td>${item.face_image_in ? `<img src="/${item.face_image_in}" class="table-img face-table-img" alt="Ảnh mặt vào">` : '<span style="color:#9ca3af; font-size:0.85rem">Không có</span>'}</td>
        <td>${new Date(item.entry_time).toLocaleString('vi-VN')}</td>
        <td><span class="badge-in">${item.status}</span></td>
        <td>
          <button class="delete-btn" onclick="deleteVehicle(${item.id})">XÓA</button>
        </td>
      </tr>
    `).join('');

  } catch (error) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; color:red">Lỗi kết nối tới Server!</td></tr>';
  }
}

async function deleteVehicle(id) {
  if (!confirm(`Bạn có chắc chắn muốn xóa lượt gửi xe #${id} khỏi bãi?`)) return;

  try {
    const response = await fetch(`/api/vehicles/${id}`, { method: 'DELETE' });
    const data = await response.json();
    if (response.ok) {
      fetchVehiclesList();
    } else {
      alert(data.error || 'Không thể xóa lượt gửi xe!');
    }
  } catch (error) {
    alert('Lỗi kết nối tới Server!');
  }
}

function resetUI() {
  document.getElementById('cameraImg').style.display = 'none';
  document.getElementById('uploadPrompt').style.display = 'block';

  document.getElementById('faceCameraImg').style.display = 'none';
  document.getElementById('faceUploadPrompt').style.display = 'block';

  document.getElementById('detectedImg').style.display = 'none';
  document.getElementById('detectPrompt').style.display = 'block';

  document.getElementById('croppedPlateImg').style.display = 'none';
  document.getElementById('cropPrompt').style.display = 'block';

  document.getElementById('plateResultText').textContent = 'CHƯA CÓ KẾT QUẢ';
  document.getElementById('extraInfo').textContent = '';
  document.getElementById('fileInput').value = '';
  document.getElementById('faceFileInput').value = '';
  selectedFaceFile = null;
}

function handleFileSelect(file) {
  if (!file) return;

  selectedFile = file;
  document.getElementById('actionBtn').disabled = false;

  const reader = new FileReader();
  reader.onload = function(e) {
    const cameraImg = document.getElementById('cameraImg');
    const uploadPrompt = document.getElementById('uploadPrompt');

    cameraImg.src = e.target.result;
    cameraImg.style.display = 'block';
    uploadPrompt.style.display = 'none';

    document.getElementById('detectedImg').style.display = 'none';
    document.getElementById('detectPrompt').style.display = 'block';

    document.getElementById('croppedPlateImg').style.display = 'none';
    document.getElementById('cropPrompt').style.display = 'block';
  };
  reader.readAsDataURL(file);
}

function handleFaceFileSelect(file) {
  if (!file) return;

  selectedFaceFile = file;

  const reader = new FileReader();
  reader.onload = function(e) {
    const faceCameraImg = document.getElementById('faceCameraImg');
    const faceUploadPrompt = document.getElementById('faceUploadPrompt');

    faceCameraImg.src = e.target.result;
    faceCameraImg.style.display = 'block';
    faceUploadPrompt.style.display = 'none';
  };
  reader.readAsDataURL(file);
}

async function processAction(isOverride = false) {
  if (!selectedFile) return;

  const actionBtn = document.getElementById('actionBtn');
  actionBtn.disabled = true;
  actionBtn.innerHTML = 'ĐANG XỬ LÝ...';

  const formData = new FormData();
  formData.append('image', selectedFile);
  if (selectedFaceFile) {
    formData.append('face_image', selectedFaceFile);
  }
  if (isOverride) {
    formData.append('override', 'true');
  }

  const endpoint = currentMode === 'entry' ? '/api/entry' : '/api/exit';

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      body: formData
    });

    const data = await response.json();

    if (!response.ok) {
      if (data.requires_override) {
        document.getElementById('plateResultText').textContent = 'CẢNH BÁO KHUÔN MẶT';
        document.getElementById('extraInfo').textContent = `${data.error} (Khớp: ${data.similarity || 0}%)`;
        
        const confirmOverride = confirm(
          `⚠️ CẢNH BÁO XÁC THỰC KHUÔN MẶT! ⚠️\n\n` +
          `${data.error}\n` +
          `Độ tương đồng: ${data.similarity || 0}%\n\n` +
          `Bạn có muốn BẢO VỆ XÁC NHẬN CHO XE RA (Bỏ qua cảnh báo) không?`
        );
        
        if (confirmOverride) {
          processAction(true);
          return;
        }
      } else {
        document.getElementById('plateResultText').textContent = 'LỖI BIỂN SỐ';
        document.getElementById('extraInfo').textContent = data.error || 'Có lỗi xảy ra!';
        alert(data.error || 'Có lỗi xảy ra!');
      }
    } else {
      document.getElementById('plateResultText').textContent = data.plate_number;

      if (data.detected_image) {
        const detectedImg = document.getElementById('detectedImg');
        detectedImg.src = '/' + data.detected_image;
        detectedImg.style.display = 'block';
        document.getElementById('detectPrompt').style.display = 'none';
      }

      if (data.cropped_image) {
        const croppedImg = document.getElementById('croppedPlateImg');
        croppedImg.src = '/' + data.cropped_image;
        croppedImg.style.display = 'block';
        document.getElementById('cropPrompt').style.display = 'none';
      }

      if (currentMode === 'entry') {
        const slotMsg = data.slot_number ? ` | Vị trí đỗ gợi ý: Ô ${data.slot_number}` : '';
        document.getElementById('extraInfo').textContent = `Vé xe #${data.sessionId}${slotMsg} - Đã ghi nhận xe vào bãi${selectedFaceFile ? ' (Kèm ảnh mặt)' : ''}`;
      } else {
        let faceMsg = data.face_verification ? ` | Mặt: ${data.face_verification.message || 'Khớp'}` : '';
        document.getElementById('extraInfo').textContent = `Thanh toán: ${data.fee ? data.fee.toLocaleString('vi-VN') : 5000} VNĐ - Đã cho xe ra${faceMsg}`;
      }
    }
  } catch (error) {
    document.getElementById('plateResultText').textContent = 'LỖI KẾT NỐI';
    document.getElementById('extraInfo').textContent = 'Không thể kết nối đến Server!';
    alert('Không thể kết nối tới Server!');
  } finally {
    actionBtn.disabled = false;
    if (currentMode === 'entry') {
      actionBtn.innerHTML = 'NHẬN DẠNG<br>BIỂN SỐ (VÀO)';
    } else {
      actionBtn.innerHTML = 'XÁC NHẬN<br>XE RA (TÍNH TIỀN)';
    }
  }
}
