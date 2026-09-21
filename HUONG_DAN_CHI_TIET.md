# TÀI LIỆU HƯỚNG DẪN CHI TIẾT DỰ ÁN HỆ THỐNG BÃI XE THÔNG MINH (DACN)
## (NHẬN DẠNG BIỂN SỐ XE MÁY & ỨNG DỤNG DOCKER)

---

## 1. TỔNG QUAN VỀ DỰ ÁN

Dự án **DACN Smart Parking** là một hệ thống bãi gửi xe thông minh tự động hóa quy trình **Gửi xe vào bãi**, **Cho xe ra bãi (tính tiền)**, và **Quản lý danh sách xe đang gửi trong bãi**. 

Hệ thống tích hợp trí tuệ nhân tạo (AI) với công nghệ nhận dạng ký tự quang học (OCR) và phát hiện vật thể (YOLOv8 + EasyOCR) để tự động đọc biển số xe từ hình ảnh chụp camera, tự động trích xuất vùng biển số, cắt ảnh biển số và hỗ trợ thao tác quản lý trực quan trên giao diện Web.

---

## 2. ỨNG DỤNG VÀ VAI TRÒ CỦA DOCKER TRONG DỰ ÁN

### 2.1. Tại sao lại dùng Docker trong dự án này?
Trong các dự án AI & Web tích hợp, việc cài đặt thủ công trên máy tính người dùng rất dễ gặp các vấn đề nghiêm trọng như:
- **Xung đột phiên bản Python / Node.js**: AI cần Python 3.11, PyTorch CPU, OpenCV; Backend lại cần Node.js v18.
- **Thiếu thư viện hệ điều hành (DLL/C++)**: OpenCV trên Linux/Windows thường bị lỗi thiếu thư viện đồ họa (`libgl1`, `libglib2.0`).
- **Phức tạp khi cài đặt Database**: Phải cài thủ công MySQL 8.0, cấu hình tài khoản, mật khẩu, và chạy tệp SQL tạo bảng.

👉 **Giải pháp Docker**: Docker đóng gói toàn bộ hệ thống vào **3 Container độc lập**, đảm bảo ứng dụng chạy thành công 100% trên bất kỳ máy tính nào (Windows, macOS, Linux) chỉ với **1 câu lệnh duy nhất**.

---

### 2.2. Kiến trúc 3 Container trong Docker Compose

Tệp [`docker-compose.yml`](file:///d:/radai/DACN/docker-compose.yml) định nghĩa 3 Dịch vụ (Services) hoạt động nhịp nhàng cùng nhau:

| Dịch vụ | Tên Container | Cổng (Port) | Nhiệm vụ chính |
| :--- | :--- | :--- | :--- |
| **`db`** | `dacn_mysql` | `3306:3306` | Cơ sở dữ liệu MySQL 8.0. Tự động chạy tệp `init.sql` để tạo bảng `parking_sessions`. |
| **`ai`** | `dacn_ai` | `5000:5000` | Server AI viết bằng Python (FastAPI). Chứa mô hình **YOLOv8** và **EasyOCR** để đọc và cắt biển số. |
| **`backend`** | `dacn_backend` | `3000:3000` | Server chính viết bằng Node.js (Express.js). Phục vụ giao diện Web HTML/CSS/JS, quản lý upload ảnh và lưu vào DB. |

---

### 2.3. Cơ chế Mạng nội bộ Docker (Docker Internal Network)
Các container giao tiếp với nhau thông qua tên dịch vụ thay vì địa chỉ IP cứng:
- Backend kết nối tới Database qua hostname `db:3306` (user: `root`, password: `rootpassword`).
- Backend gửi ảnh sang AI Server qua URL `http://ai:5000/detect-plate`.

---

### 2.4. Cơ chế Đồng bộ Ổ đĩa (Docker Volume Bind Mounts)
Để hình ảnh và mã nguồn luôn đồng bộ giữa máy tính thật (Windows Host) và bên trong Docker Container:

```yaml
volumes:
  - ./backend/uploads:/app/uploads
  - ./backend/server.js:/app/server.js
  - ./AI/main.py:/app/main.py
```

- **`./backend/uploads:/app/uploads`**: Khi khách gửi xe qua Web, ảnh được lưu vào Docker thì ngay lập tức xuất hiện trong thư mục `backend/uploads` trên máy thật của bạn trong VS Code.
- **`./backend/server.js:/app/server.js` & `./AI/main.py:/app/main.py`**: Giúp sửa code ở máy thật thì code bên trong Docker cũng được cập nhật ngay lập tức.

---

## 3. LUỒNG HOẠT ĐỘNG CỦA HỆ THỐNG TỪ A - Z

```
[Người dùng (Web Browser)]
        │
        ▼ (1. Upload ảnh xe)
[Backend Node.js (Port 3000)]
        │
        ├─────────────────────────────┐
        ▼ (2. Gửi ảnh xử lý)           ▼ (Lưu ảnh gốc)
[AI Service Python (Port 5000)]  [Thư mục backend/uploads]
        │
        ├─ EasyOCR & YOLOv8 phát hiện biển số
        ├─ Cắt ảnh biển số (crop_xxx.jpg)
        ├─ Vẽ khung nhận diện (detect_xxx.jpg)
        └─ Quy chuẩn biển số VN (VD: B1F -> 51F-970.22)
        │
        ▼ (3. Trả về biển số + 2 đường dẫn ảnh cắt/khoanh vùng)
[Backend Node.js (Port 3000)]
        │
        ▼ (4. Ghi nhận lượt gửi / tính tiền ra bãi)
[Database MySQL (Port 3306)]
        │
        ▼ (5. Cập nhật Giao diện người dùng)
[Màn hình Web (Ô 1: Camera | Ô 2: Khoanh vùng | Ô 4: Kết quả | Ô 5: Cắt biển số)]
```

---

## 4. THUẬT TOÁN HẬU XỬ LÝ NHẬN DẠNG BIỂN SỐ VIỆT NAM

Một tính năng nổi bật trong module AI ([`AI/main.py`](file:///d:/radai/DACN/AI/main.py)) là **Hàm sửa lỗi đọc OCR cho biển số Việt Nam** (`correct_vietnamese_plate`):

1. **Nguyên tắc biển số Việt Nam**: 2 ký tự đầu tiên BẮT BUỘC là **SỐ** (Mã tỉnh thành từ `11` đến `99`).
2. **Sửa lỗi OCR thường gặp**:
   - Khi OCR đọc nhầm số `5` thành chữ `B` (Ví dụ: `B1F-970.22` -> được sửa ngay thành **`51F-970.22`**).
   - Tự động sửa `S` -> `5`, `Z` -> `2`, `O/D/Q` -> `0`, `I/L` -> `1`, `G` -> `6`.
3. **Chuẩn hóa dấu gạch & dấu chấm**:
   - Chuyển chuỗi liền `51F97022` thành dạng định dạng đẹp chuẩn: **`51F-970.22`**.

---

## 5. HƯỚNG DẪN SỬ DỤNG VÀ CÁC CÂU LỆNH THƯỜNG DÙNG

### 5.1. Khởi chạy ứng dụng bằng Docker

- **Bật hệ thống (Nhanh nhất - Không cần build lại)**:
  ```bash
  docker compose up -d
  ```

- **Rebuild lại khi có thay đổi thư viện/cấu hình**:
  ```bash
  docker compose up -d --build
  ```

- **Tắt toàn bộ hệ thống**:
  ```bash
  docker compose down
  ```

- **Khởi động lại một dịch vụ cụ thể (Ví dụ: Backend hoặc AI)**:
  ```bash
  docker compose restart backend
  docker compose restart ai
  ```

- **Xem Nhật ký lỗi (Logs) của AI hoặc Backend**:
  ```bash
  docker logs dacn_ai --tail 50
  docker logs dacn_backend --tail 50
  ```

---

### 5.2. Hướng dẫn thao tác trên Giao diện Web

1. **Truy cập ứng dụng**:
   Mở trình duyệt gõ địa chỉ: **`http://localhost:3000`**

2. **Chức năng 1: GỬI XE VÀO BÃI**
   - Nhấp vào ô **"VIDEO TỪ CAMERA"** để chọn ảnh xe cần gửi vào.
   - Bấm nút xanh lá **"NHẬN DẠNG BIỂN SỐ (VÀO)"**.
   - Kết quả:
     - Ô 2 hiển thị ảnh được **Khoanh vùng màu xanh lá** quanh biển số.
     - Ô 4 hiển thị **Chuỗi biển số nhận dạng** (VD: `51F-970.22`).
     - Ô 5 hiển thị **Ảnh đã được cắt riêng biển số**.
     - Vé xe tự động lưu vào Database.

3. **Chức năng 2: CHO XE RA BÃI (TÍNH TIỀN)**
   - Chuyển sang Tab **"CHO XE RA BÃI"**.
   - Chọn ảnh xe lúc ra và bấm **"XÁC NHẬN XE RA (TÍNH TIỀN)"**.
   - Hệ thống đối soát biển số trong bãi, tính tiền phí gửi (5.000 VNĐ) và đổi trạng thái xe thành `OUT`.

4. **Chức năng 3: DANH SÁCH XE TRONG BÃI & XÓA XE**
   - Chuyển sang Tab **"DANH SÁCH XE TRONG BÃI"**.
   - Hiển thị bảng bao gồm: Mã vé, Biển số xe, Ảnh lúc vào, Thời gian vào, Trạng thái (`IN`), và Cột Thao tác.
   - Nút **`[XÓA]` màu đỏ**: Cho phép xóa bất kỳ lượt xe nào khỏi bãi xe ngay trên giao diện web (có hộp thoại xác nhận an toàn).

---

## 6. TỔNG KẾT

Dự án **DACN Smart Parking** là minh họa hoàn hảo cho việc kết hợp giữa **Kiến trúc Microservices với Docker**, **Trí tuệ nhân tạo (AI/OCR)** và **Giao diện Web trực quan**. Nhờ Docker, việc triển khai ứng dụng trở nên đơn giản, nhất quán và không gặp phải các lỗi môi trường khi di chuyển dự án sang các máy tính khác nhau.
