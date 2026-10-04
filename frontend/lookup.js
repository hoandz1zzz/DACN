const ALL_SLOTS = [
    'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8',
    'B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8',
    'C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8',
    'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8'
];

async function executeLookup() {
    const input = document.getElementById('kioskPlateInput');
    const query = (input.value || '').trim();
    const statusMsg = document.getElementById('lookupStatusMessage');
    const resultView = document.getElementById('lookupResultView');

    if (!query) {
        alert('Vui lòng nhập biển số xe cần tìm');
        return;
    }

    statusMsg.style.display = 'block';
    statusMsg.style.color = '#6b7280';
    statusMsg.textContent = 'Đang tra cứu dữ liệu...';
    resultView.style.display = 'none';

    try {
        const lookupRes = await fetch(`/api/lookup?plate=${encodeURIComponent(query)}`);
        const lookupData = await lookupRes.json();

        if (!lookupRes.ok || !Array.isArray(lookupData)) {
            statusMsg.style.color = '#dc2626';
            statusMsg.textContent = lookupData.error || 'Lỗi hệ thống khi tra cứu!';
            return;
        }

        if (lookupData.length === 0) {
            statusMsg.style.color = '#dc2626';
            statusMsg.textContent = `Không tìm thấy xe nào đang đỗ trong bãi với biển số "${query}".`;
            return;
        }

        const session = lookupData[0];
        statusMsg.style.display = 'none';
        resultView.style.display = 'block';

        // Render info
        document.getElementById('resPlate').textContent = session.plate_number;
        document.getElementById('resSlot').textContent = `Ô ${session.slot_number || 'A1'}`;
        document.getElementById('resTicket').textContent = `#${session.id}`;
        document.getElementById('resTime').textContent = new Date(session.entry_time).toLocaleString('vi-VN');

        // Render images preview
        const imgBox = document.getElementById('resImagesBox');
        imgBox.innerHTML = `
            ${session.image_in ? `<div class="mobile-img-box"><p>Ảnh xe vào:</p><img src="/${session.image_in}" alt="Ảnh xe"></div>` : ''}
            ${session.face_image_in ? `<div class="mobile-img-box"><p>Ảnh mặt chủ xe:</p><img src="/${session.face_image_in}" class="face-circle" alt="Ảnh mặt"></div>` : ''}
        `;

        // Render customer grid map (Only highlight customer's target slot)
        renderMobileCustomerMap(session.slot_number);

    } catch (error) {
        statusMsg.style.color = '#dc2626';
        statusMsg.textContent = 'Lỗi kết nối tới Server tra cứu!';
    }
}

function renderMobileCustomerMap(targetSlotNumber) {
    const grid = document.getElementById('miniMapSlotsGrid');
    
    grid.innerHTML = ALL_SLOTS.map(slotName => {
        const isTarget = slotName === targetSlotNumber;

        let boxClass = 'mobile-slot-item';
        if (isTarget) {
            boxClass += ' sample-search';
        } else {
            boxClass += ' slot-box-neutral';
        }

        return `
            <div class="${boxClass}" title="Ô ${slotName}${isTarget ? ' (Xe của bạn)' : ''}">
                ${slotName}
            </div>
        `;
    }).join('');
}
