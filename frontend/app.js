let currentMode = 'entry'; // 'entry' or 'exit'
let selectedFile = null;

function switchMode(mode) {
  currentMode = mode;
  selectedFile = null;

  document.getElementById('modeEntryBtn').classList.toggle('active', mode === 'entry');
  document.getElementById('modeExitBtn').classList.toggle('active', mode === 'exit');
  document.getElementById('modeListBtn').classList.toggle('active', mode === 'list');

  const mainWS = document.getElementById('mainWorkspace');
  const listWS = document.getElementById('listWorkspace');

  if (mode === 'list') {
    mainWS.style.display = 'none';
    listWS.style.display = 'block';
    fetchVehiclesList();
    return;
  }

  mainWS.style.display = 'flex';
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

async function fetchVehiclesList() {
  const tbody = document.getElementById('vehicleTableBody');
  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center">Đang tải danh sách xe...</td></tr>';

  try {
    const response = await fetch('/api/vehicles');
    const data = await response.json();

    if (!response.ok || !Array.isArray(data)) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:red">Không thể tải danh sách xe!</td></tr>';
      return;
    }

    if (data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center">Hiện tại không có xe nào đang ở trong bãi.</td></tr>';
      return;
    }

    tbody.innerHTML = data.map(item => `
      <tr>
        <td>#${item.id}</td>
        <td style="color:#ff0000; font-size:1.2rem; font-weight:800">${item.plate_number}</td>
        <td><img src="/${item.image_in}" class="table-img" alt="Ảnh xe vào" onerror="this.onerror=null; this.src='/uploads/1789326409713.jpg';"></td>
        <td>${new Date(item.entry_time).toLocaleString('vi-VN')}</td>
        <td>${item.status}</td>
        <td>
          <button class="delete-btn" onclick="deleteVehicle(${item.id})">XÓA</button>
        </td>
      </tr>
    `).join('');

  } catch (error) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:red">Lỗi kết nối tới Server!</td></tr>';
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

  document.getElementById('detectedImg').style.display = 'none';
  document.getElementById('detectPrompt').style.display = 'block';

  document.getElementById('croppedPlateImg').style.display = 'none';
  document.getElementById('cropPrompt').style.display = 'block';

  document.getElementById('plateResultText').textContent = 'CHƯA CÓ KẾT QUẢ';
  document.getElementById('extraInfo').textContent = '';
  document.getElementById('fileInput').value = '';
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

async function processAction() {
  if (!selectedFile) return;

  const actionBtn = document.getElementById('actionBtn');
  actionBtn.disabled = true;
  actionBtn.innerHTML = 'ĐANG XỬ LÝ...';

  const formData = new FormData();
  formData.append('image', selectedFile);

  const endpoint = currentMode === 'entry' ? '/api/entry' : '/api/exit';

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      body: formData
    });

    const data = await response.json();

    if (!response.ok) {
      document.getElementById('plateResultText').textContent = 'LỖI BIỂN SỐ';
      document.getElementById('extraInfo').textContent = data.error || 'Có lỗi xảy ra!';
      alert(data.error || 'Có lỗi xảy ra!');
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
        document.getElementById('extraInfo').textContent = `Vé xe #${data.sessionId} - Đã ghi nhận xe vào bãi`;
      } else {
        document.getElementById('extraInfo').textContent = `Thanh toán: ${data.fee ? data.fee.toLocaleString('vi-VN') : 5000} VNĐ - Đã cho xe ra`;
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
